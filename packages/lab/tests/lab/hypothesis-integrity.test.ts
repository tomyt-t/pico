import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Conclusion,
  Criterion,
  Hypothesis,
  Metric,
  MutationContext,
  Result,
  RunSnapshot,
  RunStatus,
} from "@/lab/contracts";
import { createLaboratory } from "@/lab/research/laboratory";
import { createStorage, type Storage } from "@/lab/storage/storage";

const stores: Storage[] = [];
const intent = (): MutationContext => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" },
});

test("only the researcher can explicitly change experiment credential access", () => {
  const f = fixture();
  for (const kind of ["pico", "system"] as const) {
    for (const piProfile of [true, false]) {
      const actor = { key: crypto.randomUUID(), actor: { kind } };
      expect(() =>
        f.lab.reviseExperiment(
          f.labId,
          f.experiment.id,
          { executionAccess: { piProfile } },
          actor,
        ),
      ).toThrow("Only the researcher");
      expect(() =>
        f.lab.createExperiment(
          f.labId,
          {
            title: "Unauthorized",
            objective: "Unauthorized",
            protocol: "Unauthorized",
            questionIds: [f.question.id],
            executionAccess: { piProfile },
          },
          actor,
        ),
      ).toThrow("Only the researcher");
    }
  }
  const allowed = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    { executionAccess: { piProfile: true } },
    intent(),
  );
  expect(allowed.executionAccess?.piProfile).toBe(true);
  const harmless = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    { title: "Updated title" },
    { key: crypto.randomUUID(), actor: { kind: "pico" } },
  );
  expect(harmless.executionAccess?.piProfile).toBe(true);
});
afterEach(() => {
  for (const storage of stores.splice(0)) {
    storage.close();
    rmSync(storage.dataDir, { recursive: true, force: true });
  }
});

function fixture(criteriaPatch: Partial<Criterion> = {}) {
  const storage = createStorage(
    mkdtempSync(join(tmpdir(), "pico-preregistered-")),
  );
  stores.push(storage);
  const lab = createLaboratory(storage);
  const labId = lab.createLab({ name: "Prospective tests" }).id;
  const question = lab.createQuestion(
    labId,
    { text: "Does accuracy exceed the baseline?" },
    intent(),
  );
  const hypothesis = lab.createHypothesis(
    labId,
    {
      questionId: question.id,
      statement: "Accuracy will be at least 0.8",
      rationale: "Fixed prospective claim",
    },
    intent(),
  );
  const criterion: Criterion = {
    hypothesisId: hypothesis.id,
    metric: "accuracy",
    expectation: "At least 0.8",
    comparator: "gte",
    threshold: 0.8,
    unit: "rate",
    split: "test",
    ...criteriaPatch,
  };
  const experiment = lab.createExperiment(
    labId,
    {
      title: "Registered test",
      objective: "Compare to baseline",
      questionIds: [question.id],
      hypothesisIds: [hypothesis.id],
      criteria: [criterion],
      protocol: "Measure fixed test accuracy",
    },
    intent(),
  );
  const snapshot: RunSnapshot = {
    schemaVersion: 1,
    experimentId: experiment.id,
    experimentRevision: experiment.revision,
    protocol: experiment.protocol,
    criteria: experiment.criteria,
    entrypoint: experiment.entrypoint,
    runtime: experiment.runtime,
    args: [],
    config: {},
    codeFiles: [
      { path: experiment.entrypoint, size: 10, sha256: "a".repeat(64) },
    ],
    codeHash: "b".repeat(64),
    datasetInputs: [],
    environment: { runtime: "python" },
    createdAt: new Date().toISOString(),
  };
  function run(
    value = 0.9,
    status: RunStatus = "succeeded",
    extra: Metric[] = [],
    suppliedSnapshot = snapshot,
  ) {
    const queued = lab.createRun(
      labId,
      { experimentId: experiment.id, snapshot: suppliedSnapshot },
      intent(),
    );
    return lab.updateRun(
      labId,
      queued.id,
      {
        status,
        exitCode: status === "succeeded" ? 0 : 1,
        endedAt: new Date().toISOString(),
        metrics: [
          { name: "accuracy", value, unit: "rate", split: "test", step: null },
          ...extra,
        ],
      },
      intent(),
    );
  }
  function result(
    value = 0.9,
    status: RunStatus = "succeeded",
    extra: Metric[] = [],
  ) {
    const completed = run(value, status, extra);
    return lab.recordResult(
      labId,
      {
        experimentId: experiment.id,
        runIds: [completed.id],
        observations: "Collected local observations",
        interpretation: "Compare the preserved test",
        limitations: "Synthetic observations for domain validation",
        evidence: completed.metrics.map((metric) => ({
          kind: "metric" as const,
          runId: completed.id,
          ...metric,
        })),
      },
      intent(),
    );
  }
  function assess(
    resultIds: string[],
    status: "supported" | "refuted" | "inconclusive" = "supported",
  ) {
    return lab.reviseHypothesis(
      labId,
      hypothesis.id,
      {
        status,
        resultIds,
        assessment:
          "Interpret all cited observations against the registered criterion",
      },
      intent(),
    );
  }
  return {
    storage,
    lab,
    labId,
    question,
    hypothesis,
    experiment,
    snapshot,
    run,
    result,
    assess,
  };
}

