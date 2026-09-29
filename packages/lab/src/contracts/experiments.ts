import { z } from "zod";
import type { JsonObject } from "@/lab/contracts/json";
import type { FileManifest } from "@/lab/contracts/library";
import { fileSchema } from "@/lab/contracts/library";
import type { RecordMeta } from "@/lab/contracts/record-metadata";
import { id, ids, safePath, text } from "@/lab/contracts/validation";

export interface Criterion {
  hypothesisId: string;
  metric: string;
  expectation: string;
  comparator?: "gt" | "gte" | "lt" | "lte" | "eq";
  threshold?: number;
  split?: string;
  unit?: string;
}

export interface Experiment extends RecordMeta {
  title: string;
  objective: string;
  questionIds: string[];
  hypothesisIds: string[];
  protocol: string;
  criteria: Criterion[];
  datasetVersionIds: string[];
  entrypoint: string;
  runtime: "python" | "uv";
  status: "draft" | "ready" | "archived";
}

export interface DatasetInput {
  datasetVersionId: string;
  name: string;
  version: string;
  manifestHash: string;
  files: FileManifest[];
}

export interface RunSnapshot {
  schemaVersion: 1;
  experimentId: string;
  experimentRevision: number;
  protocol: string;
  criteria: Criterion[];
  entrypoint: string;
  runtime: "python" | "uv";
  args: string[];
  config: JsonObject;
  codeFiles: FileManifest[];
  codeHash: string;
  datasetInputs: DatasetInput[];
  environment: Record<string, string>;
  createdAt: string;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export interface Metric {
  name: string;
  value: number;
  unit: string | null;
  split: string | null;
  step: number | null;
}

export interface Artifact extends FileManifest {
  kind: "figure" | "table" | "model" | "log" | "other";
}

export interface Run extends RecordMeta {
  experimentId: string;
  attempt: number;
  referenceRunId: string | null;
  status: RunStatus;
  target: "local";
  command: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  metrics: Metric[];
  artifacts: Artifact[];
  snapshot: RunSnapshot | null;
}

export interface RunRequest {
  args?: string[];
  config?: JsonObject;
  timeoutSeconds?: number;
  referenceRunId?: string;
}

export const criterionSchema = z
  .object({
    hypothesisId: id,
    metric: text.max(200),
    expectation: text,
    comparator: z.enum(["gt", "gte", "lt", "lte", "eq"]).optional(),
    threshold: z.number().finite().optional(),
    split: z.string().max(200).optional(),
    unit: z.string().max(100).optional(),
  })
  .strict()
  .refine(
    (criterion) =>
      (criterion.comparator === undefined) ===
      (criterion.threshold === undefined),
    "Comparator and threshold must be supplied together",
  );
export const experimentSchema = z
  .object({
    title: text.max(300),
    objective: text,
    questionIds: ids.min(1),
    hypothesisIds: ids.default([]),
    protocol: text,
    criteria: z.array(criterionSchema).max(1_000).default([]),
    datasetVersionIds: ids.default([]),
    entrypoint: safePath.default("experiment.py"),
    runtime: z.enum(["python", "uv"]).default("python"),
    status: z.enum(["draft", "ready", "archived"]).default("draft"),
  })
  .strict();
export const metricSchema = z
  .object({
    name: text.max(200),
    value: z.number().finite(),
    unit: z.string().nullable(),
    split: z.string().nullable(),
    step: z.number().finite().nullable(),
  })
  .strict();
export const artifactSchema = fileSchema.extend({
  kind: z.enum(["figure", "table", "model", "log", "other"]),
});
export const runSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    experimentId: id,
    experimentRevision: z.number().int().positive(),
    protocol: text,
    criteria: z.array(criterionSchema),
    entrypoint: safePath,
    runtime: z.enum(["python", "uv"]),
    args: z.array(z.string()),
    config: z.record(z.string(), z.json()),
    codeFiles: z.array(fileSchema).min(1),
    codeHash: z.string().regex(/^[a-f0-9]{64}$/),
    datasetInputs: z.array(
      z
        .object({
          datasetVersionId: id,
          name: text,
          version: text,
          manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
          files: z.array(fileSchema).min(1),
        })
        .strict(),
    ),
    environment: z.record(z.string(), z.string()),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const runSchema = z
  .object({
    experimentId: id,
    attempt: z.number().int().positive(),
    referenceRunId: id.nullable(),
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
      "interrupted",
    ]),
    target: z.literal("local"),
    command: z.string().max(100_000),
    startedAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    exitCode: z.number().int().nullable(),
    error: z.string().nullable(),
    metrics: z.array(metricSchema),
    artifacts: z.array(artifactSchema),
    snapshot: runSnapshotSchema.nullable(),
  })
  .strict();
export type NewExperiment = z.input<typeof experimentSchema>;
