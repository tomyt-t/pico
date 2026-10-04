import {
  getSessionMessages,
  type HookCallbackMatcher,
  type HookEvent,
  type McpSdkServerConfigWithInstance,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ThinkingLevel } from "./contracts";
import { errorMessage } from "./errors";

/** Claude Code tools available to every Pico agent. Its own Task/Agent
 *  delegation stays off: Pico's subagents are persisted and visible. */
export const claudeTools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
];

/** Pico's own tools reach the model as mcp__pico__<name>. */
export const picoToolPrefix = "mcp__pico__";

/** The name the researcher sees: Pico tools without their MCP prefix. */
export const displayToolName = (name: string): string =>
  name.startsWith(picoToolPrefix) ? name.slice(picoToolPrefix.length) : name;

/** One entry of a Claude Code transcript, live or read back from disk. */
export interface TranscriptMessage {
  type: "user" | "assistant" | "system";
  uuid: string;
  /** Messages API shape: MessageParam for users, Message for the assistant. */
  message: unknown;
  timestamp?: string;
}

export interface Usage {
  tokens: number;
  /** Estimated USD at API prices; not a charge on a Claude plan. */
  cost: number;
}

export interface TurnResult extends Usage {
  ok: boolean;
  subtype: SDKResultMessage["subtype"];
  /** Final assistant text, or the error text when the turn failed. */
  text: string;
  terminalReason: string | null;
}

export type ClaudeSessionEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; result: TurnResult | null }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_end"; message: TranscriptMessage; error?: string }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "retry"; attempt: number; message: string }
  | { type: "rate_limit"; info: SDKRateLimitInfo }
  | { type: "error"; message: string };

export interface ClaudeSessionOptions {
  cwd: string;
  /** Claude alias or id; undefined uses Claude Code's default. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
  /** Appended to Claude Code's own system prompt. A changed value restarts
   *  the idle process, resuming the same conversation, before the next turn. */
  systemPrompt: string | (() => string);
  /** Built per process start; an in-process server binds to one transport. */
  mcpServers?: () => Record<string, McpSdkServerConfigWithInstance>;
  /** Complete subprocess environment, see claudeEnv(). */
  env: Record<string, string | undefined>;
  resume?: string | null;
  /** Running totals already recorded for a resumed session: Claude Code
   *  reports totals that continue from its transcript. */
  usageBaseline?: Usage;
  /** Remaining spend Claude Code itself enforces, as a safety net. Checked
   *  before each new turn; a changed balance restarts the idle process. */
  maxBudgetUsd?: () => number | undefined;
  /** Fresh context for every prompt, including messages folded mid-turn. */
  context?: () => string | undefined;
  /** Throw to refuse a prompt before it reaches the model. */
  onBeforePrompt?: () => void;
  /** Throw to deny the tool call and stop the turn. */
  onBeforeTool?: (toolName: string, input: unknown) => void | Promise<void>;
  /** A reason to end the turn after its tools ran, instead of asking the
   *  model for another step; null to continue. */
  stopAfterTools?: () => string | null;
  /** Called once per turn with what it added to the running totals. */
  onUsage?: (usage: Usage) => void;
  /** Claude Code reported that the plan's usage limit was reached. With this
   *  option the running turn stops instead of waiting for the reset. */
  onPlanLimit?: (resetsAt?: number) => void;
}

/** When a plan limit resets, as an ISO date. Claude Code reports Unix
 *  seconds; milliseconds are accepted as well. */
export function planLimitReset(resetsAt?: number): string | null {
  return resetsAt
    ? new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString()
    : null;
}

/** The researcher-facing explanation of a Claude plan limit. */
export function planLimitMessage(resetsAt?: number): string {
  const reset = planLimitReset(resetsAt);
  return `Claude plan usage limit reached${reset ? `; resets at ${reset}` : ""}. Nothing is charged beyond the plan; resume after the reset.`;
}

type InputKind = "prompt" | "steer" | "followUp" | "note";

