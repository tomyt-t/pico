import type { Job } from "@pico/server/contracts";
import { useEffect, useState } from "react";
import { labPath, request } from "@/web/api/http-client";

/** Progress read from a job's log tail, without asking the model. Scripts
 *  print {"pico":"progress","phase","done","total","unit","t"} lines (see the
 *  Experimenter instructions); "[k/N]" counters and tqdm bars are fallbacks. */
export interface JobProgress {
  done: number;
  total: number;
  phase: string | null;
  unit: string | null;
  /** Estimated time left in milliseconds, null when it cannot be estimated. */
  remainingMs: number | null;
  /** From the job's whole elapsed time rather than measured progress. */
  rough: boolean;
}

interface Line {
  done: number;
  total: number;
  phase: string | null;
  unit: string | null;
  t: number | null;
  /** tqdm's own estimate, in milliseconds. */
  remainingMs?: number;
  kind: "json" | "counter" | "tqdm";
}

const clock = (value: string): number =>
  value
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0) * 1000;

function jsonLine(text: string): Line | null {
  if (!text.startsWith("{") || !text.includes('"pico"')) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (
      value.pico !== "progress" ||
      typeof value.done !== "number" ||
      typeof value.total !== "number" ||
      value.total <= 0
    )
      return null;
    return {
      done: Math.min(value.done, value.total),
      total: value.total,
      phase: typeof value.phase === "string" ? value.phase : null,
      unit: typeof value.unit === "string" ? value.unit : null,
      t: typeof value.t === "number" ? value.t : null,
      kind: "json",
    };
  } catch {
    return null;
  }
}

function fallbackLine(text: string): Line | null {
  // "[13/25] ..." announces item 13, so 12 are done.
  const counter = /^\[(\d+)\/(\d+)\]/.exec(text);
  if (counter) {
    const total = Number(counter[2]);
    if (total > 0)
      return {
        done: Math.max(0, Number(counter[1]) - 1),
        total,
        phase: null,
        unit: null,
        t: null,
        kind: "counter",
      };
  }
  const tqdm = /(\d+)\/(\d+) \[(\d+:\d+(?::\d+)?)<(\d+:\d+(?::\d+)?)/.exec(
    text,
  );
  if (tqdm && Number(tqdm[2]) > 0)
    return {
      done: Number(tqdm[1]),
      total: Number(tqdm[2]),
      phase: null,
      unit: null,
      t: null,
      remainingMs: clock(tqdm[4] ?? "0"),
      kind: "tqdm",
    };
  return null;
}

export function parseJobProgress(
  log: string,
  job: Pick<Job, "startedAt" | "createdAt">,
  now = Date.now(),
): JobProgress | null {
  // tqdm rewrites its line with carriage returns.
  const lines = log
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const reported = lines
    .map(jsonLine)
    .filter((line): line is Line => line !== null);
  let last = reported.at(-1) ?? null;
  if (!last)
    for (let index = lines.length - 1; index >= 0 && !last; index--)
      last = fallbackLine(lines[index] ?? "");
  if (!last) return null;
  const left = last.total - last.done;
  let remainingMs: number | null = null;
  let rough = false;
  if (!left) remainingMs = 0;
  else if (last.remainingMs !== undefined) remainingMs = last.remainingMs;
  else {
    // The rate measured within the current phase, from the first timed line.
    const first = reported.find(
      (line) => line.t !== null && line.phase === last?.phase,
    );
    if (
      last.kind === "json" &&
      first &&
      last.t !== null &&
      first.t !== null &&
      last.done > first.done &&
      last.t > first.t
    ) {
      const rate = (last.done - first.done) / (last.t - first.t);
      remainingMs = Math.max(0, (left / rate) * 1000 - (now - last.t * 1000));
    } else {
      const started = Date.parse(job.startedAt ?? job.createdAt);
      if (last.done > 0 && Number.isFinite(started)) {
        remainingMs = ((now - started) * left) / last.done;
        rough = true;
      }
    }
  }
  return {
    done: last.done,
    total: last.total,
    phase: last.phase,
    unit: last.unit,
    remainingMs,
    rough,
  };
}

/** Progress of the running jobs, read from their log tails. */
export function useJobProgress(
  labId: string,
  jobs: Job[],
  interval = 15_000,
): Record<string, JobProgress | null> {
  const [progress, setProgress] = useState<Record<string, JobProgress | null>>(
    {},
  );
  const running = jobs
    .filter((job) => job.status === "running")
    .map((job) => job.id)
    .join(",");
  useEffect(() => {
    if (!running) return;
    let closed = false;
    const read = async () => {
      const next: Record<string, JobProgress | null> = {};
      await Promise.all(
        running.split(",").map(async (id) => {
          try {
            const { job, log } = await request<{ job: Job; log: string }>(
              labPath(labId, `/jobs/${encodeURIComponent(id)}`),
            );
            next[id] = parseJobProgress(log, job);
          } catch {
            next[id] = null;
          }
        }),
      );
      if (!closed) setProgress(next);
    };
    void read();
    const timer = window.setInterval(() => void read(), interval);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [labId, running, interval]);
  return progress;
}
