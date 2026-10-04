import type { Database } from "bun:sqlite";
import type { AgentCatalog } from "./agent-catalog";
import {
  type ClaudeSession,
  displayToolName,
  readTranscript,
  textOf,
} from "./claude-runtime";
import type {
  AgentDefinition,
  AgentRun,
  AgentRunDetail,
  AgentRunStatus,
  Lab,
} from "./contracts";
import { now } from "./db";
import type { Editorial } from "./editorial";
import { badRequest, conflict, errorMessage, notFound } from "./errors";
import { commitAll } from "./git";
import { newId } from "./ids";
import { projectMessagePage } from "./sessions";

interface Row {
  id: string;
  lab_id: string;
  campaign_id: string | null;
  agent_id: string;
  name: string;
  task: string;
  label: string | null;
  status: AgentRunStatus;
  provider: string;
  model: string;
  thinking: string;
  result: string;
  error: string | null;
  session_id: string | null;
  total_tokens: number;
  cost: number;
  notified: number;
  created_at: string;
  ended_at: string | null;
}

interface Active {
  done: Promise<void>;
  session?: ClaudeSession;
  stop?: "stopped" | "interrupted";
  currentTool: string | null;
  streamingText: string;
}

interface Options {
  catalog: AgentCatalog;
  editorial: Editorial;
  beforeStart?: (labId: string, campaignId?: string | null) => void;
  createSession: (
    lab: Lab,
    run: AgentRun,
    definition: AgentDefinition,
  ) => Promise<ClaudeSession>;
  /** True only once the result is in the coordinator's session, not merely queued. */
  onFinished: (run: AgentRun) => Promise<boolean>;
}

/** Each spawn owns one Claude Code session; completed runs remain in SQLite
 *  and their conversation in Pico's Claude profile. */
export class Subagents {
  private readonly active = new Map<string, Active>();
  private timer?: ReturnType<typeof setInterval>;
  private notification?: Promise<void>;
  private closing = false;

  constructor(
    private readonly db: Database,
    private readonly options: Options,
  ) {
    // Agent turns run in this server, unlike detached shell jobs. Never silently resume them.
    db.run(
      "UPDATE agent_runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'",
      [now()],
    );
  }

  private view(row: Row): AgentRun {
    const active = this.active.get(row.id);
    return {
      id: row.id,
      labId: row.lab_id,
      campaignId: row.campaign_id,
      agentId: row.agent_id,
      name: row.name,
      task: row.task,
      label: row.label ?? null,
      status: row.status,
      provider: row.provider,
      model: row.model,
      thinking: row.thinking,
      result: row.result,
      error: row.error,
      sessionId: row.session_id,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      notified: row.notified === 1,
      usage: { total: row.total_tokens, cost: row.cost },
      currentTool: active?.currentTool ?? null,
      streamingText: active?.streamingText ?? "",
    };
  }

  get(labId: string, id: string): AgentRun {
    const row = this.db
      .query("SELECT * FROM agent_runs WHERE lab_id = ? AND id = ?")
      .get(labId, id) as Row | null;
    if (!row) throw notFound(`Agent run ${id} not found`);
    return this.view(row);
  }

  list(labId: string, activeOnly = false): AgentRun[] {
    return (
      this.db
        .query(
          `SELECT * FROM agent_runs WHERE lab_id = ? ${activeOnly ? "AND (status = 'running' OR notified = 0)" : ""} ORDER BY created_at DESC, id DESC`,
        )
        .all(labId) as Row[]
    ).map((row) => this.view(row));
  }

  start(
    lab: Lab,
    agentId: string,
    task: string,
    campaignId: string | null = null,
    label: string | null = null,
  ): AgentRun {
    if (this.closing) throw conflict("Server is shutting down");
    if (typeof task !== "string" || !task.trim())
      throw badRequest("task is required");
    if (typeof agentId !== "string" || !agentId)
      throw badRequest("agentId is required");
    if (agentId === "campaign-coordinator")
      throw badRequest(
        "Use mcp__pico__start_campaign for the persistent campaign coordinator",
      );
    if (campaignId && agentId === "research-editor")
      throw badRequest(
        "Include an editorial request in mcp__pico__campaign_progress summary; Pico coordinates the shared Research Editor",
      );
    if (agentId === "research-editor") {
      const current = this.list(lab.id).find(
        (run) => run.agentId === agentId && run.status === "running",
      );
      if (current)
        throw conflict(
          `Editor ${current.id} is already running in this laboratory; consolidate further changes for the next review`,
        );
    }
    const definition = this.options.catalog.get(agentId);
    if (!definition.provider || !definition.model)
      throw badRequest(
        `Choose a model for ${definition.name} in Settings → Agents before starting it`,
      );
    const id = newId("run");
    this.options.beforeStart?.(lab.id, campaignId);
    this.db.run(
      "INSERT INTO agent_runs (id, lab_id, agent_id, name, task, status, provider, model, thinking, created_at, campaign_id, label) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)",
      [
        id,
        lab.id,
        agentId,
        definition.name,
        task.trim(),
        definition.provider,
        definition.model,
        definition.thinking,
        now(),
        campaignId,
        typeof label === "string" && label.trim()
          ? label.trim().slice(0, 60)
          : null,
      ],
    );
    if (agentId === "research-editor") this.options.editorial.begin(lab, id);
    const run = this.get(lab.id, id);
    const active: Active = {
      done: Promise.resolve(),
      currentTool: null,
      streamingText: "",
    };
    this.active.set(id, active);
    active.done = this.run(lab, run, definition, active);
    return run;
  }

