import { type ChildProcess, execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RunnerError } from "@/runner/files";

export interface ProcessClaim {
  version: 1;
  pid: number;
  token: string;
  started: string;
  groupId: number;
  createdAt: string;
}
export interface Termination {
  token: string;
  reason: "succeeded" | "failed" | "cancelled" | "timed_out" | "interrupted";
  exitCode?: number | null;
  error?: string;
  logsTruncated?: boolean;
  requestedAt: string;
}

export function pidExists(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function describeProcess(
  pid: number,
): Promise<{ started: string; command: string; groupId: number } | undefined> {
  if (!pidExists(pid)) return undefined;
  try {
    const { stdout } = await promisify(execFile)(
      "ps",
      [
        "-ww",
        "-p",
        String(pid),
        "-o",
        "pgid=",
        "-o",
        "lstart=",
        "-o",
        "command=",
      ],
      { timeout: 2000, env: { PATH: process.env.PATH, LC_ALL: "C" } },
    );
    const match = stdout
      .trim()
      .match(
        /^(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+([\s\S]+)$/,
      );
    if (!match) return undefined;
    return {
      groupId: Number(match[1]),
      started: match[2] ?? "",
      command: match[3] ?? "",
    };
  } catch {
    return undefined;
  }
}

export async function captureIdentity(token: string): Promise<ProcessClaim> {
  const processInfo = await describeProcess(process.pid);
  if (!processInfo?.command.includes(token))
    throw new RunnerError(
      "Cannot establish execution process identity",
      "conflict",
    );
  return {
    version: 1,
    pid: process.pid,
    token,
    started: processInfo.started,
    groupId: processInfo.groupId,
    createdAt: new Date().toISOString(),
  };
}

export async function inspectIdentity(
  claim: ProcessClaim,
): Promise<"alive" | "gone" | "unknown"> {
  if (!pidExists(claim.pid)) return "gone";
  const info = await describeProcess(claim.pid);
  if (
    !info ||
    info.started !== claim.started ||
    info.groupId !== claim.groupId ||
    !info.command.includes(claim.token)
  )
    return "unknown";
  return "alive";
}

/** No signalling of recorded PIDs: only the living watchdog signals its own group. */
export function groupExists(groupId: number): boolean {
  if (!Number.isSafeInteger(groupId) || groupId < 1) return true;
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

const inherited = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"];
export function executionEnvironment(
  runDir: string,
  bindings: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of inherited)
    if (process.env[key]) env[key] = process.env[key];
  for (const [key, value] of Object.entries(bindings)) {
    if (
      !/^[A-Z_][A-Z0-9_]*$/.test(key) ||
      key === "PICO_RUNNER_BINDINGS" ||
      value.includes("\0")
    )
      throw new RunnerError("Invalid execution environment binding");
    env[key] = value;
  }
  return {
    ...env,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PICO_RUN_DIR: runDir,
    PICO_OUTPUT_DIR: join(runDir, "outputs"),
    PICO_INPUTS_DIR: join(runDir, "work", "inputs"),
    PICO_CONFIG_PATH: join(runDir, "snapshot", "config.json"),
    UV_CACHE_DIR: join(runDir, "work", ".uv-cache"),
    UV_PROJECT_ENVIRONMENT: join(runDir, "work", ".venv"),
  };
}

export function processArguments(
  entrypoint: "worker" | "watchdog",
  runDir: string,
  token: string,
): string[] {
  return [
    fileURLToPath(new URL(`./${entrypoint}.ts`, import.meta.url)),
    runDir,
    token,
  ];
}

export async function spawnSupervisor(
  runDir: string,
  token: string,
  bindings: Readonly<Record<string, string>>,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    processArguments("worker", runDir, token),
    {
      cwd: runDir,
      detached: true,
      stdio: "ignore",
      env: {
        ...executionEnvironment(runDir),
        PICO_RUNNER_BINDINGS: JSON.stringify(bindings),
      },
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child;
}
