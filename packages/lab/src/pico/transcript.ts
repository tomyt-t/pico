import { randomUUID } from "node:crypto";
import type { Json, Message, ProviderConfig, Turn } from "@/lab/contracts";
import type { ModelReply, ModelStep } from "@/lab/models/model-contract";
import { LabError, type Laboratory } from "@/lab/research/laboratory";
import type { ConversationRepository } from "@/lab/storage/conversation-repository";

export function persistReply(
  repository: ConversationRepository,
  turn: Turn,
  reply: ModelReply,
  provider: ProviderConfig,
  replayable = true,
): { turn: Turn; error?: string } {
  return repository.transaction(() => {
    const modelStepId = randomUUID();
    const existingMessages = repository.messagesForTurns(turn.labId, [turn.id]);
    const existingCalls = reply.calls.map(
      (call) =>
        existingMessages.find(
          (message) =>
            message.turnId === turn.id && message.toolCall?.id === call.id,
        )?.toolCall,
    );
    const repeated = existingCalls.filter(Boolean);
    let error = reply.error;
    if (new Set(reply.calls.map((call) => call.id)).size !== reply.calls.length)
      error = "Model returned duplicate tool identifiers in one response";
    if (
      reply.native &&
      repeated.length &&
      repeated.length !== reply.calls.length
    )
      error =
        "Pi mixed reused and new tool identifiers in one response; no new tool was executed.";
    for (const [index, existing] of existingCalls.entries()) {
      const call = reply.calls[index];
      if (
        existing &&
        call &&
        (existing.name !== call.name ||
          canonical(existing.arguments) !== canonical(call.arguments))
      )
        error = "Model reused a tool call identifier with different arguments";
    }
    const accepted = replayable && !error;
    const calls = accepted ? reply.calls : [];
    repository.insertModelStep<ModelStep>({
      id: modelStepId,
      labId: turn.labId,
      turnId: turn.id,
      step: turn.steps + 1,
      provider,
      usage: reply.usage ?? null,
      ...(reply.native ? { native: reply.native } : {}),
      replayable: accepted && (!reply.native || !repeated.length),
      createdAt: now(),
    });
    if (reply.content)
      addMessage(repository, turn, "assistant", reply.content, modelStepId);
    for (const call of calls) {
      const existing = repository
        .messagesForTurns(turn.labId, [turn.id])
        .find(
          (message) =>
            message.turnId === turn.id && message.toolCall?.id === call.id,
        )?.toolCall;
      if (existing) continue;
      repository.insertMessage({
        id: randomUUID(),
        labId: turn.labId,
        conversationId: turn.conversationId,
        turnId: turn.id,
        role: "tool",
        content: "",
        modelStepId,
        toolCall: { ...call, status: "running" },
        createdAt: now(),
      });
    }
    return {
      turn: saveTurn(repository, {
        ...turn,
        steps: turn.steps + 1,
        usage: repository.modelUsage(turn.labId, turn.id),
      }),
      ...(error ? { error } : {}),
    };
  });
}

export function addMessage(
  repository: ConversationRepository,
  turn: Turn,
  role: Message["role"],
  content: string,
  modelStepId?: string,
): void {
  repository.insertMessage({
    id: randomUUID(),
    labId: turn.labId,
    conversationId: turn.conversationId,
    turnId: turn.id,
    role,
    content,
    ...(modelStepId ? { modelStepId } : {}),
    createdAt: now(),
  });
}

export function readTurn(
  lab: Laboratory,
  repository: ConversationRepository,
  labId: string,
  id: string,
): Turn {
  lab.getLab(labId);
  const turn = repository.getTurn(id);
  if (!turn || turn.labId !== labId)
    throw new LabError("NOT_FOUND", "Turn not found in this laboratory");
  return turn;
}
export function saveTurn(repository: ConversationRepository, turn: Turn): Turn {
  return repository.saveTurn({ ...turn, updatedAt: now() });
}

function now(): string {
  return new Date().toISOString();
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
