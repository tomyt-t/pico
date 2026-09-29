import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  MutationContext,
  ObservationReference,
  Result,
} from "@/lab/contracts";
import { createLaboratory } from "@/lab/research/laboratory";
import { createStorage, type Storage } from "@/lab/storage/storage";

const stores: Storage[] = [];
const intent = (): MutationContext => ({
  key: randomUUID(),
  actor: { kind: "researcher" },
});
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
    rmSync(store.dataDir, { recursive: true, force: true });
  }
});
function fixture() {
  const storage = createStorage(mkdtempSync(join(tmpdir(), "pico-evidence-")));
  stores.push(storage);
  const lab = createLaboratory(storage);
  const laboratory = lab.createLab({ name: "Evidence invariants" });
  const question = lab.createQuestion(
    laboratory.id,
    { text: "Does the method work?" },
    intent(),
  );
  const experiment = lab.createExperiment(
    laboratory.id,
    {
      title: "Measure",
      objective: "Measure accuracy",
      questionIds: [question.id],
      protocol: "Count correct outcomes",
    },
    intent(),
  );
  const snapshot = {
    schemaVersion: 1 as const,
    experimentId: experiment.id,
    experimentRevision: 1,
    protocol: experiment.protocol,
    criteria: [],
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
  const run = lab.createRun(
    laboratory.id,
    { experimentId: experiment.id, snapshot },
    intent(),
  );
  lab.updateRun(
    laboratory.id,
    run.id,
    {
      status: "succeeded",
      exitCode: 0,
      endedAt: new Date().toISOString(),
      metrics: [
        {
          name: "accuracy",
          value: 0.5,
          unit: "rate",
          split: "test",
          step: null,
        },
      ],
    },
    intent(),
  );
  const reference: ObservationReference = {
    kind: "metric",
    runId: run.id,
    name: "accuracy",
    value: 0.5,
    unit: "rate",
    split: "test",
    step: null,
  };
  const input = {
    experimentId: experiment.id,
    runIds: [run.id],
    observations: "Recorded observations",
    interpretation: "A provisional analysis",
    limitations: "Small sample",
  };
  return {
    storage,
    lab,
    labId: laboratory.id,
    question,
    experiment,
    run,
    reference,
    input,
  };
}
test("structured numerical claims must match a collected metric and its full identity", () => {
  const f = fixture();
  expect(() =>
    f.lab.recordResult(
      f.labId,
      { ...f.input, evidence: [{ ...f.reference, value: 0.99 }] },
      intent(),
    ),
  ).toThrow("collected run metric");
  expect(() =>
    f.lab.recordResult(
      f.labId,
      { ...f.input, evidence: [{ ...f.reference, split: "invented" }] },
      intent(),
    ),
  ).toThrow("collected run metric");
  const result = f.lab.recordResult(
    f.labId,
    { ...f.input, evidence: [f.reference] },
    intent(),
  );
  expect(result.evidenceVersion).toBe(1);
  expect(result.evidence).toEqual([f.reference]);
  expect(() =>
    f.lab.createHypothesis(
      f.labId,
      {
        questionId: f.question.id,
        statement: "Has measured accuracy",
        status: "supported",
        assessment: "Based on the cited metric",
        resultIds: [result.id],
      },
      intent(),
    ),
  ).toThrow("Register a hypothesis and its criteria before execution");
});
test("failure analysis remains recordable but unsupported assertions cannot support a hypothesis", () => {
  const f = fixture();
  const run = f.lab.createRun(
    f.labId,
    { experimentId: f.experiment.id },
    intent(),
  );
  f.lab.updateRun(
    f.labId,
    run.id,
    { status: "failed", exitCode: 1, endedAt: new Date().toISOString() },
    intent(),
  );
  const result = f.lab.recordResult(
    f.labId,
    { ...f.input, runIds: [run.id], observations: "Accuracy was 0.99" },
    intent(),
  );
  expect(result.evidence).toEqual([]);
  expect(() =>
    f.lab.createHypothesis(
      f.labId,
      {
        questionId: f.question.id,
        statement: "Works",
        status: "supported",
        assessment: "Claimed accuracy",
        resultIds: [result.id],
      },
      intent(),
    ),
  ).toThrow("Register a hypothesis and its criteria before execution");
  expect(() =>
    f.lab.recordResult(
      f.labId,
      {
        ...f.input,
        runIds: [run.id],
        evidence: [{ ...f.reference, runId: run.id }],
      },
      intent(),
    ),
  ).toThrow("preserved inputs");
});
test("legacy results stay identifiable and revisions cannot cite a different execution", () => {
  const f = fixture();
  const original = f.lab.recordResult(f.labId, f.input, intent());
  const {
    evidenceVersion: _version,
    evidence: _evidence,
    ...legacy
  } = original;
  f.storage.research.replace("result", f.labId, legacy);
  expect(
    f.lab.getRecord<Result>(f.labId, "result", original.id).evidenceVersion,
  ).toBeUndefined();
  expect(() =>
    f.lab.reviseResult(
      f.labId,
      original.id,
      { evidence: [{ ...f.reference, runId: "another-run" }] },
      intent(),
    ),
  ).toThrow("fixed runs");
  const updated = f.lab.reviseResult(
    f.labId,
    original.id,
    { evidence: [f.reference] },
    intent(),
  );
  expect(updated.evidenceVersion).toBe(1);
  expect(
    f.storage.research.revisions<Result>(original.id)[0]?.snapshot
      .evidenceVersion,
  ).toBeUndefined();
});
test("completion consumption creates one turn and message, and notebook checkpoints never cover queued observations", () => {
  const f = fixture();
  expect(f.storage.conversation.consumeCompletionEvents()).toHaveLength(1);
  expect(f.storage.conversation.consumeCompletionEvents()).toHaveLength(0);
  const messages = f.storage.conversation.listMessages(f.labId);
  expect(messages).toHaveLength(1);
  const context = intent();
  const summary = f.lab.updateSummary(f.labId, "Preserved conclusion", context);
  expect(summary.summaryThroughMessageId).toBeNull();
  expect(f.lab.updateSummary(f.labId, "Preserved conclusion", context)).toEqual(
    summary,
  );
  expect(
    f.storage.conversation.messagesForTurns(f.labId, [
      messages[0]?.turnId ?? "",
    ]),
  ).toEqual(messages);
});

test("a historical result receipt replays unchanged without new evidence defaults changing its fingerprint", () => {
  const f = fixture();
  const context = intent();
  const historical = {
    id: "historical-result",
    labId: f.labId,
    ...f.input,
    author: context.actor,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  f.storage.operations.mutate(
    {
      labId: f.labId,
      key: context.key,
      operation: "recordResult",
      input: { input: f.input, actor: context.actor },
    },
    () => f.storage.research.insert("result", f.labId, historical),
  );
  const recovered = f.lab.recordResult(f.labId, f.input, context);
  expect(recovered).toEqual(historical);
  expect(recovered.evidenceVersion).toBeUndefined();
  expect(
    f.storage.research.resultsForExperiment(f.labId, f.experiment.id),
  ).toHaveLength(1);
});
