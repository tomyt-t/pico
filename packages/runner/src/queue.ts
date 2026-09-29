import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExecutionInspection } from "@/runner/execution-contract";
import type { ExecutionFiles } from "@/runner/execution-files";
import { atomicJson, RunnerError } from "@/runner/files";
import { spawnSupervisor } from "@/runner/processes";
import type { DispatchReceipt } from "@/runner/recovery";

export async function dispatchPending(
  files: ExecutionFiles,
  inspections: ExecutionInspection[],
  options: {
    maxConcurrent: number;
    getLabConcurrency?: (labId: string) => number;
    environmentBindings: Readonly<Record<string, string>>;
    isAllowed: () => boolean;
  },
): Promise<void> {
  // An unknown owner can still be using capacity. Never dispatch around it.
  if (inspections.some((item) => item.state === "unknown")) return;
  let active = inspections.filter((item) => item.state === "active").length;
  const labs = new Map<string, number>();
  for (const item of inspections)
    if (item.state === "active")
      labs.set(item.record.labId, (labs.get(item.record.labId) ?? 0) + 1);
  for (const { record, state } of inspections) {
    if (!options.isAllowed() || active >= options.maxConcurrent) break;
    if (state !== "queued") continue;
    const limit =
      options.getLabConcurrency?.(record.labId) ?? options.maxConcurrent;
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw new RunnerError("Laboratory concurrency must be between 1 and 16");
    if ((labs.get(record.labId) ?? 0) >= limit) continue;
    const directory = files.runDir(record.labId, record.id);
    const receipt: DispatchReceipt = {
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await atomicJson(join(directory, "dispatch.json"), receipt);
    let child: Awaited<ReturnType<typeof spawnSupervisor>> | undefined;
    try {
      child = await spawnSupervisor(
        directory,
        receipt.token,
        options.environmentBindings,
      );
    } catch (error) {
      await files.saveRun({
        ...record,
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // A started supervisor is an external effect. A receipt-write failure cannot make it failed.
    if (child)
      await atomicJson(join(directory, "dispatch.json"), {
        ...receipt,
        pid: child.pid,
      }).catch(() => {});
    active++;
    labs.set(record.labId, (labs.get(record.labId) ?? 0) + 1);
  }
}
