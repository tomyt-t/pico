import type {
  AssistantMessage,
  Message,
  Models,
  Tool,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { z } from "zod";
import type { JsonObject, Message as ResearchMessage } from "@/lab/contracts";
import type {
  ModelAdapter,
  ModelMessage,
  ModelReply,
  ModelStep,
  NativeTranscript,
} from "@/lab/models/model-contract";
import { complete } from "@/lab/models/openai-compatible";

/** ModelRuntime from PiRuntime satisfies this boundary; faux Models keep tests offline. */
export interface PiInferenceRuntime {
  models(): Promise<Models>;
}

const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});
const callSchema = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.json()),
});

/** Converts historical/UI projections only. A native transcript is passed through intact. */
export function toPiMessages(messages: readonly ModelMessage[]): Message[] {
  const names = new Map<string, string>();
  return messages.map((message) => {
    if (message.native) {
      const native = decodeNative(message.native);
      if (native.role === "assistant")
        for (const block of native.content)
          if (block.type === "toolCall") names.set(block.id, block.name);
      return native;
    }
    const timestamp = message.timestamp ?? 0;
    if (message.role === "user")
      return {
        role: "user",
        timestamp,
        content: message.images?.length
          ? [
              { type: "text", text: message.content ?? "" },
              ...message.images.map((image) => ({
                type: "image" as const,
                ...image,
              })),
            ]
          : (message.content ?? ""),
      };
    if (message.role === "system")
      return { role: "system", timestamp, content: message.content ?? "" };
    if (message.role === "assistant") {
      const content: AssistantMessage["content"] = message.content
        ? [{ type: "text", text: message.content }]
        : [];
      for (const call of message.tool_calls ?? []) {
        const argumentsValue = z
          .record(z.string(), z.json())
          .parse(JSON.parse(call.function.arguments));
        content.push({
          type: "toolCall",
          id: call.id,
          name: call.function.name,
          arguments: argumentsValue,
        });
        names.set(call.id, call.function.name);
      }
      // Legacy turns have no native identity or signatures. They remain explicitly synthetic.
      return {
        role: "assistant",
        timestamp,
        api: "pico-legacy",
        provider: "pico-legacy",
        model: "pico-legacy",
        content,
        stopReason: message.tool_calls?.length ? "toolUse" : "stop",
        usage: emptyUsage(),
      };
    }
    const toolCallId = message.tool_call_id;
    if (!toolCallId)
      throw new Error("Historical tool result is missing its call identifier");
    const toolName = message.tool_name ?? names.get(toolCallId);
    if (!toolName)
      throw new Error("Historical tool result has no matching tool call");
    const content: ToolResultMessage["content"] = [
      { type: "text", text: message.content ?? "null" },
      ...(message.images ?? []).map((image) => ({
        type: "image" as const,
        ...image,
      })),
    ];
    return {
      role: "toolResult",
      toolCallId,
      toolName,
      content,
      isError: message.isError ?? false,
      timestamp,
    };
  });
}

function publicError(reason: AssistantMessage["stopReason"]): string {
  if (reason === "aborted")
    return "Pi model request was interrupted; partial output and usage were retained.";
  if (reason === "length")
    return "Pi model output reached its output limit; no tool from the incomplete response was executed.";
  if (reason === "deferred" || reason === "pending")
    return "Pi returned a deferred response that this session does not execute automatically.";
  return "Pi provider could not complete the request. Check its connection and authentication in the provider settings.";
}

function projectReply(message: AssistantMessage, aborted = false): ModelReply {
  const native = structuredClone(message);
  const usage = structuredClone(native.usage) as unknown as JsonObject;
  const content = native.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (aborted || !["stop", "toolUse"].includes(native.stopReason)) {
    const error = publicError(aborted ? "aborted" : native.stopReason);
    // Provider error text can contain request headers. Preserve protocol state, not echoed secrets.
    native.errorMessage = error;
    return { content, calls: [], usage, native: encodeNative(native), error };
  }
  try {
    const calls = native.content
      .filter((block) => block.type === "toolCall")
      .map((block) => callSchema.parse(block));
    if (
      calls.length > 20 ||
      new Set(calls.map((call) => call.id)).size !== calls.length ||
      (native.stopReason === "toolUse" && !calls.length) ||
      (!calls.length && !content.trim())
    )
      throw new Error("Invalid assistant response");
    return {
      content,
      calls: calls as ModelReply["calls"],
      native: encodeNative(native),
      usage,
    };
  } catch {
    const error =
      "Pi returned an invalid or empty tool response; no tool from this response was executed.";
    native.errorMessage = error;
    return { content, calls: [], usage, native: encodeNative(native), error };
  }
}

