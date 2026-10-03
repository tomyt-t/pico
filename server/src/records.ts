import type { Database } from "bun:sqlite";
import {
  type RecordFilter,
  type RecordHistoryEntry,
  type RecordKind,
  type RecordLink,
  type RecordRevision,
  type ResearchRecord,
  recordKinds,
  type SavePageInput,
  type SaveRecordInput,
} from "./contracts";
import { now } from "./db";
import { badRequest, notFound } from "./errors";
import { newId } from "./ids";

export type {
  RecordFilter,
  RecordHistoryEntry,
  RecordKind,
  RecordLink,
  RecordRevision,
  ResearchRecord,
  SaveRecordInput,
};
export { recordKinds };

const prefixes: Record<RecordKind, string> = {
  question: "q",
  hypothesis: "h",
  experiment: "e",
  result: "r",
  conclusion: "c",
  note: "n",
  paper: "p",
  dataset: "d",
  page: "page",
};

interface Row {
  id: string;
  lab_id: string;
  kind: RecordKind;
  title: string;
  status: string | null;
  body: string;
  fields: string;
  links: string;
  author: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: Row): ResearchRecord => ({
  id: row.id,
  labId: row.lab_id,
  kind: row.kind,
  title: row.title,
  status: row.status,
  body: row.body,
  fields: JSON.parse(row.fields) as Record<string, unknown>,
  links: JSON.parse(row.links) as RecordLink[],
  author: row.author,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function normalizeLinks(links: RecordLink[] | undefined): RecordLink[] {
  const seen = new Set<string>();
  const result: RecordLink[] = [];
  for (const link of links ?? []) {
    const kind = String(link.kind ?? "").trim();
    const id = String(link.id ?? "").trim();
    if (!id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind, id });
  }
  return result;
}

export class Records {
  constructor(private readonly db: Database) {}

  savePage(
    labId: string,
    input: SavePageInput,
    author: string,
  ): ResearchRecord {
    if (!input || typeof input !== "object")
      throw badRequest("A page is required");
    if (input.blocks !== undefined && !Array.isArray(input.blocks))
      throw badRequest("blocks must be an array");
    if (
      input.placement !== undefined &&
      input.placement !== null &&
      input.placement !== "panorama"
    )
      throw badRequest("placement must be panorama or null");
    const fields: Record<string, unknown> = {};
    if (input.blocks !== undefined) fields.blocks = input.blocks;
    if (input.placement !== undefined) fields.placement = input.placement;
    return this.save(
      labId,
      {
        id: input.id,
        kind: "page",
        title: input.title,
        body: input.body,
        fields,
        links: input.links,
        reason: input.reason,
      },
      author,
    );
  }

  save(labId: string, input: SaveRecordInput, author: string): ResearchRecord {
    if (!(recordKinds as readonly string[]).includes(input.kind))
      throw badRequest(
        `Unknown kind "${input.kind}"; use one of ${recordKinds.join(", ")}`,
      );
    const timestamp = now();
    const current = input.id ? this.find(labId, input.id) : undefined;
    if (current) {
      if (current.kind !== input.kind)
        throw badRequest(
          `Record ${current.id} is a ${current.kind}; create a new record for a different kind`,
        );
      const updated: ResearchRecord = {
        ...current,
        title: input.title?.trim() || current.title,
        status: input.status === undefined ? current.status : input.status,
        body: input.body ?? current.body,
        fields: input.fields
          ? { ...current.fields, ...input.fields }
          : current.fields,
        links: input.links ? normalizeLinks(input.links) : current.links,
        author,
        revision: current.revision + 1,
        updatedAt: timestamp,
      };
      this.db.transaction(() => {
        this.db.run(
          "INSERT INTO revisions (record_id, lab_id, revision, snapshot, author, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            current.id,
            labId,
            current.revision,
            JSON.stringify(current),
            author,
            input.reason ?? null,
            timestamp,
          ],
        );
        this.db.run(
          "UPDATE records SET title = ?, status = ?, body = ?, fields = ?, links = ?, author = ?, revision = ?, updated_at = ? WHERE id = ? AND lab_id = ?",
          [
            updated.title,
            updated.status,
            updated.body,
            JSON.stringify(updated.fields),
            JSON.stringify(updated.links),
            author,
            updated.revision,
            updated.updatedAt,
            current.id,
            labId,
          ],
        );
      })();
      return updated;
    }
    const title = input.title?.trim();
    if (!title) throw badRequest("title is required to create a record");
    const id = input.id?.trim() || newId(prefixes[input.kind]);
    if (this.db.query("SELECT 1 FROM records WHERE id = ?").get(id))
      throw badRequest(`Record id ${id} belongs to another laboratory`);
    const record: ResearchRecord = {
      id,
      labId,
      kind: input.kind,
      title,
      status: input.status ?? null,
      body: input.body ?? "",
      fields: input.fields ?? {},
      links: normalizeLinks(input.links),
      author,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.run(
      "INSERT INTO records (id, lab_id, kind, title, status, body, fields, links, author, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        record.id,
        labId,
        record.kind,
        record.title,
        record.status,
        record.body,
        JSON.stringify(record.fields),
        JSON.stringify(record.links),
        author,
        1,
        timestamp,
        timestamp,
      ],
    );
    return record;
  }

  find(labId: string, id: string): ResearchRecord | undefined {
    const row = this.db
      .query("SELECT * FROM records WHERE id = ? AND lab_id = ?")
      .get(id, labId) as Row | null;
    return row ? fromRow(row) : undefined;
  }

  get(labId: string, id: string): ResearchRecord {
    const record = this.find(labId, id);
    if (!record) throw notFound(`Record ${id} not found`);
    return record;
  }

  list(labId: string, filter: RecordFilter = {}): ResearchRecord[] {
    const conditions = ["lab_id = ?"];
    const values: (string | number)[] = [labId];
    if (filter.kind) {
      conditions.push("kind = ?");
      values.push(filter.kind);
    }
    if (filter.status) {
      conditions.push("status = ?");
      values.push(filter.status);
    }
    values.push(Math.min(Math.max(filter.limit ?? 500, 1), 5000));
    return (
      this.db
        .query(
          `SELECT * FROM records WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(...values) as Row[]
    ).map(fromRow);
  }

  /** Existing records only, newest first; ties use id and resulting revision.
   * Defaults to 100 entries, capped at 500, optionally filtered by kind. */
  history(
    labId: string,
    options: { kind?: string; limit?: number } = {},
  ): RecordHistoryEntry[] {
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? Math.min(Math.max(Math.trunc(options.limit), 1), 500)
        : 100;
    const kindCondition = options.kind ? " AND record.kind = ?" : "";
    const filter = options.kind ? [labId, options.kind] : [labId];
    const rows = this.db
      .query(
        `WITH recent AS (
          SELECT record.id AS record_id, 1 AS target_revision,
            record.created_at AS at, NULL AS author, NULL AS reason
          FROM records AS record
          WHERE record.lab_id = ?${kindCondition}
          UNION ALL
          SELECT revision.record_id, revision.revision + 1,
            revision.created_at, revision.author, revision.reason
          FROM revisions AS revision
          JOIN records AS record
            ON record.id = revision.record_id AND record.lab_id = revision.lab_id
          WHERE record.lab_id = ?${kindCondition}
          ORDER BY at DESC, record_id ASC, target_revision DESC
          LIMIT ?
        )
        SELECT record.*, recent.target_revision, recent.at AS event_at,
          recent.author AS event_author, recent.reason,
          previous.snapshot AS before_snapshot, following.snapshot AS after_snapshot
        FROM recent
        JOIN records AS record ON record.id = recent.record_id AND record.lab_id = ?
        LEFT JOIN revisions AS previous
          ON previous.record_id = record.id AND previous.lab_id = record.lab_id
          AND previous.revision = recent.target_revision - 1
        LEFT JOIN revisions AS following
          ON following.record_id = record.id AND following.lab_id = record.lab_id
          AND following.revision = recent.target_revision
        ORDER BY recent.at DESC, recent.record_id ASC, recent.target_revision DESC`,
      )
      .all(...filter, ...filter, limit, labId) as (Row & {
      target_revision: number;
      event_at: string;
      event_author: string | null;
      reason: string | null;
      before_snapshot: string | null;
      after_snapshot: string | null;
    })[];
    return rows.map((row): RecordHistoryEntry => {
      const after = row.after_snapshot
        ? (JSON.parse(row.after_snapshot) as ResearchRecord)
        : fromRow(row);
      const common = {
        recordId: row.id,
        at: row.event_at,
        author: row.event_author ?? after.author,
        reason: row.reason,
        after,
      };
      // A revision row stores the old snapshot; its metadata describes the
      // transition to the following snapshot (or the current record).
      return row.target_revision === 1
        ? { ...common, type: "created", before: null }
        : {
            ...common,
            type: "revised",
            before: JSON.parse(row.before_snapshot as string) as ResearchRecord,
          };
    });
  }

  revisions(labId: string, id: string): RecordRevision[] {
    this.get(labId, id);
    return (
      this.db
        .query(
          "SELECT revision, snapshot, author, reason, created_at FROM revisions WHERE record_id = ? ORDER BY revision",
        )
        .all(id) as {
        revision: number;
        snapshot: string;
        author: string;
        reason: string | null;
        created_at: string;
      }[]
    ).map((row) => ({
      revision: row.revision,
      snapshot: JSON.parse(row.snapshot) as ResearchRecord,
      author: row.author,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  remove(labId: string, id: string): void {
    this.get(labId, id);
    this.db.transaction(() => {
      this.db.run("DELETE FROM revisions WHERE record_id = ?", [id]);
      this.db.run("DELETE FROM records WHERE id = ? AND lab_id = ?", [
        id,
        labId,
      ]);
    })();
  }
}
