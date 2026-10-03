import { expect, spyOn, test } from "bun:test";
import type {
  Lab,
  RecordDetailView,
  ResearchRecord,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import * as polling from "@/web/api/use-poll";
import { i18n } from "@/web/components/i18n";
import { PagesPage } from "@/web/features/pages/pages-page";

const at = "2026-09-30T12:00:00Z";
const lab: Lab = {
  id: "lab-a",
  name: "Lab A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: at,
  updatedAt: at,
};
const page: ResearchRecord = {
  id: "page-a",
  labId: lab.id,
  kind: "page",
  title: "Panorama atual",
  body: "Resumo alternativo atual",
  fields: {
    placement: "panorama",
    blocks: [
      { type: "markdown", text: "## Aprendizado atual" },
      { type: "artifact", path: "current.csv" },
    ],
  },
  links: [],
  status: null,
  author: "pico",
  revision: 2,
  createdAt: at,
  updatedAt: at,
};
const query = (
  data: ResearchRecord[] | undefined = [],
  panorama?: ResearchRecord,
) => ({
  path: "/pages",
  data,
  panorama,
  pages: (data ?? []).filter((record) => record !== panorama),
  error: undefined as string | undefined,
  loading: data === undefined,
  refresh() {},
});

/** A laboratory with no records, no jobs and no PICO.md. */
const emptyLab = () =>
  spyOn(polling, "usePoll").mockImplementation(<T,>(path: string | null) => ({
    path,
    data: (path?.endsWith("/editorial")
      ? {
          needsReview: false,
          panoramaMissing: true,
          pages: [],
          changes: [],
          activeRunId: null,
          lastRun: null,
        }
      : path?.includes("/files")
        ? undefined
        : []) as T | undefined,
    error: path?.includes("/files") ? "404" : undefined,
    loading: false,
    refresh() {},
  }));

test("an empty Panorama explains the next step without artificial page content", () => {
  const spy = emptyLab();
  try {
    const html = renderToStaticMarkup(
      <PagesPage
        lab={lab}
        query={query()}
        panorama
        discuss={() => {
          throw new Error("Unexpected discussion");
        }}
      />,
    );
    expect(html).toContain("Vamos construir o Panorama");
    expect(html).toContain("Planejar com Pico");
    expect(html).toContain("#/labs/lab-a/evolution");
    expect(html).not.toContain("record-detail");
    expect(html).not.toContain("Montado automaticamente");
    const pending = renderToStaticMarkup(
      <PagesPage
        lab={lab}
        query={{ ...query(), data: undefined, loading: true }}
        panorama
        discuss={() => {}}
      />,
    );
    expect(pending).toContain("Carregando registros");
    expect(pending).not.toContain("Vamos construir o Panorama");
  } finally {
    spy.mockRestore();
  }
});

test("a Panorama without a page is composed from the records", () => {
  const spy = spyOn(polling, "usePoll").mockImplementation(
    <T,>(path: string | null) => ({
      path,
      data: (path?.includes("/records")
        ? [{ ...page, id: "c-1", kind: "conclusion", title: "Elo prevê" }]
        : path?.endsWith("/jobs")
          ? []
          : undefined) as T | undefined,
      error: undefined,
      loading: false,
      refresh() {},
    }),
  );
  try {
    const html = renderToStaticMarkup(
      <PagesPage lab={lab} query={query()} panorama discuss={() => {}} />,
    );
    expect(html).toContain("Montado automaticamente");
    expect(html).toContain("Últimas conclusões");
    expect(html).toContain("Elo prevê");
    expect(html).not.toContain("Vamos construir o Panorama");
    const designated = renderToStaticMarkup(
      <PagesPage
        lab={lab}
        query={query([page], page)}
        panorama
        discuss={() => {}}
      />,
    );
    expect(designated).not.toContain("Montado automaticamente");
  } finally {
    spy.mockRestore();
  }
});

test("the pages index keeps the selected Panorama and ordinary pages accessible", () => {
  const ordinary = {
    ...page,
    id: "page-other",
    title: "Síntese qualitativa",
    fields: {},
  };
  const html = renderToStaticMarkup(
    <PagesPage
      lab={lab}
      query={query([page, ordinary], page)}
      discuss={() => {}}
    />,
  );
  expect(html).toContain("#/labs/lab-a/pages/page-a");
  expect(html).toContain("#/labs/lab-a/pages/page-other");
  expect(html).toContain("Síntese qualitativa");
});

test("the page reader shows current blocks and defers artifacts in closed revisions", () => {
  const requested: string[] = [];
  const detail: RecordDetailView = {
    record: page,
    revisions: [
      {
        revision: 1,
        snapshot: {
          ...page,
          revision: 1,
          title: "Título antigo",
          body: "Resumo antigo",
          fields: { blocks: [{ type: "artifact", path: "old.csv" }] },
        },
        author: "pico",
        reason: "Nova evidência",
        createdAt: at,
      },
    ],
  };
  const spy = spyOn(polling, "usePoll").mockImplementation(
    <T,>(path: string | null) => {
      if (path) requested.push(path);
      const data = path?.endsWith("/records/page-a")
        ? detail
        : path?.includes("/records")
          ? []
          : undefined;
      return {
        path,
        data: data as T | undefined,
        error: undefined,
        loading: !data,
        refresh() {},
      };
    },
  );
  try {
    const html = renderToStaticMarkup(
      <PagesPage
        lab={lab}
        id={page.id}
        query={query([page], page)}
        discuss={() => {}}
      />,
    );
    expect(html).toContain("Aprendizado atual");
    expect(html).toContain("Resumo alternativo atual");
    expect(html).toContain("Nova evidência");
    expect(html).not.toContain("Título antigo");
    expect(html).not.toContain("Resumo antigo");
    expect(requested.some((path) => path.includes("current.csv"))).toBe(true);
    expect(requested.some((path) => path.includes("old.csv"))).toBe(false);
    expect(html).not.toContain('"placement"');
  } finally {
    spy.mockRestore();
  }
});

test("a non-page record opened by a direct pages URL retains its normal content", () => {
  const record = {
    ...page,
    kind: "note" as const,
    body: "Conteúdo da nota",
    fields: { topic: "comparação" },
  };
  const spy = spyOn(polling, "usePoll").mockImplementation(
    <T,>(path: string | null) => ({
      path,
      data: (path?.endsWith("/records/page-a")
        ? { record, revisions: [] }
        : path?.includes("/records")
          ? []
          : undefined) as T,
      error: undefined,
      loading: false,
      refresh() {},
    }),
  );
  try {
    const html = renderToStaticMarkup(
      <PagesPage lab={lab} id={page.id} query={query()} discuss={() => {}} />,
    );
    expect(html).toContain("Conteúdo da nota");
    expect(html).toContain("comparação");
  } finally {
    spy.mockRestore();
  }
});

test("Panorama empty-state copy is available in English", async () => {
  const language = i18n.language;
  const spy = emptyLab();
  try {
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(
      <PagesPage lab={lab} query={query()} panorama discuss={() => {}} />,
    );
    expect(html).toContain("Plan with Pico");
    expect(html).toContain("Follow the research evolution");
    expect(html).not.toContain("pages.");
  } finally {
    spy.mockRestore();
    await i18n.changeLanguage(language);
  }
});
