import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { badRequest, errorMessage } from "./errors";
import { newId } from "./ids";
import type { Lab } from "./labs";
import type { Records, ResearchRecord } from "./records";

export interface PaperInput {
  url?: string;
  doi?: string;
  title?: string;
  notes?: string;
  id?: string;
}

export interface SavedPaper {
  record: ResearchRecord;
  file: string | null;
  text: string | null;
  chars: number;
  pages: number | null;
  warning: string | null;
}

interface Metadata {
  title?: string;
  authors: string[];
  url?: string;
  abstract?: string;
  doi?: string;
}

const userAgent =
  "Mozilla/5.0 (compatible; Pico research assistant; +https://github.com)";

async function crossref(doi: string): Promise<Metadata> {
  const cleaned = doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/i, "");
  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(cleaned)}`,
    {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw badRequest(
      `Crossref returned HTTP ${response.status} for ${cleaned}`,
    );
  const data = (await response.json()) as {
    message: {
      title?: string[];
      author?: { given?: string; family?: string }[];
      abstract?: string;
      URL?: string;
    };
  };
  const work = data.message;
  return {
    doi: cleaned,
    title: work.title?.join(" — "),
    authors: (work.author ?? [])
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean),
    url: `https://doi.org/${cleaned}`,
    abstract: work.abstract?.replace(/<[^>]*>/g, "").trim(),
  };
}

export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

async function pdfToText(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(bytes);
  const result = await extractText(document, { mergePages: true });
  return { text: result.text, pages: result.totalPages };
}

export async function savePaper(
  lab: Lab,
  records: Records,
  input: PaperInput,
  author: string,
): Promise<SavedPaper> {
  let metadata: Metadata = { authors: [] };
  if (input.doi) metadata = await crossref(input.doi);
  const url = input.url?.trim() || metadata.url;
  if (!url) throw badRequest("url or doi is required");
  const id = input.id?.trim() || newId("p");
  const dir = join(lab.path, "papers");
  mkdirSync(dir, { recursive: true });
  let file: string | null = null;
  let text: string | null = null;
  let pages: number | null = null;
  let warning: string | null = null;
  let title = input.title?.trim() || metadata.title;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "application/pdf, text/html;q=0.9, */*;q=0.8",
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 200 * 1024 * 1024)
      throw new Error("The source exceeds 200 MB");
    const contentType = response.headers.get("content-type") ?? "";
    const isPdf =
      contentType.includes("pdf") ||
      (bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46);
    if (isPdf) {
      file = join(dir, `${id}.pdf`);
      await writeFile(file, bytes);
      const extracted = await pdfToText(bytes);
      text = extracted.text;
      pages = extracted.pages;
    } else {
      const html = new TextDecoder().decode(bytes);
      file = join(dir, `${id}.html`);
      await writeFile(file, html);
      const extracted = htmlToText(html);
      text = extracted.text;
      title ||= extracted.title;
    }
  } catch (error) {
    warning = `Download failed: ${errorMessage(error)}`;
    if (!metadata.doi) throw badRequest(warning);
  }
  title ||= url;
  const textPath = join(dir, `${id}.md`);
  const retrievedAt = new Date().toISOString();
  const header = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `url: ${url}`,
    metadata.doi ? `doi: ${metadata.doi}` : null,
    metadata.authors.length
      ? `authors: ${JSON.stringify(metadata.authors)}`
      : null,
    `retrieved: ${retrievedAt}`,
    pages !== null ? `pages: ${pages}` : null,
    "---",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const body = text ?? metadata.abstract ?? "";
  await writeFile(textPath, `${header}${body}\n`);
  const record = records.save(
    lab.id,
    {
      id,
      kind: "paper",
      title,
      body:
        input.notes ??
        (metadata.abstract ? `Abstract: ${metadata.abstract}` : ""),
      fields: {
        url,
        doi: metadata.doi ?? null,
        authors: metadata.authors,
        file: file ? relative(lab.path, file) : null,
        text: relative(lab.path, textPath),
        chars: body.length,
        pages,
        retrievedAt,
        warning,
      },
    },
    author,
  );
  return { record, file, text: textPath, chars: body.length, pages, warning };
}
