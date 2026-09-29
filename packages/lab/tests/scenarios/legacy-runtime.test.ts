import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLabRuntime,
  type ModelAccess,
  type ModelAdapter,
  type SourceAccess,
} from "@pico/lab";
import { createBackup, restoreLaboratory } from "@pico/lab/administration";
import type { Result, Run } from "@pico/lab/contracts";
import { createStorage } from "@/lab/storage/storage";

const fixture = join(import.meta.dir, "../fixtures/legacy-v1");
const intent = (key: string) => ({
  key,
  actor: { kind: "researcher" as const },
});
function dependencies(adapter: ModelAdapter) {
  const models: ModelAccess = {
    complete: adapter,
    catalog: async () => ({
      providers: [],
      defaultSelection: null,
      agentDir: "synthetic",
    }),
    status: async (config) => ({
      mode: config.mode,
      model: config.model,
      configured: true,
      detail: "Simulated test model",
    }),
    close: async () => {},
  };
  const sources: SourceAccess = {
    search: async () => [],
    import: async () => {
      throw new Error("No external source in this scenario");
    },
    execute: async () => ({}),
    close: async () => {},
  };
  return { model: adapter, models, sources };
}
async function until<T>(
  read: () => T,
  done: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = read();
    if (done(value)) return value;
    await Bun.sleep(20);
  }
  throw new Error("Scenario did not settle");
}

test("historical backup restores exact research and native replay, recovers a tool receipt, then reproduces a new attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-legacy-runtime-"));
  const data = join(root, "data");
  const expected = JSON.parse(
    await readFile(join(fixture, "expected.json"), "utf8"),
  );
  restoreLaboratory(join(fixture, "backup"), data);
  // Simulate loss of the tool-result acknowledgement, preserving its historical receipt.
  const storage = createStorage(data);
  const originals = storage.conversation.listModelSteps(expected.ids.lab);
  expect(originals).toEqual(expected.modelSteps);
  const message = storage.conversation
    .listMessages(expected.ids.lab)
    .find((item) => item.id === expected.toolMessages[0].id);
  if (!message?.toolCall) throw new Error("Historical tool message missing");
  storage.conversation.saveMessage({
    ...message,
    toolCall: { ...message.toolCall, status: "running", result: undefined },
  });
  const turn = storage.conversation.getTurn(expected.ids.turn);
  if (!turn) throw new Error("Historical turn missing");
  storage.conversation.saveTurn({ ...turn, status: "interrupted" });
  storage.close();
  const captures: Parameters<ModelAdapter>[0][] = [];
  const runtime = createLabRuntime({
    dataDir: data,
    ...dependencies(async (input) => {
      captures.push(input);
      return { content: "Simulated inspection completed", calls: [] };
    }),
  });
  try {
    await runtime.start();
    expect(
      runtime.research.getRecord(
        expected.ids.lab,
        "question",
        expected.ids.question,
      ),
    ).toEqual(expected.question);
    expect(
      runtime.research.getRecord<Result>(
        expected.ids.lab,
        "result",
        expected.ids.result,
      ),
    ).toEqual(expected.result);
    expect(
      runtime.research.history(expected.ids.lab, expected.ids.result),
    ).toEqual(expected.resultHistory);
    const archive = await runtime.research.exportRun(
      expected.ids.lab,
      expected.ids.run,
    );
    expect(archive.execution.snapshot.sha256).toBe(
      expected.archiveSnapshotHash,
    );
    expect(
      (
        await runtime.research.readDatasetFile(
          expected.ids.lab,
          expected.ids.dataset,
          "samples.json",
        )
      ).toString(),
    ).toBe(expected.datasetBytes);
    expect(
      (
        await runtime.research.readRunFile(
          expected.ids.lab,
          expected.ids.run,
          "code",
          "experiment.py",
        )
      ).toString(),
    ).toBe(expected.code);
    runtime.conversation.continue(
      expected.ids.lab,
      expected.ids.turn,
      intent("recover-original-tool"),
    );
    await until(
      () => runtime.conversation.getTurn(expected.ids.lab, expected.ids.turn),
      (item) => item.status === "completed" || item.status === "failed",
    );
    expect(
      runtime.conversation.getTurn(expected.ids.lab, expected.ids.turn).status,
    ).toBe("completed");
    expect(runtime.research.overview(expected.ids.lab).questions).toHaveLength(
      1,
    );
    const recovered = runtime.research
      .conversationView(expected.ids.lab)
      .messages.find((item) => item.id === message.id);
    expect(recovered?.toolCall).toMatchObject({
      status: "completed",
      result: expected.question,
    });
    expect(
      captures.some((input) =>
        input.messages.some(
          (item) =>
            JSON.stringify(item.native?.payload) ===
            JSON.stringify(expected.modelSteps[0].native),
        ),
      ),
    ).toBe(true);
    const reproduction = await runtime.research.startRun(
      expected.ids.lab,
      expected.ids.experiment,
      { referenceRunId: expected.ids.run },
      intent("reproduce-historical"),
    );
    expect(reproduction.id).not.toBe(expected.ids.run);
    const completed = await until(
      () =>
        runtime.research.getRecord<Run>(
          expected.ids.lab,
          "run",
          reproduction.id,
        ),
      (run) => !["queued", "running"].includes(run.status),
    );
    expect(completed.status).toBe("succeeded");
    expect(completed.referenceRunId).toBe(expected.ids.run);
    expect(completed.metrics).toEqual(expected.run.metrics);
    expect(completed.snapshot?.codeHash).toBe(expected.run.snapshot.codeHash);
    expect(
      (await runtime.research.exportRun(expected.ids.lab, expected.ids.run))
        .execution.snapshot.sha256,
    ).toBe(expected.archiveSnapshotHash);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI backup rejects a surviving supervisor after the runtime controller closes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-live-backup-"));
  const data = join(root, "data");
  const runtime = createLabRuntime({
    dataDir: data,
    ...dependencies(async () => ({ content: "Simulated", calls: [] })),
  });
  let reopened: ReturnType<typeof createLabRuntime> | undefined;
  try {
    await runtime.start();
    const lab = runtime.research.createLab({
      name: "Backup exclusion",
      settings: { executionEnabled: true },
    });
    const question = runtime.research.createQuestion(
      lab.id,
      { text: "Is backup coherent?" },
      intent("q"),
    );
    const experiment = runtime.research.createExperiment(
      lab.id,
      {
        title: "Slow job",
        objective: "Exercise exclusion",
        questionIds: [question.id],
        protocol: "Sleep before completion",
      },
      intent("e"),
    );
    await runtime.research.writeFile(
      lab.id,
      experiment.id,
      {
        path: "experiment.py",
        content: "import time\ntime.sleep(10)\nprint('finished')\n",
      },
      intent("code"),
    );
    const run = await runtime.research.startRun(
      lab.id,
      experiment.id,
      { timeoutSeconds: 15 },
      intent("run"),
    );
    await until(
      () => runtime.research.getRecord<Run>(lab.id, "run", run.id),
      (value) => value.status === "running",
    );
    await runtime.close();
    await expect(
      createBackup(data, join(root, "unsafe-backup")),
    ).rejects.toThrow("queued/running");
    reopened = createLabRuntime({
      dataDir: data,
      ...dependencies(async () => ({ content: "Simulated", calls: [] })),
    });
    await reopened.start();
    await reopened.research.cancelRun(lab.id, run.id, intent("cancel"));
    const current = reopened;
    await until(
      () => current.research.getRecord<Run>(lab.id, "run", run.id),
      (value) => !["queued", "running"].includes(value.status),
    );
  } finally {
    await reopened?.close();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
