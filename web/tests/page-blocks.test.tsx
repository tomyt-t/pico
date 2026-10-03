import { describe, expect, spyOn, test } from "bun:test";
import type { FileView, ResearchRecord } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { labPath } from "@/web/api/http-client";
import * as polling from "@/web/api/use-poll";
import { routePath } from "@/web/app/navigation";
import { rawUrl } from "@/web/components/file-preview";
import { i18n } from "@/web/components/i18n";
import { PageBlocks } from "@/web/features/pages/page-blocks";

const labId = "história oral";
const at = "2026-09-30T12:00:00Z";
const record = (id: string, kind: ResearchRecord["kind"]): ResearchRecord => ({
  id,
  labId,
  kind,
  title: `Título ${id}`,
  body: "Um resumo provisório.",
  status: "tentative",
  fields: {},
  links: [],
  author: "pico",
  revision: 1,
  createdAt: at,
  updatedAt: at,
});

const htmlOf = (
  blocks: unknown,
  body = "Texto alternativo",
  records: ResearchRecord[] = [],
) =>
  renderToStaticMarkup(
    <PageBlocks labId={labId} blocks={blocks} body={body} records={records} />,
  );

describe("stored page blocks", () => {
  test("long Markdown preserves tables, lists, code and citations through the existing reader", () => {
    const long = "identificador_".repeat(50);
    const headings = Array.from(
      { length: 12 },
      (_, column) => `Coluna ${column}`,
    );
    const text = [
      "# Síntese da pesquisa",
      "",
      "- Uma observação",
      "- Uma limitação",
      "",
      `| ${headings.join(" | ")} |`,
      `| ${headings.map(() => "---").join(" | ")} |`,
      `| ${headings.map(() => long).join(" | ")} |`,
      "",
      "```text",
      `${long} <não executar>`,
      "```",
      "",
      "Uma leitura com fonte.[^1]",
      "",
      "[^1]: [Entrevista original](https://example.org/entrevista).",
      "",
      "![Foto externa](https://example.org/foto.png)",
    ].join("\n");
    const html = htmlOf([{ type: "markdown", text }]);
    expect(html).toContain("<h1>Síntese da pesquisa</h1>");
    expect(html.match(/<th>/g)).toHaveLength(12);
    expect(html.match(/<td>/g)).toHaveLength(12);
    expect(html).toContain("<li>Uma limitação</li>");
    expect(html).toContain(long);
    expect(html).toContain("&lt;não executar&gt;");
    expect(html).toContain('href="https://example.org/entrevista"');
    expect(html).toContain('data-footnote-ref="true"');
    expect(html).toContain('href="https://example.org/foto.png"');
    expect(html).not.toContain("<img");
    expect(html).toContain('class="page-alternative"');
  });

  test("cited records read as evidence rows with canonical links, never expanding referenced pages", () => {
    const question = { ...record("q-1", "question"), status: "open" };
    const page = {
      ...record("page-1", "page"),
      fields: {
        blocks: [
          { type: "records", ids: ["page-1"] },
          {
            type: "markdown",
            text: "Texto interno que não deve ser expandido",
          },
        ],
      },
    };
    const old = { ...record("r-old", "result"), status: "superseded-parcial" };
    const html = htmlOf(
      [{ type: "records", ids: [question.id, page.id, old.id] }],
      "",
      [question, page, old],
    );
    expect(html).toContain('<p class="evidence-label">Evidência</p>');
    expect(html).toContain(
      routePath({ labId, page: "investigations", id: question.id }),
    );
    expect(html).toContain(routePath({ labId, page: "pages", id: page.id }));
    expect(html.match(/class="evidence-row/g)).toHaveLength(3);
    expect(html).toContain('data-status="open"');
    expect(html).toContain('class="evidence-row is-superseded"');
    expect(html).toContain("superseded-parcial");
    expect(html).toContain("30 de set");
    expect(html).not.toContain("Texto interno que não deve ser expandido");
    expect(html).not.toContain('class="record-row"');
  });

  test("the first paragraph is the lead, figures are numbered and a limit reads as an aside", () => {
    const html = htmlOf([
      {
        type: "markdown",
        text: "A pergunta: quando o sinal decide?\n\n> Limite: metade dos instantes.\n\n> Nota: 0,50 é moeda.\n\n> Uma citação comum.",
      },
      {
        type: "artifact",
        path: "a.png",
        caption: "A curva, plana até o corte.",
      },
      { type: "markdown", text: "## Quando\n\nTexto." },
      { type: "artifact", path: "b.png" },
    ]);
    expect(html).toContain('class="page-block page-lead"');
    expect(html).toContain('<aside class="aside is-warn">');
    expect(html).toContain("Limite: metade dos instantes.");
    expect(html).toContain('<aside class="aside is-note">');
    expect(html).toContain("Nota: 0,50 é moeda.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<b>Figura 1</b> — A curva, plana até o corte.");
    expect(html).toContain("<b>Figura 2</b>");
    expect(html).toContain('class="figure-source"');
    expect(html).toContain(">b.png</a>");
    expect(html).not.toContain("Arquivo e origem");
    const heading = htmlOf([
      { type: "markdown", text: "## Só título\n\nTexto." },
    ]);
    expect(heading).not.toContain("page-lead");
  });

  test("unloaded references stay navigable and records from another lab cannot satisfy them", () => {
    const foreign = {
      ...record("shared-id", "note"),
      labId: "outro lab",
      title: "Outro laboratório confidencial",
    };
    const html = htmlOf(
      [{ type: "records", ids: ["shared-id", "missing #1"] }],
      "",
      [foreign],
    );
    expect(html).not.toContain(foreign.title);
    expect(html).not.toContain("outro lab");
    expect(html).toContain(
      routePath({ labId, page: "collection", id: "shared-id" }),
    );
    expect(html).toContain(
      routePath({ labId, page: "collection", id: "missing #1" }),
    );
    expect(html).toContain(i18n.t("pages.recordNotLoaded"));
    expect(html).not.toContain("404");
    expect(html).not.toContain("inexistente");
  });

  test("unknown and malformed blocks preserve valid neighbors; incomplete lists preserve valid IDs", () => {
    const saved = record("n-1", "note");
    const html = htmlOf(
      [
        { type: "unknown-widget", html: "<script>surprise()</script>" },
        null,
        { type: "markdown", text: "Conteúdo ainda legível" },
        { type: "records", ids: [saved.id, null, "", 12, saved.id] },
        { type: "artifact", path: 5 },
      ],
      "Texto alternativo",
      [saved],
    );
    expect(html).toContain("unknown-widget");
    expect(html).toContain(i18n.t("pages.invalidBlock", { index: 2 }));
    expect(html).toContain(i18n.t("pages.incompleteRecords", { index: 4 }));
    expect(html).toContain("Conteúdo ainda legível");
    expect(html.match(/Título n-1/g)).toHaveLength(1);
    expect(html).not.toContain("<script");
    expect(html).toContain("Texto alternativo");
  });

  test("body remains readable for absent, empty or entirely unusable blocks", () => {
    for (const blocks of [
      undefined,
      [],
      null,
      { type: "markdown", text: "wrong shape" },
      [
        { type: "markdown", text: " " },
        { type: "records", ids: [] },
        { type: "future" },
      ],
    ]) {
      const html = htmlOf(
        blocks,
        "## Texto alternativo\n\nA pesquisa permanece acessível.",
      );
      expect(html).toContain(
        '<h2 id="texto-alternativo">Texto alternativo</h2>',
      );
      expect(html).toContain("A pesquisa permanece acessível.");
      expect(html).not.toContain("wrong shape");
      expect(html).not.toContain('class="page-alternative"');
    }
    expect(htmlOf(undefined, "")).toContain(i18n.t("pages.emptyContent"));
  });

  test("an artifact remains linked and captioned while loading, even with query characters in its path", () => {
    const path = "data/conjunto #1?.parquet";
    const html = htmlOf([
      { type: "artifact", path, caption: "Legenda <provisória>" },
    ]);
    expect(html).toContain(
      routePath({ labId, page: "collection", path }).replaceAll("&", "&amp;"),
    );
    expect(html).toContain("Legenda &lt;provisória&gt;");
    expect(html).toContain(i18n.t("pages.loadingArtifact"));
    expect(html).toContain("Texto alternativo");
    const incomplete = htmlOf([
      { type: "artifact", path, caption: { invalid: true } },
    ]);
    expect(incomplete).toContain(i18n.t("pages.invalidBlock", { index: 1 }));
    expect(incomplete).toContain("data/conjunto #1?.parquet");
  });

  test("unsupported files retain the existing scoped download and folders retain a file-browser link", () => {
    const path = "data/observações.parquet";
    const file: FileView = {
      kind: "file",
      path,
      size: 128,
      modifiedAt: at,
      binary: true,
      content: null,
      truncated: false,
    };
    const query = spyOn(polling, "usePoll").mockReturnValue({
      path: "",
      data: file,
      loading: false,
      error: undefined,
      refresh: () => {},
    });
    try {
      const html = htmlOf([
        { type: "artifact", path, caption: "Dados originais" },
      ]);
      expect(query.mock.calls[0]?.[0]).toBe(
        labPath(labId, `/files?path=${encodeURIComponent(path)}`),
      );
      expect(html).toContain(i18n.t("files.binary"));
      expect(html).toContain(
        rawUrl(labId, path, true).replaceAll("&", "&amp;"),
      );
      expect(html).toContain("Dados originais");

      query.mockReturnValue({
        path: "",
        data: { kind: "directory", path: "data", entries: [] },
        loading: false,
        error: undefined,
        refresh: () => {},
      });
      const directory = htmlOf([{ type: "artifact", path: "data" }]);
      expect(directory).toContain(i18n.t("pages.artifactDirectory"));
      expect(directory).toContain(
        routePath({ labId, page: "collection", path: "data" }),
      );
      expect(directory).not.toContain("/files/raw");
    } finally {
      query.mockRestore();
    }
  });

  test("missing and unavailable artifacts show their error and retry without swallowing adjacent content", () => {
    const query = spyOn(polling, "usePoll").mockReturnValue({
      path: "",
      data: undefined,
      loading: false,
      error: "Path not found",
      refresh: () => {},
    });
    try {
      const html = htmlOf([
        { type: "artifact", path: "missing.txt" },
        { type: "markdown", text: "O restante continua aqui" },
      ]);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Path not found");
      expect(html).toContain(i18n.t("common.retry"));
      expect(html).toContain(
        routePath({ labId, page: "collection", path: "missing.txt" }),
      );
      expect(html).toContain("O restante continua aqui");
      expect(html).not.toContain(i18n.t("pages.emptyContent"));
      const onlyUnavailable = htmlOf(
        [{ type: "artifact", path: "missing.txt" }],
        "## A interpretação salva\n\nA ausência do arquivo não apaga este texto.",
      );
      expect(onlyUnavailable).toContain("Path not found");
      expect(onlyUnavailable).toContain(
        `<details class="page-alternative"><summary>${i18n.t("pages.alternativeReading")}</summary>`,
      );
      expect(onlyUnavailable).toContain(
        '<h2 id="a-interpretacao-salva">A interpretação salva</h2>',
      );
      expect(onlyUnavailable).toContain(
        "A ausência do arquivo não apaga este texto.",
      );
    } finally {
      query.mockRestore();
    }
  });
});