/** Pico's thinking levels on Claude's adaptive thinking and effort. */
export function thinkingOptions(
  level: ThinkingLevel | undefined,
): Pick<Options, "thinking" | "effort"> {
  if (!level) return {};
  if (level === "off") return { thinking: { type: "disabled" } };
  return {
    thinking: { type: "adaptive" },
    effort: level === "minimal" ? "low" : level,
  };
}

/** Reads a finished or resumable session from Pico's Claude config dir. */
export async function readTranscript(
  sessionId: string,
): Promise<TranscriptMessage[]> {
  const messages = await getSessionMessages(sessionId, {
    includeSystemMessages: true,
  });
  return messages.map((message) => ({
    type: message.type,
    uuid: message.uuid,
    message: message.message,
    timestamp: (message as { timestamp?: string }).timestamp,
  }));
}

export interface Note {
  kind: string;
  details: Record<string, string>;
  content: string;
}

/** Notes are user messages with a stable first line, e.g.
 *  "[pico:campaign-result source=run-1]", so the transcript stays plain. */
export function noteText(
  kind: string,
  content: string,
  details: Record<string, string> = {},
): string {
  const attributes = Object.entries(details)
    .map(([key, value]) => ` ${key}=${encodeURIComponent(value)}`)
    .join("");
  return `[pico:${kind}${attributes}]\n${content}`;
}

export function parseNote(text: string): Note | null {
  const match = /^\[pico:([a-z0-9-]+)((?: [a-z]+=[^\s\]]*)*)\]\n?/.exec(text);
  if (!match) return null;
  const details: Record<string, string> = {};
  for (const pair of (match[2] ?? "").trim().split(" ").filter(Boolean)) {
    const [key = "", value = ""] = pair.split("=");
    details[key] = decodeURIComponent(value);
  }
  return {
    kind: match[1] ?? "",
    details,
    content: text.slice(match[0].length),
  };
}

/** Plain text of a Messages API content field. */
export const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            part?.type === "text" && typeof part.text === "string"
              ? part.text
              : "",
          )
          .join("")
      : "";

/** Async iterable the SDK reads user messages from, one process at a time. */
class Input implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  push(item: SDKUserMessage): void {
    this.items.push(item);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.closed) {
      const item = this.items.shift();
      if (item) yield item;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}

interface Waiter {
  ready: () => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface Process {
  q: Query;
  input: Input;
  systemPrompt: string;
  budget: number | undefined;
  /** Spend this process has already counted against its own budget. */
  spent: number;
}

/** The subset of a persistent agent session Pico uses, on one Claude Code
 *  process fed by streaming input. A turn ends at its result message. */
export class ClaudeSession {
  sessionId: string | null;
  model: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  isStreaming = false;
  lastResult: TurnResult | null = null;
  private history: TranscriptMessage[];
  private process?: Process;
  private closing?: Query;
  private restartWhenIdle = false;
  private disposed = false;
  private exited: Promise<void> = Promise.resolve();
  private compacting = false;
  /** Why this turn's prompt was refused by onBeforePrompt, if it was. */
  private refusal: string | null = null;
  /** The plan limit this turn ran into, if Claude Code reported one. */
  private limit: string | null = null;
  private readonly totals: Usage;
  private stderr: string[] = [];
  private readonly pending = new Map<
    string,
    { kind: InputKind; text: string }
  >();
  /** Prompts already shown in the history that Claude Code has not taken. */
  private readonly untaken = new Set<string>();
  private readonly tools = new Map<string, string>();
  private readonly listeners = new Set<(event: ClaudeSessionEvent) => void>();
  private waiters: Waiter[] = [];

  private constructor(
    private readonly options: ClaudeSessionOptions,
    history: TranscriptMessage[],
  ) {
    this.sessionId = history.length ? (options.resume ?? null) : null;
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.totals = { ...(options.usageBaseline ?? { tokens: 0, cost: 0 }) };
    this.history = history;
  }