test("confirmed assessments pin exact hypothesis and result revisions and reject post-hoc rewriting", () => {
  const f = fixture();
  const result = f.result();
  const assessment = f.assess([result.id]);
  expect(assessment.resultRevisions).toEqual([
    { resultId: result.id, revision: 1 },
  ]);
  expect(assessment.needsReview).toBe(false);
  expect(f.experiment.criteria[0]?.hypothesisRevision).toBe(1);
  expect(() =>
    f.lab.reviseHypothesis(
      f.labId,
      f.hypothesis.id,
      { statement: "Any accuracy is adequate" },
      intent(),
    ),
  ).toThrow("differs from the hypothesis revision");
  f.lab.reviseHypothesis(
    f.labId,
    f.hypothesis.id,
    { status: "proposed", statement: "Revised prospective claim" },
    intent(),
  );
  const titleEdit = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    { title: "Renamed test" },
    intent(),
  );
  expect(titleEdit.criteria).toEqual(f.experiment.criteria);
  expect(() => f.assess([result.id])).toThrow(
    "differs from the hypothesis revision",
  );
  const registered = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    { criteria: f.experiment.criteria },
    intent(),
  );
  expect(registered.criteria[0]?.hypothesisRevision).toBe(3);
  expect(() => f.assess([result.id])).toThrow(
    "differs from the hypothesis revision",
  );
});

test("numerical direction, all cited results and all registered metrics constrain confirmatory states", () => {
  const f = fixture();
  const positive = f.result(0.9);
  const negative = f.result(0.5);
  expect(() => f.assess([negative.id])).toThrow(
    "contradicts a preserved numerical criterion",
  );
  expect(f.assess([negative.id], "refuted").status).toBe("refuted");
  for (const status of ["supported", "refuted"] as const)
    expect(() => f.assess([positive.id, negative.id], status)).toThrow(
      "mixed outcomes",
    );
  expect(f.assess([positive.id, negative.id], "inconclusive").status).toBe(
    "inconclusive",
  );
  const noEvidence = f.lab.recordResult(
    f.labId,
    {
      experimentId: f.experiment.id,
      runIds: positive.runIds,
      observations: "No structured references",
      interpretation: "Exploratory",
      limitations: "Unverified references",
    },
    intent(),
  );
  expect(() => f.assess([positive.id, noEvidence.id])).toThrow("every result");
});

test("editing an inconclusive claim preserves its old assessment basis and requires review", () => {
  const f = fixture();
  const result = f.result();
  const assessed = f.assess([result.id], "inconclusive");
  const changed = f.lab.reviseHypothesis(
    f.labId,
    f.hypothesis.id,
    { statement: "A different exploratory claim" },
    intent(),
  );
  expect(changed.needsReview).toBe(true);
  expect(changed.assessment).toBe(assessed.assessment);
  expect(changed.resultRevisions).toEqual(assessed.resultRevisions);
  const reconsidered = f.lab.reviseHypothesis(
    f.labId,
    f.hypothesis.id,
    {
      assessment:
        "The observations are inconclusive for the new exploratory claim",
    },
    intent(),
  );
  expect(reconsidered.needsReview).toBe(false);
});

test("reproduction cannot change preserved inputs behind an unchanged code hash", () => {
  const f = fixture();
  const original = f.run();
  for (const patch of [
    { config: { altered: true } },
    { args: ["different"] },
    { resources: { memoryMiB: 128 } },
    {
      codeFiles: [
        { path: f.experiment.entrypoint, sha256: "a".repeat(64), size: 11 },
      ],
    },
  ]) {
    expect(() =>
      f.lab.createRun(
        f.labId,
        {
          experimentId: f.experiment.id,
          referenceRunId: original.id,
          snapshot: { ...f.snapshot, ...patch },
        },
        intent(),
      ),
    ).toThrow("Reproduction must preserve");
  }
  const reproduced = f.lab.createRun(
    f.labId,
    {
      experimentId: f.experiment.id,
      referenceRunId: original.id,
      snapshot: {
        ...f.snapshot,
        environment: {
          runtime: "python",
          runtimeVersion: "new observed version",
        },
        createdAt: new Date().toISOString(),
      },
    },
    intent(),
  );
  expect(reproduced.id).not.toBe(original.id);
  expect(reproduced.snapshot?.environment.runtimeVersion).toBe(
    "new observed version",
  );
});

