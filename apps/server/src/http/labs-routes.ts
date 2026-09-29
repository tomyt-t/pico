import type { LabRuntime } from "@pico/lab";
import type { CreateLabInput, Lab } from "@pico/lab/contracts";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export function labsRoutes(
  { parts, method, body, mutation, labId, resource }: RequestContext,
  runtime: LabRuntime,
): Response | undefined {
  const lab = runtime.research;
  if (parts.length === 2) {
    if (method === "GET") return json(lab.listLabs());
    if (method === "POST")
      return json(
        lab.createLab(body as unknown as CreateLabInput, mutation),
        201,
      );
    return;
  }
  if (!resource) {
    if (method === "GET") return json(lab.getLab(labId));
    if (method === "PATCH")
      return json(lab.updateLab(labId, body as Partial<Lab>, mutation));
  }
  if (resource === "overview" && method === "GET")
    return json(lab.overview(labId));
  if (resource === "status" && method === "GET")
    return json(lab.labStatus(labId));
}
