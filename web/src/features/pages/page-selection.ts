import type { ResearchRecord } from "@pico/server/contracts";

/** One designated panorama; every other page remains reachable in the lab. */
export function selectPages(labId: string, records: ResearchRecord[]) {
  const ordered = records
    .filter((record) => record.labId === labId && record.kind === "page")
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  const panorama = ordered.find(
    (record) => record.fields.placement === "panorama",
  );
  return {
    panorama,
    pages: ordered.filter((record) => record !== panorama),
  };
}
