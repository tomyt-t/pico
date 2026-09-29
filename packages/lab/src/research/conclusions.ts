import type {
  Conclusion,
  MutationContext,
  NewConclusion,
  Paper,
  Question,
  RecordMeta,
} from "@/lab/contracts";
import { conclusionSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import {
  resultRevisions,
  validateEvidenceForQuestion,
} from "@/lab/research/evidence";
import {
  type ResearchContext,
  scientificFields,
} from "@/lab/research/mutations";
export function recordConclusion(
  context: ResearchContext,
  labId: string,
  input: NewConclusion,
  ctx: MutationContext,
): Conclusion {
  return context.mutate(labId, "recordConclusion", input, ctx, () => {
    const fields = parse(conclusionSchema, input);
    validateConclusion(context, labId, fields);
    return context.insert(labId, "conclusion", {
      ...context.meta(labId, ctx.actor),
      ...fields,
      resultRevisions: resultRevisions(context, labId, fields.resultIds),
      needsReview: false,
    });
  });
}
export function reviseConclusion(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: Partial<NewConclusion>,
  ctx: MutationContext,
  reason = "Revised conclusion in light of evidence",
): Conclusion {
  return context.mutate(
    labId,
    "reviseConclusion",
    { id, patch, reason },
    ctx,
    () => {
      const current = context.getRecord<Conclusion>(labId, "conclusion", id);
      const {
        resultRevisions: _basis,
        needsReview: _review,
        ...editable
      } = scientificFields(current);
      const fields = parse(conclusionSchema, {
        ...editable,
        ...patch,
      });
      if (
        fields.questionId !== current.questionId ||
        fields.supersedesId !== current.supersedesId
      ) {
        throw new LabError(
          "BAD_REQUEST",
          "A conclusion's question and historical predecessor cannot be changed",
        );
      }
      validateConclusion(context, labId, fields, id);
      return context.revise(
        "conclusion",
        current,
        {
          ...fields,
          resultRevisions: resultRevisions(context, labId, fields.resultIds),
          needsReview: false,
        },
        ctx.actor,
        reason,
      );
    },
  );
}
export function validateConclusion(
  context: ResearchContext,
  labId: string,
  fields: Omit<Conclusion, keyof RecordMeta>,
  currentId?: string,
): void {
  context.getRecord<Question>(labId, "question", fields.questionId);
  if (!fields.resultIds.length && !fields.paperIds.length)
    throw new LabError(
      "BAD_REQUEST",
      "Conclusions require recorded results or literature sources",
    );
  for (const resultId of fields.resultIds)
    validateEvidenceForQuestion(context, labId, resultId, fields.questionId);
  for (const paperId of fields.paperIds)
    context.getRecord<Paper>(labId, "paper", paperId);
  if (fields.supersedesId) {
    const previous = context.getRecord<Conclusion>(
      labId,
      "conclusion",
      fields.supersedesId,
    );
    if (previous.questionId !== fields.questionId)
      throw new LabError(
        "BAD_REQUEST",
        "A conclusion may only supersede one about the same question",
      );
    if (
      context.repo
        .list<Conclusion>("conclusion", labId)
        .some(
          (conclusion) =>
            conclusion.supersedesId === previous.id &&
            conclusion.id !== currentId,
        )
    ) {
      throw new LabError(
        "CONFLICT",
        "This conclusion has already been superseded; revise the latest conclusion",
      );
    }
  }
}
