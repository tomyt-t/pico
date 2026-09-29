import { z } from "zod";
import {
  conclusionSchema,
  hypothesisSchema,
  patchSchema,
  questionSchema,
  resultPatchSchema,
  resultSchema,
} from "@/lab/contracts";
import type { ScientificKind } from "@/lab/research/laboratory";

const kinds = z.enum([
  "question",
  "hypothesis",
  "experiment",
  "dataset",
  "paper",
  "run",
  "result",
  "conclusion",
]);
const empty = z.object({}).strict();

import type { ToolScope } from "@/lab/pico/tools/tool-definition";

const id = z.string().min(1);

export function registerResearchTools({
  research,
  labId,
  tool,
}: ToolScope): void {
  tool("read_lab", "Read laboratory records and current progress.", empty, () =>
    research.overview(labId),
  );
  tool(
    "read_record",
    "Read one scientific record by ID, scoped to this research.",
    z.object({ kind: kinds, id }).strict(),
    (input) =>
      research.getRecord(labId, input.kind as ScientificKind, input.id),
  );
  tool(
    "create_question",
    "Record a research question within the line of research.",
    questionSchema,
    (input, ctx) => research.createQuestion(labId, input, ctx),
  );
  tool(
    "revise_question",
    "Revise or update a question, preserving its history.",
    z
      .object({
        id,
        patch: patchSchema(questionSchema),
        reason: z.string().min(1),
      })
      .strict(),
    (input, ctx) =>
      research.reviseQuestion(labId, input.id, input.patch, ctx, input.reason),
  );
  tool(
    "create_hypothesis",
    "Record a testable hypothesis for an existing question; optional during exploration.",
    hypothesisSchema,
    (input, ctx) => research.createHypothesis(labId, input, ctx),
  );
  tool(
    "revise_hypothesis",
    "Revise hypothesis or assess it against linked results; explain limitations.",
    z
      .object({
        id,
        patch: patchSchema(hypothesisSchema),
        reason: z.string().min(1),
      })
      .strict(),
    (input, ctx) =>
      research.reviseHypothesis(
        labId,
        input.id,
        input.patch,
        ctx,
        input.reason,
      ),
  );
  tool(
    "record_result",
    "Record observations, interpretation and limitations from terminal runs. Inspect actual metrics before citing numbers.",
    resultSchema,
    (input, ctx) => research.recordResult(labId, input, ctx),
  );
  tool(
    "revise_result",
    "Correct result observations, interpretation or limitations with a reason. Preserves its experiment, run evidence and previous analysis.",
    z
      .object({
        id,
        patch: resultPatchSchema,
        reason: z.string().min(1),
      })
      .strict(),
    (input, ctx) =>
      research.reviseResult(labId, input.id, input.patch, ctx, input.reason),
  );
  tool(
    "record_conclusion",
    "Record a provisional or established answer supported by linked results or sources, including limitations.",
    conclusionSchema,
    (input, ctx) => research.recordConclusion(labId, input, ctx),
  );
  tool(
    "revise_conclusion",
    "Revise a conclusion with a reason while preserving its previous statement and evidence.",
    z
      .object({
        id,
        patch: patchSchema(conclusionSchema),
        reason: z.string().min(1),
      })
      .strict(),
    (input, ctx) =>
      research.reviseConclusion(
        labId,
        input.id,
        input.patch,
        ctx,
        input.reason,
      ),
  );
}
