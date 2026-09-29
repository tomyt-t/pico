import { useCallback, useEffect, useState } from "react";
import { errorText, type ResponseCache, request } from "@/web/api/http-client";

export function pollingDelay(interval: number, failures: number) {
  return Math.min(60_000, interval * 2 ** Math.min(failures, 6));
}

export function usePoll<T>(path: string | null, interval = 5000) {
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ path, loading: !!path });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The revision is an explicit refresh signal that replaces the active request.
  useEffect(() => {
    if (!path) {
      setState({ path, loading: false });
      return;
    }
    let closed = false;
    let busy = false;
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let failures = 0;
    const cache: ResponseCache<T> = {};
    setState((previous) =>
      previous.path === path ? previous : { path, loading: true },
    );
    const read = async () => {
      if (closed || busy) return;
      busy = true;
      window.clearTimeout(timer);
      controller = new AbortController();
      try {
        const data = await request<T>(path, {
          signal: controller.signal,
          cache,
        });
        failures = 0;
        if (!closed)
          setState((previous) =>
            previous.path === path && previous.data === data && !previous.error
              ? previous
              : { path, data, loading: false },
          );
      } catch (error) {
        if (!closed && !controller.signal.aborted) {
          failures++;
          setState((previous) => ({
            path,
            data: previous.path === path ? previous.data : undefined,
            error: errorText(error),
            loading: false,
          }));
        }
      } finally {
        busy = false;
        if (!closed)
          timer = window.setTimeout(
            () => {
              if (document.visibilityState === "visible") void read();
            },
            pollingDelay(interval, failures),
          );
      }
    };
    void read();
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      closed = true;
      controller?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, interval, revision]);
  return {
    ...(state.path === path
      ? state
      : { loading: !!path, data: undefined, error: undefined }),
    refresh,
  };
}
