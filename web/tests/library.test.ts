import { describe, expect, test } from "bun:test";
import type { FileEntry, Job, ResearchRecord } from "@pico/server/contracts";
import { parseRoute } from "@/web/app/navigation";
import { parseDelimited, previewKind } from "@/web/components/file-preview";
import { bytes, markdownSection } from "@/web/components/format";
import {
  experimentOf,
  jobsOf,
  latestJobsByExperiment,
  resultRegistered,
  resultsOf,
} from "@/web/features/experiments/job-links";
import { paperItems, paperRoute } from "@/web/features/library/library-page";

const entry = (name: string, size = 10): FileEntry => ({
  name,
  kind: "file",
  size,
  modifiedAt: "2026-09-30T00:00:00Z",
});
const record = (
  id: string,
  kind: ResearchRecord["kind"],
  fields: Record<string, unknown> = {},
  links: ResearchRecord["links"] = [],
): ResearchRecord => ({
  id,
  labId: "lab",
  kind,
  title: id,
  status: null,
  body: "",
  fields,
  links,
  author: "pico",
  revision: 1,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
});

describe("library", () => {
  test("papers group the files of one source and match records by file name", () => {
    const { items, unmatched } = paperItems(
      [
        entry("wu-2021.pdf"),
        entry("wu-2021.txt"),
        entry("echo.md"),
        entry("x.parquet"),
      ],
      [
        record("p-1", "paper", { file: "papers/wu-2021.pdf" }),
        record("p-2", "paper"),
      ],
    );
    expect(items.map((item) => item.key)).toEqual(["wu-2021", "echo"]);
    expect(items[0]?.files.map((file) => file.extension)).toEqual([
      "pdf",
      "txt",
    ]);
    expect(items[0]?.record?.id).toBe("p-1");
    expect(unmatched.map((item) => item.id)).toEqual(["p-2"]);
  });
  test("paper files open inside the collection's sources tab", () => {
    expect(parseRoute(paperRoute("lab", "papers/wu-2021.pdf"))).toEqual({
      labId: "lab",
      page: "collection",
      path: "papers/wu-2021.pdf",
      tab: "sources",
    });
  });
  test("previews pick a renderer by extension and content", () => {
    expect(previewKind("a.pdf", true)).toBe("pdf");
    expect(previewKind("a.png", true)).toBe("image");
    expect(previewKind("a.csv", false)).toBe("csv");
    expect(previewKind("a.md", false)).toBe("markdown");
    expect(previewKind("a.py", false)).toBe("code");
    expect(previewKind("a.parquet", true)).toBe("binary");
    expect(parseDelimited('a,b\n1,"x, y"\n2,z\n', 1)).toEqual({
      header: ["a", "b"],
      rows: [["1", "x, y"]],
      total: 2,
    });
  });
});

