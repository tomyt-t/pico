import type { SessionEvent } from "@pico/server/contracts";
import { useEffect, useRef } from "react";
import { labPath } from "@/web/api/http-client";

/** Subscribes to the laboratory's session events. The browser reconnects on its own. */
export function useSessionEvents(
  labId: string | null,
  handler: (event: SessionEvent) => void,
  onDisconnect?: () => void,
): void {
  const current = useRef({ handler, onDisconnect });
  current.current = { handler, onDisconnect };
  useEffect(() => {
    if (!labId) return;
    const source = new EventSource(`/api${labPath(labId, "/events")}`);
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        current.current.handler(JSON.parse(message.data) as SessionEvent);
      } catch {
        /* keepalive or malformed frame */
      }
    };
    source.onerror = () => current.current.onDisconnect?.();
    return () => source.close();
  }, [labId]);
}
