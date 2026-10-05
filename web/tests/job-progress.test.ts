import { expect, test } from "bun:test";
import { parseJobProgress } from "@/web/features/experiments/job-progress";

const started = { startedAt: "2026-10-04T10:00:00.000Z", createdAt: "" };
const at = (iso: string) => Date.parse(iso);

test("progress lines measure the rate within their phase", () => {
  const t0 = at("2026-10-04T10:10:00.000Z") / 1000;
  const log = [
    "loading model",
    JSON.stringify({
      pico: "progress",
      phase: "setup",
      done: 1,
      total: 1,
      t: t0 - 60,
    }),
    JSON.stringify({
      pico: "progress",
      phase: "gen",
      done: 0,
      total: 20,
      unit: "items",
      t: t0,
    }),
    "a warning nobody needs",
    JSON.stringify({
      pico: "progress",
      phase: "gen",
      done: 10,
      total: 20,
      unit: "items",
      t: t0 + 600,
    }),
  ].join("\n");
  const progress = parseJobProgress(log, started, (t0 + 600) * 1000);
  expect(progress).toMatchObject({
    done: 10,
    total: 20,
    phase: "gen",
    unit: "items",
    rough: false,
  });
  // 10 items in 10 minutes: 10 more take 10 minutes.
  expect(progress?.remainingMs).toBe(600_000);
});

test("without progress lines, counters and tqdm bars are read from the end", () => {
  const counter = parseJobProgress(
    "Loading checkpoint shards: 100%|##| 2/2 [00:11<00:00,  5.85s/it]\n[1/25] idx=469\n\n[13/25] idx=369",
    started,
    at("2026-10-04T11:00:00.000Z"),
  );
  // Item 13 just started: 12 done in an hour leaves 13 for about 65 minutes.
  expect(counter).toMatchObject({ done: 12, total: 25, rough: true });
  expect(counter?.remainingMs).toBe(65 * 60_000);
  const tqdm = parseJobProgress(
    "epoch 1:  10%|#| 30/300 [01:00<09:00,  2.0s/it]\repoch 1:  20%|##| 60/300 [02:00<08:00,  2.0s/it]",
    started,
  );
  expect(tqdm).toMatchObject({ done: 60, total: 300, remainingMs: 480_000 });
  expect(parseJobProgress("no progress here", started)).toBeNull();
});
