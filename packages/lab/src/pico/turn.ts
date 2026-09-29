import type { Json, ProviderConfig, Turn } from "@/lab/contracts";
import {
  isContextOverflow,
  type ModelAdapter,
  type ModelReply,
  ModelResponseError,
} from "@/lab/models/model-contract";
import { complete } from "@/lab/models/model-gateway";
import { context } from "@/lab/pico/context";
import { demoReply } from "@/lab/pico/demo-narrator";
import { createTools } from "@/lab/pico/tools/catalog";
import { persistReply, readTurn, saveTurn } from "@/lab/pico/transcript";
import type { Laboratory, Research } from "@/lab/research/laboratory";
import type { ConversationRepository } from "@/lab/storage/conversation-repository";

export interface TurnDependencies {
  lab: Laboratory;
  research: Research;
  conversations: ConversationRepository;
  adapter?: ModelAdapter;
  defaultAdapter?: ModelAdapter;
  isClosing(): boolean;
}
const now = () => new Date().toISOString();

export async function runTurn(
  dependencies: TurnDependencies,
  initial: Turn,
  signal: AbortSignal,
): Promise<void> {
  const { lab, research, conversations, adapter, defaultAdapter } =
    dependencies;
  const getTurn = (labId: string, id: string) =>
    readTurn(lab, conversations, labId, id);
  const save = (value: Turn) => saveTurn(conversations, value);
  let turn = getTurn(initial.labId, initial.id);
  const startStep = turn.steps;
  let recoveryAttempts = 0;
  const providerIdentity = (
    config = lab.getLab(turn.labId).settings.provider,
  ) => {
    return `${config.mode}:${config.provider ?? config.baseUrl}:${config.model}`;
  };
  const minimumContextError =
    "The provider context window cannot fit even the compact prompt and tool catalog. Choose a model with a larger context window before continuing; original messages and tool receipts remain preserved.";
  const recoverOverflow = (config: ProviderConfig): boolean => {
    const previous = turn.contextBudgetBytes ?? 100_000;
    const reduced = Math.max(6_000, Math.floor(previous / 2));
    turn = save({ ...turn, contextBudgetBytes: reduced });
    if (reduced === previous || ++recoveryAttempts > 2) {
      save({
        ...turn,
        status: "paused",
        ...(reduced === previous
          ? { contextBlockedFor: providerIdentity(config) }
          : {}),
        error:
          reduced === previous
            ? minimumContextError
            : "The provider rejected the context. A smaller durable context budget is saved; continue to retry the compacted history.",
        endedAt: now(),
      });
      return false;
    }
    return true;
  };
  if (turn.status !== "queued") return;
  try {
    turn = save({
      ...turn,
      status: "running",
      endedAt: null,
      error: null,
    });
    if (turn.contextBlockedFor === providerIdentity()) {
      save({
        ...turn,
        status: "paused",
        error: minimumContextError,
        endedAt: now(),
      });
      return;
    }
    if (turn.contextBlockedFor)
      turn = save({
        ...turn,
        contextBlockedFor: undefined,
        contextBudgetBytes: undefined,
      });
    const tools = createTools(research, turn.labId, signal);
    // Completion is an analysis trigger, not an authorization for an unbounded run chain.
    if (turn.trigger === "run_completed") tools.delete("start_run");
    const stepBudget = lab.getLab(turn.labId).settings.maxModelSteps;
    const ceiling =
      stepBudget === null ? Number.POSITIVE_INFINITY : turn.steps + stepBudget;
    while (!signal.aborted) {
      const pending = conversations
        .messagesForTurns(turn.labId, [turn.id])
        .filter(
          (message) =>
            message.turnId === turn.id &&
            message.toolCall?.status === "running",
        );
      for (const message of pending) {
        if (signal.aborted) break;
        const call = message.toolCall;
        if (!call) continue;
        const definition = tools.get(call.name);
        try {
          if (!definition) throw new Error(`Unknown tool ${call.name}`);
          const value = await definition.execute(call.arguments, {
            key: `turn:${turn.id}:tool:${message.id}`,
            actor: { kind: "pico", turnId: turn.id },
          });
          conversations.saveMessage({
            ...message,
            toolCall: {
              ...call,
              status: "completed",
              result: JSON.parse(JSON.stringify(value ?? null)) as Json,
            },
          });
        } catch (error) {
          conversations.saveMessage({
            ...message,
            toolCall: {
              ...call,
              status: "failed",
              error: (error instanceof Error
                ? error.message
                : String(error)
              ).slice(0, 3_000),
            },
          });
        }
      }
      if (signal.aborted) break;
      if (turn.steps >= ceiling) {
        save({
          ...turn,
          status: "paused",
          error: `Reached the ${stepBudget}-step turn budget. Continue to grant another block of work.`,
          endedAt: now(),
        });
        return;
      }
      const settings = lab.getLab(turn.labId).settings;
      const usage = conversations.modelUsage(turn.labId, turn.id, startStep);
      const budget =
        settings.maxModelTokens && usage.totalTokens >= settings.maxModelTokens
          ? "observed token"
          : settings.maxModelCostUsd &&
              usage.costUsd >= settings.maxModelCostUsd
            ? "observed cost"
            : usage.calls &&
                ((settings.maxModelTokens && !usage.tokensKnown) ||
                  (settings.maxModelCostUsd && !usage.costKnown))
              ? "usage reporting (the provider did not report the configured budget unit)"
              : null;
      if (budget) {
        save({
          ...turn,
          status: "paused",
          error: `Reached the ${budget} budget for this work block. Usage is measured after each response, so the last request can exceed the allowance. Continue grants another block.`,
          endedAt: now(),
        });
        return;
      }
      const config = settings.provider;
      let reply: ModelReply;
      try {
        reply =
          !adapter && config.mode === "demo"
            ? demoReply(lab, turn)
            : await (adapter ?? defaultAdapter ?? complete)({
                config,
                messages: context(lab, turn, conversations),
                tools: [...tools.values()].map(
                  ({ name, description, parameters }) => ({
                    name,
                    description,
                    parameters,
                  }),
                ),
                signal,
                sessionId: turn.conversationId,
              });
      } catch (error) {
        if (error instanceof ModelResponseError) {
          turn = persistReply(
            conversations,
            turn,
            {
              content: "",
              calls: [],
              error: error.message,
              usage: error.usage,
            },
            config,
            false,
          ).turn;
        }
        if (!signal.aborted && isContextOverflow(error)) {
          if (recoverOverflow(config)) continue;
          return;
        }
        throw error;
      }
      if (signal.aborted && !reply.native) break;
      const persisted = persistReply(
        conversations,
        turn,
        reply,
        config,
        !signal.aborted && !reply.error,
      );
      turn = persisted.turn;
      if (signal.aborted) break;
      if (persisted.error) {
        if (isContextOverflow(persisted.error)) {
          if (recoverOverflow(config)) continue;
          return;
        }
        throw new Error(persisted.error);
      }
      if (!reply.calls.length) {
        save({ ...turn, status: "completed", endedAt: now() });
        return;
      }
    }
    save({
      ...turn,
      status: dependencies.isClosing() ? "interrupted" : "cancelled",
      error: dependencies.isClosing()
        ? "Server stopped. Continue to resume from persisted tool results."
        : "Stopped by the researcher. Submitted runs continue independently.",
      endedAt: now(),
    });
  } catch (error) {
    save({
      ...turn,
      status: signal.aborted
        ? dependencies.isClosing()
          ? "interrupted"
          : "cancelled"
        : "failed",
      error: error instanceof Error ? error.message : String(error),
      endedAt: now(),
    });
  }
}
