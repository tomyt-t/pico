import { describe, expect, test } from "bun:test";
import type { Experiment, LabOverview, Metric, Run } from "@pico/lab/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, routePath } from "@/web/app/navigation";
import {
  compareMetrics,
  conditionsKey,
  latestRun,
} from "@/web/features/experiments/metric-comparison";
import { externalLink } from "@/web/features/library/external-link";
import { Overview } from "@/web/features/overview/overview-page";
import { questionRecords } from "@/web/features/overview/question-records";

const at = "2026-09-28T12:00:00Z";
const meta = {
  labId: "lab",
  createdAt: at,
  updatedAt: at,
  revision: 1,
  author: { kind: "pico" as const },
};
const experiment = (id: string, questionIds: string[]): Experiment => ({
  ...meta,
  id,
  title: `Experiment ${id}`,
  objective: "Observe behavior",
  questionIds,
  hypothesisIds: [],
  protocol: "Read a fixed input and report an observation.",
  criteria: [],
  datasetVersionIds: [],
  entrypoint: "main.py",
  runtime: "python",
  status: "draft",
});
const run = (id: string, metrics: Metric[], attempt = 1): Run => ({
  ...meta,
  id,
  experimentId: "experiment",
  attempt,
  referenceRunId: null,
  status: "succeeded",
  target: "local",
  command: "python main.py",
  startedAt: at,
  endedAt: at,
  exitCode: 0,
  error: null,
  metrics,
  artifacts: [],
  snapshot: null,
});
const metric = (patch: Partial<Metric> = {}): Metric => ({
  name: "accuracy",
  value: 0.5,
  unit: "ratio",
  split: "test",
  step: null,
  ...patch,
});
const overview = (): LabOverview => ({
  lab: {
    id: "lab",
    name: "Research lab",
    researchLine: "Learn how model defenses behave",
    createdAt: at,
    updatedAt: at,
    revision: 1,
    settings: {
      executionEnabled: false,
      maxRunSeconds: 120,
      maxConcurrentRuns: 1,
      maxModelSteps: 16,
      provider: { mode: "demo", baseUrl: "", model: "demo", apiKeyEnv: "" },
    },
  },
  questions: [
    {
      ...meta,
      id: "question-a",
      text: "Does the defense preserve useful behavior?",
      context: "A scoped comparison",
      parentId: null,
      status: "open",
    },
    {
      ...meta,
      id: "question-b",
      text: "How much latency does it add?",
      context: "",
      parentId: null,
      status: "open",
    },
  ],
  hypotheses: [
    {
      ...meta,
      id: "hypothesis-b",
      questionId: "question-b",
      statement: "Latency stays within a declared bound",
      rationale: "A testable proposal",
      status: "proposed",
      assessment: "",
      resultIds: [],
    },
  ],
  experiments: [
    experiment("exploratory-a", ["question-a"]),
    experiment("experiment-b", ["question-b"]),
  ],
  runs: [],
  results: [],
  conclusions: [],
  datasets: [],
  papers: [],
  events: [],
  conversation: {
    id: "conversation",
    labId: "lab",
    summary: "",
    summaryThroughMessageId: null,
    createdAt: at,
    updatedAt: at,
  },
  activeTurn: null,
});

describe("scientific comparisons", () => {
  test("different units, splits and steps never collapse into the same metric", () => {
    const rows = compareMetrics([
      run("a", [
        metric(),
        metric({ unit: "%", value: 50 }),
        metric({ split: null }),
        metric({ step: 1 }),
      ]),
      run("b", [metric({ value: 0.8 })]),
    ]);
    expect(rows).toHaveLength(4);
    expect(
      rows.find(
        (row) =>
          row.unit === "ratio" && row.split === "test" && row.step === null,
      )?.values,
    ).toEqual([0.5, 0.8]);
    expect(rows.find((row) => row.unit === "%")?.values).toEqual([50, null]);
  });
  test("zero is a measured value; duplicate selectors remain ambiguous", () => {
    const rows = compareMetrics([
      run("a", [metric({ value: 0 })]),
      run("b", [metric(), metric({ value: 0.9 })]),
    ]);
    expect(rows[0]?.values).toEqual([0, null]);
  });
  test("latest execution is selected by attempt within the experiment", () => {
    expect(
      latestRun(
        [
          run("third", [], 3),
          { ...run("unrelated", [], 9), experimentId: "other" },
          run("first", []),
        ],
        "experiment",
      )?.id,
    ).toBe("third");
  });
});

describe("question relationships", () => {
  test("an exploratory experiment belongs to its explicit question without a hypothesis", () => {
    const records = questionRecords(overview(), "question-a");
    expect(records.experiments.map((entry) => entry.id)).toEqual([
      "exploratory-a",
    ]);
    expect(records.hypotheses).toEqual([]);
  });
  test("question detail links the exploratory experiment and excludes unrelated research", () => {
    const html = renderToStaticMarkup(
      <Overview
        overview={overview()}
        questionId="question-a"
        discuss={() => {}}
      />,
    );
    expect(html).toContain("#/labs/lab/experiments/exploratory-a");
    expect(html).toContain("Exploratory");
    expect(html).not.toContain("Latency stays within a declared bound");
    expect(html).not.toContain("#/labs/lab/experiments/experiment-b");
    expect(html).toContain("No conclusion recorded");
  });
});

describe("navigation and sources", () => {
  test("resource navigation retains lab, resource and selected tab across reload", () => {
    const route = {
      labId: "lab with space",
      page: "experiments" as const,
      id: "run-group",
      tab: "runs",
    };
    expect(parseRoute(routePath(route))).toEqual(route);
    expect(parseRoute("#/labs/%broken/overview")).toBeNull();
  });
  test("external source links permit only web protocols", () => {
    expect(externalLink("https://arxiv.org/abs/example")).toBe(
      "https://arxiv.org/abs/example",
    );
    expect(externalLink("javascript:alert(1)")).toBeUndefined();
    expect(externalLink("file:///etc/passwd")).toBeUndefined();
    expect(externalLink("a citation without a URL")).toBeUndefined();
  });
});

test("comparison notices configuration changes but ignores JSON key ordering", () => {
  const first = run("first", []);
  first.snapshot = {
    schemaVersion: 1,
    experimentId: "experiment",
    experimentRevision: 1,
    protocol: "Measure",
    criteria: [],
    entrypoint: "main.py",
    runtime: "python",
    args: [],
    config: { seed: 42, model: "fixed" },
    codeFiles: [],
    codeHash: "hash",
    datasetInputs: [],
    environment: {},
    createdAt: at,
  };
  const reordered = {
    ...first,
    snapshot: { ...first.snapshot, config: { model: "fixed", seed: 42 } },
  };
  const changed = {
    ...first,
    snapshot: { ...first.snapshot, config: { model: "fixed", seed: 43 } },
  };
  expect(conditionsKey(first)).toBe(conditionsKey(reordered));
  expect(conditionsKey(first)).not.toBe(conditionsKey(changed));
});
