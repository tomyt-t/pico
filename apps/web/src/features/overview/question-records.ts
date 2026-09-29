import type { LabOverview } from "@pico/lab/contracts";

export function questionRecords(overview: LabOverview, questionId: string) {
  return {
    hypotheses: overview.hypotheses.filter(
      (row) => row.questionId === questionId,
    ),
    experiments: overview.experiments.filter((row) =>
      row.questionIds.includes(questionId),
    ),
    conclusions: overview.conclusions
      .filter((row) => row.questionId === questionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
