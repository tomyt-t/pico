import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type createRunner,
  type RunBundle,
  RunnerError,
  type RunRecord,
  validateBundle,
} from "@pico/runner";
import type {
  DatasetVersion,
  Experiment,
  Run,
  RunRequest,
  RunSnapshot,
} from "@/lab/contracts";
import { artifact, snapshotProjection } from "@/lab/research/run-projection";
import type { ResearchFiles } from "@/lab/storage/research-files";
export interface RunArchive {
  schemaVersion: 1;
  run: Run;
  execution: RunBundle;
}
export interface Submission {
  run: Run;
  experiment: Experiment;
  datasets: DatasetVersion[];
  request: RunRequest;
  /** null grants no deadline; undefined falls back to the request. */
  timeoutSeconds?: number | null;
}
function timeoutMs(
  granted: number | null | undefined,
  requested: number | undefined,
): number | null {
  const seconds = granted !== undefined ? granted : (requested ?? 60);
  return seconds === null ? null : seconds * 1000;
}
export type OperationalRunner = Awaited<ReturnType<typeof createRunner>>;
/** Converts immutable operational observations into scientific projections. */
export class ResearchExecution {
  private readonly imports = new Set<string>();
  constructor(
    readonly files: ResearchFiles,
    readonly runner: OperationalRunner,
  ) {}
  async projectRun(record: RunRecord): Promise<Run> {
    const initial = await this.files.readRun(record.labId, record.id);
    const manifest = await this.runner.getSnapshot(record.labId, record.id);
    return {
      ...initial,
      status: record.status,
      updatedAt: record.endedAt ?? record.startedAt ?? record.createdAt,
      startedAt: record.startedAt ?? null,
      endedAt: record.endedAt ?? null,
      exitCode: record.exitCode ?? null,
      error: record.error ?? null,
      command: record.command
        .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
        .join(" "),
      metrics: record.metrics.map((metric) => ({
        name: metric.name,
        value: metric.value,
        unit: metric.unit ?? null,
        split: metric.split ?? null,
        step: metric.step ?? null,
      })),
      artifacts: record.artifacts.map(artifact),
      snapshot: snapshotProjection(manifest),
    };
  }

