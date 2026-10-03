import type { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type {
  EditorialStatus,
  Lab,
  PageReviewStatus,
  ResearchRecord,
  ReviewPageInput,
} from "./contracts";
import { now } from "./db";
import { badRequest, conflict } from "./errors";
import type { Records } from "./records";

interface Context {
  records: Record<string, string>;
  files: Record<string, string | null>;
  pages?: Record<string, string>;
  labContext?: number;
}

interface Source {
  id: string;
  title: string;
  kind: string;
  revision: number;
  created_at: string;
}

interface Review {
  page_id: string;
  run_id: string;
  page_revision: number;
  files: string;
  summary: string;
  pending: string;
  reviewed_at: string;
  editorial_context: string;
  page_refs: string;
}

const version = (record: Source) => `${record.created_at}/${record.revision}`;
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function references(page: ResearchRecord) {
  const ids = new Set(page.links.map((link) => link.id));
  const files = new Set<string>();
  const invalidBlocks: number[] = [];
  if (page.fields.blocks !== undefined && !Array.isArray(page.fields.blocks))
    invalidBlocks.push(1);
  if (Array.isArray(page.fields.blocks)) {
    for (const [index, block] of page.fields.blocks.entries()) {
      if (!block || typeof block !== "object") {
        invalidBlocks.push(index + 1);
        continue;
      }
      if (block.type === "records" && Array.isArray(block.ids))
        for (const id of block.ids.filter(isText)) ids.add(id);
      if (block.type === "artifact" && isText(block.path))
        files.add(block.path);
      const valid =
        (block.type === "markdown" && isText(block.text)) ||
        (block.type === "records" &&
          Array.isArray(block.ids) &&
          block.ids.length > 0 &&
          block.ids.every(isText)) ||
        (block.type === "artifact" &&
          isText(block.path) &&
          (block.caption === undefined || typeof block.caption === "string"));
      if (!valid) invalidBlocks.push(index + 1);
    }
  }
  return { ids, files, invalidBlocks };
}

const paragraphs = (text: string) => text.split(/\n\s*\n/);

/** How a page reads, as warnings the editor can act on: a lead to open with,
 *  sentence-case headings, at most three records per passage, captions that
 *  say what to see. Nothing here judges the science. */
export function pageShape(page: ResearchRecord): string[] {
  const blocks = Array.isArray(page.fields.blocks) ? page.fields.blocks : [];
  const warnings: string[] = [];
  const markdown = (block: unknown) =>
    block &&
    typeof block === "object" &&
    isText((block as { text?: unknown }).text)
      ? (block as { text: string }).text
      : "";
  const first = blocks[0] as { type?: unknown } | undefined;
  if (first?.type === "markdown") {
    const lead = (paragraphs(markdown(first))[0] ?? "").trim();
    if (/^#/.test(lead))
      warnings.push(
        "Block 1 opens with a heading; open with a lead of two to four sentences that says what the page knows",
      );
    else if (lead.split(/\s+/).length > 90)
      warnings.push(
        "Block 1 lead runs past 90 words; keep it to two to four sentences",
      );
  } else if (blocks.length)
    warnings.push("Block 1 is not markdown; open with a lead paragraph");
  blocks.forEach((value, index) => {
    const n = index + 1;
    const block = (value ?? {}) as Record<string, unknown>;
    if (block.type === "markdown") {
      const text = markdown(block);
      for (const match of text.matchAll(/^#{1,3}\s+(.+?)\s*#*$/gm)) {
        const title = (match[1] ?? "").trim();
        const letters = title.replace(/[^\p{L}]/gu, "");
        if (letters.length >= 6 && letters === letters.toUpperCase())
          warnings.push(
            `Block ${n}: heading "${title.slice(0, 40)}" is in capitals; use sentence case`,
          );
      }
      for (const paragraph of paragraphs(text)) {
        const bold = (paragraph.match(/\*\*[^*\n]+\*\*/g) ?? []).length;
        if (bold > 2) {
          warnings.push(
            `Block ${n}: a paragraph carries ${bold} bold spans; keep one, on the sentence the reader should take away`,
          );
          break;
        }
      }
      if (/(^|[\s(])[a-z]{1,2}-[0-9a-f]{8}\b/.test(text))
        warnings.push(
          `Block ${n}: record ids inside the prose; cite them in a records block instead`,
        );
    }
    if (block.type === "records") {
      const ids = Array.isArray(block.ids) ? block.ids : [];
      if (ids.length > 3)
        warnings.push(
          `Block ${n}: ${ids.length} records in one block; keep up to three, the ones the passage rests on`,
        );
      const next = blocks[index + 1] as { type?: unknown } | undefined;
      if (next?.type === "records")
        warnings.push(
          `Blocks ${n} and ${n + 1}: two records blocks in a row; separate them with explanation`,
        );
    }
    if (block.type === "artifact") {
      const caption = isText(block.caption) ? block.caption.trim() : "";
      if (!caption)
        warnings.push(
          `Block ${n}: figure without a caption; say what to see and what limits it`,
        );
      else if (/^(figura|figure|fig\.)\s*\d/i.test(caption))
        warnings.push(
          `Block ${n}: caption starts with "Figura n"; the reader numbers figures, start with what the figure shows`,
        );
    }
  });
  return warnings;
}

/** Cheap file identity: also catches same-size edits and replacements. No file contents are copied. */
function fileVersion(lab: Lab, path: string): string | null {
  try {
    const root = realpathSync(lab.path);
    const target = realpathSync(resolve(root, path));
    if (!target.startsWith(`${root}${sep}`)) return null;
    const stat = statSync(target, { bigint: true });
    return stat.isFile()
      ? `${stat.dev}/${stat.ino}/${stat.size}/${stat.mtimeNs}/${stat.ctimeNs}`
      : null;
  } catch {
    return null;
  }
}

/** Stores what an editor considered; pending work is derived from current data. */
export class Editorial {
  constructor(
    private readonly db: Database,
    private readonly records: Records,
  ) {}

  private contextRevision(labId: string): number {
    return (
      this.db
        .query("SELECT context_revision FROM labs WHERE id=?")
        .get(labId) as { context_revision: number }
    ).context_revision;
  }

  private sources(labId: string): Source[] {
    // No UI/history limit: a new source must not disappear behind pagination.
    return this.db
      .query(
        "SELECT id, title, kind, revision, created_at FROM records WHERE lab_id = ? AND kind != 'page' ORDER BY id",
      )
      .all(labId) as Source[];
  }

  private pages(labId: string): ResearchRecord[] {
    return (
      this.db
        .query(
          "SELECT id FROM records WHERE lab_id = ? AND kind = 'page' ORDER BY id",
        )
        .all(labId) as { id: string }[]
    ).map(({ id }) => this.records.get(labId, id));
  }

  begin(lab: Lab, runId: string): void {
    const pages = this.pages(lab.id);
    const context: Context = {
      records: Object.fromEntries(
        this.sources(lab.id).map((record) => [record.id, version(record)]),
      ),
      files: {},
      labContext: this.contextRevision(lab.id),
      pages: Object.fromEntries(
        pages.map((page) => [page.id, `${page.createdAt}/${page.revision}`]),
      ),
    };
    for (const page of pages)
      for (const path of references(page).files)
        context.files[path] = fileVersion(lab, path);
    this.db.run(
      "UPDATE agent_runs SET editorial_context = ? WHERE id = ? AND lab_id = ?",
      [JSON.stringify(context), runId, lab.id],
    );
  }

  private context(labId: string, runId: string): Context {
    if (!isText(runId)) throw badRequest("runId is required");
    const run = this.db
      .query(
        "SELECT editorial_context, status FROM agent_runs WHERE lab_id = ? AND id = ? AND agent_id = 'research-editor'",
      )
      .get(labId, runId) as {
      editorial_context: string | null;
      status: string;
    } | null;
    if (!run?.editorial_context)
      throw badRequest("An editorial run is required to record a review");
    if (run.status !== "running")
      throw conflict("This editorial run has ended; start a new review");
    return JSON.parse(run.editorial_context) as Context;
  }

  /** New artifact references are observed when the worker reads/saves their page. Existing observations stay fixed. */
  observe(lab: Lab, runId: string, page: ResearchRecord): void {
    if (page.kind !== "page") return;
    const context = this.context(lab.id, runId);
    const observed = `${page.createdAt}/${page.revision}`;
    let changed = context.pages?.[page.id] !== observed;
    context.pages ??= {};
    context.pages[page.id] = observed;
    for (const path of references(page).files) {
      if (Object.hasOwn(context.files, path)) continue;
      context.files[path] = fileVersion(lab, path);
      changed = true;
    }
    if (changed)
      this.db.run("UPDATE agent_runs SET editorial_context = ? WHERE id = ?", [
        JSON.stringify(context),
        runId,
      ]);
  }

  review(lab: Lab, runId: string, inputs: ReviewPageInput[]): EditorialStatus {
    const context = this.context(lab.id, runId);
    if (!Array.isArray(inputs) || !inputs.length)
      throw badRequest("pages must be a non-empty list");
    // Each checkpoint is independent. A later failure preserves earlier reviews.
    for (const input of inputs) {
      if (
        !input ||
        !isText(input.id) ||
        !Number.isSafeInteger(input.revision) ||
        !isText(input.summary) ||
        (input.pending !== undefined &&
          (!Array.isArray(input.pending) || !input.pending.every(isText)))
      )
        throw badRequest(
          "Each review needs a page id, its observed revision, a summary and optional pending explanations",
        );
      const page = this.records.get(lab.id, input.id);
      if (page.kind !== "page") throw badRequest(`${page.id} is not a page`);
      if (page.revision !== input.revision)
        throw conflict(
          `Page ${page.id} changed to revision ${page.revision}; read and reconcile it before recording its review`,
        );
      const paths = [...references(page).files];
      const files = Object.fromEntries(
        paths.map((path) => [path, context.files[path] ?? null]),
      );
      const pageRefs = Object.fromEntries(
        [...references(page).ids]
          .filter(
            (id) =>
              id !== page.id && this.records.find(lab.id, id)?.kind === "page",
          )
          .map((id) => [id, context.pages?.[id] ?? null]),
      );
      this.db.run(
        `INSERT INTO page_reviews (page_id, lab_id, run_id, page_revision, files, summary, pending, reviewed_at, page_refs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(page_id) DO UPDATE SET run_id=excluded.run_id, page_revision=excluded.page_revision,
         files=excluded.files, summary=excluded.summary, pending=excluded.pending, reviewed_at=excluded.reviewed_at, page_refs=excluded.page_refs`,
        [
          page.id,
          lab.id,
          runId,
          page.revision,
          JSON.stringify(files),
          input.summary,
          JSON.stringify(input.pending ?? []),
          now(),
          JSON.stringify(pageRefs),
        ],
      );
    }
    return this.status(lab);
  }

  status(lab: Lab): EditorialStatus {
    const sources = this.sources(lab.id);
    const contextRevision = this.contextRevision(lab.id);
    const versions = Object.fromEntries(
      sources.map((record) => [record.id, version(record)]),
    );
    const reviews = new Map(
      (
        this.db
          .query(
            "SELECT review.*, run.editorial_context FROM page_reviews AS review JOIN agent_runs AS run ON run.id = review.run_id WHERE review.lab_id = ?",
          )
          .all(lab.id) as Review[]
      ).map((review) => [review.page_id, review]),
    );
    const known = new Set(
      (
        this.db
          .query("SELECT id FROM records WHERE lab_id = ?")
          .all(lab.id) as { id: string }[]
      ).map(({ id }) => id),
    );
    const fileCache = new Map<string, string | null>();
    const currentFile = (path: string) => {
      if (!fileCache.has(path)) fileCache.set(path, fileVersion(lab, path));
      return fileCache.get(path) ?? null;
    };
    const changed = new Set<string>();
    const documents = this.pages(lab.id);
    const pageVersions = Object.fromEntries(
      documents.map((page) => [page.id, `${page.createdAt}/${page.revision}`]),
    );
    const pages = documents.map((page): PageReviewStatus => {
      const review = reviews.get(page.id);
      const covered = review
        ? (JSON.parse(review.editorial_context) as Context).records
        : {};
      const changedRecords = [
        ...new Set([...Object.keys(versions), ...Object.keys(covered)]),
      ].filter((id) => versions[id] !== covered[id]);
      if (review) {
        const pageRefs = JSON.parse(review.page_refs) as Record<
          string,
          string | null
        >;
        for (const [id, observed] of Object.entries(pageRefs))
          if (pageVersions[id] !== observed) changedRecords.push(id);
      }
      for (const id of changedRecords) changed.add(id);
      const refs = references(page);
      const oldFiles = review
        ? (JSON.parse(review.files) as Context["files"])
        : {};
      const paths = [...refs.files];
      const changedFiles = review
        ? paths.filter((path) => currentFile(path) !== oldFiles[path])
        : [];
      const missingFiles = [...refs.files].filter(
        (path) => currentFile(path) === null,
      );
      const missingRecords = [...refs.ids].filter((id) => !known.has(id));
      // Older reviews predate database context and require one new editorial pass.
      const contextChanged =
        !!review &&
        (JSON.parse(review.editorial_context) as Context).labContext !==
          contextRevision;
      const contentChanged = !!review && review.page_revision !== page.revision;
      const pending = review ? (JSON.parse(review.pending) as string[]) : [];
      const needsReview =
        changedRecords.length +
          changedFiles.length +
          missingFiles.length +
          missingRecords.length +
          pending.length +
          refs.invalidBlocks.length >
          0 ||
        contentChanged ||
        contextChanged;
      return {
        pageId: page.id,
        title: page.title,
        revision: page.revision,
        reviewedAt: review?.reviewed_at ?? null,
        state: !review ? "unreviewed" : needsReview ? "pending" : "reviewed",
        summary: review?.summary ?? "",
        pending,
        changedRecords,
        changedFiles,
        missingFiles,
        missingRecords,
        invalidBlocks: refs.invalidBlocks,
        shape: pageShape(page),
        contentChanged,
        contextChanged,
      };
    });
    if (!pages.length) for (const source of sources) changed.add(source.id);
    const lastRun = this.db
      .query(
        "SELECT id, status, error FROM agent_runs WHERE lab_id = ? AND agent_id = 'research-editor' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(lab.id) as EditorialStatus["lastRun"];
    const active = this.db
      .query(
        "SELECT id FROM agent_runs WHERE lab_id = ? AND agent_id = 'research-editor' AND status = 'running' LIMIT 1",
      )
      .get(lab.id) as { id: string } | null;
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    for (const page of documents)
      sourceMap.set(page.id, {
        id: page.id,
        title: page.title,
        kind: page.kind,
        revision: page.revision,
        created_at: page.createdAt,
      });
    const panoramaMissing = !documents.some(
      (page) => page.fields.placement === "panorama",
    );
    return {
      needsReview:
        pages.some((page) => page.state !== "reviewed") ||
        (panoramaMissing && sources.length + pages.length > 0),
      panoramaMissing,
      pages,
      changes: [...changed].map((id) => {
        const source = sourceMap.get(id);
        return {
          id,
          title: source?.title ?? id,
          kind: source?.kind ?? "removed",
          revision: source?.revision ?? null,
        };
      }),
      activeRunId: active?.id ?? null,
      lastRun,
    };
  }

  promptContext(lab: Lab): string {
    const status = this.status(lab);
    const pending = status.pages.filter((page) => page.state !== "reviewed");
    const shape = status.pages.reduce(
      (sum, page) => sum + page.shape.length,
      0,
    );
    return `Editorial coverage: ${pending.length} pages need review; ${status.changes.length} research records changed or are not yet covered.${shape ? ` ${shape} form warnings to fix (see pages[].shape).` : ""} ${status.panoramaMissing ? "No editorial Panorama yet." : ""} ${status.activeRunId ? `Editor running: ${status.activeRunId}.` : "No editor running."} ${status.lastRun ? `Last editorial run: ${status.lastRun.id} (${status.lastRun.status}).` : ""}`;
  }
}
