import type { Result, Revision, Run } from "@pico/lab/contracts";
import { useEffect, useState } from "react";
import { errorText, labPath, request } from "@/web/api/http-client";
import { author, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Loading, Notice } from "@/web/components/primitives";
import { ResultEvidence } from "@/web/features/experiments/result-evidence";

type HistoricalResult = Omit<Revision, "snapshot"> & { snapshot: Result };

export function ResultHistory({
  result,
  runs,
  focus,
}: {
  result: Result;
  runs: Run[];
  focus?: string;
}) {
  const { t } = useTranslation();
  const prefix = `result-${result.id}-revision-`;
  const requested = focus?.startsWith(prefix)
    ? Number(focus.slice(prefix.length))
    : undefined;
  const selected =
    requested !== undefined && Number.isSafeInteger(requested) && requested > 0
      ? requested
      : undefined;
  const [open, setOpen] = useState(selected !== undefined);
  useEffect(() => {
    if (selected !== undefined) setOpen(true);
  }, [selected]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("workspace.resultHistory")}</summary>
      {open && <HistoryRows result={result} runs={runs} selected={selected} />}
    </details>
  );
}

function HistoryRows({
  result,
  runs,
  selected,
}: {
  result: Result;
  runs: Run[];
  selected?: number;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HistoricalResult[]>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly replaces the failed request.
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setRows(undefined);
    void request<HistoricalResult[]>(
      labPath(
        result.labId,
        `/records/result/${encodeURIComponent(result.id)}/history`,
      ),
      { signal: controller.signal },
    )
      .then((history) => {
        if (!controller.signal.aborted)
          setRows(
            history.sort((a, b) => b.snapshot.revision - a.snapshot.revision),
          );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [result.id, result.labId, retry]);
  useEffect(() => {
    if (rows && selected !== undefined)
      document
        .getElementById(`result-${result.id}-revision-${selected}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [rows, selected, result.id]);
  if (error)
    return (
      <Notice error>
        {error}{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          {t("common.retry")}
        </button>
      </Notice>
    );
  if (!rows) return <Loading>{t("common.loadingRecords")}</Loading>;
  return (
    <>
      {!rows.length && <p className="meta">{t("workspace.noResultHistory")}</p>}
      {rows.map((revision) => (
        <article
          className="record"
          key={revision.id}
          id={`result-${result.id}-revision-${revision.snapshot.revision}`}
        >
          <p className="eyebrow">
            {t("overview.revision", { revision: revision.snapshot.revision })}
          </p>
          <p className="meta">
            {t("workspace.revisionChange", { reason: revision.reason })} ·{" "}
            {t("common.by", { author: author(revision.author.kind) })} ·{" "}
            {timestamp(revision.createdAt)}
          </p>
          <p className="eyebrow">
            {t("workspace.observations", {
              runs: t("common.runs", {
                count: revision.snapshot.runIds.length,
              }),
            })}
          </p>
          <Markdown>{revision.snapshot.observations}</Markdown>
          <p className="eyebrow">{t("workspace.interpretation")}</p>
          <Markdown>{revision.snapshot.interpretation}</Markdown>
          <p className="limitations">
            <strong>{t("common.limitations")}</strong>{" "}
            {revision.snapshot.limitations}
          </p>
          <ResultEvidence result={revision.snapshot} runs={runs} />
        </article>
      ))}
    </>
  );
}
