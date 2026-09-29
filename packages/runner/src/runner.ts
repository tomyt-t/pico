import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportBundle, importBundle, validateBundle } from "@/runner/archives";
import { acquireCoordinatorLock } from "@/runner/coordinator-lock";
import {
  type ExecutionInventory,
  type ExecutionIssue,
  type RunBundle,
  type RunRecord,
  type RunRequest,
  type SnapshotSources,
  terminal,
} from "@/runner/execution-contract";
import { ExecutionFiles } from "@/runner/execution-files";
import {
  removeWork,
  repairUnknownRecord,
  repairUnreadableRecord,
} from "@/runner/execution-repair";
import * as files from "@/runner/files";
import { atomicJson, RunnerError } from "@/runner/files";
import { readLogs } from "@/runner/outputs";
import { dispatchPending } from "@/runner/queue";
import { inspectExecution } from "@/runner/recovery";
import { Snapshots } from "@/runner/snapshots";

export type {
  DatasetManifest,
  DatasetManifestV1,
  ExecutionInspection,
  ExecutionInventory,
  ExecutionIssue,
  Metric,
  RunBundle,
  RunRecord,
  RunRequest,
  RunStatus,
  SnapshotManifest,
  SnapshotSources,
} from "@/runner/execution-contract";
export { executionControlFiles } from "@/runner/execution-files";
export type { FileDigest, FileInput, FileLimits } from "@/runner/files";
export { localRunnerCapabilities } from "@/runner/processes";
export { RunnerError, terminal, validateBundle };
/** Safe byte/file operations; consumers own their own scientific formats and directories. */
export const fileAccess = {
  atomicJson: files.atomicJson,
  copyVerified: files.copyVerified,
  decodeFile: files.decodeFile,
  digest: files.digest,
  ensureDirectory: files.ensureDirectory,
  exists: files.exists,
  listFiles: files.listFiles,
  hashFile: files.hashFile,
  readBytes: files.readBytes,
  readJson: files.readJson,
  safeId: files.safeId,
  safeRelative: files.safeRelative,
  writeBytes: files.writeBytes,
  MAX_FILE_BYTES: files.MAX_FILE_BYTES,
  MAX_TREE_BYTES: files.MAX_TREE_BYTES,
  MAX_TREE_FILES: files.MAX_TREE_FILES,
  LOCAL_DATASET_LIMITS: files.LOCAL_DATASET_LIMITS,
};

export interface RunnerOptions {
  dataDir: string;
  maxConcurrent?: number;
  getLabConcurrency?: (labId: string) => number;
  onUpdate?: (record: RunRecord) => void | Promise<void>;
  pollMs?: number;
  environmentBindings?:
    | Readonly<Record<string, string>>
    | ((
        request: RunRequest,
      ) =>
        | Readonly<Record<string, string>>
        | Promise<Readonly<Record<string, string>>>);
  cleanupWorkOnCompletion?: boolean;
  datasetLimits?: Partial<files.FileLimits>;
}
type Lifecycle = "constructed" | "starting" | "active" | "closing" | "closed";

export class Runner {
  private state: Lifecycle = "constructed";
  private files: ExecutionFiles;
  private snapshots: Snapshots;
  private release?: () => void;
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  private cycle?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private dispatchEnabled = false;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly publications = new Map<
    string,
    { request: string; promise: Promise<RunRecord> }
  >();
  private readonly delivered = new Map<string, string>();
  private readonly deliveryFailures = new Set<string>();
  private readonly maximum: number;
  private recoveredPublications: string[] = [];
  private publicationIssues: ExecutionIssue[] = [];

  constructor(private readonly options: RunnerOptions) {
    this.maximum = options.maxConcurrent ?? 1;
    if (
      !Number.isSafeInteger(this.maximum) ||
      this.maximum < 1 ||
      this.maximum > 16
    )
      throw new RunnerError("Concurrency must be between 1 and 16");
    this.files = new ExecutionFiles(resolve(options.dataDir));
    this.snapshots = new Snapshots(this.files, options.datasetLimits);
  }
  get root(): string {
    return this.files.root;
  }
  get lifecycle(): Lifecycle {
    return this.state;
  }

