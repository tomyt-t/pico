import type { LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { useTranslation } from "@/web/components/i18n";

/** Display the evidence revision that was assessed, even after a correction. */
export function ResultLinks({
  row,
  overview,
}: {
  row: {
    resultIds: string[];
    resultRevisions?: { resultId: string; revision: number }[];
  };
  overview: {
    lab: Pick<LabOverview["lab"], "id">;
    results: LabOverview["results"];
  };
}) {
  const { t } = useTranslation();
  return (
    <>
      {row.resultIds.map((id) => {
        const result = overview.results.find((entry) => entry.id === id);
        const basis = row.resultRevisions?.find(
          (entry) => entry.resultId === id,
        );
        return result ? (
          <a
            key={id}
            href={routePath({
              labId: overview.lab.id,
              page: "experiments",
              id: result.experimentId,
              tab: "overview",
              focus:
                basis && basis.revision !== result.revision
                  ? `result-${id}-revision-${basis.revision}`
                  : `result-${id}`,
            })}
          >
            {t("overview.analysisOf", { count: result.runIds.length })}
            {basis && (
              <> · {t("overview.revision", { revision: basis.revision })}</>
            )}
          </a>
        ) : (
          <span className="meta" key={id}>
            {t("overview.analysisId", { id })}
          </span>
        );
      })}
    </>
  );
}
