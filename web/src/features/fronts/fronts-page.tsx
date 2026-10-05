import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import {
  currentRoute,
  navigate,
  routePath,
  useRoute,
} from "@/web/app/navigation";
import { Facet, Facets } from "@/web/components/facets";
import {
  excerpt,
  kindLabel,
  relativeTime,
  timestamp,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { jobSuperseded, jobTone } from "@/web/components/job-row";
import { Empty, PageHeading, Status } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { LinkChips, recordHref } from "@/web/components/record-card";
import { ActivityHover } from "@/web/features/experiments/activity-hover";
import {
  type Front,
  type FrontState,
  frontsOf,
  leadSentence,
  stateTone,
} from "@/web/features/fronts/fronts";
import {
  getInvestigations,
  type Investigation,
} from "@/web/features/investigations/investigation-links";
import { QuestionPage } from "@/web/features/investigations/investigations-page";
import { useAuthor } from "@/web/features/records/authors";
import { useRecords } from "@/web/features/records/record-queries";

export const frontStates: FrontState[] = [
  "new",
  "draft",
  "busy",
  "done",
  "superseded",
];

/** When the front last moved: its experiment, materials or executions. */
export function frontActivityAt(front: Front): string {
  return (
    [
      front.experiment.updatedAt,
      ...front.results.map((record) => record.updatedAt),
      ...front.conclusions.map((record) => record.updatedAt),
      ...front.jobs.map((job) => job.endedAt ?? job.startedAt ?? job.createdAt),
    ]
      .sort()
      .at(-1) ?? front.experiment.updatedAt
  );
}

export function FrontsPage({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id?: string;
  discuss: (text: string) => void;
}) {
  if (id) return <QuestionPage lab={lab} id={id} discuss={discuss} />;
  return <FrontsList lab={lab} />;
}

function FrontsList({ lab }: { lab: Lab }) {
  const { t } = useTranslation();
  const route = useRoute();
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  const all = records.data ?? [];
  const allJobs = jobs.data ?? [];
  const fronts = frontsOf(all, allJobs);
  const { investigations } = getInvestigations(all, allJobs);
  const filter = frontStates.find((state) => state === route?.tab);
  const shown = filter
    ? fronts.filter((front) => front.state === filter)
    : fronts;
  const counts = new Map<FrontState, number>();
  for (const front of fronts)
    counts.set(front.state, (counts.get(front.state) ?? 0) + 1);
  const setFilter = (state?: FrontState) =>
    navigate({ labId: lab.id, page: "investigations", tab: state });
  const from = currentRoute();
  return (
    <div className="page fronts-page">
      <PageHeading title={t("fronts.title")}>
        {t("fronts.subtitle")}
      </PageHeading>
      <QueryState
        loading={records.loading && !records.data}
        error={records.error ?? jobs.error}
        hasData={!!records.data}
        refresh={() => {
          records.refresh();
          jobs.refresh();
        }}
      >
        {records.data && (
          <>
            <QuestionBoard labId={lab.id} investigations={investigations} />
            {fronts.length > 0 && (
              <div className="toolbar fronts-toolbar">
                <Facets label={t("fronts.filterLabel")}>
                  <Facet
                    pressed={!filter}
                    count={fronts.length}
                    onClick={() => setFilter()}
                  >
                    {t("fronts.all")}
                  </Facet>
                  {frontStates
                    .filter((state) => counts.get(state))
                    .map((state) => (
                      <Facet
                        key={state}
                        pressed={filter === state}
                        count={counts.get(state)}
                        onClick={() => setFilter(state)}
                      >
                        {t(`fronts.statePlural.${state}`)}
                      </Facet>
                    ))}
                </Facets>
              </div>
            )}
            {fronts.length === 0 ? (
              <Empty title={t("fronts.empty")}>{t("fronts.emptyHint")}</Empty>
            ) : shown.length === 0 ? (
              <Empty title={t("fronts.noneInState")} />
            ) : (
              <div className="front-list">
                {shown.map((front) => (
                  <FrontCard
                    key={front.experiment.id}
                    front={front}
                    records={all}
                    from={from}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

/** The questions the research asks, with how much material each has gathered. */
function QuestionBoard({
  labId,
  investigations,
}: {
  labId: string;
  investigations: Investigation[];
}) {
  const { t } = useTranslation();
  if (!investigations.length)
    return (
      <p className="muted small front-no-questions">
        {t("fronts.noQuestions")}
      </p>
    );
  return (
    <section className="question-board" aria-label={t("fronts.questions")}>
      {investigations.map(({ question, records }) => (
        <a
          className="question-card"
          href={routePath({ labId, page: "investigations", id: question.id })}
          key={question.id}
        >
          <span className="question-card-head">
            <span className="kind-chip kind-question">
              {kindLabel("question")}
            </span>
            {question.status && <Status value={question.status} />}
          </span>
          <strong>{question.title}</strong>
          <span className="meta">
            {t("investigations.relatedCount", { count: records.length })} ·{" "}
            {relativeTime(question.updatedAt)}
          </span>
        </a>
      ))}
    </section>
  );
}

/** A front in one glance: number, state, what it found, what it holds. */
export function FrontCard({
  front,
  records,
  from,
}: {
  front: Front;
  records: ResearchRecord[];
  from?: string;
}) {
  const { t } = useTranslation();
  const author = useAuthor();
  const { experiment, finding } = front;
  const text = finding
    ? excerpt(finding.body, 220)
    : excerpt(experiment.body, 180);
  const [lead, rest] = finding && text ? leadSentence(text) : ["", text];
  const chips = [...front.conclusions, ...front.results]
    .slice(0, 3)
    .map((record) => ({
      kind: record.kind,
      id: record.id,
      title: record.title,
    }));
  const at = frontActivityAt(front);
  return (
    <article className={`front-card is-${front.state}`}>
      <span className="front-number" aria-hidden="true">
        {front.number ?? "·"}
      </span>
      <div className="front-body">
        <div className="front-title">
          <a href={recordHref(experiment, from)}>{experiment.title}</a>
          <span className={`chip ${stateTone[front.state]}`}>
            {t(`fronts.state.${front.state}`)}
          </span>
        </div>
        <p className={`front-finding${text ? "" : " muted"}`}>
          {lead && <b>{lead}</b>}
          {lead && rest ? " " : ""}
          {rest || (lead ? "" : t("fronts.nothingYet"))}
        </p>
        {chips.length > 0 && (
          <LinkChips labId={experiment.labId} links={chips} />
        )}
      </div>
      <div className="front-side">
        {front.jobs.length > 0 && (
          <ActivityHover
            labId={experiment.labId}
            jobs={front.jobs}
            placement="bottom"
            className="front-jobs-hover"
          >
            <span
              className="front-jobs"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Focus opens the execution summary for keyboard readers.
              tabIndex={0}
            >
              <span className="front-job-dots">
                {front.jobs.slice(0, 8).map((job) => (
                  <i
                    key={job.id}
                    className={`dot ${jobTone(
                      job,
                      jobSuperseded(job, experiment, records, front.jobs) !==
                        false,
                    )}`}
                  />
                ))}
              </span>
              {t("fronts.jobs", { count: front.jobs.length })}
            </span>
          </ActivityHover>
        )}
        <span>{t("common.by", { author: author(experiment.author) })}</span>
        <time dateTime={at} title={timestamp(at)}>
          {relativeTime(at)}
        </time>
      </div>
    </article>
  );
}
