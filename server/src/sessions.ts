import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import type { Campaigns } from "./campaigns";
import { claudeEnv, claudeModels } from "./claude-auth";
import {
  ClaudeSession,
  type ClaudeSessionEvent,
  type ClaudeSessionOptions,
  displayToolName,
  parseNote,
  planLimitMessage,
  type TranscriptMessage,
  textOf,
} from "./claude-runtime";
import type { PicoPaths } from "./config";
import type {
  AgentDefinition,
  AgentRun,
  Campaign,
  ChatMessagePage,
  ModelSummary,
  SessionEvent,
  SessionState,
  ThinkingLevel,
  UiMessage,
} from "./contracts";
import type { Editorial } from "./editorial";
import { badRequest, errorMessage } from "./errors";
import { commitAll } from "./git";
import type { Jobs } from "./jobs";
import type { Lab, Labs } from "./labs";
import type { Records } from "./records";
import type { Subagents } from "./subagents";
import { picoMcpServer } from "./tools";

export type { ModelSummary, SessionEvent, SessionState, UiMessage };

interface Entry {
  lab: Lab;
  session: ClaudeSession;
  /** The conversation id stored for the laboratory. */
  savedSessionId: string | null;
  listeners: Set<(event: SessionEvent) => void>;
  lastError: string | null;
  streamingText: string;
}

export interface SessionDependencies {
  paths: PicoPaths;
  labs: Labs;
  records: Records;
  jobs: Jobs;
  subagents: Subagents;
  catalog: AgentCatalog;
  resources: AgentResources;
  editorial: Editorial;
  campaigns: Campaigns;
}

type Content = { type?: string; [key: string]: unknown }[];
type UiDraft = Omit<UiMessage, "id">;

const timeOf = (entry: TranscriptMessage): number =>
  entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0;

const contentText = (part: Record<string, unknown>): string =>
  typeof part.content === "string"
    ? part.content
    : Array.isArray(part.content)
      ? part.content
          .map((item: { type?: string; text?: string }) =>
            item?.type === "text" ? (item.text ?? "") : "[image]",
          )
          .join("\n")
      : "";

/** Flattens a Claude Code transcript into the messages the UI shows. One API
 *  response is stored as several entries (one per block) sharing message.id;
 *  they become one assistant message with its usage counted once. */
function draftMessages(entries: readonly TranscriptMessage[]): UiDraft[] {
  const result: UiDraft[] = [];
  const toolNames = new Map<string, string>();
  let assistant: { id: string; draft: UiDraft } | undefined;
  for (const entry of entries) {
    const message = entry.message as {
      id?: string;
      content?: unknown;
      model?: string;
      stop_reason?: string | null;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      subtype?: string;
    } | null;
    if (!message) continue;
    const timestamp = timeOf(entry);
    if (entry.type === "assistant") {
      const content = (
        Array.isArray(message.content) ? message.content : []
      ) as Content;
      const id = message.id ?? entry.uuid;
      if (assistant?.id !== id) {
        assistant = {
          id,
          draft: {
            role: "assistant",
            text: "",
            model: `anthropic/${message.model ?? "unknown"}`,
            timestamp,
          },
        };
        result.push(assistant.draft);
      }
      const draft = assistant.draft;
      for (const part of content) {
        if (part.type === "text") draft.text += String(part.text ?? "");
        else if (part.type === "thinking" && part.thinking)
          draft.thinking = [draft.thinking, String(part.thinking)]
            .filter(Boolean)
            .join("\n");
        else if (part.type === "tool_use") {
          toolNames.set(String(part.id), String(part.name));
          draft.toolCalls = [
            ...(draft.toolCalls ?? []),
            {
              id: String(part.id),
              name: displayToolName(String(part.name)),
              arguments: part.input,
            },
          ];
        }
      }
      if (message.stop_reason) draft.stopReason = message.stop_reason;
      const usage = message.usage;
      if (usage) {
        const input =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        const output = usage.output_tokens ?? 0;
        draft.usage = { input, output, total: input + output, cost: 0 };
      }
      continue;
    }
    assistant = undefined;
    if (entry.type === "system") {
      if (message.subtype === "compact_boundary")
        result.push({
          role: "system",
          kind: "compaction",
          text: "Context compacted",
          timestamp,
        });
      continue;
    }
    if (typeof message.content === "string") {
      const note = parseNote(message.content);
      result.push(
        note
          ? { role: "system", kind: note.kind, text: note.content, timestamp }
          : { role: "user", text: message.content, timestamp },
      );
      continue;
    }
    const content = (
      Array.isArray(message.content) ? message.content : []
    ) as Content;
    const texts: string[] = [];
    for (const part of content) {
      if (part.type === "tool_result") {
        const name = toolNames.get(String(part.tool_use_id)) ?? "";
        result.push({
          role: "tool",
          text: contentText(part),
          toolCallId: String(part.tool_use_id),
          toolName: displayToolName(name),
          isError: part.is_error === true,
          timestamp,
        });
      } else if (part.type === "text") texts.push(String(part.text ?? ""));
      else if (part.type === "image") texts.push("[image]");
    }
    if (texts.length)
      result.push({ role: "user", text: texts.join("\n"), timestamp });
  }
  return result;
}

