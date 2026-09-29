import type { Lab, Message, RecordReference, Turn } from "@pico/lab/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, labPath, request } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { usePoll } from "@/web/api/use-poll";
import { routePath } from "@/web/app/navigation";
import { statusLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Icon, Loading, Notice } from "@/web/components/primitives";
import { useConversation } from "@/web/features/chat/conversation-queries";
import { MessageComposer } from "@/web/features/chat/message-composer";
import {
  ChatMessage,
  groupMessages,
  ToolCallGroup,
} from "@/web/features/chat/message-list";
import {
  bridgeMessages,
  clearSubmittedDraft,
  hasHistoryGap,
  hasNewActivity,
  mergeMessages,
} from "@/web/features/chat/timeline";

export function Chat({
  lab,
  draft,
  onDraft,
  onRefresh,
}: {
  lab: Lab;
  draft: string;
  onDraft: (draft: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const conversation = useConversation(lab.id);
  const index = usePoll<RecordReference[]>(
    labPath(lab.id, "/record-index"),
    10000,
  );
  const links = Object.fromEntries(
    (index.data ?? []).map((record) => [
      record.id,
      {
        title: record.title,
        href: routePath({
          labId: lab.id,
          page:
            record.kind === "paper" || record.kind === "dataset"
              ? "library"
              : record.kind === "experiment" || record.experimentId
                ? "experiments"
                : "overview",
          id: record.experimentId ?? record.questionId ?? record.id,
          tab:
            record.kind === "run"
              ? "runs"
              : record.kind === "dataset"
                ? "datasets"
                : undefined,
          focus: `${record.kind}-${record.id}`,
        }),
      },
    ]),
  );
  const action = useMutation();
  const control = useMutation();
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const seen = useRef<string | undefined>(undefined);
  const [sent, setSent] = useState(false);
  const [behind, setBehind] = useState(false);
  const [timeline, setTimeline] = useState<Message[]>([]);
  const timelineRef = useRef<Message[]>([]);
  const pendingWindow = useRef<Message[] | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const receiving = useRef(false);
  const mounted = useRef(false);
  const [gap, setGap] = useState<{ busy: boolean; error?: string } | null>(
    null,
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [historyEnd, setHistoryEnd] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const view = conversation.data;
  const active = view?.activeTurn;
  const lastTurn = [...(view?.turns ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const paused =
    active?.status === "paused"
      ? active
      : (view?.resumableTurns?.[0] ??
        (lastTurn &&
        ["paused", "interrupted", "failed", "cancelled"].includes(
          lastTurn.status,
        )
          ? lastTurn
          : null));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingWindow.current = null;
      historyController.current?.abort();
    };
  }, []);
  const receiveWindow = useCallback(async () => {
    if (receiving.current || !mounted.current) return;
    receiving.current = true;
    const controller = new AbortController();
    historyController.current = controller;
    try {
      // Polling may continue while a long gap is filled. Process its newest
      // window afterwards instead of aborting/restarting the same pagination.
      while (pendingWindow.current && !controller.signal.aborted) {
        const incoming = pendingWindow.current;
        pendingWindow.current = null;
        if (hasHistoryGap(timelineRef.current, incoming))
          setGap({ busy: true });
        try {
          const complete = await bridgeMessages(
            timelineRef.current,
            incoming,
            (before) =>
              request<Message[]>(
                labPath(
                  lab.id,
                  `/history?before=${encodeURIComponent(before)}&limit=100`,
                ),
                { signal: controller.signal },
              ),
          );
          if (!mounted.current || controller.signal.aborted) return;
          const merged = mergeMessages(timelineRef.current, complete);
          timelineRef.current = merged;
          setTimeline(merged);
          setGap(null);
        } catch (error) {
          if (!mounted.current || controller.signal.aborted) return;
          pendingWindow.current ??= incoming;
          setGap({
            busy: false,
            error:
              error instanceof Error && error.message === "HISTORY_GAP"
                ? undefined
                : errorText(error),
          });
          return;
        }
      }
    } finally {
      receiving.current = false;
      historyController.current = null;
    }
  }, [lab.id]);
  useEffect(() => {
    if (view?.messages) {
      pendingWindow.current = view.messages;
      void receiveWindow();
    }
  }, [view?.messages, receiveWindow]);
  const messages = timeline.length ? timeline : (view?.messages ?? []);
  const working = active?.status === "queued" || active?.status === "running";
  // biome-ignore lint/correctness/useExhaustiveDependencies: New messages and turn status change the rendered scroll height.
  useEffect(() => {
    const grew = hasNewActivity(seen.current, view?.messages ?? []);
    seen.current = view?.messages.at(-1)?.id;
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
    else if (grew) setBehind(true);
  }, [view?.messages, active?.status, timeline, gap]);
  const toLatest = () => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
    follow.current = true;
    setBehind(false);
  };
  const send = async () => {
    if (!draft.trim() || action.busy) return;
    const submittedDraft = draft;
    const message = submittedDraft.trim();
    const result = await action.mutate<Turn>(labPath(lab.id, "/chat"), {
      message,
    });
    if (result) {
      if (clearSubmittedDraft(draftRef.current, submittedDraft)) onDraft("");
      setSent(true);
      follow.current = true;
      conversation.refresh();
      onRefresh();
      textarea.current?.focus();
    }
  };
  return (
    <div className="chat-page">
      <div
        className="chat-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (!el) return;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          if (follow.current) setBehind(false);
        }}
      >
        <div className="chat-content">
          {conversation.loading && <Loading>{t("chat.opening")}</Loading>}
          {conversation.error && (
            <Notice error>
              {conversation.error}
              <button
                type="button"
                className="text-button"
                onClick={conversation.refresh}
              >
                {t("common.retry")}
              </button>
            </Notice>
          )}
          {view && !view.messages.length && !sent && (
            <div className="chat-intro">
              <div className="pico-mark">p</div>
              <p className="eyebrow">{t("chat.eyebrow")}</p>
              <h1>{t("chat.title")}</h1>
              <p>{lab.researchLine || t("chat.introFallback")}</p>
              <div className="suggestions">
                {lab.settings.provider.mode === "demo" && (
                  <button
                    type="button"
                    onClick={() => {
                      onDraft(t("chat.demoPrompt"));
                      textarea.current?.focus();
                    }}
                  >
                    {t("chat.runDemo")}
                    <Icon name="arrow" size={14} />
                  </button>
                )}
                {[
                  t("chat.suggestions.question"),
                  t("chat.suggestions.plan"),
                  t("chat.suggestions.status"),
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      onDraft(suggestion);
                      textarea.current?.focus();
                    }}
                  >
                    {suggestion}
                    <Icon name="arrow" size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {view?.conversation.summary && (
            <details className="tool-call">
              <summary>{t("chat.retainedContext")}</summary>
              <div className="tool-body">
                <Markdown>{view.conversation.summary}</Markdown>
                <p className="meta">{t("chat.earlierMessages")}</p>
              </div>
            </details>
          )}
          {!historyEnd &&
            (timeline.length > (view?.messages.length ?? 0) ||
              view?.history?.hasMore) && (
              <button
                type="button"
                disabled={historyBusy || !!gap?.busy}
                onClick={async () => {
                  const first = messages[0]?.id;
                  if (!first) return;
                  setHistoryBusy(true);
                  setHistoryError(null);
                  follow.current = false;
                  const height = scroll.current?.scrollHeight ?? 0;
                  try {
                    const page = await request<Message[]>(
                      labPath(
                        lab.id,
                        `/history?before=${encodeURIComponent(first)}&limit=100`,
                      ),
                    );
                    const merged = mergeMessages(
                      timelineRef.current,
                      page,
                      true,
                    );
                    timelineRef.current = merged;
                    setTimeline(merged);
                    setHistoryEnd(page.length < 100);
                    requestAnimationFrame(() => {
                      if (scroll.current)
                        scroll.current.scrollTop +=
                          scroll.current.scrollHeight - height;
                    });
                  } catch (error) {
                    setHistoryError(errorText(error));
                  } finally {
                    setHistoryBusy(false);
                  }
                }}
              >
                {historyBusy
                  ? t("common.loadingRecords")
                  : t("chat.olderMessages")}
              </button>
            )}
          {historyError && <Notice error>{historyError}</Notice>}
          <div aria-live="polite" aria-relevant="additions text">
            {groupMessages(messages).map((entry) =>
              Array.isArray(entry) ? (
                <ToolCallGroup key={entry[0]?.id} entries={entry} />
              ) : (
                <ChatMessage key={entry.id} entry={entry} links={links} />
              ),
            )}
          </div>
          {gap && (
            <Notice>
              {t("chat.historyGap")}
              {gap.error && ` ${gap.error}`}
              {gap.busy ? (
                <span> {t("common.loadingRecords")}</span>
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    void receiveWindow();
                  }}
                >
                  {t("chat.historyRetry")}
                </button>
              )}
            </Notice>
          )}
          {working && (
            <div className="session-indicator working" role="status">
              <span className="dot busy" />
              {active?.status === "queued"
                ? t("chat.queued")
                : t("chat.investigating", { count: active?.steps ?? 0 })}
            </div>
          )}
          {paused && !working && (
            <div className="turn-controls">
              <Notice>
                {paused.status === "interrupted"
                  ? t("chat.interrupted", { count: paused.steps })
                  : paused.status === "paused"
                    ? t("chat.paused", { count: paused.steps })
                    : t("chat.resumable")}
                {paused.error && ` ${paused.error}`}
              </Notice>
              <button
                type="button"
                disabled={control.busy}
                onClick={async () => {
                  if (
                    await control.mutate(
                      labPath(lab.id, `/turns/${paused.id}/continue`),
                    )
                  ) {
                    conversation.refresh();
                    onRefresh();
                  }
                }}
              >
                {t("chat.continue")}
              </button>
            </div>
          )}
          {lastTurn?.error && !working && !paused && (
            <Notice error>
              {statusLabel(lastTurn.status)}: {lastTurn.error}
            </Notice>
          )}
          {control.error && <Notice error>{control.error}</Notice>}
        </div>
      </div>
      {behind && (
        <button type="button" className="jump-latest" onClick={toLatest}>
          {t("chat.newActivity")}
        </button>
      )}
      {view?.usage && (
        <p className="chat-footer">
          {t("chat.usage", {
            calls: view.usage.calls,
            tokens: view.usage.totalTokens,
            cost: view.usage.costUsd.toFixed(4),
          })}
          {(!view.usage.costKnown || !view.usage.tokensKnown) &&
            ` · ${t("chat.unknownUsage")}`}
        </p>
      )}
      <MessageComposer
        lab={lab}
        draft={draft}
        onDraft={onDraft}
        textarea={textarea}
        working={working}
        error={action.error}
        sending={action.busy}
        stopping={control.busy}
        connected={!!view}
        send={send}
        onStop={async () => {
          if (
            active &&
            (await control.mutate(labPath(lab.id, `/turns/${active.id}/stop`)))
          ) {
            conversation.refresh();
            onRefresh();
          }
        }}
      />
    </div>
  );
}
