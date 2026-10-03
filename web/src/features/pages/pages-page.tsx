import type {
  Campaign,
  EditorialStatus,
  Job,
  Lab,
  ResearchRecord,
} from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { picoContent, useLabContext } from "@/web/app/laboratory-queries";
import { routePath } from "@/web/app/navigation";
import { useTranslation } from "@/web/components/i18n";
import { Notice, PageHeading } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { RecordList, RecordPage } from "@/web/components/record-card";
import { ComposedPanorama } from "@/web/features/pages/auto-panorama";
import { EditorialNotice } from "@/web/features/pages/editorial-notice";
import { PageBlocks } from "@/web/features/pages/page-blocks";
import type { useLabPages } from "@/web/features/pages/page-queries";
import { PanoramaRail, PanoramaToc } from "@/web/features/pages/panorama-frame";
import { pageHeadings } from "@/web/features/pages/toc";
import { useRecords } from "@/web/features/records/record-queries";

type PagesQuery = ReturnType<typeof useLabPages>;
type RecordsQuery = ReturnType<typeof useRecords>;

function PageDocument({
  lab,
  id,
  discuss,
  editorial,
  records,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
  editorial?: EditorialStatus;
  records: RecordsQuery;
}) {
  const { t } = useTranslation();
  return (
    <>
      {records.error && (
        <div className="page">
          <Notice error>
            {records.error} {t("pages.referencesError")}{" "}
            <button
              type="button"
              className="text-button"
              onClick={records.refresh}
            >
              {t("common.retry")}
            </button>
          </Notice>
        </div>
      )}
      <RecordPage
        document
        labId={lab.id}
        id={id}
        all={records.data ?? []}
        discuss={discuss}
        beforeContent={
          <EditorialNotice
            labId={lab.id}
            status={editorial}
            pageId={id}
            discuss={discuss}
          />
        }
        back={{
          label: t("pages.allPages"),
          href: routePath({ labId: lab.id, page: "pages" }),
        }}
        renderContent={(record) =>
          record.kind === "page" ? (
            <PageBlocks
              labId={lab.id}
              blocks={record.fields.blocks}
              body={record.body}
              records={records.data}
              title={record.title}
            />
          ) : undefined
        }
      />
    </>
  );
}

/** The Panorama page between its table of contents and the margin that says
 *  where the research stands. */
function PanoramaDocument({
  lab,
  page,
  discuss,
  editorial,
}: {
  lab: Lab;
  page: ResearchRecord;
  discuss: (text: string) => void;
  editorial?: EditorialStatus;
}) {
  const records = useRecords(lab.id, 10_000);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 10_000);
  const campaigns = usePoll<Campaign[]>(labPath(lab.id, "/campaigns"), 15_000);
  const pico = useLabContext(lab.id);
  return (
    <div className="panorama-layout">
      <PanoramaToc headings={pageHeadings(page)} />
      <div className="panorama-main">
        <PageDocument
          lab={lab}
          id={page.id}
          discuss={discuss}
          editorial={editorial}
          records={records}
        />
      </div>
      <PanoramaRail
        lab={lab}
        records={records.data ?? []}
        jobs={jobs.data ?? []}
        campaigns={campaigns.data ?? []}
        pico={picoContent(pico.data)}
        discuss={discuss}
      />
    </div>
  );
}

function StandalonePage({
  lab,
  id,
  discuss,
  editorial,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
  editorial?: EditorialStatus;
}) {
  const records = useRecords(lab.id, 10_000);
  return (
    <PageDocument
      lab={lab}
      id={id}
      discuss={discuss}
      editorial={editorial}
      records={records}
    />
  );
}

export function PagesPage({
  lab,
  id,
  panorama = false,
  query,
  discuss,
}: {
  lab: Lab;
  id?: string;
  panorama?: boolean;
  query: PagesQuery;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const editorial = usePoll<EditorialStatus>(
    labPath(lab.id, "/editorial"),
    10_000,
  );
  const selected = panorama ? query.panorama?.id : id;
  return (
    <div className="composed-pages">
      {panorama && !selected && (
        <div className="page panorama-intro">
          <PageHeading title={t("pages.panorama")}>
            {t("pages.panoramaSubtitle")}
          </PageHeading>
        </div>
      )}
      {editorial.error && (
        <div className="page">
          <Notice error>
            {t("pages.reviewUnavailable")}{" "}
            <button
              type="button"
              className="text-button"
              onClick={editorial.refresh}
            >
              {t("common.retry")}
            </button>
          </Notice>
        </div>
      )}
      {!selected && (
        <div className="page">
          <EditorialNotice
            labId={lab.id}
            status={editorial.data}
            discuss={discuss}
          />
        </div>
      )}
      {(panorama || !id) && (
        <div className="page page-query-state">
          <QueryState
            loading={query.loading && !query.data}
            error={query.error}
            hasData={!!query.data}
            refresh={query.refresh}
          >
            {query.data &&
              !selected &&
              (panorama ? (
                // No page designated as Panorama: compose one from the records.
                <ComposedPanorama lab={lab} discuss={discuss} />
              ) : (
                <>
                  <PageHeading title={t("pages.allPages")}>
                    {t("pages.pagesSubtitle")}
                  </PageHeading>
                  <RecordList
                    records={
                      query.panorama
                        ? [query.panorama, ...query.pages]
                        : query.pages
                    }
                    empty={t("pages.emptyPages")}
                  />
                </>
              ))}
          </QueryState>
        </div>
      )}
      {selected &&
        (panorama && query.panorama ? (
          <PanoramaDocument
            key={selected}
            lab={lab}
            page={query.panorama}
            discuss={discuss}
            editorial={editorial.data}
          />
        ) : (
          <StandalonePage
            key={selected}
            lab={lab}
            id={selected}
            discuss={discuss}
            editorial={editorial.data}
          />
        ))}
    </div>
  );
}
