import type { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCatalog } from "../src/agent-catalog";
import type { Lab, ResearchRecord } from "../src/contracts";
import { openDatabase } from "../src/db";
import { Editorial, pageShape } from "../src/editorial";
import { Records } from "../src/records";

let db: Database | undefined;
let root: string | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function setup() {
  root = mkdtempSync(join(tmpdir(), "pico-editorial-"));
  const path = join(root, "pico.sqlite");
  db = openDatabase(path);
  const lab: Lab = {
    id: "lab",
    name: "Research",
    path: root,
    researchLine: "Question",
    provider: null,
    model: null,
    thinking: "off",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  };
  db.run(
    "INSERT INTO labs (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [lab.id, lab.name, lab.path, lab.createdAt, lab.updatedAt],
  );
  new AgentCatalog(db, async () => []);
  writeFileSync(join(root, "PICO.md"), "Research direction");
  const records = new Records(db);
  const editorial = new Editorial(db, records);
  let index = 0;
  const begin = () => {
    const id = `run-${++index}`;
    db?.run(
      "INSERT INTO agent_runs (id, lab_id, agent_id, name, task, status, provider, model, thinking, created_at) VALUES (?, ?, 'research-editor', 'Editor', 'Review', 'running', 'fake', 'fake', 'off', ?)",
      [id, lab.id, new Date().toISOString()],
    );
    editorial.begin(lab, id);
    return id;
  };
  const page = (title: string, extra: Record<string, unknown> = {}) =>
    records.save(
      lab.id,
      { kind: "page", title, body: "Readable explanation", fields: extra },
      "pico",
    );
  const acknowledge = (
    run: string,
    item: ResearchRecord,
    pending: string[] = [],
  ) =>
    editorial.review(lab, run, [
      {
        id: item.id,
        revision: item.revision,
        summary: "Evidence and limits reviewed",
        pending,
      },
    ]);
  return { lab, records, editorial, begin, page, acknowledge, path };
}

test("coverage records actual page revisions without rewriting them or treating a completed run as a review", () => {
  const { lab, records, editorial, begin, page, acknowledge } = setup();
  const source = records.save(
    lab.id,
    { kind: "result", title: "Observed result" },
    "pico",
  );
  const panorama = page("Panorama", { placement: "panorama" });
  const topic = page("Topic");
  const run = begin();
  expect(
    editorial.status(lab).pages.every((item) => item.state === "unreviewed"),
  ).toBe(true);
  acknowledge(run, topic);
  let status = editorial.status(lab);
  expect(status.needsReview).toBe(true);
  expect(status.pages.find((item) => item.pageId === topic.id)?.state).toBe(
    "reviewed",
  );
  expect(
    status.pages.find((item) => item.pageId === panorama.id)?.changedRecords,
  ).toContain(source.id);
  acknowledge(run, panorama);
  db?.run("UPDATE agent_runs SET status='completed', notified=1 WHERE id=?", [
    run,
  ]);
  status = editorial.status(lab);
  expect(status.needsReview).toBe(false);
  expect(status.activeRunId).toBeNull();
  expect(records.get(lab.id, topic.id).revision).toBe(1);
  expect(records.revisions(lab.id, topic.id)).toHaveLength(0);
  const neverReviewed = page("New topic");
  expect(
    editorial.status(lab).pages.find((item) => item.pageId === neverReviewed.id)
      ?.state,
  ).toBe("unreviewed");
});

test("new, revised and removed research arriving during editing stays pending until another pass", () => {
  const { lab, records, begin, page, acknowledge } = setup();
  const updated = records.save(
    lab.id,
    { kind: "result", title: "First" },
    "pico",
  );
  const removed = records.save(
    lab.id,
    { kind: "note", title: "Removed" },
    "pico",
  );
  const panorama = page("Panorama", { placement: "panorama" });
  const run = begin();
  const added = records.save(
    lab.id,
    { kind: "paper", title: "New source not linked to the page" },
    "subagent:research",
  );
  records.save(
    lab.id,
    { id: updated.id, kind: "result", body: "Corrected" },
    "researcher",
  );
  records.remove(lab.id, removed.id);
  let status = acknowledge(run, panorama);
  expect(new Set(status.pages[0]?.changedRecords)).toEqual(
    new Set([updated.id, removed.id, added.id]),
  );
  expect(
    status.changes.find((item) => item.id === removed.id)?.revision,
  ).toBeNull();
  expect(status.needsReview).toBe(true);
  const next = begin();
  status = acknowledge(next, panorama);
  expect(status.needsReview).toBe(false);
  expect(records.get(lab.id, panorama.id).revision).toBe(1);
});

