import type { Database } from "bun:sqlite";
import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import {
  type ClaudeSession,
  type ClaudeSessionOptions,
  displayToolName,
  parseNote,
  planLimitMessage,
  planLimitReset,
  readTranscript,
  textOf,
} from "./claude-runtime";
import type {
  Campaign,
  CampaignControl,
  CampaignDetail,
  CampaignProgressInput,
  CampaignSettings,
  CreateCampaignInput,
  Lab,
} from "./contracts";
import { now } from "./db";
import { badRequest, conflict, errorMessage, notFound } from "./errors";
import { commitAll } from "./git";
import { newId } from "./ids";
import type { Jobs } from "./jobs";
import type { Labs } from "./labs";
import { projectMessagePage } from "./sessions";
import type { Subagents } from "./subagents";

interface Row {
  id: string;
  lab_id: string;
  title: string;
  objective: string;
  deliverable: string;
  context: string;
  context_revision: number;
  read_context_revision: number;
  plan: string;
  activity: string;
  summary: string;
  result: string;
  status: Campaign["status"];
  reason: Campaign["reason"];
  budget_usd: number;
  max_agents: number;
  cost: number;
  total_tokens: number;
  provider: string;
  model: string;
  thinking: string;
  session_id: string | null;
  session_cost: number;
  session_tokens: number;
  limit_resets_at: string | null;
  wake_requested: number;
  progress_version: number;
  notified_version: number;
  notification: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

interface Entry {
  opening?: Promise<ClaudeSession>;
  session?: ClaudeSession;
  turn?: Promise<void>;
  receiving: number;
  currentTool: string | null;
}

interface Options {
  labs: Labs;
  catalog: AgentCatalog;
  resources: AgentResources;
  subagents: Subagents;
  jobs: Jobs;
  createSession: (lab: Lab, campaign: Campaign) => Promise<ClaudeSession>;
  notify: (labId: string, text: string) => Promise<boolean>;
}

const terminal = (campaign: Campaign) =>
  campaign.status === "completed" || campaign.status === "ended";

function positive(value: number, name: string, integer = false): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isSafeInteger(value))
  )
    throw badRequest(
      `${name} must be a positive ${integer ? "integer" : "number"}`,
    );
}

/** Persistent campaign state; Claude Code owns turns, context, compaction
 *  and model retries. Spend is an estimate at API prices: on a Claude plan
 *  it measures consumption, while the plan's own limits are the real cap. */
export class Campaigns {
  private readonly entries = new Map<string, Entry>();
  private readonly controlling = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;

  constructor(
    private readonly db: Database,
    private readonly options: Options,
  ) {
    // Recover only active work. Pauses and decisions remain the researcher's choice.
    db.run("UPDATE campaigns SET wake_requested = 1 WHERE status = 'active'");
  }

  settings(): CampaignSettings {
    const row = this.db
      .query("SELECT * FROM campaign_settings WHERE id = 1")
      .get() as {
      budget_usd: number;
      max_agents: number;
      lab_max_agents: number;
    };
    return {
      budgetUsd: row.budget_usd,
      maxAgents: row.max_agents,
      labMaxAgents: row.lab_max_agents,
    };
  }

  configure(patch: Partial<CampaignSettings>): CampaignSettings {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw badRequest("Campaign settings are required");
    const next = { ...this.settings(), ...patch };
    positive(next.budgetUsd, "budgetUsd");
    positive(next.maxAgents, "maxAgents", true);
    positive(next.labMaxAgents, "labMaxAgents", true);
    this.db.run(
      "UPDATE campaign_settings SET budget_usd=?, max_agents=?, lab_max_agents=? WHERE id=1",
      [next.budgetUsd, next.maxAgents, next.labMaxAgents],
    );
    return this.settings();
  }

