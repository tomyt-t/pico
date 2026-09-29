import type { LabRuntime } from "@pico/lab";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export async function modelsRoutes(
  { parts, labId, id, method }: RequestContext,
  runtime: LabRuntime,
): Promise<Response | undefined> {
  if (parts.length === 2 && parts[1] === "providers" && method === "GET")
    return json(await runtime.models.catalog());
  if (!id && method === "GET") return json(await runtime.models.status(labId));
  if (id === "test" && method === "POST")
    return json(await runtime.models.test(labId));
}
