import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { recordKinds } from "@pico/server/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, navigate, routePath } from "@/web/app/navigation";
import { dayKey, dayLabel, kindLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import { Empty, PageHeading } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { RecordPage, RecordRow } from "@/web/components/record-card";
import {
  applyFacets,
  type CollectionItem,
  collectionItems,
  emptyFacets,
  type Facets,
  facetCounts,
  facetLabel,
  noFront,
  type Origin,
  toggle,
} from "@/web/features/collection/collection-items";
import { SourceDetail } from "@/web/features/collection/source-detail";
import { ExperimentsPage } from "@/web/features/experiments/experiments-page";
import { FilesPage } from "@/web/features/files/files-page";
import { type Front, frontLabel, frontsOf } from "@/web/features/fronts/fronts";
import {
  PaperReader,
  paperRoute,
  usePapers,
} from "@/web/features/library/library-page";
import { PageBlocks } from "@/web/features/pages/page-blocks";

export const collectionTabs = [
  "sources",
  "records",
  "files",
  "executions",
] as const;
export type CollectionTab = (typeof collectionTabs)[number];

function isTab(value: string | undefined): value is CollectionTab {
  return (collectionTabs as readonly string[]).includes(value ?? "");
}

/** Which view a collection route shows. A paper path stays in the sources tab
 *  as the reader; any other path opens the files; a kind filters the list. */
export function selectCollectionTab(route: {
  path?: string;
  kind?: string;
  tab?: string;
}): { tab: CollectionTab; paper?: string } {
  if (route.tab === "sources" && route.path?.startsWith("papers/"))
    return { tab: "sources", paper: route.path };
  if (route.path !== undefined) return { tab: "files" };
  if (route.kind) return { tab: "records" };
  return { tab: isTab(route.tab) ? route.tab : "sources" };
}

/** The kinds a route preselects: a list in `kind`, executions, or sources. */
export function initialKinds(route: { kind?: string; tab?: string }): string[] {
  if (route.kind) return route.kind.split(",").filter(Boolean);
  if (route.tab === "executions") return ["job"];
  if (route.tab === "sources") return ["paper", "dataset"];
  return [];
}

/** Search the stored record text and its plain metadata without a second index. */
export function filterCollectionRecords(
  records: ResearchRecord[],
  query: string,
  kind: string,
): ResearchRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (kind && record.kind !== kind) return false;
    const text = [
      record.id,
      record.title,
      record.body,
      record.status ?? "",
      ...Object.values(record.fields).filter(
        (value) => typeof value === "string",
      ),
    ].join(" ");
    return !needle || text.toLocaleLowerCase().includes(needle);
  });
}

const pageSize = 100;
const kindOrder: string[] = ["job", ...recordKinds];
const origins: Origin[] = ["pico", "researcher", "campaign", "subagent"];

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { value: string; label: string; count: number }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="facet-group">
      <legend>{title}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="facet-option"
          aria-pressed={selected.has(option.value)}
          onClick={() => onToggle(option.value)}
        >
          <span className="facet-box" aria-hidden="true" />
          <span className="facet-option-label">{option.label}</span>
          <span className="count">{option.count}</span>
        </button>
      ))}
    </fieldset>
  );
}

