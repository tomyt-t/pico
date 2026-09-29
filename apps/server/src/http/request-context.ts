import type { JsonObject, MutationContext } from "@pico/lab/contracts";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export interface RequestContext {
  request: Request;
  url: URL;
  method: string;
  parts: string[];
  body: JsonObject;
  mutation: MutationContext;
  labId: string;
  resource?: string;
  id?: string;
  action?: string;
}

/** Transport checks happen before any laboratory operation or external effect. */
export async function requestContext(
  request: Request,
): Promise<RequestContext> {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new HttpError(
      "FORBIDDEN",
      "Pico only accepts requests addressed to localhost",
    );
  const method = request.method;
  const mutates = !["GET", "HEAD"].includes(method);
  if (mutates) {
    const origin = request.headers.get("Origin");
    if (
      origin &&
      ![url.origin, "http://127.0.0.1:5174", "http://localhost:5174"].includes(
        origin,
      )
    )
      throw new HttpError(
        "FORBIDDEN",
        "Cross-origin mutations are not allowed",
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      throw new HttpError("BAD_REQUEST", "Mutations require application/json");
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const body = mutates ? await readBody(request) : {};
  const mutation: MutationContext = {
    key: request.headers.get("Idempotency-Key") ?? "",
    actor: { kind: "researcher" },
  };
  if (mutates && (!mutation.key.trim() || mutation.key.length > 250))
    throw new HttpError(
      "BAD_REQUEST",
      "Provide an Idempotency-Key header (a UUID per intent; reuse it on retry)",
    );
  return {
    request,
    url,
    method,
    parts,
    body,
    mutation,
    labId: parts[2] ?? "",
    resource: parts[3],
    id: parts[4],
    action: parts[5],
  };
}
async function readBody(request: Request): Promise<JsonObject> {
  const text = await request.text();
  if (text.length > 16_000_000)
    throw new HttpError("BAD_REQUEST", "Request body exceeds 16 MB");
  try {
    return z
      .record(z.string(), z.json())
      .parse(JSON.parse(text || "{}")) as JsonObject;
  } catch {
    throw new HttpError("BAD_REQUEST", "Expected a JSON object");
  }
}
