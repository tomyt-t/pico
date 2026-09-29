import { readdir, rename } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  ExecutionIssue,
  RunRecord,
  SnapshotManifest,
} from "@/runner/execution-contract";
import {
  atomicJson,
  digest,
  ensureDirectory,
  exists,
  readBytes,
  readJson,
  safeId,
} from "@/runner/files";
import { verifySnapshot } from "@/runner/format-v1";

export const executionControlFiles = [
  "worker.claim",
  "watchdog.claim",
  "dispatch.json",
  "execution-started.json",
  "termination.json",
  "cancel.json",
] as const;

/** Only execution files. The laboratory owns datasets, workspaces and run-records. */
export class ExecutionFiles {
  constructor(readonly root: string) {}
  runDir(labId: string, runId: string): string {
    return join(this.root, "labs", safeId(labId), "runs", safeId(runId));
  }
  async getRun(labId: string, runId: string): Promise<RunRecord> {
    const record = await readJson<RunRecord>(
      this.runDir(labId, runId),
      "run.json",
    );
    if (
      record?.schemaVersion !== 1 ||
      record.labId !== labId ||
      record.id !== runId ||
      typeof record.experimentId !== "string" ||
      typeof record.createdAt !== "string" ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.snapshotHash !== "string" ||
      ![
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "timed_out",
        "interrupted",
      ].includes(record.status) ||
      !Array.isArray(record.metrics) ||
      !Array.isArray(record.artifacts) ||
      !Array.isArray(record.command) ||
      record.command.some((value) => typeof value !== "string") ||
      record.metrics.some(
        (metric) =>
          !metric ||
          typeof metric.name !== "string" ||
          !Number.isFinite(metric.value),
      ) ||
      record.artifacts.some(
        (file) =>
          !file ||
          typeof file.path !== "string" ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0 ||
          typeof file.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(file.sha256),
      )
    )
      throw new Error(
        "Execution record is invalid or its identity does not match its directory",
      );
    return record;
  }
  saveRun(record: RunRecord): Promise<void> {
    return atomicJson(
      join(this.runDir(record.labId, record.id), "run.json"),
      record,
    );
  }
  async scan(): Promise<{
    records: RunRecord[];
    pending: string[];
    issues: ExecutionIssue[];
  }> {
    const records: RunRecord[] = [];
    const pending: string[] = [];
    const issues: ExecutionIssue[] = [];
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
        let record: RunRecord;
        try {
          record = await this.getRun(lab.name, run.name);
        } catch (error) {
          issues.push({
            labId: lab.name,
            runId: run.name,
            directory: relative(this.root, join(runs, run.name)),
            kind: "unreadable_record",
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        try {
          const snapshot = verifySnapshot(
            await readJson<SnapshotManifest>(
              join(runs, run.name, "snapshot"),
              "manifest.json",
            ),
          );
          if (
            snapshot.sha256 !== record.snapshotHash ||
            snapshot.request.runId !== record.id ||
            snapshot.request.labId !== record.labId ||
            snapshot.request.experimentId !== record.experimentId
          )
            throw new Error(
              "Snapshot identity or hash does not match its execution record",
            );
          records.push(record);
        } catch (error) {
          issues.push({
            labId: lab.name,
            runId: run.name,
            directory: relative(this.root, join(runs, run.name)),
            kind: "unreadable_snapshot",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return {
      records: records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      pending,
      issues,
    };
  }

  /** Only called during start under the coordinator lock, before accepting publications. */
  async recoverPublications(): Promise<{
    recovered: string[];
    issues: ExecutionIssue[];
  }> {
    const recovered: string[] = [];
    const issues: ExecutionIssue[] = [];
    for (const lab of await readdir(join(this.root, "labs"), {
      withFileTypes: true,
    })) {
      if (!lab.isDirectory()) continue;
      const archive = join(this.root, "labs", safeId(lab.name), "run-recovery");
      if (!(await exists(archive))) continue;
      for (const entry of await readdir(archive, { withFileTypes: true }))
        if (entry.isDirectory())
          recovered.push(relative(this.root, join(archive, entry.name)));
    }
    for (const directory of (await this.scan()).pending) {
      const local = relative(this.root, directory);
      const parts = local.split("/");
      const labId = parts[1] ?? "";
      const name = parts[3] ?? "";
      // A normal staging directory cannot launch anything: dispatch only scans published IDs.
      // Preserve anomalous lifetime evidence in place and keep admission blocked.
      const controls = await Promise.all(
        executionControlFiles.map((file) => exists(join(directory, file))),
      );
      if (controls.some(Boolean)) {
        issues.push({
          labId,
          directory: local,
          kind: "unsafe_publication",
          reason:
            "Incomplete publication contains process-control evidence; termination cannot be assumed",
        });
        continue;
      }
      const destination = await ensureDirectory(
        this.root,
        `labs/${safeId(labId)}/run-recovery`,
      );
      const hashes: Record<string, string> = {};
      for (const path of ["run.json", "snapshot/manifest.json"]) {
        if (await exists(join(directory, path))) {
          try {
            hashes[path] = digest(await readBytes(directory, path));
          } catch {
            /* Preserve even malformed metadata; nothing here can dispatch. */
          }
        }
      }
      // Publish the recovery receipt before moving. A crash can leave an extra receipt,
      // but cannot move unique research without a record of its origin.
      await atomicJson(join(destination, `${name}.recovery.json`), {
        action: "preserve_orphaned_publication",
        originalDirectory: local,
        recoveredAt: new Date().toISOString(),
        metadataHashes: hashes,
      });
      await rename(directory, join(destination, name));
      recovered.push(relative(this.root, join(destination, name)));
    }
    return { recovered, issues };
  }
}
