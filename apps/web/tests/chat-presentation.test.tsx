import { describe, expect, test } from "bun:test";
import type { Message } from "@pico/lab/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { relativeTime } from "@/web/components/format";
import { IdText } from "@/web/components/record-text";
import { groupMessages } from "@/web/features/chat/message-list";

const at = "2026-09-28T12:00:00Z";
const message = (id: string, tool?: string): Message => ({
  id,
  labId: "lab",
  conversationId: "conversation",
  turnId: "turn",
  role: tool ? "tool" : "assistant",
  content: "",
  createdAt: at,
  ...(tool && {
    toolCall: { id, name: tool, arguments: {}, status: "completed" },
  }),
});

describe("chat presentation", () => {
  test("consecutive tool calls form one group without reordering messages", () => {
    const groups = groupMessages([
      message("a"),
      message("b", "list_files"),
      message("c", "read_file"),
      message("d"),
      message("e", "read_file"),
    ]);
    expect(
      groups.map((entry) =>
        Array.isArray(entry) ? entry.map((row) => row.id) : entry.id,
      ),
    ).toEqual(["a", ["b", "c"], "d", ["e"]]);
  });
  test("recent times are relative and older times keep the full date", () => {
    const now = new Date(at).getTime();
    expect(relativeTime("2026-09-28T11:59:40Z", now)).toBe("agora mesmo");
    expect(relativeTime("2026-09-28T11:55:00Z", now)).not.toContain("2026");
    expect(relativeTime("2026-09-01T12:00:00Z", now)).toContain("2026");
  });
  test("record IDs are abbreviated while the full ID stays available", () => {
    const id = "be8a617a-82e6-46ac-9d7b-cbf8060f902e";
    const html = renderToStaticMarkup(<IdText>{`baseline ${id} done`}</IdText>);
    expect(html).toContain(`title="${id}"`);
    expect(html).toContain(">be8a617a<");
    expect(html).toContain("done");
  });
});