test("concurrent page edits require re-reading; partial progress and explicit issues survive failures", () => {
  const { lab, records, editorial, begin, page, acknowledge } = setup();
  const panorama = page("Panorama", { placement: "panorama" });
  const topic = page("Topic");
  const run = begin();
  const edited = records.save(
    lab.id,
    { id: topic.id, kind: "page", body: "Researcher contribution" },
    "researcher",
  );
  expect(() =>
    editorial.review(lab, run, [
      { id: panorama.id, revision: 1, summary: "Overview read" },
      { id: topic.id, revision: 1, summary: "Stale review" },
    ]),
  ).toThrow("read and reconcile");
  expect(
    editorial.status(lab).pages.find((item) => item.pageId === panorama.id)
      ?.state,
  ).toBe("reviewed");
  acknowledge(run, edited, [
    "Critical analysis must resolve contradictory findings",
  ]);
  db?.run("UPDATE agent_runs SET status='failed', notified=1 WHERE id=?", [
    run,
  ]);
  const status = editorial.status(lab);
  expect(status.activeRunId).toBeNull();
  expect(status.lastRun?.status).toBe("failed");
  expect(
    status.pages.find((item) => item.pageId === topic.id)?.pending,
  ).toHaveLength(1);
  expect(status.needsReview).toBe(true);
  expect(() => acknowledge(run, edited)).toThrow("ended");
  expect(records.get(lab.id, topic.id).body).toBe("Researcher contribution");
});

