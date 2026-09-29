import type { Run } from "@pico/lab/contracts";
import { locale, number } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Section, Status } from "@/web/components/primitives";
import {
  compareMetrics,
  conditionsKey,
} from "@/web/features/experiments/metric-comparison";

export function attemptDeltas(values: readonly (number | null)[]) {
  return values.map((value, index) => {
    const previous = values
      .slice(0, index)
      .reverse()
      .find((entry): entry is number => entry !== null);
    if (value === null || previous === undefined) return null;
    const delta = value - previous;
    return Math.abs(delta) < 1e-9 ? 0 : delta;
  });
}

function signed(value: number): string {
  const magnitude = new Intl.NumberFormat(locale(), {
    maximumSignificantDigits: 3,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : "−"}${magnitude}`;
}

export function AttemptComparison({ runs }: { runs: readonly Run[] }) {
  const { t } = useTranslation();
  const ordered = [...runs].sort((a, b) => a.attempt - b.attempt);
  const rows = compareMetrics(ordered);
  const conditions = ordered.map(conditionsKey);
  if (ordered.length < 2 || !rows.length) return null;
  return (
    <Section title={t("attempts.title")}>
      <p className="meta">{t("attempts.description")}</p>
      <div className="table-scroll attempt-comparison">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("metrics.metric")}</th>
              {ordered.map((run, index) => (
                <th key={run.id} className="num">
                  <span className="attempt-label">
                    {t("common.attempt", { attempt: run.attempt })}
                  </span>
                  <Status value={run.status} />
                  {index > 0 && (
                    <span
                      className={
                        conditions[index] === conditions[index - 1]
                          ? "conditions same"
                          : "conditions changed"
                      }
                    >
                      {conditions[index] === conditions[index - 1]
                        ? t("attempts.sameConditions")
                        : t("attempts.changedConditions")}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const deltas = attemptDeltas(row.values);
              return (
                <tr key={row.key}>
                  <td>
                    <span className="mono">{row.name}</span>
                    {(row.split || row.step !== null || row.unit) && (
                      <div className="meta">
                        {[
                          row.split,
                          row.step === null
                            ? null
                            : t("attempts.step", { step: row.step }),
                          row.unit,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  {row.values.map((value, index) => {
                    const delta = deltas[index];
                    return (
                      <td
                        key={ordered[index]?.id ?? index}
                        className={delta ? "num mono changed" : "num mono"}
                      >
                        {value === null ? "—" : number(value)}
                        {delta ? (
                          <span className="delta">{signed(delta)}</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
