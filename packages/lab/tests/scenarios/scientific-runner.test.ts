import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Experiment, Run } from "@/lab/contracts";
import { createRunner, type LocalRunner } from "../support/scientific-runner";

const roots: string[] = [];
const runners: LocalRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) {
    if (runner.runner.lifecycle === "closed") continue;
    for (const run of await runner.allRuns())
      if (run.status === "queued" || run.status === "running") {
        await runner.cancel(run.labId, run.id);
        await runner.waitForRun(run.labId, run.id, 5000);
      }
    await runner.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pico-runner-test-"));
  roots.push(root);
  const changes: Run[] = [];
  const runner = await createRunner({
    dataDir: root,
    pollMs: 40,
    onUpdate: (run) => {
      changes.push(run);
    },
  });
  runners.push(runner);
  const date = new Date().toISOString();
  const experiment: Experiment = {
    id: "experiment-1",
    labId: "lab-1",
    title: "Measure a fixed sample",
    objective: "Measure mean",
    protocol: "Read fixed input, calculate mean, emit metrics",
    questionIds: ["question-1"],
    hypothesisIds: [],
    criteria: [],
    datasetVersionIds: [],
    entrypoint: "main.py",
    runtime: "python",
    status: "ready",
    revision: 1,
    author: { kind: "researcher" },
    createdAt: date,
    updatedAt: date,
  };
  function run(id = "run-1"): Run {
    return {
      id,
      labId: experiment.labId,
      experimentId: experiment.id,
      attempt: 1,
      referenceRunId: null,
      status: "queued",
      target: "local",
      command: "",
      startedAt: null,
      endedAt: null,
      exitCode: null,
      error: null,
      metrics: [],
      artifacts: [],
      snapshot: null,
      revision: 1,
      author: { kind: "researcher" },
      createdAt: date,
      updatedAt: date,
    };
  }
  return { root, runner, experiment, run, changes };
}
const metricProgram = `import json, os\nfrom pathlib import Path\nprint("measured")\nPath(os.environ["PICO_OUTPUT_DIR"], "metrics.json").write_text(json.dumps([{"name":"mean", "value":3.0}]))\n`;

describe("preserved local execution", () => {
  test("experiment processes receive the Pico profile for both new and legacy Pi clients", async () => {
    const f = await fixture();
    await f.runner.writeFile(f.experiment.labId, f.experiment.id, {
      path: "main.py",
      content: `import json, os\nfrom pathlib import Path\nPath(os.environ["PICO_OUTPUT_DIR"], "profile.json").write_text(json.dumps({key: os.environ.get(key) for key in ["PICO_PI_AGENT_DIR", "PI_CODING_AGENT_DIR"]}))\n`,
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
      "succeeded",
    );
    const profile = JSON.parse(
      (
        await f.runner.readRunFile("lab-1", "run-1", "outputs", "profile.json")
      ).toString(),
    );
    // realpath canonicalization may expand /var into /private/var on macOS.
    expect(profile.PICO_PI_AGENT_DIR).toBe(join(await realpath(f.root), "pi"));
    expect(profile.PI_CODING_AGENT_DIR).toBe(profile.PICO_PI_AGENT_DIR);
  });
  test("runs actual Python, collects measured metrics and preserves the executed source", async () => {
    const f = await fixture();
    await f.runner.writeFile(f.experiment.labId, f.experiment.id, {
      path: "main.py",
      content: metricProgram,
    });
    const submitted = await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    expect(submitted.snapshot?.protocol).toBe(f.experiment.protocol);
    const finished = await f.runner.waitForRun("lab-1", "run-1");
    expect(finished.status).toBe("succeeded");
    expect(finished.metrics).toEqual([
      { name: "mean", value: 3, unit: null, split: null, step: null },
    ]);
    expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toContain(
      "measured",
    );
    expect(
      (
        await f.runner.readRunFile("lab-1", "run-1", "code", "main.py")
      ).toString(),
    ).toBe(metricProgram);
    await f.runner.reconcile();
    expect(f.changes.filter((run) => run.status === "succeeded")).toHaveLength(
      1,
    );
  });
  test("reproduction uses preserved code even after the experiment and execution copy are changed", async () => {
    const f = await fixture();
    const source = `${metricProgram}\nPath("main.py").write_text("working copy changed")\n`;
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: source,
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: { config: { seed: 17 } },
    });
    await f.runner.waitForRun("lab-1", "run-1");
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "raise RuntimeError('new experiment code')",
    });
    await f.runner.submit({
      run: { ...f.run("run-2"), referenceRunId: "run-1" },
      experiment: {
        ...f.experiment,
        protocol: "Updated protocol",
        revision: 2,
      },
      datasets: [],
      request: { referenceRunId: "run-1" },
    });
    const reproduction = await f.runner.waitForRun("lab-1", "run-2");
    expect(reproduction.status).toBe("succeeded");
    expect(reproduction.snapshot?.config).toEqual({ seed: 17 });
    expect(reproduction.snapshot?.protocol).toBe(f.experiment.protocol);
    expect(
      (
        await f.runner.readRunFile("lab-1", "run-1", "code", "main.py")
      ).toString(),
    ).toBe(source);
    expect(reproduction.snapshot?.codeHash).toBe(
      (await f.runner.getRun("lab-1", "run-1")).snapshot?.codeHash,
    );
  });
  test("a repeated submission never starts a second process", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: metricProgram,
    });
    const request = {
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    };
    await f.runner.submit(request);
    await f.runner.waitForRun("lab-1", "run-1");
    await f.runner.submit(request);
    expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toBe(
      "measured\n",
    );
    expect(await f.runner.allRuns()).toHaveLength(1);
  });
  test("a failed attempt retains logs and a corrected attempt retains a distinct snapshot", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "raise RuntimeError('intentional failure')",
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe("failed");
    expect((await f.runner.readLogs("lab-1", "run-1")).stderr).toContain(
      "intentional failure",
    );
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: metricProgram,
    });
    await f.runner.submit({
      run: f.run("run-2"),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    expect((await f.runner.waitForRun("lab-1", "run-2")).status).toBe(
      "succeeded",
    );
    expect(
      (await f.runner.getRun("lab-1", "run-1")).snapshot?.codeHash,
    ).not.toBe((await f.runner.getRun("lab-1", "run-2")).snapshot?.codeHash);
  });
});

