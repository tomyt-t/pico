import { isDeepStrictEqual } from "node:util";
import type { LabOverview, Run, RunSnapshot } from "@pico/lab/contracts";

const close = (left: number, right: number) => Math.abs(left - right) <= 1e-10;

function inputs(snapshot: RunSnapshot | null) {
  if (!snapshot) throw new Error("Validation run has no preserved snapshot");
  const { createdAt: _at, environment: _environment, ...preserved } = snapshot;
  return preserved;
}

/** Checks the prescribed deterministic data, not a statistical population claim. */
export function verifyPairs(text: string, path: string) {
  let rows: unknown;
  if (path.endsWith(".csv")) {
    const lines = text.trim().split(/\r?\n/);
    const headers = (lines.shift() ?? "")
      .split(",")
      .map((value) => value.trim());
    rows = lines.map((line) =>
      Object.fromEntries(
        line
          .split(",")
          .map((value, index) => [headers[index] ?? "", Number(value.trim())]),
      ),
    );
  } else {
    const parsed: unknown = JSON.parse(text);
    rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).observations ??
          (parsed as Record<string, unknown>).rows ??
          (parsed as Record<string, unknown>).data)
        : undefined;
  }
  if (!Array.isArray(rows) || rows.length !== 24)
    throw new Error("Expected exactly 24 preserved paired observations");
  const pairs = rows
    .map((row) => {
      if (!row || typeof row !== "object")
        throw new Error("Observation is not a pair");
      const { baseline, treatment, difference } = row as Record<
        string,
        unknown
      >;
      if (
        typeof baseline !== "number" ||
        typeof treatment !== "number" ||
        !Number.isFinite(baseline) ||
        !Number.isFinite(treatment)
      )
        throw new Error("Pair must contain numeric baseline and treatment");
      if (
        difference !== undefined &&
        (typeof difference !== "number" ||
          !close(difference, treatment - baseline))
      )
        throw new Error("Stored difference does not match its pair");
      return { baseline, treatment };
    })
    .sort((a, b) => a.baseline - b.baseline);
  for (const [index, pair] of pairs.entries()) {
    if (
      !close(pair.baseline, index / 24) ||
      !close(pair.treatment, pair.baseline + 0.2)
    )
      throw new Error(
        "Preserved pairs do not match the prescribed deterministic protocol",
      );
  }
  const delta =
    pairs.reduce((sum, pair) => sum + pair.treatment - pair.baseline, 0) / 24;
  return { count: pairs.length, delta };
}

export async function verifyGlmProtocol(
  overview: Pick<
    LabOverview,
    "runs" | "hypotheses" | "results" | "conclusions"
  >,
  readOutput: (run: Run, path: string) => Promise<string>,
) {
  const reproduced = overview.runs.find(
    (run) =>
      run.status === "succeeded" &&
      run.referenceRunId &&
      overview.runs.some(
        (original) =>
          original.id === run.referenceRunId && original.status === "succeeded",
      ),
  );
  const original = overview.runs.find(
    (run) => run.id === reproduced?.referenceRunId,
  );
  if (!original || !reproduced)
    throw new Error(
      "A successful original run and its successful reproduction are required",
    );
  if (
    original.experimentId !== reproduced.experimentId ||
    !isDeepStrictEqual(inputs(original.snapshot), inputs(reproduced.snapshot))
  )
    throw new Error("Reproduction changed preserved scientific inputs");
  const evidence = [];
  for (const run of [original, reproduced]) {
    const metrics = run.metrics.filter(
      (metric) =>
        metric.name === "delta" &&
        metric.unit === null &&
        metric.split === null &&
        metric.step === null,
    );
    if (metrics.length !== 1 || !close(metrics[0]?.value ?? Number.NaN, 0.2))
      throw new Error(
        "Each run must collect an unambiguous delta of 0.2 without unit/split/step",
      );
    let observation:
      | { path: string; sha256: string; count: number; delta: number }
      | undefined;
    for (const artifact of run.artifacts.filter(
      (file) =>
        /\.(json|csv)$/i.test(file.path) && file.path !== "metrics.json",
    )) {
      try {
        const pairs = verifyPairs(
          await readOutput(run, artifact.path),
          artifact.path,
        );
        if (!close(pairs.delta, metrics[0]?.value ?? Number.NaN))
          throw new Error("Metric differs from preserved pairs");
        observation = {
          path: artifact.path,
          sha256: artifact.sha256,
          ...pairs,
        };
        break;
      } catch {
        /* Other artifacts may be metadata; at least one verified pair table is required. */
      }
    }
    if (!observation)
      throw new Error(
        `Run ${run.id} lacks a verified artifact with all 24 prescribed pairs`,
      );
    evidence.push({ runId: run.id, ...observation });
  }
  const pairIds = [original.id, reproduced.id];
  const hypothesis = overview.hypotheses.find(
    (item) =>
      item.status === "supported" &&
      !item.needsReview &&
      pairIds.every((runId) =>
        item.resultIds.some((resultId) => {
          const result = overview.results.find(
            (entry) => entry.id === resultId,
          );
          return (
            result &&
            item.resultRevisions?.some(
              (basis) =>
                basis.resultId === result.id &&
                basis.revision === result.revision,
            ) &&
            result.evidence?.some(
              (reference) =>
                reference.kind === "metric" &&
                reference.runId === runId &&
                reference.name === "delta" &&
                close(reference.value, 0.2),
            )
          );
        }),
      ),
  );
  if (!hypothesis)
    throw new Error(
      "A current supported hypothesis must cite verified delta evidence from both runs",
    );
  for (const run of [original, reproduced]) {
    if (
      !run.snapshot?.criteria.some(
        (criterion) =>
          criterion.hypothesisId === hypothesis.id &&
          criterion.hypothesisRevision !== undefined &&
          criterion.metric === "delta" &&
          criterion.comparator === "gt" &&
          criterion.threshold === 0.1 &&
          criterion.unit === undefined &&
          criterion.split === undefined &&
          criterion.step === undefined,
      )
    )
      throw new Error(
        "Run does not preserve the prescribed prospective delta > 0.1 criterion",
      );
  }
  const conclusion = overview.conclusions.find(
    (item) =>
      item.questionId === hypothesis.questionId &&
      item.status !== "retracted" &&
      !item.needsReview &&
      pairIds.every((runId) =>
        item.resultIds.some((resultId) => {
          const result = overview.results.find(
            (entry) => entry.id === resultId,
          );
          return (
            result?.runIds.includes(runId) &&
            item.resultRevisions?.some(
              (basis) =>
                basis.resultId === resultId &&
                basis.revision === result.revision,
            )
          );
        }),
      ) &&
      item.limitations.trim().length > 0,
  );
  if (!conclusion)
    throw new Error(
      "A current conclusion with limitations must cite both executions and current result revisions",
    );
  const finalClaim = `${conclusion.statement}\n${conclusion.limitations}`;
  if (!/\b24\b/.test(finalClaim) || !/sint[eé]tic|synthetic/i.test(finalClaim))
    throw new Error("Conclusion must disclose n=24 and synthetic data");
  return {
    kind: "synthetic-product-integration" as const,
    hypothesisId: hypothesis.id,
    conclusionId: conclusion.id,
    originalRunId: original.id,
    reproductionRunId: reproduced.id,
    evidence,
    limitations: conclusion.limitations,
    independentSamplesAddedByReproduction: 0,
    externalInferenceIsValidationOfProductNotScientificPopulation: true,
  };
}
