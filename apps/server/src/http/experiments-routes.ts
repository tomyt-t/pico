import type { LabRuntime } from "@pico/lab";
import type {
  Experiment,
  NewExperiment,
  RunRequest,
} from "@pico/lab/contracts";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export async function experimentsRoutes(
  { labId, id, action, method, body, mutation, url }: RequestContext,
  runtime: LabRuntime,
): Promise<Response | undefined> {
  const lab = runtime.research;
  if (!id && method === "POST")
    return json(
      lab.createExperiment(labId, body as unknown as NewExperiment, mutation),
      201,
    );
  if (!id) return;
  lab.getRecord<Experiment>(labId, "experiment", id);
  if (!action && method === "GET") return json(lab.experimentDetail(labId, id));
  if (!action && method === "PATCH") {
    const { reason, ...patch } = body;
    return json(
      lab.reviseExperiment(
        labId,
        id,
        patch as Partial<NewExperiment>,
        mutation,
        typeof reason === "string" ? reason : undefined,
      ),
    );
  }
  if (action === "files" && method === "GET")
    return json({ files: await lab.listFiles(labId, id) });
  if (action === "file") {
    if (method === "GET")
      return json({
        ...(await lab.readFile(labId, id, url.searchParams.get("path") ?? "")),
        clipped: false,
      });
    if (method === "PUT") {
      const input = z
        .object({ path: z.string(), content: z.string().max(1_000_000) })
        .strict()
        .parse(body);
      return json(await lab.writeFile(labId, id, input, mutation));
    }
  }
  if (action === "dependencies" && method === "POST") {
    const result = await lab.lockDependencies(labId, id, mutation);
    return json({ output: "output" in result ? result.output : result.log });
  }
  if (action === "runs" && method === "POST")
    return json(
      await lab.startRun(labId, id, body as RunRequest, mutation),
      202,
    );
}
