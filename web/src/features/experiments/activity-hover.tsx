import type { AgentRun, Job } from "@pico/server/contracts";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import {
  relativeTime,
  shortDuration,
  timeOfDay,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { jobTone } from "@/web/components/job-row";
import { useNow } from "@/web/components/use-now";
import { type JobProgress, useJobProgress } from "./job-progress";

const span = (ms: number) =>
  shortDuration(new Date(0).toISOString(), new Date(ms).toISOString());

function JobLine({
  job,
  progress,
  now,
}: {
  job: Job;
  progress: JobProgress | null | undefined;
  now: number;
}) {
  const { t } = useTranslation();
  const start = job.startedAt ?? job.createdAt;
  const running = job.status === "running";
  const percent = progress
    ? Math.floor((progress.done / progress.total) * 100)
    : null;
  return (
    <li className="hover-item">
      <span className="hover-item-head">
        <i className={`dot ${jobTone(job)}`} />
        <strong className="mono">{job.name}</strong>
      </span>
      <span className="muted">
        {running
          ? t("progress.runningFor", { time: shortDuration(start, null, now) })
          : t("progress.ended", {
              status: t(`progress.status.${job.status}`),
              time: shortDuration(start, job.endedAt),
            })}
        {!running && job.endedAt && ` · ${relativeTime(job.endedAt, now)}`}
      </span>
      {running && progress && (
        <>
          <span className="hover-bar" aria-hidden="true">
            <span className="hover-fill" style={{ width: `${percent}%` }} />
          </span>
          <span>
            {t("progress.count", {
              done: progress.done,
              total: progress.total,
              percent,
            })}
            {progress.unit && ` ${progress.unit}`}
            {progress.phase && ` · ${progress.phase}`}
          </span>
          {progress.remainingMs !== null && (
            <span>
              {t(progress.rough ? "progress.leftRough" : "progress.left", {
                time: span(progress.remainingMs),
                at: timeOfDay(
                  new Date(now + progress.remainingMs).toISOString(),
                ),
              })}
            </span>
          )}
        </>
      )}
      {running && !progress && (
        <span className="muted">
          {t(progress === undefined ? "progress.reading" : "progress.unknown")}
        </span>
      )}
    </li>
  );
}

function AgentLine({ run, now }: { run: AgentRun; now: number }) {
  const { t } = useTranslation();
  const running = run.status === "running";
  return (
    <li className="hover-item">
      <span className="hover-item-head">
        <i
          className={`dot ${running ? "busy" : run.status === "completed" ? "done" : run.status === "failed" ? "error" : "paused"}`}
        />
        <strong>{run.label ? `${run.name} · ${run.label}` : run.name}</strong>
      </span>
      <span className="muted">
        {running
          ? t("progress.runningFor", {
              time: shortDuration(run.createdAt, null, now),
            })
          : t("progress.ended", {
              status: t(`progress.status.${run.status}`),
              time: shortDuration(run.createdAt, run.endedAt),
            })}
        {!running && run.endedAt && ` · ${relativeTime(run.endedAt, now)}`}
      </span>
    </li>
  );
}

/** Opens on hover or focus with the progress of jobs and, optionally, the
 *  laboratory's recent agents. Everything comes from logs and the database. */
export function ActivityHover({
  labId,
  jobs,
  agents = false,
  placement = "top",
  className,
  children,
}: {
  labId: string;
  jobs: Job[];
  agents?: boolean;
  placement?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  // Fixed to the viewport so scrolling or clipped containers never cut it.
  const [position, setPosition] = useState<CSSProperties>({});
  const show = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (rect)
      setPosition(
        placement === "top"
          ? { left: rect.left, bottom: window.innerHeight - rect.top + 8 }
          : { right: window.innerWidth - rect.right, top: rect.bottom + 8 },
      );
    setOpen(true);
  };
  const now = useNow(open);
  const progress = useJobProgress(labId, open ? jobs : []);
  const runs = usePoll<AgentRun[]>(
    open && agents ? labPath(labId, "/agent-runs") : null,
    5000,
  );
  const recent = (runs.data ?? []).slice(0, 6);
  const shown = [
    ...jobs.filter((job) => job.status === "running"),
    ...jobs
      .filter((job) => job.status !== "running")
      .sort((a, b) =>
        (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt),
      )
      .slice(0, 3),
  ];
  if (!shown.length && !agents) return <>{children}</>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The trigger inside stays focusable; this wrapper only opens a read-only summary.
    <div
      className={`activity-hover${className ? ` ${className}` : ""}`}
      ref={wrapper}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div className="hover-card" style={position} role="tooltip">
          {shown.length > 0 && (
            <div className="hover-section">
              <span className="eyebrow">{t("progress.jobs")}</span>
              <ul>
                {shown.map((job) => (
                  <JobLine
                    key={job.id}
                    job={job}
                    progress={progress[job.id]}
                    now={now}
                  />
                ))}
              </ul>
            </div>
          )}
          {agents && (
            <div className="hover-section">
              <span className="eyebrow">{t("progress.agents")}</span>
              {recent.length ? (
                <ul>
                  {recent.map((run) => (
                    <AgentLine key={run.id} run={run} now={now} />
                  ))}
                </ul>
              ) : (
                <span className="muted">
                  {runs.loading ? "…" : t("progress.noAgents")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
