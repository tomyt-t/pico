import type { LabOverview, Run } from "@pico/lab/contracts";
import { number, statusLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
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
  const { t } = useTranslation();
  const runs = selected.flatMap((id) => {
    const run = overview.runs.find((row) => row.id === id);
    return run ? [run] : [];
  });
  const title = (run: Run) =>
    t("common.attemptOf", {
      title:
        overview.experiments.find((entry) => entry.id === run.experimentId)
          ?.title ?? t("common.experiment"),
      attempt: run.attempt,
    });
  const rows = compareMetrics(runs);
  const varied = new Set(runs.map(conditionsKey)).size > 1;
  return (
    <div>
      <div className="section-heading">
        <h2>{t("comparison.title")}</h2>
        <button className="small" type="button" onClick={onClose}>
          {t("comparison.back")}
        </button>
      </div>
      <div className="compare-grid">
        {selected.map((id, index) => (
          <label className="field" key={index === 0 ? "first" : "second"}>
            {t("comparison.execution", { index: index + 1 })}
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
                  {title(run)} · {statusLabel(run.status)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {varied && (
        <div style={{ marginBottom: 20 }}>
          <Notice>{t("comparison.conditionsDiffer")}</Notice>
        </div>
      )}
      {runs.some((run) => run.status !== "succeeded") && (
        <div style={{ marginBottom: 20 }}>
          <Notice>{t("comparison.incomplete")}</Notice>
        </div>
      )}
      {runs.some((run) => !run.snapshot) && (
        <Notice>{t("comparison.noSnapshot")}</Notice>
      )}
      <Section title={t("comparison.measured")}>
        <p className="meta">{t("comparison.measuredHint")}</p>
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("comparison.metricCondition")}</th>
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
                        {row.unit ?? t("comparison.noUnit")} ·{" "}
                        {row.split ?? t("comparison.noSplit")} ·{" "}
                        {row.step === null
                          ? t("comparison.noStep")
                          : t("comparison.stepN", { step: row.step })}
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
          <Empty title={t("comparison.noComparable")}>
            {t("comparison.noComparableBody")}
          </Empty>
        )}
      </Section>
      <div className="compare-grid" style={{ marginTop: 20 }}>
        {runs.map((run) => (
          <Section key={run.id} title={title(run)}>
            <dl className="details-grid">
              <div>
                <dt>{t("comparison.codeHash")}</dt>
                <dd className="mono">
                  {run.snapshot?.codeHash ?? t("comparison.unknown")}
                </dd>
              </div>
              <div>
                <dt>{t("comparison.entrypoint")}</dt>
                <dd className="mono">
                  {run.snapshot?.entrypoint ?? t("comparison.unknown")}
                </dd>
              </div>
              <div>
                <dt>{t("comparison.datasetVersions")}</dt>
                <dd>
                  {run.snapshot?.datasetInputs
                    .map((input) => `${input.name} ${input.version}`)
                    .join(", ") || t("comparison.noneRecorded")}
                </dd>
              </div>
              <div>
                <dt>{t("comparison.configuration")}</dt>
                <dd className="mono">
                  {JSON.stringify(run.snapshot?.config ?? null)}
                </dd>
              </div>
            </dl>
            <details style={{ marginTop: 15 }}>
              <summary>{t("comparison.allConditions")}</summary>
              <Code language="json">
                {JSON.stringify(run.snapshot, null, 2)}
              </Code>
            </details>
          </Section>
        ))}
      </div>
    </div>
  );
}
