import type { ChatView, UiMessage } from "@pico/server/contracts";
import { useEffect, useRef, useState } from "react";
import { errorText, labPath, request } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";

/** An overlapping recent page refreshes the tail without discarding older pages. */
export function mergeRecentChat(
  previous: ChatView | undefined,
  recent: ChatView,
): ChatView {
  if (!previous || previous.state.labId !== recent.state.labId) return recent;
  const first = recent.messages[0];
  if (!first) return recent;
  const index = previous.messages.findIndex(
    (message) =>
      message.id === first.id && message.timestamp === first.timestamp,
  );
  // A long disconnect or a changed session can replace the entire recent range.
  // Its cursor lets the researcher retrieve the preceding history again.
  if (index < 0) return recent;
  return {
    ...recent,
    before: previous.before,
    messages: [...previous.messages.slice(0, index), ...recent.messages],
  };
}

export function prependChatMessages(
  current: UiMessage[],
  older: UiMessage[],
): UiMessage[] {
  const known = new Set(current.map((message) => message.id));
  return [...older.filter((message) => !known.has(message.id)), ...current];
}

/** Recent messages poll normally; preceding pages are read only on demand. */
export function useChatHistory(labId: string) {
  const chat = usePoll<ChatView>(labPath(labId, "/chat?limit=50"), 20_000);
  const [history, setHistory] = useState<ChatView>();
  const current = useRef<ChatView | undefined>(undefined);
  const pending = useRef<AbortController | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different laboratory must abort and reset its loaded history.
  useEffect(() => {
    current.current = undefined;
    setHistory(undefined);
    setLoadingOlder(false);
    setOlderError(undefined);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [labId]);
  useEffect(() => {
    if (!chat.data || chat.data.state.labId !== labId) return;
    current.current = mergeRecentChat(current.current, chat.data);
    setHistory(current.current);
  }, [chat.data, labId]);
  const loadOlder = async () => {
    const snapshot = current.current;
    if (!snapshot || snapshot.before === null || pending.current) return false;
    const controller = new AbortController();
    pending.current = controller;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const page = await request<ChatView>(
        labPath(labId, `/chat?limit=50&before=${snapshot.before}`),
        { signal: controller.signal },
      );
      const latest = current.current;
      const first = snapshot.messages[0];
      if (
        controller.signal.aborted ||
        !latest ||
        latest.state.labId !== labId ||
        page.state.labId !== labId ||
        latest.before !== snapshot.before
      )
        return false;
      if (
        first &&
        !latest.messages.some(
          (message) =>
            message.id === first.id && message.timestamp === first.timestamp,
        )
      )
        return false;
      current.current = {
        ...latest,
        before: page.before,
        messages: prependChatMessages(latest.messages, page.messages),
      };
      setHistory(current.current);
      return current.current.messages.length > latest.messages.length;
    } catch (error) {
      if (!controller.signal.aborted) setOlderError(errorText(error));
      return false;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoadingOlder(false);
      }
    }
  };
  return {
    ...chat,
    data: history?.state.labId === labId ? history : undefined,
    loadingOlder,
    olderError,
    loadOlder,
  };
}
