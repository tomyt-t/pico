import type { Lab, Turn } from "@pico/lab/contracts";
import { useEffect, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { titleCase } from "@/web/components/format";
import { Markdown } from "@/web/components/markdown";
import { Icon, Loading, Notice } from "@/web/components/primitives";
import { useConversation } from "@/web/features/chat/conversation-queries";
import { MessageComposer } from "@/web/features/chat/message-composer";
import { ChatMessage } from "@/web/features/chat/message-list";

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
  const conversation = useConversation(lab.id);
  const action = useMutation();
  const control = useMutation();
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const [sent, setSent] = useState(false);
  const view = conversation.data;
  const active = view?.activeTurn;
  const lastTurn = [...(view?.turns ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const paused =
    active?.status === "paused"
      ? active
      : lastTurn && ["paused", "interrupted"].includes(lastTurn.status)
        ? lastTurn
        : null;
  const working = active?.status === "queued" || active?.status === "running";
  // biome-ignore lint/correctness/useExhaustiveDependencies: New messages and turn status change the rendered scroll height.
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [view?.messages, active?.status]);
  const send = async () => {
    if (!draft.trim() || action.busy || working) return;
    const message = draft.trim();
    const result = await action.mutate<Turn>(labPath(lab.id, "/chat"), {
      message,
    });
    if (result) {
      onDraft("");
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
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        <div className="chat-content">
          {conversation.loading && (
            <Loading>Opening the main conversation…</Loading>
          )}
          {conversation.error && (
            <Notice error>
              {conversation.error}
              <button
                type="button"
                className="text-button"
                onClick={conversation.refresh}
              >
                Retry
              </button>
            </Notice>
          )}
          {view && !view.messages.length && !sent && (
            <div className="chat-intro">
              <div className="pico-mark">p</div>
              <p className="eyebrow">Your research co-leader</p>
              <h1>What shall we investigate?</h1>
              <p>
                {lab.researchLine ||
                  "Bring a direction, a question or an observation. We can explore it, design experiments and discuss what the results show."}
              </p>
              <div className="suggestions">
                {lab.settings.provider.mode === "demo" && (
                  <button
                    type="button"
                    onClick={() => {
                      onDraft(
                        "Start a demonstration of the complete research cycle",
                      );
                      textarea.current?.focus();
                    }}
                  >
                    Run a demonstration
                    <Icon name="arrow" size={14} />
                  </button>
                )}
                {[
                  "Help me turn this research direction into our first question.",
                  "Let's plan a small exploratory experiment.",
                  "Show me what is happening in the laboratory.",
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
              <summary>Research context retained by Pico</summary>
              <div style={{ marginTop: 12 }}>
                <Markdown>{view.conversation.summary}</Markdown>
              </div>
              <p className="meta">
                Earlier messages remain in the conversation history.
              </p>
            </details>
          )}
          <div aria-live="polite" aria-relevant="additions text">
            {view?.messages.map((entry) => (
              <ChatMessage key={entry.id} entry={entry} />
            ))}
          </div>
          {working && (
            <div className="session-indicator" role="status">
              <span className="dot busy" />
              {active?.status === "queued"
                ? "Pico's turn is queued…"
                : `Pico is investigating · ${active?.steps ?? 0} steps`}
            </div>
          )}
          {paused && (
            <div className="turn-controls">
              <Notice>
                Pico{" "}
                {paused.status === "interrupted" ? "was interrupted" : "paused"}{" "}
                after {paused.steps} steps. The recorded work is preserved.
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
                Continue investigation
              </button>
            </div>
          )}
          {lastTurn?.error && !working && (
            <Notice error>
              {titleCase(lastTurn.status)}: {lastTurn.error}
            </Notice>
          )}
          {control.error && <Notice error>{control.error}</Notice>}
        </div>
      </div>
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
