import type { UiMessage } from "@pico/server/contracts";
import { memo, useEffect, useRef, useState } from "react";
import {
  formatCost,
  relativeTime,
  statusLabel,
  timestamp,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Logo } from "@/web/components/logo";
import { Markdown } from "@/web/components/markdown";
import {
  Code,
  Icon,
  type IconName,
  Notice,
  Status,
} from "@/web/components/primitives";
import { openCampaign } from "@/web/features/campaigns/summary";

export interface ToolEntry {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  done: boolean;
}

export type MessageGroup =
  | { kind: "message"; message: UiMessage }
  | { kind: "tools"; id: string; items: ToolEntry[] };

/** Pairs tool results with their calls and keeps consecutive tools together. */
export function groupMessages(messages: UiMessage[]): MessageGroup[] {
  const calls = new Map<string, { name: string; args: unknown }>();
  for (const message of messages)
    for (const call of message.toolCalls ?? [])
      calls.set(call.id, { name: call.name, args: call.arguments });
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const call = message.toolCallId
        ? calls.get(message.toolCallId)
        : undefined;
      const entry: ToolEntry = {
        id: message.id,
        name: message.toolName ?? call?.name ?? "tool",
        args: call?.args ?? {},
        result: message.text,
        isError: message.isError,
        done: true,
      };
      const last = groups.at(-1);
      if (last?.kind === "tools") last.items.push(entry);
      else groups.push({ kind: "tools", id: message.id, items: [entry] });
      continue;
    }
    if (
      message.role === "assistant" &&
      !message.text.trim() &&
      !message.thinking
    )
      continue;
    groups.push({ kind: "message", message });
  }
  return groups;
}

const subjectKeys = [
  "title",
  "label",
  "name",
  "query",
  "url",
  "path",
  "command",
  "task",
  "kind",
  "id",
];

/** A short subject for a tool call: its naming argument, or the first non-empty string. */
export function subjectOf(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const isText = (entry: unknown): entry is string =>
    typeof entry === "string" && entry.length > 0;
  const value =
    subjectKeys.map((key) => record[key]).find(isText) ??
    Object.values(record).find(isText);
  const flat = value?.replace(/\s+/g, " ");
  return flat && flat.length > 72 ? `${flat.slice(0, 71)}…` : flat;
}

export type LaboratoryEvent =
  | {
      kind: "campaign";
      title: string;
      id: string;
      update: number;
      status: string;
      reason?: string;
      excerpt: string;
      spend?: { cost: number; budget: number };
    }
  | { kind: "campaign-late"; title: string; id: string; source: string }
  | { kind: "agent"; name: string; id: string; status: string; error?: string }
  | { kind: "job"; name: string; id: string; status: string; exitCode?: number }
  | { kind: "other" };

/** What a laboratory notification is about, read from the text the server wrote for Pico. */
export function parseLaboratoryEvent(text: string): LaboratoryEvent {
  const [first = "", ...rest] = text.split("\n");
  let match =
    /^\[Pico\] Campaign "(.+?)" \((campaign-[\w-]+)\), update (\d+): (\w+)(?: \((\w+)\))?/.exec(
      first,
    );
  if (match) {
    const lines = rest.map((line) => line.trim()).filter(Boolean);
    const spendLine = lines.find((line) =>
      line.startsWith("Estimated model spend:"),
    );
    const spend = spendLine && /US\$ ([\d.]+) \/ ([\d.]+)/.exec(spendLine);
    const excerpt =
      lines.find(
        (line) =>
          !/^(Objective|Deliverable|Estimated model spend|Coordinate any requested)/.test(
            line,
          ),
      ) ?? "";
    return {
      kind: "campaign",
      title: match[1] ?? "",
      id: match[2] ?? "",
      update: Number(match[3]),
      status: match[4] ?? "",
      reason: match[5],
      excerpt,
      spend: spend
        ? { cost: Number(spend[1]), budget: Number(spend[2]) }
        : undefined,
    };
  }
  match =
    /^\[Pico\] Campaign "(.+?)" \((campaign-[\w-]+)\), late outcome (.+?):/.exec(
      first,
    );
  if (match)
    return {
      kind: "campaign-late",
      title: match[1] ?? "",
      id: match[2] ?? "",
      source: match[3] ?? "",
    };
  match = /^\[Pico\] Subagent "(.+?)" \((run-[\w-]+)\) finished: (\w+)/.exec(
    first,
  );
  if (match)
    return {
      kind: "agent",
      name: match[1] ?? "",
      id: match[2] ?? "",
      status: match[3] ?? "",
      error: /^Error: (.+)$/m.exec(text)?.[1],
    };
  match =
    /^\[Pico\] Job "(.+?)" \((job-[\w-]+)\) finished: (\w+)(?: \(exit code (-?\d+)\))?/.exec(
      first,
    );
  if (match)
    return {
      kind: "job",
      name: match[1] ?? "",
      id: match[2] ?? "",
      status: match[3] ?? "",
      exitCode: match[4] === undefined ? undefined : Number(match[4]),
    };
  return { kind: "other" };
}

