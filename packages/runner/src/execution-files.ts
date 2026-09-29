import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord } from "@/runner/execution-contract";
import { atomicJson, exists, readJson, safeId } from "@/runner/files";

/** Only execution files. The laboratory owns datasets, workspaces and run-records. */
export class ExecutionFiles {
  constructor(readonly root: string) {}
  runDir(labId: string, runId: string): string {
    return join(this.root, "labs", safeId(labId), "runs", safeId(runId));
  }
  getRun(labId: string, runId: string): Promise<RunRecord> {
    return readJson(this.runDir(labId, runId), "run.json");
  }
  saveRun(record: RunRecord): Promise<void> {
    return atomicJson(
      join(this.runDir(record.labId, record.id), "run.json"),
      record,
    );
  }
  async scan(): Promise<{ records: RunRecord[]; pending: string[] }> {
    const records: RunRecord[] = [];
    const pending: string[] = [];
    for (const lab of await readdir(join(this.root, "labs"), {
      withFileTypes: true,
    })) {
      if (!lab.isDirectory()) continue;
      const runs = join(this.root, "labs", safeId(lab.name), "runs");
      if (!(await exists(runs))) continue;
      for (const run of await readdir(runs, { withFileTypes: true })) {
        if (!run.isDirectory()) continue;
        if (run.name.includes(".pending-")) {
          pending.push(join(runs, run.name));
          continue;
        }
        const record = await this.getRun(lab.name, run.name);
        if (record.labId !== lab.name || record.id !== run.name)
          throw new Error(
            "Execution record identity does not match its directory",
          );
        records.push(record);
      }
    }
    return {
      records: records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      pending,
    };
  }
}
