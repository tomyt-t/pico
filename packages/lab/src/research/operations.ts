import type { RunRecord } from "@pico/runner";
import { z } from "zod";
import type {
  DatasetVersion,
  Experiment,
  MutationContext,
  Run,
  RunRequest,
} from "@/lab/contracts";
import { executionResourcesSchema } from "@/lab/contracts";
import {
  createDatasetOperations,
  recoverDatasetPublication,
} from "@/lab/research/datasets";
import { EffectCoordinator, errorMessage } from "@/lab/research/effects";
import { LabError } from "@/lab/research/errors";
import type { ResearchExecution } from "@/lab/research/execution";
import type { Laboratory } from "@/lab/research/laboratory";
import { createSourceOperations } from "@/lab/research/papers";
import type { ExecutionPersistence } from "@/lab/research/persistence";
import { createWorkspace } from "@/lab/research/workspace";
import type { SourceAccess } from "@/lab/sources/source-access";

const runRequestSchema = z
  .object({
    resources: executionResourcesSchema.optional(),
    args: z.array(z.string()).max(100).optional(),
    config: z.record(z.string(), z.json()).optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    referenceRunId: z.string().optional(),
  })
  .strict();
export class ResearchOperations {
  readonly effects: EffectCoordinator;
  readonly workspace;
  readonly registerDataset;
  readonly importDatasetDirectory;
  readonly readDatasetFile;
  readonly searchLiterature;
  readonly importPaper;
  readonly accessSource;
  constructor(
    readonly lab: Laboratory,
    private readonly storage: ExecutionPersistence,
    readonly runner: ResearchExecution,
    sources?: SourceAccess,
  ) {
    this.effects = new EffectCoordinator(storage.operations);
    this.workspace = createWorkspace(lab, storage.files, this.effects);
    const datasets = createDatasetOperations(lab, storage, this.effects);
    this.registerDataset = datasets.registerDataset;
    this.importDatasetDirectory = datasets.importDatasetDirectory;
    this.readDatasetFile = datasets.readDatasetFile;
    const papers = createSourceOperations(lab, sources);
    this.searchLiterature = papers.searchLiterature;
    this.importPaper = papers.importPaper;
    this.accessSource = papers.accessSource;
  }
  async startRun(
    labId: string,
    experimentId: string,
    raw: RunRequest,
    ctx: MutationContext,
  ): Promise<Run> {
    this.lab.getLab(labId);
    const request = runRequestSchema.parse(raw);
    return this.effects.run(
      labId,
      "startRun",
      { experimentId, request },
      ctx,
      async (id) => {
        const settings = this.lab.getLab(labId).settings;
        if (!settings.executionEnabled)
          throw new LabError(
            "BAD_REQUEST",
            "Enable local execution in laboratory settings first",
          );
        const timeoutSeconds = request.timeoutSeconds ?? settings.maxRunSeconds;
        if (
          settings.maxRunSeconds !== null &&
          (timeoutSeconds === null || timeoutSeconds > settings.maxRunSeconds)
        )
          throw new LabError(
            "BAD_REQUEST",
            "Execution time exceeds the laboratory limit",
          );
        const experiment = this.lab.getRecord<Experiment>(
          labId,
          "experiment",
          experimentId,
        );
        const datasets = experiment.datasetVersionIds.map((datasetId) =>
          this.lab.getRecord<DatasetVersion>(labId, "dataset", datasetId),
        );
        const run = this.lab.createRun(
          labId,
          { id, experimentId, referenceRunId: request.referenceRunId ?? null },
          { ...ctx, key: `${ctx.key}:run` },
        );
        try {
          const submitted = await this.runner.submit({
            run,
            experiment,
            datasets,
            request,
            timeoutSeconds,
          });
          this.acceptRun(submitted);
          return this.lab.getRecord<Run>(labId, "run", run.id);
        } catch (error) {
          const current = this.lab.getRecord<Run>(labId, "run", run.id);
          // Publishing a runner record and projecting it into SQLite are separate effects.
          // A projection error must never label an already-submitted process as failed.
          let durableSubmission = false;
          try {
            await this.runner.getRun(labId, run.id);
            durableSubmission = true;
          } catch (inspectionError) {
            if (
              !(
                inspectionError instanceof Error &&
                "code" in inspectionError &&
                ["ENOENT", "missing"].includes(String(inspectionError.code))
              )
            ) {
              durableSubmission = true; // Ambiguous state: reconciliation must inspect it.
            }
          }
          if (current.status === "queued" && !durableSubmission)
            this.lab.updateRun(
              labId,
              run.id,
              {
                status: "failed",
                endedAt: new Date().toISOString(),
                error: errorMessage(error),
              },
              { key: `submission-failed:${run.id}`, actor: { kind: "system" } },
            );
          throw error;
        }
      },
    );
  }

