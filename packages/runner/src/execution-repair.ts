import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord, SnapshotManifest } from "@/runner/execution-contract";
import {
  type ExecutionFiles,
  executionControlFiles,
} from "@/runner/execution-files";
import {
  atomicJson,
  checkedPath,
  exists,
  RunnerError,
  readJson,
} from "@/runner/files";
import { validateRequest, verifySnapshot } from "@/runner/format-v1";
import { collectOutputs } from "@/runner/outputs";
import {
  groupExists,
  inspectIdentity,
  type ProcessClaim,
  pidExists,
  validProcessClaim,
} from "@/runner/processes";
import type { DispatchReceipt } from "@/runner/recovery";

/** A human request is permission to inspect, never evidence that a process has stopped. */
export async function requireEndedLifetime(directory: string): Promise<void> {
  const present = new Map<string, unknown>();
  for (const name of executionControlFiles) {
    if (await exists(join(directory, name)))
      present.set(name, await readJson(directory, name));
  }
  const owner = present.get("worker.claim") as ProcessClaim | undefined;
  const guard = present.get("watchdog.claim") as ProcessClaim | undefined;
  for (const name of ["worker.claim", "watchdog.claim"]) {
    if (!present.has(name)) continue;
    const claim = present.get(name) as ProcessClaim | null;
    if (!validProcessClaim(claim))
      throw new RunnerError(
        "Legacy or incomplete process identity cannot prove termination",
        "conflict",
      );
    if ((await inspectIdentity(claim)) !== "gone" || groupExists(claim.groupId))
      throw new RunnerError(
        "Execution process or group termination has not been confirmed",
        "conflict",
      );
  }
  if (
    guard &&
    (!owner || guard.token !== owner.token || guard.groupId !== guard.pid)
  )
    throw new RunnerError(
      "Watchdog identity cannot be matched to its supervisor",
      "conflict",
    );
  if (
    (present.has("execution-started.json") ||
      present.has("termination.json")) &&
    !guard
  )
    throw new RunnerError(
      "Execution started without a verifiable lifetime guard",
      "conflict",
    );
  if (!owner && present.has("dispatch.json")) {
    const receipt = present.get("dispatch.json") as DispatchReceipt;
    if (
      !receipt ||
      !Number.isSafeInteger(receipt.pid) ||
      (receipt.pid ?? 0) <= 0 ||
      typeof receipt.token !== "string" ||
      !receipt.token ||
      typeof receipt.createdAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.createdAt)) ||
      pidExists(receipt.pid ?? 0)
    )
      throw new RunnerError(
        "Reserved dispatch has no proof that its supervisor ended",
        "conflict",
      );
  }
}

export async function repairUnknownRecord(
  files: ExecutionFiles,
  record: RunRecord,
): Promise<RunRecord> {
  const directory = files.runDir(record.labId, record.id);
  if (
    (record.status === "running" || record.startedAt || record.workerPid) &&
    !(await exists(join(directory, "worker.claim")))
  )
    throw new RunnerError(
      "An admitted execution has lost its supervisor identity; termination cannot be confirmed",
      "conflict",
    );
  await requireEndedLifetime(directory);
  const preserved = `run.recovered-${randomUUID()}.json`;
  await copyFile(
    await checkedPath(directory, "run.json"),
    join(directory, preserved),
  );
  const recovered = await collectOutputs(directory, {
    ...record,
    status: "interrupted",
    endedAt: new Date().toISOString(),
    error:
      "Unresolved execution reconciled after explicit process termination verification; original record retained",
  });
  await files.saveRun(recovered);
  await atomicJson(join(directory, "recovery.json"), {
    action: "reconcile_unknown_execution",
    preserved,
    recoveredAt: new Date().toISOString(),
    snapshotHash: record.snapshotHash,
  });
  return recovered;
}

export async function repairUnreadableRecord(
  files: ExecutionFiles,
  labId: string,
  runId: string,
): Promise<RunRecord> {
  const directory = files.runDir(labId, runId);
  await requireEndedLifetime(directory);
  const snapshot = verifySnapshot(
    await readJson<SnapshotManifest>(
      join(directory, "snapshot"),
      "manifest.json",
    ),
  );
  validateRequest(snapshot.request, false);
  if (snapshot.request.labId !== labId || snapshot.request.runId !== runId)
    throw new RunnerError(
      "Snapshot identity does not match the damaged execution",
      "conflict",
    );
  // Preserve the damaged bytes before any replacement. Recovery never invents success.
  const preserved = `run.corrupt-${randomUUID()}.json`;
  if (await exists(join(directory, "run.json")))
    await copyFile(
      await checkedPath(directory, "run.json"),
      join(directory, preserved),
    );
  const record = await collectOutputs(directory, {
    schemaVersion: 1,
    id: runId,
    labId,
    experimentId: snapshot.request.experimentId,
    status: "interrupted",
    createdAt: snapshot.createdAt,
    endedAt: new Date().toISOString(),
    snapshotHash: snapshot.sha256,
    metrics: [],
    artifacts: [],
    command:
      snapshot.request.runtime === "uv"
        ? [
            join(directory, "work", ".venv", "bin", "python"),
            snapshot.request.entrypoint,
            ...(snapshot.request.args ?? []),
          ]
        : [
            "python3",
            snapshot.request.entrypoint,
            ...(snapshot.request.args ?? []),
          ],
    error:
      "Unreadable execution record recovered from preserved snapshot after termination verification; original bytes retained",
  });
  await files.saveRun(record);
  await atomicJson(join(directory, "recovery.json"), {
    action: "recover_unreadable_record",
    preserved,
    recoveredAt: new Date().toISOString(),
    snapshotHash: snapshot.sha256,
  });
  return record;
}

export async function removeWork(directory: string): Promise<boolean> {
  await requireEndedLifetime(directory);
  const work = join(directory, "work");
  const removed = await exists(work);
  await rm(work, { recursive: true, force: true });
  return removed;
}
