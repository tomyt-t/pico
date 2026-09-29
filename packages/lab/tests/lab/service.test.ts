import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Experiment, MutationContext, RunSnapshot } from "@/lab/contracts";
import { createLaboratory } from "@/lab/research/laboratory";
import { createStorage, type Storage } from "@/lab/storage/storage";

const stores: Storage[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pico-lab-"));
  const store = createStorage(directory);
  stores.push(store);
  const service = createLaboratory(store);
  const lab = service.createLab({
    name: "Multimodal defenses",
    researchLine: "Investigate reliable defenses",
  });
  const question = service.createQuestion(
    lab.id,
    { text: "Does the defense reduce attack success?" },
    context(),
  );
  const experiment = service.createExperiment(
    lab.id,
    {
      title: "Baseline exploration",
      objective: "Measure the baseline",
      questionIds: [question.id],
      protocol: "Measure attack success on a fixed dataset.",
    },
    context(),
  );
  return { store, service, lab, question, experiment };
}
function context(key: string = randomUUID()): MutationContext {
  return { key, actor: { kind: "researcher" } };
}
function snapshot(experiment: Experiment): RunSnapshot {
  return {
    schemaVersion: 1,
    experimentId: experiment.id,
    experimentRevision: experiment.revision,
    protocol: experiment.protocol,
    criteria: experiment.criteria,
    entrypoint: experiment.entrypoint,
    runtime: experiment.runtime,
    args: [],
    config: { seed: 42 },
    codeFiles: [{ path: "experiment.py", size: 10, sha256: "a".repeat(64) }],
    codeHash: "b".repeat(64),
    datasetInputs: [],
    environment: { runtime: "python" },
    createdAt: new Date().toISOString(),
  };
}
afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
    rmSync(store.dataDir, { recursive: true, force: true });
  }
});

describe("scientific relationships", () => {
  test("creates an exploratory experiment without an invented hypothesis", () => {
    const { service, lab, question, experiment } = fixture();
    expect(experiment.hypothesisIds).toEqual([]);
    expect(
      service
        .experimentDetail(lab.id, experiment.id)
        .questions.map((entry) => entry.id),
    ).toEqual([question.id]);
    expect(service.getConversation(lab.id)).toEqual(
      service.overview(lab.id).conversation,
    );
  });

  test("rejects cross-laboratory entities and does not leave partial writes", () => {
    const { service, lab, question } = fixture();
    const other = service.createLab({ name: "Other lab" });
    expect(() =>
      service.createHypothesis(
        other.id,
        { questionId: question.id, statement: "An effect exists" },
        context(),
      ),
    ).toThrow("not found in this laboratory");
    expect(service.overview(other.id).hypotheses).toEqual([]);
    const otherQuestion = service.createQuestion(
      other.id,
      { text: "A different question?" },
      context(),
    );
    expect(() =>
      service.createExperiment(
        lab.id,
        {
          title: "Mixed scope",
          objective: "Invalid",
          protocol: "Invalid",
          questionIds: [question.id, otherQuestion.id],
        },
        context(),
      ),
    ).toThrow();
    expect(service.overview(lab.id).experiments).toHaveLength(1);
  });

  test("ties hypotheses and criteria to the explicit questions of the experiment", () => {
    const { service, lab, question, experiment } = fixture();
    const other = service.createQuestion(
      lab.id,
      { text: "What changes latency?" },
      context(),
    );
    const hypothesis = service.createHypothesis(
      lab.id,
      { questionId: other.id, statement: "The defense adds latency" },
      context(),
    );
    expect(() =>
      service.reviseExperiment(
        lab.id,
        experiment.id,
        { hypothesisIds: [hypothesis.id] },
        context(),
      ),
    ).toThrow("question linked to this experiment");
    expect(() =>
      service.reviseExperiment(
        lab.id,
        experiment.id,
        {
          criteria: [
            {
              hypothesisId: hypothesis.id,
              metric: "latency",
              expectation: "Higher",
            },
          ],
        },
        context(),
      ),
    ).toThrow("hypothesis tested by this experiment");
    expect(
      service.overview(lab.id).questions.map((entry) => entry.id),
    ).toContain(question.id);
  });

  test("preserves authors and records why hypotheses and questions changed", () => {
    const { service, store, lab, question } = fixture();
    const actor = { kind: "pico" as const, turnId: "turn-one" };
    const updated = service.reviseQuestion(
      lab.id,
      question.id,
      { context: "Limit to a fixed model" },
      { key: "revision", actor },
      "Narrow the population",
    );
    expect(updated.author).toEqual(question.author);
    expect(updated.revision).toBe(2);
    expect(store.research.revisions(question.id)[0]?.author).toEqual(actor);
    expect(
      store.research.revisions<typeof question>(question.id)[0]?.snapshot,
    ).toEqual(question);
    expect(store.research.revisions(question.id)[0]?.reason).toBe(
      "Narrow the population",
    );
    const child = service.createQuestion(
      lab.id,
      { text: "A refinement?", parentId: question.id },
      context(),
    );
    expect(() =>
      service.reviseQuestion(
        lab.id,
        question.id,
        { parentId: child.id },
        context(),
      ),
    ).toThrow("cycles");
  });

  test("mutation retries return the original record and cannot change their meaning", () => {
    const { service, lab } = fixture();
    const ctx = context("create-question-once");
    const input = { text: "Is the measured effect stable?" };
    const first = service.createQuestion(lab.id, input, ctx);
    expect(service.createQuestion(lab.id, input, ctx)).toEqual(first);
    expect(() =>
      service.createQuestion(lab.id, { text: "Something different?" }, ctx),
    ).toThrow("different arguments");
    expect(service.overview(lab.id).questions).toHaveLength(2);
  });
});

