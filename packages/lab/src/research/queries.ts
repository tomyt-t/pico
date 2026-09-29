import type {
  Conclusion,
  DatasetVersion,
  Experiment,
  ExperimentDetail,
  Hypothesis,
  LabEvent,
  LabOverview,
  Paper,
  Question,
  RecordReference,
  Result,
  Run,
} from "@/lab/contracts";
import type { ResearchContext } from "@/lab/research/mutations";
import { getConversation } from "@/lab/research/notebook";

export function recordIndex(
  context: ResearchContext,
  labId: string,
): RecordReference[] {
  context.getLab(labId);
  return [
    ...context.repo
      .list<Question>("question", labId)
      .map((r) => ({ id: r.id, kind: "question" as const, title: r.text })),
    ...context.repo.list<Hypothesis>("hypothesis", labId).map((r) => ({
      id: r.id,
      kind: "hypothesis" as const,
      title: r.statement,
      questionId: r.questionId,
    })),
    ...context.repo
      .list<Experiment>("experiment", labId)
      .map((r) => ({ id: r.id, kind: "experiment" as const, title: r.title })),
    ...context.repo.list<Run>("run", labId).map((r) => ({
      id: r.id,
      kind: "run" as const,
      title: `Run ${r.attempt}`,
      experimentId: r.experimentId,
    })),
    ...context.repo.list<Result>("result", labId).map((r) => ({
      id: r.id,
      kind: "result" as const,
      title: r.interpretation,
      experimentId: r.experimentId,
    })),
    ...context.repo.list<Conclusion>("conclusion", labId).map((r) => ({
      id: r.id,
      kind: "conclusion" as const,
      title: r.statement,
      questionId: r.questionId,
    })),
    ...context.repo
      .list<Paper>("paper", labId)
      .map((r) => ({ id: r.id, kind: "paper" as const, title: r.title })),
    ...context.repo.list<DatasetVersion>("dataset", labId).map((r) => ({
      id: r.id,
      kind: "dataset" as const,
      title: `${r.name} ${r.version}`,
    })),
  ].map((record) => ({ ...record, title: record.title.slice(0, 250) }));
}
export function overview(context: ResearchContext, labId: string): LabOverview {
  return {
    lab: context.getLab(labId),
    questions: context.repo.list("question", labId),
    hypotheses: context.repo.list("hypothesis", labId),
    experiments: context.repo.list("experiment", labId),
    runs: context.repo.list("run", labId),
    results: context.repo.list("result", labId),
    conclusions: context.repo.list("conclusion", labId),
    datasets: context.repo.list("dataset", labId),
    papers: context.repo.list("paper", labId),
    events: context.repo.list<LabEvent>("event", labId).reverse(),
    conversation: getConversation(context, labId),
    activeTurn: context.conversations.activeTurn(labId),
    resumableTurns: context.conversations
      .listTurns(labId)
      .filter((turn) =>
        ["paused", "failed", "interrupted", "cancelled"].includes(turn.status),
      ),
  };
}
export function experimentDetail(
  context: ResearchContext,
  labId: string,
  id: string,
): ExperimentDetail {
  const experiment = context.getRecord<Experiment>(labId, "experiment", id);
  return {
    experiment,
    questions: experiment.questionIds.map((questionId) =>
      context.getRecord<Question>(labId, "question", questionId),
    ),
    hypotheses: experiment.hypothesisIds.map((hypothesisId) =>
      context.getRecord<Hypothesis>(labId, "hypothesis", hypothesisId),
    ),
    datasets: experiment.datasetVersionIds.map((datasetId) =>
      context.getRecord<DatasetVersion>(labId, "dataset", datasetId),
    ),
    runs: context.repo.runsForExperiment(labId, id),
    results: context.repo.resultsForExperiment(labId, id),
  };
}
