import { join } from "node:path";
import type { Metric, RunRecord } from "@/runner/execution-contract";
import { exists, listFiles, readBytes } from "@/runner/files";

export function parseMetrics(input: unknown): Metric[] {
  if (!Array.isArray(input) || input.length > 1_000)
    throw new Error("metrics.json must be an array of at most 1000 metrics");
  const identities = new Set<string>();
  return input.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new Error("Metric must be an object");
    const value = item as Record<string, unknown>;
    if (
      typeof value.name !== "string" ||
      !value.name.trim() ||
      value.name.length > 200 ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value)
    )
      throw new Error("Metric requires a name and a finite numeric value");
    if (
      (value.unit != null && typeof value.unit !== "string") ||
      (value.split != null && typeof value.split !== "string") ||
      (value.step != null &&
        (typeof value.step !== "number" || !Number.isFinite(value.step)))
    )
      throw new Error("Invalid metric dimensions");
    const metric = {
      name: value.name,
      value: value.value,
      ...(value.unit != null ? { unit: value.unit as string } : {}),
      ...(value.split != null ? { split: value.split as string } : {}),
      ...(value.step != null ? { step: value.step as number } : {}),
    };
    const identity = JSON.stringify([
      metric.name,
      metric.unit,
      metric.split,
      metric.step,
    ]);
    if (identities.has(identity))
      throw new Error(
        "Duplicate metric identity; use split or step to distinguish observations",
      );
    identities.add(identity);
    return metric;
  });
}

export async function collectOutputs(
  directory: string,
  record: RunRecord,
): Promise<RunRecord> {
  try {
    if (await exists(join(directory, "outputs", "metrics.json")))
      record.metrics = parseMetrics(
        JSON.parse(
          (
            await readBytes(join(directory, "outputs"), "metrics.json")
          ).toString("utf8"),
        ),
      );
    record.artifacts = await listFiles(join(directory, "outputs"));
  } catch (error) {
    record.error = `Invalid experiment output: ${error instanceof Error ? error.message : String(error)}`;
    if (record.status === "succeeded") record.status = "failed";
  }
  return record;
}

export async function readLogs(directory: string, truncated?: boolean) {
  const tail = async (name: string) => {
    const bytes = await readBytes(directory, name);
    const limit = 128 * 1024;
    return `${bytes.length > limit ? "[Earlier log lines omitted; showing final 128 KiB]\n" : ""}${bytes.subarray(Math.max(0, bytes.length - limit)).toString("utf8")}`;
  };
  return {
    stdout: await tail("stdout.log"),
    stderr: `${await tail("stderr.log")}${truncated ? "\n[Log storage limit reached: at most 1 MiB was retained per stream.]\n" : ""}`,
  };
}
