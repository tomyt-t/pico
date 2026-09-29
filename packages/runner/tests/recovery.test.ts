import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createRunner, fileAccess } from "@pico/runner";
import { groupExists, processArguments } from "@/runner/processes";
import { cleanup, eventually, fixture, resources } from "./support";

afterEach(cleanup);
const delayed =
  'import os, time\nfrom pathlib import Path\nout=Path(os.environ["PICO_OUTPUT_DIR"])\n(out/"started").write_text(str(os.getpid()))\ntime.sleep(1.1)\n(out/"late").write_text("should not exist after interruption")\n';

test("legacy interrupted records do not certify that orphaned descendants ended", async () => {
  const f = await fixture();
  await f.write(delayed);
  const record = await f.runner.submit(f.request(), f.sources);
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  const legacy = {
    ...record,
    status: "interrupted" as const,
    endedAt: new Date().toISOString(),
    error: "Supervisor stopped before recording completion.",
  };
  await fileAccess.atomicJson(join(directory, "run.json"), legacy);
  await fileAccess.atomicJson(join(directory, "worker.claim"), {
    pid: 99999999,
    createdAt: record.createdAt,
  });
  const inventory = await f.runner.inventory();
  expect(inventory.runs[0]?.state).toBe("unknown");
  expect(inventory.safeToBackup).toBe(false);
  expect(await f.runner.getRun("lab-1", "run-1")).toEqual(legacy);
  await expect(f.runner.exportRun("lab-1", "run-1")).rejects.toThrow(
    "termination is not confirmed",
  );
});

test("SIGKILL of the supervisor with the coordinator closed kills the experimental group", async () => {
  const f = await fixture();
  await f.write(delayed);
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  const runDir = join(f.root, "labs/lab-1/runs/run-1");
  await eventually(
    () => fileAccess.exists(join(runDir, "outputs/started")),
    Boolean,
  );
  const worker = await fileAccess.readJson<{ pid: number }>(
    runDir,
    "worker.claim",
  );
  const guard = await fileAccess.readJson<{ groupId: number }>(
    runDir,
    "watchdog.claim",
  );
  await f.runner.close();
  process.kill(worker.pid, "SIGKILL");
  await eventually(
    async () => groupExists(guard.groupId),
    (alive) => !alive,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(await fileAccess.exists(join(runDir, "outputs/late"))).toBe(false);
  const reopened = createRunner({ dataDir: f.root, pollMs: 30 });
  resources.push({ root: f.root, runner: reopened });
  await reopened.start();
  expect((await reopened.getRun("lab-1", "run-1")).status).toBe("interrupted");
  expect((await reopened.inventory()).safeToBackup).toBe(true);
  await reopened.resumeDispatch();
  expect(await reopened.allRuns()).toHaveLength(1);
});

test("timeout survives a closed coordinator and descendants cannot retain its process group", async () => {
  const f = await fixture();
  await f.write(delayed);
  await f.runner.submit(f.request("run-1", { timeoutMs: 250 }), f.sources);
  await f.runner.resumeDispatch();
  const runDir = join(f.root, "labs/lab-1/runs/run-1");
  await eventually(
    () => fileAccess.exists(join(runDir, "outputs/started")),
    Boolean,
  );
  const guard = await fileAccess.readJson<{ groupId: number }>(
    runDir,
    "watchdog.claim",
  );
  await f.runner.close();
  await eventually(
    async () => groupExists(guard.groupId),
    (alive) => !alive,
  );
  const record = await eventually(
    () => fileAccess.readJson<{ status: string }>(runDir, "run.json"),
    (run) => run.status === "timed_out",
  );
  expect(record.status).toBe("timed_out");
  expect(await fileAccess.exists(join(runDir, "outputs/late"))).toBe(false);
});

test("normal completion kills remaining descendants before publishing terminal state", async () => {
  const f = await fixture();
  await f.write(
    'import subprocess, sys\nsubprocess.Popen([sys.executable,"-c","import time; time.sleep(20)"])\nprint("parent done")\n',
  );
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
    "succeeded",
  );
  const claim = await fileAccess.readJson<{ groupId: number }>(
    join(f.root, "labs/lab-1/runs/run-1"),
    "watchdog.claim",
  );
  expect(groupExists(claim.groupId)).toBe(false);
});

