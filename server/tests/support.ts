import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, createApp } from "../src/app";
import type { PicoTool } from "../src/tools";
import type { FakeRequest } from "./fake-anthropic";

export {
  type FakeAnthropic as FakeModel,
  type FakeRequest,
  type ScriptedReply,
  startFakeAnthropic as startFakeModel,
} from "./fake-anthropic";

/** A closed local port: tests without a fake model can never reach a model. */
const nowhere = "http://127.0.0.1:9";

/** Everything the model was sent, for content assertions. */
export const requestText = (request: FakeRequest | undefined): string =>
  JSON.stringify({ system: request?.system, messages: request?.messages });

export const systemText = (request: FakeRequest | undefined): string =>
  JSON.stringify(request?.system ?? "");

export const toolNames = (request: FakeRequest | undefined): string[] =>
  (request?.tools ?? []).map((tool) => tool.name);

/** True once a tool result has come back within the current turn. */
export const hasToolResult = (request: FakeRequest): boolean =>
  request.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type?: string }) => part?.type === "tool_result",
      ),
  );

/** Pico tools reach the model as mcp__pico__<name>. */
export const pico = (name: string): string => `mcp__pico__${name}`;

export interface Sandbox {
  root: string;
  app: App;
  cleanup(): Promise<void>;
}

/** An app on temporary folders whose Claude Code subprocesses talk only to
 *  the given fake Messages API (PICO_TEST_FAKE_MODEL, accepted by bun test). */
export function sandbox(
  options: { fakeModelUrl?: string; pollMs?: number } = {},
): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "pico-"));
  process.env.PICO_TEST_FAKE_MODEL = options.fakeModelUrl ?? nowhere;
  const app = createApp({
    dataDir: join(root, "data"),
    labsDir: join(root, "labs"),
    claudeConfigDir: join(root, "claude"),
    pollMs: options.pollMs ?? 100,
  });
  return {
    root,
    app,
    cleanup: async () => {
      await app.close();
      await remove(root);
    },
  };
}

/** Windows keeps a folder busy for a moment after a process in it exits. */
async function remove(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++)
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 60 || (error as { code?: string }).code !== "EBUSY")
        throw error;
      await Bun.sleep(250);
    }
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

/** Runs a Pico tool's MCP handler and parses its JSON answer; an error
 *  result becomes a thrown Error, as the model would see it. */
export async function runTool(
  tool: PicoTool | undefined,
  params: Record<string, unknown>,
): Promise<ReturnType<typeof JSON.parse>> {
  if (!tool) throw new Error("Missing tool");
  const result = await tool.handler(params as never, {});
  const text = result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}
