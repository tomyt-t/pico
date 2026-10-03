import type { EditorialStatus } from "@pico/server/contracts";
import { recordRoute, routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Icon } from "@/web/components/primitives";

/** One line about the editorial state of a page: what changed since the last
 *  review, or that it is being updated. The details fold underneath. */
export function EditorialNotice({
  labId,
  status,
  pageId,
  discuss,
}: {
  labId: string;
  status?: EditorialStatus;
  pageId?: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (!status) return null;
  const page = status.pages.find((entry) => entry.pageId === pageId);
  const pending = page ? page.state !== "reviewed" : status.needsReview;
  const failed =
    pending &&
    status.lastRun &&
    ["failed", "stopped", "interrupted"].includes(status.lastRun.status);
  const active = !!status.activeRunId;
  if (!page && !status.pages.length && !status.needsReview && !active)
    return null;
  const changed = page?.changedRecords.length ?? 0;
  const label = active
    ? t("pages.reviewRunning")
    : pending && changed && page?.reviewedAt
      ? t("pages.reviewChangedSince", {
          count: changed,
          date: timestamp(page.reviewedAt),
        })
      : pending
        ? t("pages.reviewPending")
        : page?.reviewedAt
          ? t("pages.reviewedAt", { date: timestamp(page.reviewedAt) })
          : t("pages.reviewRecorded");
  const hasDetails =
    !!page &&
    (page.changedRecords.length +
      page.changedFiles.length +
      page.missingRecords.length +
      page.missingFiles.length +
      page.pending.length +
      page.invalidBlocks.length +
      page.shape.length >
      0 ||
      page.contentChanged ||
      page.contextChanged ||
      !!page.summary);
  return (
    <aside
      className={`editorial-notice${pending ? " pending" : ""}`}
      aria-label={t("pages.reviewStatus")}
    >
      <div className="editorial-notice-line">
        <Icon name={pending ? "flag" : "check"} size={14} />
        <strong>{label}</strong>
        {pending && !active && (
          <button
            className="text-button"
            type="button"
            onClick={() =>
              discuss(
                t("pages.reviewRequest", {
                  subject: page
                    ? `${page.title} (${page.pageId})`
                    : t("pages.allPages"),
                }),
              )
            }
          >
            {t("pages.reviewWithPico")}
          </button>
        )}
      </div>
      {page?.state === "unreviewed" && <p>{t("pages.reviewUnrecorded")}</p>}
      {!page && status.panoramaMissing && (
        <p>{t("pages.reviewPanoramaMissing")}</p>
      )}
      {failed && !active && <p>{t("pages.reviewInterrupted")}</p>}
      {hasDetails && page && (
        <details>
          <summary>{t("pages.reviewDetails")}</summary>
          {page.summary && <p>{page.summary}</p>}
          {page.contextChanged && <p>{t("pages.reviewContextChanged")}</p>}
          {page.contentChanged && <p>{t("pages.reviewContentChanged")}</p>}
          {page.changedRecords.length > 0 && (
            <p>
              {t("pages.reviewChanges", { count: page.changedRecords.length })}
            </p>
          )}
          {page.changedFiles.length > 0 && (
            <p>
              {t("pages.reviewFilesChanged", {
                paths: page.changedFiles.join(", "),
              })}
            </p>
          )}
          {page.missingRecords.length > 0 && (
            <p>
              {t("pages.reviewMissingRecords", {
                ids: page.missingRecords.join(", "),
              })}
            </p>
          )}
          {page.missingFiles.length > 0 && (
            <p>
              {t("pages.reviewMissingFiles", {
                paths: page.missingFiles.join(", "),
              })}
            </p>
          )}
          {page.invalidBlocks.length > 0 && (
            <p>
              {t("pages.reviewInvalidBlocks", {
                indices: page.invalidBlocks.join(", "),
              })}
            </p>
          )}
          {page.pending.length > 0 && (
            <ul>
              {[...new Set(page.pending)].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {page.shape.length > 0 && (
            <>
              <p>{t("pages.reviewShape", { count: page.shape.length })}</p>
              <ul className="editorial-shape">
                {page.shape.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}
          {page.changedRecords.length > 0 && (
            <ul className="editorial-references">
              {status.changes
                .filter((change) => page.changedRecords.includes(change.id))
                .map((change) => (
                  <li key={change.id}>
                    {change.revision === null ? (
                      <span>
                        {change.title} · {t("pages.reviewRemoved")}
                      </span>
                    ) : (
                      <a href={routePath(recordRoute(labId, change))}>
                        {change.title}
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </details>
      )}
    </aside>
  );
}