test("file edits, invalid blocks and unavailable references remain visible even after acknowledgment", () => {
  const { lab, records, editorial, begin, page, acknowledge } = setup();
  writeFileSync(join(lab.path, "figure.svg"), "<svg>before</svg>");
  const source = records.save(
    lab.id,
    { kind: "result", title: "Figure result" },
    "pico",
  );
  const panorama = page("Panorama", {
    placement: "panorama",
    blocks: [
      { type: "artifact", path: "figure.svg" },
      { type: "records", ids: [source.id] },
    ],
  });
  const run = begin();
  acknowledge(run, panorama);
  writeFileSync(join(lab.path, "figure.svg"), "<svg>after!</svg>");
  let status = acknowledge(run, panorama);
  expect(status.pages[0]?.changedFiles).toContain("figure.svg");
  unlinkSync(join(lab.path, "figure.svg"));
  records.remove(lab.id, source.id);
  const broken = records.save(
    lab.id,
    {
      id: panorama.id,
      kind: "page",
      fields: {
        blocks: [
          { type: "artifact", path: "figure.svg" },
          { type: "records", ids: [source.id] },
          { type: "unknown" },
        ],
      },
    },
    "researcher",
  );
  status = acknowledge(begin(), broken);
  expect(status.pages[0]).toMatchObject({
    state: "pending",
    missingFiles: ["figure.svg"],
    missingRecords: [source.id],
    invalidBlocks: [3],
  });
  expect(records.get(lab.id, panorama.id).body).toBe("Readable explanation");
  // An external symlink is not silently attested as a laboratory artifact.
  const elsewhere = mkdtempSync(join(tmpdir(), "pico-elsewhere-"));
  try {
    writeFileSync(join(elsewhere, "hosts"), "outside the laboratory");
    try {
      symlinkSync(join(elsewhere, "hosts"), join(lab.path, "external"));
    } catch (error) {
      // Windows creates symlinks only for administrators or in Developer
      // Mode; without one there is no external link to attest.
      if ((error as { code?: string }).code === "EPERM") return;
      throw error;
    }
    const outside = page("External", {
      blocks: [{ type: "artifact", path: "external" }],
    });
    expect(
      editorial.status(lab).pages.find((item) => item.pageId === outside.id)
        ?.missingFiles,
    ).toEqual(["external"]);
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("form warnings name what keeps a page from reading well, without touching its science", () => {
  const { lab, page, editorial } = setup();
  const shouting = page("Shouting", {
    blocks: [
      {
        type: "markdown",
        text: "## QUANDO — DECIDIDO NO VOO\n\n**AUC 0,735** nos **primeiros 10%** com **dois terços** do ganho (r-5073e275).",
      },
      { type: "records", ids: ["a", "b", "c", "d"] },
      { type: "records", ids: ["e"] },
      { type: "artifact", path: "figure.png", caption: "Figura 3 — âncora" },
      { type: "artifact", path: "other.png" },
    ],
  });
  expect(pageShape(shouting)).toEqual([
    "Block 1 opens with a heading; open with a lead of two to four sentences that says what the page knows",
    'Block 1: heading "QUANDO — DECIDIDO NO VOO" is in capitals; use sentence case',
    "Block 1: a paragraph carries 3 bold spans; keep one, on the sentence the reader should take away",
    "Block 1: record ids inside the prose; cite them in a records block instead",
    "Block 2: 4 records in one block; keep up to three, the ones the passage rests on",
    "Blocks 2 and 3: two records blocks in a row; separate them with explanation",
    'Block 4: caption starts with "Figura n"; the reader numbers figures, start with what the figure shows',
    "Block 5: figure without a caption; say what to see and what limits it",
  ]);
  const quiet = page("Quiet", {
    blocks: [
      {
        type: "markdown",
        text: "A pergunta: quando o sinal decide? A evidência sustenta uma separação tardia.",
      },
      {
        type: "markdown",
        text: "## Quando: a separação acontece tarde\n\nO salto acontece **no fim**.",
      },
      { type: "records", ids: ["a", "b", "c"] },
      {
        type: "artifact",
        path: "figure.png",
        caption: "A curva, plana até o corte. Medida só onde há identidade.",
      },
      { type: "markdown", text: "> Limite: metade dos instantes." },
    ],
  });
  expect(pageShape(quiet)).toEqual([]);
  expect(
    editorial.status(lab).pages.find((item) => item.pageId === shouting.id)
      ?.shape,
  ).toHaveLength(8);
  expect(editorial.promptContext(lab)).toContain("8 form warnings to fix");
});

test("coverage survives reopening and detects later direction changes and page deletion", () => {
  const { lab, begin, page, acknowledge, path } = setup();
  const panorama = page("Panorama", { placement: "panorama" });
  acknowledge(begin(), panorama);
  db?.close();
  db = openDatabase(path);
  const reopenedRecords = new Records(db);
  const reopened = new Editorial(db, reopenedRecords);
  expect(reopened.status(lab).needsReview).toBe(false);
  db?.run(
    "UPDATE labs SET context_markdown=?, context_revision=context_revision+1 WHERE id=?",
    ["A revised direction", lab.id],
  );
  expect(reopened.status(lab).pages[0]?.contextChanged).toBe(true);
  reopenedRecords.save(
    lab.id,
    { id: panorama.id, kind: "page", body: "Another author's change" },
    "researcher",
  );
  expect(reopened.status(lab).pages[0]?.contentChanged).toBe(true);
  reopenedRecords.remove(lab.id, panorama.id);
  expect(db.query("SELECT COUNT(*) AS count FROM page_reviews").get()).toEqual({
    count: 0,
  });
  expect(reopened.status(lab).panoramaMissing).toBe(true);
});

test("new artifact references are observed on page read/save and later file edits are retained", () => {
  const { lab, records, editorial, begin, page, acknowledge } = setup();
  const run = begin();
  writeFileSync(join(lab.path, "new.svg"), "<svg/>");
  const panorama = page("Panorama", {
    placement: "panorama",
    blocks: [{ type: "artifact", path: "new.svg" }],
  });
  editorial.observe(lab, run, panorama);
  expect(acknowledge(run, panorama).needsReview).toBe(false);
  writeFileSync(join(lab.path, "new.svg"), "<svg>new</svg>");
  editorial.observe(lab, run, records.get(lab.id, panorama.id));
  expect(acknowledge(run, panorama).pages[0]?.changedFiles).toContain(
    "new.svg",
  );
});

test("a linked topic revision invalidates its Panorama without creating a global page-edit loop", () => {
  const { lab, records, editorial, begin, page, acknowledge } = setup();
  const topic = page("A topic");
  const panorama = page("Panorama", {
    placement: "panorama",
    blocks: [{ type: "records", ids: [topic.id] }],
  });
  const unrelated = page("Other topic");
  const run = begin();
  acknowledge(run, topic);
  acknowledge(run, panorama);
  acknowledge(run, unrelated);
  const revised = records.save(
    lab.id,
    { id: topic.id, kind: "page", body: "Revised interpretation" },
    "researcher",
  );
  let status = editorial.status(lab);
  expect(
    status.pages.find((item) => item.pageId === panorama.id)?.changedRecords,
  ).toEqual([topic.id]);
  expect(status.pages.find((item) => item.pageId === unrelated.id)?.state).toBe(
    "reviewed",
  );
  editorial.observe(lab, run, revised);
  acknowledge(run, revised);
  // The original checkpoint retains the version it saw, even after a later read.
  expect(
    editorial.status(lab).pages.find((item) => item.pageId === panorama.id)
      ?.state,
  ).toBe("pending");
  status = acknowledge(run, panorama);
  expect(status.needsReview).toBe(false);
});

test("direction changes during editorial work stay pending until a later review", () => {
  const { lab, editorial, begin, page, acknowledge } = setup();
  const panorama = page("Panorama", { placement: "panorama" });
  const run = begin();
  db?.run(
    "UPDATE labs SET context_markdown='New direction', context_revision=context_revision+1 WHERE id=?",
    [lab.id],
  );
  expect(acknowledge(run, panorama).pages[0]).toMatchObject({
    state: "pending",
    contextChanged: true,
  });
  expect(acknowledge(begin(), panorama).pages[0]).toMatchObject({
    state: "reviewed",
    contextChanged: false,
  });
  expect(editorial.status(lab).needsReview).toBe(false);
});
