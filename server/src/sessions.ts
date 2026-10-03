import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import type { Campaigns } from "./campaigns";
import type { PicoPaths } from "./config";
import type { Editorial } from "./editorial";
import { badRequest, errorMessage } from "./errors";
import { commitAll } from "./git";
import type { Jobs } from "./jobs";
import type { Lab, Labs } from "./labs";
import type { Records } from "./records";
import type { Subagents } from "./subagents";
import { createPicoTools } from "./tools";

const builtinTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const webTools = ["web_search", "fetch_content", "get_search_content"];

import type {
  AgentDefinition,
  AgentRun,
  Campaign,
  ChatMessagePage,
  ModelSummary,
  SessionEvent,
  SessionState,
  UiMessage,
} from "./contracts";

export type { ModelSummary, SessionEvent, SessionState, UiMessage };

interface Entry {
  lab: Lab;
  session: AgentSession;
  listeners: Set<(event: SessionEvent) => void>;
  lastError: string | null;
  queue: { steering: string[]; followUp: string[] };
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

function webAccessExtension(): string {
  return join(
    dirname(fileURLToPath(import.meta.resolve("pi-web-access/package.json"))),
    "dist",
  );
}

export function projectMessages(
  messages: readonly AgentMessage[],
  offset = 0,
): UiMessage[] {
  const result: UiMessage[] = [];
  messages.forEach((message, index) => {
    const id = `m-${offset + index}`;
    const timestamp = message.timestamp;
    switch (message.role) {
      case "user": {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => (part.type === "text" ? part.text : "[image]"))
                .join("\n");
        result.push({ id, role: "user", text, timestamp });
        break;
      }
      case "assistant": {
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        const thinking = message.content
          .filter((part) => part.type === "thinking")
          .map((part) => part.thinking)
          .join("\n");
        const toolCalls = message.content
          .filter((part) => part.type === "toolCall")
          .map((part) => ({
            id: part.id,
            name: part.name,
            arguments: part.arguments,
          }));
        result.push({
          id,
          role: "assistant",
          text,
          ...(thinking ? { thinking } : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
          model: `${message.provider}/${message.model}`,
          stopReason: message.stopReason,
          ...(message.errorMessage
            ? { errorMessage: message.errorMessage }
            : {}),
          usage: {
            input: message.usage.input,
            output: message.usage.output,
            total: message.usage.totalTokens,
            cost: message.usage.cost.total,
          },
          timestamp,
        });
        break;
      }
      case "toolResult": {
        const text = message.content
          .map((part) => (part.type === "text" ? part.text : "[image]"))
          .join("\n");
        result.push({
          id,
          role: "tool",
          text,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          timestamp,
        });
        break;
      }
      case "bashExecution":
        result.push({
          id,
          role: "tool",
          toolName: "bash",
          text: `$ ${message.command}\n${message.output}`,
          isError: message.exitCode !== 0 && message.exitCode !== undefined,
          timestamp,
        });
        break;
      case "custom": {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => (part.type === "text" ? part.text : "[image]"))
                .join("\n");
        result.push({
          id,
          role: "system",
          kind: message.customType,
          text,
          timestamp,
        });
        break;
      }
      case "compactionSummary":
        result.push({
          id,
          role: "system",
          kind: "compaction",
          text: message.summary,
          timestamp,
        });
        break;
      case "branchSummary":
        result.push({
          id,
          role: "system",
          kind: "branch",
          text: message.summary,
          timestamp,
        });
        break;
      default:
        break;
    }
  });
  return result;
}

/** Paginate only the UI projection; the Pi session keeps its complete context. */
export function projectMessagePage(
  messages: readonly AgentMessage[],
  options: { before?: number; limit?: number } = {},
): ChatMessagePage {
  const limit = options.limit ?? 50;
  const before = options.before ?? messages.length;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw badRequest("Invalid message limit");
  if (!Number.isSafeInteger(before) || before < 0)
    throw badRequest("Invalid message cursor");
  const end = Math.min(before, messages.length);
  const start = Math.max(0, end - Math.min(limit, 100));
  const usage = { total: 0, cost: 0 };
  for (const message of messages) {
    if (message.role === "assistant") {
      usage.total += message.usage.totalTokens;
      usage.cost += message.usage.cost.total;
    }
  }
  return {
    messages: projectMessages(messages.slice(start, end), start),
    before: start > 0 ? start : null,
    usage,
  };
}

export class LabSessions {
  private runtime?: Promise<ModelRuntime>;
  private readonly entries = new Map<string, Promise<Entry>>();

  constructor(private readonly deps: SessionDependencies) {}

