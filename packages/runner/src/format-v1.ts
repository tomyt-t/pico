import type { RunRequest, SnapshotManifest } from "@/runner/execution-contract";
import { digest, RunnerError, safeId, safeRelative } from "@/runner/files";

/** Never normalize or reconstruct historical request keys before hashing v1. */
export function snapshotHash(
  snapshot: Pick<
    SnapshotManifest,
    "request" | "code" | "datasets" | "environment"
  >,
): string {
  return digest(
    JSON.stringify({
      request: snapshot.request,
      code: snapshot.code,
      datasets: snapshot.datasets,
      environment: snapshot.environment,
    }),
  );
}
export function verifySnapshot(snapshot: SnapshotManifest): SnapshotManifest {
  if (
    snapshot.schemaVersion !== 1 ||
    snapshotHash(snapshot) !== snapshot.sha256
  )
    throw new RunnerError(
      "Snapshot manifest integrity check failed",
      "conflict",
    );
  return snapshot;
}
export function validateRequest(request: RunRequest): void {
  safeId(request.runId);
  safeId(request.labId);
  safeId(request.experimentId);
  safeRelative(request.entrypoint);
  if (!request.entrypoint.endsWith(".py") || request.entrypoint.startsWith("-"))
    throw new RunnerError("Entrypoint must be a Python file");
  if (!request.protocol.trim())
    throw new RunnerError("An execution requires a protocol");
  if (
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 100 ||
    request.timeoutMs > 24 * 60 * 60 * 1_000
  )
    throw new RunnerError("Timeout must be between 100 ms and 24 hours");
  if (
    request.runtime &&
    request.runtime !== "python" &&
    request.runtime !== "uv"
  )
    throw new RunnerError("Unsupported runtime");
  if (
    request.args &&
    (request.args.length > 100 ||
      request.args.some(
        (arg) =>
          typeof arg !== "string" || arg.length > 4_096 || arg.includes("\0"),
      ))
  )
    throw new RunnerError("Invalid execution arguments");
  if (
    request.datasetIds &&
    new Set(request.datasetIds).size !== request.datasetIds.length
  )
    throw new RunnerError("Duplicate dataset versions");
  for (const id of request.datasetIds ?? []) safeId(id);
  if (request.referenceRunId) safeId(request.referenceRunId);
  const config = JSON.stringify(request.config);
  if (config.length > 100_000)
    throw new RunnerError("Run configuration is too large");
  if (
    /"(?:api[_-]?key|authorization|password|secret|access[_-]?token)"\s*:/i.test(
      config,
    )
  )
    throw new RunnerError(
      "Credentials must not be placed in preserved run configuration",
    );
}
