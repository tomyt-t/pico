import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LabEvent, Message, MutationContext, Turn } from "@/lab/contracts";
import type { ModelAdapter, ModelReply } from "@/lab/models/model-contract";
import { ModelContextOverflow } from "@/lab/models/model-contract";
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
    10_000,
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
    10_000,
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

test("reported token and cost allowances pause before the next request and survive continuation", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return calls === 1
      ? {
          content: "",
          calls: [
            {
              id: "budget-record",
              name: "create_question",
              arguments: { text: "What is the baseline?" },
            },
          ],
          usage: {
            input: 80,
            output: 40,
            totalTokens: 120,
            cost: { total: 0.12 },
          },
        }
      : {
          ...reply(),
          usage: {
            input: 30,
            output: 10,
            totalTokens: 40,
            cost: { total: 0.04 },
          },
        };
  });
  f.lab.updateLab(
    f.labId,
    { settings: { maxModelTokens: 100, maxModelCostUsd: 0.1 } },
    intent(),
  );
  const turn = f.session.enqueue(f.labId, "Discuss the baseline", intent());
  await waitUntil(() => f.turn(turn.id).status === "paused");
  expect(calls).toBe(1);
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  expect(f.turn(turn.id).usage).toMatchObject({
    calls: 1,
    totalTokens: 120,
    costUsd: 0.12,
    costKnown: true,
  });
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.lab.conversationView(f.labId).usage).toMatchObject({
    calls: 2,
    totalTokens: 160,
    costUsd: 0.16,
  });
});

test("an absent provider price is unknown and cannot silently bypass a configured cost allowance", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return {
      content: "",
      calls: [{ id: "unknown-cost", name: "read_lab", arguments: {} }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  });
  f.lab.updateLab(f.labId, { settings: { maxModelCostUsd: 1 } }, intent());
  const turn = f.session.enqueue(f.labId, "Inspect the laboratory", intent());
  await waitUntil(() => f.turn(turn.id).status === "paused");
  expect(calls).toBe(1);
  expect(f.turn(turn.id).usage).toMatchObject({
    costKnown: false,
    tokensKnown: true,
    totalTokens: 15,
  });
  expect(f.turn(turn.id).error).toContain("did not report");
  f.lab.updateLab(f.labId, { settings: { maxModelCostUsd: null } }, intent());
  expect(f.lab.getLab(f.labId).settings.maxModelCostUsd).toBeNull();
});

test("context overflow reduces the durable request before retrying without repeating successful mutations", async () => {
  const sizes: number[] = [];
  let calls = 0;
  const f = await fixture(async ({ messages }) => {
    sizes.push(JSON.stringify(messages).length);
    if (++calls === 1)
      return {
        content: "",
        calls: [
          {
            id: "before-overflow",
            name: "create_question",
            arguments: { text: "x".repeat(8_000) },
          },
        ],
      };
    if (calls === 2) throw new ModelContextOverflow();
    return reply("Recovered from a smaller context.");
  });
  const turn = f.session.enqueue(
    f.labId,
    "Investigate ".repeat(2_000),
    intent(),
  );
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(calls).toBe(3);
  expect(sizes[2]).toBeLessThan(sizes[1] ?? 0);
  expect(f.turn(turn.id).contextBudgetBytes).toBe(50_000);
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
});

test("a provider that cannot fit the minimum context is not called again on an unchanged continuation", async () => {
  let calls = 0;
  let overflow = true;
  const f = await fixture(async () => {
    calls++;
    if (overflow) throw new ModelContextOverflow();
    return reply();
  });
  const turn = f.session.enqueue(f.labId, "Continue the research", intent());
  await waitUntil(() => f.turn(turn.id).status === "paused");
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "paused");
  expect(f.turn(turn.id).contextBlockedFor).toBeTruthy();
  const priorCalls = calls;
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "paused");
  expect(calls).toBe(priorCalls);
  overflow = false;
  f.lab.updateLab(
    f.labId,
    {
      settings: {
        provider: {
          ...f.lab.getLab(f.labId).settings.provider,
          model: "larger-context-model",
        },
      },
    },
    intent(),
  );
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(calls).toBe(priorCalls + 1);
});

