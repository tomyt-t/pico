import type { LabRuntime } from "@pico/lab";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export function conversationRoutes(
  { resource, labId, id, action, method, body, mutation }: RequestContext,
  runtime: LabRuntime,
): Response | undefined {
  if (resource === "conversation" && method === "GET")
    return json(runtime.research.conversationView(labId));
  if (resource === "chat" && method === "POST") {
    const input = z.object({ message: z.string() }).strict().parse(body);
    return json(
      runtime.conversation.enqueue(labId, input.message, mutation),
      202,
    );
  }
  if (resource === "turns" && id && method === "POST") {
    z.object({}).strict().parse(body);
    if (action === "stop")
      return json(runtime.conversation.stop(labId, id, mutation));
    if (action === "continue")
      return json(runtime.conversation.continue(labId, id, mutation));
  }
}
