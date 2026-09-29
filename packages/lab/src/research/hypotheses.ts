import type {
  Hypothesis,
  MutationContext,
  NewHypothesis,
  Question,
  RecordMeta,
} from "@/lab/contracts";
import { hypothesisSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import { validateEvidenceForQuestion } from "@/lab/research/evidence";
import {
  type ResearchContext,
  scientificFields,
} from "@/lab/research/mutations";
export function createHypothesis(
  context: ResearchContext,
  labId: string,
  input: NewHypothesis,
  ctx: MutationContext,
): Hypothesis {
  return context.mutate(labId, "createHypothesis", input, ctx, () => {
    const fields = parse(hypothesisSchema, input);
    validateHypothesis(context, labId, fields);
    return context.insert(labId, "hypothesis", {
      ...context.meta(labId, ctx.actor),
      ...fields,
    });
  });
}
export function reviseHypothesis(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: Partial<NewHypothesis>,
  ctx: MutationContext,
  reason = "Updated hypothesis assessment",
): Hypothesis {
  return context.mutate(
    labId,
    "reviseHypothesis",
    { id, patch, reason },
    ctx,
    () => {
      const current = context.getRecord<Hypothesis>(labId, "hypothesis", id);
      const fields = parse(hypothesisSchema, {
        ...scientificFields(current),
        ...patch,
      });
      if (fields.questionId !== current.questionId)
        throw new LabError(
          "BAD_REQUEST",
          "Create a new hypothesis to investigate a different question",
        );
      validateHypothesis(context, labId, fields);
      return context.revise("hypothesis", current, fields, ctx.actor, reason);
    },
  );
}
export function validateHypothesis(
  context: ResearchContext,
  labId: string,
  fields: Omit<Hypothesis, keyof RecordMeta>,
): void {
  context.getRecord<Question>(labId, "question", fields.questionId);
  for (const resultId of fields.resultIds)
    validateEvidenceForQuestion(context, labId, resultId, fields.questionId);
  if (
    ["supported", "refuted", "inconclusive"].includes(fields.status) &&
    (!fields.resultIds.length || !fields.assessment.trim())
  ) {
    throw new LabError(
      "BAD_REQUEST",
      "Hypothesis assessments require an explanation and recorded evidence",
    );
  }
  if (
    ["supported", "refuted"].includes(fields.status) &&
    !fields.resultIds.some((id) => {
      const result = context.getRecord<import("@/lab/contracts").Result>(
        labId,
        "result",
        id,
      );
      return result.evidenceVersion === 1 && Boolean(result.evidence?.length);
    })
  )
    throw new LabError(
      "BAD_REQUEST",
      "Supported or refuted hypotheses require structured references to collected observations",
    );
}
