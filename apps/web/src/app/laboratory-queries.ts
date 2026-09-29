import type { Lab, LabStatus } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
export function useLaboratories() {
  return usePoll<Lab[]>("/labs", 15000);
}
export function useLaboratoryStatus(labId: string) {
  return usePoll<LabStatus>(labId ? labPath(labId, "/status") : null, 1500);
}
