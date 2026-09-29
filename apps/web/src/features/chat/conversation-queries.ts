import type { ConversationView } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
export function useConversation(labId: string) {
  return usePoll<ConversationView>(labPath(labId, "/conversation"), 1500);
}
