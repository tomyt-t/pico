import type { Lab, LabContext } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { excerpt, markdownSection } from "@/web/components/format";

export const useLabs = () => usePoll<Lab[]>("/labs", 15_000);

/** Current Markdown context from SQLite; empty while loading. */
export function picoContent(context?: LabContext): string {
  return context?.content ?? "";
}

/** A line the template left for the conversation to fill: "(…)" or "- (…)". */
const placeholderLine = /^\s*(?:[-*]\s*)?\(.*\)\s*$/;

/** The laboratory context sections the interface composes from. The template's
 *  parenthetical placeholders count as absent, even as list items. */
export function picoSections(content: string): {
  researchLine: string;
  direction: string;
} {
  const read = (words: string[]) =>
    (markdownSection(content, words) ?? "")
      .split("\n")
      .filter((line) => !placeholderLine.test(line))
      .join("\n")
      .trim();
  return {
    researchLine: read(["linha de pesquisa", "research line"]),
    direction: read(["direção atual", "direcao atual", "current direction"]),
  };
}

/** The research line written in laboratory context, as one short plain-text line. */
export function researchLineFrom(context?: LabContext): string {
  return excerpt(picoSections(picoContent(context)).researchLine, 90);
}

export function useLabContext(labId: string) {
  return usePoll<LabContext>(labPath(labId, "/context"), 15_000);
}

/** The lab record wins; otherwise the line the conversation wrote into laboratory context. */
export function useResearchLine(lab: Lab): string {
  const file = useLabContext(lab.id);
  return lab.researchLine || researchLineFrom(file.data);
}
