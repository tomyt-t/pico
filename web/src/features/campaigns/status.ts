import type { AgentRun, Campaign } from "@pico/server/contracts";
import { toolLabel } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";

/** The visual state of a campaign or instance: a colour and a shape, never the accent alone. */
export type Tone =
  | "busy"
  | "active"
  | "waiting"
  | "pending"
  | "paused"
  | "error"
  | "done"
  | "idle";

export function campaignTone(campaign: Campaign, workers = 0): Tone {
  switch (campaign.status) {
    case "completed":
      return "done";
    case "ended":
      return campaign.reason === "error" ? "error" : "idle";
    case "paused":
      return "paused";
    case "pending":
      return campaign.reason === "error" ? "error" : "pending";
    case "waiting":
      return "waiting";
    default:
      return campaign.isWorking || workers > 0 ? "busy" : "active";
  }
}

export function agentTone(run: AgentRun): Tone {
  switch (run.status) {
    case "running":
      return "busy";
    case "completed":
      return "done";
    case "failed":
      return "error";
    default:
      return "paused";
  }
}

/** One line on what the campaign is doing, from the coordinator's point of view. */
export function campaignStateLine(campaign: Campaign, workers = 0): string {
  const t = i18n.t;
  switch (campaign.status) {
    case "completed":
    case "ended":
      return t(`campaigns.states.${campaign.status}`);
    case "paused":
      return t(`campaigns.reasons.${campaign.reason ?? "researcher"}`);
    case "pending":
      return t(`campaigns.reasons.${campaign.reason ?? "input"}`);
    case "waiting":
      return campaign.reason
        ? t(`campaigns.reasons.${campaign.reason}`)
        : t("campaigns.states.waiting");
    default: {
      const tool = toolLabel(campaign.currentTool);
      if (tool) return t("campaigns.coordinatorTool", { tool });
      if (campaign.isWorking) return t("campaigns.coordinatorWorking");
      if (workers) return t("campaigns.workerCount", { count: workers });
      return campaign.activity || t("campaigns.coordinatorIdle");
    }
  }
}

/** What an instance is doing now, or how it ended and where its result goes. */
export function agentStateLine(run: AgentRun): string {
  const t = i18n.t;
  if (run.status === "running")
    return toolLabel(run.currentTool) ?? t("agents.working");
  const state = t(`agents.states.${run.status}`);
  return run.notified
    ? state
    : `${state} · ${t(run.campaignId ? "campaigns.delivering" : "agents.delivering")}`;
}

/** Instances of one profile in start order, so an index stays stable while they run. */
export function sortedRuns(runs: AgentRun[]): AgentRun[] {
  return [...runs].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Tells parallel instances of the same profile apart: the coordinator's label
 * when there is one, otherwise "2 de 3".
 */
export function scopeLabel(
  run: AgentRun,
  siblings: AgentRun[],
): string | undefined {
  const label = run.label?.trim();
  if (label) return label;
  const same = sortedRuns(
    siblings.filter((other) => other.agentId === run.agentId),
  );
  if (same.length < 2) return undefined;
  const index = same.findIndex((other) => other.id === run.id) + 1;
  if (!index) return undefined;
  return i18n.t("agents.instanceOf", { index, total: same.length });
}

/** Runs still shown in the activity panel: working, or finished but not yet delivered. */
export function isActiveRun(run: AgentRun): boolean {
  return run.status === "running" || !run.notified;
}

export function isClosedCampaign(campaign: Campaign): boolean {
  return campaign.status === "completed" || campaign.status === "ended";
}
