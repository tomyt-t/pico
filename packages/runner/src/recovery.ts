import { join } from "node:path";
import {
  type ExecutionInspection,
  type RunRecord,
  terminal,
} from "@/runner/execution-contract";
import type { ExecutionFiles } from "@/runner/execution-files";
import { exists, readJson } from "@/runner/files";
import { collectOutputs } from "@/runner/outputs";
import {
  groupExists,
  inspectIdentity,
  type ProcessClaim,
  pidExists,
  type Termination,
} from "@/runner/processes";

export interface DispatchReceipt {
  token: string;
  createdAt: string;
  pid?: number;
}

export async function inspectExecution(
  files: ExecutionFiles,
  initial: RunRecord,
): Promise<ExecutionInspection> {
  let record = initial;
  const directory = files.runDir(record.labId, record.id);
  const unknown = (reason: string): ExecutionInspection => ({
    record,
    state: "unknown",
    reason,
  });
  try {
    const hasClaim = await exists(join(directory, "worker.claim"));
    if (terminal(record.status)) {
      // The old coordinator declared a missing supervisor interrupted without
      // proving that its detached experimental children had exited.
      if (record.status === "interrupted" && hasClaim) {
        const legacy = await readJson<Partial<ProcessClaim>>(
          directory,
          "worker.claim",
        );
        if (legacy.version !== 1 || !legacy.token || !legacy.started)
          return unknown(
            "Legacy interrupted attempt has no proof that its experimental group ended",
          );
      }
      return { record, state: "terminal" };
    }
    if (!hasClaim) {
      if (
        (await exists(join(directory, "watchdog.claim"))) ||
        (await exists(join(directory, "execution-started.json")))
      )
        return unknown(
          "Experimental lifetime evidence exists without its supervisor claim",
        );
      if (await exists(join(directory, "dispatch.json")))
        return unknown(
          "A dispatch was reserved but its supervisor identity is not yet verifiable",
        );
      if (record.status !== "queued")
        return unknown("An active execution has no supervisor identity");
      if (await exists(join(directory, "cancel.json"))) {
        record = {
          ...record,
          status: "cancelled",
          endedAt: new Date().toISOString(),
        };
        await files.saveRun(record);
        return { record, state: "terminal" };
      }
      return { record, state: "queued" };
    }
    const supervisor = await readJson<ProcessClaim>(directory, "worker.claim");
    if (supervisor.version !== 1 || !supervisor.token || !supervisor.started) {
      // An old PID claim cannot prove that detached experimental descendants are gone.
      return unknown(
        pidExists(supervisor.pid)
          ? "Legacy supervisor identity cannot be verified"
          : "Legacy supervisor is gone; experimental process identity is unknown",
      );
    }
    const owner = await inspectIdentity(supervisor);
    if (owner === "alive") return { record, state: "active" };
    if (owner === "unknown")
      return unknown(
        "Supervisor PID is present but its execution identity does not match",
      );
    if (await exists(join(directory, "watchdog.claim"))) {
      const watchdog = await readJson<ProcessClaim>(
        directory,
        "watchdog.claim",
      );
      if (
        watchdog.token !== supervisor.token ||
        watchdog.pid !== watchdog.groupId
      )
        return unknown("Watchdog claim does not belong to this execution");
      const guard = await inspectIdentity(watchdog);
      if (guard === "alive") return { record, state: "active" };
      if (guard === "unknown" || groupExists(watchdog.groupId))
        return unknown("Experimental group termination has not been confirmed");
    }
    // Re-read: the supervisor may have finalized between the first read and PID inspection.
    record = await files.getRun(record.labId, record.id);
    if (terminal(record.status)) return { record, state: "terminal" };
    let outcome: Termination | undefined;
    if (await exists(join(directory, "termination.json")))
      outcome = await readJson<Termination>(directory, "termination.json");
    if (outcome?.token !== supervisor.token) outcome = undefined;
    record = await collectOutputs(directory, {
      ...record,
      status: outcome?.reason ?? "interrupted",
      endedAt: new Date().toISOString(),
      exitCode: outcome?.exitCode,
      logsTruncated: outcome?.logsTruncated,
      error:
        outcome?.error ??
        (outcome
          ? undefined
          : "Supervisor stopped before recording completion; this attempt will not restart"),
    });
    await files.saveRun(record);
    return { record, state: "terminal" };
  } catch (error) {
    return unknown(
      `Execution identity or state could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
