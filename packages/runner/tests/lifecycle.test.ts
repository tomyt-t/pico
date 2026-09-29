import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createRunner, fileAccess } from "@pico/runner";
import {
  cleanup,
  eventually,
  fixture,
  metricProgram,
  resources,
} from "./support";

afterEach(cleanup);

test("create is pure, start and close are shared, and a captured method cannot bypass close", async () => {
  const f = await fixture();
  const dataDir = join(f.root, "not-created");
  const runner = createRunner({ dataDir });
  resources.push({ root: f.root, runner });
  expect(await fileAccess.exists(dataDir)).toBe(false);
  const first = runner.start();
  expect(runner.start()).toBe(first);
  const closing = runner.close();
  expect(runner.close()).toBe(closing);
  await closing;
  expect(runner.lifecycle).toBe("closed");
  await expect(runner.start()).rejects.toThrow("closed");
  const submit = f.runner.submit.bind(f.runner);
  await f.runner.close();
  expect(() => submit(f.request(), f.sources)).toThrow("closed");
});

test("publication survives a failed projection and start never dispatches before links reconcile", async () => {
  let rejectProjection = true;
  const f = await fixture({
    onUpdate: () => {
      if (rejectProjection) throw new Error("SQLite temporarily unavailable");
    },
  });
  await f.write(metricProgram);
  const record = await f.runner.submit(f.request(), f.sources);
  expect(record.status).toBe("queued");
  await f.runner.resumeDispatch();
  expect((await f.runner.inventory()).pendingDeliveries).toEqual([
    "lab-1:run-1",
  ]);
  expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("queued");
  await f.runner.close();
  rejectProjection = false;
  const delivered: string[] = [];
  const recovered = createRunner({
    dataDir: f.root,
    pollMs: 30,
    onUpdate: (run) => {
      delivered.push(run.id);
    },
  });
  resources.push({ root: f.root, runner: recovered });
  await recovered.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await recovered.getRun("lab-1", "run-1")).status).toBe("queued");
  expect(delivered).toContain("run-1");
  await recovered.resumeDispatch();
  expect((await recovered.waitForRun("lab-1", "run-1")).status).toBe(
    "succeeded",
  );
  expect(await recovered.allRuns()).toHaveLength(1);
  await recovered.pauseDispatch();
  expect((await recovered.inventory()).safeToBackup).toBe(true);
});

test("environment bindings are transient and unrelated server credentials are not inherited", async () => {
  process.env.PICO_RUNNER_TEST_SECRET = "must-never-enter-the-experiment";
  try {
    const f = await fixture({
      environmentBindings: { PICO_TEST_PROFILE: "/isolated/profile-reference" },
    });
    await f.write(
      'import json, os\nprint(json.dumps({"profile": os.environ.get("PICO_TEST_PROFILE"), "secret": os.environ.get("PICO_RUNNER_TEST_SECRET")}))',
    );
    await f.runner.submit(f.request(), f.sources);
    await f.runner.resumeDispatch();
    await f.runner.waitForRun("lab-1", "run-1");
    expect(
      JSON.parse((await f.runner.readLogs("lab-1", "run-1")).stdout),
    ).toEqual({ profile: "/isolated/profile-reference", secret: null });
    expect(
      JSON.stringify(await f.runner.getSnapshot("lab-1", "run-1")),
    ).not.toContain("isolated/profile-reference");
  } finally {
    delete process.env.PICO_RUNNER_TEST_SECRET;
  }
});

test("queued cancellation never starts a process and running cancellation ends its group", async () => {
  const f = await fixture();
  await f.write("import time\ntime.sleep(20)");
  await f.runner.submit(f.request(), f.sources);
  expect((await f.runner.cancel("lab-1", "run-1")).status).toBe("cancelled");
  expect(
    await fileAccess.exists(join(f.root, "labs/lab-1/runs/run-1/worker.claim")),
  ).toBe(false);
  await f.runner.submit(f.request("run-2"), f.sources);
  await f.runner.resumeDispatch();
  await eventually(
    () => f.runner.getRun("lab-1", "run-2"),
    (run) => run.status === "running",
  );
  await f.runner.cancel("lab-1", "run-2");
  expect((await f.runner.waitForRun("lab-1", "run-2")).status).toBe(
    "cancelled",
  );
});

test("per-laboratory concurrency is enforced alongside the global queue", async () => {
  const f = await fixture({ maxConcurrent: 4, getLabConcurrency: () => 1 });
  await f.write("import time\ntime.sleep(0.35)");
  await f.runner.submit(f.request(), f.sources);
  await f.runner.submit(f.request("run-2"), f.sources);
  await f.runner.resumeDispatch();
  await eventually(
    () => f.runner.getRun("lab-1", "run-1"),
    (run) => run.status === "running",
  );
  expect((await f.runner.getRun("lab-1", "run-2")).status).toBe("queued");
  const first = await f.runner.waitForRun("lab-1", "run-1");
  const second = await f.runner.waitForRun("lab-1", "run-2");
  expect(Date.parse(second.startedAt ?? "")).toBeGreaterThanOrEqual(
    Date.parse(first.endedAt ?? ""),
  );
});

test("invalid quantitative outputs become a failed operational attempt", async () => {
  const f = await fixture();
  await f.write(
    'import os\nfrom pathlib import Path\nPath(os.environ["PICO_OUTPUT_DIR"],"metrics.json").write_text(\'[ {"name":"accuracy","value":"invented"} ]\')',
  );
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  const run = await f.runner.waitForRun("lab-1", "run-1");
  expect(run.status).toBe("failed");
  expect(run.error).toContain("Invalid experiment output");
  expect(run.metrics).toEqual([]);
});
