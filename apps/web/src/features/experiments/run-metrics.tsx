import type { Run } from "@pico/lab/contracts";
import { number } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";

export function RunMetrics({ run }: { run: Run }) {
  const { t } = useTranslation();
  const splits = run.metrics.some((metric) => metric.split != null);
  const steps = run.metrics.some((metric) => metric.step != null);
  const units = run.metrics.some((metric) => metric.unit != null);
  return run.metrics.length ? (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("metrics.metric")}</th>
            {splits && <th>{t("metrics.split")}</th>}
            {steps && <th>{t("metrics.step")}</th>}
            <th className="num">{t("metrics.value")}</th>
            {units && <th>{t("metrics.unit")}</th>}
          </tr>
        </thead>
        <tbody>
          {run.metrics.map((metric, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Collected run metrics are immutable; duplicate metric dimensions must remain visible.
            <tr key={`${metric.name}-${metric.split}-${metric.step}-${index}`}>
              <td className="mono">{metric.name}</td>
              {splits && <td>{metric.split ?? "—"}</td>}
              {steps && <td>{metric.step ?? "—"}</td>}
              <td className="num mono">{number(metric.value)}</td>
              {units && <td className="muted">{metric.unit ?? ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="meta">{t("metrics.none")}</p>
  );
}
