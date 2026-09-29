import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type RunBundle, terminal } from "@/runner/execution-contract";
import {
  atomicJson,
  decodeFile,
  digest,
  ensureDirectory,
  exists,
  type FileInput,
  MAX_FILE_BYTES,
  MAX_TREE_BYTES,
  MAX_TREE_FILES,
  RunnerError,
  readBytes,
  safeId,
  safeRelative,
  writeBytes,
} from "@/runner/files";
import { parseMetrics } from "@/runner/outputs";

/** Archive schema is versioned independently; importing never launches a process. */
export async function exportBundle(
  root: string,
  bundle: Omit<RunBundle, "files">,
): Promise<RunBundle> {
  if (!terminal(bundle.record.status))
    throw new RunnerError(
      "Only completed attempts can be exported",
      "conflict",
    );
  const requested = [
    ...bundle.snapshot.code.map((file) => ({
      ...file,
      path: `snapshot/code/${file.path}`,
    })),
    ...bundle.snapshot.datasets.flatMap((dataset) =>
      dataset.files.map((file) => ({
        ...file,
        path: `snapshot/inputs/${dataset.id}/${file.path}`,
      })),
    ),
    ...bundle.record.artifacts.map((file) => ({
      ...file,
      path: `outputs/${file.path}`,
    })),
  ];
  const files: FileInput[] = [];
  if (
    requested.some((file) => file.bytes > MAX_FILE_BYTES) ||
    requested.reduce((total, file) => total + file.bytes, 0) >
      MAX_TREE_BYTES * 3 ||
    requested.length + 2 > MAX_TREE_FILES * 3
  )
    throw new RunnerError(
      "This execution exceeds the small JSON run archive limits. Use a full research backup to preserve larger datasets.",
      "conflict",
    );
  for (const file of requested) {
    const bytes = await readBytes(root, file.path);
    if (digest(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new RunnerError(
        `Run file integrity check failed: ${file.path}`,
        "conflict",
      );
    files.push({
      path: file.path,
      content: bytes.toString("base64"),
      encoding: "base64",
    });
  }
  for (const path of ["stdout.log", "stderr.log"])
    files.push({
      path,
      content: (await readBytes(root, path)).toString("base64"),
      encoding: "base64",
    });
  return { ...bundle, files };
}

export function validateBundle(bundle: RunBundle): Map<string, Buffer> {
  if (
    bundle.schemaVersion !== 1 ||
    bundle.record.schemaVersion !== 1 ||
    bundle.snapshot.schemaVersion !== 1
  )
    throw new RunnerError("Unsupported run archive version");
  const { record, snapshot } = bundle;
  if (!terminal(record.status) || !record.endedAt)
    throw new RunnerError(
      "An imported attempt must be terminal and will never be executed",
    );
  safeId(record.id);
  safeId(record.labId);
  safeId(record.experimentId);
  if (
    record.id !== snapshot.request.runId ||
    record.labId !== snapshot.request.labId ||
    record.experimentId !== snapshot.request.experimentId
  )
    throw new RunnerError("Archive identifiers do not match");
  const hash = digest(
    JSON.stringify({
      request: snapshot.request,
      code: snapshot.code,
      datasets: snapshot.datasets,
      environment: snapshot.environment,
    }),
  );
  if (hash !== snapshot.sha256 || hash !== record.snapshotHash)
    throw new RunnerError("Archive snapshot integrity check failed");
  if (bundle.files.length > MAX_TREE_FILES * 3)
    throw new RunnerError("Archive contains too many files");
  const content = new Map<string, Buffer>();
  let total = 0;
  for (const file of bundle.files) {
    safeRelative(file.path);
    if (content.has(file.path)) throw new RunnerError("Duplicate archive file");
    const bytes = decodeFile(file);
    total += bytes.length;
    if (total > MAX_TREE_BYTES * 3)
      throw new RunnerError("Archive exceeds maximum size");
    content.set(file.path, bytes);
  }
  const expected = [
    ...snapshot.code.map((file) => ({
      ...file,
      path: `snapshot/code/${file.path}`,
    })),
    ...snapshot.datasets.flatMap((dataset) => {
      safeId(dataset.id);
      if (dataset.labId !== record.labId)
        throw new RunnerError("Archive dataset belongs to another laboratory");
      return dataset.files.map((file) => ({
        ...file,
        path: `snapshot/inputs/${dataset.id}/${file.path}`,
      }));
    }),
    ...record.artifacts.map((file) => ({
      ...file,
      path: `outputs/${file.path}`,
    })),
  ];
  const allowed = new Set(["stdout.log", "stderr.log"]);
  for (const file of expected) {
    safeRelative(file.path);
    if (allowed.has(file.path))
      throw new RunnerError("Archive manifest contains a duplicate file");
    allowed.add(file.path);
    const bytes = content.get(file.path);
    if (!bytes || bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new RunnerError(
        `Archive file integrity check failed: ${file.path}`,
      );
  }
  if (
    [...content.keys()].some((path) => !allowed.has(path)) ||
    [...allowed].some((path) => !content.has(path))
  )
    throw new RunnerError("Archive files do not match its manifest");
  const metricsFile = content.get("outputs/metrics.json");
  if (record.metrics.length) {
    if (
      !metricsFile ||
      JSON.stringify(parseMetrics(JSON.parse(metricsFile.toString("utf8")))) !==
        JSON.stringify(record.metrics)
    )
      throw new RunnerError(
        "Archive metrics do not match preserved observations",
      );
  }
  return content;
}

export async function importBundle(
  dataDir: string,
  bundle: RunBundle,
): Promise<void> {
  const content = validateBundle(bundle);
  const root = join(dataDir, "labs", bundle.record.labId, "runs");
  await ensureDirectory(dataDir, `labs/${bundle.record.labId}/runs`);
  const destination = join(root, bundle.record.id);
  if (await exists(destination))
    throw new RunnerError(
      "Run identifier already exists; import will not overwrite research",
      "conflict",
    );
  const staging = `${destination}.pending-${randomUUID()}`;
  await mkdir(join(staging, "snapshot"), { recursive: true });
  try {
    for (const [path, bytes] of content) await writeBytes(staging, path, bytes);
    await atomicJson(
      join(staging, "snapshot", "manifest.json"),
      bundle.snapshot,
    );
    await atomicJson(
      join(staging, "snapshot", "config.json"),
      bundle.snapshot.request.config,
    );
    await writeBytes(
      join(staging, "snapshot"),
      "protocol.md",
      bundle.snapshot.request.protocol,
    );
    await atomicJson(join(staging, "run.json"), bundle.record);
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