export function projectMessages(
  entries: readonly TranscriptMessage[],
): UiMessage[] {
  return draftMessages(entries).map((draft, index) => ({
    id: `m-${index}`,
    ...draft,
  }));
}

/** Paginate only the UI projection; the Claude session keeps its context. */
export function projectMessagePage(
  entries: readonly TranscriptMessage[],
  options: { before?: number; limit?: number } = {},
): ChatMessagePage {
  const messages = projectMessages(entries);
  const limit = options.limit ?? 50;
  const before = options.before ?? messages.length;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw badRequest("Invalid message limit");
  if (!Number.isSafeInteger(before) || before < 0)
    throw badRequest("Invalid message cursor");
  const end = Math.min(before, messages.length);
  const start = Math.max(0, end - Math.min(limit, 100));
  const usage = { total: 0, cost: 0 };
  for (const message of messages)
    if (message.usage) usage.total += message.usage.total;
  return {
    messages: messages.slice(start, end),
    before: start > 0 ? start : null,
    usage,
  };
}

/** True when a user message of the conversation holds this text. Claude
 *  Code joins queued messages sent close together into one user message. */
export function hasUserText(
  entries: readonly TranscriptMessage[],
  text: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.type === "user" &&
      textOf((entry.message as { content?: unknown } | null)?.content).includes(
        text,
      ),
  );
}

export class LabSessions {
  private catalogModels?: Promise<ModelSummary[]>;
  private readonly entries = new Map<string, Promise<Entry>>();

  constructor(private readonly deps: SessionDependencies) {}

  /** Claude models offered by the bundled Claude Code, read once. */
  models(): Promise<ModelSummary[]> {
    this.catalogModels ??= claudeModels(this.deps.paths.claudeConfigDir);
    return this.catalogModels;
  }

  private async model(selection: {
    provider?: string | null;
    model?: string | null;
  }): Promise<string | undefined> {
    if (!selection.model) return undefined;
    const available = await this.models();
    if (
      selection.provider !== "anthropic" ||
      !available.some((model) => model.id === selection.model)
    )
      throw badRequest(
        `Model ${selection.provider}/${selection.model} is not available`,
      );
    return selection.model;
  }

  private open(labId: string): Promise<Entry> {
    let entry = this.entries.get(labId);
    if (!entry) {
      entry = this.create(labId).catch((error) => {
        this.entries.delete(labId);
        throw error;
      });
      this.entries.set(labId, entry);
    }
    return entry;
  }

  private async create(labId: string): Promise<Entry> {
    const lab = this.deps.labs.get(labId);
    const session = await this.createSession(lab);
    const entry: Entry = {
      lab,
      session,
      savedSessionId: this.deps.labs.sessionId(lab.id),
      listeners: new Set(),
      lastError: null,
      streamingText: "",
    };
    session.subscribe((event) => this.handle(entry, event));
    return entry;
  }

