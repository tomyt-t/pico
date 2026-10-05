import type { AgentRun, Campaign, Job, Lab } from "@pico/server/contracts";
import { useEffect, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import { remember } from "@/web/app/theme";
import { formatCost, shortDuration } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { Sheet } from "@/web/components/sheet";
import { useNow } from "@/web/components/use-now";
import { AgentRunRow, AgentRunSheet } from "@/web/features/chat/agent-activity";
import { CampaignSheet } from "./campaign-dialog";
import {
  campaignStateLine,
  campaignTone,
  isActiveRun,
  isClosedCampaign,
  scopeLabel,
  sortedRuns,
} from "./status";
import { summarize, summaryText } from "./summary";

/** Campaigns and active instances of a laboratory, polled once and shared by the shell and the panel. */
export function useLabActivity(labId: string | null) {
  const campaigns = usePoll<Campaign[]>(
    labId ? labPath(labId, "/campaigns") : null,
    2000,
  );
  const agents = usePoll<AgentRun[]>(
    labId ? labPath(labId, "/agent-runs?active=1") : null,
    2000,
  );
  // Detached jobs keep working while Pico is idle, e.g. a training run.
  const jobs = usePoll<Job[]>(
    labId ? labPath(labId, "/jobs?status=running") : null,
    5000,
  );
  return {
    campaigns,
    agents,
    jobs,
    refresh: () => {
      campaigns.refresh();
      agents.refresh();
      jobs.refresh();
    },
  };
}

export type LabActivity = ReturnType<typeof useLabActivity>;

export function CampaignTree({
  campaign,
  agents,
  now,
  onOpen,
  onAgent,
}: {
  campaign: Campaign;
  agents: AgentRun[];
  now: number;
  onOpen: () => void;
  onAgent: (agent: AgentRun) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const children = sortedRuns(
    agents.filter((run) => run.campaignId === campaign.id && isActiveRun(run)),
  );
  const workers = children.filter((run) => run.status === "running").length;
  const tone = campaignTone(campaign, workers);
  const budget = campaign.budgetUsd;
  const cost = campaign.usage.cost;
  const percent =
    budget > 0 ? Math.min(100, Math.round((cost / budget) * 100)) : 0;
  const meta = [
    workers ? t("campaigns.specialists", { count: workers }) : "",
    shortDuration(campaign.createdAt, campaign.endedAt, now),
    t("campaigns.spent", {
      cost: formatCost(cost),
      budget: formatCost(budget),
    }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`campaign-card is-${tone}`}>
      <div className="campaign-main">
        <button type="button" className="campaign-open" onClick={onOpen}>
          <strong className="campaign-title">{campaign.title}</strong>
          <span className="campaign-state">
            <span className={`dot ${tone}`} />
            {campaignStateLine(campaign, workers)}
          </span>
          <span className="campaign-meta">{meta}</span>
          <span
            className={`meter${budget > 0 && cost >= budget ? " warn" : ""}`}
            aria-hidden="true"
          >
            <i style={{ width: `${percent}%` }} />
          </span>
        </button>
        {children.length > 0 && (
          <button
            type="button"
            className="icon-button campaign-expand"
            aria-expanded={expanded}
            aria-controls={`children-${campaign.id}`}
            aria-label={t("campaigns.toggleInstances", {
              title: campaign.title,
            })}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="chevron" size={13} />
          </button>
        )}
      </div>
      {children.length > 0 && (
        <ul
          id={`children-${campaign.id}`}
          className="agent-rows campaign-children"
          hidden={!expanded}
        >
          {children.map((run) => (
            <AgentRunRow
              key={run.id}
              run={run}
              scope={scopeLabel(run, children)}
              now={now}
              onOpen={() => onAgent(run)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CreateCampaignDialog({
  lab,
  onClose,
  onCreated,
}: {
  lab: Lab;
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useAction();
  const [values, setValues] = useState({
    title: "",
    objective: "",
    deliverable: "",
    context: "",
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="modal" ref={dialog} onClose={onClose}>
      <div className="modal-heading">
        <h2>{t("campaigns.new")}</h2>
        <button
          className="icon-button"
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label={t("common.close")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <p className="subheading">{t("campaigns.createHint")}</p>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await action.run<Campaign>(
            labPath(lab.id, "/campaigns"),
            values,
          );
          if (created) onCreated(created);
        }}
      >
        {(["title", "objective", "deliverable", "context"] as const).map(
          (key) => (
            <label className="field" key={key} htmlFor={`new-campaign-${key}`}>
              {t(`campaigns.${key === "title" ? "titleField" : key}`)}
              {key === "title" ? (
                <input
                  id={`new-campaign-${key}`}
                  required
                  value={values[key]}
                  onChange={(event) =>
                    setValues({ ...values, [key]: event.target.value })
                  }
                />
              ) : (
                <textarea
                  id={`new-campaign-${key}`}
                  required={key !== "context"}
                  value={values[key]}
                  onChange={(event) =>
                    setValues({ ...values, [key]: event.target.value })
                  }
                />
              )}
            </label>
          ),
        )}
        {action.error && <Notice error>{action.error}</Notice>}
        <div className="form-actions">
          <button type="button" onClick={() => dialog.current?.close()}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={action.busy}>
            {t("campaigns.create")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

type SheetView =
  | { kind: "campaign"; campaign: Campaign }
  | { kind: "agent"; run: AgentRun; scope?: string; from?: Campaign };

const wide = () =>
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 1101px)").matches;

export function CampaignActivity({
  lab,
  activity,
}: {
  lab: Lab;
  /** Shared polling from the workspace; the panel polls on its own without it. */
  activity?: LabActivity;
}) {
  const { t } = useTranslation();
  const own = useLabActivity(activity ? null : lab.id);
  const { campaigns, agents, jobs, refresh } = activity ?? own;
  const [sheet, setSheet] = useState<SheetView | null>(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    if (!wide()) return false;
    try {
      return localStorage.getItem("pico-activity") !== "collapsed";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setExpanded(!expanded);
    if (wide()) remember("pico-activity", expanded ? "collapsed" : "expanded");
  };
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1101px)");
    const changed = () => {
      if (!query.matches) setExpanded(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  const all = campaigns.data ?? [];
  const latest = useRef(all);
  latest.current = all;
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ campaignId?: string }>).detail
        ?.campaignId;
      const campaign = latest.current.find((entry) => entry.id === id);
      if (campaign) setSheet({ kind: "campaign", campaign });
    };
    window.addEventListener("pico:open-campaign", open);
    return () => window.removeEventListener("pico:open-campaign", open);
  }, []);
  const active = all.filter((campaign) => !isClosedCampaign(campaign));
  const closed = all.filter(isClosedCampaign);
  const visible = history ? closed : active;
  const standalone = sortedRuns(
    agents.data?.filter((run) => !run.campaignId && isActiveRun(run)) ?? [],
  );
  const summary = summarize(campaigns.data, agents.data, jobs.data);
  const now = useNow(summary.busy);
  return (
    <aside
      className={`research-activity${expanded ? "" : " is-collapsed"}`}
      aria-label={t("campaigns.activityTitle")}
    >
      <button
        type="button"
        className="activity-toggle"
        aria-label={t("campaigns.toggle")}
        aria-controls="campaign-activity-content"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <Icon name={expanded ? "panel-close" : "panel-open"} size={17} />
        <span className="activity-label">
          <strong>{t("campaigns.activityTitle")}</strong>
          <small>{summaryText(summary)}</small>
        </span>
        <span
          className={`dot ${!summary.known ? "" : summary.busy ? "busy" : summary.campaigns ? "active" : "idle"}`.trim()}
        />
      </button>
      {expanded && !wide() && (
        <button
          type="button"
          className="activity-scrim"
          aria-label={t("campaigns.toggle")}
          onClick={toggle}
        />
      )}
      <div className="activity-body" hidden={!expanded}>
        <div
          id="campaign-activity-content"
          className="research-activity-content"
        >
          <QueryState
            loading={campaigns.loading}
            error={campaigns.error}
            hasData={!!campaigns.data}
            refresh={campaigns.refresh}
          >
            {campaigns.data && visible.length === 0 && (
              <p className="activity-empty">
                {t(history ? "campaigns.emptyHistory" : "campaigns.empty")}
                {!history && <> {t("campaigns.emptyHint")}</>}
              </p>
            )}
            <ul className="campaign-list">
              {visible.map((campaign) => (
                <CampaignTree
                  key={campaign.id}
                  campaign={campaign}
                  agents={agents.data ?? []}
                  now={now}
                  onOpen={() => setSheet({ kind: "campaign", campaign })}
                  onAgent={(run) =>
                    setSheet({
                      kind: "agent",
                      run,
                      scope: scopeLabel(
                        run,
                        (agents.data ?? []).filter(
                          (other) => other.campaignId === campaign.id,
                        ),
                      ),
                      from: campaign,
                    })
                  }
                />
              ))}
            </ul>
          </QueryState>
          {agents.error && !agents.data && (
            <Notice error>{agents.error}</Notice>
          )}
          {standalone.length > 0 && (
            <section className="campaign-standalone">
              <h3>{t("campaigns.standalone")}</h3>
              <ul className="agent-rows is-boxed">
                {standalone.map((run) => (
                  <AgentRunRow
                    key={run.id}
                    run={run}
                    scope={scopeLabel(run, standalone)}
                    now={now}
                    onOpen={() =>
                      setSheet({
                        kind: "agent",
                        run,
                        scope: scopeLabel(run, standalone),
                      })
                    }
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="activity-foot">
          <button
            type="button"
            className="text-button"
            onClick={() => setHistory(!history)}
          >
            {history
              ? t("campaigns.current")
              : `${t("campaigns.history")}${closed.length ? ` · ${closed.length}` : ""}`}
          </button>
          <button
            type="button"
            className="small"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={14} />
            {t("campaigns.new")}
          </button>
        </div>
      </div>
      {creating && (
        <CreateCampaignDialog
          lab={lab}
          onClose={() => setCreating(false)}
          onCreated={(campaign) => {
            setCreating(false);
            setHistory(false);
            refresh();
            setSheet({ kind: "campaign", campaign });
          }}
        />
      )}
      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          {sheet.kind === "campaign" ? (
            <CampaignSheet
              key={sheet.campaign.id}
              campaign={sheet.campaign}
              refresh={refresh}
              onAgent={(run, scope) =>
                setSheet({ kind: "agent", run, scope, from: sheet.campaign })
              }
            />
          ) : (
            <AgentRunSheet
              key={sheet.run.id}
              run={sheet.run}
              scope={sheet.scope}
              backLabel={sheet.from?.title}
              onBack={
                sheet.from
                  ? () => {
                      const campaign = sheet.from;
                      if (campaign) setSheet({ kind: "campaign", campaign });
                    }
                  : undefined
              }
              refresh={refresh}
            />
          )}
        </Sheet>
      )}
    </aside>
  );
}
