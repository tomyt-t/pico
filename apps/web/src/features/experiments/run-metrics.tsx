import type { Run } from "@pico/lab/contracts";
import { number } from "@/web/components/format";

export function RunMetrics({ run }: { run: Run }) {
  return run.metrics.length ? (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Split</th>
            <th>Step</th>
            <th className="num">Value</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {run.metrics.map((metric, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Collected run metrics are immutable; duplicate metric dimensions must remain visible.
            <tr key={`${metric.name}-${metric.split}-${metric.step}-${index}`}>
              <td>{metric.name}</td>
              <td>{metric.split ?? "—"}</td>
              <td>{metric.step ?? "—"}</td>
              <td className="num mono">{number(metric.value)}</td>
              <td>{metric.unit ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="meta">No metrics collected for this run.</p>
  );
}
