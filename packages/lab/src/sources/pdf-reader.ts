import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";
import type { webSchemas } from "@/lab/sources/web-protocol";

const resultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  details: z
    .object({
      responseId: z.string(),
      urls: z.array(z.string()),
      title: z.string().optional(),
    })
    .passthrough(),
});
type Pdf = { text: string; title: string; url: string };
type ReadRequest = z.infer<typeof webSchemas.get_search_content>;

/** pi-web-access's CLI-oriented PDF result points at a file. Expose its actual text
 * through the same bounded web tools without granting arbitrary filesystem reads. */
export function createPdfReader(tempDir: string) {
  const papers = new Map<string, Pdf>();
  let retainedChars = 0;
  function read(input: ReadRequest) {
    const paper = papers.get(input.responseId);
    if (!paper) return null;
    if (
      (input.url && input.url !== paper.url) ||
      (input.urlIndex !== undefined && input.urlIndex !== 0) ||
      input.queryIndex !== undefined
    )
      throw new Error("PDF selector does not match the retrieved source");
    let offset = input.offset ?? 0;
    let limit = input.limit ?? 16000;
    let matchCount: number | undefined;
    if (input.findText) {
      const exact = input.findMode === "exact";
      const haystack = exact ? paper.text : paper.text.toLowerCase();
      const needle = exact ? input.findText : input.findText.toLowerCase();
      const match = haystack.indexOf(needle);
      matchCount = 0;
      for (
        let i = match;
        i >= 0;
        i = haystack.indexOf(needle, i + needle.length)
      )
        matchCount++;
      offset = Math.max(0, match - 400);
      limit = Math.min(16000, needle.length + 1200);
      if (match < 0)
        return {
          content: [
            {
              type: "text",
              text: "No matching passage found in the extracted PDF text.",
            },
          ],
          details: {
            responseId: input.responseId,
            url: paper.url,
            matchCount: 0,
            contentLength: paper.text.length,
          },
        };
    }
    if (offset > paper.text.length)
      throw new Error("PDF offset is outside the extracted text");
    const end = Math.min(paper.text.length, offset + limit);
    return {
      content: [{ type: "text", text: paper.text.slice(offset, end) }],
      details: {
        responseId: input.responseId,
        url: paper.url,
        title: paper.title,
        sourceType: "pdf",
        contentLength: paper.text.length,
        offset,
        returnedChars: end - offset,
        truncated: end < paper.text.length,
        nextOffset: end < paper.text.length ? end : null,
        ...(matchCount === undefined ? {} : { matchCount, returnedMatches: 1 }),
      },
    };
  }
  return {
    read,
    async hydrate(result: unknown) {
      const parsed = resultSchema.safeParse(result);
      if (!parsed.success) return result;
      const text = parsed.data.content.find(
        (part) => part.type === "text",
      )?.text;
      const match = text?.match(
        /^PDF extracted and saved to: (.+\.md)\n\nPages: \d+\nCharacters: \d+$/,
      );
      const path = match?.[1];
      if (!path) return result;
      const root = await realpath(join(tempDir, "pi-web-pdf"));
      const file = await realpath(path);
      if (!file.startsWith(`${root}${sep}`))
        throw new Error(
          "PDF file is outside this laboratory's temporary directory",
        );
      const info = await stat(file);
      if (!info.isFile() || info.size > 8_000_000)
        throw new Error("PDF text exceeds the reader limit");
      const content = await readFile(file, "utf8");
      const id = parsed.data.details.responseId;
      const url = parsed.data.details.urls[0];
      if (!url) throw new Error("PDF source URL is missing");
      retainedChars -= papers.get(id)?.text.length ?? 0;
      papers.set(id, {
        text: content,
        url,
        title: parsed.data.details.title ?? url,
      });
      retainedChars += content.length;
      while (retainedChars > 16_000_000 || papers.size > 100) {
        const oldest = papers.entries().next().value;
        if (!oldest) break;
        retainedChars -= oldest[1].text.length;
        papers.delete(oldest[0]);
      }
      return read({ responseId: id });
    },
  };
}
