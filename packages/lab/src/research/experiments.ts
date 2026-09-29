import type {
  DatasetVersion,
  Experiment,
  Hypothesis,
  MutationContext,
  NewExperiment,
  Question,
  RecordMeta,
  Run,
} from "@/lab/contracts";
import { experimentSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import {
  type ResearchContext,
  scientificFields,
} from "@/lab/research/mutations";
export function createExperiment(
  context: ResearchContext,
  labId: string,
  input: NewExperiment,
  ctx: MutationContext,
): Experiment {
  return context.mutate(labId, "createExperiment", input, ctx, () => {
    const fields = parse(experimentSchema, input);
    validateExperiment(context, labId, fields);
    return context.insert(labId, "experiment", {
      ...context.meta(labId, ctx.actor),
      ...fields,
    });
  });
}
export function reviseExperiment(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: Partial<NewExperiment>,
  ctx: MutationContext,
  reason = "Refined experimental protocol",
): Experiment {
  return context.mutate(
    labId,
    "reviseExperiment",
    { id, patch, reason },
    ctx,
    () => {
      const current = context.getRecord<Experiment>(labId, "experiment", id);
      const fields = parse(experimentSchema, {
        ...scientificFields(current),
        ...patch,
      });
      validateExperiment(context, labId, fields);
      const hasRuns = context.repo
        .list<Run>("run", labId)
        .some((run) => run.experimentId === id);
      if (
        hasRuns &&
        current.questionIds.some(
          (questionId) => !fields.questionIds.includes(questionId),
        )
      ) {
        throw new LabError(
          "BAD_REQUEST",
          "Question links used by recorded executions must be preserved",
        );
      }
      return context.revise("experiment", current, fields, ctx.actor, reason);
    },
  );
}
export function validateExperiment(
  context: ResearchContext,
  labId: string,
  fields: Omit<Experiment, keyof RecordMeta>,
): void {
  for (const questionId of fields.questionIds)
    context.getRecord<Question>(labId, "question", questionId);
  for (const hypothesisId of fields.hypothesisIds) {
    const hypothesis = context.getRecord<Hypothesis>(
      labId,
      "hypothesis",
      hypothesisId,
    );
    if (!fields.questionIds.includes(hypothesis.questionId))
      throw new LabError(
        "BAD_REQUEST",
        "Each hypothesis must belong to a question linked to this experiment",
      );
  }
  for (const criterion of fields.criteria) {
    if (!fields.hypothesisIds.includes(criterion.hypothesisId))
      throw new LabError(
        "BAD_REQUEST",
        "Criteria must reference a hypothesis tested by this experiment",
      );
  }
  for (const datasetId of fields.datasetVersionIds)
    context.getRecord<DatasetVersion>(labId, "dataset", datasetId);
}
