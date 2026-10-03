import type { ResearchRecord } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";

export function useRecords(labId: string, interval = 5_000) {
  return usePoll<ResearchRecord[]>(
    labPath(labId, "/records?limit=5000"),
    interval,
  );
}
