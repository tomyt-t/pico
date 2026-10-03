import { describe, expect, test } from "bun:test";
import type { Lab, ResearchRecord } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/web/app/app-shell";
import {
  parseRoute,
  type Route,
  recordRoute,
  routePath,
} from "@/web/app/navigation";
import { selectPages } from "@/web/features/pages/page-selection";

const at = "2026-09-30T12:00:00Z";
const lab: Lab = {
  id: "lab-a",
  name: "Pesquisa A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: at,
  updatedAt: at,
};
const page = (
  id: string,
  extra: Partial<ResearchRecord> = {},
): ResearchRecord => ({
  id,
  labId: lab.id,
  kind: "page",
  title: id,
  status: null,
  body: "",
  fields: {},
  links: [],
  author: "pico",
  revision: 1,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

describe("laboratory page selection", () => {
  test("selects the most recently updated designation, breaking ties by id", () => {
    const latestB = page("pg-b", { fields: { placement: "panorama" } });
    const latestA = page("pg-a", { fields: { placement: "panorama" } });
    const older = page("pg-old", {
      fields: { placement: "panorama" },
      updatedAt: "2026-09-29T12:00:00Z",
    });
    const plain = page("pg-plain");
    const unknown = page("pg-unknown", {
      fields: { placement: "unrecognized" },
    });
    const input = [latestB, older, unknown, latestA, plain];
    const selection = selectPages(lab.id, input);
    expect(selection.panorama).toBe(latestA);
    expect(selection.pages).toEqual([latestB, plain, unknown, older]);
    expect(input).toEqual([latestB, older, unknown, latestA, plain]);
  });

  test("a new revision changes the panorama without hiding the previous choice", () => {
    const first = page("pg-first", { fields: { placement: "panorama" } });
    const later = page("pg-later", { fields: { placement: "panorama" } });
    expect(selectPages(lab.id, [first, later]).panorama).toBe(first);
    const updated = {
      ...later,
      revision: 2,
      updatedAt: "2026-09-30T13:00:00Z",
    };
    expect(selectPages(lab.id, [first, updated])).toEqual({
      panorama: updated,
      pages: [first],
    });
  });

  test("labs and record kinds stay isolated, including unknown placements", () => {
    const foreign = page("pg-foreign", {
      labId: "lab-b",
      fields: { placement: "panorama" },
    });
    const note = page("n-note", {
      kind: "note",
      fields: { placement: "panorama" },
    });
    const local = page("pg-local", { fields: { placement: null } });
    const records = [foreign, note, local];
    expect(selectPages(lab.id, records)).toEqual({
      panorama: undefined,
      pages: [local],
    });
    expect(selectPages("lab-b", records)).toEqual({
      panorama: foreign,
      pages: [],
    });
    expect(selectPages("empty", records)).toEqual({
      panorama: undefined,
      pages: [],
    });
    expect(selectPages(lab.id, [])).toEqual({ panorama: undefined, pages: [] });
  });
});

describe("page routes and sidebar", () => {
  test("page links are encoded and all legacy routes remain valid", () => {
    const target = recordRoute("lab com espaço", {
      kind: "page",
      id: "pg/a b",
    });
    expect(target).toEqual({
      labId: "lab com espaço",
      page: "pages",
      id: "pg/a b",
    });
    expect(parseRoute(routePath(target))).toEqual(target);
    for (const page of [
      "overview",
      "library",
      "experiments",
      "files",
      "panorama",
    ] as const) {
      expect(parseRoute(routePath({ labId: lab.id, page }))?.page).toBe(page);
    }
    expect(parseRoute("#/labs/lab-a/collection?kind=page")?.kind).toBe("page");
    const tabbed: Route = {
      labId: lab.id,
      page: "collection",
      tab: "executions",
    };
    expect(parseRoute(routePath(tabbed))).toEqual(tabbed);
    expect(
      parseRoute("#/labs/lab-a/collection?path=papers%2Fa.pdf&tab=sources"),
    ).toEqual({
      labId: "lab-a",
      page: "collection",
      path: "papers/a.pdf",
      tab: "sources",
    });
    expect(parseRoute("#/labs/lab-a/collection?tab=")).toEqual({
      labId: "lab-a",
      page: "collection",
    });
    expect(parseRoute("#/labs/lab-a/experiments")).toEqual({
      labId: "lab-a",
      page: "experiments",
    });
    expect(recordRoute(lab.id, { kind: "", id: "page-1" }).page).toBe("pages");
    expect(recordRoute(lab.id, { kind: "note", id: "page-1" }).page).toBe(
      "collection",
    );
    expect(recordRoute(lab.id, { kind: "", id: "custom-page-id" }).page).toBe(
      "collection",
    );
  });

  const renderShell = (extra: Partial<Parameters<typeof AppShell>[0]> = {}) =>
    renderToStaticMarkup(
      <AppShell
        labs={[lab]}
        labId={lab.id}
        lab={lab}
        page="panorama"
        theme="dark"
        onTheme={() => {}}
        onSettings={() => {}}
        onRefresh={() => {}}
        {...extra}
      >
        <p>Conteúdo</p>
      </AppShell>,
    );

  test("an empty lab keeps fixed navigation without inventing dynamic pages", () => {
    const html = renderShell();
    expect(html).toContain('id="laboratory-navigation"');
    expect(html).not.toContain('class="sidebar-pages"');
    expect(html.match(/aria-current="page"/g)?.length).toBe(2);
  });

  test("long page titles stay accessible and foreign pages never appear", () => {
    const title = "Leituras divergentes e próximos caminhos ".repeat(8).trim();
    const local = page("pg-local", { title });
    const foreign = page("pg-foreign", {
      labId: "lab-b",
      title: "Exclusivo de B",
    });
    const html = renderShell({
      page: "pages",
      pageId: local.id,
      pages: [local, foreign],
    });
    expect(html).toContain(`aria-label="${title}"`);
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain('class="nav-label sidebar-page-title"');
    expect(html).not.toContain("Exclusivo de B");
    expect(
      html.match(/class="nav-item sidebar-page" aria-current="page"/g)?.length,
    ).toBe(2);
    const otherLab = { ...lab, id: "lab-b" };
    const switched = renderShell({
      labs: [otherLab],
      lab: otherLab,
      labId: otherLab.id,
      pages: [local, foreign],
    });
    expect(switched).toContain("Exclusivo de B");
    expect(switched).not.toContain(title);
  });

  test("the selected panorama is fixed navigation while other designations remain visible", () => {
    const panorama = page("pg-main", { fields: { placement: "panorama" } });
    const alternate = page("pg-alternate", {
      fields: { placement: "panorama" },
    });
    const html = renderShell({
      page: "pages",
      pageId: panorama.id,
      panorama,
      pages: [alternate, panorama],
    });
    expect(html.match(/class="nav-item sidebar-page"/g)?.length).toBe(2);
    expect(html).toContain(alternate.title);
    expect(
      html.match(/class="nav-item"[^>]*aria-current="page"/g)?.length,
    ).toBe(2);
    expect(renderShell({ page: "pages" })).not.toContain('aria-current="page"');
  });
});
