import type { Job, ResearchRecord } from "@pico/server/contracts";

/** A job belongs to an experiment by id, or by living under its folder. The
 *  model sometimes names an experiment before creating it, so the folder is
 *  the reliable link. */
export function jobsOf(experiment: ResearchRecord, jobs: Job[]): Job[] {
  const folder =
    typeof experiment.fields.path === "string"
      ? experiment.fields.path.replace(/\/+$/, "")
      : null;
  return jobs.filter(
    (job) =>
      job.experimentId === experiment.id ||
      (folder !== null &&
        (job.metricsPath.includes(`/${folder}/`) ||
          job.cwd.endsWith(`/${folder}`))),
  );
}

/** Results linked to an experiment in either direction. */
export function resultsOf(
  experiment: ResearchRecord,
  records: ResearchRecord[],
): ResearchRecord[] {
  return records.filter(
    (record) =>
      record.kind === "result" &&
      (record.links.some((link) => link.id === experiment.id) ||
        experiment.links.some((link) => link.id === record.id)),
  );
}

/** A failed or stopped job whose experiment still has a recorded result: the
 *  run may have been relaunched after the result was written. */
export function resultRegistered(
  job: Job,
  experiment: ResearchRecord | undefined,
  records: ResearchRecord[],
): boolean {
  return (
    (job.status === "failed" || job.status === "stopped") &&
    experiment !== undefined &&
    resultsOf(experiment, records).length > 0
  );
}

export interface JobEntry {
  job: Job;
  experiment?: ResearchRecord;
  /** The job failed or stopped, but its experiment already has a result. */
  superseded: boolean;
}

const endedAt = (job: Job) => job.endedAt ?? job.startedAt ?? job.createdAt;

/** One entry per experiment: its running job, else its most recent one. Jobs
 *  without an experiment stand alone. Running first, then unresolved, then
 *  runs a registered result already superseded. */
export function latestJobsByExperiment(
  jobs: Job[],
  records: ResearchRecord[],
): JobEntry[] {
  const groups = new Map<string, JobEntry>();
  for (const job of jobs) {
    const experiment = experimentOf(job, records);
    const key = experiment?.id ?? job.experimentId ?? job.id;
    const current = groups.get(key);
    const newer =
      !current ||
      (job.status === "running" && current.job.status !== "running") ||
      (current.job.status !== "running" && endedAt(job) > endedAt(current.job));
    if (newer)
      groups.set(key, {
        job,
        experiment,
        superseded: resultRegistered(job, experiment, records),
      });
  }
  const rank = (entry: JobEntry) =>
    entry.job.status === "running" ? 0 : entry.superseded ? 2 : 1;
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || endedAt(b.job).localeCompare(endedAt(a.job)),
  );
}

/** The experiment a job belongs to, by id or by folder, among the given records. */
export function experimentOf(
  job: Job,
  records: ResearchRecord[],
): ResearchRecord | undefined {
  const experiments = records.filter((record) => record.kind === "experiment");
  return (
    experiments.find((record) => record.id === job.experimentId) ??
    experiments.find((record) => jobsOf(record, [job]).length > 0)
  );
}
