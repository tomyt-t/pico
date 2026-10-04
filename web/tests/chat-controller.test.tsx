import { describe, expect, spyOn, test } from "bun:test";
import type { Lab, SessionState, UiMessage } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n } from "@/web/components/i18n";
import {
  Chat,
  formatCost,
  formatElapsed,
  quoteDraft,
} from "@/web/features/chat/chat-page";
import { ChatMessage } from "@/web/features/chat/message-list";
import {
  applyChatEvent,
  idleChat,
  type LabChatController,
  type LabSendLock,
  type LiveChat,
  useLabChat,
} from "@/web/features/chat/use-lab-chat";

const lab: Lab = {
  id: "pesquisa",
  name: "Pesquisa",
  path: "/labs/pesquisa",
  researchLine: "",
  provider: "fake",
  model: "fake-1",
  thinking: "off",
  createdAt: "2026-09-30T12:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
};

const state: SessionState = {
  labId: lab.id,
  streaming: false,
  model: { provider: "fake", id: "fake-1", name: "Fake" },
  thinking: "off",
  queue: { steering: [], followUp: [] },
  lastError: null,
  sessionId: "22222222-2222-4222-8222-222222222222",
  streamingText: "",
};

function controller(
  live: LiveChat,
  messages: UiMessage[] = [],
): LabChatController {
  return {
    messages,
    usage: { total: 0, cost: 0 },
    hasOlderMessages: false,
    loadingOlder: false,
    olderError: undefined,
    loadOlder: async () => false,
    state: { ...state, streaming: live.streaming },
    live,
    loading: false,
    error: undefined,
    models: [],
    working: live.streaming,
    sending: false,
    stopping: false,
    changing: false,
    sendError: null,
    controlError: null,
    settingsError: null,
    refresh: () => {},
    send: async () => true,
    stop: async () => {},
    applySettings: async () => {},
  };
}

describe("conversation recovery", () => {
  test("reconnection after a missed completion shows the saved answer once", () => {
    let live = applyChatEvent(idleChat, { type: "agent_start" });
    live = applyChatEvent(live, {
      type: "text_delta",
      delta: "Resposta final única",
    });
    live = applyChatEvent(live, {
      type: "tool_start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "PICO.md" },
    });
    live = applyChatEvent(live, {
      type: "queue",
      steering: ["Verifique também a fonte"],
      followUp: [],
    });
    live = applyChatEvent(live, { type: "compaction", phase: "start" });
    live = applyChatEvent(live, {
      type: "retry",
      attempt: 1,
      message: "Conexão interrompida",
    });

    // The new EventSource receives an idle snapshot; HTTP recovers history.
    live = applyChatEvent(live, { type: "state", state });
    const recovered = controller(live, [
      {
        id: "m-2",
        role: "assistant",
        text: "Resposta final única",
        timestamp: Date.parse(lab.createdAt),
      },
    ]);
    for (const variant of ["page", "dock"] as const) {
      const html = renderToStaticMarkup(
        <Chat
          lab={lab}
          draft="Rascunho preservado"
          onDraft={() => {}}
          controller={recovered}
          variant={variant}
        />,
      );
      expect(html.match(/Resposta final única/g)).toHaveLength(1);
      expect(html).toContain("Rascunho preservado");
      expect(html).not.toContain('class="message message-assistant live"');
      expect(html).not.toContain('class="session-indicator working"');
    }
    expect(live.tools).toEqual([]);
    expect(live.queue.steering).toEqual([]);
    expect(live.compacting).toBe(false);
    expect(live.retry).toBeNull();
  });

  test("an active reconnect replaces partial output before accepting new deltas", () => {
    let live = applyChatEvent(idleChat, {
      type: "text_delta",
      delta: "O resultado",
    });
    live = applyChatEvent(live, {
      type: "thinking_delta",
      delta: "Leitura anterior",
    });
    const snapshot: SessionState = {
      ...state,
      streaming: true,
      streamingText: "O resultado ainda é",
      queue: { steering: ["Considere outro recorte"], followUp: [] },
    };
    live = applyChatEvent(live, { type: "state", state: snapshot });
    live = applyChatEvent(live, { type: "state", state: snapshot });
    live = applyChatEvent(live, {
      type: "text_delta",
      delta: " inconclusivo.",
    });
    expect(live.text).toBe("O resultado ainda é inconclusivo.");
    expect(live.thinking).toBe("");
    expect(live.streaming).toBe(true);
    expect(live.queue.steering).toEqual(["Considere outro recorte"]);
  });

  test("a completed message does not finish the turn or its pending steering", () => {
    let live = applyChatEvent(idleChat, { type: "agent_start" });
    live = applyChatEvent(live, {
      type: "queue",
      steering: ["Explique a limitação"],
      followUp: [],
    });
    live = applyChatEvent(live, {
      type: "text_delta",
      delta: "Primeira leitura",
    });
    live = applyChatEvent(live, { type: "message_end" });
    expect(live.streaming).toBe(true);
    expect(live.queue.steering).toEqual(["Explique a limitação"]);
    live = applyChatEvent(live, { type: "text_delta", delta: "A limitação é" });
    expect(live.text).toBe("A limitação é");
    live = applyChatEvent(live, { type: "queue", steering: [], followUp: [] });
    live = applyChatEvent(live, { type: "agent_end" });
    expect(live.streaming).toBe(false);
    expect(live.text).toBe("");
    expect(live.queue.steering).toEqual([]);
  });

  test("a model error survives turn completion and clears on the next attempt", () => {
    let live = applyChatEvent(idleChat, { type: "agent_start" });
    live = applyChatEvent(live, {
      type: "error",
      message: "Modelo indisponível",
    });
    live = applyChatEvent(live, { type: "agent_end" });
    const html = renderToStaticMarkup(
      <Chat
        lab={lab}
        draft=""
        onDraft={() => {}}
        controller={controller(live)}
      />,
    );
    expect(html).toContain("Modelo indisponível");
    expect(live.streaming).toBe(false);
    live = applyChatEvent(live, { type: "agent_start" });
    expect(live.error).toBeNull();
    expect(live.streaming).toBe(true);
  });
});

