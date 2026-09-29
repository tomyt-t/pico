import type { LabRuntime } from "@pico/lab";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export function conversationRoutes(
  { resource, labId, id, action, method, body, mutation, url }: RequestContext,
  runtime: LabRuntime,
): Response | undefined {
  if (resource === "history" && method === "GET") {
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(url.searchParams.get("limit") ?? 100);
    return json(
      runtime.research.readHistory(labId, {
        limit,
        before: url.searchParams.get("before") ?? undefined,
      }),
    );
  }
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