test("completion storms are aggregated atomically and researcher turns run before queued analysis", async () => {
  const seen: string[] = [];
  const f = await fixture(async ({ messages, tools }) => {
    const last = messages.at(-1)?.content ?? "";
    seen.push(last);
    if (last.includes("(run_completed)"))
      expect(tools.some((tool) => tool.name === "start_run")).toBe(false);
    return reply();
  });
  f.session.pause();
  const eventIds: string[] = [];
  for (let index = 0; index < 40; index++) {
    const id = randomUUID();
    eventIds.push(id);
    f.store.research.insert<LabEvent>("event", f.labId, {
      id,
      labId: f.labId,
      kind: "run_completed",
      entityType: "run",
      entityId: `run-${index}`,
      message: `Condition ${index} completed`,
      createdAt: new Date().toISOString(),
      consumedAt: null,
      payload: {},
    });
  }
  const turns = f.store.conversation.consumeCompletionEvents();
  expect(turns).toHaveLength(1);
  expect(turns[0]?.eventIds).toEqual(eventIds);
  const tools = createTools(f.research, f.labId);
  let eventOffset: number | null = 0;
  let eventFingerprint: string | undefined;
  let eventJson = "";
  do {
    const page = (await tools.get("read_turn")?.execute(
      {
        id: turns[0]?.id,
        offset: eventOffset,
        maxBytes: 500,
        fingerprint: eventFingerprint,
      },
      intent(),
    )) as { content: string; nextOffset: number | null; fingerprint: string };
    eventJson += page.content;
    eventOffset = page.nextOffset;
    eventFingerprint = page.fingerprint;
  } while (eventOffset !== null);
  expect(JSON.parse(eventJson)).toHaveLength(40);
  expect(
    JSON.parse(eventJson).map((item: { eventId: string }) => item.eventId),
  ).toEqual(eventIds);
  expect(f.store.conversation.consumeCompletionEvents()).toHaveLength(0);
  expect(
    f.store.conversation
      .listMessages(f.labId)
      .every((message) => message.role === "user"),
  ).toBe(true);
  const researcher = f.session.enqueue(
    f.labId,
    "Prioritize my sampling constraint",
    intent(),
  );
  f.session.resume();
  await waitUntil(
    () =>
      f.turn(researcher.id).status === "completed" &&
      f.turn(turns[0]?.id ?? "").status === "completed",
  );
  expect(seen).toHaveLength(2);
  expect(seen[0]).toContain(`Current turn ${researcher.id} (researcher)`);
  expect(seen[1]).toContain("Prioritize my sampling constraint");
  for (const eventId of eventIds) expect(seen[1]).toContain(eventId);
  await f.restart(async () => {
    throw new Error(
      "A redelivered non-leading event must not trigger another model analysis",
    );
  });
  const secondEvent = f.lab
    .overview(f.labId)
    .events.find((event) => event.id === eventIds[1]);
  if (!secondEvent) throw new Error("Missing grouped event");
  f.store.research.replace("event", f.labId, {
    ...secondEvent,
    consumedAt: null,
  });
  f.session.tick();
  await Bun.sleep(30);
  expect(
    f.store.conversation
      .listTurns(f.labId)
      .filter((item) => item.trigger === "run_completed"),
  ).toHaveLength(1);
  expect(
    f.store.conversation
      .listMessages(f.labId)
      .filter((message) => message.eventId === secondEvent.id),
  ).toHaveLength(1);
});

test("tool file pages preserve UTF-8 bytes exactly while binary content never enters the model output", async () => {
  const f = await fixture(async () => reply());
  const question = f.lab.createQuestion(
    f.labId,
    { text: "Can we page the preserved files?" },
    intent(),
  );
  const experiment = f.lab.createExperiment(
    f.labId,
    {
      title: "File pages",
      questionIds: [question.id],
      objective: "Read files",
      protocol: "Inspect pages",
    },
    intent(),
  );
  const original = "Olá 🔬\n\u0001".repeat(3_000);
  await f.research.writeFile(
    f.labId,
    experiment.id,
    { path: "utf8.txt", content: original },
    intent(),
  );
  await f.research.writeFile(
    f.labId,
    experiment.id,
    {
      path: "opaque.dat",
      content: Buffer.alloc(80_000, 0).toString("base64"),
      encoding: "base64",
    },
    intent(),
  );
  const tools = createTools(f.research, f.labId);
  let offset: number | null = 0;
  let fingerprint: string | undefined;
  let reconstructed = "";
  do {
    const page = (await tools.get("read_file")?.execute(
      {
        experimentId: experiment.id,
        path: "utf8.txt",
        offset,
        maxBytes: 997,
        fingerprint,
      },
      intent(),
    )) as { content: string; nextOffset: number | null; fingerprint: string };
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(24_000);
    reconstructed += page.content;
    offset = page.nextOffset;
    fingerprint = page.fingerprint;
  } while (offset !== null);
  expect(reconstructed).toBe(original);
  const binary = await tools
    .get("read_file")
    ?.execute({ experimentId: experiment.id, path: "opaque.dat" }, intent());
  expect(binary).toMatchObject({ bytes: 80_000, encoding: "base64" });
  expect(binary).not.toHaveProperty("content");
  await f.research.writeFile(
    f.labId,
    experiment.id,
    { path: "utf8.txt", content: `${original}changed` },
    intent(),
  );
  await expect(
    tools.get("read_file")?.execute(
      {
        experimentId: experiment.id,
        path: "utf8.txt",
        offset: 997,
        fingerprint,
      },
      intent(),
    ),
  ).rejects.toThrow("source changed between pages");
});

