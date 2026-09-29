import { expect, test } from "bun:test";
import type { LabOverview, Run } from "@pico/lab/contracts";
import { verifyGlmProtocol, verifyPairs } from "../../scripts/glm-protocol";

const pairs = Array.from({ length: 24 }, (_, i) => ({
  baseline: i / 24,
  treatment: i / 24 + 0.2,
  difference: 0.2,
}));
const meta = {
  labId: "lab",
  revision: 1,
  author: { kind: "researcher" as const },
  createdAt: "2026-09-29T12:00:00Z",
  updatedAt: "2026-09-29T12:00:00Z",
};
function fixture(): Pick<
  LabOverview,
  "runs" | "hypotheses" | "results" | "conclusions"
> {
  const original: Run = {
    ...meta,
    id: "original",
    experimentId: "experiment",
    attempt: 1,
    referenceRunId: null,
    status: "succeeded",
    target: "local",
    command: "python experiment.py",
    startedAt: meta.createdAt,
    endedAt: meta.createdAt,
    exitCode: 0,
    error: null,
    metrics: [
      { name: "delta", value: 0.2, unit: null, split: null, step: null },
    ],
    artifacts: [
      { path: "pairs.json", size: 100, sha256: "a".repeat(64), kind: "table" },
    ],
    snapshot: {
      schemaVersion: 1,
      experimentId: "experiment",
      experimentRevision: 1,
      protocol: "Compute the prescribed deterministic pairs",
      criteria: [
        {
          hypothesisId: "hypothesis",
          hypothesisRevision: 1,
          metric: "delta",
          expectation: "More than 0.1",
          comparator: "gt",
          threshold: 0.1,
        },
      ],
      entrypoint: "experiment.py",
      runtime: "python",
      args: [],
      config: {},
      codeFiles: [{ path: "experiment.py", size: 10, sha256: "b".repeat(64) }],
      codeHash: "c".repeat(64),
      datasetInputs: [],
      environment: { runtime: "python" },
      createdAt: meta.createdAt,
    },
  };
  const reproduction: Run = {
    ...original,
    id: "reproduction",
    attempt: 2,
    referenceRunId: original.id,
  };
  return {
    runs: [original, reproduction],
    results: [
      {
        ...meta,
        id: "result",
        experimentId: "experiment",
        runIds: [original.id, reproduction.id],
        evidenceVersion: 1,
        evidence: [original, reproduction].map((run) => ({
          kind: "metric",
          runId: run.id,
          name: "delta",
          value: 0.2,
          unit: null,
          split: null,
          step: null,
        })),
        observations: "24 deterministic pairs",
        interpretation: "Infrastructure example",
        limitations: "Synthetic data",
      },
    ],
    hypotheses: [
      {
        ...meta,
        id: "hypothesis",
        questionId: "question",
        statement: "delta exceeds 0.1",
        rationale: "Synthetic test",
        status: "supported",
        assessment: "Both runs match the prediction",
        resultIds: ["result"],
        resultRevisions: [{ resultId: "result", revision: 1 }],
        needsReview: false,
      },
    ],
    conclusions: [
      {
        ...meta,
        id: "conclusion",
        questionId: "question",
        statement: "n=24 synthetic pairs demonstrate product integration",
        resultIds: ["result"],
        resultRevisions: [{ resultId: "result", revision: 1 }],
        paperIds: [],
        confidence: "low",
        limitations:
          "Synthetic deterministic observations without real sampling variability. Reproduction adds no independent samples.",
        status: "tentative",
        supersedesId: null,
        needsReview: false,
      },
    ],
  };
}

test("external-validation oracle checks actual pairs rather than accepting only a metric or sample count", () => {
  expect(verifyPairs(JSON.stringify(pairs), "observations.json")).toMatchObject(
    { count: 24 },
  );
  expect(() =>
    verifyPairs(JSON.stringify(pairs.slice(1)), "observations.json"),
  ).toThrow("exactly 24");
  expect(() =>
    verifyPairs(JSON.stringify(pairs.map(() => pairs[0])), "observations.json"),
  ).toThrow("prescribed deterministic");
  expect(() =>
    verifyPairs(
      JSON.stringify(
        pairs.map((pair) => ({ ...pair, treatment: pair.treatment + 0.1 })),
      ),
      "observations.json",
    ),
  ).toThrow("does not match");
});

test("external-validation acceptance needs reproduction, intact inputs, current evidence and explicit synthetic limitations", async () => {
  const read = async () => JSON.stringify(pairs);
  const accepted = await verifyGlmProtocol(fixture(), read);
  expect(accepted.originalRunId).toBe("original");
  expect(accepted.reproductionRunId).toBe("reproduction");
  expect(accepted.independentSamplesAddedByReproduction).toBe(0);
  expect(accepted.evidence).toHaveLength(2);
  const unrelated = fixture();
  unrelated.runs = unrelated.runs.map((run) => ({
    ...run,
    referenceRunId: null,
  }));
  await expect(verifyGlmProtocol(unrelated, read)).rejects.toThrow(
    "successful reproduction",
  );
  const altered = fixture();
  altered.runs = altered.runs.map((run) =>
    run.referenceRunId && run.snapshot
      ? { ...run, snapshot: { ...run.snapshot, config: { changed: true } } }
      : run,
  );
  await expect(verifyGlmProtocol(altered, read)).rejects.toThrow(
    "changed preserved",
  );
  await expect(
    verifyGlmProtocol(fixture(), async () => JSON.stringify(pairs.slice(1))),
  ).rejects.toThrow("lacks a verified artifact");
  const stale = fixture();
  stale.hypotheses = stale.hypotheses.map((hypothesis) => ({
    ...hypothesis,
    needsReview: true,
  }));
  await expect(verifyGlmProtocol(stale, read)).rejects.toThrow(
    "current supported hypothesis",
  );
});
