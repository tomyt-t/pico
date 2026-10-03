import { describe, expect, test } from "bun:test";
import type { Job, ResearchRecord } from "@pico/server/contracts";
import {
  getInvestigations,
  questionMaterials,
  relevantJobs,
} from "@/web/features/investigations/investigation-links";

const record = (
  id: string,
  kind: ResearchRecord["kind"],
  extra: Partial<ResearchRecord> = {},
): ResearchRecord => ({
  id,
  labId: "lab",
  kind,
  title: id,
  body: "",
  status: null,
  fields: {},
  links: [],
  author: "pico",
  revision: 1,
  createdAt: "2026-09-30T12:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
  ...extra,
});
const job = (id: string, extra: Partial<Job> = {}): Job => ({
  campaignId: null,
  id,
  labId: "lab",
  name: id,
  command: "true",
  cwd: "/labs/lab",
  status: "succeeded",
  pid: null,
  commitHash: null,
  logPath: "",
  metricsPath: "",
  metrics: null,
  exitCode: 0,
  error: null,
  experimentId: null,
  notified: true,
  createdAt: "2026-09-30T12:00:00Z",
  startedAt: "2026-09-30T12:00:00Z",
  endedAt: "2026-09-30T12:01:00Z",
  ...extra,
});
const ids = (items: { id: string }[]) => items.map((item) => item.id).sort();

