import type { ResearchRecord } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { selectPages } from "@/web/features/pages/page-selection";

/** Owned by the laboratory workspace and shared with the sidebar and reader. */
export function useLabPages(labId: string) {
  const query = usePoll<ResearchRecord[]>(
    labPath(labId, "/records?kind=page&limit=5000"),
    10_000,
  );
  return { ...query, ...selectPages(labId, query.data ?? []) };
}
