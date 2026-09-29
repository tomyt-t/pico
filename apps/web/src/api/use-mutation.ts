import { useRef, useState } from "react";
import { errorText, request } from "@/web/api/http-client";

export function useMutation() {
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = async <T>(
    path: string,
    body: unknown = {},
    method = "POST",
  ): Promise<T | undefined> => {
    if (pending.current) return;
    const fingerprint = JSON.stringify([path, method, body]);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, key: crypto.randomUUID() };
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await request<T>(path, {
        method,
        body,
        key: intent.current.key,
      });
      intent.current = null;
      return result;
    } catch (cause) {
      setError(errorText(cause));
      return undefined;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { mutate, busy, error, clearError: () => setError(null) };
}
