import {
  type DatasetManifest,
  type FileDigest,
  fileAccess,
  type SnapshotManifest,
} from "@pico/runner";
import type {
  Artifact,
  DatasetVersion,
  FileManifest,
  RunSnapshot,
} from "@/lab/contracts";

const { digest } = fileAccess;
export function manifestFile(file: FileDigest): FileManifest {
  return { path: file.path, size: file.bytes, sha256: file.sha256 };
}
export function datasetVersion(manifest: DatasetManifest): DatasetVersion {
  return {
    id: manifest.id,
    labId: manifest.labId,
    name: manifest.name,
    version: manifest.version ?? manifest.id,
    description: manifest.description ?? "",
    source: manifest.source,
    license: manifest.license,
    splits: manifest.splits ?? {},
    files: manifest.files.map(manifestFile),
    manifestHash: manifest.sha256,
    createdAt: manifest.createdAt,
    updatedAt: manifest.createdAt,
    revision: 1,
    author: manifest.author ?? { kind: "system" },
  };
}
export function snapshotProjection(manifest: SnapshotManifest): RunSnapshot {
  const codeFiles = manifest.code.map(manifestFile);
  return {
    schemaVersion: 1,
    experimentId: manifest.request.experimentId,
    experimentRevision: manifest.request.experimentRevision ?? 1,
    protocol: manifest.request.protocol,
    criteria: manifest.request.criteria ?? [],
    entrypoint: manifest.request.entrypoint,
    runtime: manifest.request.runtime ?? "python",
    args: manifest.request.args ?? [],
    config: manifest.request.config as RunSnapshot["config"],
    codeFiles,
    codeHash: digest(JSON.stringify(codeFiles)),
    datasetInputs: manifest.datasets.map((dataset) => ({
      datasetVersionId: dataset.id,
      name: dataset.name,
      version: dataset.version ?? dataset.id,
      manifestHash: dataset.sha256,
      files: dataset.files.map(manifestFile),
    })),
    environment: manifest.environment,
    createdAt: manifest.createdAt,
    ...(manifest.request.resources && {
      resources: manifest.request.resources,
    }),
  };
}
export function artifact(file: FileDigest): Artifact {
  const extension = file.path.split(".").at(-1)?.toLowerCase();
  const kind =
    extension &&
    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)
      ? "figure"
      : extension && ["csv", "json", "jsonl", "tsv"].includes(extension)
        ? "table"
        : extension && ["log", "txt"].includes(extension)
          ? "log"
          : "other";
  return { ...manifestFile(file), kind };
}
