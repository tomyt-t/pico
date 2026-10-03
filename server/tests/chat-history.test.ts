import { afterEach, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatView } from "../src/contracts";
import { projectMessagePage, projectMessages } from "../src/sessions";
import { call, request, type Sandbox, sandbox } from "./support";

const message = (
  index: number,
): Extract<AgentMessage, { role: "user" | "assistant" }> =>
  index % 2 === 0
    ? { role: "user", content: `Pergunta ${index}`, timestamp: index + 1 }
    : {
        role: "assistant",
        content: [{ type: "text", text: `Resposta ${index}` }],
        api: "openai-completions",
        provider: "fake",
        model: "fake-1",
        stopReason: "stop",
        timestamp: index + 1,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.01,
          },
        },
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
  expect(newest.usage.cost).toBeCloseTo(0.68);
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

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
});

test("HTTP paginates a persisted Pi session without changing its messages or crossing labs", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Histórico paginado" });
  const other = await app.labs.create({ name: "Outro chat" });
  const manager = SessionManager.create(lab.path, app.paths.sessionsDir);
  const all = Array.from({ length: 122 }, (_, index) => message(index));
  for (const item of all) manager.appendMessage(item);
  const latest = await call<ChatView>(app, `/labs/${lab.id}/chat`);
  expect(latest.messages).toHaveLength(50);
  expect(latest.before).toBe(72);
  expect(latest.state.labId).toBe(lab.id);
  const earlier = await call<ChatView>(
    app,
    `/labs/${lab.id}/chat?limit=20&before=72`,
  );
  expect(earlier.messages.map((item) => item.id)).toEqual(
    Array.from({ length: 20 }, (_, index) => `m-${52 + index}`),
  );
  expect(earlier.before).toBe(52);
  expect(earlier.usage).toEqual(latest.usage);
  expect(await app.sessions.messages(lab.id)).toEqual(projectMessages(all));
  const foreign = await call<ChatView>(app, `/labs/${other.id}/chat?before=72`);
  expect(foreign.messages).toEqual([]);
  expect(foreign.before).toBeNull();
  expect(
    (await app.fetch(request(`/labs/${lab.id}/chat?before=invalid`))).status,
  ).toBe(400);
  expect(
    (await app.fetch(request(`/labs/${lab.id}/chat?limit=0`))).status,
  ).toBe(400);
});
