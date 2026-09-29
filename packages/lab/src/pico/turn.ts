import type { Json, Turn } from "@/lab/contracts";
import type { ModelAdapter } from "@/lab/models/model-contract";
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
  if (turn.status !== "queued") return;
  try {
    turn = save({
      ...turn,
      status: "running",
      endedAt: null,
      error: null,
    });
    const tools = createTools(research, turn.labId, signal);
    // Completion is an analysis trigger, not an authorization for an unbounded run chain.
    if (turn.trigger === "run_completed") tools.delete("start_run");
    const ceiling = turn.steps + lab.getLab(turn.labId).settings.maxModelSteps;
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
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      if (signal.aborted) break;
      if (turn.steps >= ceiling) {
        save({
          ...turn,
          status: "paused",
          error: `Reached the ${lab.getLab(turn.labId).settings.maxModelSteps}-step turn budget. Continue to grant another block of work.`,
          endedAt: now(),
        });
        return;
      }
      const config = lab.getLab(turn.labId).settings.provider;
      const reply =
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
      if (persisted.error) throw new Error(persisted.error);
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
