import type { LabOverview, Question } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { useTranslation } from "@/web/components/i18n";
import { Status } from "@/web/components/primitives";
import { ClampedText } from "@/web/components/record-text";
import { questionRecords } from "@/web/features/overview/question-records";

export function QuestionRecord({
  row,
  overview,
}: {
  row: Question;
  overview: LabOverview;
}) {
  const { t } = useTranslation();
  const own = questionRecords(overview, row.id);
  const latest = own.conclusions.find((entry) => entry.status !== "retracted");
  return (
    <article className="record">
      <div className="record-heading">
        <h3>
          <a
            href={routePath({
              labId: overview.lab.id,
              page: "overview",
              id: row.id,
            })}
          >
            {row.text}
          </a>
        </h3>
        <Status value={row.status} />
      </div>
      {row.context && <ClampedText lines={3}>{row.context}</ClampedText>}
      <div className="record-meta">
        {[...own.hypotheses, ...own.conclusions].some(
          (entry) => entry.needsReview,
        ) && (
          <span className="status status-paused">
            {t("common.needsReview")}
          </span>
        )}
        <span>
          {t("overview.hypothesisCount", { count: own.hypotheses.length })}
        </span>
        <span>
          {t("overview.experimentCount", { count: own.experiments.length })}
        </span>
        <span>
          {t("overview.conclusionCount", { count: own.conclusions.length })}
        </span>
      </div>
      {latest && (
        <div className="latest-conclusion">
          <p className="eyebrow">{t("overview.latestConclusion")}</p>
          {latest.needsReview && (
            <span className="status status-paused">
              {t("common.needsReview")}
            </span>
          )}
          <ClampedText lines={3}>{latest.statement}</ClampedText>
        </div>
      )}
    </article>
  );
}
