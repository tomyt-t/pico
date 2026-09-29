import type { LabRuntime } from "@pico/lab";
import type { Run } from "@pico/lab/contracts";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { download, json } from "@/server/http/responses";
export async function runsRoutes(
  { labId, id, action, method, body, mutation, url }: RequestContext,
  runtime: LabRuntime,
): Promise<Response | undefined> {
  if (!id) return;
  const lab = runtime.research;
  const run = lab.getRecord<Run>(labId, "run", id);
  if (!action && method === "GET") return json(run);
  if (action === "cancel" && method === "POST") {
    z.object({}).strict().parse(body);
    return json(await lab.cancelRun(labId, id, mutation));
  }
  if (action === "logs" && method === "GET") {
    const stream =
      url.searchParams.get("stream") === "stderr" ? "stderr" : "stdout";
    const tail = Math.min(
      2000,
      Math.max(1, Number(url.searchParams.get("tail")) || 200),
    );
    return json({
      text: (await lab.readLogs(labId, id))[stream]
        .split("\n")
        .slice(-tail)
        .join("\n"),
    });
  }
  if (action === "record" && method === "GET")
    return json({
      run,
      results: lab
        .overview(labId)
        .results.filter((result) => result.runIds.includes(id)),
      snapshot: run.snapshot,
    });
  if (action === "archive" && method === "GET")
    return json(await lab.exportRun(labId, id));
  if (action === "artifact" && method === "GET") {
    const path = url.searchParams.get("path") ?? "";
    return download(path, await lab.readRunFile(labId, id, "outputs", path));
  }
}
