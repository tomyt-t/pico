import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Turn } from "@/lab/contracts";
import type { ModelStep } from "@/lab/models/model-contract";
import { createPiAdapter, decodeNative } from "@/lab/models/pi-adapter";
import { context } from "@/lab/pico/context";
import { PicoSession } from "@/lab/pico/session";
import { createLaboratory, createResearch } from "@/lab/research/laboratory";
import { createResearchOperations } from "@/lab/research/operations";
import { createStorage } from "@/lab/storage/storage";
import { createRunner } from "../support/scientific-runner";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let iteration = 0; iteration < 300; iteration++) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("Pi session scenario did not settle");
}
async function fixture(maxModelSteps = 1) {
  const root = await mkdtemp(join(tmpdir(), "pico-pi-session-"));
  let store = createStorage(root);
  let lab = createLaboratory(store);
  const record = lab.createLab({
    name: "Pi session",
    settings: {
      maxModelSteps,
      provider: {
        mode: "pi",
        provider: "faux",
        model: "faux-model",
        thinking: "high",
        baseUrl: "https://unused.invalid",
        apiKeyEnv: "UNUSED_TEST_KEY",
      },
    },
  });
  const runner = await createRunner({ dataDir: root });
  const models = createModels();
  const faux = fauxProvider({
    provider: "faux",
    tokensPerSecond: 1_000_000,
    tokenSize: { min: 1024, max: 1024 },
    models: [{ id: "faux-model", reasoning: true, input: ["text", "image"] }],
  });
  models.setProvider(faux.provider);
  const adapter = createPiAdapter({ models: async () => models });
  const makeSession = () => {
    const operations = createResearchOperations(lab, store, runner);
    const research = createResearch({ lab, operations, execution: runner });
    const session = new PicoSession({
      lab,
      research,
      conversations: store.conversation,
      operations: store.operations,
      defaultAdapter: adapter,
    });
    session.start();
    return session;
  };
  let session = makeSession();
  cleanups.push(async () => {
    await session.close();
    await runner.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    labId: record.id,
    runner,
    faux,
    get store() {
      return store;
    },
    get lab() {
      return lab;
    },
    get session() {
      return session;
    },
    async restart() {
      await session.close();
      store.close();
      store = createStorage(root);
      lab = createLaboratory(store);
      session = makeSession();
    },
    turn(id: string) {
      const turn = store.conversation.getTurn(id);
      if (!turn) throw new Error("Missing turn");
      return turn;
    },
  };
}
function ask(
  f: Awaited<ReturnType<typeof fixture>>,
  text = "Investigate the measurement",
) {
  return f.session.enqueue(f.labId, text, {
    key: randomUUID(),
    actor: { kind: "researcher" },
  });
}

function nativeBatch(): AssistantMessage {
  const message = fauxAssistantMessage(
    [
      {
        type: "thinking",
        thinking: "native private trace".repeat(1_000),
        thinkingSignature: "thinking-signature-kept-exact",
      },
      {
        type: "text",
        text: "I will record a question.",
        textSignature: "text-phase-signature",
      },
      {
        type: "toolCall",
        id: "record-question",
        name: "create_question",
        arguments: { text: "Does the fixed sample support the hypothesis?" },
        thoughtSignature: "question-call-signature",
      },
      {
        type: "text",
        text: "Then inspect the laboratory.",
        textSignature: "second-text-signature",
      },
      {
        type: "toolCall",
        id: "inspect-lab",
        name: "read_lab",
        arguments: {},
        thoughtSignature: "read-call-signature",
      },
    ],
    {
      stopReason: "toolUse",
      responseId: "native-provider-response",
      timestamp: 1_750_000_000_000,
    },
  );
  message.responseModel = "faux-model-resolved";
  message.providerThinkingLevel = "high";
  return message;
}

test("persists the entire Pi assistant and replays one signed batch plus its ordered results after SQLite restart", async () => {
  const f = await fixture();
  f.faux.setResponses([nativeBatch()]);
  const turn = ask(f);
  await waitUntil(() => f.turn(turn.id).status === "paused");
  const saved = f.store.conversation.listModelSteps<ModelStep>(f.labId)[0];
  expect(nativeOf(saved)?.content).toEqual(nativeBatch().content);
  expect(nativeOf(saved)?.responseId).toBe("native-provider-response");
  expect(nativeOf(saved)?.responseModel).toBe("faux-model-resolved");
  expect(JSON.stringify(saved?.usage)).toBe(
    JSON.stringify(nativeOf(saved)?.usage),
  );
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  const publicConversation = JSON.stringify(f.lab.conversationView(f.labId));
  expect(publicConversation).not.toContain("native private trace");
  expect(publicConversation).not.toContain("thinking-signature-kept-exact");
  expect(publicConversation).not.toContain("native-provider-response");
  await f.restart();
  let observed: TranscriptContext | undefined;
  f.faux.setResponses([
    (nativeContext) => {
      observed = nativeContext;
      return fauxAssistantMessage(
        "The question is recorded. Let us discuss the next experiment.",
      );
    },
  ]);
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  const assistants =
    observed?.messages.filter((message) => message.role === "assistant") ?? [];
  expect(assistants).toHaveLength(1);
  expect(assistants[0]).toEqual(nativeOf(saved));
  const results =
    observed?.messages.filter((message) => message.role === "toolResult") ?? [];
  expect(results.map((result) => result.toolCallId)).toEqual([
    "record-question",
    "inspect-lab",
  ]);
  expect(results.every((result) => !result.isError)).toBe(true);
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  expect(f.store.conversation.listModelSteps<ModelStep>(f.labId)).toHaveLength(
    2,
  );
});

test("context retention cuts complete native batches and keeps native blocks intact above text excerpt limits", async () => {
  const f = await fixture();
  f.faux.setResponses([nativeBatch()]);
  const turn = ask(f);
  await waitUntil(() => f.turn(turn.id).status === "paused");
  const saved = f.store.conversation.listModelSteps<ModelStep>(f.labId)[0];
  if (!saved?.native) throw new Error("Missing native message");
  const next: Turn = {
    ...turn,
    id: randomUUID(),
    status: "running",
    message: "Review the evidence",
    steps: 0,
  };
  f.store.conversation.insertTurn(next);
  const nativeContext = context(f.lab, next, f.store.conversation);
  const replayed = nativeContext.filter(
    (message) => message.native?.payload.role === "assistant",
  );
  expect(replayed).toHaveLength(1);
  expect(JSON.stringify(replayed[0]?.native)).toBe(
    JSON.stringify(saved.native),
  );
  const toolIds = nativeContext
    .filter((message) => message.native?.payload.role === "toolResult")
    .map((message) => message.tool_call_id);
  expect(toolIds).toEqual(["record-question", "inspect-lab"]);
  const toolMessage = f.lab
    .conversationView(f.labId)
    .messages.find((message) => message.toolCall?.id === "inspect-lab");
  if (!toolMessage?.toolCall) throw new Error("Missing tool projection");
  f.store.conversation.saveMessage({
    ...toolMessage,
    toolCall: { ...toolMessage.toolCall, status: "running" },
  });
  expect(
    context(f.lab, next, f.store.conversation).some(
      (message) => message.native?.payload.role === "assistant",
    ),
  ).toBe(false);
  expect(
    context(f.lab, next, f.store.conversation).some(
      (message) => message.native?.payload.role === "toolResult",
    ),
  ).toBe(false);
});

test("provider errors keep usage and partial protocol state without executing tools or leaking error credentials", async () => {
  const f = await fixture();
  const failed = nativeBatch();
  failed.stopReason = "error";
  failed.errorMessage = "Authorization: Bearer synthetic-sensitive-header";
  f.faux.setResponses([failed]);
  const turn = ask(f);
  await waitUntil(() => f.turn(turn.id).status === "failed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(0);
  expect(
    f.lab
      .conversationView(f.labId)
      .messages.filter((message) => message.toolCall),
  ).toHaveLength(0);
  const steps = f.store.conversation.listModelSteps<ModelStep>(f.labId);
  expect(steps[0]?.replayable).toBe(false);
  expect(nativeOf(steps[0])?.stopReason).toBe("error");
  expect(JSON.stringify(steps[0]?.usage)).toBe(
    JSON.stringify(nativeOf(steps[0])?.usage),
  );
  expect(JSON.stringify(steps)).not.toContain("synthetic-sensitive-header");
  f.faux.setResponses([
    (nativeContext) => {
      expect(
        nativeContext.messages.some((message) => message.role === "assistant"),
      ).toBe(false);
      return fauxAssistantMessage(
        "The provider recovered; no scientific mutation was lost.",
      );
    },
  ]);
  f.session.continue(f.labId, turn.id);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(0);
});

test("model provenance keeps the requested configuration when settings change during inference", async () => {
  const f = await fixture();
  const requested = f.lab.getLab(f.labId).settings.provider;
  f.faux.setResponses([
    () => {
      f.lab.updateLab(
        f.labId,
        {
          settings: {
            provider: {
              ...requested,
              model: "different-model-for-next-turn",
              thinking: "low",
            },
          },
        },
        { key: randomUUID(), actor: { kind: "researcher" } },
      );
      return fauxAssistantMessage("Completed with the original configuration.");
    },
  ]);
  const turn = ask(f);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(
    f.store.conversation.listModelSteps<ModelStep>(f.labId)[0]?.provider,
  ).toEqual(requested);
  expect(f.lab.getLab(f.labId).settings.provider.model).toBe(
    "different-model-for-next-turn",
  );
});

for (const violation of ["changed arguments", "mixed identifiers"] as const) {
  test(`rejected native ${violation} still preserves the charged model response and work budget`, async () => {
    const f = await fixture(4);
    const first = fauxAssistantMessage(
      [
        {
          type: "toolCall",
          id: "original-call",
          name: "create_question",
          arguments: { text: "What does the controlled sample show?" },
        },
      ],
      { stopReason: "toolUse" },
    );
    const rejected = structuredClone(first);
    rejected.responseId = "charged-but-rejected-response";
    if (violation === "changed arguments") {
      const call = rejected.content[0];
      if (call?.type !== "toolCall") throw new Error("Missing fixture call");
      call.arguments.text = "A changed scientific mutation";
    } else {
      rejected.content.push({
        type: "toolCall",
        id: "unauthorized-extra-call",
        name: "create_question",
        arguments: { text: "An extra scientific mutation" },
      });
    }
    f.faux.setResponses([first, rejected]);
    const turn = ask(f);
    await waitUntil(() => f.turn(turn.id).status === "failed");
    expect(f.lab.overview(f.labId).questions).toHaveLength(1);
    expect(f.turn(turn.id).steps).toBe(2);
    const steps = f.store.conversation.listModelSteps<ModelStep>(f.labId);
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.usage?.totalTokens).toBe(nativeOf(step)?.usage.totalTokens);
      expect(Number(step.usage?.totalTokens)).toBeGreaterThan(0);
    }
    expect(nativeOf(steps[1])?.responseId).toBe(
      "charged-but-rejected-response",
    );
    expect(nativeOf(steps[1])?.content).toEqual(rejected.content);
    expect(steps[1]?.replayable).toBe(false);
    expect(
      context(f.lab, f.turn(turn.id), f.store.conversation).filter(
        (message) => message.native?.payload.role === "assistant",
      ),
    ).toHaveLength(1);
  });
}