describe("experiments and overview helpers", () => {
  const job = (
    id: string,
    experimentId: string | null,
    metricsPath: string,
    status: Job["status"] = "succeeded",
  ): Job => ({
    campaignId: null,
    id,
    labId: "lab",
    name: id,
    command: "",
    cwd: "/labs/x",
    status,
    pid: null,
    commitHash: null,
    logPath: "",
    metricsPath,
    metrics: null,
    exitCode: 0,
    error: null,
    experimentId,
    notified: true,
    createdAt: "",
    startedAt: null,
    endedAt: null,
  });
  test("jobs belong to an experiment by id or by folder", () => {
    const experiment = record("e-1", "experiment", {
      path: "experiments/01-base",
    });
    const jobs = [
      job("job-a", "e-1", "/labs/x/metrics.json"),
      job("job-b", "e-typo", "/labs/x/experiments/01-base/runs/1/metrics.json"),
      job("job-c", null, "/labs/x/experiments/02-other/metrics.json"),
    ];
    expect(jobsOf(experiment, jobs).map((item) => item.id)).toEqual([
      "job-a",
      "job-b",
    ]);
  });
  test("a relaunched job that failed still points to the result its experiment recorded", () => {
    const experiment = record(
      "e-1",
      "experiment",
      { path: "experiments/01-base" },
      [{ kind: "result", id: "r-linked-back" }],
    );
    const result = record("r-1", "result", {}, [
      { kind: "experiment", id: "e-1" },
    ]);
    const linkedBack = record("r-linked-back", "result");
    const unrelated = record("r-2", "result", {}, [
      { kind: "experiment", id: "e-other" },
    ]);
    const records = [experiment, result, linkedBack, unrelated];
    expect(resultsOf(experiment, records).map((item) => item.id)).toEqual([
      "r-1",
      "r-linked-back",
    ]);
    const failed = job(
      "job-f",
      "e-1",
      "/labs/x/experiments/01-base/runs/2/metrics.json",
      "failed",
    );
    expect(experimentOf(failed, records)?.id).toBe("e-1");
    expect(
      experimentOf({ ...failed, experimentId: "e-06recebedor" }, records)?.id,
    ).toBe("e-1");
    expect(
      experimentOf(
        {
          ...failed,
          experimentId: "e-06recebedor",
          metricsPath: "/labs/x/metrics.json",
        },
        records,
      ),
    ).toBeUndefined();
    expect(resultRegistered(failed, experiment, records)).toBe(true);
    expect(
      resultRegistered({ ...failed, status: "stopped" }, experiment, records),
    ).toBe(true);
    expect(
      resultRegistered({ ...failed, status: "succeeded" }, experiment, records),
    ).toBe(false);
    expect(resultRegistered(failed, experiment, [unrelated])).toBe(false);
    expect(resultRegistered(failed, undefined, records)).toBe(false);
  });
  test("the activity list keeps one job per experiment and moves superseded failures last", () => {
    const done = record("e-1", "experiment", { path: "experiments/01-base" });
    const open = record("e-2", "experiment", { path: "experiments/02-open" });
    const result = record("r-1", "result", {}, [
      { kind: "experiment", id: "e-1" },
    ]);
    const records = [done, open, result];
    const at = (hour: number) =>
      `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`;
    const older = {
      ...job(
        "job-old",
        "e-1",
        "/labs/x/experiments/01-base/runs/1/metrics.json",
        "failed",
      ),
      endedAt: at(1),
    };
    const newer = {
      ...job(
        "job-new",
        "e-1",
        "/labs/x/experiments/01-base/runs/2/metrics.json",
        "failed",
      ),
      endedAt: at(5),
    };
    const unresolved = {
      ...job(
        "job-open",
        "e-2",
        "/labs/x/experiments/02-open/runs/1/metrics.json",
        "failed",
      ),
      endedAt: at(9),
    };
    const running = job(
      "job-run",
      "e-2",
      "/labs/x/experiments/02-open/runs/2/metrics.json",
      "running",
    );
    const loose = {
      ...job("job-loose", null, "/labs/x/metrics.json", "succeeded"),
      endedAt: at(3),
    };
    const entries = latestJobsByExperiment(
      [older, newer, unresolved, running, loose],
      records,
    );
    expect(entries.map((item) => item.job.id)).toEqual([
      "job-run",
      "job-loose",
      "job-new",
    ]);
    expect(entries.map((item) => item.superseded)).toEqual([
      false,
      false,
      true,
    ]);
    expect(entries[2]?.experiment?.id).toBe("e-1");
    expect(
      latestJobsByExperiment([older, newer, unresolved], records).map(
        (item) => item.job.id,
      ),
    ).toEqual(["job-open", "job-new"]);
  });
  test("markdown sections and byte sizes read cleanly", () => {
    const pico =
      "# Lab\n\n## Linha de pesquisa\n\nFutebol.\n\n## Direção atual\n\n- passo 1\n- passo 2\n\n## Decisões\n\n- x";
    expect(markdownSection(pico, ["direção"])).toBe("- passo 1\n- passo 2");
    expect(markdownSection(pico, ["nada"])).toBeNull();
    expect(bytes(3_200_000)).toMatch(/^3,1 MB|^3\.1 MB/);
  });
});
