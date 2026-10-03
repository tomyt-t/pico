import type { Job, ResearchRecord } from "@pico/server/contracts";
import { bytes, statusLabel } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";
import { experimentOf } from "@/web/features/experiments/job-links";
import {
  type Front,
  frontLabel,
  frontOf,
  frontsOf,
} from "@/web/features/fronts/fronts";
import type { PaperItem } from "@/web/features/library/library-page";

export type Origin = "pico" | "researcher" | "campaign" | "subagent";

/** One line of the collection: a record, an execution or a source file. */
export interface CollectionItem {
  key: string;
  /** A record kind, "job" for executions or "paper" for a file without a record. */
  kind: string;
  title: string;
  status: string | null;
  /** When it last moved: the sort key and the day group. */
  at: string;
  origin: Origin;
  /** The experiment id of the front it belongs to, or null. */
  frontId: string | null;
  /** The short remark after the title: formats and size, files and licence. */
  note?: string;
  record?: ResearchRecord;
  job?: Job;
  file?: PaperItem;
  text: string;
}

export interface Facets {
  kinds: Set<string>;
  statuses: Set<string>;
  fronts: Set<string>;
  origins: Set<Origin>;
}

export const noFront = "none";

export function emptyFacets(kinds: Iterable<string> = []): Facets {
  return {
    kinds: new Set(kinds),
    statuses: new Set(),
    fronts: new Set(),
    origins: new Set(),
  };
}

export function originOf(author: string): Origin {
  if (author.startsWith("campaign:")) return "campaign";
  if (author.startsWith("subagent:")) return "subagent";
  return author === "researcher" ? "researcher" : "pico";
}

/** The remark a source row carries: what a reader needs before opening it. */
export function sourceNote(
  record: ResearchRecord,
  papers: Map<string, PaperItem>,
): string | undefined {
  const t = i18n.t;
  if (record.kind === "paper") {
    const item = papers.get(record.id);
    if (!item) return undefined;
    return item.files
      .map(
        (file) => `${file.extension.toUpperCase()} · ${bytes(file.entry.size)}`,
      )
      .join(" · ");
  }
  if (record.kind === "dataset") {
    const parts: string[] = [];
    if (typeof record.fields.files === "number")
      parts.push(t("common.files", { count: record.fields.files }));
    if (typeof record.fields.bytes === "number")
      parts.push(bytes(record.fields.bytes));
    if (typeof record.fields.license === "string")
      parts.push(record.fields.license);
    return parts.join(" · ") || undefined;
  }
  return undefined;
}

/** Everything the collection lists, newest first. */
export function collectionItems(
  records: ResearchRecord[],
  jobs: Job[],
  papers: PaperItem[],
  fronts: Front[] = frontsOf(records, jobs),
): CollectionItem[] {
  const byRecord = new Map(
    papers
      .filter((item) => item.record)
      .map((item) => [item.record?.id ?? "", item]),
  );
  const items: CollectionItem[] = records.map((record) => ({
    key: record.id,
    kind: record.kind,
    title: record.title,
    status: record.status,
    at: record.updatedAt,
    origin: originOf(record.author),
    frontId: frontOf(record, fronts)?.experiment.id ?? null,
    note: sourceNote(record, byRecord),
    record,
    text: [
      record.id,
      record.title,
      record.body,
      record.status ?? "",
      ...Object.values(record.fields).filter(
        (value) => typeof value === "string",
      ),
    ].join(" "),
  }));
  for (const job of jobs)
    items.push({
      key: job.id,
      kind: "job",
      title: job.name,
      status: job.status,
      at: job.endedAt ?? job.startedAt ?? job.createdAt,
      origin: job.campaignId ? "campaign" : "pico",
      frontId: experimentOf(job, records)?.id ?? null,
      job,
      text: [job.id, job.name, job.command, job.status].join(" "),
    });
  for (const item of papers)
    if (!item.record)
      items.push({
        key: `file:${item.key}`,
        kind: "paper",
        title: item.title,
        status: null,
        at: item.modifiedAt ?? "",
        origin: "researcher",
        frontId: null,
        note: item.files
          .map(
            (file) =>
              `${file.extension.toUpperCase()} · ${bytes(file.entry.size)}`,
          )
          .join(" · "),
        file: item,
        text: [item.title, ...item.files.map((file) => file.path)].join(" "),
      });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function matches(item: CollectionItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || item.text.toLocaleLowerCase().includes(needle);
}

type Dimension = keyof Facets;

function facetValue(item: CollectionItem, dimension: Dimension): string {
  switch (dimension) {
    case "kinds":
      return item.kind;
    case "statuses":
      return item.status ?? "";
    case "fronts":
      return item.frontId ?? noFront;
    case "origins":
      return item.origin;
  }
}

/** The items that pass the search and every facet, except the one named in
 *  `skip`, so that dimension can count what each of its options would add. */
export function applyFacets(
  items: CollectionItem[],
  facets: Facets,
  query = "",
  skip?: Dimension,
): CollectionItem[] {
  const dimensions: Dimension[] = ["kinds", "statuses", "fronts", "origins"];
  return items.filter(
    (item) =>
      matches(item, query) &&
      dimensions.every((dimension) => {
        if (dimension === skip) return true;
        const selected = facets[dimension] as Set<string>;
        return !selected.size || selected.has(facetValue(item, dimension));
      }),
  );
}

/** How many items each option of a dimension would show, given the others. */
export function facetCounts(
  items: CollectionItem[],
  facets: Facets,
  query: string,
  dimension: Dimension,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of applyFacets(items, facets, query, dimension)) {
    const value = facetValue(item, dimension);
    if (dimension === "statuses" && !value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Labels for facet values; fronts by their number, statuses as written. */
export function facetLabel(
  dimension: Dimension,
  value: string,
  fronts: Front[],
): string {
  const t = i18n.t;
  switch (dimension) {
    case "kinds":
      return value === "job"
        ? t("collection.executions")
        : i18n.t(`kindsPlural.${value as "note"}`);
    case "statuses":
      return statusLabel(value);
    case "fronts": {
      if (value === noFront) return t("collection.noFront");
      const front = fronts.find((item) => item.experiment.id === value);
      if (!front) return value;
      // Two fronts with the same number need their titles to tell them apart.
      const shared =
        front.number !== null &&
        fronts.some(
          (other) => other !== front && other.number === front.number,
        );
      const title = front.experiment.title;
      return shared
        ? title.length > 40
          ? `${title.slice(0, 39)}…`
          : title
        : frontLabel(front.experiment);
    }
    case "origins":
      return t(`collection.origin.${value as Origin}`);
  }
}

export function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
