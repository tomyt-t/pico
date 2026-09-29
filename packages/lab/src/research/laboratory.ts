import type { LabStatus } from "@/lab/contracts";
import { LabError } from "@/lab/research/errors";
import { ResearchContext } from "@/lab/research/mutations";
import type { LaboratoryPersistence } from "@/lab/research/persistence";
import type {
  ResearchRecord,
  ScientificKind,
} from "@/lab/storage/research-repository";

export type { ScientificKind } from "@/lab/storage/research-repository";
export { LabError };

import * as conclusions from "@/lab/research/conclusions";
import * as datasets from "@/lab/research/datasets";
import * as experiments from "@/lab/research/experiments";
import * as hypotheses from "@/lab/research/hypotheses";
import * as labs from "@/lab/research/labs";
import * as notebook from "@/lab/research/notebook";
import * as papers from "@/lab/research/papers";
import * as queries from "@/lab/research/queries";
import * as questions from "@/lab/research/questions";
import * as results from "@/lab/research/results";
import * as runs from "@/lab/research/runs";
export function createLaboratory(storage: LaboratoryPersistence) {
  const context = new ResearchContext(storage);
  return {
    getLab: context.getLab.bind(context),
    getRecord<T extends ResearchRecord>(
      labId: string,
      kind: ScientificKind,
      id: string,
    ): T {
      return context.getRecord<T>(labId, kind, id);
    },
    labStatus(labId: string): LabStatus {
      return {
        lab: context.getLab(labId),
        activeTurn: storage.conversation.activeTurn(labId),
      };
    },
    revisions: (labId: string, id: string) => {
      context.getLab(labId);
      const history = storage.research.revisions(id);
      if (history.some((revision) => revision.labId !== labId))
        throw new LabError("NOT_FOUND", "Record not found in this laboratory");
      return history;
    },
    listLabs: labs.listLabs.bind(null, context),
    createLab: labs.createLab.bind(null, context),
    updateLab: labs.updateLab.bind(null, context),
    createQuestion: questions.createQuestion.bind(null, context),
    reviseQuestion: questions.reviseQuestion.bind(null, context),
    createHypothesis: hypotheses.createHypothesis.bind(null, context),
    reviseHypothesis: hypotheses.reviseHypothesis.bind(null, context),
    createExperiment: experiments.createExperiment.bind(null, context),
    reviseExperiment: experiments.reviseExperiment.bind(null, context),
    registerDataset: datasets.registerDataset.bind(null, context),
    registerPaper: papers.registerPaper.bind(null, context),
    createRun: runs.createRun.bind(null, context),
    updateRun: runs.updateRun.bind(null, context),
    recordResult: results.recordResult.bind(null, context),
    reviseResult: results.reviseResult.bind(null, context),
    recordConclusion: conclusions.recordConclusion.bind(null, context),
    reviseConclusion: conclusions.reviseConclusion.bind(null, context),
    overview: queries.overview.bind(null, context),
    experimentDetail: queries.experimentDetail.bind(null, context),
    getConversation: notebook.getConversation.bind(null, context),
    conversationView: notebook.conversationView.bind(null, context),
    readHistory: notebook.readHistory.bind(null, context),
    updateSummary: notebook.updateSummary.bind(null, context),
  };
}
export type Laboratory = ReturnType<typeof createLaboratory>;

import type { ResearchExecution } from "@/lab/research/execution";
import type { ResearchOperations } from "@/lab/research/operations";

export { ResearchExecution } from "@/lab/research/execution";
export { createResearchOperations } from "@/lab/research/operations";
/** Only scientific capabilities escape; coordination and repositories remain private. */
export function createResearch(input: {
  lab: Laboratory;
  operations: ResearchOperations;
  execution: ResearchExecution;
}) {
  const { lab, operations, execution } = input;
  const { createRun: _createRun, updateRun: _updateRun, ...publicLab } = lab;
  return {
    ...publicLab,
    ...operations.workspace,
    registerDataset: operations.registerDataset.bind(operations),
    startRun: operations.startRun.bind(operations),
    cancelRun: operations.cancelRun.bind(operations),
    readDatasetFile: operations.readDatasetFile.bind(operations),
    searchLiterature: operations.searchLiterature.bind(operations),
    importPaper: operations.importPaper.bind(operations),
    accessSource: operations.accessSource.bind(operations),
    readLogs: (labId: string, id: string) => {
      lab.getRecord(labId, "run", id);
      return execution.readLogs(labId, id);
    },
    readRunFile: (
      labId: string,
      id: string,
      area: "code" | "outputs",
      path: string,
    ) => {
      lab.getRecord(labId, "run", id);
      return execution.readRunFile(labId, id, area, path);
    },
    exportRun: (labId: string, id: string) => {
      lab.getRecord(labId, "run", id);
      return execution.exportRun(labId, id);
    },
    history: lab.revisions,
  };
}
export type Research = ReturnType<typeof createResearch>;
