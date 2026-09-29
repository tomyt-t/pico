import { createHash } from "node:crypto";
import { z } from "zod";

export const TOOL_OUTPUT_BYTES = 24_000;
export const pageFields = {
  offset: z.number().int().nonnegative().default(0),
  maxBytes: z.number().int().min(128).max(12_000).default(8_000),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};

/** UTF-8 byte cursor. Never split a code point, so concatenated pages are exact. */
export function textPage(
  content: string,
  offset = 0,
  maxBytes = 8_000,
  expectedFingerprint?: string,
) {
  const bytes = Buffer.from(content);
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  if (offset && !expectedFingerprint)
    throw new Error(
      "Continuation requires the fingerprint returned by the first page",
    );
  if (expectedFingerprint && fingerprint !== expectedFingerprint)
    throw new Error(
      "The source changed between pages. Restart at offset 0; do not concatenate different revisions.",
    );
  const start = Math.min(offset, bytes.length);
  if (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80)
    throw new Error(
      "Offset must be a UTF-8 character boundary; use nextOffset from the previous page",
    );
  let end = Math.min(bytes.length, start + maxBytes);
  while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  while (
    Buffer.byteLength(
      JSON.stringify(bytes.subarray(start, end).toString("utf8")),
    ) >
    TOOL_OUTPUT_BYTES - 6_000
  ) {
    end = start + Math.floor((end - start) / 2);
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  }
  return {
    content: bytes.subarray(start, end).toString("utf8"),
    offset: start,
    totalBytes: bytes.length,
    nextOffset: end < bytes.length ? end : null,
    clipped: end < bytes.length,
    fingerprint,
  };
}

/** Small records retain their ordinary shape; large records expose exact JSON pages. */
export function jsonPage(
  value: unknown,
  offset = 0,
  maxBytes = 8_000,
  fingerprint?: string,
): unknown {
  const json = JSON.stringify(value ?? null);
  const page = textPage(json, offset, maxBytes, fingerprint);
  if (!offset && !fingerprint && Buffer.byteLength(json) <= maxBytes)
    return value;
  return { format: "json-text-page", ...page };
}

/** Final defense for every tool, including mutation acknowledgments and web adapters. */
export function boundedOutput(value: unknown, toolName?: string): unknown {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json) <= TOOL_OUTPUT_BYTES) return value ?? null;
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const kinds: Record<string, string> = {
    create_question: "question",
    revise_question: "question",
    create_hypothesis: "hypothesis",
    revise_hypothesis: "hypothesis",
    create_experiment: "experiment",
    revise_experiment: "experiment",
    register_dataset: "dataset",
    register_paper: "paper",
    import_paper: "paper",
    start_run: "run",
    cancel_run: "run",
    record_result: "result",
    revise_result: "result",
    record_conclusion: "conclusion",
    revise_conclusion: "conclusion",
  };
  const kind = toolName ? kinds[toolName] : undefined;
  return {
    clipped: true,
    detail:
      "Excerpt clipped. Use read_record/read_file/read_artifact/read_history with offset/maxBytes, or the source responseId, to read additional pages. Original scientific records remain preserved.",
    ...(typeof record?.id === "string" ? { id: record.id } : {}),
    ...(kind && typeof record?.id === "string"
      ? { record: { kind, id: record.id }, operationCompleted: true }
      : {}),
    ...(typeof record?.responseId === "string"
      ? { responseId: record.responseId }
      : {}),
    // JSON escaping can expand bytes up to 6x. Reserve that worst-case overhead.
    excerpt: textPage(json, 0, 3_000).content,
    totalBytes: Buffer.byteLength(json),
  };
}