describe("turn presentation", () => {
  const toolStart = (live: LiveChat, id: string, args: unknown) =>
    applyChatEvent(live, {
      type: "tool_start",
      toolCallId: id,
      toolName: id.startsWith("bash") ? "bash" : "read",
      args,
    });

  test("the tool counter follows the turn, not the message", () => {
    let live = applyChatEvent(idleChat, { type: "agent_start" });
    expect(live.turnTools).toBe(0);
    live = toolStart(live, "read-1", { path: "PICO.md" });
    live = applyChatEvent(live, {
      type: "tool_end",
      toolCallId: "read-1",
      toolName: "read",
      isError: false,
    });
    live = applyChatEvent(live, { type: "message_end" });
    live = toolStart(live, "bash-1", { command: "ls" });
    expect(live.turnTools).toBe(2);
    expect(live.tools).toHaveLength(1);
    expect(applyChatEvent(live, { type: "agent_end" }).turnTools).toBe(0);
    expect(applyChatEvent(live, { type: "state", state }).turnTools).toBe(0);
  });

  test("the working line names the current tool, elapsed time, tool count and queue", () => {
    let live = applyChatEvent(idleChat, { type: "agent_start" });
    for (let index = 0; index < 6; index++) {
      live = toolStart(live, `read-${index}`, { path: `notes/${index}.md` });
      live = applyChatEvent(live, {
        type: "tool_end",
        toolCallId: `read-${index}`,
        toolName: "read",
        isError: false,
      });
    }
    live = toolStart(live, "bash-7", { command: "cat ~/salab/README.md" });
    live = applyChatEvent(live, {
      type: "queue",
      steering: ["Considere o baseline"],
      followUp: [],
    });
    const html = renderToStaticMarkup(
      <Chat
        lab={lab}
        draft=""
        onDraft={() => {}}
        controller={controller(live)}
      />,
    );
    expect(html).toContain("Pico está trabalhando");
    expect(html).toContain("bash");
    expect(html).toContain("cat ~/salab/README.md");
    expect(html).toContain("· 0:00");
    expect(html).toContain("7 tools");
    expect(html).toContain("1 na fila");
    // Only the status line is live: streamed tokens are not announced.
    expect(html.match(/aria-live=/g)).toHaveLength(1);
    expect(html).toContain('role="status" aria-live="polite"');
  });

  test("elapsed time reads as a clock", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(133_000)).toBe("2:13");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  test("spend is shown as currency in the researcher's locale", () => {
    const html = renderToStaticMarkup(
      <Chat
        lab={lab}
        draft=""
        onDraft={() => {}}
        controller={{
          ...controller(idleChat),
          usage: { total: 65_394_139, cost: 21.261 },
        }}
      />,
    );
    expect(html.replace(/ /g, " ")).toContain("65.394.139 tokens · US$ 21,26");
    void i18n.changeLanguage("en");
    try {
      expect(formatCost(21.261)).toBe("$21.26");
    } finally {
      void i18n.changeLanguage("pt-BR");
    }
  });

  test("discussing a message quotes its start into the draft", () => {
    expect(quoteDraft("", "Primeira leitura\n\nSegunda linha")).toBe(
      "> Primeira leitura\n>\n> Segunda linha\n\n",
    );
    expect(quoteDraft("Pergunta aberta ", "Resposta")).toBe(
      "Pergunta aberta\n\n> Resposta\n\n",
    );
    expect(quoteDraft("", "a".repeat(400))).toBe(`> ${"a".repeat(300)}…\n\n`);
  });

  test("messages offer copy and discuss actions and render thinking as Markdown", () => {
    const message: UiMessage = {
      id: "m-1",
      role: "assistant",
      text: "Veja o PICO.md.",
      thinking: "Olhando o arquivo `PICO.md`",
      timestamp: Date.parse(lab.createdAt),
    };
    const html = renderToStaticMarkup(
      <ChatMessage message={message} onQuote={() => {}} />,
    );
    expect(html).toContain("Copiar");
    expect(html).toContain("Discutir");
    expect(html).toContain('aria-label="Ações da mensagem"');
    const thinking = html.slice(
      html.indexOf('class="thinking"'),
      html.indexOf("</details>"),
    );
    expect(thinking).toContain("<code>PICO.md</code>");
    expect(thinking).not.toContain("`PICO.md`");
    const plain = renderToStaticMarkup(
      <ChatMessage
        message={{ ...message, role: "user", thinking: undefined }}
      />,
    );
    expect(plain).toContain("Copiar");
    expect(plain).not.toContain("Discutir");
    const laboratory = renderToStaticMarkup(
      <ChatMessage
        message={{ ...message, role: "user", text: "[Pico] Job x terminou" }}
        onQuote={() => {}}
      />,
    );
    expect(laboratory).not.toContain("Copiar");
  });
});