  acceptRun(run: Run): void {
    const current = this.lab.getRecord<Run>(run.labId, "run", run.id);
    if (!["queued", "running"].includes(current.status)) return;
    const {
      status,
      command,
      startedAt,
      endedAt,
      exitCode,
      error,
      metrics,
      artifacts,
      snapshot,
    } = run;
    const patch = {
      status,
      command,
      startedAt,
      endedAt,
      exitCode,
      error,
      metrics,
      artifacts,
      snapshot,
    };
    if (
      JSON.stringify(patch) ===
      JSON.stringify(
        Object.fromEntries(
          Object.keys(patch).map((key) => [key, current[key as keyof Run]]),
        ),
      )
    )
      return;
    this.lab.updateRun(run.labId, run.id, patch, {
      key: `runner:${run.id}:${Bun.hash(JSON.stringify(patch)).toString(16)}`,
      actor: { kind: "system" },
    });
  }

  async acceptObservation(record: RunRecord): Promise<void> {
    this.acceptRun(await this.runner.projectRun(record));
  }
  async reconcile(): Promise<void> {
    // Startup calls this while dispatch is gated; callbacks may redeliver the same observation.
    await this.runner.reconcile();
    const inventory = await this.runner.runner.inventory();
    const runs = await this.runner.allRuns();
    for (const run of runs) this.acceptRun(run);
    for (const run of this.storage.research.activeRuns()) {
      if (
        !runs.some((item) => item.id === run.id) &&
        !inventory.issues.some(
          (issue) => issue.labId === run.labId && issue.runId === run.id,
        )
      )
        this.lab.updateRun(
          run.labId,
          run.id,
          {
            status: "interrupted",
            endedAt: new Date().toISOString(),
            error:
              "Submission was interrupted before a durable runner record was created. Start a new attempt.",
          },
          { key: `reconcile:${run.id}`, actor: { kind: "system" } },
        );
    }
    for (const effect of this.storage.operations.pendingEffects()) {
      if (this.effects.isInflight(effect.id)) continue;
      const recovered =
        effect.operation === "startRun"
          ? this.storage.research.get<Run>("run", effect.resourceId)
          : ["registerDatasetFiles", "importDatasetDirectory"].includes(
                effect.operation,
              )
            ? await recoverDatasetPublication(
                this.lab,
                this.storage,
                effect.labId,
                effect.resourceId,
              )
            : undefined;
      if (recovered) this.effects.complete(effect, recovered);
      else
        this.effects.fail(
          effect,
          "Operation was interrupted. Inspect the laboratory before starting a new intent.",
        );
    }
  }
  async cancelRun(
    labId: string,
    id: string,
    ctx: MutationContext,
  ): Promise<Run> {
    this.lab.getRecord(labId, "run", id);
    return this.effects.run(
      labId,
      "cancelRun",
      { runId: id },
      ctx,
      async () => {
        const run = await this.runner.cancel(labId, id);
        this.acceptRun(run);
        return this.lab.getRecord<Run>(labId, "run", id);
      },
    );
  }
}
export function createResearchOperations(
  lab: Laboratory,
  storage: ExecutionPersistence,
  execution: ResearchExecution,
  sources?: SourceAccess,
) {
  return new ResearchOperations(lab, storage, execution, sources);
}
