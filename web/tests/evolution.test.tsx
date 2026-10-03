import { describe, expect, test } from "bun:test";
import type {
  Lab,
  RecordHistoryEntry,
  ResearchRecord,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignActivity } from "@/web/features/campaigns/campaign-activity";
import { diffTokenLimit, diffWords } from "@/web/features/evolution/diff";
import {
  EvolutionFeed,
  EvolutionPage,
  evolutionEntries,
} from "@/web/features/evolution/evolution-page";

const lab: Lab = {
  id: "lab",
  name: "Entrevistas",
  path: "/labs/lab",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
};
const record = (patch: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id: "h-1",
  labId: lab.id,
  kind: "hypothesis",
  title: "As entrevistas convergem?",
  status: "proposed",
  body: "Convergência inicial",
  fields: {},
  links: [],
  author: "pico",
  revision: 1,
  createdAt: lab.createdAt,
  updatedAt: lab.updatedAt,
  ...patch,
});
const created = (value: ResearchRecord): RecordHistoryEntry => ({
  type: "created",
  recordId: value.id,
  at: value.createdAt,
  author: value.author,
  reason: null,
  before: null,
  after: value,
});
const revised = (
  before: ResearchRecord,
  after: ResearchRecord,
  reason: string | null = null,
): RecordHistoryEntry => ({
  type: "revised",
  recordId: after.id,
  at: after.updatedAt,
  author: "researcher",
  reason,
  before,
  after,
});