describe("executions and evidence", () => {
  test("finishes an exploration, records evidence and revises a conclusion with history", () => {
    const { service, store, lab, question, experiment } = fixture();
    const run = service.createRun(
      lab.id,
      { experimentId: experiment.id, snapshot: snapshot(experiment) },
      context(),
    );
    service.updateRun(
      lab.id,
      run.id,
      { status: "running", startedAt: new Date().toISOString() },
      context(),
    );
    const completion = context("finish-run-once");
    const patch = {
      status: "succeeded" as const,
      endedAt: new Date().toISOString(),
      exitCode: 0,
      metrics: [
        {
          name: "attack_success",
          value: 0.4,
          unit: "rate",
          split: "test",
          step: null,
        },
      ],
    };
    const completed = service.updateRun(lab.id, run.id, patch, completion);
    expect(service.updateRun(lab.id, run.id, patch, completion)).toEqual(
      completed,
    );
    expect(
      service
        .overview(lab.id)
        .events.filter((event) => event.kind === "run_completed"),
    ).toHaveLength(1);
    const result = service.recordResult(
      lab.id,
      {
        experimentId: experiment.id,
        runIds: [run.id],
        observations: "Attack success was 0.4 on the test split.",
        interpretation: "The baseline remains susceptible.",
        limitations: "One model and a small sample.",
      },
      context(),
    );
    const conclusion = service.recordConclusion(
      lab.id,
      {
        questionId: question.id,
        statement: "The baseline is susceptible under the tested conditions.",
        resultIds: [result.id],
        limitations: "No comparison with defenses yet.",
      },
      context(),
    );
    service.reviseConclusion(
      lab.id,
      conclusion.id,
      { limitations: "One model, one dataset, no defense comparison." },
      context(),
      "Clarify external validity",
    );
    expect(
      store.research.revisions<typeof conclusion>(conclusion.id)[0]?.snapshot,
    ).toEqual(conclusion);
    expect(service.overview(lab.id).conclusions[0]?.revision).toBe(2);
    expect(() =>
      service.updateRun(lab.id, run.id, { metrics: [] }, context()),
    ).toThrow("immutable");
    const second = service.createRun(
      lab.id,
      {
        experimentId: experiment.id,
        referenceRunId: run.id,
        snapshot: snapshot(experiment),
      },
      context(),
    );
    expect(second.id).not.toBe(run.id);
    expect(second.attempt).toBe(2);
  });

  test("cannot rewrite a snapshot and keeps prior protocols reproducible after revision", () => {
    const { service, lab, experiment } = fixture();
    const original = snapshot(experiment);
    const run = service.createRun(
      lab.id,
      { experimentId: experiment.id, snapshot: original },
      context(),
    );
    expect(() =>
      service.updateRun(lab.id, run.id, { snapshot: null }, context()),
    ).toThrow("cannot be replaced");
    service.reviseExperiment(
      lab.id,
      experiment.id,
      { protocol: "Measure a different split" },
      context(),
    );
    service.updateRun(
      lab.id,
      run.id,
      { status: "running", startedAt: new Date().toISOString() },
      context(),
    );
    expect(
      service.experimentDetail(lab.id, experiment.id).runs[0]?.snapshot,
    ).toEqual(original);
    expect(() =>
      service.updateRun(
        lab.id,
        run.id,
        { snapshot: { ...original, protocol: "Rewritten history" } },
        context(),
      ),
    ).toThrow("cannot be replaced");
  });

  test("rejects unsupported conclusions, mismatched evidence and unfinished run analyses", () => {
    const { service, lab, question, experiment } = fixture();
    const run = service.createRun(
      lab.id,
      { experimentId: experiment.id },
      context(),
    );
    const input = {
      experimentId: experiment.id,
      runIds: [run.id],
      observations: "No output yet",
      interpretation: "Unknown",
      limitations: "Not finished",
    };
    expect(() => service.recordResult(lab.id, input, context())).toThrow(
      "Wait for execution",
    );
    expect(() =>
      service.recordConclusion(
        lab.id,
        { questionId: question.id, statement: "Works", limitations: "Unknown" },
        context(),
      ),
    ).toThrow("require recorded results");
    service.updateRun(
      lab.id,
      run.id,
      {
        status: "failed",
        endedAt: new Date().toISOString(),
        exitCode: 1,
        error: "Missing dependency",
      },
      context(),
    );
    const result = service.recordResult(
      lab.id,
      { ...input, observations: "Dependency import failed" },
      context(),
    );
    const otherQuestion = service.createQuestion(
      lab.id,
      { text: "Unrelated question?" },
      context(),
    );
    expect(() =>
      service.recordConclusion(
        lab.id,
        {
          questionId: otherQuestion.id,
          statement: "Works",
          resultIds: [result.id],
          limitations: "Unknown",
        },
        context(),
      ),
    ).toThrow("linked to this question");
    expect(() =>
      service.createHypothesis(
        lab.id,
        { questionId: question.id, statement: "Works", status: "supported" },
        context(),
      ),
    ).toThrow("require an explanation and recorded evidence");
  });

  test("dataset versions are immutable and linked by a preserved manifest", () => {
    const { service, lab, experiment } = fixture();
    const input = {
      name: "Images",
      version: "v1",
      source: "Researcher upload",
      files: [{ path: "image.png", size: 20, sha256: "a".repeat(64) }],
      manifestHash: "b".repeat(64),
    };
    const dataset = service.registerDataset(lab.id, input, context());
    expect(() => service.registerDataset(lab.id, input, context())).toThrow(
      "already exists",
    );
    const revised = service.reviseExperiment(
      lab.id,
      experiment.id,
      { datasetVersionIds: [dataset.id] },
      context(),
    );
    expect(() =>
      service.createRun(
        lab.id,
        { experimentId: experiment.id, snapshot: snapshot(revised) },
        context(),
      ),
    ).toThrow("all dataset versions");
    const complete = {
      ...snapshot(revised),
      datasetInputs: [
        {
          datasetVersionId: dataset.id,
          name: dataset.name,
          version: dataset.version,
          manifestHash: dataset.manifestHash,
          files: dataset.files,
        },
      ],
    };
    expect(
      service.createRun(
        lab.id,
        { experimentId: experiment.id, snapshot: complete },
        context(),
      ).snapshot?.datasetInputs,
    ).toHaveLength(1);
  });
});
