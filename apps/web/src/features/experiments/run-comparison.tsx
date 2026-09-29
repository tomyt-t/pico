import type { LabOverview, Run } from "@pico/lab/contracts";
import { number } from "@/web/components/format";
import {
  Code,
  Empty,
  Notice,
  Section,
  Status,
} from "@/web/components/primitives";
import {
  compareMetrics,
  conditionsKey,
} from "@/web/features/experiments/metric-comparison";

export function RunComparison({
  overview,
  selected,
  onSelection,
  onClose,
}: {
  overview: LabOverview;
  selected: string[];
  onSelection: (ids: string[]) => void;
  onClose: () => void;
}) {
  const runs = selected.flatMap((id) => {
    const run = overview.runs.find((row) => row.id === id);
    return run ? [run] : [];
  });
  const title = (run: Run) =>
    `${overview.experiments.find((entry) => entry.id === run.experimentId)?.title ?? "Experiment"} · attempt ${run.attempt}`;
  const rows = compareMetrics(runs);
  const varied = new Set(runs.map(conditionsKey)).size > 1;
  return (
    <div>
      <div className="section-heading">
        <h2>Compare executions</h2>
        <button className="small" type="button" onClick={onClose}>
          Back to experiments
        </button>
      </div>
      <div className="compare-grid">
        {selected.map((id, index) => (
          <label className="field" key={index === 0 ? "first" : "second"}>
            Execution {index + 1}
            <select
              name={`comparisonRun${index + 1}`}
              value={id}
              onChange={(event) =>
                onSelection(
                  selected.map((value, at) =>
                    at === index ? event.target.value : value,
                  ),
                )
              }
            >
              {overview.runs.map((run) => (
                <option
                  key={run.id}
                  value={run.id}
                  disabled={selected.some(
                    (value, at) => at !== index && value === run.id,
                  )}
                >
                  {title(run)} · {run.status}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {varied && (
        <div style={{ marginBottom: 20 }}>
          <Notice>
            Preserved conditions differ across these runs. Check code, datasets,
            configuration and protocol before interpreting a difference.
          </Notice>
        </div>
      )}
      {runs.some((run) => run.status !== "succeeded") && (
        <div style={{ marginBottom: 20 }}>
          <Notice>
            Some executions are incomplete or unsuccessful. Their available
            metrics may be partial.
          </Notice>
        </div>
      )}
      {runs.some((run) => !run.snapshot) && (
        <Notice>
          Some runs have no preserved snapshot; their conditions cannot be fully
          compared.
        </Notice>
      )}
      <Section title="Measured values">
        <p className="meta">
          Rows match metric name, unit, split and step exactly. Missing or
          ambiguous values remain blank.
        </p>
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric / condition</th>
                  {runs.map((run) => (
                    <th key={run.id} className="num">
                      {title(run)}
                      <div>
                        <Status value={run.status} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.name}
                      <div className="meta">
                        {row.unit ?? "No unit"} · {row.split ?? "No split"} ·{" "}
                        {row.step === null ? "No step" : `Step ${row.step}`}
                      </div>
                    </td>
                    {row.values.map((value, index) => (
                      <td key={runs[index]?.id ?? index} className="num mono">
                        {value === null ? "—" : number(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No comparable observations yet">
            Metrics appear after executions produce them.
          </Empty>
        )}
      </Section>
      <div className="compare-grid" style={{ marginTop: 20 }}>
        {runs.map((run) => (
          <Section key={run.id} title={title(run)}>
            <dl className="details-grid">
              <div>
                <dt>Code hash</dt>
                <dd className="mono">{run.snapshot?.codeHash ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Entrypoint</dt>
                <dd className="mono">
                  {run.snapshot?.entrypoint ?? "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Dataset versions</dt>
                <dd>
                  {run.snapshot?.datasetInputs
                    .map((input) => `${input.name} ${input.version}`)
                    .join(", ") || "None recorded"}
                </dd>
              </div>
              <div>
                <dt>Configuration</dt>
                <dd className="mono">
                  {JSON.stringify(run.snapshot?.config ?? null)}
                </dd>
              </div>
            </dl>
            <details style={{ marginTop: 15 }}>
              <summary>All preserved conditions</summary>
              <Code>{JSON.stringify(run.snapshot, null, 2)}</Code>
            </details>
          </Section>
        ))}
      </div>
    </div>
  );
}