  /** The coordinator and its workers use the same setup, with separate context. */
  async createSession(
    lab: Lab,
    worker?: { run: AgentRun; definition: AgentDefinition },
    campaign?: Campaign,
  ): Promise<ClaudeSession> {
    const { resources, labs } = this.deps;
    // Worker instructions and primary skill stay fixed for this spawn; lab context stays fresh.
    const definition =
      worker?.definition ??
      (campaign ? this.deps.catalog.get("campaign-coordinator") : undefined);
    const campaignId = campaign?.id ?? worker?.run.campaignId;
    const skillCatalog = definition ? resources.skills() : undefined;
    const primarySkill = skillCatalog?.find(
      (skill) => skill.id === definition?.skillId,
    );
    const workerPrompt = definition
      ? resources.systemPrompt(lab, definition)
      : undefined;
    const systemPrompt = () =>
      workerPrompt ??
      `${resources.systemPrompt(labs.get(lab.id))}\n\n${resources.prompt("campaign-dispatch").content}`;
    // Database documents reach the model with every prompt, as fresh context.
    const context = () => {
      const sections: [string, string][] = [];
      const current = labs.context(lab.id);
      sections.push([
        `Laboratory context (database, revision ${current.revision})`,
        current.content,
      ]);
      if (primarySkill)
        sections.push([
          `Primary skill: ${primarySkill.id} (database)`,
          primarySkill.instructions,
        ]);
      if (campaignId)
        sections.push([
          "Campaign state (database)",
          `${worker ? "Your assignment belongs to this campaign; results and jobs go to its coordinator.\n" : ""}${JSON.stringify(this.deps.campaigns.get(lab.id, campaignId))}`,
        ]);
      if (!worker || worker.definition.id === "research-editor")
        sections.push([
          "Pico editorial status (computed)",
          this.deps.editorial.promptContext(lab),
        ]);
      return sections
        .map(([title, content]) => `# ${title}\n\n${content}`)
        .join("\n\n");
    };
    const selected = worker?.run ?? campaign;
    const model = await this.model(selected ?? lab);
    const options: ClaudeSessionOptions = {
      cwd: lab.path,
      model,
      thinkingLevel: (selected?.thinking ?? lab.thinking) as ThinkingLevel,
      systemPrompt,
      context,
      env: claudeEnv(this.deps.paths.claudeConfigDir),
      mcpServers: () => ({
        pico: picoMcpServer({
          lab,
          labs,
          resources,
          skillCatalog,
          records: this.deps.records,
          jobs: this.deps.jobs,
          editorial: this.deps.editorial,
          editorialRunId:
            worker?.definition.id === "research-editor"
              ? worker.run.id
              : undefined,
          subagents: worker ? undefined : this.deps.subagents,
          catalog: worker ? undefined : this.deps.catalog,
          campaigns: this.deps.campaigns,
          campaignId,
          campaignCoordinator: !!campaign,
          author: worker
            ? `subagent:${worker.run.id}`
            : campaign
              ? `campaign:${campaign.id}`
              : "pico",
        }),
      }),
      resume: worker
        ? null
        : campaign
          ? campaign.sessionId
          : this.deps.labs.sessionId(lab.id),
      ...(campaignId
        ? this.deps.campaigns.sessionOptions(lab.id, campaignId, !!campaign)
        : {}),
    };
    return ClaudeSession.create(options);
  }

