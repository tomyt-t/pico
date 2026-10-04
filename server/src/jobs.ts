import type { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Job, JobStatus, Metric } from "./contracts";
import { now } from "./db";
import { badRequest, conflict, errorMessage, notFound } from "./errors";
import { commitAll } from "./git";
import { newId } from "./ids";
import { resolveUserPath } from "./paths";

export type { Job, JobStatus, Metric };

export interface StartJobInput {
  command: string;
  name?: string;
  cwd?: string;
  experimentId?: string | null;
  metricsPath?: string;
  campaignId?: string | null;
}

export interface JobsOptions {
  /** Called once per finished job; retried on failure. */
  onFinished?: (job: Job) => Promise<void> | Promise<boolean> | void | boolean;
  beforeStart?: (labId: string, campaignId?: string | null) => void;
  pollMs?: number;
}

interface Row {
  id: string;
  lab_id: string;
  campaign_id: string | null;
  name: string;
  command: string;
  cwd: string;
  status: JobStatus;
  pid: number | null;
  commit_hash: string | null;
  log_path: string;
  metrics_path: string;
  metrics: string | null;
  exit_code: number | null;
  error: string | null;
  experiment_id: string | null;
  notified: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const fromRow = (row: Row): Job => ({
  id: row.id,
  labId: row.lab_id,
  campaignId: row.campaign_id,
  name: row.name,
  command: row.command,
  cwd: row.cwd,
  status: row.status,
  pid: row.pid,
  commitHash: row.commit_hash,
  logPath: row.log_path,
  metricsPath: row.metrics_path,
  metrics: row.metrics ? (JSON.parse(row.metrics) as Metric[]) : null,
  exitCode: row.exit_code,
  error: row.error,
  experimentId: row.experiment_id,
  notified: row.notified === 1,
  createdAt: row.created_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/** Accepts a list of metric objects or a flat {name: value} object. */
export function parseMetrics(input: unknown): Metric[] {
  const metrics: Metric[] = [];
  const push = (
    name: unknown,
    value: unknown,
    extra: Record<string, unknown>,
  ) => {
    if (typeof name !== "string" || !name.trim()) return;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return;
    const metric: Metric = { name: name.trim(), value: numeric };
    if (typeof extra.unit === "string") metric.unit = extra.unit;
    if (typeof extra.split === "string") metric.split = extra.split;
    if (typeof extra.step === "number" && Number.isFinite(extra.step))
      metric.step = extra.step;
    metrics.push(metric);
  };
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object") {
        const { name, value, ...extra } = item as Record<string, unknown>;
        push(name, value, extra);
      }
    }
  } else if (input && typeof input === "object") {
    for (const [name, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      if (value && typeof value === "object" && "value" in value) {
        const { value: inner, ...extra } = value as Record<string, unknown>;
        push(name, inner, extra);
      } else push(name, value, {});
    }
  }
  return metrics.slice(0, 5000);
}

export async function readTail(
  path: string,
  maxBytes = 64 * 1024,
): Promise<string> {
  if (!existsSync(path)) return "";
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? `[earlier output omitted]\n${text}` : text;
  } finally {
    await handle.close();
  }
}

/** Where a job's metrics file is. The model often writes the path from the
 *  laboratory root ("experiments/x/metrics.json") for a job that already runs
 *  in experiments/x; when that lands inside the job's folder it is what was
 *  meant. Otherwise the path is relative to the job's cwd, as documented. */
export function resolveMetricsPath(
  labPath: string,
  cwd: string,
  given?: string,
): string {
  const path = given?.trim() || "metrics.json";
  if (isAbsolute(path)) return path;
  const folder = resolve(cwd);
  const fromLab = resolve(labPath, path);
  if (fromLab === folder || fromLab.startsWith(`${folder}${sep}`))
    return fromLab;
  return resolve(folder, path);
}

