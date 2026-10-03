import type {
  FileView,
  PageBlock,
  ResearchRecord,
} from "@pico/server/contracts";
import type { ReactNode } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, recordRoute, routePath } from "@/web/app/navigation";
import { FilePreview } from "@/web/components/file-preview";
import { kindLabel, shortDate, statusLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Loading, Notice } from "@/web/components/primitives";
import { recordHref } from "@/web/components/record-card";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A figure: the file, numbered, with a caption that says what to see. */
function ArtifactBlock({
  labId,
  path,
  caption,
  number,
}: { labId: string; number: number } & Omit<
  Extract<PageBlock, { type: "artifact" }>,
  "type"
>) {
  const { t } = useTranslation();
  // The existing file endpoint resolves and guards paths inside this lab.
  const query = usePoll<FileView>(
    labPath(labId, `/files?path=${encodeURIComponent(path)}`),
    60_000,
  );
  const file = query.data;
  const name = path.replace(/\/+$/, "").split("/").at(-1) ?? path;
  return (
    <figure className="page-artifact">
      {query.loading && !file && (
        <Loading>{t("pages.loadingArtifact")}</Loading>
      )}
      {query.error && (
        <Notice error>
          {query.error}
          {file && ` ${t("common.outOfDate")}`}{" "}
          <button type="button" className="text-button" onClick={query.refresh}>
            {t("common.retry")}
          </button>
        </Notice>
      )}
      {file?.kind === "directory" && (
        <Notice>{t("pages.artifactDirectory")}</Notice>
      )}
      {file?.kind === "file" && <FilePreview labId={labId} file={file} />}
      <figcaption>
        <b>{t("pages.figure", { number })}</b>
        {caption ? ` — ${caption}` : ""}
        <a
          className="figure-source"
          href={routePath({ labId, page: "collection", path })}
          title={path}
        >
          {name}
        </a>
      </figcaption>
    </figure>
  );
}

/** Records cited by the page: the evidence behind the passage above them. */
function EvidenceBlock({
  labId,
  ids,
  known,
}: {
  labId: string;
  ids: string[];
  known: Map<string, ResearchRecord>;
}) {
  const { t } = useTranslation();
  const from = currentRoute();
  return (
    <section className="evidence">
      <p className="evidence-label">{t("pages.evidence")}</p>
      {ids.map((id) => {
        const record = known.get(id);
        if (!record)
          return (
            <a
              className="evidence-row is-missing"
              href={routePath(recordRoute(labId, { kind: "", id }))}
              key={id}
            >
              <span className="evidence-kind">{t("record.id")}</span>
              <span className="evidence-title">{id}</span>
              <span className="evidence-when">
                {t("pages.recordNotLoaded")}
              </span>
            </a>
          );
        const superseded = /supersed/i.test(record.status ?? "");
        return (
          <a
            className={`evidence-row${superseded ? " is-superseded" : ""}`}
            href={recordHref(record, from)}
            key={id}
            data-status={record.status ?? undefined}
          >
            <span className="evidence-kind">{kindLabel(record.kind)}</span>
            <span className="evidence-title">{record.title}</span>
            <span className="evidence-when">
              {superseded && record.status
                ? statusLabel(record.status)
                : shortDate(record.updatedAt)}
            </span>
          </a>
        );
      })}
    </section>
  );
}

/** A stored page is content, not a program: only these three blocks render.
 *  The first markdown block is the lead; figures are numbered in order. */
export function PageBlocks({
  labId,
  blocks,
  body,
  records = [],
  title,
}: {
  labId: string;
  blocks: unknown;
  body: string;
  records?: ResearchRecord[];
  title?: string;
}) {
  const { t } = useTranslation();
  const known = new Map(
    records
      .filter((record) => record.labId === labId)
      .map((record) => [record.id, record]),
  );
  const entries: unknown[] =
    blocks === undefined ? [] : Array.isArray(blocks) ? blocks : [null];
  let hasContent = false;
  let figures = 0;
  const content = entries.map((value, index) => {
    let rendered: ReactNode = null;
    let warning: ReactNode = t("pages.invalidBlock", { index: index + 1 });
    let role = "";
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const block = value as Record<string, unknown>;
      switch (block.type) {
        case "markdown":
          if (hasText(block.text)) {
            const text =
              index === 0 && title
                ? block.text.replace(
                    /^#\s+([^\n]+)\n?/,
                    (heading, value: string) =>
                      value.trim() === title.trim() ? "" : heading,
                  )
                : block.text;
            rendered = <Markdown>{text}</Markdown>;
            warning = null;
            if (index === 0 && !/^\s*#/.test(text)) role = " page-lead";
          }
          break;
        case "records": {
          if (!Array.isArray(block.ids)) break;
          const ids = [...new Set(block.ids.filter(hasText))];
          if (!ids.length) break;
          warning = block.ids.every(hasText)
            ? null
            : t("pages.incompleteRecords", { index: index + 1 });
          rendered = <EvidenceBlock labId={labId} ids={ids} known={known} />;
          break;
        }
        case "artifact":
          if (hasText(block.path)) {
            const caption =
              typeof block.caption === "string" ? block.caption : undefined;
            figures += 1;
            rendered = (
              <ArtifactBlock
                labId={labId}
                path={block.path}
                caption={caption}
                number={figures}
              />
            );
            warning =
              block.caption === undefined || caption !== undefined
                ? null
                : warning;
          }
          break;
        default:
          if (hasText(block.type))
            warning = t("pages.unsupportedBlock", {
              index: index + 1,
              type: block.type,
            });
      }
    }
    if (rendered) hasContent = true;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: Blocks have no persisted IDs; file queries reset whenever the lab or path changes.
      <div className={`page-block${role}`} key={`block-${index}`}>
        {warning && <Notice>{warning}</Notice>}
        {rendered}
      </div>
    );
  });
  return (
    <div className="page-blocks">
      {content}
      {hasContent && hasText(body) && (
        <details className="page-alternative">
          <summary>{t("pages.alternativeReading")}</summary>
          <Markdown>{body}</Markdown>
        </details>
      )}
      {!hasContent &&
        (hasText(body) ? (
          <Markdown>{body}</Markdown>
        ) : (
          <Notice>{t("pages.emptyContent")}</Notice>
        ))}
    </div>
  );
}
