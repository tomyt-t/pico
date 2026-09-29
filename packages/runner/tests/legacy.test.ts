import { afterEach, expect, test } from "bun:test";
import { fileAccess, type RunBundle } from "@pico/runner";
import { cleanup, fixture } from "./support";

afterEach(cleanup);
test("reads the actual pre-refactor v1 archive and reproduces its original bytes and measurements", async () => {
  const archive = (await Bun.file(
    new URL("./fixtures/legacy-v1.json", import.meta.url),
  ).json()) as RunBundle;
  const provenance = (await Bun.file(
    new URL("./fixtures/legacy-provenance.json", import.meta.url),
  ).json()) as { snapshotHash: string };
  const f = await fixture();
  const imported = await f.runner.importRun(archive);
  expect(imported.snapshotHash).toBe(provenance.snapshotHash);
  const { labId, id } = archive.record;
  expect(await f.runner.getSnapshot(labId, id)).toEqual(archive.snapshot);
  for (const expected of archive.snapshot.code) {
    const bytes = await f.runner.readRunFile(labId, id, "code", expected.path);
    expect(fileAccess.digest(bytes)).toBe(expected.sha256);
  }
  await f.runner.reproduce(labId, id, "new-attempt-from-legacy");
  await f.runner.resumeDispatch();
  const reproduced = await f.runner.waitForRun(
    labId,
    "new-attempt-from-legacy",
  );
  expect(reproduced.status).toBe("succeeded");
  expect(reproduced.metrics).toEqual(archive.record.metrics);
  expect(
    (await f.runner.getSnapshot(labId, "new-attempt-from-legacy")).datasets,
  ).toEqual(archive.snapshot.datasets);
  expect((await f.runner.getSnapshot(labId, id)).sha256).toBe(
    provenance.snapshotHash,
  );
});
