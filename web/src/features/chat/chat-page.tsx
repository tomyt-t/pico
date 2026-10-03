import type { Lab } from "@pico/server/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatCost, formatElapsed, number } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Logo } from "@/web/components/logo";
import { Markdown } from "@/web/components/markdown";
import { Icon, Loading, Notice } from "@/web/components/primitives";
import { MessageComposer } from "@/web/features/chat/message-composer";
import {
  ChatMessage,
  groupMessages,
  subjectOf,
  Thinking,
  ToolCallGroup,
} from "@/web/features/chat/message-list";
import type {
  LabChatController,
  LiveChat,
} from "@/web/features/chat/use-lab-chat";

export { formatCost, formatElapsed };

/** Appends the start of a message to the draft as a blockquote to discuss it. */
export function quoteDraft(draft: string, text: string, max = 300): string {
  const trimmed = text.trim();
  const excerpt =
    trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
  const quote = excerpt
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
  const base = draft.trimEnd();
  return `${base ? `${base}\n\n` : ""}${quote}\n\n`;
}

/** One muted line: label, current tool, elapsed time, tool count, queue. */
function WorkingIndicator({
  live,
  queued,
}: {
  live: LiveChat;
  queued: number;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Date.now() - started),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const current = live.tools.find((tool) => !tool.done);
  const subject = current && subjectOf(current.args);
  return (
    <div className="session-indicator working" role="status" aria-live="polite">
      <span className="dot busy" />
      <span>{live.compacting ? t("chat.compacting") : t("chat.working")}</span>
      {current && (
        <span className="working-tool">
          <span className="mono">· {current.name}</span>
          {subject && <span className="tool-subject mono">{subject}</span>}
        </span>
      )}
      {/* A clock announced every second would drown the rest of the line. */}
      <span aria-hidden="true">· {formatElapsed(elapsed)}</span>
      {live.turnTools > 0 && (
        <span>· {t("chat.turnTools", { count: live.turnTools })}</span>
      )}
      {queued > 0 && <span>· {t("chat.queued", { count: queued })}</span>}
    </div>
  );
}

