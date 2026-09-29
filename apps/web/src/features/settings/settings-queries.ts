import type { PiCatalog, ProviderStatus } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
export function useModelCatalog() {
  return usePoll<PiCatalog>("/providers", 15000);
}
export function useProviderStatus(labId?: string) {
  return usePoll<ProviderStatus>(
    labId ? labPath(labId, "/provider") : null,
    30000,
  );
}