describe("datasets and file boundaries", () => {
  test("preserves image bytes and text in a versioned dataset and the run input snapshot", async () => {
    const f = await fixture();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 12]);
    const input = {
      name: "Multimodal examples",
      version: "v1",
      source: "Generated fixture",
      license: "CC0",
      files: [
        {
          path: "images/a.png",
          content: image.toString("base64"),
          encoding: "base64" as const,
        },
        {
          path: "examples.json",
          content: '[{"image":"images/a.png","text":"inspect this"}]',
        },
      ],
    };
    const dataset = await f.runner.registerDataset(
      "lab-1",
      "dataset-v1",
      input,
    );
    expect(
      await f.runner.readDatasetFile("lab-1", dataset.id, "images/a.png"),
    ).toEqual(image);
    expect(
      (await f.runner.registerDataset("lab-1", "dataset-v1", input))
        .manifestHash,
    ).toBe(dataset.manifestHash);
    await expect(
      f.runner.registerDataset("lab-1", "dataset-v1", {
        ...input,
        files: [{ path: "examples.json", content: "changed" }],
      }),
    ).rejects.toThrow("immutable");
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content:
        metricProgram +
        '\nprint(Path(os.environ["PICO_INPUTS_DIR"], "dataset-v1/images/a.png").read_bytes().hex())\n',
    });
    await f.runner.submit({
      run: f.run(),
      experiment: { ...f.experiment, datasetVersionIds: [dataset.id] },
      datasets: [dataset],
      request: {},
    });
    const result = await f.runner.waitForRun("lab-1", "run-1");
    expect(result.status).toBe("succeeded");
    expect(result.snapshot?.datasetInputs[0]?.manifestHash).toBe(
      dataset.manifestHash,
    );
    expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toContain(
      image.toString("hex"),
    );
  });
  test("refuses traversal, secrets, symbolic links and oversized sources", async () => {
    const f = await fixture();
    for (const path of [
      "../escape.py",
      "/tmp/escape.py",
      ".env",
      "dir/.env.local",
      "dir/../../file",
    ]) {
      await expect(
        f.runner.writeFile("lab-1", f.experiment.id, { path, content: "x" }),
      ).rejects.toThrow();
    }
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "print('safe')",
    });
    const secret = join(f.root, "private.txt");
    await writeFile(secret, "secret");
    await symlink(
      secret,
      join(f.root, "labs/lab-1/experiments/experiment-1/workspace/link.py"),
    );
    await expect(
      f.runner.readFile("lab-1", f.experiment.id, "link.py"),
    ).rejects.toThrow("Symbolic");
    await expect(f.runner.listFiles("lab-1", f.experiment.id)).rejects.toThrow(
      "Symbolic",
    );
    await expect(
      f.runner.writeFile("lab-1", f.experiment.id, {
        path: "large",
        content: "x".repeat(8 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow("size");
    expect(await readFile(secret, "utf8")).toBe("secret");
  });
  test("does not inherit model API secrets in the experiment environment", async () => {
    const f = await fixture();
    process.env.PICO_RUNNER_TEST_SECRET = "must-not-leak";
    try {
      await f.runner.writeFile("lab-1", f.experiment.id, {
        path: "main.py",
        content:
          'import os\nassert "PICO_RUNNER_TEST_SECRET" not in os.environ\nprint("clean environment")',
      });
      await f.runner.submit({
        run: f.run(),
        experiment: f.experiment,
        datasets: [],
        request: {},
      });
      expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
        "succeeded",
      );
      await expect(
        f.runner.submit({
          run: f.run("run-2"),
          experiment: f.experiment,
          datasets: [],
          request: { config: { api_key: "secret" } },
        }),
      ).rejects.toThrow("Credentials");
    } finally {
      delete process.env.PICO_RUNNER_TEST_SECRET;
    }
  });
});

