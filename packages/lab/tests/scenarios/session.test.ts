import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LabEvent, MutationContext, Turn } from "@/lab/contracts";
import type { ModelAdapter, ModelReply } from "@/lab/models/model-contract";
import { PicoSession } from "@/lab/pico/session";
import { createTools } from "@/lab/pico/tools/catalog";
import { createLaboratory, createResearch } from "@/lab/research/laboratory";
import {
  createResearchOperations,
  type ResearchOperations,
} from "@/lab/research/operations";
import { createStorage } from "@/lab/storage/storage";
import { createRunner } from "../support/scientific-runner";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function intent(key: string = randomUUID()): MutationContext {
  return { key, actor: { kind: "researcher" } };
}
function reply(content = "Discussed the evidence."): ModelReply {
  return { content, calls: [] };
}
async function waitUntil(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error("Scenario did not reach the expected state");
}
async function fixture(adapter?: ModelAdapter, maxModelSteps = 12) {
  const root = await mkdtemp(join(tmpdir(), "pico-session-test-"));
  const store = createStorage(root);
  const lab = createLaboratory(store);
  const record = lab.createLab({
    name: "Session test",
    settings: { executionEnabled: true, maxModelSteps },
  });
  let operations: ResearchOperations | undefined;
  const runner = await createRunner({
    dataDir: root,
    pollMs: 30,
    onUpdate: (run) => {
      operations?.acceptRun(run);
    },
  });
  operations = createResearchOperations(lab, store, runner);
  const research = createResearch({ lab, operations, execution: runner });
  let session = new PicoSession({
    lab,
    research,
    conversations: store.conversation,
    operations: store.operations,
    adapter,
  });
  session.start();
  cleanup.push(async () => {
    await session.close();
    for (const run of await runner.allRuns())
      if (["queued", "running"].includes(run.status)) {
        await runner.cancel(run.labId, run.id);
        await runner.waitForRun(run.labId, run.id, 5000);
      }
    await runner.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    lab,
    labId: record.id,
    runner,
    operations,
    research,
    get session() {
      return session;
    },
    async restart(nextAdapter?: ModelAdapter) {
      await session.close();
      session = new PicoSession({
        lab,
        research,
        conversations: store.conversation,
        operations: store.operations,
        adapter: nextAdapter,
      });
      session.start();
    },
    turn(id: string) {
      const turn = store.conversation.getTurn(id);
      if (!turn) throw new Error("Missing turn");
      return turn;
    },
  };
}

test("stopping a turn immediately after enqueue never starts the scheduled model operation", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return reply();
  });
  const turn = f.session.enqueue(
    f.labId,
    "Investigate this question",
    intent(),
  );
  f.session.stop(f.labId, turn.id);
  await Bun.sleep(30);
  expect(f.turn(turn.id).status).toBe("cancelled");
  expect(calls).toBe(0);
  expect(f.lab.conversationView(f.labId).messages).toHaveLength(1);
});

test("serializes model turns for one laboratory and does not duplicate a retried message", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (++calls === 1) await blocked;
    active--;
    return reply();
  });
  const ctx = intent("same-message");
  const first = f.session.enqueue(f.labId, "First question", ctx);
  expect(f.session.enqueue(f.labId, "First question", ctx).id).toBe(first.id);
  const second = f.session.enqueue(f.labId, "Second question", intent());
  await waitUntil(() => calls === 1);
  expect(f.turn(second.id).status).toBe("queued");
  release();
  await waitUntil(() => f.turn(second.id).status === "completed");
  expect(maxActive).toBe(1);
  expect(calls).toBe(2);
  expect(
    f.lab
      .conversationView(f.labId)
      .messages.filter((message) => message.role === "user"),
  ).toHaveLength(2);
});

test("repeated model tool call IDs reuse their recorded execution, while changed arguments fail atomically", async () => {
  let calls = 0;
  const repeated = {
    id: "call-one",
    name: "create_question",
    arguments: { text: "Can this measurement be reproduced?" },
  };
  const f = await fixture(async () =>
    ++calls <= 2 ? { content: "", calls: [repeated] } : reply(),
  );
  const turn = f.session.enqueue(f.labId, "Record a question", intent());
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  expect(
    f.lab
      .conversationView(f.labId)
      .messages.filter((message) => message.toolCall),
  ).toHaveLength(1);
  let changedCalls = 0;
  await f.restart(async () => ({
    content: "",
    calls: [
      {
        ...repeated,
        arguments: {
          text: ++changedCalls === 1 ? "Original intent?" : "Different intent?",
        },
      },
    ],
  }));
  const changed = f.session.enqueue(
    f.labId,
    "Record another question",
    intent(),
  );
  await waitUntil(() => f.turn(changed.id).status === "failed");
  expect(f.turn(changed.id).error).toContain("different arguments");
  expect(f.lab.overview(f.labId).questions).toHaveLength(2);
  expect(f.turn(changed.id).steps).toBe(2);
});

test("pauses after its bounded block, completes pending tools, and continues the same turn with a new block", async () => {
  let calls = 0;
  const f = await fixture(
    async () =>
      ++calls <= 2
        ? {
            content: "",
            calls: [{ id: `read-${calls}`, name: "read_lab", arguments: {} }],
          }
        : reply(),
    2,
  );
  const turn = f.session.enqueue(f.labId, "Inspect the lab", intent());
  await waitUntil(() => f.turn(turn.id).status === "paused");
  expect(f.turn(turn.id).steps).toBe(2);
  expect(
    f.lab
      .conversationView(f.labId)
      .messages.filter((message) => message.toolCall?.status === "completed"),
  ).toHaveLength(2);
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.turn(turn.id).steps).toBe(3);
  expect(f.lab.conversationView(f.labId).turns).toHaveLength(1);
});

