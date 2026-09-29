import { expect, test } from "bun:test";
import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@/lab/contracts";
import type { ModelMessage } from "@/lab/models/model-contract";
import {
  createPiAdapter,
  encodeNative,
  toPiMessages,
} from "@/lab/models/pi-adapter";

const config: ProviderConfig = {
  mode: "pi",
  provider: "faux",
  model: "faux-model",
  thinking: "high",
  baseUrl: "https://unused.invalid",
  apiKeyEnv: "UNUSED_FAUX_TEST_KEY",
};
const tools = [
  {
    name: "read_lab",
    description: "Read real laboratory records",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
function fixture(images = true) {
  const faux = fauxProvider({
    provider: "faux",
    tokensPerSecond: 1_000_000,
    tokenSize: { min: 1024, max: 1024 },
    models: [
      {
        id: "faux-model",
        reasoning: true,
        input: images ? ["text", "image"] : ["text"],
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    models,
    adapter: createPiAdapter({ models: async () => models }),
  };
}
function input(
  messages: ModelMessage[] = [{ role: "user", content: "Inspect the lab" }],
) {
  return {
    config,
    messages,
    tools,
    sessionId: "conversation-123",
    signal: new AbortController().signal,
  };
}

test("uses Pi provider discovery, reasoning options, session identity and native tool blocks", async () => {
  const f = fixture();
  let received: TranscriptContext | undefined;
  const source = fauxAssistantMessage(
    [
      {
        type: "thinking",
        thinking: "Opaque test trace",
        thinkingSignature: "preserve-thinking-signature",
        redacted: true,
      },
      {
        type: "text",
        text: "I will inspect the records.",
        textSignature: "preserve-text-signature",
      },
      {
        type: "toolCall",
        id: "call-1",
        name: "read_lab",
        arguments: {},
        thoughtSignature: "preserve-tool-signature",
        namespace: "lab",
      },
    ],
    { stopReason: "toolUse", responseId: "provider-response-1" },
  );
  f.faux.setResponses([
    (context, options) => {
      received = context;
      expect(options?.reasoning).toBe("high");
      expect(options?.sessionId).toBe("conversation-123");
      expect(options?.maxRetries).toBe(0);
      expect(options?.signal).toBeDefined();
      return source;
    },
  ]);
  const result = await f.adapter(input());
  expect(f.faux.state.callCount).toBe(1);
  expect(received?.messages[0]?.role).toBe("system");
  expect(result.calls).toEqual([
    { id: "call-1", name: "read_lab", arguments: {} },
  ]);
  expect(result.content).toBe("I will inspect the records.");
  expect(JSON.stringify(result.native?.payload.content)).toBe(
    JSON.stringify(source.content),
  );
  expect(result.native?.payload.responseId).toBe("provider-response-1");
  expect(JSON.stringify(result.usage)).toBe(
    JSON.stringify(result.native?.payload.usage),
  );
  expect(JSON.stringify(result.calls)).not.toContain("signature");
});

test("replays complete native messages without dropping signatures or rebuilding the assistant", async () => {
  const f = fixture();
  const native = fauxAssistantMessage(
    [
      {
        type: "thinking",
        thinking: "retained",
        thinkingSignature: "opaque signature",
      },
      {
        type: "toolCall",
        id: "read-a",
        name: "read_lab",
        arguments: {},
        thoughtSignature: "first-tool-signature",
      },
      { type: "text", text: "Between calls", textSignature: "message-id" },
      {
        type: "toolCall",
        id: "read-b",
        name: "read_lab",
        arguments: {},
        thoughtSignature: "second-tool-signature",
      },
    ],
    { stopReason: "toolUse", responseId: "response-to-replay" },
  );
  const history: ModelMessage[] = [
    {
      role: "assistant",
      content: "This projection must not replace the original",
      native: encodeNative(native),
    },
    { role: "tool", content: '{"record":"a"}', tool_call_id: "read-a" },
    { role: "tool", content: '{"record":"b"}', tool_call_id: "read-b" },
  ];
  f.faux.setResponses([
    (context) => {
      const assistants = context.messages.filter(
        (message) => message.role === "assistant",
      );
      expect(assistants).toHaveLength(1);
      expect(assistants[0]).toEqual(native);
      expect(
        context.messages
          .filter((message) => message.role === "toolResult")
          .map((message) => message.toolCallId),
      ).toEqual(["read-a", "read-b"]);
      return fauxAssistantMessage("Both records are available.");
    },
  ]);
  expect((await f.adapter(input(history))).error).toBeUndefined();
  expect(native.content[0]).toEqual({
    type: "thinking",
    thinking: "retained",
    thinkingSignature: "opaque signature",
  });
});

test("forwards base64 image bytes in native Pi input and rejects an incompatible model", async () => {
  const image = { data: "iVBORw0KGgo=", mimeType: "image/png" };
  const f = fixture();
  f.faux.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      expect(user?.content).toEqual([
        { type: "text", text: "Inspect this image" },
        { type: "image", ...image },
      ]);
      return fauxAssistantMessage("Image received.");
    },
  ]);
  const request = input([
    { role: "user", content: "Inspect this image", images: [image] },
  ]);
  expect((await f.adapter(request)).content).toBe("Image received.");
  const textOnly = fixture(false);
  await expect(textOnly.adapter(request)).rejects.toThrow(
    "does not support image input",
  );
  expect(textOnly.faux.state.callCount).toBe(0);
});

test("retains usage and native partial state while sanitizing provider errors and refusing partial tools", async () => {
  const f = fixture();
  f.faux.setResponses([
    fauxAssistantMessage(
      [{ type: "toolCall", id: "partial", name: "read_lab", arguments: {} }],
      {
        stopReason: "error",
        errorMessage:
          "Authorization: Bearer FAKE_SECRET_SHOULD_NOT_BE_RETAINED",
      },
    ),
  ]);
  const result = await f.adapter(input());
  expect(result.calls).toEqual([]);
  expect(result.error).toContain("could not complete");
  expect(result.native?.payload.stopReason).toBe("error");
  expect(result.native?.payload.content).toHaveLength(1);
  expect(JSON.stringify(result.usage)).toBe(
    JSON.stringify(result.native?.payload.usage),
  );
  expect(JSON.stringify(result)).not.toContain("FAKE_SECRET");
});

test("malformed tool batches, truncation and empty toolUse responses never authorize execution", async () => {
  const f = fixture();
  const tool = {
    type: "toolCall" as const,
    id: "same-call",
    name: "read_lab",
    arguments: {},
  };
  f.faux.setResponses([
    fauxAssistantMessage([tool, tool], { stopReason: "toolUse" }),
    fauxAssistantMessage("", { stopReason: "toolUse" }),
    fauxAssistantMessage([tool], { stopReason: "length" }),
    fauxAssistantMessage(""),
  ]);
  for (let index = 0; index < 4; index++) {
    const result = await f.adapter(input());
    expect(result.error).toBeDefined();
    expect(result.calls).toEqual([]);
  }
});

test("cancellation uses the supplied AbortSignal and does not return executable calls", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  f.faux.setResponses([fauxAssistantMessage("Never complete this request")]);
  const result = await f.adapter({ ...input(), signal: controller.signal });
  expect(result.calls).toEqual([]);
  expect(result.error).toContain("interrupted");
  expect(["aborted", "error"]).toContain(
    String(result.native?.payload.stopReason ?? "missing"),
  );
});

test("synthetic legacy tool history gets proper Pi toolResult roles without inventing signatures", () => {
  const converted = toPiMessages([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "legacy-1",
          type: "function",
          function: { name: "read_lab", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      content: "failed",
      tool_call_id: "legacy-1",
      isError: true,
    },
  ]);
  expect(converted[0]?.role === "assistant" && converted[0].provider).toBe(
    "pico-legacy",
  );
  expect(converted[1]).toMatchObject({
    role: "toolResult",
    toolCallId: "legacy-1",
    toolName: "read_lab",
    isError: true,
  });
  expect(() =>
    toPiMessages([
      { role: "tool", content: "orphan", tool_call_id: "unknown" },
    ]),
  ).toThrow("matching tool call");
});

test("unexpected SDK exceptions cannot persist credential values", async () => {
  const f = fixture();
  f.models.completeSimple = async (): Promise<AssistantMessage> => {
    throw new Error("FAKE_SECRET_IN_SDK_EXCEPTION");
  };
  const adapter = createPiAdapter({ models: async () => f.models });
  await expect(adapter(input())).rejects.toThrow("Pi provider request failed");
});
