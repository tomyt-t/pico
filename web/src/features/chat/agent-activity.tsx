import type {
  AgentRun,
  AgentRunDetail,
  UiMessage,
} from "@pico/server/contracts";
import { type CSSProperties, useEffect, useState } from "react";
import { errorText, labPath, request } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import {
  compactNumber,
  formatCost,
  formatElapsed,
  shortDuration,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Icon, Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { SheetHeader } from "@/web/components/sheet";
import { useNow } from "@/web/components/use-now";
import { profileName } from "@/web/features/campaigns/catalog";
import { agentStateLine, agentTone } from "@/web/features/campaigns/status";
import { Thinking, ToolCall, type ToolEntry } from "./message-list";

/** One instance in the activity panel or a campaign's team: who, scope, what it does now, for how long. */
export function AgentRunRow({
  run,
  scope,
  cost,
  now,
  onOpen,
}: {
  run: AgentRun;
  scope?: string;
  cost?: number;
  now: number;
  onOpen: () => void;
}) {
  const tone = agentTone(run);
  return (
    <li>
      <button
        type="button"
        className={`agent-row is-${tone}${cost === undefined ? "" : " has-cost"}`}
        onClick={onOpen}
      >
        <span className={`dot ${tone}`} />
        <span className="agent-row-who">
          <strong>{profileName(run.agentId, run.name)}</strong>
          {scope && <span>{scope}</span>}
        </span>
        <span className="agent-row-doing">
          <em>{agentStateLine(run)}</em>
          <span>{shortDuration(run.createdAt, run.endedAt, now)}</span>
        </span>
        {cost !== undefined && (
          <span className="agent-row-cost">{formatCost(cost)}</span>
        )}
      </button>
    </li>
  );
}

export type LogEntry =
  | { kind: "tool"; time: string; entry: ToolEntry }
  | { kind: "text"; id: string; time: string; text: string }
  | { kind: "thinking"; id: string; time: string; text: string };

/** The instance's conversation as a log: each tool call with its result, texts and thinking, timed from the start. */
export function agentLog(
  messages: UiMessage[],
  startedAt: string,
  ended: boolean,
): LogEntry[] {
  const results = new Map<string, UiMessage>();
  for (const message of messages)
    if (message.role === "tool" && message.toolCallId)
      results.set(message.toolCallId, message);
  const start = Date.parse(startedAt);
  const clock = (timestamp: number) =>
    Number.isNaN(start) ? "" : formatElapsed(timestamp - start);
  const log: LogEntry[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const time = clock(message.timestamp);
    if (message.thinking)
      log.push({
        kind: "thinking",
        id: `${message.id}-thinking`,
        time,
        text: message.thinking,
      });
    if (message.text.trim())
      log.push({ kind: "text", id: message.id, time, text: message.text });
    for (const call of message.toolCalls ?? []) {
      const result = results.get(call.id);
      log.push({
        kind: "tool",
        time: clock(result?.timestamp ?? message.timestamp),
        entry: {
          id: call.id,
          name: call.name,
          args: call.arguments,
          result: result?.text,
          isError: result?.isError,
          done: !!result || ended,
        },
      });
    }
  }
  return log;
}

export function AgentRunHeader({
  run,
  scope,
  now,
  backLabel,
  onBack,
}: {
  run: AgentRun;
  scope?: string;
  now: number;
  backLabel?: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const tone = agentTone(run);
  return (
    <SheetHeader
      eyebrow={t("agents.picoAgent")}
      backLabel={backLabel}
      onBack={onBack}
      title={
        <>
          {profileName(run.agentId, run.name)}
          {scope && <span className="muted"> · {scope}</span>}
        </>
      }
    >
      <span className={`chip ${tone}`}>
        <span className={`dot ${tone}`} />
        {t(`agents.states.${run.status}`)} ·{" "}
        {shortDuration(run.createdAt, run.endedAt, now)}
      </span>
      <span className="mono">
        {run.model}
        {run.thinking && run.thinking !== "off" ? ` · ${run.thinking}` : ""}
      </span>
    </SheetHeader>
  );
}

export function AgentRunView({
  detail,
  messages,
  now,
  before,
  loadingOlder = false,
  onLoadOlder,
}: {
  detail: AgentRunDetail;
  messages: UiMessage[];
  now: number;
  before?: number | null;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const { t } = useTranslation();
  const { run } = detail;
  const [fullTask, setFullTask] = useState(false);
  const log = agentLog(messages, run.createdAt, run.status !== "running");
  const calls = log.filter((entry) => entry.kind === "tool").length;
  const started = Date.parse(run.createdAt);
  return (
    <div className="sheet-body">
      {run.status !== "running" && !run.notified && (
        <Notice>
          {t(run.campaignId ? "campaigns.delivering" : "agents.delivering")}
        </Notice>
      )}
      {run.error && <Notice error>{run.error}</Notice>}
      <section className="sheet-section">
        <div className="sheet-section-head">
          <h3>{t("agents.task")}</h3>
          <button
            type="button"
            className="text-button"
            aria-expanded={fullTask}
            onClick={() => setFullTask(!fullTask)}
          >
            {t(fullTask ? "agents.hideTask" : "agents.showTask")}
          </button>
        </div>
        <p
          className={`agent-task${fullTask ? "" : " clamp"}`}
          style={{ "--lines": 3 } as CSSProperties}
        >
          {run.task}
        </p>
      </section>
      <section className="sheet-section">
        <div className="sheet-section-head">
          <h3>{t("agents.activity")}</h3>
          <span className="meta">{t("agents.calls", { count: calls })}</span>
        </div>
        {before != null && (
          <button
            type="button"
            className="text-button"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {t(loadingOlder ? "chat.loadingOlder" : "chat.loadOlder")}
          </button>
        )}
        {(log.length > 0 || run.streamingText) && (
          <ol className="agent-log">
            {log.map((entry) =>
              entry.kind === "tool" ? (
                <li key={entry.entry.id}>
                  <time>{entry.time}</time>
                  <ToolCall entry={entry.entry} />
                </li>
              ) : entry.kind === "thinking" ? (
                <li key={entry.id} className="is-thinking">
                  <time>{entry.time}</time>
                  <Thinking>{entry.text}</Thinking>
                </li>
              ) : (
                <li key={entry.id}>
                  <time>{entry.time}</time>
                  <div className="agent-log-text">
                    <Markdown>{entry.text}</Markdown>
                  </div>
                </li>
              ),
            )}
            {run.streamingText && (
              <li className="is-live">
                <time>
                  {Number.isNaN(started) ? "" : formatElapsed(now - started)}
                </time>
                <div className="agent-log-text live-cursor">
                  <Markdown>{run.streamingText}</Markdown>
                </div>
              </li>
            )}
          </ol>
        )}
      </section>
      <section className="sheet-section">
        <div className="sheet-section-head">
          <h3>{t("agents.result")}</h3>
        </div>
        {run.result ? (
          <Markdown>{run.result}</Markdown>
        ) : (
          <p className="meta">
            {run.status === "running"
              ? t("agents.resultPending")
              : t("common.none")}
          </p>
        )}
      </section>
    </div>
  );
}

/** The instance panel: header, live log and the way to interrupt it. */
export function AgentRunSheet({
  run,
  scope,
  backLabel,
  onBack,
  refresh,
}: {
  run: AgentRun;
  scope?: string;
  backLabel?: string;
  onBack?: () => void;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const path = labPath(run.labId, `/agent-runs/${encodeURIComponent(run.id)}`);
  const detail = usePoll<AgentRunDetail>(path, 2_000);
  const action = useAction();
  const [older, setOlder] = useState<UiMessage[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();
  const current = detail.data?.run ?? run;
  const now = useNow(current.status === "running");
  useEffect(() => {
    const messages = detail.data?.messages;
    if (messages)
      setOlder((previous) => [
        ...new Map(
          [...previous, ...messages].map((message) => [message.id, message]),
        ).values(),
      ]);
  }, [detail.data]);
  const before = cursor === undefined ? detail.data?.before : cursor;
  const loadOlder = async () => {
    if (before == null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const page = await request<AgentRunDetail>(`${path}?before=${before}`);
      setOlder((previous) => [...page.messages, ...previous]);
      setCursor(page.before);
    } catch (error) {
      setOlderError(errorText(error));
    } finally {
      setLoadingOlder(false);
    }
  };
  const messages = [
    ...new Map(
      [...older, ...(detail.data?.messages ?? [])].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ];
  const usage = detail.data?.usage ?? current.usage;
  return (
    <>
      <AgentRunHeader
        run={current}
        scope={scope}
        now={now}
        backLabel={backLabel}
        onBack={onBack}
      />
      <QueryState
        loading={detail.loading}
        error={detail.error}
        hasData={!!detail.data}
        refresh={detail.refresh}
      >
        {olderError && <Notice error>{olderError}</Notice>}
        {detail.data && (
          <AgentRunView
            detail={detail.data}
            messages={messages}
            now={now}
            before={before}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void loadOlder()}
          />
        )}
      </QueryState>
      <footer className="sheet-foot">
        <span>
          {t("chat.usage", {
            tokens: compactNumber(usage.total),
            cost: formatCost(usage.cost),
          })}
        </span>
        <span className="spacer" />
        {action.error && <Notice error>{action.error}</Notice>}
        {current.status === "running" && (
          <button
            type="button"
            className="small"
            disabled={action.busy}
            onClick={async () => {
              if (await action.run(`${path}/stop`)) {
                detail.refresh();
                refresh();
              }
            }}
          >
            <Icon name="stop" size={13} />
            {action.busy ? t("chat.stopping") : t("agents.stop")}
          </button>
        )}
        {current.status !== "running" &&
          current.status !== "completed" &&
          current.sessionId && (
            <button
              type="button"
              className="small"
              title={t("agents.resumeHint")}
              disabled={action.busy}
              onClick={async () => {
                if (await action.run(`${path}/resume`)) {
                  detail.refresh();
                  refresh();
                }
              }}
            >
              <Icon name="refresh" size={13} />
              {action.busy ? t("agents.resuming") : t("agents.resume")}
            </button>
          )}
      </footer>
    </>
  );
}
