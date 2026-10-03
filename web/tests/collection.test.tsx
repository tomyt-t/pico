import { describe, expect, spyOn, test } from "bun:test";
import type {
  FileEntry,
  Job,
  Lab,
  ResearchRecord,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import * as polling from "@/web/api/use-poll";
import { parseRoute, routePath } from "@/web/app/navigation";
import { FilePreview, rawUrl } from "@/web/components/file-preview";
import {
  FieldsTable,
  LinkChips,
  RecordRow,
} from "@/web/components/record-card";
import {
  applyFacets,
  collectionItems,
  emptyFacets,
  facetCounts,
  originOf,
} from "@/web/features/collection/collection-items";
import {
  CollectionPage,
  filterCollectionRecords,
  initialKinds,
  selectCollectionTab,
} from "@/web/features/collection/collection-page";
import { paperItems } from "@/web/features/library/library-page";

const at = "2026-09-30T12:00:00Z";
const lab: Lab = {
  id: "memoria urbana",
  name: "Memória urbana",
  path: "/labs/memoria-urbana",
  researchLine: "Relatos de um bairro",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: at,
  updatedAt: at,
};

function record(
  id: string,
  kind: ResearchRecord["kind"],
  fields: ResearchRecord["fields"] = {},
  extra: Partial<ResearchRecord> = {},
): ResearchRecord {
  return {
    id,
    labId: lab.id,
    kind,
    title: id,
    status: null,
    body: "",
    fields,
    links: [],
    author: "pico",
    revision: 1,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

const entry = (name: string): FileEntry => ({
  name,
  kind: "file",
  size: 100,
  modifiedAt: at,
});

const job = (id: string, extra: Partial<Job> = {}): Job => ({
  campaignId: null,
  id,
  labId: lab.id,
  name: id,
  command: "true",
  cwd: lab.path,
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
  createdAt: at,
  startedAt: at,
  endedAt: "2026-09-30T13:00:00Z",
  ...extra,
});

/** Renders the collection with the given records and jobs in place of the server. */
function withData<T>(
  records: ResearchRecord[],
  jobs: Job[],
  render: () => T,
): T {
  const spy = spyOn(polling, "usePoll").mockImplementation(
    <R,>(path: string | null) => ({
      path,
      data: (path?.includes("/records")
        ? records
        : path?.endsWith("/jobs")
          ? jobs
          : path?.includes("/files?path=papers")
            ? { kind: "directory", path: "papers", entries: [] }
            : undefined) as R | undefined,
      error: undefined,
      loading: false,
      refresh() {},
    }),
  );
  try {
    return render();
  } finally {
    spy.mockRestore();
  }
}

describe("collection", () => {
  test("all kinds remain searchable, including an unlinked dataset and provenance", () => {
    const dataset = record("d-relatos", "dataset", {
      path: "data/entrevistas",
      source: "Arquivo municipal",
      license: "CC BY 4.0",
    });
    const conclusion = {
      ...record("c-1", "conclusion"),
      status: "inconclusive",
      body: "As leituras permanecem divergentes.",
    };
    const records = [dataset, conclusion, record("p-1", "paper")];
    expect(filterCollectionRecords(records, "", "")).toEqual(records);
    expect(
      filterCollectionRecords(records, " ARQUIVO MUNICIPAL ", "dataset"),
    ).toEqual([dataset]);
    expect(filterCollectionRecords(records, "data/entrevistas", "")).toEqual([
      dataset,
    ]);
    expect(
      filterCollectionRecords(records, "divergentes", "conclusion"),
    ).toEqual([conclusion]);
    expect(filterCollectionRecords(records, "inconclusive", "dataset")).toEqual(
      [],
    );
    expect(filterCollectionRecords([], "", "")).toEqual([]);
  });

  test("a source keeps its formats and origin; a missing file keeps its record reachable", () => {
    const source = record("p-1", "paper", {
      file: "papers/memoria.pdf",
      text: "papers/memoria.md",
      url: "https://example.org/memoria",
    });
    const missing = record("p-2", "paper", { file: "papers/ausente.pdf" });
    const grouped = paperItems(
      [entry("memoria.pdf"), entry("memoria.md"), entry("notas-soltas.txt")],
      [source, missing],
    );
    const matched = grouped.items.find((item) => item.record?.id === source.id);
    expect(matched?.files.map((file) => file.path)).toEqual([
      "papers/memoria.pdf",
      "papers/memoria.md",
    ]);
    expect(
      grouped.items.find((item) => item.key === "notas-soltas")?.record,
    ).toBeUndefined();
    expect(grouped.unmatched).toEqual([missing]);
    const html = renderToStaticMarkup(
      <>
        <FieldsTable labId={lab.id} fields={source.fields} />
        <RecordRow record={missing} />
      </>,
    );
    expect(html).toContain('href="https://example.org/memoria"');
    expect(html).toContain("papers%2Fmemoria.pdf");
    expect(html).toContain("papers%2Fmemoria.md");
    expect(html).toContain(
      routePath({ labId: lab.id, page: "collection", id: missing.id }),
    );
  });

  test("the faceted list joins records, executions and loose source files with their notes", () => {
    const experiment = record(
      "e-1",
      "experiment",
      { path: "experiments/01" },
      {
        title: "Frente 01: base",
        author: "campaign:campaign-1",
      },
    );
    const result = record(
      "r-1",
      "result",
      {},
      { links: [{ kind: "experiment", id: "e-1" }], status: "sustained" },
    );
    const dataset = record(
      "d-1",
      "dataset",
      { files: 3, bytes: 2048, license: "CC BY 4.0" },
      { author: "subagent:run-1" },
    );
    const paper = record("p-1", "paper", { file: "papers/wu.pdf" });
    const run = job("job-1", { experimentId: "e-1", status: "failed" });
    const { items: papers } = paperItems(
      [entry("wu.pdf"), entry("loose.md")],
      [paper],
    );
    const items = collectionItems(
      [experiment, result, dataset, paper],
      [run],
      papers,
    );
    expect(items.map((item) => item.key)).toEqual([
      "job-1",
      "e-1",
      "r-1",
      "d-1",
      "p-1",
      "file:loose",
    ]);
    expect(items.find((item) => item.key === "d-1")?.note).toBe(
      "3 arquivos · 2 KB · CC BY 4.0",
    );
    expect(items.find((item) => item.key === "p-1")?.note).toBe("PDF · 100 B");
    expect(items.find((item) => item.key === "r-1")?.frontId).toBe("e-1");
    expect(items.find((item) => item.key === "job-1")?.frontId).toBe("e-1");
    expect(items.find((item) => item.key === "e-1")?.origin).toBe("campaign");
    expect(originOf("subagent:run-9")).toBe("subagent");
    expect(originOf("researcher")).toBe("researcher");
    const kinds = facetCounts(items, emptyFacets(), "", "kinds");
    expect(kinds.get("job")).toBe(1);
    expect(kinds.get("paper")).toBe(2);
    const onlyFront = applyFacets(items, {
      ...emptyFacets(),
      fronts: new Set(["e-1"]),
    });
    expect(onlyFront.map((item) => item.key)).toEqual(["job-1", "e-1", "r-1"]);
    // Counting one dimension ignores its own selection, so the other options stay reachable.
    expect(
      facetCounts(items, { ...emptyFacets(["job"]) }, "", "kinds").get(
        "dataset",
      ),
    ).toBe(1);
    expect(
      applyFacets(items, emptyFacets(), "cc by").map((item) => item.key),
    ).toEqual(["d-1"]);
  });

  test("unsupported orphan files keep a download scoped to their laboratory", () => {
    const file = {
      kind: "file" as const,
      path: "data/sem-registro.parquet",
      size: 2048,
      modifiedAt: at,
      binary: true,
      truncated: false,
      content: null,
    };
    const html = renderToStaticMarkup(
      <FilePreview labId={lab.id} file={file} />,
    );
    const download = rawUrl(lab.id, file.path, true);
    expect(html).toContain(download.replaceAll("&", "&amp;"));
    expect(download).not.toBe(rawUrl("outro-laboratorio", file.path, true));
    expect(html).not.toContain("outro-laboratorio");
  });

  test("a missing reference stays visible while execution details remain linked", () => {
    const html = renderToStaticMarkup(
      <LinkChips
        labId={lab.id}
        links={[
          { kind: "result", id: "r-ausente" },
          { kind: "job", id: "job-1" },
        ]}
        known={new Set()}
      />,
    );
    expect(html).toContain('class="pill-link missing"');
    expect(html).toContain("Referência não carregada nesta consulta");
    expect(html).toContain("r-ausente");
    expect(html).toContain("/experiments/r-ausente");
    expect(html).toContain(
      routePath({ labId: lab.id, page: "experiments", id: "job-1" }),
    );
  });

  const pressedFacets = (html: string) =>
    [
      ...html.matchAll(
        /<button type="button" class="facet-option" aria-pressed="true">.*?<span class="facet-option-label">([^<]+)<\/span>/g,
      ),
    ].map((match) => match[1]);

  test("record-kind deep links preselect the kind facet instead of the source catalog", () => {
    const records = [
      record("n-1", "note"),
      record("h-1", "hypothesis"),
      record("c-1", "conclusion"),
      record("p-1", "paper"),
    ];
    for (const [kind, label] of [
      ["note", "Notas"],
      ["hypothesis", "Hipóteses"],
      ["conclusion", "Conclusões"],
    ] as const) {
      const html = withData(records, [], () =>
        renderToStaticMarkup(
          <CollectionPage lab={lab} kind={kind} discuss={() => {}} />,
        ),
      );
      expect(html).toContain('class="toolbar collection-filter"');
      expect(pressedFacets(html)).toEqual([label]);
      expect(html).toContain(
        `#/labs/${encodeURIComponent(lab.id)}/collection/${kind.slice(0, 1)}-1`,
      );
      expect(html).not.toContain("p-1</span>");
    }
    expect(initialKinds({ kind: "paper,dataset" })).toEqual([
      "paper",
      "dataset",
    ]);
    expect(initialKinds({ tab: "sources" })).toEqual(["paper", "dataset"]);
    expect(initialKinds({ tab: "executions" })).toEqual(["job"]);
    expect(initialKinds({})).toEqual([]);
  });

  test("collection file deep links keep the workspace root and the way back to the list", () => {
    const html = withData([], [], () =>
      renderToStaticMarkup(
        <CollectionPage
          lab={lab}
          path="data/original.csv"
          discuss={() => {}}
        />,
      ),
    );
    expect(html).toContain(
      routePath({ labId: lab.id, page: "collection", path: "." }),
    );
    expect(html).toContain(
      routePath({ labId: lab.id, page: "collection", path: "data" }),
    );
    expect(html).toContain(
      `aria-current="page" href="${routePath({ labId: lab.id, page: "collection", path: "." })}"`,
    );
    expect(html).toContain(
      `href="${routePath({ labId: lab.id, page: "collection" })}"`,
    );
    expect(html).toContain("original.csv");
    expect(html).not.toContain("/labs/undefined/");
  });

  test("the legacy experiments route opens the collection on the executions facet, grouped by day", () => {
    const records = [record("e-1", "experiment", { path: "experiments/01" })];
    const jobs = [
      job("job-1", { experimentId: "e-1", name: "base v1" }),
      job("job-2", {
        experimentId: "e-1",
        name: "base v2",
        createdAt: "2026-10-01T09:00:00Z",
        startedAt: "2026-10-01T09:00:00Z",
        endedAt: "2026-10-01T09:30:00Z",
      }),
    ];
    const html = withData(records, jobs, () =>
      renderToStaticMarkup(
        <CollectionPage lab={lab} tab="executions" discuss={() => {}} />,
      ),
    );
    expect(pressedFacets(html)).toEqual(["Execuções"]);
    expect(html).toContain('class="record-row job-row is-done"');
    expect(html).toContain("base v2");
    expect(html).not.toContain('class="kind-chip kind-experiment"');
    expect(html.match(/class="collection-group-title"/g)).toHaveLength(2);
    expect(html.indexOf("base v2")).toBeLessThan(html.indexOf("base v1"));
    expect(html).toContain("2 itens");
    expect(html).not.toContain('class="page-heading"></header><header');
  });

  test("a paper path stays in the sources tab as the reader", () => {
    const html = withData([], [], () =>
      renderToStaticMarkup(
        <CollectionPage
          lab={lab}
          tab="sources"
          path="papers/memoria.pdf"
          discuss={() => {}}
        />,
      ),
    );
    expect(html).toContain('class="reader-page"');
    expect(html).toContain(
      `class="back" href="${routePath({ labId: lab.id, page: "collection", tab: "sources" })}"`,
    );
    expect(html).toContain(
      routePath({ labId: lab.id, page: "collection", path: "papers" }),
    );
    expect(html).not.toContain("/library");
    expect(html).not.toContain("Biblioteca");
    expect(selectCollectionTab({})).toEqual({ tab: "sources" });
    expect(selectCollectionTab({ tab: "executions" })).toEqual({
      tab: "executions",
    });
    expect(selectCollectionTab({ tab: "bogus" })).toEqual({ tab: "sources" });
    expect(selectCollectionTab({ path: "papers/x.pdf" })).toEqual({
      tab: "files",
    });
    expect(
      selectCollectionTab({ tab: "sources", path: "papers/x.pdf" }),
    ).toEqual({ tab: "sources", paper: "papers/x.pdf" });
    expect(selectCollectionTab({ tab: "sources", path: "data/a.csv" })).toEqual(
      { tab: "files" },
    );
    expect(selectCollectionTab({ kind: "note", tab: "files" })).toEqual({
      tab: "records",
    });
    expect(
      parseRoute(`#/labs/${encodeURIComponent(lab.id)}/experiments`),
    ).toEqual({ labId: lab.id, page: "experiments" });
  });
});
