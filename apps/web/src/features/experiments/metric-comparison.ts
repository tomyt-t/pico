import type { Metric, Run } from "@pico/lab/contracts";
export function metricKey(
  metric: Pick<Metric, "name" | "unit" | "split" | "step">,
): string {
  return JSON.stringify([metric.name, metric.unit, metric.split, metric.step]);
}
export function compareMetrics(runs: readonly Run[]) {
  const rows = new Map<
    string,
    Pick<Metric, "name" | "unit" | "split" | "step">
  >();
  for (const run of runs)
    for (const metric of run.metrics)
      rows.set(metricKey(metric), {
        name: metric.name,
        unit: metric.unit,
        split: metric.split,
        step: metric.step,
      });
  return [...rows].map(([key, selector]) => ({
    key,
    ...selector,
    values: runs.map((run) => {
      const matches = run.metrics.filter((metric) => metricKey(metric) === key);
      return matches.length === 1 ? (matches[0]?.value ?? null) : null;
    }),
  }));
}
export function latestRun(
  runs: readonly Run[],
  experimentId: string,
): Run | undefined {
  return runs
    .filter((run) => run.experimentId === experimentId)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

/** Compare preserved conditions independently of object key insertion order. */
export function conditionsKey(run: Run): string {
  const snapshot = run.snapshot;
  if (!snapshot) return "unknown";
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entry]) => [key, stable(entry)]),
          )
        : value;
  return JSON.stringify(
    stable({
      protocol: snapshot.protocol,
      criteria: snapshot.criteria,
      entrypoint: snapshot.entrypoint,
      runtime: snapshot.runtime,
      args: snapshot.args,
      config: snapshot.config,
      codeHash: snapshot.codeHash,
      inputs: snapshot.datasetInputs
        .map((input) => ({
          id: input.datasetVersionId,
          hash: input.manifestHash,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      environment: snapshot.environment,
    }),
  );
}
