import type { Job, ResearchRecord } from "@pico/server/contracts";
import { routePath } from "@/web/app/navigation";
import { duration, relativeTime, timestamp } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";
import { Status } from "@/web/components/primitives";
import { jobsOf, resultRegistered } from "@/web/features/experiments/job-links";

/** A failure the research already moved past keeps its status but loses its colour. */
export function jobSuperseded(
  job: Job,
  experiment: ResearchRecord | undefined,
  records: ResearchRecord[],
  jobs: Job[],
): Job | true | false {
  if (job.status !== "failed" && job.status !== "stopped") return false;
  const later = experiment
    ? jobsOf(experiment, jobs).find(
        (other) =>
          other.id !== job.id &&
          other.status === "succeeded" &&
          other.createdAt >= job.createdAt,
      )
    : undefined;
  if (later) return later;
  return resultRegistered(job, experiment, records);
}

/** The short remark next to a job's status: how long it ran, whether metrics
 *  were read, or why a failure no longer matters. */
export function jobContext(
  job: Job,
  experiment: ResearchRecord | undefined,
  records: ResearchRecord[],
  jobs: Job[],
): string {
  const t = i18n.t;
  const time = duration(job.startedAt, job.endedAt);
  if (job.status === "running") return time;
  const superseded = jobSuperseded(job, experiment, records, jobs);
  if (superseded === true) return t("experiments.context.resultRegistered");
  if (superseded)
    return t("experiments.context.superseded", { name: superseded.name });
  const metrics = job.metrics?.length ?? 0;
  return metrics
    ? `${time} · ${t("experiments.context.metrics", { count: metrics })}`
    : time;
}

export function jobTone(job: Job, superseded = false): string {
  if (job.status === "running") return "busy";
  if (job.status === "succeeded") return "done";
  if (superseded) return "paused";
  return job.status === "failed" ? "error" : "paused";
}

/** One line per execution: state, name, where it belongs, context, status and time. */
export function JobRow({
  job,
  experiment,
  records = [],
  jobs = [],
  front,
  from,
}: {
  job: Job;
  experiment?: ResearchRecord;
  records?: ResearchRecord[];
  jobs?: Job[];
  /** Where the job belongs, shown after the name: "Frente 11". */
  front?: string;
  /** The page to return to from the job. */
  from?: string;
}) {
  const superseded = jobSuperseded(job, experiment, records, jobs) !== false;
  const tone = jobTone(job, superseded);
  const at = job.endedAt ?? job.startedAt ?? job.createdAt;
  return (
    <a
      className={`record-row job-row is-${tone}`}
      href={routePath({
        labId: job.labId,
        page: "experiments",
        id: job.id,
        from,
      })}
    >
      <span className={`dot ${tone}`} />
      <span className="record-row-title">
        {job.name}
        {front && <small className="job-row-front">{front}</small>}
      </span>
      <span className="record-row-note">
        {jobContext(job, experiment, records, jobs)}
      </span>
      <Status value={job.status} />
      <time className="meta" dateTime={at} title={timestamp(at)}>
        {relativeTime(at)}
      </time>
    </a>
  );
}