  private row(labId: string, id: string): Row {
    const row = this.db
      .query("SELECT * FROM campaigns WHERE lab_id=? AND id=?")
      .get(labId, id) as Row | null;
    if (!row) throw notFound(`Campaign ${id} not found`);
    return row;
  }

  private view(row: Row): Campaign {
    const entry = this.entries.get(row.id);
    return {
      id: row.id,
      labId: row.lab_id,
      title: row.title,
      objective: row.objective,
      deliverable: row.deliverable,
      context: row.context,
      plan: row.plan,
      activity: row.activity,
      summary: row.summary,
      result: row.result,
      status: row.status,
      reason: row.reason,
      budgetUsd: row.budget_usd,
      maxAgents: row.max_agents,
      usage: { total: row.total_tokens, cost: row.cost },
      provider: row.provider,
      model: row.model,
      thinking: row.thinking,
      sessionId: row.session_id,
      limitResetsAt: row.limit_resets_at,
      currentTool: entry?.currentTool ?? null,
      isWorking: !!entry?.turn,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at,
    };
  }

  get(labId: string, id: string): Campaign {
    return this.view(this.row(labId, id));
  }

  list(labId: string, activeOnly = false): Campaign[] {
    return (
      this.db
        .query(
          `SELECT * FROM campaigns WHERE lab_id=? ${activeOnly ? "AND status NOT IN ('completed','ended')" : ""} ORDER BY created_at DESC, id DESC`,
        )
        .all(labId) as Row[]
    ).map((row) => this.view(row));
  }

