import { afterEach, expect, test } from "bun:test";
import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createRunner,
  fileAccess,
  localRunnerCapabilities,
} from "@pico/runner";
import {
  cleanup,
  eventually,
  fixture,
  metricProgram,
  resources,
} from "./support";

afterEach(cleanup);

test("startup diagnoses damaged records and repair preserves bytes without inventing success", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  await f.runner.close();
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  const damaged = '{"schemaVersion": 1, truncated';
  await writeFile(join(directory, "run.json"), damaged);
  const runner = createRunner({ dataDir: f.root });
  resources.push({ root: f.root, runner });
  await runner.start();
  expect(runner.lifecycle).toBe("active");
  expect((await runner.inventory()).issues[0]?.kind).toBe("unreadable_record");
  expect((await runner.inventory()).safeToBackup).toBe(false);
  const repaired = await runner.repairExecution("lab-1", "run-1");
  expect(repaired.state).toBe("terminal");
  expect(repaired.record.status).toBe("interrupted");
  expect(repaired.record.metrics).toEqual([]);
  const preserved = (await readdir(directory)).find((name) =>
    name.startsWith("run.corrupt-"),
  );
  expect(preserved).toBeDefined();
  expect(
    (await fileAccess.readBytes(directory, preserved ?? "missing")).toString(),
  ).toBe(damaged);
  expect((await runner.inventory()).safeToBackup).toBe(true);
});

test("repair refuses damaged records with unresolved claims and blocks unrelated dispatch", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  await f.runner.submit(f.request("run-2"), f.sources);
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  await writeFile(join(directory, "run.json"), "broken");
  await fileAccess.atomicJson(join(directory, "worker.claim"), {
    pid: process.pid,
  });
  await f.runner.resumeDispatch();
  expect((await f.runner.getRun("lab-1", "run-2")).status).toBe("queued");
  await expect(f.runner.repairExecution("lab-1", "run-1")).rejects.toThrow(
    "cannot prove termination",
  );
  expect((await fileAccess.readBytes(directory, "run.json")).toString()).toBe(
    "broken",
  );
  expect((await f.runner.inventory()).safeToBackup).toBe(false);
});

test("unreadable snapshots are diagnosed independently of valid operational records", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  await writeFile(
    join(f.root, "labs/lab-1/runs/run-1/snapshot/manifest.json"),
    "broken",
  );
  await f.runner.resumeDispatch();
  expect((await f.runner.inventory()).issues[0]?.kind).toBe(
    "unreadable_snapshot",
  );
  expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("queued");
  await expect(f.runner.repairExecution("lab-1", "run-1")).rejects.toThrow();
});

test("explicit repair resolves an orphaned dispatch only after its recorded supervisor is gone", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  await fileAccess.atomicJson(join(directory, "dispatch.json"), {
    token: "reserved",
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
  await expect(f.runner.repairExecution("lab-1", "run-1")).rejects.toThrow(
    "no proof",
  );
  await fileAccess.atomicJson(join(directory, "dispatch.json"), {
    token: "reserved",
    pid: 99999999,
    createdAt: new Date().toISOString(),
  });
  expect((await f.runner.inventory()).runs[0]?.state).toBe("unknown");
  const repaired = await f.runner.repairExecution("lab-1", "run-1");
  expect(repaired.state).toBe("terminal");
  expect(repaired.record.status).toBe("interrupted");
  expect((await f.runner.inventory()).safeToBackup).toBe(true);
});

test("a syntactically valid but incomplete process claim never certifies termination", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  await fileAccess.atomicJson(join(directory, "worker.claim"), {
    version: 1,
    token: "partial",
    started: "unverified",
    groupId: 99999999,
    createdAt: new Date().toISOString(),
  });
  expect((await f.runner.inventory()).runs[0]?.state).toBe("unknown");
  await expect(f.runner.repairExecution("lab-1", "run-1")).rejects.toThrow(
    "cannot prove termination",
  );
  await expect(f.runner.cleanupWork("lab-1", "run-1")).rejects.toThrow(
    "confirmed execution termination",
  );
});

