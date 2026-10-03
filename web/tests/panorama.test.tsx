import { describe, expect, test } from "bun:test";
import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { picoSections } from "@/web/app/laboratory-queries";
import { i18n } from "@/web/components/i18n";
import { AutoPanorama, openFronts } from "@/web/features/pages/auto-panorama";

const lab: Lab = {
  id: "lab-a",
  name: "Lab A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};
const at = (hour: number) =>
  `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`;
const record = (
  id: string,
  kind: ResearchRecord["kind"],
  extra: Partial<ResearchRecord> = {},
): ResearchRecord => ({
  id,
  labId: lab.id,
  kind,
  title: id,
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

const pico = [
  "# Lab A",
  "",
  "## Linha de pesquisa",
  "",
  "Defesas **multimodais** contra ataques adversariais.",
  "",
  "## Direção atual",
  "",
  "- Comparar _baseline_ e defesa no conjunto de validação.",
  "",
  "## Decisões e convenções",
  "",
  "- experiments/<nome>/ guarda o código.",
].join("\n");
const template = [
  "# Lab A",
  "",
  "## Linha de pesquisa",
  "",
  "(a definir na conversa: comece explorando ideias e literatura com o Pico)",
  "",
  "## Direção atual",
  "",
  "- (o que estamos investigando agora e por quê)",
].join("\n");

const open = record("q-open", "question", {
  title: "A defesa resiste a ataques adaptativos?",
  status: "open",
  links: [{ kind: "hypothesis", id: "h-1" }],
});
const answered = record("q-done", "question", {
  title: "O baseline reproduz o paper?",
  status: "answered",
});
const materials = [
  record("h-1", "hypothesis", { status: "testing" }),
  record("e-1", "experiment", {
    links: [{ kind: "hypothesis", id: "h-1" }],
  }),
  record("r-1", "result", {
    title: "Acurácia cai 12 pontos",
    links: [{ kind: "experiment", id: "e-1" }],
    updatedAt: at(10),
  }),
  record("r-0", "result", {
    title: "Resultado antigo",
    links: [{ kind: "experiment", id: "e-1" }],
    updatedAt: at(1),
  }),
];
const conclusions = [1, 2, 3, 4, 5, 6].map((n) =>
  record(`c-${n}`, "conclusion", {
    title: `Conclusão ${n}`,
    updatedAt: at(n),
    links: n === 6 ? [{ kind: "result", id: "r-1" }] : [],
  }),
);
const collection = [
  record("p-1", "paper"),
  record("p-2", "paper"),
  record("d-1", "dataset"),
  record("n-1", "note"),
  record("n-2", "note"),
  record("n-3", "note"),
  record("page-1", "page", { title: "Síntese qualitativa" }),
];
const records = [open, answered, ...materials, ...conclusions, ...collection];
const jobs = [
  job("run-older", { endedAt: at(8) }),
  job("run-live", { status: "running", endedAt: null, createdAt: at(3) }),
  job("run-new", { endedAt: at(12) }),
  job("run-old", { status: "failed", endedAt: at(9) }),
  job("run-mid", { status: "stopped", endedAt: at(11) }),
];

const render = (
  props: Partial<Parameters<typeof AutoPanorama>[0]> = {},
  discuss: (text: string) => void = () => {},
) =>
  renderToStaticMarkup(
    <AutoPanorama
      lab={lab}
      records={records}
      jobs={jobs}
      pico={pico}
      discuss={discuss}
      {...props}
    />,
  );

describe("PICO.md sections", () => {
  test("placeholders left by the template count as absent, real text stays", () => {
    expect(picoSections(template)).toEqual({ researchLine: "", direction: "" });
    expect(picoSections(pico)).toEqual({
      researchLine: "Defesas **multimodais** contra ataques adversariais.",
      direction: "- Comparar _baseline_ e defesa no conjunto de validação.",
    });
    expect(
      picoSections(
        "## Direção atual\n\n- (o que estamos investigando)\n- Medir robustez.\n",
      ).direction,
    ).toBe("- Medir robustez.");
    expect(picoSections("")).toEqual({ researchLine: "", direction: "" });
  });
});

describe("automatic Panorama", () => {
  test("composes the research line, direction, fronts, conclusions, executions and collection", () => {
    const html = render();
    expect(html).toContain("Montado automaticamente");
    expect(html).toContain("Planejar com Pico");
    expect(html).not.toContain("Vamos construir o Panorama");
    expect(html).toContain(
      '<p class="panorama-lead">Defesas multimodais contra ataques adversariais.</p>',
    );
    expect(html).toContain("Direção atual");
    expect(html).toContain("<em>baseline</em>");
    expect(html).not.toContain("Decisões e convenções");

    expect(html).toContain("Frentes abertas");
    expect(html).toContain("#/labs/lab-a/investigations/q-open");
    expect(html).toContain("A defesa resiste a ataques adaptativos?");
    expect(html).not.toContain("O baseline reproduz o paper?");
    expect(html).toContain("5 materiais");
    expect(html).toContain("Acurácia cai 12 pontos");
    expect(html).not.toContain("Resultado antigo");
    expect(html).toContain('#/labs/lab-a/investigations"');

    expect(html).toContain("Últimas conclusões");
    for (const n of [2, 3, 4, 5, 6]) expect(html).toContain(`Conclusão ${n}<`);
    expect(html).not.toContain("Conclusão 1<");
    expect(html).toContain("#/labs/lab-a/collection?kind=conclusion");

    expect(html).toContain("Execuções");
    for (const name of ["run-live", "run-new", "run-mid", "run-old"])
      expect(html).toContain(`<span class="record-row-title">${name}</span>`);
    expect(html).not.toContain("run-older");
    expect(html.indexOf("run-live")).toBeLessThan(html.indexOf("run-new"));
    expect(html).toContain('href="#/labs/lab-a/experiments"');
    expect(html).toContain("#/labs/lab-a/experiments/run-live");

    expect(html).toContain("Acervo");
    const tile = (kind: string, count: number) =>
      `href="#/labs/lab-a/collection?kind=${kind}"><strong>${count}</strong>`;
    expect(html).toContain(tile("paper", 2));
    expect(html).toContain(tile("dataset", 1));
    expect(html).toContain(tile("experiment", 1));
    expect(html).toContain(tile("result", 2));
    expect(html).toContain(tile("note", 3));
    expect(html).not.toContain("Síntese qualitativa");
  });

  test("the plan button appends the Panorama request to the conversation", () => {
    const asked: string[] = [];
    const html = render({}, (text) => asked.push(text));
    expect(html).toContain("Planejar com Pico");
    expect(asked).toEqual([]);
  });

  test("fronts list only open questions; answered ones leave the section", () => {
    expect(openFronts(records, jobs).map((f) => f.question.id)).toEqual([
      "q-open",
    ]);
    const front = openFronts(records, jobs)[0];
    expect(front?.materials).toBe(5);
    expect(front?.evidence.map((r) => r.id)).toEqual(["r-1", "c-6"]);
    const closed = records.map((r) =>
      r.id === "q-open" ? { ...r, status: "answered" } : r,
    );
    expect(openFronts(closed, jobs)).toEqual([]);
    expect(render({ records: closed })).not.toContain("Frentes abertas");
  });

  test("sections without material are omitted", () => {
    const html = render({ records: [], jobs: [] });
    expect(html).toContain("Direção atual");
    expect(html).not.toContain("Frentes abertas");
    expect(html).not.toContain("Últimas conclusões");
    expect(html).not.toContain("Execuções");
    expect(html).not.toContain("Acervo");
    const onlyJobs = render({ records: [], pico: "" });
    expect(onlyJobs).toContain("Execuções");
    expect(onlyJobs).not.toContain("panorama-direction");
    expect(onlyJobs).not.toContain("Acervo");
  });

  test("an empty laboratory keeps the invitation to build the Panorama", () => {
    for (const content of ["", template]) {
      const html = render({ records: [], jobs: [], pico: content });
      expect(html).toContain("Vamos construir o Panorama");
      expect(html).toContain("Planejar com Pico");
      expect(html).toContain("#/labs/lab-a/evolution");
      expect(html).not.toContain("Montado automaticamente");
      expect(html).not.toContain("Direção atual");
    }
  });

  test("copy is available in English", async () => {
    const language = i18n.language;
    try {
      await i18n.changeLanguage("en");
      const html = render();
      expect(html).toContain("Composed automatically");
      expect(html).toContain("Current direction");
      expect(html).toContain("Open fronts");
      expect(html).toContain("Latest conclusions");
      expect(html).toContain("Executions");
      expect(html).toContain("Collection");
      expect(html).not.toContain("pages.");
    } finally {
      await i18n.changeLanguage(language);
    }
  });
});
