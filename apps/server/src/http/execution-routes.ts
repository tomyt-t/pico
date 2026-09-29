import type { LabRuntime } from "@pico/lab";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";

export async function executionRoutes(
  { labId, id, action, method, body, mutation }: RequestContext,
  runtime: LabRuntime,
): Promise<Response | undefined> {
  if (method === "GET" && !id)
    return json(await runtime.administration.executionStatus(labId));
  if (method === "POST" && id) {
    z.object({}).strict().parse(body);
    if (action === "repair")
      return json(
        await runtime.administration.repairExecution(labId, id, mutation),
      );
    if (action === "cleanup")
      return json(
        await runtime.administration.cleanupWork(labId, id, mutation),
      );
  }
}
