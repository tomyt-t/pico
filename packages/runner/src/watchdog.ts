import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord, SnapshotManifest } from "@/runner/execution-contract";
import { atomicJson, checkTreeBudget, exists, readJson } from "@/runner/files";
import {
  captureIdentity,
  executionEnvironment,
  type Termination,
} from "@/runner/processes";

/** Lifetime guard: never detached experimental descendants. Not a hostile-code sandbox. */
export async function guardExecution(
  runDir: string,
  token: string,
): Promise<void> {
  const claim = await captureIdentity(token);
  if (claim.groupId !== process.pid)
    throw new Error("Watchdog must lead its own process group");
  let stopping = false;
  let started = false;
  let deadline = performance.now() + 5000;
  let logsTruncated = false;
  let logQueue = Promise.resolve();
  const logBytes = { stdout: 0, stderr: 0 };
  const stop = async (
    reason: Termination["reason"],
    exitCode?: number | null,
    error?: string,
  ) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const outcome: Termination = {
      token,
      reason,
      exitCode,
      error,
      logsTruncated,
      requestedAt: new Date().toISOString(),
    };
    // The timer is independent of metadata IO. TERM gives Python a brief chance to
    // flush observations; the guard remains alive to end every remaining group member.
    const kill = setTimeout(() => process.kill(-process.pid, "SIGKILL"), 350);
    process.kill(-process.pid, "SIGTERM");
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await logQueue;
      outcome.logsTruncated = logsTruncated;
      await atomicJson(join(runDir, "termination.json"), outcome);
    } catch {
      /* Recovery will retain incomplete observations. */
    }
    clearTimeout(kill);
    process.kill(-process.pid, "SIGKILL");
  };
  process.stdin.on("end", () => {
    void stop("interrupted");
  });
  process.stdin.on("error", () => {
    void stop("interrupted");
  });
  process.on("SIGTERM", () => {
    void stop("interrupted");
  });
  process.on("SIGINT", () => {
    void stop("interrupted");
  });
  let checking = false;
  const timer = setInterval(() => {
    if (stopping) return;
    if (performance.now() >= deadline) {
      void stop(started ? "timed_out" : "interrupted");
      return;
    }
    if (checking) return;
    checking = true;
    void (async () => {
      if (await exists(join(runDir, "cancel.json"))) await stop("cancelled");
      else if (started) {
        try {
          await checkTreeBudget(join(runDir, "outputs"));
        } catch (error) {
          await stop(
            "failed",
            null,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })()
      .catch(() => stop("failed", null, "Execution monitoring failed"))
      .finally(() => {
        checking = false;
      });
  }, 50);
  const log = (stream: "stdout" | "stderr", chunk: Buffer) => {
    const remaining = 1024 * 1024 - logBytes[stream];
    if (chunk.length > remaining) logsTruncated = true;
    const kept = chunk.subarray(0, Math.max(0, remaining));
    logBytes[stream] += kept.length;
    if (kept.length)
      logQueue = logQueue.then(() =>
        writeFile(join(runDir, `${stream}.log`), kept, { flag: "a" }),
      );
    void logQueue.catch(() => {
      void stop("failed", null, "Could not preserve execution logs");
    });
  };
  let memoryMiB: number | undefined;
  const execute = (command: string[], env: NodeJS.ProcessEnv) =>
    new Promise<number | null>((resolve, reject) => {
      const invocation =
        memoryMiB === undefined
          ? command
          : [
              "python3",
              "-c",
              "import os,resource,sys; n=int(sys.argv[1]); resource.setrlimit(resource.RLIMIT_AS,(n,n)); os.execvp(sys.argv[2],sys.argv[2:])",
              String(memoryMiB * 1024 * 1024),
              ...command,
            ];
      const child = spawn(invocation[0] ?? "", invocation.slice(1), {
        cwd: join(runDir, "work", "code"),
        env,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (data: Buffer) => log("stdout", data));
      child.stderr.on("data", (data: Buffer) => log("stderr", data));
      child.once("error", reject);
      // Descendants holding output pipes open must not prevent cleanup after the main command exits.
      child.once("exit", resolve);
    });
  let incoming = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    incoming += chunk;
    if (!incoming.includes("\n") || started || stopping) return;
    let message: { command?: string; token?: string };
    try {
      message = JSON.parse(incoming.split("\n")[0] ?? "");
    } catch {
      void stop("interrupted");
      return;
    }
    if (message.command !== "GO" || message.token !== token) {
      void stop("interrupted");
      return;
    }
    started = true;
    void (async () => {
      const snapshot = await readJson<SnapshotManifest>(
        join(runDir, "snapshot"),
        "manifest.json",
      );
      const record = await readJson<RunRecord>(runDir, "run.json");
      const limit = snapshot.request.timeoutMs;
      deadline =
        limit === null ? Number.POSITIVE_INFINITY : performance.now() + limit;
      await atomicJson(join(runDir, "execution-started.json"), {
        token,
        startedAt: new Date().toISOString(),
        deadline: limit === null ? null : Date.now() + limit,
      });
      if (await exists(join(runDir, "cancel.json"))) {
        await stop("cancelled");
        return;
      }
      if (stopping) return;
      const bindings = JSON.parse(
        process.env.PICO_RUNNER_BINDINGS ?? "{}",
      ) as Record<string, string>;
      const env = executionEnvironment(runDir, bindings);
      memoryMiB = snapshot.request.resources?.memoryMiB;
      if (snapshot.request.resources?.gpuDevices !== undefined)
        env.CUDA_VISIBLE_DEVICES =
          snapshot.request.resources.gpuDevices.join(",");
      let code: number | null = 0;
      if (snapshot.request.runtime === "uv")
        code = await execute(
          ["uv", "sync", "--frozen", "--no-dev", "--no-editable"],
          env,
        );
      if (code === 0 && !stopping) code = await execute(record.command, env);
      if (!stopping) await stop(code === 0 ? "succeeded" : "failed", code);
    })().catch((error) =>
      stop(
        "failed",
        null,
        error instanceof Error ? error.message : String(error),
      ),
    );
  });
  // Publication precedes READY; the supervisor cannot grant GO before this exists.
  await atomicJson(join(runDir, "watchdog.claim"), claim);
  process.stdout.write(`${JSON.stringify({ ready: true, token })}\n`);
  process.stdin.resume();
}

if (import.meta.main) {
  const [runDir, token] = process.argv.slice(2);
  if (!runDir || !token)
    throw new Error(
      "Watchdog requires an execution directory and identity token",
    );
  await guardExecution(runDir, token);
}
