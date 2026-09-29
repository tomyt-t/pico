import type { Conclusion, LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { author, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Status } from "@/web/components/primitives";
import { ClampedText, IdText } from "@/web/components/record-text";
import { ResultLinks } from "@/web/features/overview/result-links";

export function ConclusionRecord({
  row,
  overview,
}: {
  row: Conclusion;
  overview: LabOverview;
}) {
  const { t } = useTranslation();
  return (
    <article className="record" id={`conclusion-${row.id}`}>
      <div className="chip-row">
        <Status value={row.status} />
        {row.needsReview && (
          <span className="status status-paused">
            {t("common.needsReview")}
          </span>
        )}
        <span className={`status status-confidence-${row.confidence}`}>
          {t(`confidence.${row.confidence}`)}
        </span>
      </div>
      <ClampedText className="conclusion-statement">
        {row.statement}
      </ClampedText>
      <div className="record-meta">
        <time dateTime={row.createdAt}>{timestamp(row.createdAt)}</time>
        <span>{t("common.by", { author: author(row.author.kind) })}</span>
      </div>
      {row.limitations && (
        <p className="limitations">
          <strong>{t("common.limitations")}</strong>{" "}
          <IdText>{row.limitations}</IdText>
        </p>
      )}
      <div className="link-list">
        <ResultLinks row={row} overview={overview} />
        {row.paperIds.map((id) => (
          <a
            key={id}
            href={routePath({ labId: overview.lab.id, page: "library", id })}
          >
            {overview.papers.find((entry) => entry.id === id)?.title ??
              t("overview.referencedPaper")}
          </a>
        ))}
      </div>
    </article>
  );
}