describe("queue, limits and recovery", () => {
  test("times out an actual process and cancels an active process", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "import time\nprint('started', flush=True)\ntime.sleep(20)",
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: { timeoutSeconds: 0.3 },
    });
    expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
      "timed_out",
    );
    await f.runner.submit({
      run: f.run("run-2"),
      experiment: f.experiment,
      datasets: [],
      request: { timeoutSeconds: 20 },
    });
    for (
      let i = 0;
      i < 100 && (await f.runner.getRun("lab-1", "run-2")).status !== "running";
      i++
    )
      await Bun.sleep(20);
    await f.runner.cancel("lab-1", "run-2");
    expect((await f.runner.waitForRun("lab-1", "run-2")).status).toBe(
      "cancelled",
    );
  });
  test("keeps a second job queued and cancels it without executing code", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "import time\nprint('started', flush=True)\ntime.sleep(1)",
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    await f.runner.submit({
      run: f.run("run-2"),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    await Bun.sleep(150);
    expect((await f.runner.getRun("lab-1", "run-2")).status).toBe("queued");
    await f.runner.cancel("lab-1", "run-2");
    expect((await f.runner.waitForRun("lab-1", "run-2")).status).toBe(
      "cancelled",
    );
    expect((await f.runner.readLogs("lab-1", "run-2")).stdout).toBe("");
    await f.runner.waitForRun("lab-1", "run-1");
  });
  test("a detached supervisor survives runner restart and delivers completion without duplicate execution", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content:
        "import time\nprint('once', flush=True)\ntime.sleep(0.6)\n" +
        metricProgram,
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    for (
      let i = 0;
      i < 100 && (await f.runner.getRun("lab-1", "run-1")).status !== "running";
      i++
    )
      await Bun.sleep(20);
    expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("running");
    await f.runner.close();
    const recovered = await createRunner({ dataDir: f.root, pollMs: 40 });
    runners.push(recovered);
    const finished = await recovered.waitForRun("lab-1", "run-1");
    expect(finished.status).toBe("succeeded");
    expect((await recovered.readLogs("lab-1", "run-1")).stdout).toBe(
      "once\nmeasured\n",
    );
  });
  test("invalid quantitative output cannot be presented as a successful measurement", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content:
        'import os\nfrom pathlib import Path\nPath(os.environ["PICO_OUTPUT_DIR"], "metrics.json").write_text(\'[ {"name":"accuracy", "value":"made up"} ]\')',
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    const finished = await f.runner.waitForRun("lab-1", "run-1");
    expect(finished.status).toBe("failed");
    expect(finished.metrics).toEqual([]);
    expect(finished.error).toContain("finite numeric value");
  });
});