test("legacy or mismatched identity remains unknown and blocks dispatch and backup", async () => {
  const f = await fixture();
  await f.write('print("never dispatch around an ambiguous owner")');
  await f.runner.submit(f.request(), f.sources);
  await f.runner.submit(f.request("run-2"), f.sources);
  await fileAccess.atomicJson(
    join(f.root, "labs/lab-1/runs/run-1/worker.claim"),
    { pid: process.pid, createdAt: new Date().toISOString() },
  );
  await f.runner.resumeDispatch();
  const inventory = await f.runner.inventory();
  expect(inventory.runs.find((run) => run.record.id === "run-1")?.state).toBe(
    "unknown",
  );
  expect(inventory.safeToBackup).toBe(false);
  expect((await f.runner.getRun("lab-1", "run-2")).status).toBe("queued");
});

test("restart adopts an existing supervisor without starting the attempt twice", async () => {
  const f = await fixture();
  await f.write('import time\nprint("once", flush=True)\ntime.sleep(0.25)\n');
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  await eventually(
    () => f.runner.getRun("lab-1", "run-1"),
    (run) => run.status === "running",
  );
  await f.runner.close();
  const reopened = createRunner({ dataDir: f.root, pollMs: 30 });
  resources.push({ root: f.root, runner: reopened });
  await reopened.start();
  await reopened.resumeDispatch();
  expect((await reopened.waitForRun("lab-1", "run-1")).status).toBe(
    "succeeded",
  );
  expect((await reopened.readLogs("lab-1", "run-1")).stdout).toBe("once\n");
});

test("the watchdog cannot start Python before GO and EOF before GO leaves no experimental output", async () => {
  const f = await fixture();
  await f.write(delayed);
  await f.runner.submit(f.request(), f.sources);
  const runDir = join(f.root, "labs/lab-1/runs/run-1");
  const token = randomUUID();
  const guard = spawn(
    process.execPath,
    processArguments("watchdog", runDir, token),
    { cwd: f.root, detached: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  const exited = new Promise<void>((resolve) =>
    guard.once("exit", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    guard.once("error", reject);
    guard.stdout.once("data", () => resolve());
    guard.once("exit", () => reject(new Error("Guard exited before READY")));
  });
  expect(await fileAccess.exists(join(runDir, "outputs/started"))).toBe(false);
  guard.stdin.end();
  await exited;
  expect(await fileAccess.exists(join(runDir, "outputs/started"))).toBe(false);
  expect(groupExists(guard.pid ?? 0)).toBe(false);
});

test("isolated watchdog death is explicitly unknown until its remaining group ends", async () => {
  const f = await fixture();
  await f.write(
    'import os,time\nfrom pathlib import Path\nPath(os.environ["PICO_OUTPUT_DIR"],"started").write_text("ready")\ntime.sleep(20)',
  );
  await f.runner.submit(f.request("run-1", { timeoutMs: 30000 }), f.sources);
  await f.runner.resumeDispatch();
  const runDir = join(f.root, "labs/lab-1/runs/run-1");
  await eventually(
    () => fileAccess.exists(join(runDir, "outputs/started")),
    Boolean,
  );
  const guard = await fileAccess.readJson<{ pid: number; groupId: number }>(
    runDir,
    "watchdog.claim",
  );
  try {
    process.kill(guard.pid, "SIGKILL");
    const inventory = await eventually(
      () => f.runner.inventory(),
      (value) => value.runs.some((run) => run.state === "unknown"),
    );
    expect(inventory.safeToBackup).toBe(false);
    expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("running");
  } finally {
    // Test-owned group, whose original Python child is deliberately still present.
    if (groupExists(guard.groupId)) process.kill(-guard.groupId, "SIGKILL");
    await eventually(
      async () => groupExists(guard.groupId),
      (alive) => !alive,
    );
  }
  await f.runner.reconcile();
  expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("interrupted");
});
