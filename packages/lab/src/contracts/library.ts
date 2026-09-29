import { z } from "zod";
import type { RecordMeta } from "@/lab/contracts/record-metadata";
import { optionalText, safePath, text } from "@/lab/contracts/validation";

export interface FileManifest {
  path: string;
  size: number;
  sha256: string;
  mimeType?: string;
}

export interface DatasetVersion extends RecordMeta {
  name: string;
  version: string;
  description: string;
  source: string;
  license: string;
  files: FileManifest[];
  manifestHash: string;
  splits: Record<string, number>;
}

export interface Paper extends RecordMeta {
  title: string;
  authors: string[];
  identifier: string;
  url: string;
  text: string;
  source: string;
}

export interface FileContentInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface DatasetRegistration {
  name: string;
  version: string;
  description?: string;
  source: string;
  license?: string;
  splits?: Record<string, number>;
  files: FileContentInput[];
}

export const fileSchema = z
  .object({
    path: safePath,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().max(200).optional(),
  })
  .strict();
export const datasetSchema = z
  .object({
    name: text.max(300),
    version: text.max(100),
    description: optionalText,
    source: text,
    license: optionalText,
    files: z.array(fileSchema).min(1).max(10_000),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    splits: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict();
export const paperSchema = z
  .object({
    title: text.max(1_000),
    authors: z.array(z.string().min(1)).default([]),
    identifier: optionalText,
    url: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
    text,
    source: text,
  })
  .strict();
export type NewDataset = z.input<typeof datasetSchema> & { id?: string };
export type NewPaper = z.input<typeof paperSchema>;