describe("investigations from existing records", () => {
  test("follows explicit links in both directions through a full research path", () => {
    const question = record("q", "question", {
      status: "open",
      links: [{ kind: "hypothesis", id: "h" }],
    });
    const hypothesis = record("h", "hypothesis", { status: "refuted" });
    const experiment = record("e", "experiment", {
      links: [{ kind: "hypothesis", id: "h" }],
    });
    const result = record("r", "result", {
      links: [{ kind: "experiment", id: "e" }],
    });
    const conclusion = record("c", "conclusion", {
      status: "tentative",
      links: [{ kind: "result", id: "r" }],
    });
    const note = record("n", "note", {
      links: [{ kind: "conclusion", id: "c" }],
    });
    const all = [conclusion, result, question, note, experiment, hypothesis];
    const runs = [
      job("first", { experimentId: "e" }),
      job("second", { experimentId: "e", status: "failed", exitCode: 1 }),
    ];
    const { investigations, unlinkedRecords } = getInvestigations(all, runs);
    const investigation = investigations[0];
    expect(investigation).toBeDefined();
    expect(ids(investigation?.records ?? [])).toEqual([
      "c",
      "e",
      "h",
      "n",
      "r",
    ]);
    expect(ids(investigation?.jobs ?? [])).toEqual(["first", "second"]);
    expect(investigation?.question).toBe(question);
    expect(investigation?.question.status).toBe("open");
    expect(investigation?.records.find((item) => item.id === "h")?.status).toBe(
      "refuted",
    );
    expect(investigation?.records.find((item) => item.id === "c")?.status).toBe(
      "tentative",
    );
    expect(unlinkedRecords).toEqual([]);
  });

  test("keeps unanswered questions and all disconnected material accessible", () => {
    const question = record("q", "question", { status: "open" });
    const orphan = record("orphan", "result");
    const { investigations, unlinkedRecords } = getInvestigations(
      [question, orphan],
      [],
    );
    expect(investigations[0]?.records).toEqual([]);
    expect(investigations[0]?.jobs).toEqual([]);
    expect(investigations[0]?.question.status).toBe("open");
    expect(unlinkedRecords).toEqual([orphan]);
    expect(getInvestigations([orphan], []).unlinkedRecords).toEqual([orphan]);
    expect(getInvestigations([], [])).toEqual({
      investigations: [],
      unlinkedRecords: [],
    });
  });

  test("shared sources and other questions are endpoints instead of bridges", () => {
    const question = record("q", "question", {
      links: [
        { kind: "paper", id: "p" },
        { kind: "question", id: "other-q" },
        { kind: "dataset", id: "d" },
      ],
    });
    const other = record("other-q", "question", {
      links: [{ kind: "job", id: "other-job" }],
    });
    const paper = record("p", "paper");
    const dataset = record("d", "dataset");
    const behindPaper = record("unrelated-p", "hypothesis", {
      links: [{ kind: "paper", id: "p" }],
    });
    const behindDataset = record("unrelated-d", "experiment", {
      links: [{ kind: "dataset", id: "d" }],
    });
    const behindQuestion = record("unrelated-q", "note", {
      links: [{ kind: "question", id: "other-q" }],
    });
    const materials = questionMaterials(
      question,
      [
        question,
        other,
        paper,
        dataset,
        behindPaper,
        behindDataset,
        behindQuestion,
      ],
      [job("other-job")],
    );
    expect(ids(materials.records)).toEqual(["d", "other-q", "p"]);
    expect(materials.jobs).toEqual([]);
  });

  test("cycles and absent targets do not drop connected records or duplicate missing references", () => {
    const question = record("q", "question", {
      links: [
        { kind: "note", id: "n" },
        { kind: "result", id: "missing" },
      ],
    });
    const note = record("n", "note", {
      links: [
        { kind: "question", id: "q" },
        { kind: "note", id: "n" },
        { kind: "result", id: "missing" },
      ],
    });
    const materials = questionMaterials(question, [question, note], []);
    expect(ids(materials.records)).toEqual(["n"]);
    expect(materials.missingLinks).toEqual([{ kind: "result", id: "missing" }]);
  });

  test("jobs attach to experiments by the existing folder rule and never create scientific links", () => {
    const question = record("q", "question");
    const experiment = record("e", "experiment", {
      fields: { path: "experiments/a/" },
      links: [{ kind: "question", id: "q" }],
    });
    const orphanResult = record("orphan-r", "result", {
      links: [{ kind: "job", id: "folder-job" }],
    });
    const folderJob = job("folder-job", { cwd: "/labs/lab/experiments/a" });
    const unrelated = job("unrelated", { cwd: "/labs/lab/experiments/ab" });
    const { investigations, unlinkedRecords } = getInvestigations(
      [question, experiment, orphanResult],
      [folderJob, unrelated],
    );
    expect(ids(investigations[0]?.records ?? [])).toEqual(["e"]);
    expect(ids(investigations[0]?.jobs ?? [])).toEqual(["folder-job"]);
    expect(unlinkedRecords).toEqual([orphanResult]);
  });

  test("direct job references remain visible without implying a linked experiment", () => {
    const question = record("q", "question", {
      links: [{ kind: "job", id: "run" }],
    });
    const materials = questionMaterials(question, [question], [job("run")]);
    expect(materials.records).toEqual([]);
    expect(ids(materials.jobs)).toEqual(["run"]);
    expect(materials.missingLinks).toEqual([]);
  });

  test("mixed inputs cannot attach another lab's records or jobs", () => {
    const question = record("q", "question", {
      links: [{ kind: "note", id: "foreign-note" }],
    });
    const experiment = record("e", "experiment", {
      links: [{ kind: "question", id: "q" }],
    });
    const foreign = record("foreign-note", "note", {
      labId: "other",
      links: [{ kind: "question", id: "q" }],
    });
    const foreignQuestion = record("foreign-q", "question", { labId: "other" });
    const foreignJob = job("foreign-job", {
      labId: "other",
      experimentId: "e",
    });
    const all = [question, experiment, foreign, foreignQuestion];
    const result = getInvestigations(all, [foreignJob]);
    expect(ids(result.investigations[0]?.records ?? [])).toEqual(["e"]);
    expect(result.investigations[0]?.jobs).toEqual([]);
    expect(result.investigations[0]?.missingLinks).toEqual([
      { kind: "note", id: "foreign-note" },
    ]);
    expect(result.investigations[1]?.records).toEqual([]);
    expect(result.unlinkedRecords).toEqual([foreign]);
  });

  test("a question loaded independently still resolves incoming links", () => {
    const question = record("q", "question");
    const note = record("n", "note", {
      links: [{ kind: "question", id: "q" }],
    });
    expect(ids(questionMaterials(question, [note], []).records)).toEqual(["n"]);
  });

  test("cards keep running executions first, then the most recently ended", () => {
    const jobs = [
      job("old", { status: "failed", endedAt: "2026-09-29T12:00:00Z" }),
      job("live", {
        status: "running",
        endedAt: null,
        createdAt: "2026-09-28T00:00:00Z",
      }),
      job("recent", { endedAt: "2026-09-30T13:00:00Z" }),
      job("mid", { status: "failed", endedAt: "2026-09-30T12:30:00Z" }),
      job("unfinished", { status: "stopped", endedAt: null }),
    ];
    expect(relevantJobs(jobs, 3).map((item) => item.id)).toEqual([
      "live",
      "recent",
      "mid",
    ]);
    expect(relevantJobs(jobs, 10).map((item) => item.id)).toEqual([
      "live",
      "recent",
      "mid",
      "unfinished",
      "old",
    ]);
    expect(relevantJobs([], 3)).toEqual([]);
    expect(jobs.map((item) => item.id)).toEqual([
      "old",
      "live",
      "recent",
      "mid",
      "unfinished",
    ]);
  });
});
