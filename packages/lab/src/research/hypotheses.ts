import type {
  Hypothesis,
  MutationContext,
  NewHypothesis,
  Question,
  RecordMeta,
} from "@/lab/contracts";
import { hypothesisSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import {
  resultRevisions,
  validateEvidenceForQuestion,
  validateHypothesisTest,
} from "@/lab/research/evidence";
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
      resultRevisions: resultRevisions(context, labId, fields.resultIds),
      needsReview: false,
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
      const {
        resultRevisions: _basis,
        needsReview: _review,
        ...editable
      } = scientificFields(current);
      const fields = parse(hypothesisSchema, {
        ...editable,
        ...patch,
      });
      if (fields.questionId !== current.questionId)
        throw new LabError(
          "BAD_REQUEST",
          "Create a new hypothesis to investigate a different question",
        );
      validateHypothesis(context, labId, fields, id);
      const claimChanged =
        fields.statement !== current.statement ||
        fields.rationale !== current.rationale;
      const reassessed =
        patch.assessment !== undefined ||
        (!claimChanged &&
          (patch.resultIds !== undefined || patch.status !== undefined));
      return context.revise(
        "hypothesis",
        current,
        {
          ...fields,
          ...(reassessed
            ? {
                resultRevisions: resultRevisions(
                  context,
                  labId,
                  fields.resultIds,
                ),
                needsReview: false,
              }
            : {}),
          ...(claimChanged && current.assessment.trim() && !reassessed
            ? { needsReview: true }
            : {}),
        },
        ctx.actor,
        reason,
      );
    },
  );
}
export function validateHypothesis(
  context: ResearchContext,
  labId: string,
  fields: Omit<Hypothesis, keyof RecordMeta>,
  currentId?: string,
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
  if (["supported", "refuted"].includes(fields.status)) {
    if (!currentId)
      throw new LabError(
        "BAD_REQUEST",
        "Register a hypothesis and its criteria before execution; a newly created hypothesis cannot already be supported or refuted",
      );
    validateHypothesisTest(context, labId, { ...fields, id: currentId });
  }
}