describe("portable run archives and frozen dependencies", () => {
  test("exports bytes and observations, restores a run without executing it, and rejects tampering", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: metricProgram,
    });
    await f.runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    await f.runner.waitForRun("lab-1", "run-1");
    const archive = await f.runner.exportRun("lab-1", "run-1");
    const restored = await fixture();
    const imported = await restored.runner.importRun(archive);
    expect(imported.id).toBe("run-1");
    expect(imported.snapshot?.codeHash).toBe(archive.run.snapshot?.codeHash);
    expect(imported.metrics).toEqual(archive.run.metrics);
    await Bun.sleep(100);
    expect((await restored.runner.readLogs("lab-1", "run-1")).stdout).toBe(
      "measured\n",
    );
    await expect(restored.runner.importRun(archive)).rejects.toThrow(
      "already exists",
    );
    const tampered = structuredClone(archive);
    const source = tampered.execution.files.find(
      (file) => file.path === "snapshot/code/main.py",
    );
    if (!source) throw new Error("Missing source in archive");
    source.content = Buffer.from("print('changed')").toString("base64");
    const other = await fixture();
    await expect(other.runner.importRun(tampered)).rejects.toThrow("integrity");
    expect(await other.runner.allRuns()).toEqual([]);
    expect(await other.runner.files.hasRun("lab-1", "run-1")).toBe(false);
    // Loss after metadata publication is recoverable with the exact same archive.
    await other.runner.files.preserveRun(archive.run);
    const finishing = other.runner.importRun(archive);
    await expect(other.runner.importRun(archive)).rejects.toThrow(
      "already in progress",
    );
    expect((await finishing).id).toBe("run-1");
  });
  test("executes uv from a preserved lock and rejects dependency declarations without a lock", async () => {
    const f = await fixture();
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: metricProgram,
    });
    await f.runner.writeFile("lab-1", f.experiment.id, {
      path: "pyproject.toml",
      content:
        '[project]\nname = "pico-runner-test"\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = []\n',
    });
    const experiment = { ...f.experiment, runtime: "uv" as const };
    await expect(
      f.runner.submit({ run: f.run(), experiment, datasets: [], request: {} }),
    ).rejects.toThrow("uv.lock");
    const lock = await f.runner.lockDependencies("lab-1", f.experiment.id);
    expect(lock.files.some((file) => file.path === "uv.lock")).toBe(true);
    await f.runner.submit({
      run: f.run(),
      experiment,
      datasets: [],
      request: {},
    });
    const finished = await f.runner.waitForRun("lab-1", "run-1");
    expect(finished.status).toBe("succeeded");
    expect(
      finished.snapshot?.codeFiles.some((file) => file.path === "uv.lock"),
    ).toBe(true);
    expect(finished.snapshot?.environment.runtimeVersion).toStartWith("uv ");
  });
  test("a legacy dead worker remains unknown without relaunching the attempt", async () => {
    const f = await fixture();
    await f.runner.close();
    const root = join(f.root, "labs/lab-1/runs/run-1");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "run.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "run-1",
        labId: "lab-1",
        experimentId: "experiment-1",
        status: "running",
        createdAt: new Date().toISOString(),
        snapshotHash: "fixture",
        metrics: [],
        artifacts: [],
        command: ["python3", "main.py"],
      }),
    );
    await writeFile(
      join(root, "worker.claim"),
      JSON.stringify({ pid: 2147483647, createdAt: new Date().toISOString() }),
    );
    // Low-level recovery does not require fabricating scientific metadata for an interrupted worker.
    const { createRunner } = await import("@pico/runner");
    const engine = await createRunner({ dataDir: f.root });
    await engine.start();
    try {
      expect((await engine.getRun("lab-1", "run-1")).status).toBe("running");
      await engine.reconcile();
      expect((await engine.getRun("lab-1", "run-1")).status).toBe("running");
      expect((await engine.inventory()).runs[0]?.state).toBe("unknown");
    } finally {
      await engine.close();
      await rm(root, { recursive: true });
    }
  });
  test("enforces per-lab concurrency even when the global queue allows more workers", async () => {
    const f = await fixture();
    await f.runner.close();
    const runner = await createRunner({
      dataDir: f.root,
      maxConcurrent: 3,
      getLabConcurrency: () => 1,
      pollMs: 30,
    });
    runners.push(runner);
    await runner.writeFile("lab-1", f.experiment.id, {
      path: "main.py",
      content: "import time\ntime.sleep(0.3)",
    });
    await runner.submit({
      run: f.run(),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    await runner.submit({
      run: f.run("run-2"),
      experiment: f.experiment,
      datasets: [],
      request: {},
    });
    await Bun.sleep(100);
    expect((await runner.getRun("lab-1", "run-2")).status).toBe("queued");
    const first = await runner.waitForRun("lab-1", "run-1");
    const second = await runner.waitForRun("lab-1", "run-2");
    expect(
      first.endedAt && second.startedAt && first.endedAt <= second.startedAt,
    ).toBeTruthy();
  });
});

