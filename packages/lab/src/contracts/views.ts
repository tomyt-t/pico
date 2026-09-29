import type {
  Conversation,
  LabEvent,
  Turn,
} from "@/lab/contracts/conversation";
import type { Experiment, Run } from "@/lab/contracts/experiments";
import type { Lab } from "@/lab/contracts/labs";
import type { DatasetVersion, Paper } from "@/lab/contracts/library";
import type {
  Conclusion,
  Hypothesis,
  Question,
  Result,
} from "@/lab/contracts/research";

export interface LabOverview {
  lab: Lab;
  questions: Question[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  runs: Run[];
  results: Result[];
  conclusions: Conclusion[];
  datasets: DatasetVersion[];
  papers: Paper[];
  events: LabEvent[];
  conversation: Conversation;
  activeTurn: Turn | null;
}

export interface ExperimentDetail {
  experiment: Experiment;
  questions: Question[];
  hypotheses: Hypothesis[];
  datasets: DatasetVersion[];
  runs: Run[];
  results: Result[];
}

export interface LabStatus {
  lab: Lab;
  activeTurn: Turn | null;
}
