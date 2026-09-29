import type { Message, ToolCallView } from "@pico/lab/contracts";
import { useState } from "react";
import { relativeTime, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import {
  LinkedRecordText,
  type RecordLinks,
} from "@/web/components/linked-record-text";
import { Markdown } from "@/web/components/markdown";
import { Code, Notice, Status } from "@/web/components/primitives";
import { abbreviateIds } from "@/web/components/record-text";

type ToolMessage = Message & { toolCall: ToolCallView };

export function groupMessages(
  messages: Message[],
): (Message | ToolMessage[])[] {
  const groups: (Message | ToolMessage[])[] = [];
  for (const entry of messages) {
    const last = groups.at(-1);
    if (!entry.toolCall) groups.push(entry);
    else if (Array.isArray(last)) last.push(entry as ToolMessage);
    else groups.push([entry as ToolMessage]);
  }
  return groups;
}

function toolSubject(call: ToolCallView): string | undefined {
  const value = Object.values(call.arguments).find(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const subject = value && abbreviateIds(value);
  return subject && subject.length > 64 ? `${subject.slice(0, 63)}…` : subject;
}

function ToolCall({ call }: { call: ToolCallView }) {
  const { t } = useTranslation();
  const subject = toolSubject(call);
  const [open, setOpen] = useState(false);
  return (
    <details
      className="tool-call"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-name mono">{call.name}</span>
        {subject && <span className="tool-subject mono">{subject}</span>}
        <Status value={call.status} />
      </summary>
      {open && (
        <div className="tool-body">
          <p className="eyebrow">{t("chat.input")}</p>
          <Code language="json">{JSON.stringify(call.arguments, null, 2)}</Code>
          {call.result !== undefined && (
            <>
              <p className="eyebrow">{t("chat.output")}</p>
              <Code language="json">
                {JSON.stringify(call.result, null, 2)}
              </Code>
            </>
          )}
          {call.error && <Notice error>{call.error}</Notice>}
        </div>
      )}
    </details>
  );
}

export function ToolCallGroup({ entries }: { entries: ToolMessage[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [first] = entries;
  if (entries.length === 1 && first) return <ToolCall call={first.toolCall} />;
  const status = entries.some((entry) => entry.toolCall.status === "failed")
    ? "failed"
    : entries.some((entry) => entry.toolCall.status === "running")
      ? "running"
      : "completed";
  const names = [...new Set(entries.map((entry) => entry.toolCall.name))];
  return (
    <details
      className="tool-call tool-group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-name">
          {t("chat.toolCalls", { count: entries.length })}
        </span>
        <span className="tool-subject mono">{names.join(", ")}</span>
        <Status value={status} />
      </summary>
      {open && (
        <div className="tool-body">
          {entries.map((entry) => (
            <ToolCall key={entry.id} call={entry.toolCall} />
          ))}
        </div>
      )}
    </details>
  );
}

export function ChatMessage({
  entry,
  links,
}: {
  entry: Message;
  links?: RecordLinks;
}) {
  const { t } = useTranslation();
  if (entry.toolCall) return <ToolCallGroup entries={[entry as ToolMessage]} />;
  const author = entry.eventId
    ? t("chat.laboratory")
    : entry.role === "assistant"
      ? "Pico"
      : entry.role === "user"
        ? t("chat.you")
        : t("chat.laboratory");
  return (
    <article
      className={`message message-${entry.eventId ? "system" : entry.role}`}
    >
      <header className="message-header">
        {entry.role === "assistant" && (
          <span className="pico-mark" aria-hidden="true">
            p
          </span>
        )}
        <strong>{author}</strong>
        <time dateTime={entry.createdAt} title={timestamp(entry.createdAt)}>
          {relativeTime(entry.createdAt)}
        </time>
      </header>
      <div className="message-body">
        {entry.eventRunId ? (
          <LinkedRecordText
            links={links}
          >{`${t("chat.laboratory")} · ${entry.eventRunId}`}</LinkedRecordText>
        ) : entry.role === "assistant" ? (
          <Markdown links={links}>{entry.content}</Markdown>
        ) : (
          <LinkedRecordText links={links}>{entry.content}</LinkedRecordText>
        )}
      </div>
    </article>
  );
}
