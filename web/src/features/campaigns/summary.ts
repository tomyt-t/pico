import type { AgentRun, Campaign } from "@pico/server/contracts";
import { formatCost } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";
import { isClosedCampaign } from "./status";

export interface ActivitySummary {
  campaigns: number;
  specialists: number;
  cost: number;
  busy: boolean;
  /** Whether both lists have loaded at least once. */
  known: boolean;
}

export function summarize(
  campaigns: Campaign[] | undefined,
  agents: AgentRun[] | undefined,
): ActivitySummary {
  const open =
    campaigns?.filter((campaign) => !isClosedCampaign(campaign)) ?? [];
  const running = agents?.filter((run) => run.status === "running") ?? [];
  return {
    campaigns: open.length,
    specialists: running.length,
    cost:
      open.reduce((sum, campaign) => sum + campaign.usage.cost, 0) +
      running
        .filter((run) => !run.campaignId)
        .reduce((sum, run) => sum + run.usage.cost, 0),
    busy: open.some((campaign) => campaign.isWorking) || running.length > 0,
    known: !!campaigns && !!agents,
  };
}

/** "2 campanhas · 4 especialistas · US$ 0,65", or that nothing runs. */
export function summaryText(summary: ActivitySummary): string {
  const t = i18n.t;
  if (!summary.known) return "";
  if (!summary.campaigns && !summary.specialists)
    return t("campaigns.nothingRunning");
  const parts = [];
  if (summary.campaigns)
    parts.push(t("campaigns.count", { count: summary.campaigns }));
  if (summary.specialists)
    parts.push(t("campaigns.specialists", { count: summary.specialists }));
  if (summary.cost > 0) parts.push(formatCost(summary.cost));
  return parts.join(" · ");
}

/** Opens a campaign in the activity panel from elsewhere, such as an event in the chat. */
export function openCampaign(campaignId: string) {
  window.dispatchEvent(
    new CustomEvent("pico:open-campaign", { detail: { campaignId } }),
  );
}
