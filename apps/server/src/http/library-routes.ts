import type { LabRuntime } from "@pico/lab";
import type { NewPaper } from "@pico/lab/contracts";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";

const datasetInput = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    source: z.string().min(1),
    description: z.string().optional(),
    license: z.string().optional(),
    splits: z.record(z.string(), z.number().int().nonnegative()).optional(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            content: z.string(),
            encoding: z.enum(["utf8", "base64"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export async function libraryRoutes(
  { resource, labId, id, method, body, mutation }: RequestContext,
  runtime: LabRuntime,
): Promise<Response | undefined> {
  const lab = runtime.research;
  if (resource === "datasets" && method === "POST")
    return json(
      await lab.registerDataset(labId, datasetInput.parse(body), mutation),
      201,
    );
  if (resource === "papers" && method === "POST") {
    if (id === "import") {
      const { identifier } = z
        .object({ identifier: z.string().min(1) })
        .strict()
        .parse(body);
      return json(await lab.importPaper(labId, identifier, mutation), 201);
    }
    if (!id)
      return json(
        lab.registerPaper(labId, body as unknown as NewPaper, mutation),
        201,
      );
  }
}