function mountController(
  currentLab: Lab,
  lock: LabSendLock,
): LabChatController {
  const captured: LabChatController[] = [];
  function Capture() {
    captured.push(useLabChat(currentLab, lock));
    return null;
  }
  // A new render models remounting the lab without running browser effects.
  renderToStaticMarkup(<Capture />);
  const result = captured[0];
  if (!result) throw new Error("The controller was not rendered");
  return result;
}

describe("pending messages across laboratory switches", () => {
  test("returning to a lab keeps its pending send locked while another lab can send", async () => {
    const pending: {
      url: string;
      resolve: (response: Response) => void;
    }[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        (url: Parameters<typeof fetch>[0]) =>
          new Promise<Response>((resolve) => {
            pending.push({ url: String(url), resolve });
          }),
        { preconnect: fetch.preconnect },
      ),
    );
    let updates = 0;
    const lock: LabSendLock = {
      labs: new Set(),
      changed: () => updates++,
    };
    try {
      const first = mountController(lab, lock).send("Investigue a hipótese");
      const otherLab = { ...lab, id: "outro", name: "Outro laboratório" };
      const other = mountController(otherLab, lock).send("Consulte a fonte");
      const returned = mountController(lab, lock);
      expect(returned.sending).toBe(true);
      expect(await returned.send("Investigue a hipótese")).toBe(false);
      expect(pending.map((item) => item.url)).toEqual([
        "/api/labs/pesquisa/chat",
        "/api/labs/outro/chat",
      ]);

      pending[0]?.resolve(Response.json({ mode: "prompt" }));
      expect(await first).toBe(true);
      expect(mountController(lab, lock).sending).toBe(false);
      expect(mountController(otherLab, lock).sending).toBe(true);
      pending[1]?.resolve(Response.json({ mode: "prompt" }));
      expect(await other).toBe(true);
      expect(lock.labs.size).toBe(0);
      expect(updates).toBe(4);
    } finally {
      for (const item of pending)
        item.resolve(Response.json({ mode: "prompt" }));
      fetchSpy.mockRestore();
    }
  });

  test("a failed send releases the lab for another attempt", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        Object.assign(() => pending.promise, { preconnect: fetch.preconnect }),
      )
      .mockResolvedValue(Response.json({ mode: "prompt" }));
    const lock: LabSendLock = { labs: new Set(), changed: () => {} };
    try {
      const first = mountController(lab, lock).send("Investigue a hipótese");
      expect(mountController(lab, lock).sending).toBe(true);
      pending.reject(new TypeError("Connection interrupted"));
      expect(await first).toBe(false);
      expect(mountController(lab, lock).sending).toBe(false);
      expect(
        await mountController(lab, lock).send("Investigue a hipótese"),
      ).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
