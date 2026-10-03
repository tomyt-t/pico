import type {
  FileView,
  RecordDetailView,
  ResearchRecord,
} from "@pico/server/contracts";
import { type ReactNode, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import {
  navigate,
  parseRoute,
  recordRoute,
  routePath,
  useRoute,
} from "@/web/app/navigation";
import {
  excerpt,
  kindLabel,
  relativeTime,
  shortTimestamp,
  timestamp,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import {
  Code,
  Empty,
  Icon,
  Loading,
  Notice,
  Status,
} from "@/web/components/primitives";
import { useAuthor } from "@/web/features/records/authors";

export function recordHref(
  record: { labId: string; kind: string; id: string },
  from?: string,
): string {
  return routePath({ ...recordRoute(record.labId, record), from });
}

/** The way back from a detail: where it was opened from, else the page's own list. */
export function useBackLink(fallback: { label: string; href: string }): {
  label: string;
  href: string;
} {
  const route = useRoute();
  const { t } = useTranslation();
  if (!route?.from) return fallback;
  const origin = parseRoute(route.from);
  const page = origin?.page === "overview" ? "panorama" : origin?.page;
  return {
    label: page ? t(`shell.pages.${page}`) : t("common.back"),
    href: route.from,
  };
}

export function RecordCard({
  record,
  compact = false,
}: {
  record: ResearchRecord;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const author = useAuthor();
  const summary = compact ? "" : excerpt(record.body, 180);
  return (
    <article className={compact ? "record compact" : "record"}>
      <div className="record-heading">
        <h3>
          <a href={recordHref(record)}>{record.title}</a>
        </h3>
        {record.status && <Status value={record.status} />}
      </div>
      <div className="record-meta">
        <span className="kind-chip">{kindLabel(record.kind)}</span>
        <span>{t("common.by", { author: author(record.author) })}</span>
        <time dateTime={record.updatedAt} title={timestamp(record.updatedAt)}>
          {relativeTime(record.updatedAt)}
        </time>
      </div>
      {summary && <p className="record-summary">{summary}</p>}
    </article>
  );
}

/** One line per record: title, status and time. For nested lists. */
export function RecordRow({
  record,
  from,
  note,
}: {
  record: ResearchRecord;
  /** The page to return to from the record. */
  from?: string;
  /** A short remark after the title: formats and size, files and licence. */
  note?: string;
}) {
  return (
    <a className="record-row" href={recordHref(record, from)}>
      <span className={`kind-chip kind-${record.kind}`}>
        {kindLabel(record.kind)}
      </span>
      <span className="record-row-title">{record.title}</span>
      {note && <span className="record-row-note">{note}</span>}
      {record.status && <Status value={record.status} />}
      <time
        className="meta"
        dateTime={record.updatedAt}
        title={timestamp(record.updatedAt)}
      >
        {relativeTime(record.updatedAt)}
      </time>
    </a>
  );
}

export function RecordList({
  records,
  empty,
  compact = false,
}: {
  records: ResearchRecord[];
  empty: string;
  compact?: boolean;
}) {
  if (!records.length) return <Empty title={empty} />;
  return (
    <div className="record-list">
      {records.map((record) => (
        <RecordCard key={record.id} record={record} compact={compact} />
      ))}
    </div>
  );
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

const pathKeys = new Set(["path", "text", "file", "manifest", "protocolo"]);

export function FieldsTable({
  fields,
  labId,
}: {
  fields: Record<string, unknown>;
  labId: string;
}) {
  const entries = Object.entries(fields).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (!entries.length) return null;
  return (
    <dl className="details-grid">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{renderField(key, value, labId)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderField(key: string, value: unknown, labId: string): ReactNode {
  if (typeof value === "string") {
    if (isUrl(value))
      return (
        <a href={value} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      );
    if (pathKeys.has(key) && !value.startsWith("/"))
      return (
        <a href={routePath({ labId, page: "collection", path: value })}>
          {value}
        </a>
      );
    if (value.startsWith("job-"))
      return (
        <a href={routePath({ labId, page: "experiments", id: value })}>
          {value}
        </a>
      );
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return (
      <span className="chip-row">
        {value.map((item) => (
          <span key={item} className="id-chip">
            {renderField(key, item, labId)}
          </span>
        ))}
      </span>
    );
  return <Code language="json">{JSON.stringify(value, null, 2)}</Code>;
}

export function LinkChips({
  labId,
  links,
  known,
}: {
  labId: string;
  links: { kind: string; id: string; title?: string }[];
  /** Ids in the current query; absent ids can still exist outside this result. */
  known?: Set<string>;
}) {
  const { t } = useTranslation();
  if (!links.length) return null;
  return (
    <div className="chip-row">
      {links.map((link) => {
        const notLoaded =
          known && !known.has(link.id) && !link.id.startsWith("job-");
        return (
          <a
            key={`${link.kind}:${link.id}`}
            className={`pill-link${notLoaded ? " missing" : ""}`}
            href={routePath(recordRoute(labId, link))}
            title={notLoaded ? t("record.notLoaded") : undefined}
          >
            {link.kind ? `${kindLabel(link.kind)} · ` : ""}
            {link.title ?? link.id}
          </a>
        );
      })}
    </div>
  );
}

function ProtocolFile({ labId, path }: { labId: string; path: string }) {
  const { t } = useTranslation();
  const file = usePoll<FileView>(
    labPath(labId, `/files?path=${encodeURIComponent(path)}`),
    60_000,
  );
  if (file.data?.kind !== "file" || !file.data.content) return null;
  return (
    <details className="protocol">
      <summary>
        {t("experiments.protocol")} <span className="id-chip">{path}</span>
      </summary>
      <Markdown>{file.data.content}</Markdown>
    </details>
  );
}

function RevisionContent({
  snapshot,
  renderContent,
}: {
  snapshot: ResearchRecord;
  renderContent?: (record: ResearchRecord) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {t("record.beforeBody", { revision: snapshot.revision })}
      </summary>
      {open && (
        <>
          <strong>{snapshot.title}</strong>
          {snapshot.status && <Status value={snapshot.status} />}
          {snapshot.kind === "page" && (
            <Notice>{t("pages.liveReferences")}</Notice>
          )}
          {renderContent?.(snapshot) ?? <Markdown>{snapshot.body}</Markdown>}
        </>
      )}
    </details>
  );
}

/** The stored revisions of a record, folded; each opens its own snapshot. */
function Revisions({
  detail,
  author,
  content,
  renderContent,
}: {
  detail?: RecordDetailView;
  author: (author: string) => string;
  content: ReactNode;
  renderContent?: (record: ResearchRecord) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <details className="revisions">
      <summary>
        {t("record.revisions")}
        {detail?.revisions.length ? (
          <span className="count">{detail.revisions.length}</span>
        ) : null}
      </summary>
      {detail?.revisions.length ? (
        <ul className="timeline">
          {[...detail.revisions].reverse().map((revision) => (
            <li key={revision.revision}>
              <strong>
                {t("record.transition", {
                  before: revision.revision,
                  after: revision.revision + 1,
                })}
              </strong>{" "}
              · {author(revision.author)}
              {revision.reason && (
                <>
                  {" "}
                  · {t("record.reason")}: {revision.reason}
                </>
              )}
              <time>{timestamp(revision.createdAt)}</time>
              {(content !== undefined || revision.snapshot.body) && (
                <RevisionContent
                  snapshot={revision.snapshot}
                  renderContent={renderContent}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("record.noRevisions")}</p>
      )}
    </details>
  );
}

/** Opens a folded section of the document and brings it into view. */
function reveal(root: HTMLElement | null, selector: string) {
  const details = root?.querySelector<HTMLDetailsElement>(selector);
  if (!details) return;
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function RecordPage({
  labId,
  id,
  all,
  discuss,
  back,
  children,
  renderContent,
  beforeContent,
  eyebrow,
  links = true,
  document = false,
}: {
  labId: string;
  id: string;
  all: ResearchRecord[];
  discuss: (text: string) => void;
  back: { label: string; href: string };
  children?: (record: ResearchRecord) => ReactNode;
  /** Reuse the same reader for current content and stored revision snapshots. */
  renderContent?: (record: ResearchRecord) => ReactNode;
  beforeContent?: ReactNode;
  /** Replaces the "Kind · id" line above the title. */
  eyebrow?: ReactNode;
  /** Whether to list the record's links and what references it; a page may show them its own way. */
  links?: boolean;
  document?: boolean;
}) {
  const { t } = useTranslation();
  const author = useAuthor();
  const backLink = useBackLink(back);
  const root = useRef<HTMLElement>(null);
  const detail = usePoll<RecordDetailView>(
    labPath(labId, `/records/${encodeURIComponent(id)}`),
    10_000,
  );
  const record = detail.data?.record;
  const isDocument = document && record?.kind === "page";
  const hasAlternative =
    !!record &&
    record.body.trim().length > 0 &&
    Array.isArray(record.fields.blocks) &&
    record.fields.blocks.length > 0;
  const content = record && renderContent?.(record);
  const titles = new Map(all.map((item) => [item.id, item.title]));
  const known = new Set(all.map((item) => item.id));
  const referencedBy = all.filter((item) =>
    item.links.some((link) => link.id === id),
  );
  const folder =
    record?.kind === "experiment" && typeof record.fields.path === "string"
      ? record.fields.path
      : null;
  return (
    <div className={`page${isDocument ? " page-reading" : ""}`}>
      <a className="back" href={backLink.href}>
        ← {backLink.label}
      </a>
      {detail.loading && !record && (
        <Loading>{t("common.loadingRecord")}</Loading>
      )}
      {detail.error && detail.status !== 404 && (
        <Notice error>{detail.error}</Notice>
      )}
      {!detail.loading &&
        !record &&
        (detail.status === 404 || !detail.error) && (
          <Notice error>{t("overview.notFound", { id })}</Notice>
        )}
      {record && isDocument && (
        <article className="document" ref={root}>
          <header className="document-head">
            <h1>{record.title}</h1>
            <p className="document-byline">
              <b>{author(record.author)}</b>
              <span>{t("record.revision", { revision: record.revision })}</span>
              <time
                dateTime={record.updatedAt}
                title={timestamp(record.updatedAt)}
              >
                {shortTimestamp(record.updatedAt)}
              </time>
              <button
                type="button"
                className="text-button"
                onClick={() => reveal(root.current, "details.revisions")}
              >
                {t("record.revisions")}
              </button>
              {hasAlternative && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    reveal(root.current, "details.page-alternative")
                  }
                >
                  {t("pages.alternativeReading")}
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  discuss(
                    t("record.discussion", {
                      kind: kindLabel(record.kind),
                      id: record.id,
                      title: record.title,
                    }),
                  )
                }
              >
                {t("common.discussWithPico")}
              </button>
            </p>
          </header>
          {beforeContent}
          {content !== undefined ? (
            content
          ) : record.body ? (
            <Markdown>{record.body}</Markdown>
          ) : (
            <p className="muted">{t("record.noBody")}</p>
          )}
          {children?.(record)}
          <Revisions
            detail={detail.data}
            author={author}
            content={content}
            renderContent={renderContent}
          />
        </article>
      )}
      {record && !isDocument && (
        <article className="panel record-detail">
          <div className="record-heading">
            <div>
              {eyebrow ?? (
                <p className="eyebrow">
                  {kindLabel(record.kind)} ·{" "}
                  <span className="id-chip">{record.id}</span>
                </p>
              )}
              <h1>{record.title}</h1>
            </div>
            {record.status && <Status value={record.status} />}
          </div>
          <div className="record-meta">
            <span>{t("common.by", { author: author(record.author) })}</span>
            <span>{t("record.current", { revision: record.revision })}</span>
            <time dateTime={record.updatedAt}>
              {timestamp(record.updatedAt)}
            </time>
            {folder && (
              <a href={routePath({ labId, page: "collection", path: folder })}>
                <Icon name="folder" size={13} /> {folder}
              </a>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                discuss(
                  t("record.discussion", {
                    kind: kindLabel(record.kind),
                    id: record.id,
                    title: record.title,
                  }),
                )
              }
            >
              {t("common.discussWithPico")}
            </button>
          </div>
          {!document && beforeContent}
          {content !== undefined ? (
            content
          ) : record.body ? (
            <Markdown>{record.body}</Markdown>
          ) : (
            <p className="muted">{t("record.noBody")}</p>
          )}
          {content === undefined && Object.keys(record.fields).length > 0 && (
            <>
              <p className="eyebrow">{t("record.fields")}</p>
              <FieldsTable fields={record.fields} labId={labId} />
            </>
          )}
          {links && record.links.length > 0 && (
            <>
              <p className="eyebrow">{t("record.links")}</p>
              <LinkChips
                labId={labId}
                known={known}
                links={record.links.map((link) => ({
                  ...link,
                  title: titles.get(link.id),
                }))}
              />
            </>
          )}
          {links && referencedBy.length > 0 && (
            <>
              <p className="eyebrow">{t("record.linkedFrom")}</p>
              <LinkChips
                labId={labId}
                links={referencedBy.map((item) => ({
                  kind: item.kind,
                  id: item.id,
                  title: item.title,
                }))}
              />
            </>
          )}
          {children?.(record)}
          {folder && (
            <ProtocolFile labId={labId} path={`${folder}/README.md`} />
          )}
          <Revisions
            detail={detail.data}
            author={author}
            content={content}
            renderContent={renderContent}
          />
        </article>
      )}
    </div>
  );
}

export function KindLink({
  labId,
  kind,
  count,
}: {
  labId: string;
  kind: string;
  count: number;
}) {
  const page = recordRoute(labId, { kind, id: "" }).page;
  return (
    <a
      className="stat"
      href={routePath({ labId, page, ...(page === "collection" && { kind }) })}
    >
      <strong>{count}</strong>
      <span>{kindLabel(kind, true)}</span>
    </a>
  );
}

export function goTo(labId: string, id: string): void {
  navigate(recordRoute(labId, { kind: "", id }));
}
