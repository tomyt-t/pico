import { afterEach, expect, test } from "bun:test";
import { noteText, type TranscriptMessage } from "../src/claude-runtime";
import type { ChatView } from "../src/contracts";
import { projectMessagePage, projectMessages } from "../src/sessions";
import {
  call,
  type FakeModel,
  request,
  type Sandbox,
  sandbox,
  startFakeModel,
  until,
} from "./support";

const at = (index: number) => new Date(index + 1).toISOString();

const message = (index: number): TranscriptMessage =>
  index % 2 === 0
    ? {
        type: "user",
        uuid: `u-${index}`,
        message: { role: "user", content: `Pergunta ${index}` },
        timestamp: at(index),
      }
    : {
        type: "assistant",
        uuid: `a-${index}`,
        message: {
          id: `msg_${index}`,
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: `Resposta ${index}` }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        timestamp: at(index),
      };

test("chat pages retrieve recent and preceding messages with stable IDs and complete usage", () => {
  const all = Array.from({ length: 137 }, (_, index) => message(index));
  const newest = projectMessagePage(all);
  expect(newest.messages).toHaveLength(50);
  expect(newest.messages[0]?.id).toBe("m-87");
  expect(newest.before).toBe(87);
  const middle = projectMessagePage(all, { before: newest.before ?? 0 });
  const oldest = projectMessagePage(all, { before: middle.before ?? 0 });
  expect(middle.messages).toHaveLength(50);
  expect(oldest.messages).toHaveLength(37);
  expect(oldest.before).toBeNull();
  expect([...oldest.messages, ...middle.messages, ...newest.messages]).toEqual(
    projectMessages(all),
  );
  expect(newest.usage.total).toBe(136);
  expect(middle.usage).toEqual(newest.usage);
  // Messages appended while scrolling do not move an earlier page's boundary.
  expect(
    projectMessagePage([...all, message(137)], { before: 87 }).messages,
  ).toEqual(middle.messages);
});

test("chat pagination bounds requests and rejects invalid cursors", () => {
  const all = Array.from({ length: 120 }, (_, index) => message(index));
  expect(projectMessagePage(all, { limit: 10000 }).messages).toHaveLength(100);
  expect(projectMessagePage(all, { before: 0 }).messages).toEqual([]);
  expect(projectMessagePage(all, { before: 999 }).messages).toHaveLength(50);
  expect(projectMessagePage([])).toEqual({
    messages: [],
    before: null,
    usage: { total: 0, cost: 0 },
  });
  for (const before of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => projectMessagePage(all, { before })).toThrow(
      "Invalid message cursor",
    );
  for (const limit of [0, -1, 0.5, Number.NaN])
    expect(() => projectMessagePage(all, { limit })).toThrow(
      "Invalid message limit",
    );
});

test("the projection joins one response's blocks, pairs tool results and shows notes as system messages", () => {
  const response = {
    id: "msg_1",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason: "tool_use",
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 5,
      output_tokens: 3,
    },
  };
  const entries: TranscriptMessage[] = [
    {
      type: "user",
      uuid: "u-1",
      message: { role: "user", content: "Salve a pergunta" },
      timestamp: at(1),
    },
    {
      type: "assistant",
      uuid: "a-1",
      message: {
        ...response,
        content: [{ type: "thinking", thinking: "Planejando" }],
      },
      timestamp: at(2),
    },
    {
      type: "assistant",
      uuid: "a-2",
      message: {
        ...response,
        content: [
          { type: "text", text: "Vou salvar." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "mcp__pico__save_record",
            input: { kind: "question" },
          },
        ],
      },
      timestamp: at(3),
    },
    {
      type: "user",
      uuid: "u-2",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: '{"saved":"q-1"}' }],
          },
        ],
      },
      timestamp: at(4),
    },
    {
      type: "user",
      uuid: "u-3",
      message: {
        role: "user",
        content: noteText("campaign-result", "Agent run-1 completed", {
          source: "run-1",
        }),
      },
      timestamp: at(5),
    },
  ];
  expect(projectMessages(entries)).toEqual([
    { id: "m-0", role: "user", text: "Salve a pergunta", timestamp: 2 },
    {
      id: "m-1",
      role: "assistant",
      text: "Vou salvar.",
      thinking: "Planejando",
      toolCalls: [
        { id: "toolu_1", name: "save_record", arguments: { kind: "question" } },
      ],
      model: "anthropic/claude-sonnet-5-5",
      stopReason: "tool_use",
      usage: { input: 15, output: 3, total: 18, cost: 0 },
      timestamp: 3,
    },
    {
      id: "m-2",
      role: "tool",
      text: '{"saved":"q-1"}',
      toolCallId: "toolu_1",
      toolName: "save_record",
      isError: false,
      timestamp: 5,
    },
    {
      id: "m-3",
      role: "system",
      kind: "campaign-result",
      text: "Agent run-1 completed",
      timestamp: 6,
    },
  ]);
});

let box: Sandbox | undefined;
let fake: FakeModel | undefined;
afterEach(async () => {
  await box?.cleanup();
  fake?.stop();
  box = undefined;
  fake = undefined;
});

test("HTTP paginates a persisted Claude Code session without changing its messages or crossing labs", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Histórico paginado",
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  const other = await app.labs.create({ name: "Outro chat" });
  for (const index of [0, 1, 2]) {
    fake.script.push({ text: `Resposta ${index}` });
    await app.sessions.send(lab.id, `Pergunta ${index}`);
    await until(
      async () => !(await app.sessions.state(lab.id)).streaming,
      15_000,
    );
  }
  const latest = await call<ChatView>(app, `/labs/${lab.id}/chat?limit=4`);
  expect(latest.messages.map((item) => item.text)).toEqual([
    "Pergunta 1",
    "Resposta 1",
    "Pergunta 2",
    "Resposta 2",
  ]);
  expect(latest.before).toBe(2);
  expect(latest.state.labId).toBe(lab.id);
  expect(latest.usage.total).toBeGreaterThan(0);
  const earlier = await call<ChatView>(
    app,
    `/labs/${lab.id}/chat?limit=20&before=2`,
  );
  expect(earlier.messages.map((item) => item.id)).toEqual(["m-0", "m-1"]);
  expect(earlier.before).toBeNull();
  expect(earlier.usage).toEqual(latest.usage);
  expect(await app.sessions.messages(lab.id)).toEqual([
    ...earlier.messages,
    ...latest.messages,
  ]);
  const foreign = await call<ChatView>(app, `/labs/${other.id}/chat?before=2`);
  expect(foreign.messages).toEqual([]);
  expect(foreign.before).toBeNull();
  expect(
    (await app.fetch(request(`/labs/${lab.id}/chat?before=invalid`))).status,
  ).toBe(400);
  expect(
    (await app.fetch(request(`/labs/${lab.id}/chat?limit=0`))).status,
  ).toBe(400);
}, 40_000);
