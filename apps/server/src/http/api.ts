import type { LabRuntime } from "@pico/lab";
import { backupRoutes } from "@/server/http/backup-routes";
import { conversationRoutes } from "@/server/http/conversation-routes";
import { executionRoutes } from "@/server/http/execution-routes";
import { experimentsRoutes } from "@/server/http/experiments-routes";
import { labsRoutes } from "@/server/http/labs-routes";
import { libraryRoutes } from "@/server/http/library-routes";
import { modelsRoutes } from "@/server/http/models-routes";
import {
  HttpError,
  type RequestContext,
  requestContext,
} from "@/server/http/request-context";
import { researchRoutes } from "@/server/http/research-routes";
import { errorResponse, json } from "@/server/http/responses";
import { runsRoutes } from "@/server/http/runs-routes";

type Route = (
  context: RequestContext,
  runtime: LabRuntime,
) => Response | undefined | Promise<Response | undefined>;
const resources: Record<string, { lengths: number[]; route: Route }> = {
  status: { lengths: [4], route: labsRoutes },
  overview: { lengths: [4], route: labsRoutes },
  execution: { lengths: [4, 6], route: executionRoutes },
  conversation: { lengths: [4], route: conversationRoutes },
  history: { lengths: [4], route: conversationRoutes },
  chat: { lengths: [4], route: conversationRoutes },
  turns: { lengths: [6], route: conversationRoutes },
  provider: { lengths: [4, 5], route: modelsRoutes },
  questions: { lengths: [4, 5], route: researchRoutes },
  hypotheses: { lengths: [4, 5], route: researchRoutes },
  results: { lengths: [4, 5], route: researchRoutes },
  conclusions: { lengths: [4, 5], route: researchRoutes },
  records: { lengths: [7], route: researchRoutes },
  "record-index": { lengths: [4], route: researchRoutes },
  experiments: { lengths: [4, 5, 6], route: experimentsRoutes },
  runs: { lengths: [5, 6], route: runsRoutes },
  datasets: { lengths: [4], route: libraryRoutes },
  papers: { lengths: [4, 5], route: libraryRoutes },
};
/** HTTP adapts public capabilities; it never owns research transactions or model credentials. */
export function createApi(runtime: LabRuntime) {
  return async (request: Request): Promise<Response> => {
    try {
      const context = await requestContext(request);
      const { parts, method, resource, labId } = context;
      if (parts[0] !== "api")
        throw new HttpError("NOT_FOUND", "API route not found");
      if (parts.length === 2 && parts[1] === "health" && method === "GET")
        return json({ ok: true, version: "0.1.0" });
      if (parts.length === 2 && parts[1] === "providers" && method === "GET")
        return json(await runtime.models.catalog());
      if (parts.length === 2 && parts[1] === "backup" && method === "POST")
        return await backupRoutes(context, runtime);
      if (parts[1] !== "labs")
        throw new HttpError("NOT_FOUND", "API route not found");
      if (parts.length === 2) {
        const response = labsRoutes(context, runtime);
        if (response) return response;
        throw new HttpError("NOT_FOUND", "API route not found");
      }
      if (!labId) throw new HttpError("NOT_FOUND", "Laboratory not found");
      runtime.research.getLab(labId);
      const route = resource
        ? Object.hasOwn(resources, resource)
          ? resources[resource]
          : undefined
        : { lengths: [3], route: labsRoutes };
      if (!route?.lengths.includes(parts.length))
        throw new HttpError("NOT_FOUND", "API route not found");
      const response = await route.route(context, runtime);
      if (response) return response;
      throw new HttpError("NOT_FOUND", "API route not found");
    } catch (error) {
      return errorResponse(error);
    }
  };
}
