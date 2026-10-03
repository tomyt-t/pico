import type {
  AgentRun,
  Campaign,
  CampaignControl,
  CampaignDetail,
  UiMessage,
} from "@pico/server/contracts";
import { useEffect, useState } from "react";
import { errorText, labPath, request } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import { formatCost, relativeTime } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Icon, Notice, Status } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { SheetHeader } from "@/web/components/sheet";
import { useNow } from "@/web/components/use-now";
import { AgentRunRow } from "@/web/features/chat/agent-activity";
import {
  groupMessages,
  Thinking,
  ToolCallGroup,
} from "@/web/features/chat/message-list";
import {
  campaignStateLine,
  campaignTone,
  isActiveRun,
  isClosedCampaign,
  scopeLabel,
  sortedRuns,
} from "./status";

export function CampaignHeader({
  campaign,
  workers,
  now,
}: {
  campaign: Campaign;
  workers: number;
  now: number;
}) {
  const { t } = useTranslation();
  const tone = campaignTone(campaign, workers);
  return (
    <SheetHeader
      eyebrow={
        <>
          <span>{t("campaigns.campaign")}</span>
          <code>{campaign.id}</code>
        </>
      }
      title={campaign.title}
    >
      <span className={`chip ${tone}`}>
        <span className={`dot ${tone}`} />
        {campaignStateLine(campaign, workers)}
      </span>
      <span>
        {t("campaigns.coordinator")}{" "}
        <span className="mono">
          {campaign.provider} / {campaign.model}
        </span>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {t("campaigns.startedAgo", {
          time: relativeTime(campaign.createdAt, now),
        })}
      </span>
    </SheetHeader>
  );
}

