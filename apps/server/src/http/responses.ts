import { basename } from "node:path";
import { z } from "zod";

export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function errorResponse(error: unknown): Response {
  const rawCode =
    error instanceof z.ZodError || error instanceof URIError
      ? "BAD_REQUEST"
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code).toUpperCase()
        : "INTERNAL_ERROR";
  const code = ["NOT_FOUND", "ENOENT", "MISSING"].includes(rawCode)
    ? "NOT_FOUND"
    : rawCode === "CONFLICT"
      ? "CONFLICT"
      : rawCode === "FORBIDDEN"
        ? "FORBIDDEN"
        : rawCode === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : ["BAD_REQUEST", "VALIDATION", "INVALID_PATH", "INVALID"].includes(
                rawCode,
              )
            ? "BAD_REQUEST"
            : "INTERNAL_ERROR";
  const status =
    code === "NOT_FOUND"
      ? 404
      : code === "CONFLICT"
        ? 409
        : code === "BAD_REQUEST"
          ? 400
          : code === "FORBIDDEN"
            ? 403
            : code === "UNAVAILABLE"
              ? 503
              : 500;
  return json(
    {
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    },
    status,
  );
}
export function download(path: string, bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