test("oversized mutation acknowledgments retain a readable record reference and pages reject a changed revision", async () => {
  const f = await fixture(async () => reply());
  const tools = createTools(f.research, f.labId);
  const mutation = tools.get("create_question");
  const read = tools.get("read_record");
  if (!mutation || !read) throw new Error("Missing tools");
  const input = {
    text: "Baseline selection",
    context: "Preserved research detail. ".repeat(1_600),
  };
  const ctx = intent("oversized-record-once");
  const result = (await mutation.execute(input, ctx)) as {
    id: string;
    record: { kind: string; id: string };
    operationCompleted: boolean;
  };
  expect(result).toMatchObject({
    operationCompleted: true,
    record: { kind: "question", id: result.id },
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24_000);
  expect(await mutation.execute(input, ctx)).toEqual(result);
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  expect(f.lab.overview(f.labId).questions[0]?.context).toBe(input.context);
  const first = (await read.execute(
    { kind: "question", id: result.id, maxBytes: 1000 },
    intent(),
  )) as { nextOffset: number; fingerprint: string };
  f.lab.reviseQuestion(
    f.labId,
    result.id,
    { text: "New baseline selection" },
    intent(),
    "Correct the question",
  );
  await expect(
    read.execute(
      {
        kind: "question",
        id: result.id,
        maxBytes: 1000,
        offset: first.nextOffset,
        fingerprint: first.fingerprint,
      },
      intent(),
    ),
  ).rejects.toThrow("source changed between pages");
});

test("history byte pages freeze before the entire pending multi-tool batch", async () => {
  const f = await fixture(async () => reply());
  f.session.pause();
  const turn = f.session.enqueue(
    f.labId,
    "Preserved baseline instruction. ".repeat(900),
    intent(),
  );
  const modelStepId = randomUUID();
  const assistant: Message = {
    id: randomUUID(),
    labId: f.labId,
    conversationId: turn.conversationId,
    turnId: turn.id,
    modelStepId,
    role: "assistant",
    content: "Read history, then inspect laboratory",
    createdAt: new Date().toISOString(),
  };
  f.store.conversation.insertMessage(assistant);
  const historyCall: Message = {
    ...assistant,
    id: randomUUID(),
    role: "tool",
    content: "",
    toolCall: {
      id: "history-in-batch",
      name: "read_history",
      arguments: {},
      status: "running",
    },
  };
  const laterCall: Message = {
    ...historyCall,
    id: randomUUID(),
    toolCall: {
      id: "lab-in-batch",
      name: "read_lab",
      arguments: {},
      status: "running",
    },
  };
  f.store.conversation.insertMessage(historyCall);
  f.store.conversation.insertMessage(laterCall);
  // Also cover a group that is no longer inside the latest message page.
  for (let index = 0; index < 60; index++)
    f.store.conversation.insertMessage({
      ...assistant,
      id: randomUUID(),
      modelStepId: undefined,
      turnId: null,
      role: "user",
      content: `Future note ${index}`,
    });
  const read = createTools(f.research, f.labId).get("read_history");
  if (!read) throw new Error("Missing history tool");
  const ctx: MutationContext = {
    key: randomUUID(),
    actor: { kind: "pico", turnId: turn.id },
  };
  const first = (await read.execute({ limit: 20, maxBytes: 500 }, ctx)) as {
    before: string;
    page: { content: string; nextOffset: number; fingerprint: string };
  };
  expect(first.before).toBe(assistant.id);
  expect(first.page.nextOffset).toBeGreaterThan(0);
  if (!historyCall.toolCall || !laterCall.toolCall)
    throw new Error("Missing calls");
  f.store.conversation.saveMessage({
    ...historyCall,
    toolCall: {
      ...historyCall.toolCall,
      status: "completed",
      result: JSON.parse(JSON.stringify(first)),
    },
  });
  f.store.conversation.saveMessage({
    ...laterCall,
    toolCall: {
      ...laterCall.toolCall,
      status: "completed",
      result: { changed: "The group has completed" },
    },
  });
  const second = (await read.execute(
    {
      before: first.before,
      limit: 20,
      maxBytes: 500,
      offset: first.page.nextOffset,
      fingerprint: first.page.fingerprint,
    },
    ctx,
  )) as { page: { content: string; fingerprint: string } };
  expect(second.page.fingerprint).toBe(first.page.fingerprint);
  expect(second.page.content).toBeTruthy();
  expect(`${first.page.content}${second.page.content}`).not.toContain(
    "history-in-batch",
  );
});
