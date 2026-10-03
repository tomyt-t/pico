import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, createApp } from "../src/app";

export type ScriptedReply =
  | { text: string }
  | { toolCalls: { name: string; arguments: Record<string, unknown> }[] };

export interface FakeModel {
  url: string;
  requests: {
    model?: string;
    messages: { role: string; content: unknown }[];
    tools?: { function: { name: string } }[];
  }[];
  script: ScriptedReply[];
  stop(): void;
}

/** A minimal OpenAI-compatible streaming endpoint driven by a script of replies. */
export function startFakeModel(
  respond?: (
    request: FakeModel["requests"][number],
  ) => ScriptedReply | Promise<ScriptedReply>,
): FakeModel {
  const requests: FakeModel["requests"] = [];
  const script: ScriptedReply[] = [];
  let counter = 0;
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      !url.pathname.endsWith("/chat/completions")
    )
      return new Response("not found", { status: 404 });
    const body = (await request.json()) as FakeModel["requests"][number];
    requests.push(body);
    const requestNumber = ++counter;
    const id = `chatcmpl-${requestNumber}`;
    const reply = respond
      ? await respond(body)
      : (script.shift() ?? { text: "(no scripted reply)" });
    const chunks: unknown[] = [];
    if ("text" in reply) {
      chunks.push({
        id,
        object: "chat.completion.chunk",
        model: body.model ?? "fake-1",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: reply.text },
            finish_reason: null,
          },
        ],
      });
      chunks.push({
        id,
        object: "chat.completion.chunk",
        model: body.model ?? "fake-1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    } else {
      chunks.push({
        id,
        object: "chat.completion.chunk",
        model: body.model ?? "fake-1",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: reply.toolCalls.map((call, index) => ({
                index,
                id: `call_${requestNumber}_${index}`,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            },
            finish_reason: null,
          },
        ],
      });
      chunks.push({
        id,
        object: "chat.completion.chunk",
        model: body.model ?? "fake-1",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
          );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const transport = fakeTransport(handle);
  return {
    url: `${transport.url}/v1`,
    requests,
    script,
    stop: transport.stop,
  };
}

/** The same HTTP/SSE fake can run without listening sockets in restricted environments. */
const memoryModels = new Map<string, (request: Request) => Promise<Response>>();
let nextMemoryModel = 0;
let nativeFetch: typeof fetch | undefined;
function fakeTransport(handle: (request: Request) => Promise<Response>) {
  if (process.env.PICO_TEST_IN_PROCESS_MODEL !== "1") {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle });
    return {
      url: `http://127.0.0.1:${server.port}`,
      stop: () => server.stop(true),
    };
  }
  const url = `http://pico-fake-${++nextMemoryModel}.invalid`;
  memoryModels.set(url, handle);
  if (!nativeFetch) {
    const original = globalThis.fetch;
    nativeFetch = original;
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        const respond = memoryModels.get(new URL(request.url).origin);
        if (!respond) return original(input, init);
        request.signal.throwIfAborted();
        return new Promise<Response>((resolve, reject) => {
          const aborted = () => reject(request.signal.reason);
          request.signal.addEventListener("abort", aborted, { once: true });
          respond(request)
            .then(resolve, reject)
            .finally(() =>
              request.signal.removeEventListener("abort", aborted),
            );
        });
      },
      { preconnect: original.preconnect },
    );
  }
  return {
    url,
    stop: () => {
      memoryModels.delete(url);
      if (!memoryModels.size && nativeFetch) {
        globalThis.fetch = nativeFetch;
        nativeFetch = undefined;
      }
    },
  };
}

export function writeFakeModels(agentDir: string, baseUrl: string): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl,
          api: "openai-completions",
          apiKey: "test-key",
          models: [
            {
              id: "fake-1",
              name: "Fake model",
              reasoning: false,
              input: ["text"],
              contextWindow: 128_000,
              maxTokens: 8192,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
}

export interface Sandbox {
  root: string;
  app: App;
  cleanup(): Promise<void>;
}

export function sandbox(
  options: { fakeModelUrl?: string; pollMs?: number } = {},
): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "pico-"));
  const agentDir = join(root, "pi");
  if (options.fakeModelUrl) writeFakeModels(agentDir, options.fakeModelUrl);
  const app = createApp({
    dataDir: join(root, "data"),
    labsDir: join(root, "labs"),
    agentDir,
    pollMs: options.pollMs ?? 100,
  });
  return {
    root,
    app,
    cleanup: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
}

export const request = (
  path: string,
  init: { method?: string; body?: unknown } = {},
): Request =>
  new Request(`http://127.0.0.1:4317/api${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers:
      init.body === undefined ? {} : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

export async function call<T>(
  app: App,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await app.fetch(request(path, init));
  const value = (await response.json()) as T;
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(value)}`);
  return value;
}
