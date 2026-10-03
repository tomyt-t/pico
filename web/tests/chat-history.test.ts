import { expect, test } from "bun:test";
import type { ChatView, UiMessage } from "@pico/server/contracts";
import {
  mergeRecentChat,
  prependChatMessages,
} from "@/web/features/chat/chat-history";
import { groupMessages } from "@/web/features/chat/message-list";

const message = (index: number): UiMessage => ({
  id: `m-${index}`,
  role: "user",
  text: `Mensagem ${index}`,
  timestamp: index + 1,
});
const view = (start: number, end: number, labId = "a"): ChatView => ({
  messages: Array.from({ length: end - start }, (_, index) =>
    message(start + index),
  ),
  before: start > 0 ? start : null,
  usage: { total: end, cost: 0 },
  state: {
    labId,
    streaming: false,
    model: null,
    thinking: "off",
    queue: { steering: [], followUp: [] },
    lastError: null,
    sessionFile: null,
    streamingText: "",
  },
});

test("refreshing the recent tail preserves loaded older messages, cursor and updated content", () => {
  const previous = view(30, 100);
  const recent = view(52, 102);
  recent.messages[0] = { ...message(52), text: "Conteúdo atualizado" };
  const merged = mergeRecentChat(previous, recent);
  expect(merged.messages).toHaveLength(72);
  expect(merged.messages[0]?.id).toBe("m-30");
  expect(merged.messages.at(-1)?.id).toBe("m-101");
  expect(merged.messages[22]?.text).toBe("Conteúdo atualizado");
  expect(merged.before).toBe(30);
  expect(merged.usage).toEqual(recent.usage);
  expect(merged.messages[0]).toBe(previous.messages[0]);
});

test("a disconnected range, changed session or lab resets to a retrievable recent page", () => {
  expect(mergeRecentChat(view(0, 50), view(100, 150))).toEqual(view(100, 150));
  expect(mergeRecentChat(view(0, 50, "a"), view(0, 50, "b"))).toEqual(
    view(0, 50, "b"),
  );
  const changed = view(0, 50);
  changed.messages[0] = { ...message(0), timestamp: 9000 };
  expect(mergeRecentChat(view(0, 50), changed)).toBe(changed);
  expect(mergeRecentChat(view(0, 50), view(0, 0))).toEqual(view(0, 0));
});

test("loading older messages keeps live arrivals and pairs tools across a page boundary", () => {
  const call: UiMessage = {
    id: "m-0",
    role: "assistant",
    text: "",
    timestamp: 1,
    toolCalls: [{ id: "call-1", name: "read", arguments: { path: "PICO.md" } }],
  };
  const result: UiMessage = {
    id: "m-1",
    role: "tool",
    text: "Direção da pesquisa",
    toolCallId: "call-1",
    toolName: "read",
    timestamp: 2,
  };
  const current = [result, message(2), message(3)];
  const merged = prependChatMessages(current, [call, result]);
  expect(merged).toEqual([call, ...current]);
  expect(merged.at(-1)).toBe(current.at(-1));
  const group = groupMessages(merged)[0];
  expect(group?.kind).toBe("tools");
  if (group?.kind === "tools")
    expect(group.items[0]?.args).toEqual({ path: "PICO.md" });
});
