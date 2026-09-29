import { z } from "zod";

class LiteratureError extends Error {
  readonly code = "BAD_REQUEST";
}

const workSchema = z.object({
  DOI: z.string(),
  title: z.array(z.string()).default([]),
  author: z
    .array(
      z.object({ given: z.string().optional(), family: z.string().optional() }),
    )
    .default([]),
  abstract: z.string().optional(),
  URL: z.string().optional(),
});
function paper(work: z.infer<typeof workSchema>) {
  return {
    title: work.title.join(" — ") || work.DOI,
    authors: work.author
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean),
    identifier: work.DOI,
    url: `https://doi.org/${work.DOI}`,
    text: work.abstract
      ? work.abstract.replace(/<[^>]*>/g, "").trim()
      : "No abstract available in Crossref metadata. Read the linked paper before drawing substantive conclusions.",
    source: "Crossref metadata and abstract; not full paper text",
  };
}
async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`https://api.crossref.org/${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Pico/0.1 (local research laboratory)",
    },
    signal: AbortSignal.any([
      AbortSignal.timeout(20_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok)
    throw new LiteratureError(
      `Literature provider returned HTTP ${response.status}`,
    );
  return response.json();
}
export async function searchLiterature(query: string, signal?: AbortSignal) {
  const data = z
    .object({ message: z.object({ items: z.array(workSchema) }) })
    .parse(
      await request(
        `works?query.bibliographic=${encodeURIComponent(query)}&rows=8`,
        signal,
      ),
    );
  return data.message.items.map(paper);
}
export async function importLiterature(
  identifier: string,
  signal?: AbortSignal,
) {
  const doi = identifier
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi.org\//, "")
    .replace(/^doi:\s*/i, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(doi))
    throw new LiteratureError(
      "Import currently accepts a DOI or doi.org link. Add other sources with their title, URL and readable text.",
    );
  const data = z
    .object({ message: workSchema })
    .parse(await request(`works/${encodeURIComponent(doi)}`, signal));
  return paper(data.message);
}
