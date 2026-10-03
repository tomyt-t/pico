import { expect, test } from "bun:test";
import type { EditorialStatus, PageReviewStatus } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorialNotice } from "@/web/features/pages/editorial-notice";
import { PageBlocks } from "@/web/features/pages/page-blocks";

const page: PageReviewStatus = {
  pageId: "page-1",
  title: "Panorama",
  revision: 2,
  reviewedAt: "2026-10-01T12:00:00Z",
  state: "reviewed",
  summary: "Evidence and limits explained",
  pending: [],
  changedRecords: [],
  changedFiles: [],
  missingRecords: [],
  missingFiles: [],
  invalidBlocks: [],
  shape: [],
  contentChanged: false,
  contextChanged: false,
};
const status = (
  patch: Partial<EditorialStatus> = {},
  pagePatch: Partial<PageReviewStatus> = {},
): EditorialStatus => ({
  needsReview: false,
  panoramaMissing: false,
  pages: [{ ...page, ...pagePatch }],
  changes: [],
  activeRunId: null,
  lastRun: { id: "run-1", status: "completed", error: null },
  ...patch,
});
const html = (value: EditorialStatus) =>
  renderToStaticMarkup(
    <EditorialNotice
      labId="lab"
      status={value}
      pageId="page-1"
      discuss={() => {}}
    />,
  );

test("page notices distinguish recorded coverage, pending changes and active editing", () => {
  expect(html(status())).toContain("Revisado em");
  expect(html(status())).not.toContain("Revisar com Pico");
  const pending = html(
    status(
      {
        needsReview: true,
        changes: [
          { id: "r-2", title: "Later evidence", kind: "result", revision: 1 },
        ],
      },
      { state: "pending", changedRecords: ["r-2"] },
    ),
  );
  expect(pending).toContain("1 registro mudou desde a revisão de");
  expect(pending).toContain("Later evidence");
  expect(pending).toContain("Revisar com Pico");
  const running = html(
    status({ needsReview: true, activeRunId: "run-2" }, { state: "pending" }),
  );
  expect(running).toContain("Atualização em andamento");
  expect(running).not.toContain("Revisar com Pico");
});

test("partial failure and broken references remain visible after the agent leaves the sidebar", () => {
  const rendered = html(
    status(
      {
        needsReview: true,
        lastRun: { id: "run-1", status: "interrupted", error: null },
      },
      {
        state: "pending",
        pending: ["Compare revised interpretations"],
        missingFiles: ["figure.svg"],
        missingRecords: ["r-missing"],
        invalidBlocks: [3],
        contentChanged: true,
      },
    ),
  );
  for (const text of [
    "foi interrompida",
    "Compare revised interpretations",
    "figure.svg",
    "r-missing",
    "Blocos incompletos",
    "alterada depois da revisão",
  ])
    expect(rendered).toContain(text);
  expect(html(status({}, { state: "unreviewed", reviewedAt: null }))).toContain(
    "ainda não tem uma revisão editorial registrada",
  );
});

test("the reader removes an exact repeated title while preserving the explanatory blocks", () => {
  const rendered = renderToStaticMarkup(
    <PageBlocks
      labId="lab"
      title="Panorama"
      body="Fallback explanation"
      blocks={[
        {
          type: "markdown",
          text: "# Panorama\n\n## What changed\nEvidence and limitations.",
        },
      ]}
    />,
  );
  expect(rendered).not.toContain("<h1>Panorama</h1>");
  expect(rendered).toContain('<h2 id="what-changed">What changed</h2>');
  expect(rendered).toContain("Evidence and limitations.");
});

test("editorial notices explain pending changes to database context", () => {
  expect(
    html(
      status(
        { needsReview: true },
        { state: "pending", contextChanged: true, summary: "" },
      ),
    ),
  ).toContain("A direção ou as decisões do laboratório mudaram");
});
