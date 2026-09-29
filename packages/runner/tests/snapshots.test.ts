import { afterEach, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { type DatasetManifest, fileAccess } from "@pico/runner";
import { cleanup, fixture, metricProgram } from "./support";

afterEach(cleanup);

test("concurrent retries publish one immutable attempt and changed intent is rejected", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  const [a, b] = await Promise.all([
    f.runner.submit(f.request(), f.sources),
    f.runner.submit(f.request(), f.sources),
  ]);
  expect(a.snapshotHash).toBe(b.snapshotHash);
  expect(await f.runner.allRuns()).toHaveLength(1);
  await f.runner.resumeDispatch();
  await f.runner.waitForRun("lab-1", "run-1");
  await f.write('print("changed workspace")');
  expect((await f.runner.submit(f.request(), f.sources)).snapshotHash).toBe(
    a.snapshotHash,
  );
  await expect(
    f.runner.submit(f.request("run-1", { config: { seed: 18 } }), f.sources),
  ).rejects.toThrow("another request");
  expect((await f.runner.readLogs("lab-1", "run-1")).stdout).toBe("measured\n");
});

test("reproduction copies preserved inputs and source after the workspace changes", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.runner.submit(f.request(), f.sources);
  await f.runner.resumeDispatch();
  await f.runner.waitForRun("lab-1", "run-1");
  await f.write('raise Exception("new code must not be reproduced")');
  await f.runner.reproduce("lab-1", "run-1", "run-2");
  expect((await f.runner.waitForRun("lab-1", "run-2")).status).toBe(
    "succeeded",
  );
  const [original, reproduced] = await Promise.all([
    f.runner.getSnapshot("lab-1", "run-1"),
    f.runner.getSnapshot("lab-1", "run-2"),
  ]);
  expect(reproduced.code).toEqual(original.code);
  expect(reproduced.request.config).toEqual(original.request.config);
  expect(reproduced.request.referenceRunId).toBe("run-1");
});

test("dataset bytes and provenance survive snapshots without publishing a dataset", async () => {
  const f = await fixture();
  const filesDir = join(f.root, "supplied-dataset");
  await mkdir(filesDir);
  const bytes = Buffer.from([0, 255, 24, 50]);
  await fileAccess.writeBytes(filesDir, "image.bin", bytes);
  const manifest: DatasetManifest = {
    schemaVersion: 1,
    labId: "lab-1",
    id: "dataset-1",
    name: "image",
    source: "fixture",
    license: "unknown",
    createdAt: "2026-01-01T00:00:00Z",
    files: await fileAccess.listFiles(filesDir),
    sha256: "historical-provenance-hash",
  };
  await f.write(
    'import os\nfrom pathlib import Path\nprint(Path(os.environ["PICO_INPUTS_DIR"],"dataset-1/image.bin").read_bytes().hex())',
  );
  await f.runner.submit(f.request("run-1", { datasetIds: [manifest.id] }), {
    ...f.sources,
    datasets: [{ manifest, filesDir }],
  });
  await f.runner.resumeDispatch();
  await f.runner.waitForRun("lab-1", "run-1");
  expect((await f.runner.readLogs("lab-1", "run-1")).stdout.trim()).toBe(
    bytes.toString("hex"),
  );
  expect((await f.runner.getSnapshot("lab-1", "run-1")).datasets).toEqual([
    manifest,
  ]);
  expect(await fileAccess.exists(join(f.root, "labs/lab-1/datasets"))).toBe(
    false,
  );
});

test("archives validate exact bytes and import never executes or rewrites the v1 snapshot", async () => {
  const original = await fixture();
  await original.write(metricProgram);
  await original.runner.submit(original.request(), original.sources);
  await original.runner.resumeDispatch();
  await original.runner.waitForRun("lab-1", "run-1");
  const archive = await original.runner.exportRun("lab-1", "run-1");
  const other = await fixture();
  const imported = await other.runner.importRun(archive);
  expect(imported).toEqual(archive.record);
  expect(await other.runner.getSnapshot("lab-1", "run-1")).toEqual(
    archive.snapshot,
  );
  expect(
    await fileAccess.exists(
      join(other.root, "labs/lab-1/runs/run-1/worker.claim"),
    ),
  ).toBe(false);
  await other.runner.resumeDispatch();
  expect((await other.runner.readLogs("lab-1", "run-1")).stdout).toBe(
    "measured\n",
  );
  await expect(other.runner.importRun(archive)).rejects.toThrow(
    "already exists",
  );
  const tampered = structuredClone(archive);
  const code = tampered.files.find(
    (file) => file.path === "snapshot/code/main.py",
  );
  if (!code) throw new Error("Missing fixture source");
  code.content = Buffer.from("changed").toString("base64");
  const third = await fixture();
  await expect(third.runner.importRun(tampered)).rejects.toThrow("integrity");
  expect(await third.runner.allRuns()).toHaveLength(0);
});

test("paths, symlinks and configuration secrets cannot enter snapshots", async () => {
  const f = await fixture();
  for (const path of ["../escape.py", "/absolute.py", ".env", ".git/config"])
    await expect(
      fileAccess.writeBytes(f.sources.workspaceDir, path, "x"),
    ).rejects.toThrow();
  await symlink("/etc/hosts", join(f.sources.workspaceDir, "link.py"));
  await expect(f.runner.submit(f.request(), f.sources)).rejects.toThrow(
    "Symbolic link",
  );
  await expect(
    f.runner.submit(
      f.request("run-2", { config: { api_key: "never persist" } }),
      f.sources,
    ),
  ).rejects.toThrow("Credentials");
});

test("uv uses a frozen dependency snapshot and preserves the lockfile", async () => {
  const f = await fixture();
  await f.write(metricProgram);
  await f.write(
    '[project]\nname="operational-test"\nversion="0.1.0"\nrequires-python=">=3.9"\ndependencies=[]\n',
    "pyproject.toml",
  );
  const lock = Bun.spawn(["uv", "lock", "--offline"], {
    cwd: f.sources.workspaceDir,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await lock.exited).toBe(0);
  await f.runner.submit(
    f.request("run-1", { runtime: "uv", timeoutMs: 10000 }),
    f.sources,
  );
  await f.runner.resumeDispatch();
  expect((await f.runner.waitForRun("lab-1", "run-1")).status).toBe(
    "succeeded",
  );
  expect(
    (await f.runner.getSnapshot("lab-1", "run-1")).code.some(
      (file) => file.path === "uv.lock",
    ),
  ).toBe(true);
});
