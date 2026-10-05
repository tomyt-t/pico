import type { Job, Lab } from "@pico/server/contracts";
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
import { useNow } from "@/web/components/use-now";
import { MessageComposer } from "@/web/features/chat/message-composer";
import {
  ChatMessage,
  groupMessages,
  type MessageGroup,
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

/** While Pico is idle, the detached jobs it waits for, e.g. a training run. */
function WaitingIndicator({ jobs }: { jobs: Job[] }) {
  const { t } = useTranslation();
  const now = useNow(true);
  const [first] = jobs;
  if (!first) return null;
  return (
    <div className="session-indicator working" role="status" aria-live="polite">
      <span className="dot waiting" />
      <span>{t("chat.waitingJob")}</span>
      <span className="working-tool">
        <span className="mono">· {first.name}</span>
      </span>
      <span aria-hidden="true">
        · {formatElapsed(now - Date.parse(first.startedAt ?? first.createdAt))}
      </span>
      {jobs.length > 1 && (
        <span>· {t("chat.moreJobs", { count: jobs.length - 1 })}</span>
      )}
      <span>· {t("chat.waitingHint")}</span>
    </div>
  );
}

/** The conversation renders about this many screens at first and per "load
 *  more"; older pages are fetched from the server only to fill them. */
const screensPerPage = 3;
/** Groups added per layout pass while filling the window. */
const fillStep = 6;

const firstMessageId = (group: MessageGroup): string =>
  group.kind === "tools" ? (group.items[0]?.id ?? group.id) : group.message.id;
// A tool group can absorb tool messages from an older page; find it by member.
const holds = (group: MessageGroup, id: string): boolean =>
  group.kind === "tools"
    ? group.items.some((item) => item.id === id)
    : group.message.id === id;

/** The first message still visible at the top, to keep it in place while
 *  content is added above it. */
function readingAnchor(container: HTMLElement) {
  const top = container.getBoundingClientRect().top;
  const node = Array.from(
    container.querySelectorAll<HTMLElement>("[data-message-id]"),
  ).find((item) => item.getBoundingClientRect().bottom >= top);
  return node ? { node, top: node.getBoundingClientRect().top } : null;
}

export function Chat({
  lab,
  draft,
  onDraft,
  controller,
  jobs = [],
  variant = "page",
  focusSignal,
}: {
  lab: Lab;
  draft: string;
  onDraft: (draft: string, expected?: string) => void;
  controller: LabChatController;
  /** Running detached jobs of this laboratory. */
  jobs?: Job[];
  variant?: "page" | "dock";
  focusSignal?: number;
}) {
  const { t } = useTranslation();
  const { messages, state, live, working, refresh } = controller;
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // `follow` mirrors `following` for observers; the state drives the button.
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const [behind, setBehind] = useState(false);
  // While a programmatic scroll to the end is in flight, the positions it
  // passes through are not the reader's.
  const pinning = useRef<number>(undefined);
  const mounted = useRef(false);
  const anchor = useRef<{ node: HTMLElement; top: number } | null>(null);
  const ignoreHistoryResize = useRef(false);
  const groups = useMemo(() => groupMessages(messages), [messages]);
  // The rendered window starts at this message; null until first measured.
  const [windowStart, setWindowStart] = useState<string | null>(null);
  // Minimum height of the rendered history in pixels; 0 means the first
  // screens, Infinity everything.
  const [goal, setGoal] = useState(0);
  const [nearTop, setNearTop] = useState(false);
  const [windowLab, setWindowLab] = useState(lab.id);
  if (windowLab !== lab.id) {
    setWindowLab(lab.id);
    setWindowStart(null);
    setGoal(0);
  }
  const found =
    windowStart === null
      ? -1
      : groups.findIndex((group) => holds(group, windowStart));
  const start = found >= 0 ? found : Math.max(0, groups.length - fillStep * 2);
  const shown = start ? groups.slice(start) : groups;
  const hasMore = start > 0 || controller.hasOlderMessages;
  const loadingAll =
    goal === Number.POSITIVE_INFINITY && hasMore && !controller.olderError;
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
  const extend = (next: number) => {
    const container = scroll.current;
    if (!container) return;
    setFollow(false);
    anchor.current = readingAnchor(container);
    setGoal(next);
  };
  const loadMore = () => {
    const history = historyRef.current;
    const container = scroll.current;
    if (history && container)
      extend(history.offsetHeight + screensPerPage * container.clientHeight);
  };
  const loadAll = () => extend(Number.POSITIVE_INFINITY);
  // Grow the rendered window until it fills its goal: first from messages
  // already fetched, then one older page at a time. The reading position
  // stays put while content is added above it.
  useLayoutEffect(() => {
    const container = scroll.current;
    const history = historyRef.current;
    if (!container || !history || !groups.length) return;
    const kept = anchor.current;
    if (kept?.node.isConnected && !follow.current) {
      container.scrollTop += kept.node.getBoundingClientRect().top - kept.top;
      kept.top = kept.node.getBoundingClientRect().top;
    }
    const target = goal || screensPerPage * container.clientHeight;
    if (history.offsetHeight < target && start > 0) {
      ignoreHistoryResize.current = true;
      const next =
        goal === Number.POSITIVE_INFINITY ? 0 : Math.max(0, start - fillStep);
      setWindowStart(firstMessageId(groups[next] as MessageGroup));
      return;
    }
    if (
      history.offsetHeight < target &&
      controller.hasOlderMessages &&
      !controller.olderError
    ) {
      if (!controller.loadingOlder) {
        ignoreHistoryResize.current = true;
        void controller.loadOlder();
      }
      return;
    }
    anchor.current = null;
    const first = groups[start];
    if (windowStart === null && first) setWindowStart(firstMessageId(first));
  });
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
    anchor.current = null;
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
          const kept = anchor.current;
          if (kept?.node.isConnected)
            kept.top = kept.node.getBoundingClientRect().top;
          setNearTop(element.scrollTop < element.clientHeight * 0.75);
        }}
      >
        <div className="chat-content" ref={contentRef}>
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
          <div ref={historyRef}>
            {shown.map((group) =>
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
          {!working && state && <WaitingIndicator jobs={jobs} />}
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
      {hasMore && (nearTop || loadingAll) && (
        <div className="history-float">
          <button
            type="button"
            disabled={controller.loadingOlder || loadingAll}
            onClick={loadMore}
          >
            {controller.loadingOlder && !loadingAll
              ? t("chat.loadingOlder")
              : t("chat.loadMore")}
          </button>
          <button
            type="button"
            disabled={loadingAll}
            onClick={loadAll}
            title={t("chat.loadAllHint")}
          >
            {loadingAll ? t("chat.loadingAll") : t("chat.loadAll")}
          </button>
        </div>
      )}
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
