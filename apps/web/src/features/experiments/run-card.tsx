import type { LabOverview, Run } from "@pico/lab/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { bytes, shortId, timestamp } from "@/web/components/format";
import { Code, Notice, Status } from "@/web/components/primitives";
import { RunLogs } from "@/web/features/experiments/run-logs";
import { RunMetrics } from "@/web/features/experiments/run-metrics";

export function RunCard({
  run,
  overview,
  refresh,
}: {
  run: Run;
  overview: LabOverview;
  refresh: () => void;
}) {
  const [logsOpen, setLogsOpen] = useState(false);
  const action = useMutation();
  const active = ["queued", "running"].includes(run.status);
  return (
    <article className="run-card">
      <div className="record-heading">
        <h3>
          Attempt {run.attempt}{" "}
          <span className="mono muted">{shortId(run.id)}</span>
        </h3>
        <Status value={run.status} />
      </div>
      {run.error && <Notice error>{run.error}</Notice>}
      <dl className="details-grid">
        <div>
          <dt>Started</dt>
          <dd>{timestamp(run.startedAt)}</dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>{timestamp(run.endedAt)}</dd>
        </div>
        <div>
          <dt>Command</dt>
          <dd className="mono">{run.command}</dd>
        </div>
        <div>
          <dt>Exit code</dt>
          <dd>{run.exitCode ?? "—"}</dd>
        </div>
        <div>
          <dt>Code snapshot</dt>
          <dd className="mono">
            {run.snapshot?.codeHash ?? "No snapshot recorded"}
          </dd>
        </div>
        <div>
          <dt>Reference run</dt>
          <dd className="mono">{run.referenceRunId ?? "Original attempt"}</dd>
        </div>
      </dl>
      <RunMetrics run={run} />
      <details>
        <summary>Preserved inputs and configuration</summary>
        {run.snapshot ? (
          <>
            <p className="meta" style={{ marginTop: 12 }}>
              Protocol revision {run.snapshot.experimentRevision}. This run
              keeps its own code and input manifests.
            </p>
            <Code>
              {JSON.stringify(
                {
                  protocol: run.snapshot.protocol,
                  criteria: run.snapshot.criteria,
                  args: run.snapshot.args,
                  config: run.snapshot.config,
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
          <p className="meta">A snapshot is not available for this run.</p>
        )}
      </details>
      {run.artifacts.length > 0 && (
        <details>
          <summary>Artifacts ({run.artifacts.length})</summary>
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
        <summary>Execution logs</summary>
        {logsOpen && <RunLogs labId={run.labId} runId={run.id} />}
      </details>
      <div className="actions" style={{ marginTop: 18 }}>
        <a
          className="pill-link"
          href={`/api${labPath(run.labId, `/runs/${run.id}/record`)}`}
          download={`pico-run-${run.id}.json`}
        >
          Export run record
        </a>
        {run.snapshot && (
          <a
            className="pill-link"
            href={`/api${labPath(run.labId, `/runs/${run.id}/archive`)}`}
            download={`pico-run-${run.id}-archive.json`}
          >
            Export snapshot + files
          </a>
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
            Cancel run
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
                ? "Enable local execution in laboratory settings"
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
            {action.busy ? "Requesting…" : "Repeat preserved snapshot"}
          </button>
        )}
      </div>
      {action.error && (
        <div style={{ marginTop: 12 }}>
          <Notice error>{action.error}</Notice>
        </div>
      )}
    </article>
  );
}
