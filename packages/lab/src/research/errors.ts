import type { z } from "zod";
export class LabError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "LabError";
  }
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new LabError(
      "BAD_REQUEST",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}