const eventTone = (status: string) =>
  status === "pending" || status === "paused"
    ? "pending"
    : status === "completed" || status === "succeeded"
      ? "done"
      : status === "failed" || status === "ended"
        ? "error"
        : "busy";

/** A laboratory notification as one line with its action; the full text opens on demand. */
export function LaboratoryEventMessage({
  message,
  event,
}: {
  message: UiMessage;
  event: Exclude<LaboratoryEvent, { kind: "other" }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  let icon: IconName = "flag";
  let title = "";
  let detail = "";
  let tone = "busy";
  let campaignId: string | undefined;
  switch (event.kind) {
    case "campaign":
      title = t("campaigns.milestone", { title: event.title, n: event.update });
      detail = [
        event.excerpt,
        event.spend
          ? t("campaigns.spent", {
              cost: formatCost(event.spend.cost),
              budget: formatCost(event.spend.budget),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      tone = eventTone(event.status);
      campaignId = event.id;
      break;
    case "campaign-late":
      title = t("campaigns.lateOutcome", { title: event.title });
      detail = event.source;
      campaignId = event.id;
      break;
    case "agent":
      icon = "evolution";
      title = t(
        event.status === "completed"
          ? "agents.finished"
          : event.status === "failed"
            ? "agents.failed"
            : "agents.stopped",
        { name: event.name },
      );
      detail = event.error ?? "";
      tone = eventTone(event.status);
      break;
    case "job":
      icon = "experiment";
      title = t("chat.jobFinished", { name: event.name });
      detail = [
        statusLabel(event.status),
        event.exitCode === undefined ? "" : `exit ${event.exitCode}`,
      ]
        .filter(Boolean)
        .join(" · ");
      tone = eventTone(event.status);
      break;
  }
  return (
    <article
      className={`message message-event is-${tone}`}
      data-message-id={message.id}
    >
      <span className="event-mark">
        <Icon name={icon} size={14} />
      </span>
      <div className="event-what">
        <b>{title}</b>
        {detail && <span title={detail}>{detail}</span>}
      </div>
      <span className="event-actions">
        <time
          dateTime={new Date(message.timestamp).toISOString()}
          title={timestamp(message.timestamp)}
        >
          {relativeTime(message.timestamp)}
        </time>
        {campaignId && (
          <button
            type="button"
            className="text-button"
            onClick={() => openCampaign(campaignId)}
          >
            {t("common.open")}
          </button>
        )}
        <button
          type="button"
          className="text-button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t(open ? "chat.eventHide" : "chat.eventDetails")}
        </button>
      </span>
      {open && (
        <div className="event-body">
          <Markdown>{message.text}</Markdown>
        </div>
      )}
    </article>
  );
}

export function ToolCall({ entry }: { entry: ToolEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = !entry.done
    ? "running"
    : entry.isError
      ? "failed"
      : "succeeded";
  const subject = subjectOf(entry.args);
  return (
    <details
      className="tool-call"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-name mono">{entry.name}</span>
        {subject && <span className="tool-subject mono">{subject}</span>}
        <Status value={status} />
      </summary>
      {open && (
        <div className="tool-body">
          <p className="eyebrow">{t("chat.input")}</p>
          <Code language="json">{JSON.stringify(entry.args, null, 2)}</Code>
          {entry.result !== undefined && (
            <>
              <p className="eyebrow">{t("chat.output")}</p>
              {entry.isError ? (
                <Notice error>{entry.result}</Notice>
              ) : (
                <Code wrap>{entry.result}</Code>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}

export const ToolCallGroup = memo(function ToolCallGroup({
  items,
}: {
  items: ToolEntry[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [first] = items;
  if (items.length === 1 && first) return <ToolCall entry={first} />;
  const status = items.some((entry) => !entry.done)
    ? "running"
    : items.some((entry) => entry.isError)
      ? "failed"
      : "succeeded";
  const names = [...new Set(items.map((entry) => entry.name))];
  return (
    <details
      className="tool-call tool-group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-name">
          {t("chat.toolCalls", { count: items.length })}
        </span>
        <span className="tool-subject mono">{names.join(", ")}</span>
        <Status value={status} />
      </summary>
      {open && (
        <div className="tool-body">
          {items.map((entry) => (
            <ToolCall key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </details>
  );
});

export function isLaboratoryMessage(message: UiMessage): boolean {
  return message.role === "user" && message.text.startsWith("[Pico]");
}

/** Thinking is written as Markdown by the model; shown muted and scrollable. */
export function Thinking({
  children,
  open,
}: {
  children: string;
  open?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details className="thinking" open={open}>
      <summary>{t("chat.thinking")}</summary>
      <div className="thinking-body">
        <Markdown>{children}</Markdown>
      </div>
    </details>
  );
}

function MessageActions({
  text,
  onQuote,
}: {
  text: string;
  onQuote?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can be denied; the text stays selectable */
    }
  };
  return (
    <span
      className="message-actions"
      role="toolbar"
      aria-label={t("chat.messageActions")}
    >
      <button
        type="button"
        className="text-button message-action"
        onClick={() => void copy()}
      >
        {copied ? t("chat.copied") : t("chat.copy")}
      </button>
      {onQuote && (
        <button
          type="button"
          className="text-button message-action"
          onClick={() => onQuote(text)}
        >
          {t("chat.quote")}
        </button>
      )}
    </span>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  onQuote,
}: {
  message: UiMessage;
  /** Receives the raw message text to bring into the draft. */
  onQuote?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const laboratory = message.role === "system" || isLaboratoryMessage(message);
  const event = laboratory
    ? parseLaboratoryEvent(message.text)
    : { kind: "other" as const };
  if (event.kind !== "other")
    return <LaboratoryEventMessage message={message} event={event} />;
  const author = laboratory
    ? t("chat.laboratory")
    : message.role === "assistant"
      ? "Pico"
      : t("chat.you");
  const variant = laboratory ? "system" : message.role;
  return (
    <article
      className={`message message-${variant}`}
      data-message-id={message.id}
    >
      <header className="message-header">
        {message.role === "assistant" && <Logo size={22} />}
        <strong>{author}</strong>
        <time
          dateTime={new Date(message.timestamp).toISOString()}
          title={timestamp(message.timestamp)}
        >
          {relativeTime(message.timestamp)}
        </time>
        {message.kind === "compaction" && (
          <span className="muted">· {t("chat.compaction")}</span>
        )}
        {(variant === "user" || variant === "assistant") &&
          message.text.trim() && (
            <MessageActions text={message.text} onQuote={onQuote} />
          )}
      </header>
      <div className="message-body">
        {message.thinking && <Thinking>{message.thinking}</Thinking>}
        {message.role === "assistant" || laboratory ? (
          <Markdown>{message.text}</Markdown>
        ) : (
          message.text
        )}
        {message.errorMessage && (
          <Notice error>
            {t("chat.error", { message: message.errorMessage })}
          </Notice>
        )}
      </div>
    </article>
  );
});
