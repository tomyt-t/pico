import type {
  Lab,
  ModelSummary,
  SessionEvent,
  SessionState,
  UiMessage,
} from "@pico/server/contracts";
import { useEffect, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { useSessionEvents } from "@/web/api/use-events";
import { usePoll } from "@/web/api/use-poll";
import { useTranslation } from "@/web/components/i18n";
import { useChatHistory } from "@/web/features/chat/chat-history";
import type { ToolEntry } from "@/web/features/chat/message-list";

/** Asks once, only after the researcher has sent something. */
async function requestNoticePermission(): Promise<void> {
  try {
    if ("Notification" in window && Notification.permission === "default")
      await Notification.requestPermission();
  } catch {
    /* notifications are a convenience */
  }
}

function announceFinished(labName: string, text: string): void {
  if (document.visibilityState === "visible") return;
  const original = document.title.replace(/^● /, "");
  document.title = `● ${original}`;
  const restore = () => {
    if (document.visibilityState !== "visible") return;
    document.title = original;
    document.removeEventListener("visibilitychange", restore);
  };
  document.addEventListener("visibilitychange", restore);
  try {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(`Pico · ${labName}`, { body: text });
  } catch {
    /* notifications are a convenience */
  }
}

export interface LiveChat {
  streaming: boolean;
  text: string;
  thinking: string;
  tools: ToolEntry[];
  /** Tool calls started in the current turn; messages within a turn reset `tools` but not this. */
  turnTools: number;
  queue: SessionState["queue"];
  error: string | null;
  compacting: boolean;
  retry: { attempt: number; message: string } | null;
}

export const idleChat: LiveChat = {
  streaming: false,
  text: "",
  thinking: "",
  tools: [],
  turnTools: 0,
  queue: { steering: [], followUp: [] },
  error: null,
  compacting: false,
  retry: null,
};

/** SSE owns transient output; a reconnect replaces it with the server snapshot. */
export function applyChatEvent(
  previous: LiveChat,
  event: SessionEvent,
): LiveChat {
  switch (event.type) {
    case "state":
      return {
        ...idleChat,
        streaming: event.state.streaming,
        text: event.state.streamingText,
        queue: event.state.queue,
        error: event.state.lastError,
      };
    case "agent_start":
      return { ...idleChat, streaming: true, queue: previous.queue };
    case "text_delta":
      return {
        ...previous,
        streaming: true,
        text: previous.text + event.delta,
      };
    case "thinking_delta":
      return {
        ...previous,
        streaming: true,
        thinking: previous.thinking + event.delta,
      };
    case "tool_start":
      return {
        ...previous,
        turnTools: previous.turnTools + 1,
        tools: [
          ...previous.tools.filter((tool) => tool.id !== event.toolCallId),
          {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
            done: false,
          },
        ],
      };
    case "tool_end":
      return {
        ...previous,
        tools: previous.tools.map((tool) =>
          tool.id === event.toolCallId
            ? { ...tool, done: true, isError: event.isError }
            : tool,
        ),
      };
    case "message_end":
      return { ...previous, text: "", thinking: "", tools: [], retry: null };
    case "agent_end":
      return { ...idleChat, error: previous.error, queue: previous.queue };
    case "queue":
      return {
        ...previous,
        queue: { steering: event.steering, followUp: event.followUp },
      };
    case "compaction":
      return { ...previous, compacting: event.phase === "start" };
    case "retry":
      return {
        ...previous,
        retry: { attempt: event.attempt, message: event.message },
      };
    case "error":
      return {
        ...previous,
        streaming: false,
        error: event.message,
        retry: null,
        compacting: false,
      };
  }
}

type ModelPatch = { provider?: string; model?: string; thinking?: string };

/** Pending sends outlive the controller when the researcher switches labs. */
export interface LabSendLock {
  labs: Set<string>;
  changed: () => void;
}

export interface LabChatController {
  messages: UiMessage[];
  usage: { total: number; cost: number };
  hasOlderMessages: boolean;
  loadingOlder: boolean;
  olderError: string | undefined;
  loadOlder: () => Promise<boolean>;
  state: SessionState | undefined;
  live: LiveChat;
  loading: boolean;
  error: string | undefined;
  models: ModelSummary[];
  working: boolean;
  sending: boolean;
  stopping: boolean;
  changing: boolean;
  sendError: string | null;
  controlError: string | null;
  settingsError: string | null;
  refresh: () => void;
  /** True means the prompt or steering message was accepted, not completed. */
  send: (message: string) => Promise<boolean>;
  stop: () => Promise<void>;
  applySettings: (patch: ModelPatch) => Promise<void>;
}

/** Keep one instance mounted for the open lab, independently of its route. */
export function useLabChat(
  lab: Lab,
  sendLock?: LabSendLock,
): LabChatController {
  const { t } = useTranslation();
  const chat = useChatHistory(lab.id);
  const models = usePoll<ModelSummary[]>("/models", 60_000);
  const action = useAction();
  const control = useAction();
  const settings = useAction();
  const [live, setLive] = useState(idleChat);
  const [eventState, setEventState] = useState<SessionState>();
  const receivedState = useRef(false);
  const active = useRef(false);
  const sending = useRef(false);
  const refresh = chat.refresh;

  // Polling recovers state while SSE is disconnected. While connected, an older
  // HTTP response must not overwrite newer streamed text or activity.
  useEffect(() => {
    if (!receivedState.current && chat.data) {
      active.current = chat.data.state.streaming;
      setLive(
        applyChatEvent(idleChat, { type: "state", state: chat.data.state }),
      );
    }
  }, [chat.data]);

  useSessionEvents(
    lab.id,
    (event) => {
      setLive((previous) => applyChatEvent(previous, event));
      switch (event.type) {
        case "state":
          receivedState.current = true;
          active.current = event.state.streaming;
          setEventState(event.state);
          // This frame is also sent after reconnecting: recover any messages
          // finished while disconnected, without announcing an old completion.
          refresh();
          break;
        case "agent_start":
          active.current = true;
          refresh();
          break;
        case "text_delta":
        case "thinking_delta":
          active.current = true;
          break;
        case "agent_end":
          if (active.current)
            announceFinished(lab.name, t("chat.finishedNotice"));
          active.current = false;
          refresh();
          break;
        case "message_end":
        case "error":
          refresh();
          break;
      }
    },
    () => {
      receivedState.current = false;
      refresh();
    },
  );

  const state = chat.data?.state ?? eventState;
  return {
    messages: chat.data?.messages ?? [],
    usage: chat.data?.usage ?? { total: 0, cost: 0 },
    hasOlderMessages: chat.data?.before != null,
    loadingOlder: chat.loadingOlder,
    olderError: chat.olderError,
    loadOlder: chat.loadOlder,
    state: state
      ? {
          ...state,
          streaming: live.streaming,
          streamingText: live.text,
          queue: live.queue,
          lastError: live.error,
        }
      : undefined,
    live,
    loading: chat.loading,
    error: chat.error,
    models: models.data ?? [],
    working: live.streaming,
    sending: action.busy || !!sendLock?.labs.has(lab.id),
    stopping: control.busy,
    changing: settings.busy,
    sendError: action.error,
    controlError: control.error,
    settingsError: settings.error,
    refresh,
    send: async (text) => {
      const message = text.trim();
      if (!message || sending.current || sendLock?.labs.has(lab.id))
        return false;
      sending.current = true;
      sendLock?.labs.add(lab.id);
      sendLock?.changed();
      try {
        const result = await action.run<{ mode: "prompt" | "steer" }>(
          labPath(lab.id, "/chat"),
          { message },
        );
        if (!result) return false;
        refresh();
        void requestNoticePermission();
        return true;
      } finally {
        sending.current = false;
        sendLock?.labs.delete(lab.id);
        sendLock?.changed();
      }
    },
    stop: async () => {
      if (!control.busy && (await control.run(labPath(lab.id, "/chat/abort"))))
        refresh();
    },
    applySettings: async (patch) => {
      if (
        !settings.busy &&
        (await settings.run(labPath(lab.id), patch, "PATCH"))
      )
        refresh();
    },
  };
}
