import type { Job, ResearchRecord } from "@pico/server/contracts";
import { recordRoute, routePath } from "@/web/app/navigation";
import { duration, kindLabel, statusLabel } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";
import { jobsOf, resultsOf } from "@/web/features/experiments/job-links";

/** The chip colour of each state; new and superseded fronts stay neutral. */
export const stateTone: Record<FrontState, string> = {
  new: "",
  draft: "waiting",
  busy: "busy",
  done: "done",
  superseded: "",
};

/** The first sentence of a finding, to lead with, and the rest. */
export function leadSentence(text: string): [string, string] {
  const match = /^(.{12,}?[.!?:])(\s+|$)/.exec(text);
  if (!match?.[1]) return [text, ""];
  return [match[1], text.slice(match[0].length)];
}

const sourceKinds = new Set(["paper", "dataset", "source"]);

/** Papers and datasets the front or its materials cite, once each. */
export function sourcesOf(
  front: Front,
  records: ResearchRecord[],
): { kind: string; id: string; title?: string }[] {
  const titles = new Map(records.map((record) => [record.id, record.title]));
  const seen = new Map<string, { kind: string; id: string; title?: string }>();
  for (const record of [
    front.experiment,
    ...front.results,
    ...front.conclusions,
  ])
    for (const link of record.links)
      if (sourceKinds.has(link.kind) && !seen.has(link.id))
        seen.set(link.id, {
          kind: link.kind,
          id: link.id,
          title: titles.get(link.id),
        });
  return [...seen.values()];
}

export interface TimelineStep {
  at: string;
  text: string;
  href?: string;
}

/** What happened on a front, oldest first: creation, executions, materials. */
export function frontTimeline(
  front: Front,
  author: (author: string) => string,
  from?: string,
): TimelineStep[] {
  const t = i18n.t;
  const labId = front.experiment.labId;
  const steps: TimelineStep[] = [
    {
      at: front.experiment.createdAt,
      text: t("fronts.created", { author: author(front.experiment.author) }),
    },
  ];
  for (const job of front.jobs) {
    const href = routePath({ labId, page: "experiments", id: job.id, from });
    if (job.startedAt)
      steps.push({
        at: job.startedAt,
        text: t("fronts.jobStarted", { name: job.name }),
        href,
      });
    if (job.endedAt)
      steps.push({
        at: job.endedAt,
        text: t("fronts.jobEnded", {
          name: job.name,
          status: statusLabel(job.status),
          duration: duration(job.startedAt, job.endedAt),
        }),
        href,
      });
  }
  for (const record of [...front.results, ...front.conclusions])
    steps.push({
      at: record.createdAt,
      text: `${kindLabel(record.kind)}: ${record.title}`,
      href: routePath({ ...recordRoute(labId, record), from }),
    });
  return steps.sort((a, b) => a.at.localeCompare(b.at));
}

/** How a front is presented: its number, state, what it found and what it holds. */
export interface Front {
  experiment: ResearchRecord;
  number: string | null;
  state: FrontState;
  /** The latest conclusion, else the latest result: the one line the card shows. */
  finding?: ResearchRecord;
  results: ResearchRecord[];
  conclusions: ResearchRecord[];
  jobs: Job[];
}

export type FrontState = "new" | "draft" | "busy" | "done" | "superseded";

/** "Frente 11", "Frentes 03+04" or "Front 2" at the start of a title. */
export function frontNumber(record: ResearchRecord): string | null {
  const match = /^(?:frentes?|fronts?)\s*([\d]+(?:\s*[+e&]\s*\d+)*)/i.exec(
    record.title,
  );
  return match?.[1]?.replace(/\s+/g, "") ?? null;
}

/** A short label for chips and context lines: "Frente 11", or the title when unnumbered. */
export function frontLabel(record: ResearchRecord): string {
  const number = frontNumber(record);
  return number
    ? i18n.t("fronts.numbered", { number })
    : record.title.length > 32
      ? `${record.title.slice(0, 31)}…`
      : record.title;
}

const newestFirst = (a: ResearchRecord, b: ResearchRecord) =>
  b.updatedAt.localeCompare(a.updatedAt);

/** Conclusions that cite the experiment or any of its results, in either direction. */
export function conclusionsOf(
  experiment: ResearchRecord,
  results: ResearchRecord[],
  records: ResearchRecord[],
): ResearchRecord[] {
  const ids = new Set([experiment.id, ...results.map((record) => record.id)]);
  const cited = new Set(experiment.links.map((link) => link.id));
  return records.filter(
    (record) =>
      record.kind === "conclusion" &&
      (record.links.some((link) => ids.has(link.id)) || cited.has(record.id)),
  );
}

/** The state a front shows, from its status as the model wrote it, or from its contents. */
export function frontState(
  experiment: ResearchRecord,
  results: ResearchRecord[],
  conclusions: ResearchRecord[],
  jobs: Job[],
): FrontState {
  const status = (experiment.status ?? "").toLowerCase();
  if (status.includes("supersed")) return "superseded";
  if (jobs.some((job) => job.status === "running")) return "busy";
  if (["draft", "planned", "proposed", "designed"].includes(status))
    return "draft";
  if (
    ["done", "completed", "concluded", "succeeded", "resolved"].includes(status)
  )
    return "done";
  if (status === "running" || status === "active" || status === "testing")
    return results.length || conclusions.length ? "done" : "busy";
  if (!results.length && !conclusions.length && !jobs.length) return "new";
  return results.length || conclusions.length ? "done" : "busy";
}

/** Experiments as fronts, newest number first; unnumbered ones by date. */
export function frontsOf(records: ResearchRecord[], jobs: Job[]): Front[] {
  const results = records.filter((record) => record.kind === "result");
  return records
    .filter((record) => record.kind === "experiment")
    .map((experiment) => {
      const own = resultsOf(experiment, results).sort(newestFirst);
      const conclusions = conclusionsOf(experiment, own, records).sort(
        newestFirst,
      );
      const attached = jobsOf(experiment, jobs).sort((a, b) =>
        (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt),
      );
      return {
        experiment,
        number: frontNumber(experiment),
        state: frontState(experiment, own, conclusions, attached),
        finding: conclusions[0] ?? own[0],
        results: own,
        conclusions,
        jobs: attached,
      };
    })
    .sort((a, b) => {
      const na = Number.parseInt(a.number ?? "", 10);
      const nb = Number.parseInt(b.number ?? "", 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;
      return newestFirst(a.experiment, b.experiment);
    });
}

/** The front a record belongs to, by a link in either direction or through its result. */
export function frontOf(
  record: ResearchRecord,
  fronts: Front[],
): Front | undefined {
  return fronts.find(
    (front) =>
      front.experiment.id === record.id ||
      front.results.some((result) => result.id === record.id) ||
      front.conclusions.some((conclusion) => conclusion.id === record.id) ||
      record.links.some((link) => link.id === front.experiment.id) ||
      front.experiment.links.some((link) => link.id === record.id),
  );
}