  private emit(entry: Entry, event: SessionEvent): void {
    for (const listener of entry.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken listener never stops the session */
      }
    }
  }

  private fail(entry: Entry, message: string): void {
    entry.lastError = message;
    this.emit(entry, { type: "error", message });
  }

  /** The laboratory resumes this conversation after a restart, including
   *  one whose first turn was cut short. */
  private remember(entry: Entry): void {
    const { session, lab } = entry;
    if (session.sessionId && session.sessionId !== entry.savedSessionId) {
      this.deps.labs.setSessionId(lab.id, session.sessionId);
      entry.savedSessionId = session.sessionId;
    }
  }

  private handle(entry: Entry, event: ClaudeSessionEvent): void {
    switch (event.type) {
      case "text_delta":
        entry.streamingText += event.delta;
        this.emit(entry, event);
        break;
      case "thinking_delta":
        this.emit(entry, event);
        break;
      case "message_end":
        entry.streamingText = "";
        this.remember(entry);
        if (event.error) this.fail(entry, event.error);
        this.emit(entry, { type: "message_end" });
        break;
      case "tool_execution_start":
        this.emit(entry, {
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: displayToolName(event.toolName),
          args: event.args,
        });
        break;
      case "tool_execution_end":
        this.emit(entry, {
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: displayToolName(event.toolName),
          isError: event.isError,
        });
        break;
      case "agent_start":
        entry.lastError = null;
        this.emit(entry, { type: "agent_start" });
        break;
      case "agent_end":
        entry.streamingText = "";
        this.remember(entry);
        if (event.result && !event.result.ok && !entry.lastError)
          this.fail(entry, event.result.text || "The model returned an error");
        this.emit(entry, { type: "agent_end" });
        void commitAll(entry.lab.path, "Pico: turn finished").catch(() => {});
        break;
      case "queue_update":
        this.emit(entry, {
          type: "queue",
          steering: event.steering,
          followUp: event.followUp,
        });
        break;
      case "compaction_start":
        this.emit(entry, { type: "compaction", phase: "start" });
        break;
      case "compaction_end":
        this.emit(entry, { type: "compaction", phase: "end" });
        break;
      case "retry":
        this.emit(entry, event);
        break;
      case "rate_limit":
        if (event.info.status === "rejected")
          this.fail(entry, planLimitMessage(event.info.resetsAt));
        break;
      case "error":
        this.fail(entry, event.message);
        break;
    }
  }

  /** Sends a researcher message: a prompt when idle, a steering message while working. */
  async send(
    labId: string,
    text: string,
  ): Promise<{ mode: "prompt" | "steer" }> {
    const message = text.trim();
    if (!message) throw badRequest("message is required");
    const entry = await this.open(labId);
    if (entry.session.isStreaming) {
      await entry.session.steer(message);
      return { mode: "steer" };
    }
    this.prompt(entry, message);
    return { mode: "prompt" };
  }

  /** Delivers a system-originated message such as a job outcome. While the
   *  model is working, it joins the running turn after the current tool
   *  instead of waiting for the whole turn to end. */
  async notify(labId: string, text: string): Promise<void> {
    const entry = await this.open(labId);
    if (entry.session.isStreaming) {
      await entry.session.steer(text);
      return;
    }
    this.prompt(entry, text);
  }

  /** Receipt is the outcome in the session's transcript, once Claude Code has
   *  taken it. A message sent or queued stays visible in the sidebar until
   *  then; Claude Code keeps it across an interrupted turn, so it is never
   *  sent twice. */
  async deliverSubagentResult(labId: string, text: string): Promise<boolean> {
    const entry = await this.open(labId);
    const { session } = entry;
    if (hasUserText(session.recorded, text)) return true;
    const queue = session.queue;
    if (
      hasUserText(session.messages, text) ||
      queue.steering.includes(text) ||
      queue.followUp.includes(text)
    )
      return false;
    await this.notify(labId, text);
    return hasUserText(session.recorded, text);
  }

  private prompt(entry: Entry, text: string): void {
    entry.lastError = null;
    entry.session.prompt(text).catch((error: unknown) => {
      this.fail(entry, errorMessage(error));
    });
  }

  async abort(labId: string): Promise<void> {
    const entry = await this.open(labId);
    await entry.session.abort();
  }

  async messages(labId: string): Promise<UiMessage[]> {
    const entry = await this.open(labId);
    return projectMessages(entry.session.messages);
  }

  async messagePage(
    labId: string,
    options: { before?: number; limit?: number } = {},
  ): Promise<ChatMessagePage> {
    const entry = await this.open(labId);
    const page = projectMessagePage(entry.session.messages, options);
    // Claude Code reports cost per conversation, not per message.
    return {
      ...page,
      usage: { ...page.usage, cost: entry.session.usage.cost },
    };
  }

  async state(labId: string): Promise<SessionState> {
    const entry = await this.open(labId);
    const { session } = entry;
    const model = session.model ?? entry.lab.model;
    const name = model
      ? ((await this.models()).find((item) => item.id === model)?.name ?? model)
      : null;
    return {
      labId,
      streaming: session.isStreaming,
      model: model && name ? { provider: "anthropic", id: model, name } : null,
      thinking: session.thinkingLevel ?? entry.lab.thinking,
      queue: session.queue,
      lastError: entry.lastError,
      sessionId: session.sessionId,
      streamingText: entry.streamingText,
    };
  }

  async subscribe(
    labId: string,
    listener: (event: SessionEvent) => void,
  ): Promise<() => void> {
    const entry = await this.open(labId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  async setModel(
    labId: string,
    selection: {
      provider?: string | null;
      model?: string | null;
      thinking?: string;
    },
  ): Promise<void> {
    const pending = this.entries.get(labId);
    if (!pending) return;
    const entry = await pending;
    entry.lab = this.deps.labs.get(labId);
    const model = await this.model(selection);
    if (model) await entry.session.setModel(model);
    if (selection.thinking)
      entry.session.setThinkingLevel(selection.thinking as ThinkingLevel);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (pending) => {
        try {
          const entry = await pending;
          await entry.session.abort();
          await entry.session.dispose();
        } catch {
          /* closing is best effort */
        }
      }),
    );
    this.entries.clear();
  }
}
