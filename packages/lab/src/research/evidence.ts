import type { Experiment, Result } from "@/lab/contracts";
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