  modelRuntime(): Promise<ModelRuntime> {
    const { agentDir } = this.deps.paths;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const modelsPath = join(agentDir, "models.json");
    this.runtime ??= ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: existsSync(modelsPath) ? modelsPath : null,
      modelsStorePath: join(agentDir, "models-store.json"),
      allowModelNetwork: true,
      refreshOnCreate: false,
    });
    return this.runtime;
  }

  async models(): Promise<ModelSummary[]> {
    const runtime = await this.modelRuntime();
    const available = await runtime.getAvailable();
    return available.map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
    }));
  }

  private async resolveModel(
    lab: Lab,
    runtime: ModelRuntime,
  ): Promise<Model<Api> | undefined> {
    if (lab.provider && lab.model) {
      const model = runtime.getModel(lab.provider, lab.model);
      if (model) return model;
    }
    const available = await runtime.getAvailable();
    return available[0];
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
      listeners: new Set(),
      lastError: null,
      queue: { steering: [], followUp: [] },
      streamingText: "",
    };
    session.subscribe((event) => this.handle(entry, event));
    return entry;
  }

  /** The coordinator and its workers use the same Pi setup, with separate context. */
  async createSession(
    lab: Lab,
    worker?: { run: AgentRun; definition: AgentDefinition },
    campaign?: Campaign,
  ): Promise<AgentSession> {
    const { agentDir, sessionsDir } = this.deps.paths;
    const runtime = await this.modelRuntime();
    const settingsManager = SettingsManager.create(lab.path, agentDir);
    const { resources } = this.deps;
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
      `${resources.systemPrompt(this.deps.labs.get(lab.id))}\n\n${resources.prompt("campaign-dispatch").content}`;
    const loader = new DefaultResourceLoader({
      cwd: lab.path,
      agentDir,
      settingsManager,
      noExtensions: true,
      noThemes: true,
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      additionalExtensionPaths: [webAccessExtension()],
      extensionFactories: [
        (pi) => {
          pi.on("before_agent_start", (event) => {
            // Pi owns prompt assembly; read database context on each working turn.
            event.systemPromptOptions.appendSystemPrompt = systemPrompt();
            event.systemPromptOptions.contextFiles =
              loader.getAgentsFiles().agentsFiles;
          });
        },
      ],
      appendSystemPrompt: [systemPrompt()],
    });
    await loader.reload();
    // Database documents are passed directly to Pi. No mirrored Markdown files or virtual file paths.
    loader.getAgentsFiles = () => {
      const context = this.deps.labs.context(lab.id);
      const agentsFiles = [
        {
          path: `Laboratory context (database, revision ${context.revision})`,
          content: context.content,
        },
      ];
      if (primarySkill)
        agentsFiles.push({
          path: `Primary skill: ${primarySkill.id} (database)`,
          content: primarySkill.instructions,
        });
      if (campaignId)
        agentsFiles.push({
          path: "Campaign state (database)",
          content: `${worker ? "Your assignment belongs to this campaign; results and jobs go to its coordinator.\n" : ""}${JSON.stringify(this.deps.campaigns.get(lab.id, campaignId))}`,
        });
      if (!worker || worker.definition.id === "research-editor")
        agentsFiles.push({
          path: "Pico editorial status (computed)",
          content: this.deps.editorial.promptContext(lab),
        });
      return { agentsFiles };
    };
    const selected = worker?.run ?? campaign;
    const model = selected
      ? (await runtime.getAvailable()).find(
          (model) =>
            model.provider === selected.provider && model.id === selected.model,
        )
      : await this.resolveModel(lab, runtime);
    if (selected && !model)
      throw badRequest(
        `Model ${selected.provider}/${selected.model} is not available`,
      );
    const customTools = createPicoTools({
      lab,
      labs: this.deps.labs,
      resources,
      skillCatalog,
      records: this.deps.records,
      jobs: this.deps.jobs,
      editorial: this.deps.editorial,
      editorialRunId:
        worker?.definition.id === "research-editor" ? worker.run.id : undefined,
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
    });
    const { session } = await createAgentSession({
      cwd: lab.path,
      agentDir,
      modelRuntime: runtime,
      model,
      thinkingLevel: (selected?.thinking ?? lab.thinking) as ThinkingLevel,
      tools: [
        ...builtinTools,
        ...customTools.map((tool) => tool.name),
        ...webTools,
      ],
      customTools,
      resourceLoader: loader,
      sessionManager: worker
        ? SessionManager.create(
            lab.path,
            join(sessionsDir, "agents", worker.run.id),
          )
        : campaign
          ? campaign.sessionFile && existsSync(campaign.sessionFile)
            ? SessionManager.open(campaign.sessionFile)
            : SessionManager.create(
                lab.path,
                join(sessionsDir, "campaigns", campaign.id),
              )
          : SessionManager.continueRecent(lab.path, sessionsDir),
      settingsManager,
    });
    await session.bindExtensions({});
    // Continued sessions may declare an older tool loadout in their transcript.
    // Apply this role's current catalog so newly introduced tools are available.
    session.setActiveToolsByName([
      ...builtinTools,
      ...customTools.map((tool) => tool.name),
      ...webTools,
    ]);
    if (campaignId)
      this.deps.campaigns.attach(session, lab.id, campaignId, !!campaign);
    return session;
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

  private handle(entry: Entry, event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          entry.streamingText += update.delta;
          this.emit(entry, { type: "text_delta", delta: update.delta });
        } else if (update.type === "thinking_delta")
          this.emit(entry, { type: "thinking_delta", delta: update.delta });
        break;
      }
      case "message_end": {
        entry.streamingText = "";
        const message = event.message;
        if (message.role === "assistant" && message.stopReason === "error") {
          entry.lastError =
            message.errorMessage ?? "The model returned an error";
          this.emit(entry, { type: "error", message: entry.lastError });
        }
        this.emit(entry, { type: "message_end" });
        break;
      }
      case "tool_execution_start":
        this.emit(entry, {
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_end":
        this.emit(entry, {
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
        });
        break;
      case "agent_start":
        this.emit(entry, { type: "agent_start" });
        break;
      case "agent_end":
        entry.streamingText = "";
        this.emit(entry, { type: "agent_end" });
        void commitAll(entry.lab.path, "Pico: turn finished").catch(() => {});
        break;
      case "queue_update":
        entry.queue = {
          steering: [...event.steering],
          followUp: [...event.followUp],
        };
        this.emit(entry, { type: "queue", ...entry.queue });
        break;
      case "compaction_start":
        this.emit(entry, { type: "compaction", phase: "start" });
        break;
      case "compaction_end":
        this.emit(entry, { type: "compaction", phase: "end" });
        break;
      case "auto_retry_start":
        this.emit(entry, {
          type: "retry",
          attempt: event.attempt,
          message: event.errorMessage,
        });
        break;
      default:
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
    await this.prompt(entry, message);
    return { mode: "prompt" };
  }

  /** Delivers a system-originated message such as a job outcome. While the
   *  model is working, steering hands it the outcome before its next step
   *  instead of holding it until the whole turn ends. */
  async notify(labId: string, text: string): Promise<void> {
    const entry = await this.open(labId);
    if (entry.session.isStreaming) {
      await entry.session.steer(text);
      return;
    }
    await this.prompt(entry, text);
  }

  /** Receipt is the outcome in Pi's history. A queued steering message stays visible
   * in the sidebar until consumed, and can be redelivered after an interrupted turn. */
  async deliverSubagentResult(labId: string, text: string): Promise<boolean> {
    const entry = await this.open(labId);
    const received = () =>
      projectMessages(entry.session.messages).some(
        (message) => message.role === "user" && message.text === text,
      );
    if (received()) return true;
    if (entry.session.getSteeringMessages().includes(text)) {
      if (entry.session.isStreaming) return false;
      // An aborted turn can leave its steering messages queued in Pi. Remove
      // just this durable outcome before prompting it again; retain all other input.
      const queued = entry.session.clearQueue();
      for (const message of queued.steering)
        if (message !== text) await entry.session.steer(message);
      for (const message of queued.followUp)
        await entry.session.followUp(message);
    }
    await this.notify(labId, text);
    return received();
  }

  private prompt(entry: Entry, text: string): Promise<void> {
    entry.lastError = null;
    return new Promise<void>((resolve, reject) => {
      let accepted = false;
      entry.session
        .prompt(text, {
          preflightResult: (ok) => {
            if (ok) {
              accepted = true;
              resolve();
            }
          },
        })
        .catch((error: unknown) => {
          entry.lastError = errorMessage(error);
          this.emit(entry, { type: "error", message: entry.lastError });
          if (!accepted) reject(error);
        });
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
    return projectMessagePage(entry.session.messages, options);
  }

  async state(labId: string): Promise<SessionState> {
    const entry = await this.open(labId);
    const model = entry.session.model;
    return {
      labId,
      streaming: entry.session.isStreaming,
      model: model
        ? { provider: model.provider, id: model.id, name: model.name }
        : null,
      thinking: entry.session.thinkingLevel,
      queue: entry.queue,
      lastError: entry.lastError,
      sessionFile: entry.session.sessionFile ?? null,
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
    const runtime = await this.modelRuntime();
    if (selection.provider && selection.model) {
      const model = runtime.getModel(selection.provider, selection.model);
      if (!model)
        throw badRequest(
          `Model ${selection.provider}/${selection.model} is not available`,
        );
      await entry.session.setModel(model);
    }
    if (selection.thinking)
      entry.session.setThinkingLevel(selection.thinking as ThinkingLevel);
  }

  async close(): Promise<void> {
    for (const pending of this.entries.values()) {
      try {
        const entry = await pending;
        if (entry.session.isStreaming) await entry.session.abort();
        entry.session.dispose();
      } catch {
        /* closing is best effort */
      }
    }
    this.entries.clear();
  }
}