export class Jobs {
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly options: JobsOptions = {},
  ) {}

  async start(
    lab: { id: string; path: string },
    input: StartJobInput,
  ): Promise<Job> {
    if (this.closing) throw conflict("Server is shutting down");
    this.options.beforeStart?.(lab.id, input.campaignId);
    const command = input.command?.trim();
    if (!command) throw badRequest("command is required");
    const cwd = resolveUserPath(lab.path, input.cwd ?? ".");
    if (!existsSync(cwd) || !statSync(cwd).isDirectory())
      throw badRequest(`cwd does not exist: ${cwd}`);
    const id = newId("job");
    const dir = join(lab.path, ".pico", "jobs", id);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, "log.txt");
    const exitPath = join(dir, "exit.code");
    const metricsPath = resolveMetricsPath(lab.path, cwd, input.metricsPath);
    const name = input.name?.trim() || command.slice(0, 80);
    const commitHash = await commitAll(lab.path, `Pico: job ${id} (${name})`);
    if (this.closing) throw conflict("Server is shutting down");
    this.options.beforeStart?.(lab.id, input.campaignId);
    const shell = Bun.which("bash") ?? Bun.which("sh") ?? "/bin/sh";
    const script =
      'cd "$PICO_JOB_CWD" && ( eval "$PICO_JOB_COMMAND" ) > "$PICO_JOB_LOG" 2>&1; echo $? > "$PICO_JOB_EXIT"';
    const child = spawn(shell, ["-c", script], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PICO_JOB_ID: id,
        PICO_JOB_DIR: dir,
        PICO_JOB_CWD: cwd,
        PICO_JOB_COMMAND: command,
        PICO_JOB_LOG: logPath,
        PICO_JOB_EXIT: exitPath,
        PICO_LAB_DIR: lab.path,
        PICO_METRICS_PATH: metricsPath,
      },
    });
    child.unref();
    const timestamp = now();
    const job: Job = {
      id,
      labId: lab.id,
      campaignId: input.campaignId ?? null,
      name,
      command,
      cwd,
      status: "running",
      pid: child.pid ?? null,
      commitHash,
      logPath,
      metricsPath,
      metrics: null,
      exitCode: null,
      error: null,
      experimentId: input.experimentId ?? null,
      notified: false,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
    };
    this.db.run(
      "INSERT INTO jobs (id, lab_id, name, command, cwd, status, pid, commit_hash, log_path, metrics_path, experiment_id, created_at, started_at, campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        job.id,
        job.labId,
        job.name,
        job.command,
        job.cwd,
        job.status,
        job.pid,
        job.commitHash,
        job.logPath,
        job.metricsPath,
        job.experimentId,
        job.createdAt,
        job.startedAt,
        job.campaignId,
      ],
    );
    return job;
  }

  list(labId: string, status?: string): Job[] {
    const rows = status
      ? this.db
          .query(
            "SELECT * FROM jobs WHERE lab_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(labId, status)
      : this.db
          .query("SELECT * FROM jobs WHERE lab_id = ? ORDER BY created_at DESC")
          .all(labId);
    return (rows as Row[]).map(fromRow);
  }

  find(labId: string, id: string): Job | undefined {
    const row = this.db
      .query("SELECT * FROM jobs WHERE id = ? AND lab_id = ?")
      .get(id, labId) as Row | null;
    return row ? fromRow(row) : undefined;
  }

  get(labId: string, id: string): Job {
    const job = this.find(labId, id);
    if (!job) throw notFound(`Job ${id} not found`);
    return job;
  }

  private all(status: JobStatus): Job[] {
    return (
      this.db.query("SELECT * FROM jobs WHERE status = ?").all(status) as Row[]
    ).map(fromRow);
  }

  private unnotified(): Job[] {
    return (
      this.db
        .query("SELECT * FROM jobs WHERE status != 'running' AND notified = 0")
        .all() as Row[]
    ).map(fromRow);
  }

  async logTail(job: Job, maxBytes = 64 * 1024): Promise<string> {
    return readTail(job.logPath, maxBytes);
  }

  async stop(
    labId: string,
    id: string,
    options: { notify?: boolean } = {},
  ): Promise<Job> {
    const job = this.get(labId, id);
    if (job.status !== "running") throw conflict(`Job ${id} is ${job.status}`);
    if (job.pid !== null) {
      killGroup(job.pid, "SIGTERM");
      const pid = job.pid;
      setTimeout(() => {
        if (processAlive(pid)) killGroup(pid, "SIGKILL");
      }, 5000).unref();
    }
    return this.finish(
      job,
      "stopped",
      null,
      "Stopped on request",
      options.notify ?? true,
    );
  }

  private async finish(
    job: Job,
    status: JobStatus,
    exitCode: number | null,
    error: string | null,
    notify = true,
  ): Promise<Job> {
    let metrics: Metric[] | null = null;
    if (existsSync(job.metricsPath)) {
      try {
        metrics = parseMetrics(
          JSON.parse(readFileSync(job.metricsPath, "utf8")),
        );
      } catch (failure) {
        error = `${error ? `${error}. ` : ""}metrics.json could not be parsed: ${errorMessage(failure)}`;
      }
    }
    const finished: Job = {
      ...job,
      status,
      exitCode,
      error,
      metrics,
      endedAt: now(),
      notified: !notify,
    };
    this.db.run(
      "UPDATE jobs SET status = ?, exit_code = ?, error = ?, metrics = ?, ended_at = ?, notified = ? WHERE id = ?",
      [
        finished.status,
        finished.exitCode,
        finished.error,
        finished.metrics ? JSON.stringify(finished.metrics) : null,
        finished.endedAt,
        finished.notified ? 1 : 0,
        job.id,
      ],
    );
    if (notify) await this.notify(finished);
    return finished;
  }

  private async notify(job: Job): Promise<void> {
    const due = this.retryAt.get(job.id) ?? 0;
    if (Date.now() < due) return;
    try {
      if ((await this.options.onFinished?.(job)) === false) return;
      this.db.run("UPDATE jobs SET notified = 1 WHERE id = ?", [job.id]);
      this.retryAt.delete(job.id);
    } catch {
      this.retryAt.set(job.id, Date.now() + 15_000);
    }
  }

  /** Reconciles running jobs and delivers pending notifications. */
  poll(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.polling ??= this.reconcile().finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  private async reconcile(): Promise<void> {
    for (const job of this.all("running")) {
      const exitPath = join(dirname(job.logPath), "exit.code");
      if (existsSync(exitPath)) {
        const code = Number.parseInt(readFileSync(exitPath, "utf8").trim(), 10);
        const known = Number.isFinite(code);
        await this.finish(
          job,
          known && code === 0 ? "succeeded" : "failed",
          known ? code : null,
          null,
        );
      } else if (job.pid === null || !processAlive(job.pid)) {
        await this.finish(
          job,
          "failed",
          null,
          "The job process ended without reporting an exit code",
        );
      }
    }
    for (const job of this.unnotified()) await this.notify(job);
  }

  startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.options.pollMs ?? 1000);
    this.timer.unref();
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async close(): Promise<void> {
    this.closing = true;
    this.stopPolling();
    await this.polling;
  }
}

/** The message a finished job sends to the laboratory conversation. */
export async function jobNotification(job: Job): Promise<string> {
  const seconds =
    job.startedAt && job.endedAt
      ? Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000)
      : null;
  const duration =
    seconds === null
      ? ""
      : seconds >= 3600
        ? ` after ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
        : seconds >= 60
          ? ` after ${Math.floor(seconds / 60)}m ${seconds % 60}s`
          : ` after ${seconds}s`;
  // Blank lines keep each item on its own line when the UI renders Markdown.
  const lines = [
    `[Pico] Job "${job.name}" (${job.id}) finished: ${job.status}${job.exitCode === null ? "" : ` (exit code ${job.exitCode})`}${duration}.`,
    `Command: \`${job.command}\``,
    `Working directory: ${job.cwd}`,
    `Log: ${job.logPath}`,
  ];
  if (job.error) lines.push(`Error: ${job.error}`);
  if (job.metrics?.length)
    lines.push(`Metrics (${job.metricsPath}): ${JSON.stringify(job.metrics)}`);
  const tail = (await readTail(job.logPath, 4000)).trim();
  if (tail) lines.push(`Last log lines:\n\`\`\`\n${tail}\n\`\`\``);
  return lines.join("\n\n");
}
