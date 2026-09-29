import type { LabOverview } from "@pico/lab/contracts";
import { useState } from "react";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Empty, Icon, PageHeading, Section } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { DatasetDetail } from "@/web/features/library/dataset-detail";
import { useLibraryOverview } from "@/web/features/library/library-queries";
import { PaperDetail } from "@/web/features/library/paper-detail";
import { AddResource } from "@/web/features/library/resource-form";

export function Library({
  overview,
  id,
  tab = "papers",
  discuss,
  refresh,
}: {
  overview: LabOverview;
  id?: string;
  tab?: string;
  discuss: (text: string) => void;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<"papers" | "datasets" | null>(null);
  const [search, setSearch] = useState("");
  const kind = tab === "datasets" ? "datasets" : "papers";
  const paper = id
    ? overview.papers.find((entry) => entry.id === id)
    : undefined;
  const dataset = id
    ? overview.datasets.find((entry) => entry.id === id)
    : undefined;
  return (
    <div className="page">
      {id ? (
        <>
          <a
            className="back"
            href={routePath({
              labId: overview.lab.id,
              page: "library",
              tab: kind,
            })}
          >
            {t("library.back")}
          </a>
          {paper ? (
            <PaperDetail paper={paper} overview={overview} discuss={discuss} />
          ) : dataset ? (
            <DatasetDetail dataset={dataset} overview={overview} />
          ) : (
            <Empty title={t("library.notFound")}>
              {t("library.notFoundBody")}
            </Empty>
          )}
        </>
      ) : (
        <>
          <PageHeading
            eyebrow={t("library.eyebrow")}
            title={t("library.title")}
            action={
              <button
                className="primary"
                type="button"
                onClick={() => setAdding(kind)}
              >
                <Icon name="plus" size={15} />
                {kind === "papers"
                  ? t("library.addPaper")
                  : t("library.registerDataset")}
              </button>
            }
          >
            {t("library.subtitle")}
          </PageHeading>
          <nav className="tabs" aria-label={t("library.collections")}>
            <a
              aria-current={kind === "papers" ? "page" : undefined}
              href={routePath({ labId: overview.lab.id, page: "library" })}
            >
              {t("library.papersTab", { count: overview.papers.length })}
            </a>
            <a
              aria-current={kind === "datasets" ? "page" : undefined}
              href={routePath({
                labId: overview.lab.id,
                page: "library",
                tab: "datasets",
              })}
            >
              {t("library.datasetsTab", { count: overview.datasets.length })}
            </a>
          </nav>
          <div className="toolbar">
            <label className="sr-only" htmlFor="library-search">
              {t("library.searchLabel")}
            </label>
            <input
              id="library-search"
              type="search"
              placeholder={
                kind === "papers"
                  ? t("library.searchPapers")
                  : t("library.searchDatasets")
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Section
            title={
              kind === "papers"
                ? t("library.papers")
                : t("library.datasetVersions")
            }
          >
            {kind === "papers" ? (
              <>
                {overview.papers
                  .filter((entry) =>
                    `${entry.title} ${entry.authors.join(" ")}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((entry) => (
                    <article className="record" key={entry.id}>
                      <h3>
                        <a
                          href={routePath({
                            labId: overview.lab.id,
                            page: "library",
                            id: entry.id,
                          })}
                        >
                          {entry.title}
                        </a>
                      </h3>
                      <p>{entry.authors.join(", ") || entry.source}</p>
                      <div className="record-meta">
                        <span>
                          {entry.identifier || t("library.providedSource")}
                        </span>
                        <span>
                          {entry.text
                            ? t("library.textAvailable")
                            : t("library.metadataOnly")}
                        </span>
                        <time dateTime={entry.createdAt}>
                          {timestamp(entry.createdAt)}
                        </time>
                      </div>
                    </article>
                  ))}
                {!overview.papers.some((entry) =>
                  `${entry.title} ${entry.authors.join(" ")}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && (
                  <Empty
                    title={
                      search
                        ? t("library.noMatchingPapers")
                        : t("library.emptyShelf")
                    }
                  >
                    {t("library.emptyShelfBody")}
                  </Empty>
                )}
              </>
            ) : (
              <>
                {overview.datasets
                  .filter((entry) =>
                    `${entry.name} ${entry.description}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((entry) => (
                    <article className="record" key={entry.id}>
                      <div className="record-heading">
                        <h3>
                          <a
                            href={routePath({
                              labId: overview.lab.id,
                              page: "library",
                              id: entry.id,
                              tab: "datasets",
                            })}
                          >
                            {entry.name}
                          </a>
                        </h3>
                        <span className="status">
                          {t("common.version", { version: entry.version })}
                        </span>
                      </div>
                      <p>{entry.description || entry.source}</p>
                      <div className="record-meta">
                        <span>
                          {t("library.preservedFiles", {
                            count: entry.files.length,
                          })}
                        </span>
                        <span>
                          {t("library.experimentLinks", {
                            count: overview.experiments.filter((experiment) =>
                              experiment.datasetVersionIds.includes(entry.id),
                            ).length,
                          })}
                        </span>
                        <time dateTime={entry.createdAt}>
                          {timestamp(entry.createdAt)}
                        </time>
                      </div>
                    </article>
                  ))}
                {!overview.datasets.some((entry) =>
                  `${entry.name} ${entry.description}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && (
                  <Empty
                    title={
                      search
                        ? t("library.noMatchingDatasets")
                        : t("library.noDatasets")
                    }
                  >
                    {t("library.noDatasetsBody")}
                  </Empty>
                )}
              </>
            )}
          </Section>
        </>
      )}
      {adding && (
        <AddResource
          labId={overview.lab.id}
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export function LibraryPage(props: {
  labId: string;
  id?: string;
  tab?: string;
  discuss: (text: string) => void;
  onRefresh: () => void;
}) {
  const query = useLibraryOverview(props.labId);
  return (
    <QueryState
      loading={query.loading}
      error={query.error}
      hasData={!!query.data}
      refresh={query.refresh}
    >
      {query.data && (
        <Library
          overview={query.data}
          id={props.id}
          tab={props.tab}
          refresh={() => {
            query.refresh();
            props.onRefresh();
          }}
          discuss={props.discuss}
        />
      )}
    </QueryState>
  );
}
