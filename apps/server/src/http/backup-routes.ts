import type { LabRuntime } from "@pico/lab";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export async function backupRoutes(
  { body, mutation }: RequestContext,
  runtime: LabRuntime,
): Promise<Response> {
  const { destination } = z
    .object({ destination: z.string().min(1) })
    .strict()
    .parse(body);
  return json(await runtime.administration.backup(destination, mutation));
}
