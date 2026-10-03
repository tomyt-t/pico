import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, routePath } from "@/web/app/navigation";
import { FolderGlance } from "@/web/components/folder-glance";
import { bytes, kindLabel, number } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import { Markdown } from "@/web/components/markdown";
import {
  FieldsTable,
  RecordPage,
  RecordRow,
} from "@/web/components/record-card";
import { paperRoute } from "@/web/features/library/library-page";

/** The fields a source or dataset record carries, with the labels a reader
 *  expects; anything else keeps the generic table. */
const labelled = [
  "path",
  "file",
  "text",
  "url",
  "doi",
  "authors",
  "pages",
  "chars",
  "files",
  "bytes",
  "source",
  "license",
  "sha256",
] as const;
type Labelled = (typeof labelled)[number];

function isLabelled(key: string): key is Labelled {
  return (labelled as readonly string[]).includes(key);
}

function SourceFields({
  labId,
  record,
}: {
  labId: string;
  record: ResearchRecord;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(record.fields);
  // Empty values say nothing to a reader; the generic table still lists them.
  const known = entries.filter(
    ([key, raw]) =>
      isLabelled(key) && raw !== null && raw !== undefined && raw !== "",
  );
  const rest = Object.fromEntries(entries.filter(([key]) => !isLabelled(key)));
  const value = (key: Labelled, raw: unknown) => {
    if (typeof raw === "number")
      return key === "bytes" ? bytes(raw) : number(raw);
    if (typeof raw !== "string") return JSON.stringify(raw);
    if (key === "url")
      return (
        <a href={raw} target="_blank" rel="noopener noreferrer">
          {raw}
        </a>
      );
    if (key === "doi")
      return (
        <a
          href={`https://doi.org/${raw.replace(/^https?:\/\/doi\.org\//, "")}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {raw}
        </a>
      );
    if ((key === "file" || key === "text") && raw.startsWith("papers/"))
      return (
        <a className="mono" href={paperRoute(labId, raw)}>
          {raw}
        </a>
      );
    if (key === "path" || key === "file" || key === "text")
      return raw.startsWith("/") ? (
        <span className="mono">{raw}</span>
      ) : (
        <a
          className="mono"
          href={routePath({ labId, page: "collection", path: raw })}
        >
          {raw}
        </a>
      );
    if (key === "sha256") return <span className="mono">{raw}</span>;
    return raw;
  };
  return (
    <>
      {record.body ? (
        <Markdown>{record.body}</Markdown>
      ) : (
        <p className="muted">{t("record.noBody")}</p>
      )}
      {known.length > 0 && (
        <dl className="details-grid source-fields">
          {known.map(([key, raw]) => (
            <div key={key}>
              <dt>{t(`library.${key as Labelled}`)}</dt>
              <dd>{value(key as Labelled, raw)}</dd>
            </div>
          ))}
        </dl>
      )}
      {Object.keys(rest).length > 0 && (
        <>
          <p className="eyebrow">{t("record.fields")}</p>
          <FieldsTable fields={rest} labId={labId} />
        </>
      )}
    </>
  );
}

/** A paper or dataset: labelled fields, who uses it, what produced it, and
 *  its folder. */
export function SourceDetail({
  lab,
  id,
  all,
  discuss,
}: {
  lab: Lab;
  id: string;
  all: ResearchRecord[];
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 10_000);
  const from = currentRoute();
  const record = all.find((item) => item.id === id);
  const folder =
    record && typeof record.fields.path === "string"
      ? record.fields.path.replace(/\/+$/, "")
      : null;
  const usedBy = record
    ? all.filter((item) => item.links.some((link) => link.id === record.id))
    : [];
  const producedBy =
    record?.kind === "dataset" && folder && !folder.startsWith("/")
      ? (jobs.data ?? []).filter(
          (job) =>
            job.metricsPath.includes(`/${folder}/`) ||
            job.cwd.endsWith(`/${folder}`),
        )
      : [];
  const license =
    record && typeof record.fields.license === "string"
      ? record.fields.license
      : null;
  const paperFile =
    record?.kind === "paper"
      ? ["file", "text"]
          .map((key) => record.fields[key])
          .find(
            (value): value is string =>
              typeof value === "string" && value.startsWith("papers/"),
          )
      : undefined;
  return (
    <RecordPage
      labId={lab.id}
      id={id}
      all={all}
      discuss={discuss}
      links={false}
      back={{
        label: t("collection.title"),
        href: routePath({ labId: lab.id, page: "collection" }),
      }}
      eyebrow={
        record ? (
          <p className="eyebrow">
            {kindLabel(record.kind)} · <span className="id-chip">{id}</span>
            {license && (
              <span className="chip pending source-license">{license}</span>
            )}
          </p>
        ) : undefined
      }
      renderContent={(current) => (
        <SourceFields labId={lab.id} record={current} />
      )}
    >
      {(current) => (
        <div className="front-sections">
          {paperFile && (
            <p>
              <a className="button small" href={paperRoute(lab.id, paperFile)}>
                {t("collection.openReader")}
              </a>
            </p>
          )}
          <section>
            <p className="eyebrow">
              {t("collection.usedBy")}{" "}
              <span className="count">{usedBy.length}</span>
            </p>
            {usedBy.length ? (
              usedBy.map((item) => (
                <RecordRow key={item.id} record={item} from={from} />
              ))
            ) : (
              <p className="muted small">
                {t("collection.notUsed", { kind: kindLabel(current.kind) })}
              </p>
            )}
          </section>
          {producedBy.length > 0 && (
            <section>
              <p className="eyebrow">{t("collection.producedBy")}</p>
              {producedBy.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  jobs={jobs.data ?? []}
                  from={from}
                />
              ))}
            </section>
          )}
          {current.links.length > 0 && (
            <section>
              <p className="eyebrow">{t("record.links")}</p>
              {current.links.map((link) => {
                const target = all.find((item) => item.id === link.id);
                return target ? (
                  <RecordRow key={link.id} record={target} from={from} />
                ) : null;
              })}
            </section>
          )}
          {folder && !folder.startsWith("/") && (
            <div className="front-aside">
              <FolderGlance
                labId={lab.id}
                folder={folder}
                title={t("fronts.files")}
                sizes
              />
            </div>
          )}
        </div>
      )}
    </RecordPage>
  );
}