  /** A missing transcript starts a new conversation instead of failing. */
  static async create(options: ClaudeSessionOptions): Promise<ClaudeSession> {
    const history = options.resume ? await readTranscript(options.resume) : [];
    return new ClaudeSession(options, history);
  }

  get messages(): readonly TranscriptMessage[] {
    return this.history;
  }

  /** The history without prompts Claude Code has not taken yet, so a
   *  delivery receipt never runs ahead of its transcript. */
  get recorded(): readonly TranscriptMessage[] {
    return this.untaken.size
      ? this.history.filter((entry) => !this.untaken.has(entry.uuid))
      : this.history;
  }

  /** Running totals Claude Code reported for this conversation. */
  get usage(): Usage {
    return { ...this.totals };
  }

  get queue(): { steering: string[]; followUp: string[] } {
    const of = (kind: InputKind) =>
      [...this.pending.values()]
        .filter((input) => input.kind === kind)
        .map((input) => input.text);
    return { steering: of("steer"), followUp: of("followUp") };
  }

  subscribe(listener: (event: ClaudeSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves when the session is idle again, after this prompt's turn. */
  async prompt(text: string): Promise<void> {
    this.send(text, this.isStreaming ? "followUp" : "prompt");
    await this.until(() => !this.isStreaming);
  }

  /** Delivered between tool rounds of the running turn, or starts one. */
  async steer(text: string): Promise<void> {
    this.send(text, "steer");
  }

  /** Runs as its own turn after the current one. */
  async followUp(text: string): Promise<void> {
    this.send(text, "followUp");
  }

  /** Appends a marked message to the transcript without starting a turn;
   *  the model reads it with the next prompt. Resolves once recorded. */
  async appendNote(
    kind: string,
    content: string,
    details?: Record<string, string>,
  ): Promise<void> {
    await this.until(() => !this.isStreaming);
    const uuid = this.send(noteText(kind, content, details), "note");
    await this.until(() => !this.pending.has(uuid));
  }

  /** Stops the running turn. Queued messages survive and run afterwards. */
  async abort(): Promise<void> {
    const current = this.process;
    if (!current || !this.isStreaming) return;
    const result = this.lastResult;
    await current.q.interrupt().catch(() => {});
    await this.until(
      () =>
        this.lastResult !== result ||
        !this.isStreaming ||
        this.process !== current,
    ).catch(() => {});
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await this.process?.q.setModel(model);
  }

  /** Thinking options are fixed per process; restart it on the next send. */
  setThinkingLevel(level: ThinkingLevel): void {
    if (level === this.thinkingLevel) return;
    this.thinkingLevel = level;
    if (this.isStreaming || this.pending.size) this.restartWhenIdle = true;
    else this.stop();
  }

  /** Ends the session; resolves once its Claude Code process has exited. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop();
    this.settle(new Error("Session closed"));
    await this.exited;
  }

  private emit(event: ClaudeSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken listener never stops the session */
      }
    }
  }

  private until(ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    if (this.disposed) return Promise.reject(new Error("Session closed"));
    return new Promise((resolve, reject) =>
      this.waiters.push({ ready, resolve, reject }),
    );
  }