  /** Acquire authority and inspect only. The lab restores links before resumeDispatch(). */
  start(): Promise<void> {
    if (this.state === "closing" || this.state === "closed")
      return Promise.reject(new RunnerError("Runner is closed", "conflict"));
    this.starting ??= (async () => {
      this.state = "starting";
      try {
        await mkdir(join(this.root, "labs"), { recursive: true });
        this.files = new ExecutionFiles(await realpath(this.root));
        this.snapshots = new Snapshots(this.files, this.options.datasetLimits);
        this.release = acquireCoordinatorLock(this.root);
        const recovery = await this.files.recoverPublications();
        this.recoveredPublications = recovery.recovered;
        this.publicationIssues = recovery.issues;
        await this.runCycle(false);
        if (this.closing) return;
        this.state = "active";
        this.timer = setInterval(() => {
          if (!this.dispatchEnabled) return;
          void this.runCycle().catch(() => {
            /* Durable state is inspected again. */
          });
        }, this.options.pollMs ?? 300);
        this.timer.unref();
      } catch (error) {
        this.release?.();
        this.release = undefined;
        this.state = "closed";
        throw error;
      }
    })();
    return this.starting;
  }
  private requireActive(): void {
    if (this.state !== "active")
      throw new RunnerError(
        `Runner is ${this.state}; start it before using its capabilities`,
        "conflict",
      );
  }
  private admit<T>(operation: () => Promise<T>): Promise<T> {
    this.requireActive();
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
    return promise;
  }
  private async notify(record: RunRecord): Promise<void> {
    const key = `${record.labId}:${record.id}`;
    const signature = JSON.stringify({ ...record, heartbeatAt: undefined });
    if (this.delivered.get(key) === signature) return;
    try {
      await this.options.onUpdate?.(record);
      this.delivered.set(key, signature);
      this.deliveryFailures.delete(key);
    } catch {
      this.deliveryFailures.add(key);
    }
  }
  private runCycle(dispatch = this.dispatchEnabled): Promise<void> {
    if (this.cycle) return this.cycle;
    this.cycle = (async () => {
      const { records, issues, pending } = await this.files.scan();
      const inspections = [];
      for (const record of records) {
        const inspection = await inspectExecution(this.files, record);
        inspections.push(inspection);
        await this.notify(inspection.record);
        if (
          inspection.state === "terminal" &&
          this.options.cleanupWorkOnCompletion !== false
        )
          await removeWork(this.files.runDir(record.labId, record.id)).catch(
            () => {
              /* A terminal publication can briefly precede supervisor exit. Recheck next cycle. */
            },
          );
      }
      if (
        dispatch &&
        this.dispatchEnabled &&
        !this.deliveryFailures.size &&
        !issues.length &&
        !pending.length
      )
        await dispatchPending(this.files, inspections, {
          maxConcurrent: this.maximum,
          getLabConcurrency: this.options.getLabConcurrency,
          environmentBindings: this.options.environmentBindings ?? {},
          isAllowed: () => this.state === "active" && this.dispatchEnabled,
        });
    })().finally(() => {
      this.cycle = undefined;
    });
    return this.cycle;
  }
  async reconcile(): Promise<void> {
    this.requireActive();
    await this.runCycle();
  }
  async resumeDispatch(): Promise<void> {
    this.requireActive();
    this.dispatchEnabled = true;
    await this.runCycle();
  }
  async pauseDispatch(): Promise<void> {
    this.requireActive();
    this.dispatchEnabled = false;
    await this.cycle;
    await Promise.allSettled([...this.pending]);
  }
  submit(request: RunRequest, sources?: SnapshotSources): Promise<RunRecord> {
    this.requireActive();
    const key = `${request.labId}:${request.runId}`;
    const fingerprint = JSON.stringify(request);
    const existing = this.publications.get(key);
    if (existing) {
      if (existing.request !== fingerprint)
        return Promise.reject(
          new RunnerError(
            "Run identifier already belongs to another request",
            "conflict",
          ),
        );
      return existing.promise;
    }
    const promise = this.admit(async () => {
      const record = await this.snapshots.publish(request, sources);
      // Publication has succeeded even when its scientific projection is temporarily unavailable.
      await this.notify(record);
      return record;
    }).finally(() => this.publications.delete(key));
    this.publications.set(key, { request: fingerprint, promise });
    return promise;
  }
  async reproduce(
    labId: string,
    referenceRunId: string,
    runId: string,
  ): Promise<RunRecord> {
    this.requireActive();
    const snapshot = await this.snapshots.get(labId, referenceRunId);
    return this.submit({ ...snapshot.request, runId, referenceRunId });
  }
  getRun(labId: string, runId: string): Promise<RunRecord> {
    this.requireActive();
    return this.files.getRun(labId, runId);
  }
  getSnapshot(labId: string, runId: string) {
    this.requireActive();
    return this.snapshots.get(labId, runId);
  }
  readRunFile(
    labId: string,
    runId: string,
    area: "code" | "outputs",
    path: string,
  ) {
    this.requireActive();
    return this.snapshots.readFile(labId, runId, area, path);
  }
  async readLogs(labId: string, runId: string) {
    this.requireActive();
    const record = await this.files.getRun(labId, runId);
    return readLogs(this.files.runDir(labId, runId), record.logsTruncated);
  }
  logs(labId: string, runId: string) {
    return this.readLogs(labId, runId);
  }
  async allRuns(): Promise<RunRecord[]> {
    this.requireActive();
    return (await this.files.scan()).records;
  }
  cancel(labId: string, runId: string): Promise<RunRecord> {
    return this.admit(async () => {
      const record = await this.files.getRun(labId, runId);
      if (terminal(record.status)) return record;
      await atomicJson(join(this.files.runDir(labId, runId), "cancel.json"), {
        requestedAt: new Date().toISOString(),
      });
      await this.runCycle(false);
      return this.files.getRun(labId, runId);
    });
  }
  async inventory(): Promise<ExecutionInventory> {
    return this.admit(async () => {
      await this.runCycle(false);
      const scan = await this.files.scan();
      const runs = [];
      for (const record of scan.records) {
        const inspection = await inspectExecution(this.files, record);
        runs.push(inspection);
        await this.notify(inspection.record);
      }
      const pendingPublications = [
        ...scan.pending,
        ...this.publications.keys(),
      ];
      const pendingDeliveries = [...this.deliveryFailures];
      return {
        runs,
        issues: [
          ...scan.issues,
          ...this.publicationIssues.filter((issue) =>
            scan.pending.includes(join(this.root, issue.directory)),
          ),
          ...pendingDeliveries.map((key): ExecutionIssue => {
            const [labId = "", runId = ""] = key.split(":");
            return {
              labId,
              runId,
              directory: `labs/${labId}/runs/${runId}`,
              kind: "observation_delivery",
              reason:
                "Execution observations could not be projected into the laboratory; restore or repair scientific provenance, then recheck",
            };
          }),
        ],
        recoveredPublications: [...this.recoveredPublications],
        pendingPublications,
        pendingDeliveries,
        safeToBackup:
          !this.dispatchEnabled &&
          this.pending.size === 1 &&
          !pendingPublications.length &&
          !pendingDeliveries.length &&
          !scan.issues.length &&
          runs.every((item) => item.state === "terminal"),
      };
    });
  }
  repairExecution(labId: string, runId: string) {
    return this.admit(async () => {
      await this.cycle;
      let record: RunRecord;
      try {
        record = await this.files.getRun(labId, runId);
      } catch {
        record = await repairUnreadableRecord(this.files, labId, runId);
      }
      await this.snapshots.get(labId, runId);
      let inspection = await inspectExecution(this.files, record);
      if (inspection.state === "unknown") {
        record = await repairUnknownRecord(this.files, record);
        inspection = await inspectExecution(this.files, record);
      }
      await this.notify(inspection.record);
      return inspection;
    });
  }
  cleanupWork(labId: string, runId: string) {
    return this.admit(async () => {
      const inspection = await inspectExecution(
        this.files,
        await this.files.getRun(labId, runId),
      );
      if (inspection.state !== "terminal")
        throw new RunnerError(
          "Work cleanup requires confirmed execution termination",
          "conflict",
        );
      return {
        labId,
        runId,
        removed: await removeWork(this.files.runDir(labId, runId)),
      };
    });
  }
  async exportRun(labId: string, runId: string): Promise<RunBundle> {
    return this.admit(async () => {
      const inspection = await inspectExecution(
        this.files,
        await this.files.getRun(labId, runId),
      );
      if (inspection.state !== "terminal")
        throw new RunnerError(
          "Execution termination is not confirmed; archive export is blocked",
          "conflict",
        );
      return exportBundle(this.files.runDir(labId, runId), {
        schemaVersion: 1,
        record: inspection.record,
        snapshot: await this.snapshots.get(labId, runId),
      });
    });
  }
  importRun(bundle: RunBundle): Promise<RunRecord> {
    return this.admit(async () => {
      await importBundle(this.root, bundle);
      const record = await this.files.getRun(
        bundle.record.labId,
        bundle.record.id,
      );
      await this.notify(record);
      return record;
    });
  }
  async waitForRun(
    labId: string,
    runId: string,
    timeoutMs = 30000,
  ): Promise<RunRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.requireActive();
      await this.runCycle();
      const record = await this.files.getRun(labId, runId);
      if (terminal(record.status)) return record;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new RunnerError("Timed out waiting for run completion", "conflict");
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.state = "closing";
      this.dispatchEnabled = false;
      if (this.timer) clearInterval(this.timer);
      await this.starting?.catch(() => {});
      await Promise.allSettled([...this.pending]);
      await this.cycle?.catch(() => {});
      this.release?.();
      this.release = undefined;
      this.state = "closed";
    })();
    return this.closing;
  }
}

export const createRunner = (options: RunnerOptions): Runner =>
  new Runner(options);
export { Runner as LocalRunner };
