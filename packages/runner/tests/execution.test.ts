import { afterEach, expect, test } from "bun:test";
import { createRunner } from "@pico/runner";
import { cleanup, fixture, metricProgram, resources } from "./support";

afterEach(cleanup);

test("runs real Python after explicit dispatch and preserves exact observations", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  const queued = await f.runner.submit(f.request(), f.sources);
  expect(queued.status).toBe("queued");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("queued");
  await f.runner.resumeDispatch();
  const run = await f.runner.waitForRun("lab-1", "run-1");
  expect(run.status).toBe("succeeded");
  expect(run.metrics).toEqual([{ name: "mean", value: 3 }]);
  expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toContain(
    "measured",
  );
  expect(
    (
      await f.runner.readRunFile("lab-1", "run-1", "code", "main.py")
    ).toString(),
  ).toBe(metricProgram);
});

test("a root has one coordinator and closing releases authority", async () => {
  const f = await fixture();
  const contender = createRunner({ dataDir: f.root });
  await expect(contender.start()).rejects.toThrow(
    "Another execution coordinator",
  );
  await f.runner.close();
  const next = createRunner({ dataDir: f.root });
  resources.push({ root: f.root, runner: next });
  await next.start();
  expect(next.lifecycle).toBe("active");
});
