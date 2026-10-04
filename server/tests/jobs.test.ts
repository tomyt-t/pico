import type { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../src/db";
import {
  type Job,
  Jobs,
  jobNotification,
  parseMetrics,
  processAlive,
  resolveMetricsPath,
} from "../src/jobs";
import { type Sandbox, sandbox, until } from "./support";

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
});

test("parseMetrics accepts lists and flat objects", () => {
  expect(
    parseMetrics([
      { name: "acc", value: 0.5, split: "test" },
      { name: "loss", value: "0.25", step: 3 },
      { name: "bad", value: "x" },
      { value: 1 },
    ]),
  ).toEqual([
    { name: "acc", value: 0.5, split: "test" },
    { name: "loss", value: 0.25, step: 3 },
  ]);
  expect(
    parseMetrics({
      acc: 0.5,
      f1: { value: 0.7, unit: "fraction" },
      note: "text",
    }),
  ).toEqual([
    { name: "acc", value: 0.5 },
    { name: "f1", value: 0.7, unit: "fraction" },
  ]);
  expect(parseMetrics("nope")).toEqual([]);
});

test("a metrics path written from the lab root is not doubled under the job's folder", () => {
  // Absolute folders on this system ("C:\labs\a" on Windows).
  const lab = resolve("/labs/a");
  const cwd = join(lab, "experiments", "11");
  const metrics = join(cwd, "metrics.json");
  expect(resolveMetricsPath(lab, cwd, "experiments/11/metrics.json")).toBe(
    metrics,
  );
  expect(resolveMetricsPath(lab, cwd, "experiments/11/runs/m.json")).toBe(
    join(cwd, "runs", "m.json"),
  );
  expect(resolveMetricsPath(lab, cwd, "metrics.json")).toBe(metrics);
  expect(resolveMetricsPath(lab, cwd, "out/metrics.json")).toBe(
    join(cwd, "out", "metrics.json"),
  );
  expect(resolveMetricsPath(lab, cwd)).toBe(metrics);
  expect(resolveMetricsPath(lab, lab, "experiments/11/metrics.json")).toBe(
    metrics,
  );
  expect(resolveMetricsPath(lab, cwd, "/tmp/metrics.json")).toBe(
    "/tmp/metrics.json",
  );
});

test("a job runs detached, records its outcome, metrics and log, and notifies once", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Jobs" });
  const finished: Job[] = [];
  const db: Database = openDatabase(":memory:");
  db.run(
    "INSERT INTO labs (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [lab.id, lab.name, lab.path, lab.createdAt, lab.updatedAt],
  );
  const jobs = new Jobs(db, {
    onFinished: (job) => void finished.push(job),
    pollMs: 50,
  });
  jobs.startPolling();
  try {
    const job = await jobs.start(lab, {
      command:
        'echo hello; printf \'[{"name":"acc","value":0.5}]\' > metrics.json; echo "$PICO_JOB_ID"',
      name: "demo",
    });
    expect(job.status).toBe("running");
    expect(job.commitHash).toMatch(/^[0-9a-f]{40}$/);
    await until(
      () => jobs.get(lab.id, job.id).status !== "running",
      10_000,
      "job to finish",
    );
    const done = jobs.get(lab.id, job.id);
    expect(done.status).toBe("succeeded");
    expect(done.exitCode).toBe(0);
    expect(done.metrics).toEqual([{ name: "acc", value: 0.5 }]);
    expect(readFileSync(done.logPath, "utf8")).toContain(`hello\n${job.id}`);
    await until(() => jobs.get(lab.id, job.id).notified, 5_000, "notification");
    await Bun.sleep(150);
    expect(finished).toHaveLength(1);
    const message = await jobNotification(done);
    expect(message).toContain(`(${job.id}) finished: succeeded (exit code 0)`);
    expect(message).toContain('"acc"');
    expect(message).toContain("hello");

    const failing = await jobs.start(lab, { command: "echo oops >&2; exit 3" });
    await until(
      () => jobs.get(lab.id, failing.id).status !== "running",
      10_000,
      "failing job",
    );
    expect(jobs.get(lab.id, failing.id)).toMatchObject({
      status: "failed",
      exitCode: 3,
    });

    const sleeping = await jobs.start(lab, { command: "sleep 30" });
    await Bun.sleep(100);
    const stopped = await jobs.stop(lab.id, sleeping.id, { notify: false });
    expect(stopped.status).toBe("stopped");
    expect(stopped.notified).toBe(true);
    if (sleeping.pid !== null)
      await until(
        () => !processAlive(sleeping.pid as number),
        8_000,
        "process to die",
      );
    await expect(jobs.stop(lab.id, sleeping.id)).rejects.toThrow("is stopped");
    expect(jobs.list(lab.id).map((item) => item.id)).toEqual([
      sleeping.id,
      failing.id,
      job.id,
    ]);
    expect(jobs.list(lab.id, "succeeded")).toHaveLength(1);
  } finally {
    jobs.stopPolling();
    db.close();
  }
});

test("a job that fails before running is rejected with a clear error", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Bad jobs" });
  await expect(app.jobs.start(lab, { command: "   " })).rejects.toThrow(
    "command is required",
  );
  await expect(
    app.jobs.start(lab, { command: "true", cwd: "missing" }),
  ).rejects.toThrow("cwd does not exist");
});
