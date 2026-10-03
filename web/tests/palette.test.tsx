import { describe, expect, test } from "bun:test";
import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type Command,
  commandsFor,
  groupCommands,
  PaletteDialog,
  plain,
  resultLimit,
  searchCommands,
} from "@/web/app/command-palette";
import { i18n } from "@/web/components/i18n";

const at = (hour: number) =>
  `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`;
const lab: Lab = {
  id: "lab-a",
  name: "Pesquisa A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: at(0),
  updatedAt: at(0),
};
const other: Lab = {
  ...lab,
  id: "lab-b",
  name: "Futebol",
  researchLine: "Elo e dados",
};
const record = (
  id: string,
  kind: ResearchRecord["kind"],
  title: string,
  extra: Partial<ResearchRecord> = {},
): ResearchRecord => ({
  id,
  labId: lab.id,
  kind,
  title,
  status: null,
  body: "",
  fields: {},
  links: [],
  author: "pico",
  revision: 1,
  createdAt: at(0),
  updatedAt: at(0),
  ...extra,
});
const job = (id: string, extra: Partial<Job> = {}): Job => ({
  campaignId: null,
  id,
  labId: lab.id,
  name: id,
  command: "true",
  cwd: "/labs/a",
  status: "succeeded",
  pid: null,
  commitHash: null,
  logPath: "",
  metricsPath: "",
  metrics: null,
  exitCode: 0,
  error: null,
  experimentId: null,
  notified: true,
  createdAt: at(0),
  startedAt: at(0),
  endedAt: at(1),
  ...extra,
});

const records = [
  record("q-1", "question", "Elo prevê resultados?", {
    status: "open",
    updatedAt: at(5),
  }),
  record("c-1", "conclusion", "Conclusão sobre o modelo Elo", {
    status: "tentative",
    updatedAt: at(9),
  }),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    record(`n-${n}`, "note", `Nota ${n}`, { updatedAt: at(10 + n) }),
  ),
  record("page-1", "page", "Síntese do laboratório", { updatedAt: at(20) }),
];
const jobs = [
  job("treino-elo", { status: "running", endedAt: null }),
  job("avaliacao-final"),
];
const commands = commandsFor(lab, [lab, other], records, jobs);
const ids = (items: Command[]) => items.map((item) => item.id);

describe("command search", () => {
  test("matches without case or diacritics on titles and ids", () => {
    expect(plain("Conclusão Ética")).toBe("conclusao etica");
    expect(ids(searchCommands(commands, "conclusao"))).toEqual(["c-1"]);
    expect(ids(searchCommands(commands, "CONCLUSÃO"))).toEqual(["c-1"]);
    expect(ids(searchCommands(commands, "c-1"))).toEqual(["c-1"]);
    expect(ids(searchCommands(commands, "sintese"))).toEqual(["page-1"]);
    expect(ids(searchCommands(commands, "futebol"))).toEqual(["lab-b"]);
    expect(searchCommands(commands, "zzz")).toEqual([]);
  });

  test("prefix matches rank first, otherwise the given order holds", () => {
    expect(ids(searchCommands(commands, "elo"))).toEqual([
      "q-1",
      "c-1",
      "treino-elo",
    ]);
    const n = ids(searchCommands(commands, "nota"));
    expect(n).toEqual(["n-8", "n-7", "n-6", "n-5", "n-4", "n-3", "n-2", "n-1"]);
  });

  test("results are capped", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      record(`x-${i}`, "note", `Nota ${i}`),
    );
    const results = searchCommands(commandsFor(lab, [lab], many, []), "nota");
    expect(results).toHaveLength(resultLimit);
  });

  test("an empty query suggests navigation, recent records and running jobs", () => {
    const suggested = searchCommands(commands, "  ");
    expect(ids(suggested)).toEqual([
      "chat",
      "panorama",
      "investigations",
      "evolution",
      "collection",
      "settings",
      "n-8",
      "n-7",
      "n-6",
      "n-5",
      "n-4",
      "n-3",
      "treino-elo",
    ]);
    expect(suggested.some((item) => item.kind === "page")).toBe(false);
    expect(suggested.some((item) => item.kind === "lab")).toBe(false);
  });

  test("commands group in a fixed order and skip the current laboratory", () => {
    expect(groupCommands(commands).map((group) => group.kind)).toEqual([
      "navigation",
      "record",
      "job",
      "page",
      "lab",
    ]);
    expect(
      commands.filter((item) => item.kind === "lab").map((i) => i.id),
    ).toEqual(["lab-b"]);
    expect(commands.find((item) => item.kind === "page")?.id).toBe("page-1");
    expect(ids(commands.filter((item) => item.kind === "job"))).toEqual([
      "treino-elo",
      "avaliacao-final",
    ]);
    expect(groupCommands([])).toEqual([]);
  });
});

describe("palette dialog", () => {
  const render = (items: Command[]) =>
    renderToStaticMarkup(
      <PaletteDialog commands={items} onClose={() => {}} onSelect={() => {}} />,
    );

  test("renders a combobox over grouped options with one active entry", () => {
    const html = render(commands);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Páginas de navegação");
    expect(html).toContain("Registros");
    expect(html).toContain("Execuções");
    expect(html).not.toContain("Páginas do laboratório");
    expect(html).not.toContain("Laboratórios");
    expect(html.match(/role="option"/g)?.length).toBe(13);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    expect(html).toMatch(/aria-activedescendant="[^"]+-option-0"/);
    expect(html).toContain("Conversa");
    expect(html).toContain("Nota 8");
    expect(html).toContain("treino-elo");
    expect(html).toContain("Em execução");
    expect(html).toContain("<kbd>");
    expect(html).not.toContain("Nada encontrado");
  });

  test("an empty laboratory still offers navigation and explains empty results", () => {
    const html = render(commandsFor(lab, [lab], [], []));
    expect(html.match(/role="option"/g)?.length).toBe(6);
    expect(html).not.toContain("Registros");
    const nothing = render([]);
    expect(nothing).toContain("Nada encontrado.");
    expect(nothing).not.toContain("aria-activedescendant");
  });

  test("copy is available in English", async () => {
    const language = i18n.language;
    try {
      await i18n.changeLanguage("en");
      const html = render(commandsFor(lab, [lab, other], records, jobs));
      expect(html).toContain("Navigation pages");
      expect(html).toContain("Records");
      expect(html).toContain("Quick search");
      expect(html).not.toContain("palette.");
    } finally {
      await i18n.changeLanguage(language);
    }
  });
});