export function Chat({
  lab,
  draft,
  onDraft,
  controller,
  variant = "page",
  focusSignal,
}: {
  lab: Lab;
  draft: string;
  onDraft: (draft: string, expected?: string) => void;
  controller: LabChatController;
  variant?: "page" | "dock";
  focusSignal?: number;
}) {
  const { t } = useTranslation();
  const { messages, state, live, working, refresh } = controller;
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // `follow` mirrors `following` for observers; the state drives the button.
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const [behind, setBehind] = useState(false);
  // While a programmatic scroll to the end is in flight, the positions it
  // passes through are not the reader's.
  const pinning = useRef<number>(undefined);
  const mounted = useRef(false);
  const olderAnchor = useRef<{
    firstId?: string;
    nodes: { node: HTMLElement; top: number }[];
  } | null>(null);
  const ignoreHistoryResize = useRef(false);
  const groups = useMemo(() => groupMessages(messages), [messages]);
  const setFollow = (value: boolean) => {
    follow.current = value;
    setFollowing(value);
    if (value) setBehind(false);
  };
  const syncFollow = () => {
    const element = scroll.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (pinning.current !== undefined) {
      if (!atBottom) return;
      window.clearTimeout(pinning.current);
      pinning.current = undefined;
    }
    setFollow(atBottom);
  };
  const loadOlder = () => {
    const container = scroll.current;
    if (!container || controller.loadingOlder || olderAnchor.current) return;
    olderAnchor.current = {
      firstId: messages[0]?.id,
      nodes: Array.from(
        container.querySelectorAll<HTMLElement>("[data-message-id]"),
      )
        .filter(
          (node) =>
            node.getBoundingClientRect().bottom >=
            container.getBoundingClientRect().top,
        )
        .map((node) => ({ node, top: node.getBoundingClientRect().top })),
    };
    setFollow(false);
    void controller.loadOlder().then((loaded) => {
      if (!loaded) olderAnchor.current = null;
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: The anchor is consumed once, when the message list that triggered it changes.
  useLayoutEffect(() => {
    const anchor = olderAnchor.current;
    if (!anchor || messages[0]?.id === anchor.firstId) return;
    const retained = anchor.nodes.find((item) => item.node.isConnected);
    if (retained && scroll.current && !follow.current)
      scroll.current.scrollTop +=
        retained.node.getBoundingClientRect().top - retained.top;
    ignoreHistoryResize.current = true;
    olderAnchor.current = null;
    syncFollow();
  }, [messages]);
  useLayoutEffect(() => {
    if (!controller.loadingOlder) olderAnchor.current = null;
  }, [controller.loadingOlder]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(pinning.current);
    };
  }, []);
  useEffect(() => {
    if (focusSignal !== undefined) textarea.current?.focus();
  }, [focusSignal]);
  // Follow the conversation like a chat app: while the researcher is at the
  // bottom, every growth of the content (new messages, streamed text, tool
  // output, highlighted code arriving late) keeps the view pinned to the end.
  // Scrolling up releases the pin and offers a jump back.
  useEffect(() => {
    const container = scroll.current;
    const content = contentRef.current;
    if (!container || !content) return;
    let lastHeight = content.offsetHeight;
    const observer = new ResizeObserver(() => {
      const grew = content.offsetHeight > lastHeight;
      lastHeight = content.offsetHeight;
      if (follow.current) container.scrollTop = container.scrollHeight;
      else if (grew && !ignoreHistoryResize.current) setBehind(true);
      ignoreHistoryResize.current = false;
    });
    observer.observe(content);
    // A hidden tab does not deliver resize notifications; catch up on return.
    const visible = () => {
      if (document.visibilityState === "visible" && follow.current)
        container.scrollTop = container.scrollHeight;
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New messages and streamed content change the scroll height even when the tab is hidden.
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, live.text, live.thinking, live.tools.length, live.streaming]);
  const toLatest = (behavior: ScrollBehavior = "auto") => {
    olderAnchor.current = null;
    setFollow(true);
    const container = scroll.current;
    if (!container) return;
    window.clearTimeout(pinning.current);
    // Smooth scrolling ends in a scroll event at the bottom, which releases the
    // pin; the timer covers an animation the reader interrupts.
    pinning.current = window.setTimeout(() => {
      pinning.current = undefined;
      syncFollow();
    }, 1000);
    container.scrollTo({ top: container.scrollHeight, behavior });
  };

  // Messages are memoized; they receive one stable handler that reads the
  // current draft.
  const quoteRef = useRef<(text: string) => void>(() => {});
  useLayoutEffect(() => {
    quoteRef.current = (text) => {
      const next = quoteDraft(draft, text);
      onDraft(next);
      const element = textarea.current;
      if (!element) return;
      element.focus();
      requestAnimationFrame(() =>
        element.setSelectionRange(next.length, next.length),
      );
    };
  });
  const quote = useCallback((text: string) => quoteRef.current(text), []);

  const usage = controller.usage;

  const send = async () => {
    const submittedDraft = draft;
    if (await controller.send(submittedDraft)) {
      // The owner checks the expected value, even if this presentation was
      // replaced while the request was pending.
      onDraft("", submittedDraft);
      if (mounted.current) {
        toLatest("smooth");
        textarea.current?.focus();
      }
    }
  };

  const currentModel = state?.model
    ? `${state.model.provider}/${state.model.id}`
    : "";
  const queued = live.queue.steering.length + live.queue.followUp.length;

  return (
    <div className={`chat-page${variant === "dock" ? " chat-dock" : ""}`}>
      <div
        className="chat-scroll"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (!element) return;
          syncFollow();
          // Keep the reading anchor current if the researcher moves while a
          // preceding page is in flight; streamed replies may arrive as well.
          for (const item of olderAnchor.current?.nodes ?? [])
            if (item.node.isConnected)
              item.top = item.node.getBoundingClientRect().top;
          if (
            element.scrollTop < 160 &&
            !follow.current &&
            controller.hasOlderMessages &&
            !controller.olderError
          )
            loadOlder();
        }}
      >
        <div className="chat-content" ref={contentRef}>
          {controller.hasOlderMessages && (
            <div className="chat-history-loader">
              <button
                type="button"
                className="text-button"
                disabled={controller.loadingOlder}
                onClick={loadOlder}
              >
                {controller.loadingOlder
                  ? t("chat.loadingOlder")
                  : t("chat.loadOlder")}
              </button>
            </div>
          )}
          {controller.olderError && (
            <Notice error>{controller.olderError}</Notice>
          )}
          {controller.loading && !state && (
            <Loading>{t("chat.opening")}</Loading>
          )}
          {controller.error && (
            <Notice error>
              {controller.error}
              <button type="button" className="text-button" onClick={refresh}>
                {t("common.retry")}
              </button>
            </Notice>
          )}
          {state && !state.model && <Notice error>{t("chat.noModel")}</Notice>}
          {state && !controller.loading && !messages.length && !working && (
            <div className="chat-intro">
              <Logo size={40} />
              <p className="eyebrow">{t("chat.eyebrow")}</p>
              <h1>{t("chat.title")}</h1>
              <p>{lab.researchLine || t("chat.introFallback")}</p>
              <div className="suggestions">
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
          <div>
            {groups.map((group) =>
              group.kind === "tools" ? (
                <div key={group.id} data-message-id={group.id}>
                  <ToolCallGroup items={group.items} />
                </div>
              ) : (
                <ChatMessage
                  key={group.message.id}
                  message={group.message}
                  onQuote={quote}
                />
              ),
            )}
            {working &&
              (live.thinking || live.text || live.tools.length > 0) && (
                <article className="message message-assistant live">
                  <header className="message-header">
                    <Logo size={22} />
                    <strong>Pico</strong>
                  </header>
                  <div className="message-body">
                    {live.thinking && (
                      <Thinking open={!live.text}>{live.thinking}</Thinking>
                    )}
                    {live.text && <Markdown>{live.text}</Markdown>}
                  </div>
                  {live.tools.length > 0 && (
                    <ToolCallGroup items={live.tools} />
                  )}
                </article>
              )}
          </div>
          {working && <WorkingIndicator live={live} queued={queued} />}
          {live.retry && <Notice>{t("chat.retrying", live.retry)}</Notice>}
          {live.error && !working && (
            <Notice error>{t("chat.error", { message: live.error })}</Notice>
          )}
          {controller.controlError && (
            <Notice error>{controller.controlError}</Notice>
          )}
          {controller.settingsError && (
            <Notice error>{controller.settingsError}</Notice>
          )}
        </div>
      </div>
      {!following && (
        <button
          type="button"
          className={`jump-latest${behind ? " has-new" : ""}`}
          aria-label={t("chat.jumpToLatest")}
          title={t("chat.jumpToLatest")}
          onClick={() => toLatest("smooth")}
        >
          {behind && <span>{t("chat.newMessages")}</span>}
          <Icon name="arrow" size={16} />
        </button>
      )}
      <MessageComposer
        draft={draft}
        onDraft={onDraft}
        textarea={textarea}
        working={working}
        error={controller.sendError}
        sending={controller.sending}
        stopping={controller.stopping}
        send={send}
        onStop={controller.stop}
        models={controller.models}
        model={currentModel}
        thinking={state?.thinking ?? lab.thinking}
        changing={controller.changing}
        onModel={(value) => {
          const [provider, ...rest] = value.split("/");
          if (provider && rest.length)
            void controller.applySettings({ provider, model: rest.join("/") });
        }}
        onThinking={(value) =>
          void controller.applySettings({ thinking: value })
        }
        footer={
          usage.total
            ? t("chat.usage", {
                tokens: number(usage.total),
                cost: formatCost(usage.cost),
              })
            : undefined
        }
      />
    </div>
  );
}
