import { describe, expect, test } from "bun:test";
import type { ResearchRecord, UiMessage } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";

/** Currency formatting uses non-breaking spaces; the assertions read plain ones. */
const plain = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node).replace(/\u00a0/g, " ");

import { parseRoute, recordRoute, routePath } from "@/web/app/navigation";
import { excerpt, relativeTime, statusLabel } from "@/web/components/format";
import { RecordCard } from "@/web/components/record-card";
import {
  ChatMessage,
  groupMessages,
  isLaboratoryMessage,
  parseLaboratoryEvent,
  subjectOf,
} from "@/web/features/chat/message-list";

const at = Date.parse("2026-09-28T12:00:00Z");
const message = (
  id: string,
  role: UiMessage["role"],
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role, text: "", timestamp: at, ...extra });

describe("chat presentation", () => {
  test("tool results pair with their calls and consecutive tools form one group", () => {
    const groups = groupMessages([
      message("a", "user", { text: "olá" }),
      message("b", "assistant", {
        toolCalls: [
          { id: "c1", name: "read", arguments: { path: "PICO.md" } },
          { id: "c2", name: "bash", arguments: { command: "ls" } },
        ],
      }),
      message("c", "tool", { toolCallId: "c1", toolName: "read", text: "..." }),
      message("d", "tool", {
        toolCallId: "c2",
        toolName: "bash",
        text: "x",
        isError: true,
      }),
      message("e", "assistant", { text: "feito" }),
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      "message",
      "tools",
      "message",
    ]);
    const tools = groups[1];
    if (tools?.kind !== "tools") throw new Error("expected tools");
    expect(tools.items.map((item) => item.name)).toEqual(["read", "bash"]);
    expect(tools.items[0]?.args).toEqual({ path: "PICO.md" });
    expect(tools.items[1]?.isError).toBe(true);
  });
  test("job notifications are shown as laboratory messages", () => {
    expect(
      isLaboratoryMessage(
        message("a", "user", { text: "[Pico] Job x finished" }),
      ),
    ).toBe(true);
    expect(isLaboratoryMessage(message("a", "user", { text: "oi" }))).toBe(
      false,
    );
  });
  test("campaign and agent notifications become one-line events with the full text on demand", () => {
    const text = [
      '[Pico] Campaign "Related work" (campaign-bbd2265a), update 1: active',
      "Objective: Montar o dossiê",
      "Deliverable: Record com o dossiê",
      "Três instâncias de bibliografia em paralelo.",
      "Estimated model spend: US$ 0.1739 / 5.",
      "Coordinate any requested editorial review from the main laboratory conversation.",
    ].join("\n");
    expect(parseLaboratoryEvent(text)).toEqual({
      kind: "campaign",
      title: "Related work",
      id: "campaign-bbd2265a",
      update: 1,
      status: "active",
      reason: undefined,
      excerpt: "Três instâncias de bibliografia em paralelo.",
      spend: { cost: 0.1739, budget: 5 },
    });
    const html = plain(
      <ChatMessage message={message("a", "user", { text })} />,
    );
    expect(html).toContain('class="message message-event is-busy"');
    expect(html).toContain("Related work · marco 1");
    expect(html).toContain(
      "Três instâncias de bibliografia em paralelo. · US$ 0,17 de US$ 5,00",
    );
    expect(html).toContain("Abrir");
    expect(html).toContain("Ver detalhes");
    expect(html).not.toContain("Montar o dossiê");
    expect(
      parseLaboratoryEvent(
        '[Pico] Subagent "Editor de pesquisa" (run-09e9e0f8) finished: completed\nTask: x\nResultado',
      ),
    ).toMatchObject({
      kind: "agent",
      name: "Editor de pesquisa",
      status: "completed",
    });
    expect(
      parseLaboratoryEvent(
        '[Pico] Job "treino" (job-1) finished: failed (exit code 1) in 2m.',
      ),
    ).toMatchObject({ kind: "job", status: "failed", exitCode: 1 });
    expect(parseLaboratoryEvent("[Pico] Job x terminou")).toEqual({
      kind: "other",
    });
    expect(
      subjectOf({ context: "CONTEXTO longo", title: "Related work" }),
    ).toBe("Related work");
    expect(subjectOf({ agent_id: "bibliography", task: "Buscar fontes" })).toBe(
      "Buscar fontes",
    );
  });
  test("recent times are relative and older times keep the full date", () => {
    expect(relativeTime(at - 20_000, at)).toBe("agora mesmo");
    expect(relativeTime(at - 5 * 60_000, at)).not.toContain("2026");
    expect(relativeTime(at - 30 * 86_400_000, at)).toContain("2026");
  });
});

describe("navigation and records", () => {
  test("routes carry page, id and path", () => {
    expect(
      parseRoute("#/labs/futebol/files?path=experiments%2Fbaseline"),
    ).toEqual({
      labId: "futebol",
      page: "files",
      path: "experiments/baseline",
    });
    expect(parseRoute("#/labs/futebol/experiments/job-1234")).toMatchObject({
      page: "experiments",
      id: "job-1234",
    });
    expect(parseRoute("#/nope")).toBeNull();
    expect(routePath({ labId: "a b", page: "overview", id: "q-1" })).toBe(
      "#/labs/a%20b/overview/q-1",
    );
  });
  test("records open on the page of their kind", () => {
    expect(recordRoute("lab", { kind: "paper", id: "p-1" }).page).toBe(
      "collection",
    );
    expect(recordRoute("lab", { kind: "result", id: "r-1" }).page).toBe(
      "experiments",
    );
    expect(recordRoute("lab", { kind: "", id: "job-1" }).page).toBe(
      "experiments",
    );
    expect(recordRoute("lab", { kind: "note", id: "n-1" }).page).toBe(
      "collection",
    );
  });
  test("a record card shows title, status, kind and an excerpt", () => {
    const record: ResearchRecord = {
      id: "q-abc",
      labId: "lab",
      kind: "question",
      title: "Elo prevê?",
      status: "open",
      body: "# Contexto\n\nTexto **longo** aqui.",
      fields: {},
      links: [],
      author: "pico",
      revision: 1,
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at).toISOString(),
    };
    const html = plain(<RecordCard record={record} />);
    expect(html).toContain("Elo prevê?");
    expect(html).toContain(statusLabel("open"));
    expect(html).toContain("Pergunta");
    expect(html).toContain("Contexto Texto longo aqui.");
    expect(excerpt("a".repeat(400)).length).toBe(280);
  });
});
