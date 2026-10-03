import { describe, expect, spyOn, test } from "bun:test";
import type {
  Job,
  Lab,
  RecordHistoryEntry,
  ResearchRecord,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import * as polling from "@/web/api/use-poll";
import { authorLabel } from "@/web/components/format";
import { jobContext, jobSuperseded } from "@/web/components/job-row";
import { timelineDays } from "@/web/features/evolution/evolution-page";
import {
  frontNumber,
  frontState,
  frontsOf,
  frontTimeline,
  leadSentence,
  sourcesOf,
} from "@/web/features/fronts/fronts";
import { FrontsPage } from "@/web/features/fronts/fronts-page";

const lab: Lab = {
  id: "lab-a",
  name: "A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
};
const at = (hour: number, day = 30) =>
  `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
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

describe("fronts", () => {
  test("the number comes from the title, in either language and for pairs", () => {
    expect(
      frontNumber(record("e", "experiment", { title: "Frente 11 (x)" })),
    ).toBe("11");
    expect(
      frontNumber(record("e", "experiment", { title: "Frentes 03+04: y" })),
    ).toBe("03+04");
    expect(frontNumber(record("e", "experiment", { title: "Front 2" }))).toBe(
      "2",
    );
    expect(
      frontNumber(record("e", "experiment", { title: "Sem número" })),
    ).toBe(null);
  });

  test("the state follows the model's status, then the contents", () => {
    const e = (status: string | null) => record("e", "experiment", { status });
    const result = record("r", "result");
    expect(frontState(e("superseded by 08"), [], [], [])).toBe("superseded");
    expect(
      frontState(e("done"), [], [], [job("j", { status: "running" })]),
    ).toBe("busy");
    expect(frontState(e("draft"), [], [], [])).toBe("draft");
    expect(frontState(e("completed"), [], [], [])).toBe("done");
    expect(frontState(e("running"), [result], [], [])).toBe("done");
    expect(frontState(e("running"), [], [], [])).toBe("busy");
    expect(frontState(e(null), [], [], [])).toBe("new");
    expect(frontState(e(null), [], [], [job("j")])).toBe("busy");
    expect(frontState(e(null), [result], [], [])).toBe("done");
  });

  test("fronts sort by number, newest first, with unnumbered ones after", () => {
    const records = [
      record("e-3", "experiment", { title: "Frente 03", updatedAt: at(1) }),
      record("e-x", "experiment", { title: "Sem número", updatedAt: at(5) }),
      record("e-12", "experiment", { title: "Frente 12", updatedAt: at(2) }),
      record("r-12", "result", {
        links: [{ kind: "experiment", id: "e-12" }],
        updatedAt: at(3),
      }),
      record("c-12", "conclusion", {
        links: [{ kind: "result", id: "r-12" }],
        updatedAt: at(4),
        body: "Viável com a amostra atual. O resto é detalhe.",
      }),
    ];
    const fronts = frontsOf(records, []);
    expect(fronts.map((front) => front.experiment.id)).toEqual([
      "e-12",
      "e-3",
      "e-x",
    ]);
    expect(fronts[0]?.finding?.id).toBe("c-12");
    expect(fronts[0]?.results.map((r) => r.id)).toEqual(["r-12"]);
    expect(fronts[0]?.state).toBe("done");
    expect(fronts[2]?.state).toBe("new");
  });

  test("a finding leads with its first sentence", () => {
    expect(leadSentence("Viável com a amostra atual. O resto.")).toEqual([
      "Viável com a amostra atual.",
      "O resto.",
    ]);
    expect(leadSentence("Inventário PFF: 13.166 episódios.")).toEqual([
      "Inventário PFF:",
      "13.166 episódios.",
    ]);
    expect(leadSentence("Curto")).toEqual(["Curto", ""]);
  });

  test("sources and the timeline come from the front's own materials", () => {
    const experiment = record("e", "experiment", {
      title: "Frente 11",
      createdAt: at(9),
      links: [{ kind: "paper", id: "p-1" }],
    });
    const result = record("r", "result", {
      createdAt: at(11),
      links: [
        { kind: "experiment", id: "e" },
        { kind: "dataset", id: "d-1" },
        { kind: "paper", id: "p-1" },
      ],
    });
    const paper = record("p-1", "paper", { title: "TacticAI" });
    const run = job("j", {
      experimentId: "e",
      name: "inventory",
      startedAt: at(10),
      endedAt: at(10),
    });
    const [front] = frontsOf([experiment, result, paper], [run]);
    if (!front) throw new Error("front expected");
    expect(sourcesOf(front, [experiment, result, paper])).toEqual([
      { kind: "paper", id: "p-1", title: "TacticAI" },
      { kind: "dataset", id: "d-1", title: undefined },
    ]);
    const steps = frontTimeline(front, (author) => author.toUpperCase());
    expect(steps.map((step) => step.text)).toEqual([
      "Frente criada por PICO",
      "inventory iniciada",
      "inventory: Sucesso em 0s",
      "Resultado: r",
    ]);
    expect(steps[3]?.href).toBe("#/labs/lab-a/experiments/r");
  });

  test("the Frentes page shows the question board, the filters and one card per front", () => {
    const records = [
      record("q", "question", { title: "Decidido na fila?", status: "open" }),
      record("e-11", "experiment", {
        title: "Frente 11: escanteios",
        status: "draft",
        body: "Protocolo.",
        fields: { path: "experiments/11" },
      }),
      record("e-10", "experiment", {
        title: "Frente 10: altura",
        status: "done",
      }),
      record("r-10", "result", {
        title: "z só soma na chegada",
        body: "z só soma na chegada, +0,012. Nada no início.",
        links: [{ kind: "experiment", id: "e-10" }],
      }),
    ];
    const jobs = [
      job("j-1", { experimentId: "e-11", status: "failed", exitCode: 1 }),
      job("j-2", { experimentId: "e-11", createdAt: at(2) }),
    ];
    const spy = spyOn(polling, "usePoll").mockImplementation(
      <T,>(path: string | null) => ({
        path,
        data: (path?.includes("/records")
          ? records
          : path?.endsWith("/jobs")
            ? jobs
            : undefined) as T | undefined,
        error: undefined,
        loading: false,
        refresh() {},
      }),
    );
    try {
      const html = renderToStaticMarkup(
        <FrontsPage lab={lab} discuss={() => {}} />,
      );
      expect(html).toContain("Decidido na fila?");
      expect(html).toContain("#/labs/lab-a/investigations/q");
      expect(html).toContain("Em desenho");
      expect(html).toContain("Concluída");
      expect(html).toContain("<b>z só soma na chegada, +0,012.</b>");
      expect(html).toContain("2 execuções");
      expect(html).toContain("#/labs/lab-a/experiments/e-11");
      expect(html.indexOf("Frente 11")).toBeLessThan(html.indexOf("Frente 10"));
      expect(html).not.toContain("Materiais sem vínculo");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("execution context", () => {
  test("a failure the research moved past says so instead of staying red", () => {
    const experiment = record("e", "experiment");
    const failed = job("j-1", {
      experimentId: "e",
      status: "failed",
      exitCode: 1,
      createdAt: at(1),
    });
    const retry = job("j-2", {
      experimentId: "e",
      name: "v2",
      createdAt: at(2),
    });
    expect(jobSuperseded(failed, experiment, [], [failed, retry])).toBe(retry);
    expect(jobContext(failed, experiment, [], [failed, retry])).toBe(
      "substituída por v2",
    );
    const registered = record("r", "result", {
      links: [{ kind: "experiment", id: "e" }],
    });
    expect(jobContext(failed, experiment, [registered], [failed])).toBe(
      "resultado registrado apesar da falha",
    );
    expect(jobContext(failed, experiment, [], [failed])).toBe("1h 0m");
    expect(
      jobContext(
        job("j-3", {
          metrics: [
            { name: "acc", value: 1 },
            { name: "loss", value: 0 },
          ],
        }),
        undefined,
        [],
        [],
      ),
    ).toBe("1h 0m · 2 métricas lidas");
  });

  test("authors read as names, never as ids", () => {
    const names = new Map([
      ["run-1", "Editor de pesquisa"],
      ["campaign-1", "Escanteios"],
    ]);
    expect(authorLabel("pico")).toBe("Pico");
    expect(authorLabel("researcher")).toBe("pesquisador");
    expect(authorLabel("subagent:run-1", names)).toBe("Editor de pesquisa");
    expect(authorLabel("subagent:run-9", names)).toBe("Especialista");
    expect(authorLabel("campaign:campaign-1", names)).toBe(
      "Campanha Escanteios",
    );
    expect(authorLabel("campaign:campaign-9")).toBe("Campanha");
  });
});

describe("evolution timeline", () => {
  test("changes and executions share the day groups, newest first", () => {
    const created = (value: ResearchRecord): RecordHistoryEntry => ({
      type: "created",
      recordId: value.id,
      at: value.createdAt,
      author: value.author,
      reason: null,
      before: null,
      after: value,
    });
    const days = timelineDays(
      [
        created(record("n-1", "note", { createdAt: at(9, 29) })),
        created(record("n-2", "note", { createdAt: at(15, 30) })),
      ],
      [job("j", { endedAt: at(12, 30) })],
      Date.parse(at(18, 30)),
    );
    expect(days.map((day) => day.label)).toEqual(["Hoje", "Ontem"]);
    expect(days[0]?.items.map((item) => item.key)).toEqual(["n-2:1", "j"]);
    expect(days[1]?.items.map((item) => item.key)).toEqual(["n-1:1"]);
  });
});
