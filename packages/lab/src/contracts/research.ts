import { z } from "zod";
import type { RecordMeta } from "@/lab/contracts/record-metadata";
import {
  id,
  ids,
  optionalText,
  patchSchema,
  text,
} from "@/lab/contracts/validation";

export type QuestionStatus =
  | "open"
  | "partially_answered"
  | "answered"
  | "archived";

export interface Question extends RecordMeta {
  text: string;
  context: string;
  parentId: string | null;
  status: QuestionStatus;
}

export type HypothesisStatus =
  | "proposed"
  | "testing"
  | "supported"
  | "refuted"
  | "inconclusive"
  | "retired";

export interface Hypothesis extends RecordMeta {
  questionId: string;
  statement: string;
  rationale: string;
  status: HypothesisStatus;
  assessment: string;
  resultIds: string[];
}

export type ObservationReference =
  | {
      kind: "metric";
      runId: string;
      name: string;
      value: number;
      unit: string | null;
      split: string | null;
      step: number | null;
    }
  | { kind: "artifact"; runId: string; path: string; sha256: string };
export interface Result extends RecordMeta {
  /** Absent on preserved legacy records; no observations are fabricated on read. */
  evidenceVersion?: 1;
  evidence?: ObservationReference[];
  experimentId: string;
  runIds: string[];
  observations: string;
  interpretation: string;
  limitations: string;
}

export interface Conclusion extends RecordMeta {
  questionId: string;
  statement: string;
  resultIds: string[];
  paperIds: string[];
  confidence: "low" | "medium" | "high";
  limitations: string;
  status: "tentative" | "established" | "retracted";
  supersedesId: string | null;
}

export const questionSchema = z
  .object({
    text,
    context: optionalText,
    parentId: id.nullable().default(null),
    status: z
      .enum(["open", "partially_answered", "answered", "archived"])
      .default("open"),
  })
  .strict();
export const hypothesisSchema = z
  .object({
    questionId: id,
    statement: text,
    rationale: optionalText,
    status: z
      .enum([
        "proposed",
        "testing",
        "supported",
        "refuted",
        "inconclusive",
        "retired",
      ])
      .default("proposed"),
    assessment: optionalText,
    resultIds: ids.default([]),
  })
  .strict();
export const observationReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("metric"),
      runId: id,
      name: text.max(200),
      value: z.number().finite(),
      unit: z.string().nullable(),
      split: z.string().nullable(),
      step: z.number().finite().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("artifact"),
      runId: id,
      path: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const resultSchema = z
  .object({
    evidenceVersion: z.literal(1).optional(),
    evidence: z.array(observationReferenceSchema).max(1000).optional(),
    experimentId: id,
    runIds: ids.min(1),
    observations: text,
    interpretation: text,
    limitations: text,
  })
  .strict();
export const resultPatchSchema = patchSchema(
  resultSchema.pick({
    evidence: true,
    observations: true,
    interpretation: true,
    limitations: true,
  }),
);
export const conclusionSchema = z
  .object({
    questionId: id,
    statement: text,
    resultIds: ids.default([]),
    paperIds: ids.default([]),
    confidence: z.enum(["low", "medium", "high"]).default("low"),
    limitations: text,
    status: z
      .enum(["tentative", "established", "retracted"])
      .default("tentative"),
    supersedesId: id.nullable().default(null),
  })
  .strict();
export type NewQuestion = z.input<typeof questionSchema>;
export type NewHypothesis = z.input<typeof hypothesisSchema>;
export type NewResult = z.input<typeof resultSchema>;
export type ResultPatch = z.input<typeof resultPatchSchema>;
export type NewConclusion = z.input<typeof conclusionSchema>;