  async submit(input: Submission): Promise<Run> {
    const { run, experiment, request } = input;
    if (
      run.labId !== experiment.labId ||
      run.experimentId !== experiment.id ||
      input.datasets.some((dataset) => dataset.labId !== run.labId)
    )
      throw new RunnerError(
        "Execution records must belong to the same laboratory and experiment",
      );
    const datasetIds = input.datasets.map((dataset) => dataset.id).sort();
    if (
      !request.referenceRunId &&
      JSON.stringify(datasetIds) !==
        JSON.stringify([...experiment.datasetVersionIds].sort())
    )
      throw new RunnerError("Dataset inputs do not match the experiment");
    await this.files.preserveRun(run);
    let record: RunRecord;
    if (request.referenceRunId) {
      const reference = await this.runner.getSnapshot(
        run.labId,
        request.referenceRunId,
      );
      const allowedSeconds =
        input.timeoutSeconds !== undefined
          ? input.timeoutSeconds
          : request.timeoutSeconds;
      if (
        allowedSeconds !== undefined &&
        allowedSeconds !== null &&
        (reference.request.timeoutMs === null ||
          reference.request.timeoutMs > allowedSeconds * 1000)
      )
        throw new RunnerError(
          "The preserved run timeout exceeds the current laboratory limit; increase the limit before reproducing these conditions",
        );
      if (
        (request.args !== undefined &&
          !isDeepStrictEqual(request.args, reference.request.args ?? [])) ||
        (request.config !== undefined &&
          !isDeepStrictEqual(request.config, reference.request.config)) ||
        (request.resources !== undefined &&
          !isDeepStrictEqual(
            request.resources,
            reference.request.resources ?? {},
          ))
      )
        throw new RunnerError(
          "Reproduction preserves arguments and configuration from its reference run",
        );
      record = await this.runner.reproduce(
        run.labId,
        request.referenceRunId,
        run.id,
      );
    } else {
      for (const dataset of input.datasets) {
        const stored = await this.files.getDataset(run.labId, dataset.id);
        if (stored.sha256 !== dataset.manifestHash)
          throw new RunnerError(
            "Dataset record does not match preserved files",
            "conflict",
          );
      }
      record = await this.runner.submit(
        {
          runId: run.id,
          labId: run.labId,
          experimentId: run.experimentId,
          protocol: experiment.protocol,
          experimentRevision: experiment.revision,
          criteria: experiment.criteria,
          config: request.config ?? {},
          datasetIds: experiment.datasetVersionIds,
          entrypoint: experiment.entrypoint,
          args: request.args ?? [],
          timeoutMs: timeoutMs(input.timeoutSeconds, request.timeoutSeconds),
          runtime: experiment.runtime,
          ...(request.resources && { resources: request.resources }),
        },
        {
          workspaceDir: await this.files.workspace(run.labId, experiment.id),
          datasets: await Promise.all(
            input.datasets.map(async (dataset) => ({
              manifest: await this.files.getDataset(run.labId, dataset.id),
              filesDir: join(
                this.files.datasetDir(run.labId, dataset.id),
                "files",
              ),
            })),
          ),
        },
      );
    }
    return this.projectRun(record);
  }
  async getRun(labId: string, runId: string): Promise<Run> {
    return this.projectRun(await this.runner.getRun(labId, runId));
  }
  async getSnapshot(labId: string, runId: string): Promise<RunSnapshot> {
    return snapshotProjection(await this.runner.getSnapshot(labId, runId));
  }
  async readLogs(
    labId: string,
    runId: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.runner.logs(labId, runId);
  }
  async readRunFile(
    labId: string,
    runId: string,
    area: "code" | "outputs",
    path: string,
  ): Promise<Buffer> {
    return this.runner.readRunFile(labId, runId, area, path);
  }
  async cancel(labId: string, runId: string): Promise<Run> {
    return this.projectRun(await this.runner.cancel(labId, runId));
  }
  async waitForRun(
    labId: string,
    runId: string,
    timeoutMs = 30_000,
  ): Promise<Run> {
    return this.projectRun(
      await this.runner.waitForRun(labId, runId, timeoutMs),
    );
  }
  async allRuns(): Promise<Run[]> {
    const inventory = await this.runner.inventory();
    const diagnosed = new Set(
      inventory.issues
        .filter((issue) => issue.runId !== undefined)
        .map((issue) => `${issue.labId}:${issue.runId}`),
    );
    return Promise.all(
      (await this.runner.allRuns())
        .filter((record) => !diagnosed.has(`${record.labId}:${record.id}`))
        .map((record) => this.projectRun(record)),
    );
  }
  async reconcile(): Promise<void> {
    return this.runner.reconcile();
  }
  async close(): Promise<void> {
    return this.runner.close();
  }

  async exportRun(labId: string, runId: string): Promise<RunArchive> {
    const run = await this.getRun(labId, runId);
    const execution = await this.runner.exportRun(labId, runId);
    return { schemaVersion: 1, run, execution };
  }
  async importRun(archive: RunArchive): Promise<Run> {
    if (archive.schemaVersion !== 1)
      throw new RunnerError("Unsupported archive version");

    const { run, execution } = archive;
    if (
      run.id !== execution.record.id ||
      run.labId !== execution.record.labId ||
      run.experimentId !== execution.record.experimentId
    )
      throw new RunnerError(
        "Scientific record and execution archive identifiers differ",
      );
    validateBundle(execution);
    const key = `${run.labId}:${run.id}`;
    if (this.imports.has(key))
      throw new RunnerError("Run import is already in progress", "conflict");
    this.imports.add(key);
    try {
      if (await this.files.hasRun(run.labId, run.id)) {
        const preserved = await this.files.readRun(run.labId, run.id);
        if (!isDeepStrictEqual(preserved, run))
          throw new RunnerError("Run identifier already exists", "conflict");
      }
      // A crash may have preserved provenance before the operational publish.
      // Only that same archive can finish the interrupted import.
      let published = true;
      try {
        await this.runner.getRun(run.labId, run.id);
      } catch (error) {
        if (!missingPublication(error)) throw error;
        published = false;
      }
      if (published)
        throw new RunnerError("Run identifier already exists", "conflict");
      await this.files.preserveRun(run);
      await this.runner.importRun(execution);
      return this.getRun(run.labId, run.id);
    } finally {
      this.imports.delete(key);
    }
  }
}

function missingPublication(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "missing"].includes(String(error.code))
  );
}
