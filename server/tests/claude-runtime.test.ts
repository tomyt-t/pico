import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  ClaudeSession,
  type ClaudeSessionEvent,
  type ClaudeSessionOptions,
  noteText,
  parseNote,
  planLimitMessage,
  readTranscript,
  thinkingOptions,
} from "../src/claude-runtime";
import { type FakeAnthropic, startFakeAnthropic } from "./fake-anthropic";
import { until } from "./support";

let root: string;
let fake: FakeAnthropic;
let toolMs = 0;
const toolCalls: string[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pico-claude-"));
  mkdirSync(join(root, "lab"));
  // Transcripts are read in this process through the same config dir.
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  fake = startFakeAnthropic();
});

afterAll(async () => {
  fake.stop();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

function options(
  overrides: Partial<ClaudeSessionOptions> = {},
): ClaudeSessionOptions {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    ANTHROPIC_BASE_URL: fake.url,
    ANTHROPIC_API_KEY: "test",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return {
    cwd: join(root, "lab"),
    model: "claude-sonnet-4-5",
    systemPrompt: "You are Pico in the test laboratory.",
    env,
    mcpServers: () => ({
      pico: createSdkMcpServer({
        name: "pico",
        alwaysLoad: true,
        tools: [
          tool("echo", "Echo text", { text: z.string() }, async (args) => {
            toolCalls.push(args.text);
            await Bun.sleep(toolMs);
            return { content: [{ type: "text", text: `echo:${args.text}` }] };
          }),
        ],
      }),
    }),
    ...overrides,
  };
}

function record(session: ClaudeSession): ClaudeSessionEvent[] {
  const events: ClaudeSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return events;
}

const requestText = (index: number) =>
  JSON.stringify(fake.requests[index]?.messages ?? []);

describe("Claude runtime helpers", () => {
  test("maps Pico thinking levels to adaptive thinking and effort", () => {
    expect(thinkingOptions("off")).toEqual({ thinking: { type: "disabled" } });
    expect(thinkingOptions("minimal")).toEqual({
      thinking: { type: "adaptive" },
      effort: "low",
    });
    expect(thinkingOptions("xhigh")).toEqual({
      thinking: { type: "adaptive" },
      effort: "xhigh",
    });
    expect(thinkingOptions(undefined)).toEqual({});
  });

  test("notes carry a stable marker with details", () => {
    const text = noteText("campaign-result", "Body\nline", {
      source: "run 1]",
    });
    expect(text.startsWith("[pico:campaign-result source=")).toBe(true);
    expect(parseNote(text)).toEqual({
      kind: "campaign-result",
      details: { source: "run 1]" },
      content: "Body\nline",
    });
    expect(parseNote("plain text")).toBeNull();
  });
});

describe("ClaudeSession on the fake Messages API", () => {
  test("runs a turn with Pico tools, fresh context and streaming events", async () => {
    fake.requests.length = 0;
    let context = 0;
    const usage: { tokens: number; cost: number }[] = [];
    const session = await ClaudeSession.create(
      options({
        context: () => `Laboratory context revision ${++context}`,
        onUsage: (value) => usage.push(value),
      }),
    );
    const events = record(session);
    fake.script.push(
      { toolCalls: [{ name: "mcp__pico__echo", arguments: { text: "hi" } }] },
      { text: "Done.", thinking: "Checking." },
    );
    await session.prompt("Say hi through the tool");

    expect(session.isStreaming).toBe(false);
    expect(session.sessionId).toBeTruthy();
    expect(session.lastResult).toMatchObject({ ok: true, text: "Done." });
    expect(toolCalls).toContain("hi");
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("agent_start");
    expect(types.at(-1)).toBe("agent_end");
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
    expect(events).toContainEqual({ type: "text_delta", delta: "Done." });
    expect(events).toContainEqual({
      type: "thinking_delta",
      delta: "Checking.",
    });
    expect(usage.length).toBe(1);
    expect(usage[0]?.tokens).toBeGreaterThan(0);

    const request = fake.requests[0];
    const tools = request?.tools?.map((tool) => tool.name) ?? [];
    expect(tools).toContain("mcp__pico__echo");
    expect(tools).toContain("Bash");
    expect(tools).not.toContain("Task");
    expect(tools).not.toContain("Agent");
    expect(JSON.stringify(request?.system)).toContain(
      "You are Pico in the test laboratory.",
    );
    expect(requestText(0)).toContain("Laboratory context revision 1");

    const kinds = session.messages.map((message) => message.type);
    expect(kinds).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "assistant",
    ]);
    expect(session.messages[0]?.message).toEqual({
      role: "user",
      content: "Say hi through the tool",
    });
    await session.dispose();
  }, 30_000);

  test("steering waits for the running tool and joins the same turn", async () => {
    fake.requests.length = 0;
    toolMs = 1500;
    try {
      const session = await ClaudeSession.create(options());
      const events = record(session);
      fake.script.push(
        {
          toolCalls: [{ name: "mcp__pico__echo", arguments: { text: "slow" } }],
        },
        { text: "Saw the steering message." },
      );
      const done = session.prompt("Start slow work");
      await until(
        () => events.some((event) => event.type === "tool_execution_start"),
        10_000,
        "tool start",
      );
      await session.steer("Job job-1 finished");
      expect(session.queue.steering).toEqual(["Job job-1 finished"]);
      await done;
      const end = events.find((event) => event.type === "tool_execution_end");
      expect(end).toMatchObject({ isError: false });
      expect(fake.requests.length).toBe(2);
      expect(requestText(1)).toContain("Job job-1 finished");
      expect(requestText(1)).toContain("echo:slow");
      expect(session.queue).toEqual({ steering: [], followUp: [] });
      expect(
        session.messages.some(
          (message) =>
            message.type === "user" &&
            JSON.stringify(message.message).includes("Job job-1 finished"),
        ),
      ).toBe(true);
      await session.dispose();
    } finally {
      toolMs = 0;
    }
  }, 30_000);

  test("a prompt counts as recorded only once Claude Code has taken it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = startFakeAnthropic(async () => {
      await gate;
      return { text: "Taken." };
    });
    try {
      const session = await ClaudeSession.create(
        options({ env: { ...options().env, ANTHROPIC_BASE_URL: gated.url } }),
      );
      const has = (entries: readonly { type: string; message: unknown }[]) =>
        entries.some(
          (entry) =>
            entry.type === "user" &&
            JSON.stringify(entry.message).includes("Outcome of run-9"),
        );
      const done = session.prompt("Outcome of run-9");
      // Shown at once, but not yet a delivery receipt.
      expect(has(session.messages)).toBe(true);
      expect(has(session.recorded)).toBe(false);
      await until(() => gated.requests.length > 0, 10_000, "model request");
      release();
      await done;
      expect(has(session.recorded)).toBe(true);
      await session.dispose();
    } finally {
      gated.stop();
    }
  }, 30_000);

  test("notes are recorded without a turn and read with the next prompt", async () => {
    fake.requests.length = 0;
    const session = await ClaudeSession.create(options());
    const events = record(session);
    await session.appendNote("campaign-result", "Agent run-1 completed", {
      source: "run-1",
    });
    expect(fake.requests.length).toBe(0);
    expect(events.some((event) => event.type === "agent_start")).toBe(false);

    fake.script.push({ text: "Integrated." });
    await session.prompt("Continue the campaign");
    expect(fake.requests.length).toBe(1);
    expect(requestText(0)).toContain("Agent run-1 completed");
    const notes = session.messages
      .filter((message) => message.type === "user")
      .map((message) => {
        const content = (message.message as { content: unknown }).content;
        return typeof content === "string" ? parseNote(content) : null;
      })
      .filter(Boolean);
    expect(notes).toEqual([
      {
        kind: "campaign-result",
        details: { source: "run-1" },
        content: "Agent run-1 completed",
      },
    ]);
    await session.dispose();
  }, 30_000);

  test("a failing tool guard denies the call and stops the turn", async () => {
    fake.requests.length = 0;
    toolCalls.length = 0;
    const session = await ClaudeSession.create(
      options({
        onBeforeTool: () => {
          throw new Error("Campaign is paused (researcher)");
        },
      }),
    );
    fake.script.push(
      {
        toolCalls: [
          { name: "mcp__pico__echo", arguments: { text: "blocked" } },
        ],
      },
      { text: "should not run" },
    );
    await session.prompt("Try the tool");
    expect(toolCalls).not.toContain("blocked");
    expect(fake.requests.length).toBe(1);
    expect(session.isStreaming).toBe(false);
    fake.script.length = 0;
    await session.dispose();
  }, 30_000);

  test("a stopped campaign ends the turn after its tools, and a refused prompt never reaches the model", async () => {
    fake.requests.length = 0;
    toolCalls.length = 0;
    let stop: string | null = null;
    let refuse: string | null = null;
    const session = await ClaudeSession.create(
      options({
        stopAfterTools: () => stop,
        onBeforePrompt: () => {
          if (refuse) throw new Error(refuse);
        },
      }),
    );
    fake.script.push(
      {
        toolCalls: [{ name: "mcp__pico__echo", arguments: { text: "last" } }],
      },
      { text: "should not be requested" },
    );
    stop = "Campaign is waiting (results)";
    await session.prompt("Work, then wait");
    expect(toolCalls).toContain("last");
    expect(fake.requests.length).toBe(1);
    expect(session.lastResult).toMatchObject({
      ok: true,
      terminalReason: "hook_stopped",
    });
    fake.script.length = 0;

    refuse = "Campaign is paused (researcher)";
    await session.prompt("Keep working");
    expect(fake.requests.length).toBe(1);
    expect(session.isStreaming).toBe(false);
    expect(session.lastResult).toMatchObject({
      ok: false,
      text: "Campaign is paused (researcher)",
    });
    await session.dispose();
  }, 30_000);

  test("abort stops a running tool and the session stays usable", async () => {
    fake.requests.length = 0;
    toolMs = 5000;
    try {
      const session = await ClaudeSession.create(options());
      const events = record(session);
      fake.script.push({
        toolCalls: [{ name: "mcp__pico__echo", arguments: { text: "long" } }],
      });
      const done = session.prompt("Run something long");
      await until(
        () => events.some((event) => event.type === "tool_execution_start"),
        10_000,
        "tool start",
      );
      await session.abort();
      await done;
      expect(session.isStreaming).toBe(false);
      expect(session.lastResult?.ok).toBe(false);

      fake.script.push({ text: "Back." });
      await session.prompt("Are you there?");
      expect(session.lastResult).toMatchObject({ ok: true, text: "Back." });
      await session.dispose();
    } finally {
      toolMs = 0;
    }
  }, 30_000);

  test("a plan limit stops the running turn when the owner asks for it", async () => {
    fake.requests.length = 0;
    toolMs = 5000;
    try {
      const limits: (number | undefined)[] = [];
      const session = await ClaudeSession.create(
        options({ onPlanLimit: (resetsAt) => limits.push(resetsAt) }),
      );
      const events = record(session);
      fake.script.push({
        toolCalls: [
          { name: "mcp__pico__echo", arguments: { text: "limited" } },
        ],
      });
      const done = session.prompt("Work until the plan limit");
      await until(
        () => events.some((event) => event.type === "tool_execution_start"),
        10_000,
        "tool start",
      );
      // Claude Code reports plan limits only to subscription logins, which
      // tests never use: deliver the event as the CLI would.
      const resetsAt = Math.floor(Date.now() / 1000) + 3600;
      await (
        session as unknown as { handle(message: unknown): Promise<void> }
      ).handle({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt },
        uuid: crypto.randomUUID(),
        session_id: session.sessionId,
      });
      await done;
      expect(limits).toEqual([resetsAt]);
      expect(session.lastResult).toMatchObject({
        ok: false,
        text: planLimitMessage(resetsAt),
      });
      expect(session.lastResult?.text).toContain(
        new Date(resetsAt * 1000).toISOString(),
      );
      expect(fake.requests.length).toBe(1);
      await session.dispose();
    } finally {
      toolMs = 0;
    }
  }, 30_000);

  test("resumes a conversation in a new process with a usage baseline", async () => {
    let recorded = 0;
    let tokens = 0;
    const first = await ClaudeSession.create(
      options({
        onUsage: (usage) => {
          recorded += usage.cost;
          tokens += usage.tokens;
        },
      }),
    );
    fake.script.push({ text: "First answer." });
    await first.prompt("Remember the number 7");
    const sessionId = first.sessionId as string;
    await first.dispose();
    expect(recorded).toBeGreaterThan(0);
    expect(first.usage).toEqual({ tokens, cost: recorded });

    const transcript = await readTranscript(sessionId);
    expect(transcript.length).toBeGreaterThanOrEqual(2);

    const costs: number[] = [];
    const second = await ClaudeSession.create(
      options({
        resume: sessionId,
        // A resumed process reports the transcript's running total; the
        // owner passes what it already recorded so only new spend counts.
        usageBaseline: { tokens, cost: recorded },
        onUsage: ({ cost }) => costs.push(cost),
      }),
    );
    expect(second.sessionId).toBe(sessionId);
    expect(second.messages.length).toBe(transcript.length);
    fake.requests.length = 0;
    fake.script.push({ text: "It was 7." });
    await second.prompt("Which number?");
    expect(second.sessionId).toBe(sessionId);
    expect(requestText(0)).toContain("Remember the number 7");
    expect(costs.length).toBe(1);
    expect(costs[0]).toBeCloseTo(recorded, 8);
    await second.dispose();

    const missing = await ClaudeSession.create(
      options({ resume: crypto.randomUUID() }),
    );
    expect(missing.sessionId).toBeNull();
    expect(missing.messages).toEqual([]);
    await missing.dispose();
  }, 30_000);

  test("a new turn picks up an edited system prompt and budget balance", async () => {
    let prompt = "FIRST-PROMPT";
    let balance = 1;
    const session = await ClaudeSession.create(
      options({ systemPrompt: () => prompt, maxBudgetUsd: () => balance }),
    );
    fake.requests.length = 0;
    fake.script.push({ text: "One." });
    await session.prompt("First turn");
    const sessionId = session.sessionId;
    prompt = "EDITED-PROMPT";
    fake.script.push({ text: "Two." });
    await session.prompt("Second turn");
    expect(JSON.stringify(fake.requests[0]?.system)).toContain("FIRST-PROMPT");
    expect(JSON.stringify(fake.requests[1]?.system)).toContain("EDITED-PROMPT");
    expect(requestText(1)).toContain("First turn");
    expect(session.sessionId).toBe(sessionId);

    // Claude Code stops a process at its own budget; a raised balance
    // starts a new process for the next turn.
    fake.usage.input_tokens = 50_000;
    balance = 0.01;
    try {
      fake.script.push({ text: "Expensive." });
      await session.prompt("Spend it");
      fake.script.push({ text: "Refused." });
      await session.prompt("Over budget");
      expect(session.lastResult?.subtype).toBe("error_max_budget_usd");
      balance = 1;
      fake.script.push({ text: "Allowed again." });
      await session.prompt("More budget");
      expect(session.lastResult).toMatchObject({
        ok: true,
        text: "Allowed again.",
      });
    } finally {
      fake.usage.input_tokens = 10;
    }
    await session.dispose();
  }, 30_000);

  test("model errors end the turn with a failed result", async () => {
    const session = await ClaudeSession.create(options());
    const events = record(session);
    fake.script.push({
      error: {
        status: 400,
        type: "invalid_request_error",
        message: "prompt is too long",
      },
    });
    await session.prompt("Too much");
    expect(session.lastResult?.ok).toBe(false);
    expect(
      events.some(
        (event) => event.type === "message_end" && event.error !== undefined,
      ),
    ).toBe(true);
    await session.dispose();
  }, 30_000);
});
