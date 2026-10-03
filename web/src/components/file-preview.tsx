import type { FileView } from "@pico/server/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { bytes, timestamp } from "@/web/components/format";
import { languageForPath } from "@/web/components/highlight";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Code, Icon, Notice } from "@/web/components/primitives";

export function rawUrl(labId: string, path: string, download = false): string {
  return `/api${labPath(labId, `/files/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`)}`;
}

export function extensionOf(path: string): string {
  return path.split(".").at(-1)?.toLowerCase() ?? "";
}

const images = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export type PreviewKind =
  | "pdf"
  | "image"
  | "markdown"
  | "csv"
  | "json"
  | "code"
  | "text"
  | "binary";

export function previewKind(path: string, binary: boolean): PreviewKind {
  const extension = extensionOf(path);
  if (extension === "pdf") return "pdf";
  if (images.has(extension)) return "image";
  if (binary) return "binary";
  if (extension === "md") return "markdown";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "json" || extension === "jsonl") return "json";
  if (languageForPath(path)) return "code";
  return "text";
}

/** A small CSV reader for previews: quoted fields, comma or tab separated. */
export function parseDelimited(
  text: string,
  limit = 300,
): { header: string[]; rows: string[][]; total: number } {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const separator = lines[0]?.includes("\t") ? "\t" : ",";
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = !quoted;
      } else if (character === separator && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += character;
    }
    cells.push(cell);
    return cells;
  };
  const [first, ...rest] = lines;
  return {
    header: first ? split(first) : [],
    rows: rest.slice(0, limit).map(split),
    total: rest.length,
  };
}

function Table({ text }: { text: string }) {
  const { t } = useTranslation();
  const table = parseDelimited(text);
  // Rows of a preview have no identity of their own; positions serve as keys.
  const header = table.header.map((cell, column) => ({
    id: `h${column}`,
    cell,
  }));
  const rows = table.rows.map((row, line) => ({
    id: `r${line}`,
    cells: row.map((cell, column) => ({ id: `c${column}`, cell })),
  }));
  return (
    <>
      <p className="meta preview-note">
        {t("files.csvRows", { shown: table.rows.length, total: table.total })}
      </p>
      <div className="table-scroll">
        <table className="data-table csv-table">
          <thead>
            <tr>
              {header.map((entry) => (
                <th key={entry.id}>{entry.cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((entry) => (
                  <td key={entry.id}>{entry.cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Renders a file for reading: PDFs and images through the browser, text by kind. */
export function FilePreview({
  labId,
  file,
  tall = false,
}: {
  labId: string;
  file: Extract<FileView, { kind: "file" }>;
  tall?: boolean;
}) {
  const { t } = useTranslation();
  const kind = previewKind(file.path, file.binary);
  const url = rawUrl(labId, file.path);
  if (kind === "pdf")
    return (
      <iframe
        className={tall ? "pdf-frame tall" : "pdf-frame"}
        src={url}
        title={file.path}
      />
    );
  if (kind === "image")
    return (
      <div className="image-preview">
        <img src={url} alt={file.path} />
      </div>
    );
  if (kind === "binary")
    return (
      <Notice>
        {t("files.binary")}{" "}
        <a className="text-button" href={rawUrl(labId, file.path, true)}>
          {t("files.download")}
        </a>
      </Notice>
    );
  const content = file.content ?? "";
  if (kind === "markdown")
    return (
      <div className="markdown-preview">
        <Markdown>{content}</Markdown>
      </div>
    );
  if (kind === "csv") return <Table text={content} />;
  if (kind === "json") {
    let pretty = content;
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      /* keep as is, it may be JSON lines */
    }
    return <Code language="json">{pretty}</Code>;
  }
  return <Code language={languageForPath(file.path)}>{content}</Code>;
}

export function FileActions({
  labId,
  path,
  size,
  modifiedAt,
  truncated,
}: {
  labId: string;
  path: string;
  size?: number;
  modifiedAt?: string | null;
  truncated?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="file-actions">
      <span className="meta">
        {size !== undefined && bytes(size)}
        {modifiedAt && ` · ${timestamp(modifiedAt)}`}
        {truncated && ` · ${t("files.truncated")}`}
      </span>
      <span className="actions">
        <button
          type="button"
          className="small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(path);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard may be unavailable */
            }
          }}
        >
          {copied ? t("files.copied") : t("files.copyPath")}
        </button>
        <a className="button small" href={rawUrl(labId, path, true)}>
          <Icon name="arrow" size={13} />
          {t("files.download")}
        </a>
      </span>
    </div>
  );
}