/** What matters now: the latest milestone and plan, the team, jobs and the budget. */
export function CampaignDetailView({
  detail,
  now,
  onAgent,
}: {
  detail: CampaignDetail;
  now: number;
  onAgent?: (run: AgentRun, scope?: string) => void;
}) {
  const { t } = useTranslation();
  const { campaign } = detail;
  const active = sortedRuns(detail.agents.filter(isActiveRun));
  const history = sortedRuns(
    detail.agents.filter((run) => !isActiveRun(run)),
  ).reverse();
  const latest = campaign.summary || campaign.activity;
  const cost = campaign.usage.cost;
  const budget = campaign.budgetUsd;
  const percent =
    budget > 0 ? Math.min(100, Math.round((cost / budget) * 100)) : 0;
  const over = budget > 0 && cost >= budget;
  const rows = (runs: AgentRun[]) => (
    <ul className="agent-rows is-boxed">
      {runs.map((run) => (
        <AgentRunRow
          key={run.id}
          run={run}
          scope={scopeLabel(run, runs)}
          cost={run.usage.cost}
          now={now}
          onOpen={() => onAgent?.(run, scopeLabel(run, runs))}
        />
      ))}
    </ul>
  );
  return (
    <>
      <section className="sheet-section">
        <div className="sheet-section-head">
          <h3>{t("campaigns.now")}</h3>
          <span className="meta">
            {t("campaigns.updatedAgo", {
              time: relativeTime(campaign.updatedAt, now),
            })}
          </span>
        </div>
        {campaign.result ? (
          <div className="campaign-now is-result">
            <div className="campaign-now-label">
              <Icon name="check" size={13} />
              {t("campaigns.result")}
            </div>
            <Markdown>{campaign.result}</Markdown>
          </div>
        ) : latest ? (
          <div className="campaign-now">
            <div className="campaign-now-label">
              <Icon name="flag" size={13} />
              {t("campaigns.summary")}
            </div>
            <Markdown>{latest}</Markdown>
          </div>
        ) : null}
        {campaign.plan ? (
          <div className="campaign-plan">
            <h4 className="sheet-label">{t("campaigns.plan")}</h4>
            <Markdown>{campaign.plan}</Markdown>
          </div>
        ) : (
          !latest &&
          !campaign.result && <p className="meta">{t("campaigns.firstTurn")}</p>
        )}
      </section>
      <section className="sheet-section">
        <div className="sheet-section-head">
          <h3>
            {t("campaigns.team")} · {active.length} / {campaign.maxAgents}
          </h3>
        </div>
        {active.length ? (
          rows(active)
        ) : (
          <p className="meta">{t("campaigns.noWorkers")}</p>
        )}
        {history.length > 0 && (
          <details className="sheet-details">
            <summary>
              {t("campaigns.teamHistory")} · {history.length}
            </summary>
            {rows(history)}
          </details>
        )}
      </section>
      {detail.jobs.length > 0 && (
        <section className="sheet-section">
          <div className="sheet-section-head">
            <h3>
              {t("campaigns.jobs")} · {detail.jobs.length}
            </h3>
          </div>
          <ul className="campaign-jobs">
            {detail.jobs.map((job) => (
              <li key={job.id}>
                <div>
                  <Status value={job.status} />
                  <strong>{job.name}</strong>
                </div>
                <code>{job.command}</code>
                {job.error && <Notice error>{job.error}</Notice>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="sheet-section campaign-budget">
        <div className="sheet-section-head">
          <h3>{t("campaigns.budgetTitle")}</h3>
          <span className="meta num">
            {t("campaigns.percent", { percent })}
          </span>
        </div>
        <p className="campaign-spent">
          <strong>
            {t("campaigns.spent", {
              cost: formatCost(cost),
              budget: formatCost(budget),
            })}
          </strong>
        </p>
        <span
          className={`meter${over ? " warn" : ""}`}
          role="progressbar"
          aria-label={t("campaigns.estimated")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </span>
        <p className="meta">
          {t("campaigns.limitLine", { count: campaign.maxAgents })} ·{" "}
          {t("campaigns.budgetHint")}
        </p>
      </section>
    </>
  );
}

export function CampaignControls({
  campaign,
  runningJobs,
  refresh,
}: {
  campaign: Campaign;
  runningJobs: number;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const action = useAction();
  const messageAction = useAction();
  const [ending, setEnding] = useState(false);
  const [jobs, setJobs] = useState<"keep" | "stop" | "">("");
  const [addBudget, setAddBudget] = useState("");
  const [maxAgents, setMaxAgents] = useState(String(campaign.maxAgents));
  const [message, setMessage] = useState("");
  const [messaging, setMessaging] = useState(false);
  const [sent, setSent] = useState(false);
  const resumable =
    campaign.status === "paused" || campaign.status === "pending";
  const control = async (input: CampaignControl) => {
    if (
      await action.run(
        labPath(campaign.labId, `/campaigns/${campaign.id}/control`),
        input,
      )
    ) {
      setEnding(false);
      setAddBudget("");
      setMessage("");
      refresh();
    }
  };
  const send = async () => {
    setSent(false);
    if (
      await messageAction.run(
        labPath(campaign.labId, `/campaigns/${campaign.id}/message`),
        { message },
      )
    ) {
      setMessage("");
      setMessaging(false);
      setSent(true);
      refresh();
    }
  };
  if (isClosedCampaign(campaign)) return null;
  return (
    <section className="sheet-section campaign-controls">
      <div className="sheet-section-head">
        <h3>{t("campaigns.controls")}</h3>
      </div>
      {resumable ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void control({
              action: "resume",
              ...(addBudget && { addBudgetUsd: Number(addBudget) }),
              maxAgents: Number(maxAgents),
              message,
            });
          }}
        >
          <p className="meta">{t("campaigns.resumeHint")}</p>
          <div className="campaign-limits">
            <label className="field">
              {t("campaigns.addBudget")}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={addBudget}
                required={campaign.usage.cost >= campaign.budgetUsd}
                onChange={(event) => setAddBudget(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="field">
              {t("campaigns.maxAgents")}
              <input
                type="number"
                min="1"
                step="1"
                value={maxAgents}
                required
                onChange={(event) => setMaxAgents(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            {t("campaigns.direction")}
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <div className="sheet-controls">
            <button type="submit" className="primary" disabled={action.busy}>
              {t("campaigns.resume")}
            </button>
            <span className="spacer" />
            {!ending && (
              <button
                className="text-button danger"
                type="button"
                disabled={action.busy}
                onClick={() => setEnding(true)}
              >
                {t("campaigns.end")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="sheet-controls">
            <button
              type="button"
              disabled={action.busy}
              onClick={() => void control({ action: "pause" })}
            >
              <Icon name="pause" size={13} />
              {action.busy ? t("campaigns.pausing") : t("campaigns.pause")}
            </button>
            <button
              type="button"
              aria-expanded={messaging}
              onClick={() => {
                setMessaging(!messaging);
                setSent(false);
              }}
            >
              <Icon name="chat" size={13} />
              {t("campaigns.message")}
            </button>
            <span className="spacer" />
            {!ending && (
              <button
                className="text-button danger"
                type="button"
                disabled={action.busy}
                onClick={() => setEnding(true)}
              >
                {t("campaigns.end")}
              </button>
            )}
          </div>
          <p className="meta">{t("campaigns.pauseHint")}</p>
          {messaging && (
            <form
              className="campaign-message"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="field">
                {t("campaigns.message")}
                <textarea
                  required
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <small>{t("campaigns.messageHint")}</small>
              </label>
              {messageAction.error && (
                <Notice error>{messageAction.error}</Notice>
              )}
              <div className="campaign-message-actions">
                <button
                  type="button"
                  onClick={() => setMessaging(false)}
                  disabled={messageAction.busy}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={messageAction.busy || !message.trim()}
                >
                  {messageAction.busy ? t("chat.sending") : t("chat.send")}
                </button>
              </div>
            </form>
          )}
          {sent && <Notice>{t("campaigns.messageSent")}</Notice>}
        </>
      )}
      {ending && (
        <form
          className="form campaign-ending"
          onSubmit={(event) => {
            event.preventDefault();
            void control({ action: "end", ...(jobs && { jobs }) });
          }}
        >
          <p>{t("campaigns.endHint")}</p>
          {runningJobs > 0 && (
            <fieldset>
              <legend>
                {t("campaigns.jobs")} · {runningJobs}
              </legend>
              {(["keep", "stop"] as const).map((choice) => (
                <label key={choice} className="campaign-job-choice">
                  <input
                    type="radio"
                    name="campaign-jobs"
                    value={choice}
                    checked={jobs === choice}
                    onChange={() => setJobs(choice)}
                    required
                  />
                  {t(
                    choice === "keep"
                      ? "campaigns.keepJobs"
                      : "campaigns.stopJobs",
                  )}
                </label>
              ))}
            </fieldset>
          )}
          <div className="campaign-message-actions">
            <button
              type="button"
              onClick={() => setEnding(false)}
              disabled={action.busy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="danger"
              disabled={action.busy || (runningJobs > 0 && !jobs)}
            >
              {t("campaigns.endConfirm")}
            </button>
          </div>
        </form>
      )}
      {action.error && <Notice error>{action.error}</Notice>}
    </section>
  );
}

/** Objective, deliverable and context as the researcher wrote them, folded away. */
export function CampaignMandate({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  return (
    <details className="sheet-section sheet-details">
      <summary>
        <h3>{t("campaigns.mandate")}</h3>
      </summary>
      <div className="campaign-mandate">
        <h4 className="sheet-label">{t("campaigns.objective")}</h4>
        <Markdown>{campaign.objective}</Markdown>
        <h4 className="sheet-label">{t("campaigns.deliverable")}</h4>
        <Markdown>{campaign.deliverable}</Markdown>
        {campaign.context && (
          <>
            <h4 className="sheet-label">{t("campaigns.context")}</h4>
            <Markdown>{campaign.context}</Markdown>
          </>
        )}
      </div>
    </details>
  );
}

/** The coordinator's own session: system turns folded, tool calls as chips with their results on demand. */
export function CampaignTranscript({
  messages,
  before,
  loading,
  error,
  onLoadOlder,
}: {
  messages: UiMessage[];
  before: number | null | undefined;
  loading: boolean;
  error?: string;
  onLoadOlder: () => void;
}) {
  const { t } = useTranslation();
  const turns = messages.filter((message) => message.role === "user").length;
  const groups = groupMessages(messages);
  return (
    <details className="sheet-section sheet-details">
      <summary>
        <h3>
          {t("campaigns.conversation")} ·{" "}
          {t("campaigns.turns", { count: turns })}
        </h3>
      </summary>
      <div className="campaign-transcript">
        {before != null && (
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={onLoadOlder}
          >
            {t(loading ? "chat.loadingOlder" : "chat.loadOlder")}
          </button>
        )}
        {error && <Notice error>{error}</Notice>}
        {groups.map((group) =>
          group.kind === "tools" ? (
            <ToolCallGroup key={group.id} items={group.items} />
          ) : group.message.role === "assistant" ? (
            <article className="turn" key={group.message.id}>
              <header>
                <strong>{t("campaigns.coordinator")}</strong>
                <time>{relativeTime(group.message.timestamp)}</time>
              </header>
              {group.message.thinking && (
                <Thinking>{group.message.thinking}</Thinking>
              )}
              {group.message.text.trim() && (
                <Markdown>{group.message.text}</Markdown>
              )}
            </article>
          ) : (
            <details className="turn-system" key={group.message.id}>
              <summary>
                <strong>{t("campaigns.system")}</strong>
                <time>{relativeTime(group.message.timestamp)}</time>
              </summary>
              <Markdown>{group.message.text}</Markdown>
            </details>
          ),
        )}
      </div>
    </details>
  );
}

/** The campaign panel: live detail, controls and the coordinator's conversation. */
export function CampaignSheet({
  campaign,
  onAgent,
  refresh,
}: {
  campaign: Campaign;
  onAgent: (run: AgentRun, scope?: string) => void;
  refresh: () => void;
}) {
  const path = labPath(campaign.labId, `/campaigns/${campaign.id}`);
  const detail = usePoll<CampaignDetail>(path, 2000);
  const [older, setOlder] = useState<UiMessage[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const current = detail.data?.campaign ?? campaign;
  const now = useNow(!isClosedCampaign(current));
  useEffect(() => {
    const data = detail.data;
    if (data)
      setOlder((previous) => [
        ...new Map(
          [...previous, ...data.messages].map((message) => [
            message.id,
            message,
          ]),
        ).values(),
      ]);
  }, [detail.data]);
  const before = cursor === undefined ? detail.data?.before : cursor;
  const messages = [
    ...new Map(
      [...older, ...(detail.data?.messages ?? [])].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  const loadOlder = async () => {
    if (before == null || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const page = await request<CampaignDetail>(`${path}?before=${before}`);
      setOlder((previous) => [...page.messages, ...previous]);
      setCursor(page.before);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };
  const workers =
    detail.data?.agents.filter((run) => run.status === "running").length ?? 0;
  return (
    <>
      <CampaignHeader campaign={current} workers={workers} now={now} />
      <div className="sheet-body">
        <QueryState
          loading={detail.loading}
          error={detail.error}
          hasData={!!detail.data}
          refresh={detail.refresh}
        >
          {detail.data && (
            <>
              <CampaignDetailView
                detail={detail.data}
                now={now}
                onAgent={onAgent}
              />
              <CampaignControls
                campaign={current}
                runningJobs={
                  detail.data.jobs.filter((job) => job.status === "running")
                    .length
                }
                refresh={() => {
                  detail.refresh();
                  refresh();
                }}
              />
              <CampaignMandate campaign={current} />
              <CampaignTranscript
                messages={messages}
                before={before}
                loading={loading}
                error={error}
                onLoadOlder={() => void loadOlder()}
              />
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
