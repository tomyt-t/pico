import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreLaboratory } from "@pico/lab/administration";
import type { Lab, LabOverview, Run } from "@pico/lab/contracts";
import { createServerApplication as createApplication } from "@pico/server";

const roots: string[] = [];
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function create() {
  const root = await mkdtemp(join(tmpdir(), "pico-cycle-"));
  roots.push(root);
  const app = await createApplication({ dataDir: join(root, "data") });
  apps.push(app);
  return { app, root };
}
async function api<T>(
  app: Awaited<ReturnType<typeof createApplication>>,
  path: string,
  body?: unknown,
  key = crypto.randomUUID(),
  method = "POST",
): Promise<T> {
  const response = await app.fetch(
    new Request(
      `http://127.0.0.1:4317/api${path}`,
      body === undefined
        ? undefined
        : {
            method,
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify(body),
          },
    ),
  );
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value as T;
}
async function until(predicate: () => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Scenario did not finish before its deadline");
    await Bun.sleep(30);
  }
}

test("one conversation completes a real local scientific cycle, deduplicates delivery, and survives backup/restore", async () => {
  const { app, root } = await create();
  const lab = await api<Lab>(app, "/labs", {
    name: "Research baseline",
    researchLine: "Multimodal defenses; infrastructure rehearsal first",
    settings: { executionEnabled: true },
  });
  const intent = crypto.randomUUID();
  await api(
    app,
    `/labs/${lab.id}/chat`,
    { message: "Start a demonstration of the complete research cycle" },
    intent,
  );
  await api(
    app,
    `/labs/${lab.id}/chat`,
    { message: "Start a demonstration of the complete research cycle" },
    intent,
  );
  await until(
    () =>
      app.runtime.research.overview(lab.id).conclusions.length === 1 &&
      app.runtime.research
        .conversationView(lab.id)
        .turns.every((turn) => turn.status === "completed"),
  );
  const overview = await api<LabOverview>(app, `/labs/${lab.id}/overview`);
  expect(overview.questions).toHaveLength(1);
  expect(overview.experiments).toHaveLength(1);
  expect(overview.runs).toHaveLength(1);
  expect(
    overview.runs[0]?.metrics.find((metric) => metric.name === "mean")?.value,
  ).toBe(2.5);
  expect(overview.results[0]?.runIds[0]).toBe(overview.runs[0]?.id);
  expect(overview.conclusions[0]?.resultIds[0]).toBe(overview.results[0]?.id);
  expect(overview.hypotheses[0]?.status).toBe("supported");
  expect(overview.conversation.id).toBe(
    app.runtime.research.conversationView(lab.id).conversation.id,
  );
  const event = overview.events.find((item) => item.kind === "run_completed");
  if (!event) throw new Error("Missing completion event");
  // Forced event redelivery is exercised inside the lab package; this scenario uses public APIs.
  await Bun.sleep(350);
  expect(
    app.runtime.research
      .conversationView(lab.id)
      .turns.filter((turn) => turn.eventId === event.id),
  ).toHaveLength(1);
  expect(app.runtime.research.overview(lab.id).results).toHaveLength(1);
  const run = overview.runs[0];
  if (!run?.snapshot) throw new Error("Missing preserved run snapshot");
  const code = await app.runtime.research.readRunFile(
    lab.id,
    run.id,
    "code",
    "experiment.py",
  );
  expect(code.toString()).toContain("PICO_INPUTS_DIR");
  expect(run.snapshot.datasetInputs[0]?.files[0]?.sha256).toHaveLength(64);
  const snapshot = JSON.stringify(run.snapshot);
  const experiment = overview.experiments[0];
  if (!experiment) throw new Error("Missing experiment");
  await api(
    app,
    `/labs/${lab.id}/experiments/${experiment.id}/file`,
    {
      path: "experiment.py",
      content:
        "raise Exception('Changed workspace must not affect reproduction')\n",
    },
    crypto.randomUUID(),
    "PUT",
  );
  const replayKey = crypto.randomUUID();
  const replay = await api<Run>(
    app,
    `/labs/${lab.id}/experiments/${experiment.id}/runs`,
    { referenceRunId: run.id },
    replayKey,
  );
  const repeated = await api<Run>(
    app,
    `/labs/${lab.id}/experiments/${experiment.id}/runs`,
    { referenceRunId: run.id },
    replayKey,
  );
  expect(repeated.id).toBe(replay.id);
  await until(
    () =>
      app.runtime.research.overview(lab.id).conclusions.length === 2 &&
      app.runtime.research
        .conversationView(lab.id)
        .turns.every((turn) => turn.status === "completed"),
  );
  expect(app.runtime.research.overview(lab.id).runs).toHaveLength(2);
  expect(
    app.runtime.research
      .overview(lab.id)
      .runs[1]?.metrics.find((metric) => metric.name === "mean")?.value,
  ).toBe(2.5);
  expect(
    JSON.stringify(
      app.runtime.research.getRecord<Run>(lab.id, "run", run.id).snapshot,
    ),
  ).toBe(snapshot);
  const before = app.runtime.research.overview(lab.id);
  const { path: backup } = await app.runtime.administration.backup(
    join(root, "backup"),
    { key: "cycle-backup", actor: { kind: "researcher" } },
  );
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  restoreLaboratory(backup, join(root, "restored"));
  const reopened = await createApplication({ dataDir: join(root, "restored") });
  apps.push(reopened);
  expect(reopened.runtime.research.overview(lab.id)).toEqual(before);
  expect(
    await reopened.runtime.research.readRunFile(
      lab.id,
      run.id,
      "code",
      "experiment.py",
    ),
  ).toEqual(code);
}, 30_000);

test("API exposes visible errors, rejects foreign writes, and scopes records to a laboratory", async () => {
  const { app } = await create();
  const first = await api<Lab>(app, "/labs", { name: "One" });
  const second = await api<Lab>(app, "/labs", { name: "Two" });
  const question = await api<{ id: string }>(
    app,
    `/labs/${first.id}/questions`,
    { text: "Test?" },
  );
  const foreign = await app.fetch(
    new Request(
      `http://127.0.0.1:4317/api/labs/${second.id}/questions/${question.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ text: "Wrong lab" }),
      },
    ),
  );
  expect(foreign.status).toBe(404);
  const response = await app.fetch(
    new Request("http://127.0.0.1:4317/api/labs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://unrelated.example",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ name: "Foreign write" }),
    }),
  );
  expect(response.status).toBe(403);
  expect(app.runtime.research.listLabs()).toHaveLength(2);
  expect((await response.json()).error.message).toContain("Cross-origin");
});
