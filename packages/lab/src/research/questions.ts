import type { MutationContext, NewQuestion, Question } from "@/lab/contracts";
import { questionSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import {
  type ResearchContext,
  scientificFields,
} from "@/lab/research/mutations";
export function createQuestion(
  context: ResearchContext,
  labId: string,
  input: NewQuestion,
  ctx: MutationContext,
): Question {
  return context.mutate(labId, "createQuestion", input, ctx, () => {
    const fields = parse(questionSchema, input);
    if (fields.parentId)
      context.getRecord<Question>(labId, "question", fields.parentId);
    return context.insert(labId, "question", {
      ...context.meta(labId, ctx.actor),
      ...fields,
    });
  });
}
export function reviseQuestion(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: Partial<NewQuestion>,
  ctx: MutationContext,
  reason = "Refined research question",
): Question {
  return context.mutate(
    labId,
    "reviseQuestion",
    { id, patch, reason },
    ctx,
    () => {
      const current = context.getRecord<Question>(labId, "question", id);
      const fields = parse(questionSchema, {
        ...scientificFields(current),
        ...patch,
      });
      let parentId = fields.parentId;
      const seen = new Set([id]);
      while (parentId) {
        if (seen.has(parentId))
          throw new LabError(
            "BAD_REQUEST",
            "Question ancestry cannot contain cycles",
          );
        seen.add(parentId);
        parentId = context.getRecord<Question>(
          labId,
          "question",
          parentId,
        ).parentId;
      }
      return context.revise("question", current, fields, ctx.actor, reason);
    },
  );
}
