import type { Actor, JsonObject, Revision } from "@/lab/contracts";
import type { DatabaseConnection } from "@/lab/storage/database";
import { StorageConflict } from "@/lab/storage/errors";

interface RecordRow {
  data: string;
}
interface Identified {
  id: string;
}
/** Private persistence primitive. Capability repositories define access. */
export class Records {
  constructor(private readonly connection: DatabaseConnection) {}
  get<T = unknown>(kind: string, id: string): T | undefined {
    const row = this.connection.database
      .query<RecordRow, [string, string]>(
        "SELECT data FROM records WHERE kind = ? AND id = ?",
      )
      .get(kind, id);
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  list<T = unknown>(kind: string, labId?: string): T[] {
    const rows =
      labId === undefined
        ? this.connection.database
            .query<RecordRow, [string]>(
              "SELECT data FROM records WHERE kind = ? ORDER BY created_at, rowid",
            )
            .all(kind)
        : this.connection.database
            .query<RecordRow, [string, string]>(
              "SELECT data FROM records WHERE kind = ? AND lab_id = ? ORDER BY created_at, rowid",
            )
            .all(kind, labId);
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  insert<T extends Identified>(kind: string, labId: string, record: T): T {
    const now = new Date().toISOString();
    this.connection.database
      .query(
        "INSERT INTO records(id,lab_id,kind,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(record.id, labId, kind, JSON.stringify(record), now, now);
    return record;
  }

  replace<T extends Identified>(kind: string, labId: string, record: T): T {
    const result = this.connection.database
      .query(
        "UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND kind = ? AND lab_id = ?",
      )
      .run(
        JSON.stringify(record),
        new Date().toISOString(),
        record.id,
        kind,
        labId,
      );
    if (result.changes !== 1)
      throw new StorageConflict(
        "Record missing or belongs to another laboratory",
      );
    return record;
  }

  revise<T extends Identified>(
    kind: string,
    labId: string,
    record: T,
    revision: { reason: string; author: unknown },
  ): T {
    return this.connection.transaction(() => {
      const previous = this.get<T>(kind, record.id);
      if (!previous)
        throw new StorageConflict("Cannot revise a missing record");
      this.connection.database
        .query(
          "INSERT INTO revisions(record_id,lab_id,data,reason,author,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          record.id,
          labId,
          JSON.stringify(previous),
          revision.reason,
          JSON.stringify(revision.author),
          new Date().toISOString(),
        );
      return this.replace(kind, labId, record);
    });
  }

  revisions<T = JsonObject>(
    recordId: string,
  ): (Omit<Revision, "snapshot"> & { snapshot: T })[] {
    const rows = this.connection.database
      .query<
        {
          sequence: number;
          record_id: string;
          lab_id: string;
          data: string;
          kind: string;
          reason: string;
          author: string;
          created_at: string;
        },
        [string]
      >(
        "SELECT revisions.*, records.kind FROM revisions JOIN records ON records.id = revisions.record_id WHERE record_id = ? ORDER BY sequence",
      )
      .all(recordId);
    return rows.map((row) => ({
      id: `revision-${row.sequence}`,
      recordId: row.record_id,
      labId: row.lab_id,
      kind: row.kind,
      revision: (JSON.parse(row.data) as { revision?: number }).revision ?? 1,
      snapshot: JSON.parse(row.data) as T,
      reason: row.reason,
      author: JSON.parse(row.author) as Actor,
      createdAt: row.created_at,
    }));
  }

  query<T>(
    kind: string,
    labId: string | undefined,
    predicate: string,
    parameters: (string | number)[] = [],
    limit?: number,
  ): T[] {
    const values: (string | number)[] = [kind];
    let sql = "SELECT data FROM records WHERE kind = ?";
    if (labId !== undefined) {
      sql += " AND lab_id = ?";
      values.push(labId);
    }
    sql += ` AND (${predicate}) ORDER BY created_at, rowid`;
    values.push(...parameters);
    if (limit !== undefined) {
      sql += " LIMIT ?";
      values.push(limit);
    }
    return this.connection.database
      .query<{ data: string }, (string | number)[]>(sql)
      .all(...values)
      .map((row) => JSON.parse(row.data) as T);
  }
}
