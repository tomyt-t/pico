import i18n from "i18next";

export interface ResponseCache<T> {
  etag?: string;
  data?: T;
}

export class RequestError extends Error {
  constructor(
    message: string,
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
    signal?: AbortSignal;
    cache?: ResponseCache<T>;
  } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined && { "Content-Type": "application/json" }),
      ...(options.cache?.etag && { "If-None-Match": options.cache.etag }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  if (response.status === 304 && options.cache?.data !== undefined)
    return options.cache.data;
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = (payload as { error?: string } | undefined)?.error;
    throw new RequestError(
      message ?? i18n.t("http.status", { status: response.status }),
      response.status,
    );
  }
  if (payload === undefined)
    throw new RequestError(i18n.t("http.unreadable"), response.status);
  if (options.cache) {
    options.cache.etag = response.headers.get("ETag") ?? undefined;
    options.cache.data = payload as T;
  }
  return payload as T;
}

export function errorText(error: unknown): string {
  return error instanceof RequestError
    ? error.message
    : error instanceof TypeError
      ? i18n.t("http.network")
      : error instanceof Error
        ? error.message
        : i18n.t("http.failed");
}

export function labPath(labId: string, suffix = ""): string {
  return `/labs/${encodeURIComponent(labId)}${suffix}`;
}
