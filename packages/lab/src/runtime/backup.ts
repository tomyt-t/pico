import { createRunner } from "@pico/runner";
import type { MutationContext } from "@/lab/contracts";
import {
  createLaboratory,
  createResearchOperations,
  LabError,
  ResearchExecution,
} from "@/lab/research/laboratory";
import { acquireApplicationLock } from "@/lab/storage/application-lock";
import { createStorage, type Storage } from "@/lab/storage/storage";

export async function publishBackup(input: {
  destination: string;
  context: MutationContext;
  storage: Storage;
  runner: ReturnType<typeof createRunner>;
  operations: ReturnType<typeof createResearchOperations>;
}): Promise<{ path: string }> {
  await input.operations.reconcile();
  const inventory = await input.runner.inventory();
  if (!inventory.safeToBackup)
    throw new LabError(
      "CONFLICT",
      "Wait for queued/running jobs and resolve uncertain execution ownership before backing up",
    );
  if (input.storage.operations.pendingEffects().length)
    throw new LabError(
      "CONFLICT",
      "Resolve pending filesystem operations before backing up",
    );
  return input.storage.operations.mutate(
    {
      labId: "__application__",
      key: input.context.key,
      operation: "backup",
      input: { destination: input.destination },
    },
    () => ({ path: input.storage.backup.create(input.destination) }),
  );
}

/** CLI administration uses the same exclusion and inspection, with no conversation or dispatcher. */
export async function backupLaboratory(
  dataDir: string,
  destination: string,
  context: MutationContext,
): Promise<{ path: string }> {
  const release = acquireApplicationLock(dataDir);
  let storage: Storage | undefined;
  let runner: ReturnType<typeof createRunner> | undefined;
  try {
    storage = createStorage(dataDir);
    const lab = createLaboratory(storage);
    let operations: ReturnType<typeof createResearchOperations> | undefined;
    runner = createRunner({
      dataDir,
      onUpdate: (record) => operations?.acceptObservation(record),
    });
    const execution = new ResearchExecution(storage.files, runner);
    operations = createResearchOperations(lab, storage, execution);
    await runner.start();
    return await publishBackup({
      destination,
      context,
      storage,
      runner,
      operations,
    });
  } finally {
    try {
      await runner?.close();
    } finally {
      try {
        storage?.close();
      } finally {
        release();
      }
    }
  }
}
