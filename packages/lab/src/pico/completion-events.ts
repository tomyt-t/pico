import type { ConversationRepository } from "@/lab/storage/conversation-repository";

/** Durable delivery belongs to one storage transaction, before the queue is pumped. */
export function deliverCompletions(
  repository: ConversationRepository,
): Set<string> {
  return new Set(
    repository.consumeCompletionEvents().map((turn) => turn.labId),
  );
}