test("failed executions retain diagnostic metrics without supporting or refuting a hypothesis", () => {
  const f = fixture();
  for (const status of [
    "failed",
    "cancelled",
    "timed_out",
    "interrupted",
  ] as const) {
    const failed = f.result(0.9, status);
    expect(failed.evidence).toHaveLength(1);
    expect(() => f.assess([failed.id])).toThrow("successful runs");
    expect(f.assess([failed.id], "inconclusive").status).toBe("inconclusive");
  }
});

test("a successful unrelated run cannot be smuggled into an otherwise valid result", () => {
  const f = fixture();
  const valid = f.result();
  const exploratory = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    { hypothesisIds: [], criteria: [] },
    intent(),
  );
  const unrelated = f.run(0.9, "succeeded", [], {
    ...f.snapshot,
    experimentRevision: exploratory.revision,
    criteria: [],
  });
  const mixed = f.lab.recordResult(
    f.labId,
    {
      experimentId: f.experiment.id,
      runIds: [...valid.runIds, unrelated.id],
      observations: "Both runs collected a metric",
      interpretation: "Only the first had a registered test",
      limitations: "Mixed evidence",
      evidence: [
        ...(valid.evidence ?? []),
        ...unrelated.metrics.map((metric) => ({
          kind: "metric" as const,
          runId: unrelated.id,
          ...metric,
        })),
      ],
    },
    intent(),
  );
  expect(() => f.assess([valid.id, mixed.id])).toThrow("Every assessed run");
});

test("criterion dimensions are exact and unrelated metric evidence cannot substitute", () => {
  for (const patch of [
    { split: "train" },
    { unit: "percent" },
    { step: 7 },
    { metric: "other" },
    { split: undefined },
  ]) {
    const f = fixture(patch);
    const result = f.result();
    expect(() => f.assess([result.id])).toThrow("exact unit, split and step");
  }
  const f = fixture({
    comparator: undefined,
    threshold: undefined,
    expectation: "The observed accuracy is adequate under the written protocol",
  });
  expect(f.assess([f.result().id]).status).toBe("supported");
});

test("every criterion needs its metric; an artifact cannot replace the missing observation", () => {
  const f = fixture();
  const experiment = f.lab.reviseExperiment(
    f.labId,
    f.experiment.id,
    {
      criteria: [
        ...f.experiment.criteria,
        {
          hypothesisId: f.hypothesis.id,
          metric: "count",
          expectation: "At least 100 examples",
          comparator: "gte",
          threshold: 100,
          unit: "examples",
          split: "test",
        },
      ],
    },
    intent(),
  );
  const snapshot = {
    ...f.snapshot,
    experimentRevision: experiment.revision,
    criteria: experiment.criteria,
  };
  const queued = f.lab.createRun(
    f.labId,
    { experimentId: experiment.id, snapshot },
    intent(),
  );
  const run = f.lab.updateRun(
    f.labId,
    queued.id,
    {
      status: "succeeded",
      exitCode: 0,
      endedAt: new Date().toISOString(),
      metrics: [
        {
          name: "accuracy",
          value: 0.9,
          unit: "rate",
          split: "test",
          step: null,
        },
      ],
      artifacts: [
        { path: "count.txt", sha256: "c".repeat(64), size: 3, kind: "table" },
      ],
    },
    intent(),
  );
  const result = f.lab.recordResult(
    f.labId,
    {
      experimentId: experiment.id,
      runIds: [run.id],
      observations: "Accuracy was collected; count is only an artifact",
      interpretation: "Incomplete measured protocol",
      limitations: "The second metric is absent",
      evidence: [
        {
          kind: "metric",
          runId: run.id,
          name: "accuracy",
          value: 0.9,
          unit: "rate",
          split: "test",
          step: null,
        },
        {
          kind: "artifact",
          runId: run.id,
          path: "count.txt",
          sha256: "c".repeat(64),
        },
      ],
    },
    intent(),
  );
  expect(() => f.assess([result.id])).toThrow(
    "every preserved criterion's metric",
  );
  expect(f.assess([result.id], "inconclusive").status).toBe("inconclusive");
});