export function createPiAdapter(runtime: PiInferenceRuntime): ModelAdapter {
  return async (input) => {
    if (input.config.mode !== "pi") return complete(input);
    let messages: Message[];
    try {
      messages = toPiMessages(input.messages);
    } catch {
      throw new Error(
        "The persisted conversation contains an invalid tool reference; no model request was sent.",
      );
    }
    let models: Models;
    let model: ReturnType<Models["getModel"]>;
    try {
      models = await runtime.models();
      model = models.getModel(input.config.provider ?? "", input.config.model);
    } catch {
      throw new Error(
        "Pi provider catalog or authentication could not be loaded.",
      );
    }
    if (!model)
      throw new Error(
        "The selected Pi model is not in the current provider catalog.",
      );
    if (
      !model.input.includes("image") &&
      messages.some(
        (message) =>
          (message.role === "user" || message.role === "toolResult") &&
          Array.isArray(message.content) &&
          message.content.some((block) => block.type === "image"),
      )
    )
      throw new Error(
        "The selected Pi model does not support image input. Choose a multimodal model.",
      );
    const tools: Tool[] = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: Type.Unsafe(tool.parameters),
    }));
    try {
      const native = await models.completeSimple(
        model,
        { messages, tools },
        {
          signal: input.signal,
          sessionId: input.sessionId,
          ...(input.config.thinking && input.config.thinking !== "off"
            ? { reasoning: input.config.thinking }
            : {}),
          maxRetries: 0,
          timeoutMs: 120_000,
        },
      );
      return projectReply(native, input.signal.aborted);
    } catch {
      // Never persist arbitrary SDK exception text or nested credential objects.
      throw new Error(
        input.signal.aborted
          ? "Pi model request was interrupted."
          : "Pi provider request failed. Check its connection and authentication in the provider settings.",
      );
    }
  };
}

/** Native records predating the envelope are read intact, not rewritten. */
export function decodeNative(value: NativeTranscript | JsonObject): Message {
  const envelope = value as unknown as Record<string, unknown>;
  let payload: unknown = value;
  if ("format" in envelope) {
    if (envelope.format !== "pi" || envelope.version !== 1)
      throw new Error("Unsupported persisted model transcript format");
    payload = envelope.payload;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("role" in payload) ||
    !("content" in payload)
  )
    throw new Error("Invalid persisted model transcript");
  return structuredClone(payload) as Message;
}

export function encodeNative(message: Message): NativeTranscript {
  return {
    format: "pi",
    version: 1,
    payload: structuredClone(message) as unknown as JsonObject,
  };
}

export function replayGroups(
  messages: ResearchMessage[],
  steps: ModelStep[],
): ModelMessage[][] {
  const nativeSteps = new Map(steps.map((step) => [step.id, step]));
  const emitted = new Set<string>();
  const groups: ModelMessage[][] = [];
  for (const message of messages) {
    const step = message.modelStepId
      ? nativeSteps.get(message.modelStepId)
      : undefined;
    if (step?.replayable === false) continue;
    if (!step?.native) {
      const group = toModelMessages(message);
      if (group.length) groups.push(group);
      continue;
    }
    if (emitted.has(step.id)) continue;
    emitted.add(step.id);
    const native = decodeNative(step.native);
    if (native.role !== "assistant")
      throw new Error("Model step is not an assistant response");
    const calls = native.content.filter((block) => block.type === "toolCall");
    const results = calls.map((call) =>
      messages.find(
        (item) => item.modelStepId === step.id && item.toolCall?.id === call.id,
      ),
    );
    if (
      results.some(
        (result) => !result?.toolCall || result.toolCall.status === "running",
      )
    )
      continue;
    const group: ModelMessage[] = [
      {
        role: "assistant",
        content: native.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        native: encodeNative(native),
        tool_calls: calls.length
          ? calls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            }))
          : undefined,
        timestamp: native.timestamp,
      },
    ];
    for (const result of results) {
      const call = result?.toolCall;
      if (!call || !result) continue;
      const text = JSON.stringify(
        call.status === "failed"
          ? { error: call.error }
          : (call.result ?? null),
      );
      const timestamp = Date.parse(result.createdAt);
      group.push({
        role: "tool",
        tool_call_id: call.id,
        tool_name: call.name,
        content: text,
        isError: call.status === "failed",
        timestamp,
        native: encodeNative({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text }],
          isError: call.status === "failed",
          timestamp,
        }),
      });
    }
    groups.push(group);
  }
  return groups;
}

function toModelMessages(message: ResearchMessage): ModelMessage[] {
  const tool = message.toolCall;
  if (tool) {
    if (tool.status === "running") return [];
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: tool.id,
            type: "function",
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.arguments),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: tool.id,
        tool_name: tool.name,
        isError: tool.status === "failed",
        timestamp: Date.parse(message.createdAt),
        content: bounded(
          JSON.stringify(
            tool.status === "failed" ? { error: tool.error } : tool.result,
          ),
          18_000,
        ),
      },
    ];
  }
  return [
    {
      role: message.role,
      content: bounded(message.content, 14_000),
      timestamp: Date.parse(message.createdAt),
    },
  ];
}
function bounded(value: string | undefined, max: number): string {
  const content = value ?? "null";
  return content.length > max
    ? `${content.slice(0, max)}\n[Excerpt clipped; use tools to inspect the original record.]`
    : content;
}
