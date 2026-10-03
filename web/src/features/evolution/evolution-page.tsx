import type {
  Job,
  Lab,
  RecordHistoryEntry,
  ResearchRecord,
} from "@pico/server/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, routePath } from "@/web/app/navigation";
import { Facet, Facets } from "@/web/components/facets";
import {
  dayKey,
  dayLabel,
  excerpt,
  kindLabel,
  timeOfDay,
  timestamp,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import { Markdown } from "@/web/components/markdown";
import { Empty, PageHeading, Status } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import {
  FieldsTable,
  LinkChips,
  recordHref,
} from "@/web/components/record-card";
import { type DiffSegment, diffWords } from "@/web/features/evolution/diff";
import { experimentOf } from "@/web/features/experiments/job-links";
import { useAuthor } from "@/web/features/records/authors";
import { useRecords } from "@/web/features/records/record-queries";

/** The order kinds take in the filter row; unknown kinds follow alphabetically. */
const kindOrder = [
  "question",
  "hypothesis",
  "experiment",
  "result",
  "conclusion",
  "note",
  "page",
];

/** Match the server's stable ordering when combining several queries. */
export function evolutionEntries(
  labId: string,
  ...groups: RecordHistoryEntry[][]
): RecordHistoryEntry[] {
  return groups
    .flat()
    .filter((entry) => entry.after.labId === labId)
    .sort(
      (a, b) =>
        b.at.localeCompare(a.at) ||
        a.recordId.localeCompare(b.recordId) ||
        b.after.revision - a.after.revision,
    );
}

export type TimelineItem =
  | { at: string; key: string; entry: RecordHistoryEntry; job?: undefined }
  | { at: string; key: string; job: Job; entry?: undefined };

export interface TimelineDay {
  key: string;
  label: string;
  items: TimelineItem[];
}

/** Changes and, when asked, executions as one list, newest first and grouped
 *  by the day they happened. */
export function timelineDays(
  entries: RecordHistoryEntry[],
  jobs: Job[] = [],
  now = Date.now(),
): TimelineDay[] {
  const items: TimelineItem[] = [
    ...entries.map((entry) => ({
      at: entry.at,
      key: `${entry.recordId}:${entry.after.revision}`,
      entry,
    })),
    ...jobs.map((job) => ({
      at: job.endedAt ?? job.startedAt ?? job.createdAt,
      key: job.id,
      job,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const days: TimelineDay[] = [];
  for (const item of items) {
    const key = dayKey(item.at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(item);
    else days.push({ key, label: dayLabel(item.at, now), items: [item] });
  }
  return days;
}

/** The kinds present, in reading order. */
export function kindsIn(entries: RecordHistoryEntry[]): string[] {
  const present = new Set(entries.map((entry) => entry.after.kind));
  return [...present].sort((a, b) => {
    const ia = kindOrder.indexOf(a);
    const ib = kindOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

export function EvolutionPage({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id?: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const history = usePoll<RecordHistoryEntry[]>(
    labPath(lab.id, "/history?limit=500"),
    10_000,
  );
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 10_000);
  const records = useRecords(lab.id, 10_000);
  const [filter, setFilter] = useState("");
  const [showJobs, setShowJobs] = useState(false);
  const entries = evolutionEntries(lab.id, history.data ?? []);
  const kinds = kindsIn(entries);
  const hasRevisions = entries.some((entry) => entry.type === "revised");
  const selected = entries.filter(
    (entry) =>
      (!filter ||
        (filter === "revised"
          ? entry.type === "revised"
          : entry.after.kind === filter)) &&
      (!id || entry.recordId === id),
  );
  const days = timelineDays(
    selected,
    showJobs && !id && !filter ? (jobs.data ?? []) : [],
  );
  return (
    <div className="page evolution-page">
      {id && (
        <a
          className="back"
          href={routePath({ labId: lab.id, page: "evolution" })}
        >
          ← {t("evolution.allChanges")}
        </a>
      )}
      <PageHeading title={t("evolution.title")}>
        {t("evolution.subtitle")}
      </PageHeading>
      {!id && (
        <div className="toolbar evolution-toolbar">
          <Facets label={t("evolution.filterLabel")}>
            <Facet pressed={!filter} onClick={() => setFilter("")}>
              {t("evolution.filterAll")}
            </Facet>
            {kinds.map((kind) => (
              <Facet
                key={kind}
                pressed={filter === kind}
                onClick={() => setFilter(kind)}
              >
                {kindLabel(kind, true)}
              </Facet>
            ))}
            {hasRevisions && (
              <Facet
                pressed={filter === "revised"}
                onClick={() => setFilter("revised")}
              >
                {t("evolution.revisions")}
              </Facet>
            )}
          </Facets>
          <span className="toolbar-spacer" />
          <button
            type="button"
            className="facet facet-toggle"
            aria-pressed={showJobs}
            disabled={!!filter}
            onClick={() => setShowJobs((value) => !value)}
          >
            {t("evolution.showJobs")}
          </button>
          <a
            className="text-button"
            href={routePath({ labId: lab.id, page: "experiments" })}
          >
            {t("evolution.allOperations")}
          </a>
        </div>
      )}
      <QueryState
        loading={history.loading && !history.data}
        error={history.error}
        hasData={!!history.data}
        refresh={history.refresh}
      >
        {history.data && (
          <EvolutionTimeline
            days={days}
            records={records.data ?? []}
            jobs={jobs.data ?? []}
            open={!!id}
            discuss={discuss}
          />
        )}
      </QueryState>
      {!id && <p className="meta evolution-scope">{t("evolution.scope")}</p>}
    </div>
  );
}

function EvolutionTimeline({
  days,
  records,
  jobs,
  open,
  discuss,
}: {
  days: TimelineDay[];
  records: ResearchRecord[];
  jobs: Job[];
  open: boolean;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (!days.length)
    return (
      <Empty title={t("evolution.empty")}>{t("evolution.emptyHint")}</Empty>
    );
  return (
    <div className="evolution-timeline">
      {days.map((day) => (
        <section className="evolution-day" key={day.key}>
          <h2 className="evolution-day-title">{day.label}</h2>
          <ol className="evolution-feed">
            {day.items.map((item) =>
              item.entry ? (
                <EvolutionEntry
                  key={item.key}
                  entry={item.entry}
                  open={open}
                  discuss={discuss}
                />
              ) : (
                <li className="evolution-entry is-job" key={item.key}>
                  <time
                    className="evolution-time"
                    dateTime={item.at}
                    title={timestamp(item.at)}
                  >
                    {timeOfDay(item.at)}
                  </time>
                  <div className="evolution-body">
                    <JobRow
                      job={item.job}
                      experiment={experimentOf(item.job, records)}
                      records={records}
                      jobs={jobs}
                      from={currentRoute()}
                    />
                  </div>
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Changes as a flat list, for tests and for places without day headings. */
export function EvolutionFeed({
  entries,
  discuss,
  open = false,
}: {
  entries: RecordHistoryEntry[];
  discuss: (text: string) => void;
  open?: boolean;
}) {
  const { t } = useTranslation();
  if (!entries.length)
    return (
      <Empty title={t("evolution.empty")}>{t("evolution.emptyHint")}</Empty>
    );
  return (
    <ol className="evolution-feed">
      {entries.map((entry) => (
        <EvolutionEntry
          key={`${entry.recordId}:${entry.after.revision}`}
          entry={entry}
          open={open}
          discuss={discuss}
        />
      ))}
    </ol>
  );
}

/** Two lines per change: what changed, and why or what it says. The full
 *  text and the word-by-word comparison stay one click away. */
function EvolutionEntry({
  entry,
  open,
  discuss,
}: {
  entry: RecordHistoryEntry;
  open: boolean;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const author = useAuthor();
  const record = entry.after;
  const revised = entry.type === "revised";
  const reason = entry.reason?.trim() ?? "";
  const summary = excerpt(record.body, 220);
  return (
    <li className={`evolution-entry ${revised ? "is-revised" : "is-created"}`}>
      <time
        className="evolution-time"
        dateTime={entry.at}
        title={timestamp(entry.at)}
      >
        {timeOfDay(entry.at)}
      </time>
      <div className="evolution-body">
        <div className="evolution-line">
          <span className={`kind-chip kind-${record.kind}`}>
            {kindLabel(record.kind)}
          </span>
          <a
            className="evolution-title"
            href={recordHref(record, currentRoute())}
          >
            {record.title}
          </a>
          {record.status && <Status value={record.status} />}
        </div>
        {revised ? (
          <p className={`evolution-excerpt${reason ? " is-reason" : " muted"}`}>
            {reason || t("evolution.unexplained")}
          </p>
        ) : (
          <p className={`evolution-excerpt${summary ? "" : " muted"}`}>
            {summary || t("evolution.noBody")}
          </p>
        )}
        <p className="meta evolution-meta">
          <span>
            {revised
              ? t("evolution.revised", {
                  before: entry.before.revision,
                  after: record.revision,
                })
              : t("evolution.created")}
          </span>
          <span>{t("common.by", { author: author(entry.author) })}</span>
        </p>
        <details className="evolution-versions" open={open}>
          <summary>
            {revised ? t("evolution.compare") : t("evolution.details")}
          </summary>
          {revised ? (
            <>
              {!record.body && <p className="muted">{t("evolution.noBody")}</p>}
              <RevisionDiff before={entry.before} after={record} />
            </>
          ) : (
            <div className="evolution-content">
              {record.body ? (
                <Markdown>{record.body}</Markdown>
              ) : (
                <p className="muted">{t("evolution.noBody")}</p>
              )}
              <FieldsTable labId={record.labId} fields={record.fields} />
              {record.links.length > 0 && (
                <div className="evolution-references">
                  <p className="eyebrow">{t("evolution.references")}</p>
                  <LinkChips labId={record.labId} links={record.links} />
                  <p className="meta">{t("evolution.referenceHint")}</p>
                </div>
              )}
            </div>
          )}
          <div className="actions evolution-actions">
            <a
              className="button small"
              href={recordHref(record, currentRoute())}
            >
              {t("evolution.current")}
            </a>
            <button
              type="button"
              className="small"
              onClick={() =>
                discuss(
                  t("evolution.discussion", {
                    kind: kindLabel(record.kind),
                    id: entry.recordId,
                    revision: record.revision,
                    title: record.title,
                    reason: entry.reason ?? "",
                  }),
                )
              }
            >
              {t("common.discussWithPico")}
            </button>
          </div>
        </details>
      </div>
    </li>
  );
}

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "same" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Segments are positional and never reordered.
          <span key={index}>{segment.text}</span>
        ) : segment.type === "ins" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Segments are positional and never reordered.
          <ins key={index}>{segment.text}</ins>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Segments are positional and never reordered.
          <del key={index}>{segment.text}</del>
        ),
      )}
    </>
  );
}

/** What changed between two revisions, word by word; the full versions remain
 *  one step away. Very long texts show only the versions. */
function RevisionDiff({
  before,
  after,
}: {
  before: ResearchRecord;
  after: ResearchRecord;
}) {
  const { t } = useTranslation();
  const body =
    before.body === after.body ? [] : diffWords(before.body, after.body);
  const title =
    before.title === after.title ? [] : diffWords(before.title, after.title);
  const snapshots = (
    <div className="evolution-snapshots">
      <Snapshot
        record={before}
        label={t("evolution.before", { revision: before.revision })}
      />
      <Snapshot
        record={after}
        label={t("evolution.after", { revision: after.revision })}
      />
    </div>
  );
  // Too long to diff, or only status, fields or links changed: the versions suffice.
  if (!body || !title || (!body.length && !title.length)) return snapshots;
  return (
    <>
      {title.length > 0 && (
        <p className="evolution-diff evolution-diff-title">
          <span className="eyebrow">{t("evolution.titleChange")}</span>{" "}
          <DiffText segments={title} />
        </p>
      )}
      {body.length > 0 && (
        <p className="evolution-diff">
          <DiffText segments={body} />
        </p>
      )}
      <details className="evolution-full-versions">
        <summary>{t("evolution.fullVersions")}</summary>
        {snapshots}
      </details>
    </>
  );
}

function Snapshot({
  record,
  label,
}: {
  record: ResearchRecord;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="evolution-snapshot">
      <h3>{label}</h3>
      <strong>{record.title}</strong>
      {record.status && <Status value={record.status} />}
      {record.body ? (
        <Markdown>{record.body}</Markdown>
      ) : (
        <p className="muted">{t("record.noBody")}</p>
      )}
      <FieldsTable labId={record.labId} fields={record.fields} />
      {record.links.length > 0 && (
        <>
          <p className="eyebrow">{t("evolution.references")}</p>
          <LinkChips labId={record.labId} links={record.links} />
          <p className="meta">{t("evolution.referenceHint")}</p>
        </>
      )}
    </section>
  );
}