describe("research evolution", () => {
  test("historical versions show a refutation, both sets of evidence and the transition author", () => {
    const before = record({
      links: [{ kind: "paper", id: "p-initial" }],
      fields: { participants: 3 },
    });
    const after = record({
      revision: 2,
      status: "refuted",
      body: "As entrevistas divergem no segundo grupo.",
      links: [{ kind: "paper", id: "p-contradiction" }],
      fields: { participants: 8 },
    });
    const html = renderToStaticMarkup(
      <EvolutionFeed
        entries={[
          revised(
            before,
            after,
            "Novas entrevistas contradizem a leitura inicial.",
          ),
        ]}
        discuss={() => {}}
      />,
    );
    expect(html).toContain("Revisão 1 → 2");
    expect(html).toContain("Por pesquisador");
    expect(html).toContain("Refutada");
    expect(html).toContain("Novas entrevistas contradizem a leitura inicial.");
    expect(html).toContain("Antes · revisão 1");
    expect(html).toContain("Depois · revisão 2");
    expect(html).toContain("Convergência inicial");
    expect(html).toContain("p-initial");
    expect(html).toContain("p-contradiction");
    expect(html).toContain("Os links abrem o estado atual");
    expect(html).toContain("#/labs/lab/collection/h-1");
  });

  test("a revision shows what changed word by word before the full versions", () => {
    const before = record({
      body: "As entrevistas convergem no primeiro grupo.",
    });
    const after = record({
      revision: 2,
      title: "As entrevistas divergem?",
      body: "As entrevistas divergem no segundo grupo.",
    });
    const html = renderToStaticMarkup(
      <EvolutionFeed entries={[revised(before, after)]} discuss={() => {}} />,
    );
    const diff = html.slice(
      html.indexOf('class="evolution-diff'),
      html.indexOf('class="evolution-full-versions"'),
    );
    expect(diff).toContain("<del>convergem </del><ins>divergem </ins>");
    expect(diff).toContain("<del>primeiro </del><ins>segundo </ins>");
    expect(diff).toContain("<del>convergem?</del><ins>divergem?</ins>");
    expect(html).toContain("Ver versões completas");
    expect(html.indexOf("Ver versões completas")).toBeLessThan(
      html.indexOf('class="evolution-snapshots"'),
    );
    expect(html).toContain("Antes · revisão 1");
    const unchangedText = renderToStaticMarkup(
      <EvolutionFeed
        entries={[
          revised(before, { ...before, revision: 2, status: "refuted" }),
        ]}
        discuss={() => {}}
      />,
    );
    expect(unchangedText).not.toContain("evolution-diff");
    expect(unchangedText).not.toContain("Ver versões completas");
    expect(unchangedText).toContain('class="evolution-snapshots"');
  });

  test("a link-only revision preserves the old evidence in the comparison", () => {
    const before = record({ links: [{ kind: "dataset", id: "d-old" }] });
    const after = record({
      revision: 2,
      links: [{ kind: "dataset", id: "d-new" }],
    });
    const html = renderToStaticMarkup(
      <EvolutionFeed entries={[revised(before, after)]} discuss={() => {}} />,
    );
    const comparison = html.slice(
      html.indexOf('class="evolution-snapshots"'),
      html.indexOf("</details>"),
    );
    expect(comparison).toContain("d-old");
    expect(comparison).toContain("d-new");
    expect(html).toContain("Motivo da revisão não registrado.");
  });

  test("notes and tentative conclusions remain recorded statements without invented explanations", () => {
    const note = record({
      id: "n-1",
      kind: "note",
      status: null,
      body: "Dependemos de uma nova coleta.",
    });
    const before = record({
      id: "c-1",
      kind: "conclusion",
      status: "tentative",
    });
    const after = { ...before, revision: 2, body: "", status: "inconclusive" };
    const html = renderToStaticMarkup(
      <EvolutionFeed
        entries={[created(note), revised(before, after)]}
        discuss={() => {}}
      />,
    );
    expect(html).toContain("Registro inicial");
    expect(html).toContain("Dependemos de uma nova coleta.");
    expect(html).toContain("Motivo da revisão não registrado.");
    expect(html).toContain("Nenhuma explicação em texto foi registrada.");
    expect(html).toContain("Inconclusiva");
    expect(html).not.toContain("100%");
  });

  test("merged categories keep chronological revision ordering and laboratory isolation", () => {
    const initial = record();
    const second = { ...initial, revision: 2 };
    const third = { ...initial, revision: 3 };
    const unrelated = created(
      record({ labId: "other", id: "n-other", kind: "note" }),
    );
    const entries = evolutionEntries(
      lab.id,
      [created(initial), unrelated],
      [revised(second, third)],
      [revised(initial, second)],
    );
    expect(entries.map((entry) => entry.after.revision)).toEqual([3, 2, 1]);
    expect(entries.every((entry) => entry.after.labId === lab.id)).toBe(true);
  });

  test("word diffs mark insertions, deletions and replacements and keep line breaks", () => {
    const join = (segments: { type: string; text: string }[], skip: string) =>
      segments
        .filter((segment) => segment.type !== skip)
        .map((segment) => segment.text)
        .join("");
    expect(diffWords("a b c", "a b c")).toEqual([
      { type: "same", text: "a b c" },
    ]);
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("a c", "a b c")).toEqual([
      { type: "same", text: "a " },
      { type: "ins", text: "b " },
      { type: "same", text: "c" },
    ]);
    expect(diffWords("a b c", "a c")).toEqual([
      { type: "same", text: "a " },
      { type: "del", text: "b " },
      { type: "same", text: "c" },
    ]);
    expect(diffWords("the old text", "the new text")).toEqual([
      { type: "same", text: "the " },
      { type: "del", text: "old " },
      { type: "ins", text: "new " },
      { type: "same", text: "text" },
    ]);
    const before = "one\ntwo\n\nthree four";
    const after = "one\nthree\n\nfour five";
    const segments = diffWords(before, after) ?? [];
    // Unchanged words carry the newer text's spacing, so the result reads as "after".
    expect(join(segments, "del")).toBe(after);
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    expect(words(join(segments, "ins"))).toEqual(words(before));
    expect(segments).toEqual([
      { type: "same", text: "one\n" },
      { type: "del", text: "two\n\n" },
      { type: "same", text: "three\n\nfour " },
      { type: "ins", text: "five" },
    ]);
    expect(diffWords("a  b", "a\nb")).toEqual([{ type: "same", text: "a\nb" }]);
    expect(diffWords("", "novo")).toEqual([{ type: "ins", text: "novo" }]);
    expect(diffWords("velho", "")).toEqual([{ type: "del", text: "velho" }]);
    expect(diffWords("x ".repeat(diffTokenLimit + 1), "y")).toBeNull();
    expect(diffWords("x ".repeat(diffTokenLimit), "y")).not.toBeNull();
  });

  test("initial loading does not claim absence or an idle conversation", () => {
    const evolution = renderToStaticMarkup(
      <EvolutionPage lab={lab} discuss={() => {}} />,
    );
    expect(evolution).toContain("Carregando registros");
    expect(evolution).not.toContain("Ainda não há mudanças registradas");
    expect(evolution).not.toContain("Nenhuma execução registrada");
    const activity = renderToStaticMarkup(<CampaignActivity lab={lab} />);
    // Unknown conversation state: a neutral dot, not an idle or busy one.
    expect(activity).toContain('class="dot"');
    expect(activity).not.toContain("dot idle");
    expect(activity).not.toContain("As perguntas aparecem aqui");
    expect(activity).not.toContain("Nenhuma execução registrada");
    expect(activity).not.toContain("Execução concluída não significa");
  });
});
