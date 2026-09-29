import { expect, test } from "bun:test";
import type { Result } from "@pico/lab/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, routePath } from "@/web/app/navigation";
import { ResultHistory } from "@/web/features/experiments/result-history";
import { ResultLinks } from "@/web/features/overview/result-links";

const result: Result = {
  id: "result-a",
  labId: "lab-a",
  revision: 2,
  author: { kind: "researcher" },
  createdAt: "2026-09-29T12:00:00Z",
  updatedAt: "2026-09-29T13:00:00Z",
  experimentId: "experiment-a",
  runIds: ["run-a"],
  observations: "Corrected observations",
  interpretation: "Corrected interpretation",
  limitations: "Synthetic UI fixture",
  evidenceVersion: 1,
  evidence: [],
};

test("stale assessments navigate to the historical result revision they actually used", () => {
  const overview = { lab: { id: result.labId }, results: [result] };
  const html = renderToStaticMarkup(
    <ResultLinks
      row={{
        resultIds: [result.id],
        resultRevisions: [{ resultId: result.id, revision: 1 }],
      }}
      overview={overview}
    />,
  );
  const href =
    html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&") ?? "";
  expect(parseRoute(href)).toEqual({
    labId: result.labId,
    page: "experiments",
    id: result.experimentId,
    tab: "overview",
    focus: "result-result-a-revision-1",
  });
  const route = parseRoute(href);
  if (!route) throw new Error("Expected a navigable historical result");
  expect(routePath(route)).toBe(href);
  const current = renderToStaticMarkup(
    <ResultLinks
      row={{
        resultIds: [result.id],
        resultRevisions: [{ resultId: result.id, revision: 2 }],
      }}
      overview={overview}
    />,
  );
  expect(current).toContain("focus=result-result-a");
  expect(current).not.toContain("revision-2");
});

test("historical results load only when opened or explicitly selected", () => {
  const closed = renderToStaticMarkup(
    <ResultHistory result={result} runs={[]} />,
  );
  expect(closed).not.toContain("open=");
  expect(closed).not.toContain("loading");
  const selected = renderToStaticMarkup(
    <ResultHistory
      result={result}
      runs={[]}
      focus="result-result-a-revision-1"
    />,
  );
  expect(selected).toContain("open=");
  expect(selected).toContain("loading");
  expect(selected).not.toContain(result.observations);
});