  private settle(error?: Error): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else if (waiter.ready()) waiter.resolve();
      else this.waiters.push(waiter);
    }
  }

  private systemPrompt(): string {
    const { systemPrompt } = this.options;
    return typeof systemPrompt === "string" ? systemPrompt : systemPrompt();
  }

  private send(text: string, kind: InputKind): string {
    if (this.disposed) throw new Error("Session closed");
    const uuid = crypto.randomUUID();
    // A new turn picks up edited prompts and the current budget balance. A
    // process with inputs still in flight keeps them and is reused.
    if (
      kind !== "note" &&
      !this.isStreaming &&
      this.process &&
      !this.pending.size
    ) {
      const { systemPrompt, budget, spent } = this.process;
      const balance = this.options.maxBudgetUsd?.();
      if (
        this.restartWhenIdle ||
        systemPrompt !== this.systemPrompt() ||
        (balance !== undefined &&
          (budget === undefined || Math.abs(budget - spent - balance) > 1e-9))
      ) {
        this.restartWhenIdle = false;
        this.stop();
      }
    }
    this.pending.set(uuid, { kind, text });
    if (kind === "prompt") {
      this.untaken.add(uuid);
      this.history = [
        ...this.history,
        {
          type: "user",
          uuid,
          message: { role: "user", content: text },
          timestamp: new Date().toISOString(),
        },
      ];
    }
    if (kind !== "note" && !this.isStreaming) this.begin();
    if (kind === "steer" || kind === "followUp")
      this.emit({ type: "queue_update", ...this.queue });
    this.start().push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid,
      ...(kind === "note" ? { shouldQuery: false } : {}),
      ...(kind === "steer" ? { priority: "next" as const } : {}),
      ...(kind === "followUp" ? { priority: "later" as const } : {}),
    });
    return uuid;
  }

  private begin(): void {
    this.isStreaming = true;
    this.emit({ type: "agent_start" });
  }

  private hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const { context, onBeforePrompt, onBeforeTool, stopAfterTools } =
      this.options;
    return {
      UserPromptSubmit: [
        {
          hooks: [
            async () => {
              try {
                onBeforePrompt?.();
              } catch (error) {
                this.refusal = errorMessage(error);
                return { decision: "block", reason: this.refusal };
              }
              const additionalContext = context?.();
              return additionalContext
                ? {
                    hookSpecificOutput: {
                      hookEventName: "UserPromptSubmit",
                      additionalContext,
                    },
                  }
                : {};
            },
          ],
        },
      ],
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              if (!onBeforeTool || input.hook_event_name !== "PreToolUse")
                return {};
              try {
                await onBeforeTool(input.tool_name, input.tool_input);
                return {};
              } catch (error) {
                const reason = errorMessage(error);
                return {
                  continue: false,
                  stopReason: reason,
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: reason,
                  },
                };
              }
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async () => {
              const reason = stopAfterTools?.();
              return reason ? { continue: false, stopReason: reason } : {};
            },
          ],
        },
      ],
    };
  }

  private start(): Input {
    if (this.process) return this.process.input;
    const input = new Input();
    const servers = this.options.mcpServers?.() ?? {};
    const systemPrompt = this.systemPrompt();
    const budget = this.options.maxBudgetUsd?.();
    const q = query({
      prompt: input,
      options: {
        cwd: this.options.cwd,
        model: this.model,
        ...thinkingOptions(this.thinkingLevel),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemPrompt,
          // A resumed conversation gets the current prompt, not its first one.
          snapshot: false,
        },
        // Isolated from ~/.claude, CLAUDE.md, project hooks and auto memory.
        settingSources: [],
        settings: { autoMemoryEnabled: false, autoDreamEnabled: false },
        strictMcpConfig: true,
        mcpServers: servers,
        tools: claudeTools,
        allowedTools: [
          ...claudeTools,
          ...Object.keys(servers).map((name) => `mcp__${name}`),
        ],
        disallowedTools: ["Task", "Agent"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        ...(budget === undefined
          ? {}
          : { maxBudgetUsd: Math.max(budget, 0.000001) }),
        hooks: this.hooks(),
        resume: this.sessionId ?? undefined,
        env: this.options.env,
        stderr: (data) => {
          this.stderr = [...this.stderr, data].slice(-20);
        },
      },
    });
    this.process = { q, input, systemPrompt, budget, spent: 0 };
    this.exited = this.consume(q);
    return input;
  }

  /** Closes the process; the next send resumes the same conversation. */
  private stop(): void {
    const current = this.process;
    if (!current) return;
    this.closing = current.q;
    current.input.close();
    this.process = undefined;
    current.q.close();
  }

  private async consume(q: Query): Promise<void> {
    let failure: string | null = null;
    try {
      for await (const message of q) await this.handle(message);
    } catch (error) {
      failure = errorMessage(error);
    }
    if (this.closing === q) return;
    if (this.process?.q === q) {
      this.process.input.close();
      this.process = undefined;
    }
    // The process ended on its own: everything it had not answered is lost.
    const detail = this.stderr.join("").trim().split("\n").slice(-3).join("\n");
    const message = [failure ?? "Claude Code exited", detail]
      .filter(Boolean)
      .join(": ");
    const lost = new Set(this.pending.keys());
    this.pending.clear();
    this.untaken.clear();
    if (lost.size) {
      // Unanswered prompts never reached the transcript; drop their echo so
      // delivery receipts stay honest and callers can retry.
      this.history = this.history.filter((entry) => !lost.has(entry.uuid));
      this.emit({ type: "error", message });
      this.emit({ type: "queue_update", ...this.queue });
    }
    if (this.isStreaming) {
      this.isStreaming = false;
      this.emit({ type: "agent_end", result: null });
    }
    this.settle(lost.size ? new Error(message) : undefined);
  }

  private async handle(message: SDKMessage): Promise<void> {
    if ("session_id" in message && message.session_id)
      this.sessionId = message.session_id;
    switch (message.type) {
      case "system":
        if (message.subtype === "init") this.model = message.model;
        else if (message.subtype === "status") {
          if (message.status === "compacting" && !this.compacting) {
            this.compacting = true;
            this.emit({ type: "compaction_start" });
          } else if (message.status !== "compacting" && this.compacting) {
            this.compacting = false;
            this.emit({ type: "compaction_end" });
          }
        } else if (message.subtype === "compact_boundary" && this.compacting) {
          this.compacting = false;
          this.emit({ type: "compaction_end" });
        } else if (message.subtype === "api_retry")
          this.emit({
            type: "retry",
            attempt: message.attempt,
            message: `${message.error}${message.error_status ? ` (${message.error_status})` : ""}`,
          });
        return;
      case "stream_event": {
        if (message.parent_tool_use_id) return;
        this.taken(message);
        const event = message.event;
        if (!this.isStreaming) this.begin();
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta")
            this.emit({ type: "text_delta", delta: event.delta.text });
          else if (event.delta.type === "thinking_delta")
            this.emit({ type: "thinking_delta", delta: event.delta.thinking });
        }
        return;
      }
      case "assistant": {
        if (message.parent_tool_use_id) return;
        this.taken(message);
        if (!this.isStreaming) this.begin();
        const entry: TranscriptMessage = {
          type: "assistant",
          uuid: message.uuid,
          message: message.message,
          timestamp: message.timestamp ?? new Date().toISOString(),
        };
        this.history = [...this.history, entry];
        this.emit({
          type: "message_end",
          message: entry,
          ...(message.error
            ? { error: textOf(message.message.content) || message.error }
            : {}),
        });
        for (const part of message.message.content)
          if (part.type === "tool_use") {
            this.tools.set(part.id, part.name);
            this.emit({
              type: "tool_execution_start",
              toolCallId: part.id,
              toolName: part.name,
              args: part.input,
            });
          }
        return;
      }
      case "user": {
        if (message.parent_tool_use_id || "isReplay" in message) return;
        const content = message.message.content;
        this.history = [
          ...this.history,
          {
            type: "user",
            uuid: message.uuid ?? crypto.randomUUID(),
            message: message.message,
            timestamp: message.timestamp ?? new Date().toISOString(),
          },
        ];
        if (Array.isArray(content))
          for (const part of content)
            if (part.type === "tool_result") {
              this.emit({
                type: "tool_execution_end",
                toolCallId: part.tool_use_id,
                toolName: this.tools.get(part.tool_use_id) ?? "",
                isError: part.is_error === true,
              });
              this.tools.delete(part.tool_use_id);
            }
        return;
      }
      case "rate_limit_event": {
        const info = message.rate_limit_info;
        if (info.status === "rejected") {
          this.limit = planLimitMessage(info.resetsAt);
          if (this.options.onPlanLimit) {
            this.options.onPlanLimit(info.resetsAt);
            void this.abort();
          }
        }
        this.emit({ type: "rate_limit", info });
        return;
      }
      case "auth_status":
        if (message.error) this.emit({ type: "error", message: message.error });
        return;
      case "result":
        await this.finish(message);
        return;
      default:
        return;
    }
  }

  /** Claude Code stamps a turn's first reply with the prompts it took; by
   *  then they are in its transcript. */
  private taken(message: {
    user_message_uuid?: string;
    user_message_uuids?: string[];
  }): void {
    const uuids =
      message.user_message_uuids ??
      (message.user_message_uuid ? [message.user_message_uuid] : []);
    for (const uuid of uuids) this.untaken.delete(uuid);
  }

  /** Converts Claude Code's running totals into this turn's share. */
  private account(message: SDKResultMessage): Usage {
    let tokens = 0;
    for (const model of Object.values(message.modelUsage ?? {}))
      tokens +=
        model.inputTokens +
        model.outputTokens +
        model.cacheReadInputTokens +
        model.cacheCreationInputTokens;
    // Startup failures may report zeroed totals: never count backwards.
    const usage = {
      tokens: Math.max(0, tokens - this.totals.tokens),
      cost: Math.max(0, message.total_cost_usd - this.totals.cost),
    };
    this.totals.tokens = Math.max(this.totals.tokens, tokens);
    this.totals.cost = Math.max(this.totals.cost, message.total_cost_usd);
    if (this.process) this.process.spent += usage.cost;
    if (usage.tokens || usage.cost) this.options.onUsage?.(usage);
    return usage;
  }

  private async finish(message: SDKResultMessage): Promise<void> {
    const echoed = message.user_message_uuids ?? [
      ...(message.user_message_uuid ? [message.user_message_uuid] : []),
    ];
    // Without an echo, the oldest input is the one this result answers.
    const consumed = echoed.length
      ? echoed
      : [...this.pending.keys()].slice(0, 1);
    const kinds = consumed.map((uuid) => this.pending.get(uuid)?.kind);
    const usage = this.account(message);
    const queued = kinds.some(
      (kind) => kind === "steer" || kind === "followUp",
    );
    const note = kinds.length > 0 && kinds.every((kind) => kind === "note");
    const waiting = [...this.pending].some(
      ([uuid, input]) => input.kind !== "note" && !consumed.includes(uuid),
    );
    // The transcript on disk is canonical: final usage, folded messages. Read
    // it before releasing the inputs, so a message is always either queued
    // or in the history and a delivery is never repeated.
    if ((queued || note || !waiting) && this.sessionId)
      this.history = await readTranscript(this.sessionId).catch(
        () => this.history,
      );
    for (const uuid of consumed) {
      this.pending.delete(uuid);
      this.untaken.delete(uuid);
    }
    if (queued) this.emit({ type: "queue_update", ...this.queue });
    // A note's result only confirms it was recorded.
    if (note) {
      this.settle();
      return;
    }
    const ok =
      message.subtype === "success" && !message.is_error && !this.refusal;
    const result: TurnResult = {
      ok,
      subtype: message.subtype,
      text:
        this.refusal ??
        (ok ? null : this.limit) ??
        (message.subtype === "success"
          ? message.result
          : message.errors.join("\n")),
      terminalReason: message.terminal_reason ?? null,
      ...usage,
    };
    this.refusal = null;
    this.limit = null;
    this.lastResult = result;
    if (!waiting) {
      this.isStreaming = false;
      this.emit({ type: "agent_end", result });
      if (this.restartWhenIdle) {
        this.restartWhenIdle = false;
        this.stop();
      }
    }
    this.settle();
  }
}
