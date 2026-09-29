import { z } from "zod";
/** A patch must never apply creation defaults to omitted fields. */
export function patchSchema<T extends Record<string, z.ZodType>>(
  schema: z.ZodObject<T>,
) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      z.optional(field instanceof z.ZodDefault ? field.removeDefault() : field),
    ]),
  );
  return z.object(shape).strict() as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<T[K]>;
  }>;
}

export const id = z.string().trim().min(1).max(200);
export const text = z.string().trim().min(1).max(100_000);
export const optionalText = z.string().max(100_000).default("");
export const ids = z
  .array(id)
  .max(1_000)
  .refine(
    (items) => new Set(items).size === items.length,
    "Duplicate references",
  );

export const safePath = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      path
        .split("/")
        .every((part) => part !== ".." && part !== "." && part !== ""),
    "Expected a relative file path",
  );