  start(lab: Lab, input: CreateCampaignInput): Campaign {
    if (this.closing) throw conflict("Server is shutting down");
    for (const key of ["title", "objective", "deliverable"] as const)
      if (typeof input?.[key] !== "string" || !input[key].trim())
        throw badRequest(`${key} is required`);
    if (input.context !== undefined && typeof input.context !== "string")
      throw badRequest("context must be a string");
    const profile = this.options.catalog.get("campaign-coordinator");
    if (!profile.provider || !profile.model)
      throw badRequest(
        "Choose a model for Campaign Coordinator in Settings → Agents before starting a campaign",
      );
    const settings = this.settings();
    const id = newId("campaign");
    const timestamp = now();
    this.db.run(
      "INSERT INTO campaigns (id, lab_id, title, objective, deliverable, context, budget_usd, max_agents, provider, model, thinking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        lab.id,
        input.title.trim(),
        input.objective.trim(),
        input.deliverable.trim(),
        input.context ?? "",
        settings.budgetUsd,
        settings.maxAgents,
        profile.provider,
        profile.model,
        profile.thinking,
        timestamp,
        timestamp,
      ],
    );
    return this.get(lab.id, id);
  }

  private dependencies(campaign: Campaign) {
    return {
      agents: this.options.subagents
        .list(campaign.labId)
        .filter((run) => run.campaignId === campaign.id),
      jobs: this.options.jobs
        .list(campaign.labId)
        .filter((job) => job.campaignId === campaign.id),
    };
  }

  /** Pico adds direction or an editorial handoff to the campaign's durable context. */
  message(labId: string, id: string, message: string): Campaign {
    if (this.closing) throw conflict("Server is shutting down");
    const campaign = this.get(labId, id);
    if (terminal(campaign)) throw conflict("This campaign is already closed");
    if (typeof message !== "string" || !message.trim())
      throw badRequest("message is required");
    this.db.run(
      "UPDATE campaigns SET context=?, context_revision=context_revision+1, updated_at=? WHERE id=?",
      [
        `${campaign.context}\n\n[Pico · ${now()}]\n${message.trim()}`.trim(),
        now(),
        id,
      ],
    );
    return this.get(labId, id);
  }

  async detail(
    labId: string,
    id: string,
    options: { before?: number; limit?: number } = {},
  ): Promise<CampaignDetail> {
    const campaign = this.get(labId, id);
    const messages =
      this.entries.get(id)?.session?.messages ??
      (campaign.sessionId
        ? await readTranscript(campaign.sessionId).catch(() => [])
        : []);
    return {
      campaign,
      ...this.dependencies(campaign),
      ...projectMessagePage(messages, options),
      usage: campaign.usage,
    };
  }

  private setState(
    campaign: Campaign,
    status: Campaign["status"],
    reason: Campaign["reason"],
    notify = false,
  ): void {
    this.db.run(
      "UPDATE campaigns SET status=?, reason=?, limit_resets_at=NULL, wake_requested=?, updated_at=?, ended_at=?, progress_version=progress_version+? WHERE id=?",
      [
        status,
        reason,
        status === "active" ? 1 : 0,
        now(),
        status === "ended" || status === "completed" ? now() : null,
        notify ? 1 : 0,
        campaign.id,
      ],
    );
    if (notify) this.captureMilestone(campaign.labId, campaign.id);
  }

  private captureMilestone(labId: string, id: string): void {
    const row = this.row(labId, id);
    const content = `[Pico] Campaign "${row.title}" (${row.id}), update ${row.progress_version}: ${row.status}${row.reason ? ` (${row.reason})` : ""}\nObjective: ${row.objective}\nDeliverable: ${row.deliverable}\n${row.result || row.summary || row.activity}\nEstimated model spend: US$ ${row.cost.toFixed(4)} / ${row.budget_usd}.\nCoordinate any requested editorial review from the main laboratory conversation.`;
    // Keep retries byte-identical even when in-flight usage and activity change.
    this.db.run("UPDATE campaigns SET notification=? WHERE id=?", [
      content,
      id,
    ]);
  }

  /** Guard every turn and tool call of the coordinator and its workers. */
  assertRunnable(labId: string, id: string, coordinator = false): void {
    if (this.closing) throw conflict("Server is shutting down");
    let campaign = this.get(labId, id);
    if (
      !terminal(campaign) &&
      campaign.status !== "paused" &&
      campaign.status !== "pending" &&
      campaign.usage.cost >= campaign.budgetUsd
    ) {
      this.setState(campaign, "pending", "budget", true);
      campaign = this.get(labId, id);
    }
    if (
      campaign.status !== "active" &&
      !(campaign.status === "waiting" && !coordinator)
    )
      throw conflict(
        `Campaign is ${campaign.status}${campaign.reason ? ` (${campaign.reason})` : ""}; wait for resumption`,
      );
  }

  private recordUsage(
    labId: string,
    id: string,
    total: number,
    cost: number,
  ): void {
    this.db.run(
      "UPDATE campaigns SET total_tokens=total_tokens+?, cost=cost+? WHERE id=? AND lab_id=?",
      [Math.max(0, total || 0), Math.max(0, cost || 0), id, labId],
    );
    const campaign = this.get(labId, id);
    if (
      (campaign.status === "active" || campaign.status === "waiting") &&
      campaign.usage.cost >= campaign.budgetUsd
    )
      this.setState(campaign, "pending", "budget", true);
  }

  /** Session hooks for the coordinator and its workers. Once the campaign
   *  cannot run, prompts are refused, tool calls denied and a turn ends after
   *  its tools instead of asking the model for another step. Every turn's
   *  consumption is recorded; Claude Code enforces the remaining balance.
   *  A plan limit reached by any of them stops the campaign's turns. */
  sessionOptions(
    labId: string,
    id: string,
    coordinator: boolean,
  ): Pick<
    ClaudeSessionOptions,
    | "onBeforePrompt"
    | "onBeforeTool"
    | "stopAfterTools"
    | "onUsage"
    | "onPlanLimit"
    | "maxBudgetUsd"
    | "usageBaseline"
  > {
    const row = this.row(labId, id);
    return {
      onBeforePrompt: () => this.assertRunnable(labId, id, coordinator),
      onBeforeTool: () => this.assertRunnable(labId, id, coordinator),
      stopAfterTools: () => {
        try {
          this.assertRunnable(labId, id, coordinator);
          return null;
        } catch (error) {
          return errorMessage(error);
        }
      },
      onUsage: ({ tokens, cost }) => {
        // The coordinator's totals are its baseline when it resumes.
        if (coordinator)
          this.db.run(
            "UPDATE campaigns SET session_cost=session_cost+?, session_tokens=session_tokens+? WHERE id=?",
            [cost, tokens, id],
          );
        this.recordUsage(labId, id, tokens, cost);
      },
      onPlanLimit: (resetsAt) => this.planLimitReached(labId, id, resetsAt),
      maxBudgetUsd: () => {
        const campaign = this.get(labId, id);
        return Math.max(0, campaign.budgetUsd - campaign.usage.cost);
      },
      ...(coordinator
        ? {
            usageBaseline: {
              cost: row.session_cost,
              tokens: row.session_tokens,
            },
          }
        : {}),
    };
  }

  /** A plan limit leaves the campaign pending for the researcher, who
   *  resumes it after the reset. No retry loop and never another way to
   *  authenticate. */
  private planLimitReached(labId: string, id: string, resetsAt?: number): void {
    const campaign = this.get(labId, id);
    if (campaign.status !== "active" && campaign.status !== "waiting") return;
    this.db.run("UPDATE campaigns SET summary=? WHERE id=?", [
      planLimitMessage(resetsAt),
      id,
    ]);
    this.setState(campaign, "pending", "rate_limit", true);
    this.db.run("UPDATE campaigns SET limit_resets_at=? WHERE id=?", [
      planLimitReset(resetsAt),
      id,
    ]);
  }

  capacity(labId: string, campaignId?: string | null): boolean {
    const running = this.db
      .query(
        "SELECT COUNT(*) AS total, COALESCE(SUM(campaign_id = ?), 0) AS owned FROM agent_runs WHERE lab_id = ? AND status = 'running'",
      )
      .get(campaignId ?? null, labId) as { total: number; owned: number };
    return (
      running.total < this.settings().labMaxAgents &&
      (!campaignId || running.owned < this.get(labId, campaignId).maxAgents)
    );
  }

  /** Called synchronously before inserting a run, shared by tools and HTTP. */
  admitAgent(labId: string, campaignId?: string | null): void {
    if (campaignId) this.assertRunnable(labId, campaignId, true);
    if (!this.capacity(labId, campaignId)) {
      if (campaignId)
        this.setState(this.get(labId, campaignId), "waiting", "capacity");
      throw conflict(
        "Specialist capacity is full. No assignment was queued. The campaign will continue when capacity is available.",
      );
    }
  }

  progress(labId: string, id: string, input: CampaignProgressInput): Campaign {
    this.assertRunnable(labId, id, true);
    const current = this.get(labId, id);
    for (const key of ["plan", "activity", "summary", "result"] as const)
      if (input[key] !== undefined && typeof input[key] !== "string")
        throw badRequest(`${key} must be a string`);
    const action = input.action;
    if (
      action &&
      ![
        "continue",
        "wait",
        "wait_for_pico",
        "needs_input",
        "complete",
      ].includes(action)
    )
      throw badRequest("Unknown campaign action");
    const { agents, jobs } = this.dependencies(current);
    if (action === "complete") {
      if (!(input.result ?? current.result).trim())
        throw badRequest("A campaign result is required to complete it");
      if (
        agents.some((run) => run.status === "running" || !run.notified) ||
        jobs.some((job) => job.status === "running" || !job.notified)
      )
        throw conflict(
          "Reconcile outstanding agents and jobs before completing the campaign",
        );
    }
    this.db.run(
      "UPDATE campaigns SET plan=?, activity=?, summary=?, result=?, updated_at=?, progress_version=progress_version+? WHERE id=?",
      [
        input.plan ?? current.plan,
        input.activity ?? current.activity,
        input.summary ?? current.summary,
        input.result ?? current.result,
        now(),
        input.summary && input.summary !== current.summary ? 1 : 0,
        id,
      ],
    );
    if (input.summary && input.summary !== current.summary)
      this.captureMilestone(labId, id);
    if (action === "wait") {
      const hasWork =
        agents.some((run) => run.status === "running" || !run.notified) ||
        jobs.some((job) => job.status === "running" || !job.notified);
      if (!hasWork)
        throw badRequest(
          "No outstanding work to wait for; choose continue, needs_input or complete",
        );
      this.setState(current, "waiting", "results");
    } else if (action === "wait_for_pico") {
      if (!(input.summary ?? current.summary).trim())
        throw badRequest("Explain the request to Pico in summary");
      this.setState(current, "waiting", "pico", true);
    } else if (action === "needs_input")
      this.setState(current, "pending", "input", true);
    else if (action === "complete")
      this.setState(current, "completed", null, true);
    else if (action === "continue")
      this.db.run("UPDATE campaigns SET wake_requested=1 WHERE id=?", [id]);
    return this.get(labId, id);
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { receiving: 0, currentTool: null };
      this.entries.set(id, entry);
    }
    return entry;
  }

  private open(campaign: Campaign): Promise<ClaudeSession> {
    const entry = this.entry(campaign.id);
    entry.opening ??= this.options
      .createSession(this.options.labs.get(campaign.labId), campaign)
      .then((session) => {
        entry.session = session;
        session.subscribe((event) => {
          if (session.sessionId)
            this.db.run(
              "UPDATE campaigns SET session_id=? WHERE id=? AND session_id IS NOT ?",
              [session.sessionId, campaign.id, session.sessionId],
            );
          if (event.type === "tool_execution_start")
            entry.currentTool = displayToolName(event.toolName);
          if (event.type === "tool_execution_end") entry.currentTool = null;
          if (
            event.type === "agent_start" &&
            (this.closing ||
              this.get(campaign.labId, campaign.id).status !== "active")
          )
            void session.abort();
        });
        return session;
      })
      .catch((error) => {
        entry.opening = undefined;
        throw error;
      });
    return entry.opening;
  }

  /** Receipt means the outcome was durably appended to its owning session. */
  async receive(
    labId: string,
    id: string,
    source: string,
    content: string,
  ): Promise<boolean> {
    if (this.closing) return false;
    const campaign = this.get(labId, id);
    if (terminal(campaign))
      return this.options.notify(
        labId,
        `[Pico] Campaign "${campaign.title}" (${id}), late outcome ${source}:\n${content}`,
      );
    const entry = this.entry(id);
    if (entry.turn) return false;
    entry.receiving++;
    try {
      const session = await this.open(campaign);
      if (this.closing) return false;
      if (
        !session.messages.some((entry) => {
          if (entry.type !== "user") return false;
          const note = parseNote(
            textOf((entry.message as { content?: unknown }).content),
          );
          return (
            note?.kind === "campaign-result" && note.details.source === source
          );
        })
      )
        await session.appendNote("campaign-result", content, { source });
      if (session.sessionId)
        this.db.run("UPDATE campaigns SET session_id=? WHERE id=?", [
          session.sessionId,
          id,
        ]);
      const current = this.get(labId, id);
      if (current.status === "waiting" || current.status === "active")
        this.setState(current, "active", null);
      return true;
    } catch (error) {
      const current = this.get(labId, id);
      if (
        !this.closing &&
        (current.status === "active" || current.status === "waiting")
      ) {
        this.db.run("UPDATE campaigns SET summary=? WHERE id=?", [
          errorMessage(error),
          id,
        ]);
        this.setState(current, "pending", "error", true);
      }
      throw error;
    } finally {
      entry.receiving--;
    }
  }

  async control(
    labId: string,
    id: string,
    input: CampaignControl,
  ): Promise<Campaign> {
    if (this.closing) throw conflict("Server is shutting down");
    const campaign = this.get(labId, id);
    if (terminal(campaign)) throw conflict("This campaign is already closed");
    if (this.controlling.has(id))
      throw conflict("A campaign control is already in progress");
    if (!input || !["pause", "resume", "end"].includes(input.action))
      throw badRequest("Unknown campaign control");
    const entry = this.entry(id);
    this.controlling.add(id);
    try {
      if (input.action === "resume") {
        if (campaign.status !== "paused" && campaign.status !== "pending")
          throw conflict("Only paused or pending campaigns can be resumed");
        if (input.addBudgetUsd !== undefined)
          positive(input.addBudgetUsd, "addBudgetUsd");
        if (input.maxAgents !== undefined)
          positive(input.maxAgents, "maxAgents", true);
        if (input.message !== undefined && typeof input.message !== "string")
          throw badRequest("message must be a string");
        const budget = campaign.budgetUsd + (input.addBudgetUsd ?? 0);
        if (!Number.isFinite(budget) || budget <= campaign.usage.cost)
          throw badRequest("Add enough budget to cover further work");
        await entry.session?.abort();
        await entry.turn;
        if (input.message?.trim()) {
          const session = await this.open(campaign);
          await session.appendNote("campaign-direction", input.message);
        }
        this.db.run(
          "UPDATE campaigns SET budget_usd=?, max_agents=? WHERE id=?",
          [budget, input.maxAgents ?? campaign.maxAgents, id],
        );
        this.setState(campaign, "active", null);
      } else {
        const runningJobs = this.dependencies(campaign).jobs.filter(
          (job) => job.status === "running",
        );
        if (
          input.action === "end" &&
          (runningJobs.length || input.jobs !== undefined) &&
          input.jobs !== "keep" &&
          input.jobs !== "stop"
        )
          throw badRequest(
            "Choose jobs: keep or stop when ending a campaign with running jobs",
          );
        this.setState(
          campaign,
          input.action === "pause" ? "paused" : "ended",
          "researcher",
          true,
        );
        await Promise.all([
          entry.session?.abort(),
          ...this.dependencies(campaign)
            .agents.filter((run) => run.status === "running")
            .map((run) => this.options.subagents.stop(labId, run.id)),
          ...(input.action === "end" && input.jobs === "stop"
            ? runningJobs.map((job) => this.options.jobs.stop(labId, job.id))
            : []),
        ]);
        await entry.turn;
      }
      return this.get(labId, id);
    } finally {
      this.controlling.delete(id);
    }
  }

  private async work(campaign: Campaign, entry: Entry): Promise<void> {
    this.db.run("UPDATE campaigns SET wake_requested=0 WHERE id=?", [
      campaign.id,
    ]);
    try {
      const session = await this.open(campaign);
      this.assertRunnable(campaign.labId, campaign.id, true);
      this.db.run(
        "UPDATE campaigns SET read_context_revision=context_revision WHERE id=?",
        [campaign.id],
      );
      await session.prompt(
        this.options.resources.prompt("campaign-wake").content,
      );
      const current = this.get(campaign.labId, campaign.id);
      const last = session.lastResult;
      if (!this.closing && current.status === "active" && last && !last.ok) {
        this.db.run("UPDATE campaigns SET summary=? WHERE id=?", [
          last.text || "The coordinator turn was interrupted",
          campaign.id,
        ]);
        this.setState(current, "pending", "error", true);
        return;
      }
      if (
        !this.closing &&
        current.status === "active" &&
        !this.row(campaign.labId, campaign.id).wake_requested
      ) {
        const row = this.row(campaign.labId, campaign.id);
        if (row.context_revision > row.read_context_revision) {
          this.db.run("UPDATE campaigns SET wake_requested=1 WHERE id=?", [
            campaign.id,
          ]);
          return;
        }
        const { agents, jobs } = this.dependencies(current);
        const hasWork =
          agents.some((run) => run.status === "running" || !run.notified) ||
          jobs.some((job) => job.status === "running" || !job.notified);
        if (hasWork) this.setState(current, "waiting", "results");
        else {
          const summary = last?.text ?? "";
          if (summary)
            this.db.run("UPDATE campaigns SET summary=? WHERE id=?", [
              summary,
              campaign.id,
            ]);
          this.setState(current, "pending", "input", true);
        }
      }
    } catch (error) {
      const current = this.get(campaign.labId, campaign.id);
      if (!this.closing && current.status === "active") {
        this.db.run("UPDATE campaigns SET summary=? WHERE id=?", [
          errorMessage(error),
          campaign.id,
        ]);
        this.setState(current, "pending", "error", true);
      }
    } finally {
      entry.currentTool = null;
      await commitAll(
        this.options.labs.get(campaign.labId).path,
        `Pico: campaign ${campaign.id} progress`,
      ).catch(() => {});
      if (!this.closing && terminal(this.get(campaign.labId, campaign.id))) {
        await entry.session?.dispose().catch(() => {});
        this.entries.delete(campaign.id);
      }
    }
  }

  private async tick(): Promise<void> {
    const rows = this.db
      .query(
        "SELECT * FROM campaigns WHERE status IN ('active', 'waiting') OR progress_version > notified_version ORDER BY updated_at, id",
      )
      .all() as Row[];
    for (const row of rows) {
      if (this.closing) return;
      let campaign = this.get(row.lab_id, row.id);
      const entry = this.entry(row.id);
      if (!entry.turn && !entry.receiving && !this.controlling.has(row.id)) {
        if (campaign.status === "waiting") {
          const { agents, jobs } = this.dependencies(campaign);
          const undelivered =
            agents.some((run) => run.status !== "running" && !run.notified) ||
            jobs.some((job) => job.status !== "running" && !job.notified);
          const ready =
            row.context_revision > row.read_context_revision ||
            (campaign.reason === "capacity"
              ? this.capacity(campaign.labId, campaign.id)
              : campaign.reason !== "pico" &&
                !agents.some((run) => run.status === "running") &&
                !jobs.some((job) => job.status === "running"));
          if (ready && !undelivered) {
            this.setState(campaign, "active", null);
            campaign = this.get(row.lab_id, row.id);
          }
        }
        if (
          campaign.status === "active" &&
          (this.row(row.lab_id, row.id).wake_requested ||
            row.context_revision > row.read_context_revision)
        ) {
          // Do not overtake result delivery after a restart or previous working turn.
          const { agents, jobs } = this.dependencies(campaign);
          const undelivered =
            agents.some((run) => run.status !== "running" && !run.notified) ||
            jobs.some((job) => job.status !== "running" && !job.notified);
          if (!undelivered)
            entry.turn = this.work(campaign, entry).finally(() => {
              entry.turn = undefined;
            });
        }
      }
      const latest = this.row(row.lab_id, row.id);
      if (latest.progress_version > latest.notified_version) {
        try {
          if (await this.options.notify(row.lab_id, latest.notification))
            this.db.run(
              "UPDATE campaigns SET notified_version=MAX(notified_version, ?) WHERE id=?",
              [latest.progress_version, row.id],
            );
        } catch {
          /* Retry delivery while the durable milestone remains pending. */
        }
      }
    }
  }

  poll(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.polling ??= this.tick().finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  startPolling(): void {
    this.timer = setInterval(() => void this.poll().catch(() => {}), 1000);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        const session = await entry.opening?.catch(() => undefined);
        await session?.abort();
        await entry.turn;
        await session?.dispose().catch(() => {});
      }),
    );
    await this.polling;
    this.db.run("UPDATE campaigns SET wake_requested=1 WHERE status='active'");
  }
}
