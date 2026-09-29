import type {
  DatasetVersion,
  Experiment,
  MutationContext,
  Run,
  RunSnapshot,
} from "@/lab/contracts";
import { runSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import {
  type ResearchContext,
  scientificFields,
  timestamp,
} from "@/lab/research/mutations";
import { type NewRun, type RunPatch, terminal } from "@/lab/research/run-state";
export function createRun(
  context: ResearchContext,
  labId: string,
  input: NewRun,
  ctx: MutationContext,
): Run {
  return context.mutate(labId, "createRun", input, ctx, () => {
    const { id, ...initial } = input;
    const experiment = context.getRecord<Experiment>(
      labId,
      "experiment",
      input.experimentId,
    );
    if (experiment.status === "archived")
      throw new LabError(
        "BAD_REQUEST",
        "Archived experiments cannot be executed",
      );
    const runs = context.repo.runsForExperiment(labId, input.experimentId);
    const fields = parse(runSchema, {
      referenceRunId: null,
      status: "queued",
      target: "local",
      command: "",
      startedAt: null,
      endedAt: null,
      exitCode: null,
      error: null,
      metrics: [],
      artifacts: [],
      snapshot: null,
      ...initial,
      attempt: Math.max(0, ...runs.map((run) => run.attempt)) + 1,
    });
    if (fields.status !== "queued")
      throw new LabError("BAD_REQUEST", "New runs must start queued");
    if (fields.referenceRunId) {
      const reference = context.getRecord<Run>(
        labId,
        "run",
        fields.referenceRunId,
      );
      if (reference.experimentId !== experiment.id || !reference.snapshot)
        throw new LabError(
          "BAD_REQUEST",
          "Reference must be a preserved run of this experiment",
        );
    }
    if (fields.snapshot)
      validateSnapshot(
        context,
        labId,
        experiment,
        fields.snapshot,
        fields.referenceRunId,
      );
    return context.insert(labId, "run", {
      ...context.meta(labId, ctx.actor, id),
      ...fields,
    });
  });
}
export function updateRun(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: RunPatch,
  ctx: MutationContext,
): Run {
  return context.mutate(labId, "updateRun", { id, patch }, ctx, () => {
    const current = context.getRecord<Run>(labId, "run", id);
    if (terminal.has(current.status))
      throw new LabError(
        "CONFLICT",
        "Completed executions are immutable; start a new run",
      );
    const allowed = new Set([
      "status",
      "command",
      "startedAt",
      "endedAt",
      "exitCode",
      "error",
      "metrics",
      "artifacts",
      "snapshot",
    ]);
    if (Object.keys(patch).some((key) => !allowed.has(key)))
      throw new LabError(
        "BAD_REQUEST",
        "Run identity and references cannot be changed",
      );
    const fields = parse(runSchema, {
      ...scientificFields(current),
      ...patch,
    });
    if (current.status === "running" && fields.status === "queued")
      throw new LabError(
        "BAD_REQUEST",
        "A running job cannot return to the queue",
      );
    if (
      patch.snapshot !== undefined &&
      current.snapshot &&
      JSON.stringify(patch.snapshot) !== JSON.stringify(current.snapshot)
    ) {
      throw new LabError(
        "CONFLICT",
        "A captured execution snapshot cannot be replaced",
      );
    }
    if (fields.snapshot)
      validateSnapshot(
        context,
        labId,
        context.getRecord<Experiment>(
          labId,
          "experiment",
          current.experimentId,
        ),
        fields.snapshot,
        current.referenceRunId,
      );
    if (fields.status === "running" && (!fields.snapshot || !fields.startedAt))
      throw new LabError(
        "BAD_REQUEST",
        "Starting a run requires its snapshot and start time",
      );
    if (terminal.has(fields.status) && !fields.endedAt)
      throw new LabError("BAD_REQUEST", "Finished runs require an end time");
    if (
      fields.status === "succeeded" &&
      (fields.exitCode !== 0 || !fields.snapshot)
    )
      throw new LabError(
        "BAD_REQUEST",
        "Successful runs require a preserved snapshot and exit code zero",
      );
    const updated: Run = {
      ...current,
      ...fields,
      revision: current.revision + 1,
      updatedAt: timestamp(),
    };
    context.repo.replace("run", labId, updated);
    if (terminal.has(updated.status)) {
      context.event(
        labId,
        "run_completed",
        "run",
        id,
        `Run ${updated.attempt} ${updated.status}`,
        {
          runId: id,
          experimentId: updated.experimentId,
          status: updated.status,
        },
      );
    } else
      context.event(
        labId,
        "run_updated",
        "run",
        id,
        `Run ${updated.attempt} ${updated.status}`,
      );
    return updated;
  });
}
export function validateSnapshot(
  context: ResearchContext,
  labId: string,
  experiment: Experiment,
  snapshot: RunSnapshot,
  referenceRunId: string | null,
): void {
  if (snapshot.experimentId !== experiment.id)
    throw new LabError("BAD_REQUEST", "Snapshot belongs to another experiment");
  const historical =
    snapshot.experimentRevision === experiment.revision
      ? experiment
      : context.repo
          .revisions<Experiment>(experiment.id)
          .map((revision) => revision.snapshot)
          .find(
            (revision) => revision.revision === snapshot.experimentRevision,
          );
  if (!historical)
    throw new LabError(
      "BAD_REQUEST",
      "Snapshot references an unknown experiment revision",
    );
  if (
    snapshot.protocol !== historical.protocol ||
    snapshot.entrypoint !== historical.entrypoint ||
    snapshot.runtime !== historical.runtime ||
    JSON.stringify(snapshot.criteria) !== JSON.stringify(historical.criteria)
  ) {
    throw new LabError(
      "BAD_REQUEST",
      "Snapshot must preserve its experiment revision's protocol, criteria and entrypoint",
    );
  }
  if (!snapshot.codeFiles.some((file) => file.path === snapshot.entrypoint))
    throw new LabError(
      "BAD_REQUEST",
      "Snapshot does not contain its entrypoint",
    );
  if (
    snapshot.datasetInputs.length !== historical.datasetVersionIds.length ||
    new Set(snapshot.datasetInputs.map((dataset) => dataset.datasetVersionId))
      .size !== snapshot.datasetInputs.length
  ) {
    throw new LabError(
      "BAD_REQUEST",
      "Snapshot must preserve all dataset versions referenced by the protocol",
    );
  }
  for (const input of snapshot.datasetInputs) {
    const dataset = context.getRecord<DatasetVersion>(
      labId,
      "dataset",
      input.datasetVersionId,
    );
    if (
      !historical.datasetVersionIds.includes(dataset.id) ||
      dataset.manifestHash !== input.manifestHash ||
      JSON.stringify(dataset.files) !== JSON.stringify(input.files) ||
      dataset.name !== input.name ||
      dataset.version !== input.version
    ) {
      throw new LabError(
        "BAD_REQUEST",
        "Snapshot dataset manifest differs from its registered version",
      );
    }
  }
  if (referenceRunId) {
    const reference = context.getRecord<Run>(labId, "run", referenceRunId);
    if (
      !reference.snapshot ||
      reference.snapshot.codeHash !== snapshot.codeHash ||
      reference.snapshot.experimentRevision !== snapshot.experimentRevision
    ) {
      throw new LabError(
        "BAD_REQUEST",
        "Reproduction must preserve the reference code and protocol revision",
      );
    }
  }
}
