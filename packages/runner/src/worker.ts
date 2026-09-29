import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord } from "@/runner/execution-contract";
import { atomicJson, exists, readJson } from "@/runner/files";
import { collectOutputs } from "@/runner/outputs";
import {
  captureIdentity,
  groupExists,
  type ProcessClaim,
  processArguments,
  type Termination,
} from "@/runner/processes";

/** Durable observation supervisor. Closing the coordinator does not close this process. */
export async function supervise(runDir: string, token: string): Promise<void> {
  const exclusive = await open(join(runDir, "worker.claim"), "wx").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return null;
      throw error;
    },
  );
  if (!exclusive) return;
  const identity = await captureIdentity(token);
  await exclusive.writeFile(JSON.stringify(identity));
  await exclusive.sync();
  await exclusive.close();
  let record = await readJson<RunRecord>(runDir, "run.json");
  if (record.status !== "queued") return;
  record = {
    ...record,
    status: "running",
    workerPid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  let stateQueue = Promise.resolve();
  const persist = () => {
    const value = structuredClone(record);
    stateQueue = stateQueue.then(() =>
      atomicJson(join(runDir, "run.json"), value),
    );
    return stateQueue;
  };
  await persist();
  const child = spawn(
    process.execPath,
    processArguments("watchdog", runDir, token),
    {
      cwd: runDir,
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env,
    },
  );
  // There is exactly one holder of the pipe's write end: this supervisor.
  child.stdin.on("error", () => {
    /* The watchdog may terminate before a command is written. */
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  const heartbeat = setInterval(() => {
    record.heartbeatAt = new Date().toISOString();
    void persist().catch(() => child.stdin.destroy());
  }, 250);
  const interrupt = () => child.stdin.destroy();
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  try {
    await new Promise<void>((resolve, reject) => {
      let text = "";
      const timeout = setTimeout(() => {
        child.stdin.destroy();
        reject(new Error("Watchdog did not become ready"));
      }, 6000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        error ? reject(error) : resolve();
      };
      child.once("error", finish);
      child.once("exit", () =>
        finish(new Error("Watchdog exited before admission")),
      );
      child.stdout.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (!text.includes("\n")) return;
        try {
          const message = JSON.parse(text.split("\n")[0] ?? "");
          if (message.ready === true && message.token === token) finish();
          else finish(new Error("Watchdog returned an invalid identity"));
        } catch {
          finish(new Error("Watchdog returned an invalid handshake"));
        }
      });
    });
    const watchdog = await readJson<ProcessClaim>(runDir, "watchdog.claim");
    if (
      watchdog.token !== token ||
      watchdog.pid !== child.pid ||
      watchdog.groupId !== child.pid
    )
      throw new Error("Watchdog identity does not match the child process");
    child.stdin.write(`${JSON.stringify({ command: "GO", token })}\n`);
    await exited;
  } catch {
    child.stdin.destroy();
    // No terminal state until the lifetime guard and its group have gone.
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 6500)),
    ]);
  } finally {
    clearInterval(heartbeat);
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
    await stateQueue.catch(() => {});
  }
  if (await exists(join(runDir, "watchdog.claim"))) {
    const watchdog = await readJson<ProcessClaim>(runDir, "watchdog.claim");
    for (
      let attempt = 0;
      attempt < 100 && groupExists(watchdog.groupId);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (groupExists(watchdog.groupId)) return; // Unknown lifetime; recovery retains capacity.
  }
  let outcome: Termination | undefined;
  if (await exists(join(runDir, "termination.json")))
    outcome = await readJson<Termination>(runDir, "termination.json");
  if (outcome?.token !== token) outcome = undefined;
  record = await collectOutputs(runDir, {
    ...record,
    status: outcome?.reason ?? "interrupted",
    endedAt: new Date().toISOString(),
    exitCode: outcome?.exitCode,
    logsTruncated: outcome?.logsTruncated,
    ...(outcome?.error ? { error: outcome.error } : {}),
  });
  await atomicJson(join(runDir, "run.json"), record);
}

if (import.meta.main) {
  const [runDir, token] = process.argv.slice(2);
  if (!runDir || !token)
    throw new Error(
      "Supervisor requires an execution directory and identity token",
    );
  await supervise(runDir, token);
}
