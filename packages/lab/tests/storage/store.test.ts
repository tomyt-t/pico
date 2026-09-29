import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchBackup } from "@/lab/storage/backup";
import { DatabaseConnection } from "@/lab/storage/database";
import { applyMigrations, migrations } from "@/lab/storage/migrations/migrate";
import { OperationRepository } from "@/lab/storage/operation-repository";
import { Records } from "@/lab/storage/records";

/** Internal fixture exercises persistence primitives without exposing them from the runtime. */
class Store extends Records {
  readonly database;
  readonly dataDir: string;
  readonly operations: OperationRepository;
  private readonly backupService: ResearchBackup;
  constructor(path: string) {
    const connection = new DatabaseConnection(path);
    super(connection);
    this.database = connection.database;
    this.dataDir = connection.dataDir;
    this.operations = new OperationRepository(connection, this);
    this.backupService = new ResearchBackup(connection);
  }
  mutate<T>(
    input: Parameters<OperationRepository["mutate"]>[0],
    action: () => T,
  ): T {
    return this.operations.mutate(input, action);
  }
  close() {
    this.database.close();
  }
  backup(destination: string) {
    return this.backupService.create(destination);
  }
  static restore = ResearchBackup.restore;
}

const directories: string[] = [];
const stores: Store[] = [];
function temporary(): string {
  const dir = mkdtempSync(join(tmpdir(), "pico-storage-"));
  directories.push(dir);
  return dir;
}
function open(path = join(temporary(), "data")): Store {
  const store = new Store(path);
  stores.push(store);
  return store;
}
afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("durable records and migrations", () => {
  test("reopens IDs, relationships, authors and prior revisions", () => {
    const store = open();
    const question = {
      id: "q1",
      labId: "lab1",
      text: "Why?",
      author: { kind: "human" },
    };
    store.insert("question", "lab1", question);
    store.revise(
      "question",
      "lab1",
      { ...question, text: "Why under these conditions?" },
      { reason: "Narrow the scope", author: { kind: "pico", turnId: "t1" } },
    );
    store.close();
    const reopened = open(store.dataDir);
    expect(reopened.get<typeof question>("question", "q1")?.text).toBe(
      "Why under these conditions?",
    );
    expect(reopened.revisions<typeof question>("q1")[0]?.snapshot).toEqual(
      question,
    );
    expect(reopened.revisions("q1")[0]?.reason).toBe("Narrow the scope");
  });

  test("applies new versions atomically without replacing existing research", () => {
    const store = open();
    store.insert("question", "lab1", { id: "q1", labId: "lab1" });
    applyMigrations(store.database, [
      ...migrations,
      {
        version: 2,
        name: "example_extension",
        sql: "CREATE TABLE example (id TEXT PRIMARY KEY)",
      },
    ]);
    expect(store.get<{ id: string; labId: string }>("question", "q1")).toEqual({
      id: "q1",
      labId: "lab1",
    });
    expect(() =>
      applyMigrations(store.database, [
        ...migrations,
        { version: 2, name: "example_extension", sql: "" },
        {
          version: 3,
          name: "broken_extension",
          sql: "CREATE TABLE transient (id TEXT); invalid sql",
        },
      ]),
    ).toThrow();
    expect(
      store.database
        .query("SELECT * FROM schema_migrations WHERE version = 3")
        .get(),
    ).toBeNull();
    expect(
      store.database
        .query("SELECT name FROM sqlite_master WHERE name = 'transient'")
        .get(),
    ).toBeNull();
    expect(() => applyMigrations(store.database)).toThrow(
      "Unsupported database migration 2",
    );
  });

  test("rolls back failed migrations including their version marker", () => {
    const db = new Database(":memory:");
    try {
      expect(() =>
        applyMigrations(db, [
          { version: 1, name: "invalid", sql: "CREATE TABLE x(a); nonsense" },
        ]),
      ).toThrow();
      expect(
        db.query("SELECT name FROM sqlite_master WHERE name = 'x'").get(),
      ).toBeNull();
      expect(db.query("SELECT * FROM schema_migrations").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("idempotency", () => {
  test("returns the persisted result on retry and rejects key reuse with different input", () => {
    const store = open();
    const command = {
      labId: "lab1",
      key: "request1",
      operation: "createQuestion",
      input: { b: 2, a: 1 },
    };
    const result = store.mutate(command, () =>
      store.insert("question", "lab1", { id: "q1" }),
    );
    expect(
      store.mutate<{ id: string }>(
        { ...command, input: { a: 1, b: 2 } },
        () => {
          throw new Error("Duplicate effect");
        },
      ),
    ).toEqual(result);
    expect(store.list("question", "lab1")).toHaveLength(1);
    expect(() =>
      store.mutate({ ...command, input: { a: 2 } }, () => null),
    ).toThrow("different arguments");
  });

  test("failed commands leave neither a receipt nor partial scientific records", () => {
    const store = open();
    const command = {
      labId: "lab1",
      key: "request1",
      operation: "create",
      input: {},
    };
    expect(() =>
      store.mutate(command, () => {
        store.insert("question", "lab1", { id: "q1" });
        throw new Error("Later validation failed");
      }),
    ).toThrow();
    expect(store.get("question", "q1")).toBeUndefined();
    expect(
      store.mutate(command, () =>
        store.insert("question", "lab1", { id: "q2" }),
      ),
    ).toEqual({ id: "q2" });
  });
});

describe("backup and restore", () => {
  test("restores the database, history, receipts and exact research bytes", () => {
    const root = temporary();
    const store = open(join(root, "source"));
    store.mutate(
      { labId: "lab1", key: "original", operation: "create", input: {} },
      () => store.insert("question", "lab1", { id: "q1", text: "Original?" }),
    );
    const path = join(store.dataDir, "labs/lab1/runs/run1/code");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "experiment.py"), "print(42)\n");
    const backup = store.backup(join(root, "backup"));
    writeFileSync(join(path, "experiment.py"), "print(99)\n");
    store.replace("question", "lab1", { id: "q1", text: "Updated?" });
    Store.restore(backup, join(root, "restored"));
    const restored = open(join(root, "restored"));
    expect(
      restored.get<{ id: string; text: string }>("question", "q1"),
    ).toEqual({ id: "q1", text: "Original?" });
    expect(
      readFileSync(
        join(restored.dataDir, "labs/lab1/runs/run1/code/experiment.py"),
        "utf8",
      ),
    ).toBe("print(42)\n");
    expect(
      restored.mutate<{ id: string; text: string }>(
        { labId: "lab1", key: "original", operation: "create", input: {} },
        () => {
          throw new Error("Receipt lost");
        },
      ),
    ).toEqual({ id: "q1", text: "Original?" });
  });

  test("rejects modified backups before creating a destination", () => {
    const root = temporary();
    const store = open(join(root, "source"));
    const backup = store.backup(join(root, "backup"));
    writeFileSync(join(backup, "pico.sqlite"), "corrupt");
    expect(() => Store.restore(backup, join(root, "restored"))).toThrow(
      "integrity manifest",
    );
  });

  test("requires a quiescent laboratory and rejects unsafe filesystem entries", () => {
    const root = temporary();
    const store = open(join(root, "source"));
    store.insert("run", "lab1", { id: "r1", status: "running" });
    expect(() => store.backup(join(root, "active-backup"))).toThrow(
      "active runs and turns",
    );
    store.replace("run", "lab1", { id: "r1", status: "succeeded" });
    symlinkSync("/etc/hosts", join(store.dataDir, "labs", "unsafe"));
    expect(() => store.backup(join(root, "unsafe-backup"))).toThrow("symlinks");
  });
});

test("backup omits process identities and verifies legacy identities before discarding them", async () => {
  const root = temporary();
  const store = open(join(root, "source"));
  const runDirectory = join(store.dataDir, "labs/lab1/runs/run1");
  mkdirSync(runDirectory, { recursive: true });
  const runBytes = JSON.stringify({
    schemaVersion: 1,
    id: "run1",
    labId: "lab1",
    status: "succeeded",
    workerPid: 12345,
  });
  writeFileSync(join(runDirectory, "run.json"), runBytes);
  writeFileSync(
    join(runDirectory, "worker.claim"),
    JSON.stringify({ pid: 12345 }),
  );
  const backup = store.backup(join(root, "backup"));
  const { existsSync } = await import("node:fs");
  expect(existsSync(join(backup, "labs/lab1/runs/run1/worker.claim"))).toBe(
    false,
  );
  // A prior v1 backup included this file: authenticate original bytes first.
  const identityPath = "labs/lab1/runs/run1/worker.claim";
  const identityBytes = Buffer.from(JSON.stringify({ pid: 12345 }));
  writeFileSync(join(backup, identityPath), identityBytes);
  const manifest = JSON.parse(
    readFileSync(join(backup, "manifest.json"), "utf8"),
  ) as { files: { path: string; sha256: string; bytes: number }[] };
  const { createHash } = await import("node:crypto");
  manifest.files.push({
    path: identityPath,
    sha256: createHash("sha256").update(identityBytes).digest("hex"),
    bytes: identityBytes.length,
  });
  manifest.files.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest));
  Store.restore(backup, join(root, "restored"));
  expect(existsSync(join(root, "restored", identityPath))).toBe(false);
  expect(
    readFileSync(join(root, "restored/labs/lab1/runs/run1/run.json"), "utf8"),
  ).toBe(runBytes);
});

test("restoring an unresolved operational job never authorizes it to execute", () => {
  const root = temporary();
  const store = open(join(root, "source"));
  const runDirectory = join(store.dataDir, "labs/lab1/runs/run1");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(
    join(runDirectory, "run.json"),
    JSON.stringify({ id: "run1", status: "queued" }),
  );
  const backup = store.backup(join(root, "backup"));
  expect(() => Store.restore(backup, join(root, "restored"))).toThrow(
    "unresolved operational run",
  );
});