test("an admitted execution without control files remains unknown after an operator repair request", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  const queued = await f.runner.submit(f.request(), f.sources);
  await fileAccess.atomicJson(join(f.root, "labs/lab-1/runs/run-1/run.json"), {
    ...queued,
    status: "running",
    startedAt: new Date().toISOString(),
  });
  await expect(f.runner.repairExecution("lab-1", "run-1")).rejects.toThrow(
    "lost its supervisor identity",
  );
  expect((await f.runner.inventory()).runs[0]?.state).toBe("unknown");
  expect((await f.runner.getRun("lab-1", "run-1")).status).toBe("running");
});

test("orphaned staging is preserved with hashes while anomalous process evidence still blocks", async () => {
  const f = await fixture();
  await f.runner.close();
  const pending = join(f.root, "labs/lab-1/runs/run-1.pending-old");
  await mkdir(pending, { recursive: true });
  await writeFile(join(pending, "run.json"), "partial bytes");
  const runner = createRunner({ dataDir: f.root });
  resources.push({ root: f.root, runner });
  await runner.start();
  const inventory = await runner.inventory();
  expect(inventory.pendingPublications).toEqual([]);
  expect(inventory.safeToBackup).toBe(true);
  const destination = inventory.recoveredPublications[0] ?? "missing";
  expect(
    (await fileAccess.readBytes(f.root, `${destination}/run.json`)).toString(),
  ).toBe("partial bytes");
  const receipt = await fileAccess.readJson<{
    metadataHashes: Record<string, string>;
  }>(f.root, `${destination}.recovery.json`);
  expect(receipt.metadataHashes["run.json"]).toBe(
    fileAccess.digest("partial bytes"),
  );
  await runner.close();
  await mkdir(pending, { recursive: true });
  await fileAccess.atomicJson(join(pending, "worker.claim"), {
    pid: process.pid,
  });
  const blocked = createRunner({ dataDir: f.root });
  resources.push({ root: f.root, runner: blocked });
  await blocked.start();
  expect((await blocked.inventory()).issues[0]?.kind).toBe(
    "unsafe_publication",
  );
  expect((await blocked.inventory()).safeToBackup).toBe(false);
  expect(await fileAccess.exists(join(pending, "worker.claim"))).toBe(true);
});

test("TERM permits final observations and terminal cleanup retains snapshots and outputs", async () => {
  const f = await fixture();
  await f.write(
    'import os,signal,time\nfrom pathlib import Path\nout=Path(os.environ["PICO_OUTPUT_DIR"])\ndef stop(*args):\n (out/"shutdown.txt").write_text("flushed")\n raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\n(out/"ready").write_text("ready")\nwhile True: time.sleep(0.01)',
  );
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  const directory = join(f.root, "labs/lab-1/runs/run-1");
  await eventually(
    () => fileAccess.exists(join(directory, "outputs/ready")),
    Boolean,
  );
  await expect(f.runner.cleanupWork("lab-1", "run-1")).rejects.toThrow(
    "confirmed execution termination",
  );
  await f.runner.cancel("lab-1", "run-1");
  expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
    "cancelled",
  );
  expect(
    (
      await f.runner.readRunFile("lab-1", "run-1", "outputs", "shutdown.txt")
    ).toString(),
  ).toBe("flushed");
  await eventually(
    () => fileAccess.exists(join(directory, "work")),
    (present) => !present,
  );
  expect(
    await fileAccess.exists(join(directory, "snapshot/code/main.py")),
  ).toBe(true);
});

