import type {
  DatasetRegistration,
  DatasetVersion,
  MutationContext,
  NewDataset,
} from "@/lab/contracts";
import { datasetSchema } from "@/lab/contracts";
import type { EffectCoordinator } from "@/lab/research/effects";
import { LabError, parse } from "@/lab/research/errors";
import type { Laboratory } from "@/lab/research/laboratory";
import type { ResearchContext } from "@/lab/research/mutations";
import type { DatasetPersistence } from "@/lab/research/persistence";
import { datasetVersion } from "@/lab/research/run-projection";
export function registerDataset(
  context: ResearchContext,
  labId: string,
  input: NewDataset,
  ctx: MutationContext,
): DatasetVersion {
  return context.mutate(labId, "registerDataset", input, ctx, () => {
    const { id, ...metadata } = input;
    const fields = parse(datasetSchema, metadata);
    if (
      new Set(fields.files.map((file) => file.path)).size !==
      fields.files.length
    )
      throw new LabError("BAD_REQUEST", "Dataset files must have unique paths");
    if (
      context.repo
        .list<DatasetVersion>("dataset", labId)
        .some(
          (dataset) =>
            dataset.name === fields.name && dataset.version === fields.version,
        )
    ) {
      throw new LabError(
        "CONFLICT",
        "This dataset version already exists; register a new version to change its contents",
      );
    }
    return context.insert(labId, "dataset", {
      ...context.meta(labId, ctx.actor, id),
      ...fields,
    });
  });
}

export function createDatasetOperations(
  lab: Laboratory,
  storage: DatasetPersistence,
  effects: EffectCoordinator,
) {
  return {
    async registerDataset(
      labId: string,
      input: DatasetRegistration,
      ctx: MutationContext,
    ): Promise<DatasetVersion> {
      lab.getLab(labId);
      return effects.run(
        labId,
        "registerDatasetFiles",
        input,
        ctx,
        async (id) => {
          const existing = storage.research.datasetVersion(
            labId,
            input.name,
            input.version,
          );
          if (existing && existing.id !== id)
            throw new LabError(
              "CONFLICT",
              "This dataset version already exists; register a new version to change its contents",
            );
          const preserved = datasetVersion(
            await storage.files.registerDataset({
              ...input,
              labId,
              id,
              license: input.license || "unknown",
              author: ctx.actor,
            }),
          );
          const {
            author: _author,
            labId: _labId,
            revision: _revision,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            ...fields
          } = preserved;
          return lab.registerDataset(labId, fields, {
            ...ctx,
            key: `${ctx.key}:record`,
          });
        },
      );
    },
    async readDatasetFile(labId: string, id: string, path: string) {
      lab.getRecord(labId, "dataset", id);
      return storage.files.readDatasetFile(labId, id, path);
    },
  };
}

/** A dataset publication can commit before its SQLite projection; preserve its reserved identity. */
export async function recoverDatasetPublication(
  lab: Laboratory,
  storage: DatasetPersistence,
  labId: string,
  id: string,
): Promise<DatasetVersion | undefined> {
  const existing = storage.research.get<DatasetVersion>("dataset", id);
  if (existing) return existing;
  let manifest: Awaited<ReturnType<DatasetPersistence["files"]["getDataset"]>>;
  try {
    manifest = await storage.files.getDataset(labId, id);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "missing"].includes(String(error.code))
    )
      return undefined;
    throw error;
  }
  // Read every published file through the verified data boundary before accepting the record.
  for (const file of manifest.files)
    await storage.files.readDatasetFile(labId, id, file.path);
  const preserved = datasetVersion(manifest);
  const {
    author,
    labId: _labId,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = preserved;
  return lab.registerDataset(labId, fields, {
    key: `recover-dataset:${id}`,
    actor: author,
  });
}