test("recovers a tool whose mutation committed before its result was recorded without duplicating scientific entities", async () => {
  const f = await fixture(async () => reply());
  await f.session.close();
  const conversation = f.lab.getConversation(f.labId);
  const turn: Turn = {
    id: randomUUID(),
    labId: f.labId,
    conversationId: conversation.id,
    status: "running",
    trigger: "researcher",
    message: "Record a question",
    eventId: null,
    steps: 1,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
  };
  const messageId = randomUUID();
  f.store.conversation.insertTurn(turn);
  const input = { text: "Is this recovery idempotent?" };
  const createQuestion = createTools(f.research, f.labId).get(
    "create_question",
  );
  if (!createQuestion) throw new Error("Missing tool");
  const original = (await createQuestion.execute(input, {
    key: `turn:${turn.id}:tool:${messageId}`,
    actor: { kind: "pico", turnId: turn.id },
  })) as { id: string };
  f.store.conversation.insertMessage({
    id: messageId,
    labId: f.labId,
    conversationId: conversation.id,
    turnId: turn.id,
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    toolCall: {
      id: "inflight-question",
      name: "create_question",
      arguments: input,
      status: "running",
    },
  });
  await f.restart(async () => reply());
  expect(f.turn(turn.id).status).toBe("interrupted");
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(
    f.lab.overview(f.labId).questions.map((question) => question.id),
  ).toEqual([original.id]);
  expect(
    f.store.conversation
      .listMessages(f.labId)
      .find((item) => item.id === messageId)?.toolCall?.status,
  ).toBe("completed");
});

test("a model failure preserves executed tools and can continue without replaying successful work", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    if (calls === 1)
      return {
        content: "",
        calls: [
          {
            id: "one-question",
            name: "create_question",
            arguments: { text: "What did the data show?" },
          },
        ],
      };
    if (calls === 2) throw new Error("Model connection failed");
    return reply("Resumed from the preserved question.");
  });
  const turn = f.session.enqueue(f.labId, "Investigate", intent());
  await waitUntil(() => f.turn(turn.id).status === "failed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
});

test("the scripted demo completes a real scientific record cycle and re-delivered completion events never duplicate analysis", async () => {
  const f = await fixture();
  f.session.enqueue(f.labId, "Start a demonstration", intent());
  await waitUntil(
    () =>
      f.lab.overview(f.labId).conclusions.length === 1 &&
      !f.lab.conversationView(f.labId).activeTurn,
    2500,
  ).catch(() => {
    throw new Error(
      JSON.stringify({
        turns: f.lab.conversationView(f.labId).turns,
        toolErrors: f.lab
          .conversationView(f.labId)
          .messages.filter((message) => message.toolCall?.error)
          .map((message) => message.toolCall),
      }),
    );
  });
  const overview = f.lab.overview(f.labId);
  expect(overview.runs).toHaveLength(1);
  expect(overview.runs[0]?.status).toBe("succeeded");
  expect(
    overview.runs[0]?.metrics.find((metric) => metric.name === "mean")?.value,
  ).toBe(2.5);
  expect(overview.results).toHaveLength(1);
  expect(overview.conclusions[0]?.resultIds).toEqual([
    overview.results[0]?.id ?? "missing",
  ]);
  expect(overview.hypotheses[0]?.status).toBe("supported");
  const event = overview.events.find((event) => event.kind === "run_completed");
  if (!event) throw new Error("Missing completion event");
  f.store.research.replace<LabEvent>("event", f.labId, {
    ...event,
    consumedAt: null,
  });
  f.session.tick();
  await Bun.sleep(30);
  expect(f.lab.overview(f.labId).results).toHaveLength(1);
  expect(f.lab.overview(f.labId).conclusions).toHaveLength(1);
  expect(
    f.lab
      .conversationView(f.labId)
      .turns.filter((turn) => turn.trigger === "run_completed"),
  ).toHaveLength(1);
});

test("completion analysis cannot start an unbounded chain of new executions", async () => {
  const f = await fixture();
  f.session.enqueue(f.labId, "Start a demonstration", intent());
  await waitUntil(
    () =>
      f.lab.overview(f.labId).conclusions.length === 1 &&
      !f.lab.conversationView(f.labId).activeTurn,
    2500,
  ).catch(() => {
    throw new Error(
      JSON.stringify({
        turns: f.lab.conversationView(f.labId).turns,
        toolErrors: f.lab
          .conversationView(f.labId)
          .messages.filter((message) => message.toolCall?.error)
          .map((message) => message.toolCall),
      }),
    );
  });
  const run = f.lab.overview(f.labId).runs[0];
  if (!run) throw new Error("Missing measured run");
  let calls = 0;
  await f.restart(async (input) => {
    expect(input.tools.some((tool) => tool.name === "start_run")).toBe(false);
    if (++calls === 1)
      return {
        content: "",
        calls: [
          {
            id: "chain-run",
            name: "start_run",
            arguments: { experimentId: run.experimentId },
          },
        ],
      };
    return reply("Discuss a new execution with the researcher.");
  });
  const id = randomUUID();
  f.store.research.insert<LabEvent>("event", f.labId, {
    id,
    labId: f.labId,
    kind: "run_completed",
    entityType: "run",
    entityId: run.id,
    message: "Reinspect recorded outputs",
    createdAt: new Date().toISOString(),
    consumedAt: null,
    payload: {},
  });
  f.session.tick();
  await waitUntil(() => f.turn(`event-${id}`).status === "completed");
  expect(f.lab.overview(f.labId).runs).toHaveLength(1);
  expect(
    f.lab
      .conversationView(f.labId)
      .messages.find((message) => message.toolCall?.id === "chain-run")
      ?.toolCall?.status,
  ).toBe("failed");
});
