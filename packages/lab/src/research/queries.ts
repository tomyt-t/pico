import type {
  DatasetVersion,
  Experiment,
  ExperimentDetail,
  Hypothesis,
  LabEvent,
  LabOverview,
  Question,
} from "@/lab/contracts";
import type { ResearchContext } from "@/lab/research/mutations";
import { conversationView, getConversation } from "@/lab/research/notebook";
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
    activeTurn: conversationView(context, labId).activeTurn,
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
