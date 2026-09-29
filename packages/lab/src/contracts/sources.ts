import { z } from "zod";

const url = z
  .string()
  .url()
  .max(4000)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  }, "Use a public HTTP(S) URL without credentials");

export const webSchemas = {
  web_search: z
    .object({
      query: z.string().min(3).max(2000),
      numResults: z.number().int().min(1).max(10).default(5),
      recencyFilter: z.enum(["day", "week", "month", "year"]).optional(),
      domainFilter: z.array(z.string().min(1).max(200)).max(10).optional(),
      provider: z.enum(["exa", "brave", "serpapi", "serper"]).optional(),
    })
    .strict(),
  fetch_content: z
    .object({ url, mode: z.enum(["readable", "raw"]).default("readable") })
    .strict(),
  get_search_content: z
    .object({
      responseId: z.string().min(1).max(200),
      url: url.optional(),
      urlIndex: z.number().int().min(0).optional(),
      queryIndex: z.number().int().min(0).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(16000).optional(),
      findText: z.string().min(1).max(500).optional(),
      findMode: z.enum(["exact", "case-insensitive"]).optional(),
    })
    .strict(),
};

export type WebToolName = keyof typeof webSchemas;
export const webToolNames = Object.keys(webSchemas) as WebToolName[];
