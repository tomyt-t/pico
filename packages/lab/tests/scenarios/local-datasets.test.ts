import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileAccess } from "@pico/runner";
import type { DatasetVersion, MutationContext } from "@/lab/contracts";
import { importDatasetDirectory } from "@/lab/lab-administration";
import {
  createDatasetOperations,
  recoverDatasetPublication,
} from "@/lab/research/datasets";
import { EffectCoordinator } from "@/lab/research/effects";
import { createLaboratory } from "@/lab/research/laboratory";
import { ResearchBackup } from "@/lab/storage/backup";
import { createStorage, type Storage } from "@/lab/storage/storage";

const roots: string[] = [];
const stores: Storage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const intent = (): MutationContext => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" },
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pico-local-dataset-"));
  roots.push(root);
  const storage = createStorage(join(root, "research"));
  stores.push(storage);
  const lab = createLaboratory(storage);
  const labId = lab.createLab({ name: "Local imports" }).id;
  const effects = new EffectCoordinator(storage.operations);
  const datasets = createDatasetOperations(lab, storage, effects);
  const directory = await mkdtemp(join(root, "source-"));
  const input = {
    directory,
    name: "Large local data",
    version: "1",
    source: "Selected by researcher",
    license: "test",
  };
  return { root, storage, lab, labId, datasets, effects, input };
}

test("a 129 MiB local dataset preserves versions and survives streamed backup/restore", async () => {
  const f = await fixture();
  const handle = await open(join(f.input.directory, "samples.bin"), "wx");
  await handle.truncate(129 * 1024 * 1024);
  await handle.close();
  const context = intent();
  const dataset = await f.datasets.importDatasetDirectory(
    f.labId,
    f.input,
    context,
  );
  expect(dataset.files[0]?.size).toBe(129 * 1024 * 1024);
  expect(
    JSON.stringify(await f.storage.files.getDataset(f.labId, dataset.id)),
  ).not.toContain(f.input.directory);
  await writeFile(
    join(f.input.directory, "samples.bin"),
    "changed after import",
  );
  expect(
    await f.datasets.importDatasetDirectory(f.labId, f.input, context),
  ).toEqual(dataset);
  await expect(
    f.datasets.importDatasetDirectory(f.labId, f.input, intent()),
  ).rejects.toThrow("already exists");
  // Complete the rejected intent's effect before exercising the offline backup invariant.
  for (const effect of f.storage.operations.pendingEffects())
    f.effects.fail(effect, "Duplicate version rejected");
  const backup = f.storage.backup.create(join(f.root, "backup"));
  const restore = join(f.root, "restored");
  ResearchBackup.restore(backup, restore);
  const restored = createStorage(restore);
  stores.push(restored);
  await restored.files.verifyDataset(f.labId, dataset.id);
  expect(restored.research.get<DatasetVersion>("dataset", dataset.id)).toEqual(
    dataset,
  );
}, 15000);

test("directory imports reject Pico, symlinks and an explicit size budget before publication", async () => {
  const f = await fixture();
  await writeFile(join(f.input.directory, "samples.bin"), "12345678");
  await expect(
    f.datasets.importDatasetDirectory(f.labId, f.input, {
      ...intent(),
      actor: { kind: "pico" },
    }),
  ).rejects.toThrow("Only the researcher");
  expect(f.storage.operations.pendingEffects()).toHaveLength(0);
  await expect(
    f.datasets.importDatasetDirectory(
      f.labId,
      { ...f.input, limits: { maxFileBytes: 4 } },
      intent(),
    ),
  ).rejects.toThrow("exceeds");
  const link = join(f.root, "linked-source");
  await symlink(f.input.directory, link);
  await expect(
    f.datasets.importDatasetDirectory(
      f.labId,
      { ...f.input, directory: link },
      intent(),
    ),
  ).rejects.toThrow("real directories");
  expect(
    f.storage.research.datasetVersion(f.labId, f.input.name, f.input.version),
  ).toBeUndefined();
});

test("recovery verifies a large published import without re-reading its source directory", async () => {
  const f = await fixture();
  const handle = await open(join(f.input.directory, "samples.bin"), "wx");
  await handle.truncate(9 * 1024 * 1024);
  await handle.close();
  const original = f.lab.registerDataset;
  f.lab.registerDataset = () => {
    throw new Error("Injected projection failure");
  };
  await expect(
    f.datasets.importDatasetDirectory(f.labId, f.input, intent()),
  ).rejects.toThrow("projection failure");
  f.lab.registerDataset = original;
  const effect = f.storage.operations.pendingEffects()[0];
  if (!effect) throw new Error("Expected durable import receipt");
  await rm(f.input.directory, { recursive: true });
  const recovered = await recoverDatasetPublication(
    f.lab,
    f.storage,
    f.labId,
    effect.resourceId,
  );
  expect(recovered?.id).toBe(effect.resourceId);
  expect(recovered?.files[0]?.size).toBe(9 * 1024 * 1024);
  f.effects.complete(effect, recovered);
  expect(f.storage.operations.pendingEffects()).toHaveLength(0);
});

test("offline public import keeps pending model turns queued", async () => {
  const f = await fixture();
  await writeFile(join(f.input.directory, "samples.txt"), "observations");
  const conversation = f.storage.conversation.getConversation(f.labId);
  if (!conversation) throw new Error("Missing conversation");
  const turn = f.storage.conversation.insertTurn({
    id: crypto.randomUUID(),
    labId: f.labId,
    conversationId: conversation.id,
    status: "queued",
    trigger: "researcher",
    message: "Wait for the researcher",
    eventId: null,
    steps: 0,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
  });
  const dataset = await importDatasetDirectory(
    f.storage.dataDir,
    f.labId,
    f.input,
    intent(),
  );
  expect(dataset.files[0]?.sha256).toBe(fileAccess.digest("observations"));
  expect(f.storage.conversation.getTurn(turn.id)?.status).toBe("queued");
});
