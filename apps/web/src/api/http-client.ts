import type { ApiError } from "@pico/lab/contracts";

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined && { "Content-Type": "application/json" }),
      ...(options.key && { "Idempotency-Key": options.key }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = payload as ApiError | undefined;
    throw new RequestError(
      error?.error?.message ?? `The server returned HTTP ${response.status}.`,
      error?.error?.code ?? "HTTP_ERROR",
      response.status,
    );
  }
  if (payload === undefined)
    throw new RequestError(
      "The server returned an unreadable response.",
      "INVALID_RESPONSE",
      response.status,
    );
  return payload as T;
}
export function errorText(error: unknown): string {
  return error instanceof RequestError
    ? `${error.message} (${error.code})`
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";
}
export function labPath(labId: string, suffix = ""): string {
  return `/labs/${encodeURIComponent(labId)}${suffix}`;
}