test("repeated native tool IDs do not execute or replay a second scientific mutation", async () => {
  const f = await fixture(4);
  const response = fauxAssistantMessage(
    [
      {
        type: "toolCall",
        id: "same-native-call",
        name: "create_question",
        arguments: { text: "Is the sample stable?" },
        thoughtSignature: "repeat-signature",
      },
    ],
    { stopReason: "toolUse" },
  );
  f.faux.setResponses([
    response,
    response,
    (nativeContext) => {
      expect(
        nativeContext.messages.filter(
          (message) => message.role === "assistant",
        ),
      ).toHaveLength(1);
      expect(
        nativeContext.messages.filter(
          (message) => message.role === "toolResult",
        ),
      ).toHaveLength(1);
      return fauxAssistantMessage("Recorded exactly once.");
    },
  ]);
  const turn = ask(f);
  await waitUntil(() => f.turn(turn.id).status === "completed");
  expect(f.lab.overview(f.labId).questions).toHaveLength(1);
  expect(
    f.store.conversation
      .listModelSteps<ModelStep>(f.labId)
      .filter((step) => step.replayable),
  ).toHaveLength(2);
});

function nativeOf(step?: ModelStep): AssistantMessage | undefined {
  if (!step?.native) return undefined;
  const native = decodeNative(step.native);
  if (native.role !== "assistant") throw new Error("Expected native assistant");
  return native;
}