/** One faceted list of records, executions and sources, grouped by day. */
function CollectionList({
  lab,
  kinds,
  onKinds,
}: {
  lab: Lab;
  kinds: string[];
  onKinds: (kinds: string[]) => void;
}) {
  const { t } = useTranslation();
  const papers = usePapers(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 10_000);
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState(() => emptyFacets());
  const [limit, setLimit] = useState(pageSize);
  const records = papers.records.data ?? [];
  const allJobs = jobs.data ?? [];
  const fronts = frontsOf(records, allJobs);
  const items = collectionItems(records, allJobs, papers.items, fronts);
  const facets: Facets = { ...local, kinds: new Set(kinds) };
  const shown = applyFacets(items, facets, query);
  const visible = shown.slice(0, limit);
  const filtered =
    query.trim() !== "" ||
    kinds.length > 0 ||
    local.statuses.size > 0 ||
    local.fronts.size > 0 ||
    local.origins.size > 0;
  const from = currentRoute();
  const options = (
    dimension: "kinds" | "statuses" | "fronts" | "origins",
    order: (a: string, b: string, counts: Map<string, number>) => number,
    max = Number.POSITIVE_INFINITY,
  ) => {
    const counts = facetCounts(items, facets, query, dimension);
    return [...counts.keys()]
      .sort((a, b) => order(a, b, counts))
      .slice(0, max)
      .map((value) => ({
        value,
        label: facetLabel(dimension, value, fronts),
        count: counts.get(value) ?? 0,
      }));
  };
  const byList = (list: string[]) => (a: string, b: string) =>
    list.indexOf(a) - list.indexOf(b);
  const byCount = (a: string, b: string, counts: Map<string, number>) =>
    (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
  const frontOrder = [...fronts.map((front) => front.experiment.id), noFront];
  const groups = groupByDay(visible);
  return (
    <div className="collection-layout">
      <aside className="collection-facets" aria-label={t("collection.filters")}>
        <FacetGroup
          title={t("collection.facet.kind")}
          options={options("kinds", byList(kindOrder))}
          selected={new Set(kinds)}
          onToggle={(value) => onKinds([...toggle(new Set(kinds), value)])}
        />
        <FacetGroup
          title={t("collection.facet.status")}
          options={options("statuses", byCount, 10)}
          selected={local.statuses}
          onToggle={(value) =>
            setLocal({ ...local, statuses: toggle(local.statuses, value) })
          }
        />
        {fronts.length > 0 && (
          <FacetGroup
            title={t("collection.facet.front")}
            options={options("fronts", byList(frontOrder))}
            selected={local.fronts}
            onToggle={(value) =>
              setLocal({ ...local, fronts: toggle(local.fronts, value) })
            }
          />
        )}
        <FacetGroup
          title={t("collection.facet.origin")}
          options={options("origins", byList(origins))}
          selected={local.origins}
          onToggle={(value) =>
            setLocal({
              ...local,
              origins: toggle(local.origins, value as Origin),
            })
          }
        />
      </aside>
      <div className="collection-main">
        <div className="toolbar collection-filter">
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(pageSize);
            }}
            placeholder={t("collection.searchIn", { count: shown.length })}
            aria-label={t("collection.search")}
          />
          {papers.records.data && (
            <span className="meta" role="status">
              {t("collection.items", { count: shown.length })}
            </span>
          )}
          {filtered && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setQuery("");
                setLocal(emptyFacets());
                onKinds([]);
              }}
            >
              {t("collection.clearFilters")}
            </button>
          )}
        </div>
        <QueryState
          loading={papers.records.loading && !papers.records.data}
          error={papers.records.error ?? jobs.error ?? papers.folder.error}
          hasData={!!papers.records.data}
          refresh={() => {
            papers.records.refresh();
            jobs.refresh();
            papers.folder.refresh();
          }}
        >
          {papers.records.data &&
            (shown.length ? (
              <>
                {groups.map((group) => (
                  <section className="collection-group" key={group.key}>
                    <h2 className="collection-group-title">{group.label}</h2>
                    <div className="panel collection-records">
                      {group.items.map((item) => (
                        <CollectionRow
                          key={item.key}
                          labId={lab.id}
                          item={item}
                          records={records}
                          jobs={allJobs}
                          fronts={fronts}
                          from={from}
                        />
                      ))}
                    </div>
                  </section>
                ))}
                {shown.length > visible.length && (
                  <button
                    type="button"
                    className="collection-more"
                    onClick={() => setLimit((value) => value + pageSize)}
                  >
                    {t("collection.showMore", {
                      count: Math.min(pageSize, shown.length - visible.length),
                      remaining: shown.length - visible.length,
                    })}
                  </button>
                )}
              </>
            ) : (
              <Empty
                title={t(
                  !items.length
                    ? "collection.empty"
                    : query.trim()
                      ? "collection.noMatches"
                      : "collection.noneOfKind",
                )}
              />
            ))}
        </QueryState>
      </div>
    </div>
  );
}