test("all collected values for a criterion must be cited, preventing favorable-value selection", () => {
  const f = fixture();
  const result = f.result(0.9, "succeeded", [
    { name: "accuracy", value: 0.1, unit: "rate", split: "test", step: null },
  ]);
  f.lab.reviseResult(
    f.labId,
    result.id,
    { evidence: result.evidence?.slice(0, 1) },
    intent(),
  );
  expect(() => f.assess([result.id])).toThrow("all collected observations");
});

test("result revision atomically flags dependent assessments without replacing their evidence basis", () => {
  const f = fixture();
  const result = f.result();
  const assessed = f.assess([result.id]);
  const conclusion = f.lab.recordConclusion(
    f.labId,
    {
      questionId: f.question.id,
      statement: "The criterion was met",
      resultIds: [result.id],
      limitations: "Synthetic fixture",
    },
    intent(),
  );
  const mutation = intent();
  const patch = {
    interpretation: "A corrected interpretation with narrower limits",
  };
  const revised = f.lab.reviseResult(f.labId, result.id, patch, mutation);
  expect(f.lab.reviseResult(f.labId, result.id, patch, mutation)).toEqual(
    revised,
  );
  for (const [kind, original] of [
    ["hypothesis", assessed],
    ["conclusion", conclusion],
  ] as const) {
    const current = f.lab.getRecord<Hypothesis | Conclusion>(
      f.labId,
      kind,
      original.id,
    );
    expect(current.needsReview).toBe(true);
    expect(current.resultRevisions).toEqual([
      { resultId: result.id, revision: 1 },
    ]);
    expect(current.revision).toBe(original.revision + 1);
    expect(current.author).toEqual(original.author);
    const history = f.storage.research.revisions<Hypothesis | Conclusion>(
      original.id,
    );
    expect(
      history.find(
        (revision) => revision.snapshot.revision === original.revision,
      ),
    ).toMatchObject({ author: { kind: "system" }, snapshot: original });
  }
  expect(f.assess([result.id]).resultRevisions).toEqual([
    { resultId: result.id, revision: 2 },
  ]);
  const reconsidered = f.lab.reviseConclusion(
    f.labId,
    conclusion.id,
    { limitations: "Reconsidered the corrected result" },
    intent(),
  );
  expect(reconsidered.needsReview).toBe(false);
  expect(reconsidered.resultRevisions).toEqual([
    { resultId: result.id, revision: 2 },
  ]);
  f.lab.reviseResult(f.labId, result.id, { evidence: [] }, intent());
  expect(
    f.lab.getRecord<Hypothesis>(f.labId, "hypothesis", assessed.id).needsReview,
  ).toBe(true);
  expect(() => f.assess([result.id])).toThrow("structured references");
});

test("legacy provenance remains absent until explicit re-registration and replay keeps historical receipts", () => {
  const f = fixture();
  const legacy = {
    ...f.experiment,
    criteria: f.experiment.criteria.map(
      ({ hypothesisRevision: _revision, ...criterion }) => criterion,
    ),
  };
  f.storage.research.replace("experiment", f.labId, legacy);
  const completed = f.run(0.9, "succeeded", [], {
    ...f.snapshot,
    criteria: legacy.criteria,
  });
  const result = f.lab.recordResult(
    f.labId,
    {
      experimentId: legacy.id,
      runIds: [completed.id],
      observations: "Historical metric",
      interpretation: "Legacy analysis",
      limitations: "No recorded hypothesis revision",
      evidence: completed.metrics.map((metric) => ({
        kind: "metric" as const,
        runId: completed.id,
        ...metric,
      })),
    },
    intent(),
  );
  expect(() => f.assess([result.id])).toThrow(
    "legacy runs require a new prospective test",
  );
  const input = {
    questionId: f.question.id,
    statement: "Historical assessment",
    status: "supported" as const,
    resultIds: [result.id],
    assessment: "Historical explanation",
  };
  const ctx = intent();
  const old = {
    ...f.hypothesis,
    ...input,
    id: "legacy-hypothesis",
    resultRevisions: undefined,
    needsReview: undefined,
  };
  f.storage.operations.mutate(
    {
      labId: f.labId,
      key: ctx.key,
      operation: "createHypothesis",
      input: { input, actor: ctx.actor },
    },
    () => f.storage.research.insert("hypothesis", f.labId, old),
  );
  expect(f.lab.createHypothesis(f.labId, input, ctx)).toEqual(old);
  expect(f.lab.getRecord<Result>(f.labId, "result", result.id).revision).toBe(
    1,
  );
});
