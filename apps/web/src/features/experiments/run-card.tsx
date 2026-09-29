import type { LabOverview, Run } from "@pico/lab/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { useRoute } from "@/web/app/navigation";
import { bytes, shortId, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Code, Notice, Status } from "@/web/components/primitives";
import { Hash } from "@/web/components/record-text";
import { RunLogs } from "@/web/features/experiments/run-logs";
import { RunMetrics } from "@/web/features/experiments/run-metrics";

export function RunCard({
  run,
  overview,
  refresh,
  expanded = true,
}: {
  run: Run;
  overview: LabOverview;
  refresh: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const [logsOpen, setLogsOpen] = useState(false);
  const route = useRoute();
  const [cleaned, setCleaned] = useState(false);
  const action = useMutation();
  const active = ["queued", "running"].includes(run.status);
  return (
    <details
      id={`run-${run.id}`}
      className="run-card"
      open={expanded || route?.focus === `run-${run.id}`}
    >
      <summary className="record-heading run-summary">
        <h3>
          {t("common.attempt", { attempt: run.attempt })}{" "}
          <span className="mono muted">{shortId(run.id)}</span>
        </h3>
        <span className="meta">
          {timestamp(run.startedAt ?? run.createdAt)}
        </span>
        <Status value={run.status} />
      </summary>
      {run.error && <Notice error>{run.error}</Notice>}
      <dl className="details-grid">
        <div>
          <dt>{t("run.started")}</dt>
          <dd>{timestamp(run.startedAt)}</dd>
        </div>
        <div>
          <dt>{t("run.ended")}</dt>
          <dd>{timestamp(run.endedAt)}</dd>
        </div>
        <div>
          <dt>{t("run.command")}</dt>
          <dd className="mono">{run.command}</dd>
        </div>
        <div>
          <dt>{t("run.exitCode")}</dt>
          <dd className="mono">{run.exitCode ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("run.codeSnapshot")}</dt>
          <dd>
            {run.snapshot?.codeHash ? (
              <Hash value={run.snapshot.codeHash} />
            ) : (
              t("run.noSnapshot")
            )}
          </dd>
        </div>
        <div>
          <dt>{t("run.referenceRun")}</dt>
          <dd>
            {run.referenceRunId ? (
              <Hash value={run.referenceRunId} />
            ) : (
              t("run.originalAttempt")
            )}
          </dd>
        </div>
      </dl>
      <RunMetrics run={run} />
      <details>
        <summary>{t("run.preserved")}</summary>
        {run.snapshot ? (
          <>
            <p className="meta" style={{ marginTop: 12 }}>
              {t("run.protocolRevision", {
                revision: run.snapshot.experimentRevision,
              })}
            </p>
            <Code language="json">
              {JSON.stringify(
                {
                  protocol: run.snapshot.protocol,
                  criteria: run.snapshot.criteria,
                  args: run.snapshot.args,
                  config: run.snapshot.config,
                  resources: run.snapshot.resources,
                  environment: run.snapshot.environment,
                  codeFiles: run.snapshot.codeFiles,
                  datasetInputs: run.snapshot.datasetInputs,
                },
                null,
                2,
              )}
            </Code>
          </>
        ) : (
          <p className="meta">{t("run.snapshotUnavailable")}</p>
        )}
      </details>
      {run.artifacts.length > 0 && (
        <details>
          <summary>
            {t("run.artifacts", { count: run.artifacts.length })}
          </summary>
          <ul>
            {run.artifacts.map((artifact) => (
              <li key={artifact.path}>
                <a
                  href={`/api${labPath(run.labId, `/runs/${run.id}/artifact?path=${encodeURIComponent(artifact.path)}`)}`}
                  download={artifact.path.split("/").at(-1)}
                >
                  {artifact.path}
                </a>{" "}
                <span className="meta">{bytes(artifact.size)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details onToggle={(event) => setLogsOpen(event.currentTarget.open)}>
        <summary>{t("run.logs")}</summary>
        {logsOpen && <RunLogs labId={run.labId} runId={run.id} />}
      </details>
      <div className="actions run-actions">
        {!active && (
          <button
            type="button"
            disabled={action.busy || cleaned}
            onClick={async () => {
              const result = await action.mutate(
                labPath(run.labId, `/execution/${run.id}/cleanup`),
              );
              if (result) setCleaned(true);
            }}
          >
            {cleaned ? t("operations.cleaned") : t("operations.cleanup")}
          </button>
        )}
        {active ? (
          <button
            className="small danger"
            type="button"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.mutate(
                  labPath(run.labId, `/runs/${run.id}/cancel`),
                )
              )
                refresh();
            }}
          >
            {t("run.cancel")}
          </button>
        ) : (
          <button
            className="small"
            type="button"
            disabled={
              action.busy ||
              !run.snapshot ||
              !overview.lab.settings.executionEnabled
            }
            title={
              !overview.lab.settings.executionEnabled
                ? t("run.enableExecution")
                : undefined
            }
            onClick={async () => {
              if (
                await action.mutate(
                  labPath(run.labId, `/experiments/${run.experimentId}/runs`),
                  { referenceRunId: run.id },
                )
              )
                refresh();
            }}
          >
            {action.busy ? t("common.requesting") : t("run.repeat")}
          </button>
        )}
        <a
          className="pill-link"
          href={`/api${labPath(run.labId, `/runs/${run.id}/record`)}`}
          download={`pico-run-${run.id}.json`}
        >
          {t("run.exportRecord")}
        </a>
        {run.snapshot && (
          <a
            className="pill-link"
            href={`/api${labPath(run.labId, `/runs/${run.id}/archive`)}`}
            download={`pico-run-${run.id}-archive.json`}
          >
            {t("run.exportSnapshot")}
          </a>
        )}
      </div>
      {action.error && (
        <div style={{ marginTop: 12 }}>
          <Notice error>{action.error}</Notice>
        </div>
      )}
    </details>
  );
}
