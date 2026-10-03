import type { Job, RecordLink, ResearchRecord } from "@pico/server/contracts";
import { jobsOf } from "@/web/features/experiments/job-links";

const expandableKinds = new Set([
  "hypothesis",
  "experiment",
  "result",
  "conclusion",
  "note",
]);

export interface Investigation {
  question: ResearchRecord;
  records: ResearchRecord[];
  jobs: Job[];
  missingLinks: RecordLink[];
}

/** Follow explicit links in either direction. Other questions and shared sources
 * are visible endpoints, not bridges that merge separate research paths. Jobs
 * are attached afterwards; a shared execution never creates a record link. */
export function questionMaterials(
  question: ResearchRecord,
  records: ResearchRecord[],
  jobs: Job[],
): Investigation {
  const sameLab = records.filter((record) => record.labId === question.labId);
  const byId = new Map(sameLab.map((record) => [record.id, record]));
  byId.set(question.id, question);
  const neighbors = new Map<string, Set<string>>();
  for (const record of byId.values()) {
    for (const link of record.links) {
      if (!byId.has(link.id)) continue;
      const outgoing = neighbors.get(record.id) ?? new Set<string>();
      outgoing.add(link.id);
      neighbors.set(record.id, outgoing);
      const incoming = neighbors.get(link.id) ?? new Set<string>();
      incoming.add(record.id);
      neighbors.set(link.id, incoming);
    }
  }
  const found = new Set([question.id]);
  const pending = [question.id];
  while (pending.length) {
    const id = pending.pop();
    if (!id) continue;
    for (const target of neighbors.get(id) ?? []) {
      if (found.has(target)) continue;
      const record = byId.get(target);
      if (!record) continue;
      found.add(target);
      if (expandableKinds.has(record.kind)) pending.push(target);
    }
  }
  const connected = [...byId.values()].filter((record) => found.has(record.id));
  const traversed = connected.filter(
    (record) => record.id === question.id || expandableKinds.has(record.kind),
  );
  const labJobs = jobs.filter((job) => job.labId === question.labId);
  const jobIds = new Set(labJobs.map((job) => job.id));
  const explicitJobIds = new Set(
    traversed
      .flatMap((record) => record.links.map((link) => link.id))
      .filter((id) => jobIds.has(id)),
  );
  const attached = new Set([
    ...explicitJobIds,
    ...connected
      .filter((record) => record.kind === "experiment")
      .flatMap((record) => jobsOf(record, labJobs).map((job) => job.id)),
  ]);
  const missing = new Map<string, RecordLink>();
  for (const record of traversed) {
    for (const link of record.links) {
      if (!byId.has(link.id) && !jobIds.has(link.id))
        missing.set(`${link.kind}:${link.id}`, link);
    }
  }
  return {
    question,
    records: connected.filter((record) => record.id !== question.id),
    jobs: labJobs.filter((job) => attached.has(job.id)),
    missingLinks: [...missing.values()],
  };
}

/** The executions worth a glance on a card: running ones first, then the most
 *  recently ended. The full list stays in the investigation detail. */
export function relevantJobs(jobs: Job[], limit: number): Job[] {
  const endedAt = (job: Job) => job.endedAt ?? job.createdAt;
  return [...jobs]
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        endedAt(b).localeCompare(endedAt(a)),
    )
    .slice(0, limit);
}

export function getInvestigations(records: ResearchRecord[], jobs: Job[]) {
  const investigations = records
    .filter((record) => record.kind === "question")
    .map((question) => questionMaterials(question, records, jobs));
  const linked = new Set(
    investigations.flatMap((investigation) =>
      investigation.records.map((record) => `${record.labId}:${record.id}`),
    ),
  );
  return {
    investigations,
    unlinkedRecords: records.filter(
      (record) =>
        record.kind !== "question" &&
        !linked.has(`${record.labId}:${record.id}`),
    ),
  };
}
