import { useState } from "react";
import { errorText, request } from "@/web/api/http-client";

/** A write request with busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T>(
    path: string,
    body: unknown = {},
    method = "POST",
  ): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await request<T>(path, { method, body });
    } catch (cause) {
      setError(errorText(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, clearError: () => setError(null) };
}