test("configured datasets stream beyond default tree limits and execution cannot mutate the snapshot", async () => {
  const limits = {
    maxFileBytes: 140 * 1024 * 1024,
    maxTreeBytes: 140 * 1024 * 1024,
    maxFiles: 10,
  };
  const f = await fixture({ datasetLimits: limits });
  const filesDir = join(f.root, "large-input");
  await mkdir(filesDir);
  const large = await open(join(filesDir, "large.bin"), "wx");
  await large.truncate(129 * 1024 * 1024);
  await large.close();
  await expect(fileAccess.listFiles(filesDir)).rejects.toThrow("exceeds");
  const files = await fileAccess.listFiles(filesDir, limits);
  expect(files[0]?.bytes).toBe(129 * 1024 * 1024);
  f.sources.datasets = [
    {
      filesDir,
      manifest: {
        schemaVersion: 1,
        labId: "lab-1",
        id: "large",
        name: "large",
        source: "local",
        license: "test",
        createdAt: new Date().toISOString(),
        files,
        sha256: fileAccess.digest(JSON.stringify(files)),
      },
    },
  ];
  await f.write(
    'import os\nfrom pathlib import Path\np=Path(os.environ["PICO_INPUTS_DIR"],"large","large.bin")\nwith p.open("r+b") as f: f.write(b"changed")\nprint(p.stat().st_size)',
  );
  await f.runner.submit(
    f.request("run-1", { datasetIds: ["large"] }),
    f.sources,
  );
  await f.runner.resumeDispatch();
  expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
    "succeeded",
  );
  const preserved = await fileAccess.hashFile(
    join(f.root, "labs/lab-1/runs/run-1/snapshot/inputs/large"),
    "large.bin",
    limits.maxFileBytes,
  );
  expect([preserved]).toEqual(files);
  await expect(f.runner.exportRun("lab-1", "run-1")).rejects.toThrow(
    "full research backup",
  );
}, 15000);

test("bindings are resolved independently from each preserved request", async () => {
  const f = await fixture({
    environmentBindings: (request): Record<string, string> =>
      request.config.allowed === true ? { PICO_TEST_PROFILE: "selected" } : {},
  });
  await f.write(
    'import os\nprint(os.environ.get("PICO_TEST_PROFILE", "none"))',
  );
  await f.runner.submit(f.request(), f.sources);
  await f.runner.submit(
    f.request("run-2", { config: { allowed: true } }),
    f.sources,
  );
  await f.runner.resumeDispatch();
  await f.runner.waitForRun("lab-1", "run-1");
  await f.runner.waitForRun("lab-1", "run-2");
  expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toBe("none\n");
  expect((await f.runner.readLogs("lab-1", "run-2")).stdout).toBe("selected\n");
});

test("local resource capabilities reject unsupported limits and disclose their scope", async () => {
  const f = await fixture();
  await f.write('import os\nprint(os.environ.get("CUDA_VISIBLE_DEVICES"))');
  expect(localRunnerCapabilities().sandbox).toBe(false);
  if (process.platform !== "linux") {
    expect(localRunnerCapabilities().memoryLimit).toBeNull();
    await expect(
      f.runner.submit(
        f.request("run-1", { resources: { memoryMiB: 128 } }),
        f.sources,
      ),
    ).rejects.toThrow("Linux backend");
  } else {
    expect(localRunnerCapabilities().memoryLimit).toBe("address-space");
    await f.runner.submit(
      f.request("run-1", { resources: { memoryMiB: 128, gpuDevices: ["1"] } }),
      f.sources,
    );
    await f.runner.resumeDispatch();
    expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
      "succeeded",
    );
    expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toBe("1\n");
  }
});

(process.platform === "linux" ? test : test.skip)(
  "Linux address-space limits reject oversized allocations and are inherited by Python children",
  async () => {
    const f = await fixture();
    await f.write(
      [
        "import json,resource,subprocess,sys",
        "limit=resource.getrlimit(resource.RLIMIT_AS)",
        'child=json.loads(subprocess.check_output([sys.executable,"-c","import json,resource; print(json.dumps(resource.getrlimit(resource.RLIMIT_AS)))"]))',
        "rejected=False",
        "try:",
        "    oversized=bytearray(256*1024*1024)",
        "except MemoryError:",
        "    rejected=True",
        'print(json.dumps({"parent":limit,"child":child,"allocationRejected":rejected}))',
      ].join("\n"),
    );
    await f.runner.submit(
      f.request("run-1", { resources: { memoryMiB: 128 } }),
      f.sources,
    );
    await f.runner.resumeDispatch();
    expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
      "succeeded",
    );
    expect(
      JSON.parse((await f.runner.readLogs("lab-1", "run-1")).stdout),
    ).toEqual({
      parent: [128 * 1024 * 1024, 128 * 1024 * 1024],
      child: [128 * 1024 * 1024, 128 * 1024 * 1024],
      allocationRejected: true,
    });
  },
);