  private async run(
    lab: Lab,
    run: AgentRun,
    definition: AgentDefinition,
    active: Active,
  ): Promise<void> {
    let result = "";
    let error: string | null = null;
    let status: AgentRunStatus = "completed";
    try {
      if (!active.stop) {
        const session = await this.options.createSession(lab, run, definition);
        active.session = session;
        this.db.run(
          "UPDATE agent_runs SET provider = 'anthropic', model = ?, thinking = ? WHERE id = ?",
          [
            session.model ?? run.model,
            session.thinkingLevel ?? run.thinking,
            run.id,
          ],
        );
        session.subscribe((event) => {
          if (event.type === "agent_start" && active.stop) void session.abort();
          if (event.type === "tool_execution_start")
            active.currentTool = displayToolName(event.toolName);
          if (event.type === "tool_execution_end") active.currentTool = null;
          if (event.type === "text_delta") active.streamingText += event.delta;
          if (event.type === "message_end") active.streamingText = "";
          if (event.type === "agent_end" && event.result)
            this.db.run(
              "UPDATE agent_runs SET total_tokens = total_tokens + ?, cost = cost + ? WHERE id = ?",
              [event.result.tokens, event.result.cost, run.id],
            );
          if (session.sessionId)
            this.db.run(
              "UPDATE agent_runs SET session_id = ? WHERE id = ? AND session_id IS NULL",
              [session.sessionId, run.id],
            );
        });
        if (!active.stop) await session.prompt(run.task);
        const reply = session.lastResult;
        if (reply) {
          result = reply.ok ? reply.text : lastAssistantText(session);
          if (!reply.ok) {
            status = "failed";
            error = reply.text || "The model returned an error";
          }
        }
      }
    } catch (cause) {
      status = "failed";
      error = errorMessage(cause);
    } finally {
      await active.session?.dispose().catch(() => {});
      active.currentTool = null;
      active.streamingText = "";
      await commitAll(lab.path, `Pico: ${run.name} (${run.id}) finished`).catch(
        () => {},
      );
      this.db.run(
        "UPDATE agent_runs SET status = ?, result = ?, error = ?, ended_at = ? WHERE id = ?",
        [
          active.stop ?? status,
          result,
          active.stop ? null : error,
          now(),
          run.id,
        ],
      );
      this.active.delete(run.id);
      if (!this.closing) void this.notifyFinished();
    }
  }

  async detail(
    labId: string,
    id: string,
    options: { before?: number; limit?: number } = {},
  ): Promise<AgentRunDetail> {
    const run = this.get(labId, id);
    const session = this.active.get(id)?.session;
    const messages =
      session?.messages ??
      (run.sessionId
        ? await readTranscript(run.sessionId).catch(() => [])
        : []);
    return { run, ...projectMessagePage(messages, options), usage: run.usage };
  }

  async stop(labId: string, id: string): Promise<AgentRun> {
    this.get(labId, id);
    const active = this.active.get(id);
    if (active) {
      active.stop = "stopped";
      await active.session?.abort();
      await active.done;
    }
    return this.get(labId, id);
  }

  startPolling(): void {
    this.timer = setInterval(() => void this.notifyFinished(), 1000);
    this.timer.unref();
  }

  private notifyFinished(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.notification ??= this.deliver().finally(() => {
      this.notification = undefined;
    });
    return this.notification;
  }

  private async deliver(): Promise<void> {
    const rows = this.db
      .query(
        "SELECT * FROM agent_runs WHERE notified = 0 AND status != 'running' ORDER BY ended_at",
      )
      .all() as Row[];
    for (const row of rows) {
      if (this.closing) return;
      try {
        if (await this.options.onFinished(this.view(row)))
          this.db.run("UPDATE agent_runs SET notified = 1 WHERE id = ?", [
            row.id,
          ]);
      } catch {
        // The sidebar keeps the run visible until Pico actually receives its outcome.
      }
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.active.values()].map(async (active) => {
        active.stop = "interrupted";
        await active.session?.abort();
        await active.done;
      }),
    );
    await this.notification;
  }
}

/** Partial work survives a failed turn; keep what the agent last said. */
function lastAssistantText(session: ClaudeSession): string {
  for (const entry of [...session.messages].reverse())
    if (entry.type === "assistant") {
      const text = textOf((entry.message as { content?: unknown }).content);
      if (text) return text;
    }
  return "";
}

export function subagentNotification(run: AgentRun): string {
  return `[Pico] Subagent "${run.name}" (${run.id}) finished: ${run.status}\nTask: ${run.task}\n${run.error ? `Error: ${run.error}\n` : ""}${run.result || "No final report. Consult mcp__pico__list_subagents with this run id for the conversation."}`;
}
