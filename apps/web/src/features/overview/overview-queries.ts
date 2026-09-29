import type { LabOverview } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
export function useOverviewOverview(labId: string) {
  return usePoll<LabOverview>(labPath(labId, "/overview"), 1500);
}
