import type {
  Criterion,
  Experiment,
  Hypothesis,
  ObservationReference,
  Result,
  Run,
} from "@/lab/contracts";
import { LabError } from "@/lab/research/errors";
import type { ResearchContext } from "@/lab/research/mutations";
export function validateEvidenceForQuestion(
  context: ResearchContext,
  labId: string,
  resultId: string,
  questionId: string,
): void {
  const result = context.getRecord<Result>(labId, "result", resultId);
  const experiment = context.getRecord<Experiment>(
    labId,
    "experiment",
    result.experimentId,
  );
  if (!experiment.questionIds.includes(questionId))
    throw new LabError(
      "BAD_REQUEST",
      "Evidence must come from an experiment linked to this question",
    );
}

/** Pins the exact result revisions read by an authored interpretation. */
export function resultRevisions(
  context: ResearchContext,
  labId: string,
  resultIds: string[],
): { resultId: string; revision: number }[] {
  return resultIds.map((resultId) => ({
    resultId,
    revision: context.getRecord<Result>(labId, "result", resultId).revision,
  }));
}

/** Confirmatory states require every cited result/run to satisfy the preserved test. */
export function validateHypothesisTest(
  context: ResearchContext,
  labId: string,
  hypothesis: Pick<
    Hypothesis,
    "id" | "questionId" | "statement" | "rationale" | "status" | "resultIds"
  >,
): void {
  for (const resultId of hypothesis.resultIds) {
    const result = context.getRecord<Result>(labId, "result", resultId);
    if (result.evidenceVersion !== 1 || !result.evidence?.length)
      throw new LabError(
        "BAD_REQUEST",
        "Supported or refuted hypotheses require structured references to collected observations in every result",
      );
    validateObservationReferences(
      context,
      labId,
      result.runIds,
      result.evidence,
    );
    for (const runId of result.runIds) {
      const run = context.getRecord<Run>(labId, "run", runId);
      if (run.status !== "succeeded" || !run.snapshot)
        throw new LabError(
          "BAD_REQUEST",
          "Confirmatory assessments require successful runs; preserve failure analyses as inconclusive evidence",
        );
      const criteria = run.snapshot.criteria.filter(
        (criterion) => criterion.hypothesisId === hypothesis.id,
      );
      if (!criteria.length)
        throw new LabError(
          "BAD_REQUEST",
          "Every assessed run must preserve criteria registered for this hypothesis before execution",
        );
      for (const criterion of criteria) {
        const current = context.getRecord<Hypothesis>(
          labId,
          "hypothesis",
          hypothesis.id,
        );
        const registered =
          criterion.hypothesisRevision === current.revision
            ? current
            : context.repo
                .revisions<Hypothesis>(hypothesis.id)
                .find(
                  (revision) =>
                    revision.snapshot.revision === criterion.hypothesisRevision,
                )?.snapshot;
        if (!registered)
          throw new LabError(
            "BAD_REQUEST",
            "The preserved criterion must identify a registered hypothesis revision; legacy runs require a new prospective test",
          );
        if (
          registered.questionId !== hypothesis.questionId ||
          registered.statement !== hypothesis.statement ||
          registered.rationale !== hypothesis.rationale
        )
          throw new LabError(
            "BAD_REQUEST",
            "The assessed hypothesis differs from the hypothesis revision registered before execution; record a new prospective test",
          );
        const metrics = result.evidence.filter(
          (reference) =>
            reference.runId === runId && matchesCriterion(reference, criterion),
        );
        if (!metrics.length)
          throw new LabError(
            "BAD_REQUEST",
            "Evidence must include every preserved criterion's metric with its exact unit, split and step",
          );
        if (
          run.metrics.some(
            (metric) =>
              matchesCriterion(
                { kind: "metric", runId, ...metric },
                criterion,
              ) &&
              !metrics.some(
                (reference) =>
                  reference.kind === "metric" &&
                  reference.value === metric.value,
              ),
          )
        )
          throw new LabError(
            "BAD_REQUEST",
            "Evidence must include all collected observations matching each criterion; do not select only favorable values",
          );
        if (
          criterion.comparator !== undefined &&
          criterion.threshold !== undefined
        ) {
          for (const reference of metrics) {
            if (reference.kind !== "metric") continue;
            const met = compare(
              reference.value,
              criterion.comparator,
              criterion.threshold,
            );
            if (met !== (hypothesis.status === "supported"))
              throw new LabError(
                "BAD_REQUEST",
                "The assessment contradicts a preserved numerical criterion; mixed outcomes require an inconclusive assessment",
              );
          }
        }
      }
    }
  }
}

function matchesCriterion(
  reference: ObservationReference,
  criterion: Criterion,
): boolean {
  return (
    reference.kind === "metric" &&
    reference.name === criterion.metric &&
    reference.unit === (criterion.unit ?? null) &&
    reference.split === (criterion.split ?? null) &&
    reference.step === (criterion.step ?? null)
  );
}
function compare(
  value: number,
  comparator: NonNullable<Criterion["comparator"]>,
  threshold: number,
): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
  }
}

/** Structured claims can cite only observations actually collected by their preserved run. */
export function validateObservationReferences(
  context: ResearchContext,
  labId: string,
  runIds: string[],
  references: import("@/lab/contracts").ObservationReference[],
): void {
  const identities = new Set<string>();
  for (const reference of references) {
    if (!runIds.includes(reference.runId))
      throw new LabError(
        "BAD_REQUEST",
        "Evidence must reference one of the result's fixed runs",
      );
    const run = context.getRecord<import("@/lab/contracts").Run>(
      labId,
      "run",
      reference.runId,
    );
    if (!run.snapshot || run.status === "queued" || run.status === "running")
      throw new LabError(
        "BAD_REQUEST",
        "Evidence requires a terminal run with preserved inputs",
      );
    const identity = JSON.stringify(reference);
    if (identities.has(identity))
      throw new LabError("BAD_REQUEST", "Duplicate observation reference");
    identities.add(identity);
    if (reference.kind === "metric") {
      if (
        !run.metrics.some(
          (metric) =>
            metric.name === reference.name &&
            metric.value === reference.value &&
            metric.unit === reference.unit &&
            metric.split === reference.split &&
            metric.step === reference.step,
        )
      )
        throw new LabError(
          "BAD_REQUEST",
          "Quantitative evidence does not match a collected run metric",
        );
    } else if (
      !run.artifacts.some(
        (artifact) =>
          artifact.path === reference.path &&
          artifact.sha256 === reference.sha256,
      )
    )
      throw new LabError(
        "BAD_REQUEST",
        "Artifact evidence does not match a collected run artifact",
      );
  }
}