function groupByDay(items: CollectionItem[]) {
  const groups: { key: string; label: string; items: CollectionItem[] }[] = [];
  for (const item of items) {
    const key = item.at ? dayKey(item.at) : "undated";
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else
      groups.push({
        key,
        label: item.at ? dayLabel(item.at) : "—",
        items: [item],
      });
  }
  return groups;
}

function CollectionRow({
  labId,
  item,
  records,
  jobs,
  fronts,
  from,
}: {
  labId: string;
  item: CollectionItem;
  records: ResearchRecord[];
  jobs: Job[];
  fronts: Front[];
  from?: string;
}) {
  const { t } = useTranslation();
  const front = fronts.find(
    (candidate) => candidate.experiment.id === item.frontId,
  );
  if (item.job)
    return (
      <JobRow
        job={item.job}
        experiment={front?.experiment}
        records={records}
        jobs={jobs}
        front={front ? frontLabel(front.experiment) : undefined}
        from={from}
      />
    );
  if (item.record)
    return <RecordRow record={item.record} from={from} note={item.note} />;
  const first = item.file?.files[0];
  if (!first) return null;
  return (
    <a className="record-row" href={paperRoute(labId, first.path)}>
      <span className="kind-chip">{kindLabel("paper")}</span>
      <span className="record-row-title">{item.title}</span>
      {item.note && <span className="record-row-note">{item.note}</span>}
      <span className="meta">{t("library.reader.noRecord")}</span>
    </a>
  );
}

function CollectionRecord({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const papers = usePapers(lab.id);
  const all = papers.records.data ?? [];
  const record = all.find((item) => item.id === id);
  if (
    id.startsWith("job-") ||
    record?.kind === "experiment" ||
    record?.kind === "result"
  )
    return <ExperimentsPage lab={lab} id={id} discuss={discuss} />;
  if (record?.kind === "dataset" || record?.kind === "paper")
    return <SourceDetail lab={lab} id={id} all={all} discuss={discuss} />;
  return (
    <RecordPage
      labId={lab.id}
      id={id}
      all={all}
      renderContent={(record) =>
        record.kind === "page" ? (
          <PageBlocks
            labId={lab.id}
            blocks={record.fields.blocks}
            body={record.body}
            records={all}
          />
        ) : undefined
      }
      discuss={discuss}
      back={{
        label: t("collection.title"),
        href: routePath({ labId: lab.id, page: "collection" }),
      }}
    />
  );
}

export function CollectionPage({
  lab,
  id,
  path,
  kind,
  tab,
  discuss,
}: {
  lab: Lab;
  id?: string;
  path?: string;
  kind?: string;
  tab?: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (id) return <CollectionRecord lab={lab} id={id} discuss={discuss} />;
  const selected = selectCollectionTab({ path, kind, tab });
  if (selected.paper)
    return (
      <div className="page collection-page">
        <PaperReader lab={lab} path={selected.paper} discuss={discuss} />
      </div>
    );
  const files = selected.tab === "files";
  const listRoute = routePath({ labId: lab.id, page: "collection" });
  const filesRoute = routePath({
    labId: lab.id,
    page: "collection",
    path: ".",
  });
  return (
    <div className="page collection-page">
      <PageHeading
        title={t("collection.title")}
        action={
          <nav
            className="facets collection-views"
            aria-label={t("collection.title")}
          >
            <a
              className="facet"
              aria-current={files ? undefined : "page"}
              href={listRoute}
            >
              {t("collection.list")}
            </a>
            <a
              className="facet"
              aria-current={files ? "page" : undefined}
              href={filesRoute}
            >
              {t("collection.files")}
            </a>
          </nav>
        }
      >
        {t("collection.subtitle")}
      </PageHeading>
      {files ? (
        <FilesPage
          lab={lab}
          path={path}
          page="collection"
          discuss={discuss}
          embedded
        />
      ) : (
        <CollectionList
          lab={lab}
          kinds={initialKinds({ kind, tab })}
          onKinds={(kinds) =>
            navigate({
              labId: lab.id,
              page: "collection",
              ...(kinds.length ? { kind: kinds.join(",") } : {}),
            })
          }
        />
      )}
    </div>
  );
}
