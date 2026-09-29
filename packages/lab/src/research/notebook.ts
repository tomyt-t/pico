import type {
  Conversation,
  ConversationView,
  Message,
  MutationContext,
} from "@/lab/contracts";
import { actorSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import type { ResearchContext } from "@/lab/research/mutations";
export function getConversation(
  context: ResearchContext,
  labId: string,
): Conversation {
  context.getLab(labId);
  const conversation = context.conversations.getConversation(labId);
  if (!conversation)
    throw new LabError("NOT_FOUND", "Main conversation not found");
  return conversation;
}
export function conversationView(
  context: ResearchContext,
  labId: string,
): ConversationView {
  const conversation = getConversation(context, labId);
  return {
    conversation,
    messages: context.conversations.listMessages(labId, { limit: 200 }),
    turns: context.conversations.listTurns(labId),
    activeTurn: context.conversations.activeTurn(labId),
  };
}
export function readHistory(
  context: ResearchContext,
  labId: string,
  options?: { limit?: number; before?: string },
): Message[] {
  getConversation(context, labId);
  return context.conversations.listMessages(labId, options ?? { limit: 100 });
}
export function updateSummary(
  context: ResearchContext,
  labId: string,
  summary: string,
  ctx: MutationContext,
): Conversation {
  getConversation(context, labId);
  parse(actorSchema, ctx.actor);
  if (!summary.trim() || summary.length > 15000)
    throw new LabError(
      "BAD_REQUEST",
      "Summary must contain 1 to 15000 characters",
    );
  return context.conversations.updateSummary(labId, summary, ctx);
}
