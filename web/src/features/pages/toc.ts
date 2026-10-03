import type { ResearchRecord } from "@pico/server/contracts";

/** A stable id for a heading: lowercase, no diacritics, hyphens between words. */
export function headingId(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "secao"
  );
}

export interface Heading {
  id: string;
  text: string;
  /** 1-based line in the markdown it came from. */
  line: number;
}

/** The "## " headings of some markdown, outside code fences, with the ids the
 *  renderer gives them. Repeated titles get a numeric suffix, as the renderer does. */
export function markdownHeadings(
  markdown: string,
  seen = new Map<string, number>(),
) {
  const headings: Heading[] = [];
  // Fenced code keeps its line count so positions still match the renderer.
  const text = markdown.replace(/```[\s\S]*?```/g, (fence) =>
    fence.replace(/[^\n]/g, ""),
  );
  for (const match of text.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)) {
    const title = (match[1] ?? "")
      .replace(/[*_`]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();
    if (!title) continue;
    const line = text.slice(0, match.index ?? 0).split("\n").length;
    headings.push({ id: uniqueId(headingId(title), seen), text: title, line });
  }
  return headings;
}

export function uniqueId(base: string, seen: Map<string, number>): string {
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/** The sections of a page, from its markdown blocks or its body. */
export function pageHeadings(page: ResearchRecord): Heading[] {
  const blocks = Array.isArray(page.fields.blocks) ? page.fields.blocks : [];
  const texts = blocks.flatMap((block) =>
    block &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "markdown" &&
    typeof (block as { text?: unknown }).text === "string"
      ? [(block as { text: string }).text]
      : [],
  );
  const seen = new Map<string, number>();
  const source = texts.length ? texts : [page.body];
  return source.flatMap((text) => markdownHeadings(text, seen));
}