test("stops an execution exceeding output limits and retains bounded readable logs", async () => {
  const f = await fixture();
  await f.runner.writeFile("lab-1", f.experiment.id, {
    path: "main.py",
    content:
      'import os, time\nfrom pathlib import Path\nprint("x" * (2 * 1024 * 1024), flush=True)\nPath(os.environ["PICO_OUTPUT_DIR"], "large.bin").write_bytes(b"x" * (9 * 1024 * 1024))\ntime.sleep(20)\n',
  });
  await f.runner.submit({
    run: f.run(),
    experiment: f.experiment,
    datasets: [],
    request: {},
  });
  const finished = await f.runner.waitForRun("lab-1", "run-1");
  expect(finished.status).toBe("failed");
  expect(finished.error).toMatch(/exceeds|exceed/);
  const logs = await f.runner.readLogs("lab-1", "run-1");
  expect(logs.stdout.length).toBeLessThan(129 * 1024);
  expect(logs.stderr).toContain("Log storage limit reached");
});

test("keeps the scientific snapshot identical through all execution updates and accepts nullable metric dimensions", async () => {
  const f = await fixture();
  await f.runner.writeFile("lab-1", f.experiment.id, {
    path: "main.py",
    content: metricProgram.replace(
      '{"name":"mean", "value":3.0}',
      '{"name":"mean", "value":3.0, "unit":None, "split":None, "step":None}',
    ),
  });
  const queued = await f.runner.submit({
    run: f.run(),
    experiment: f.experiment,
    datasets: [],
    request: {},
  });
  await f.runner.waitForRun("lab-1", "run-1");
  await f.runner.reconcile();
  expect(f.changes.length).toBeGreaterThanOrEqual(2);
  for (const update of f.changes)
    expect(update.snapshot).toEqual(queued.snapshot);
  expect((await f.runner.getRun("lab-1", "run-1")).metrics[0]?.unit).toBeNull();
});

test("rejects a symlinked experiment directory before creating any outside workspace", async () => {
  const f = await fixture();
  await f.runner.writeFile("lab-1", "existing", {
    path: "main.py",
    content: "pass",
  });
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.root, "labs/lab-1/experiments/linked"));
  await expect(
    f.runner.writeFile("lab-1", "linked", { path: "main.py", content: "bad" }),
  ).rejects.toThrow("real directories");
  expect(await readdir(outside)).toEqual([]);
});

test("reproduction cannot bypass a reduced laboratory timeout", async () => {
  const f = await fixture();
  await f.runner.writeFile("lab-1", f.experiment.id, {
    path: "main.py",
    content: "print('measured')",
  });
  await f.runner.submit({
    run: f.run(),
    experiment: f.experiment,
    datasets: [],
    request: { timeoutSeconds: 30 },
  });
  await f.runner.waitForRun("lab-1", "run-1");
  await expect(
    f.runner.submit({
      run: { ...f.run("run-2"), referenceRunId: "run-1" },
      experiment: f.experiment,
      datasets: [],
      request: { referenceRunId: "run-1" },
      timeoutSeconds: 10,
    }),
  ).rejects.toThrow("current laboratory limit");
  expect(await f.runner.allRuns()).toHaveLength(1);
});

test("accepts the maximum public laboratory timeout and concurrency settings", async () => {
  const f = await fixture();
  await f.runner.close();
  const runner = await createRunner({
    dataDir: f.root,
    maxConcurrent: 16,
    getLabConcurrency: () => 16,
  });
  runners.push(runner);
  await runner.writeFile("lab-1", f.experiment.id, {
    path: "main.py",
    content: "print('within public limits')",
  });
  await runner.submit({
    run: f.run(),
    experiment: f.experiment,
    datasets: [],
    request: {},
    timeoutSeconds: 86_400,
  });
  expect((await runner.waitForRun("lab-1", "run-1")).status).toBe("succeeded");
});
