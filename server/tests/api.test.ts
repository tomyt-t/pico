import { afterEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordHistoryEntry } from "../src/contracts";
import type { Job } from "../src/jobs";
import type { Lab } from "../src/labs";
import type { ResearchRecord } from "../src/records";
import { createPicoTools } from "../src/tools";
import {
  call,
  request,
  runTool,
  type Sandbox,
  sandbox,
  until,
} from "./support";

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
});

test("HTTP and read_records expose the same isolated history without opening a session", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Histórico" });
  const other = await app.labs.create({ name: "Outro histórico" });
  const initial = app.records.save(
    lab.id,
    {
      kind: "note",
      title: "Coleta humana pendente",
      body: "Aguardamos a coleta.",
    },
    "researcher",
  );
  const revised = app.records.save(
    lab.id,
    {
      id: initial.id,
      kind: "note",
      body: "A coleta chegou, mas faltam dois participantes.",
      reason: "Recebemos a primeira entrega.",
    },
    "pico",
  );
  app.records.save(lab.id, { kind: "result", title: "Dados parciais" }, "pico");
  const foreign = app.records.save(
    other.id,
    { kind: "note", title: "Conteúdo de outro laboratório" },
    "pico",
  );
  const history = await call<RecordHistoryEntry[]>(
    app,
    `/labs/${lab.id}/history`,
  );
  expect(history).toEqual(app.records.history(lab.id));
  expect(history.some((entry) => entry.recordId === foreign.id)).toBe(false);
  const filtered = await call<RecordHistoryEntry[]>(
    app,
    `/labs/${lab.id}/history?kind=note&limit=1`,
  );
  expect(filtered).toEqual([
    {
      type: "revised",
      recordId: initial.id,
      at: revised.updatedAt,
      author: "pico",
      reason: "Recebemos a primeira entrega.",
      before: initial,
      after: revised,
    },
  ]);
  expect(
    await call<RecordHistoryEntry[]>(
      app,
      `/labs/${lab.id}/history?limit=invalid`,
    ),
  ).toEqual(history);
  expect(await call(app, `/labs/${lab.id}/history?limit=0`)).toHaveLength(1);
  expect((await app.fetch(request("/labs/missing/history"))).status).toBe(404);

  const read = createPicoTools({
    lab,
    records: app.records,
    jobs: app.jobs,
  }).find((tool) => tool.name === "read_records");
  if (!read) throw new Error("read_records is missing");
  expect(
    await runTool(read, {
      history: true,
      kind: "note",
      limit: 1,
      id: foreign.id,
      status: "absent",
    }),
  ).toEqual(filtered);
  expect(await runTool(read, { id: initial.id })).toEqual(revised);

  app.records.remove(lab.id, initial.id);
  expect(
    await call<RecordHistoryEntry[]>(app, `/labs/${lab.id}/history?kind=note`),
  ).toEqual([]);
  expect(await call(app, `/labs/${other.id}/history`)).toHaveLength(1);
  expect(existsSync(join(app.paths.claudeConfigDir, "projects"))).toBe(false);
});

test("the HTTP API manages labs, records, files, database context and jobs", async () => {
  box = sandbox();
  const { app } = box;
  const health = await call<{ ok: boolean }>(app, "/health");
  expect(health.ok).toBe(true);

  const lab = await call<Lab>(app, "/labs", {
    body: {
      name: "Defesa Multimodal",
      researchLine: "Defesas em LLMs multimodais",
    },
  });
  expect(lab.id).toBe("defesa-multimodal");
  expect((await call<Lab[]>(app, "/labs")).map((item) => item.id)).toEqual([
    lab.id,
  ]);
  const duplicate = await app.fetch(
    request("/labs", { body: { name: "Defesa multimodal" } }),
  );
  expect(duplicate.status).toBe(400);

  const updated = await call<Lab>(app, `/labs/${lab.id}`, {
    method: "PATCH",
    body: { researchLine: "Nova linha", thinking: "high" },
  });
  expect(updated).toMatchObject({
    researchLine: "Nova linha",
    thinking: "high",
  });

  const question = await call<ResearchRecord>(app, `/labs/${lab.id}/records`, {
    body: { kind: "question", title: "A defesa reduz ASR?" },
  });
  expect(question.author).toBe("researcher");
  const patched = await call<ResearchRecord>(
    app,
    `/labs/${lab.id}/records/${question.id}`,
    {
      method: "PATCH",
      body: { status: "open", body: "Detalhes" },
    },
  );
  expect(patched.revision).toBe(2);
  const detail = await call<{ record: ResearchRecord; revisions: unknown[] }>(
    app,
    `/labs/${lab.id}/records/${question.id}`,
  );
  expect(detail.revisions).toHaveLength(1);
  expect(
    await call<ResearchRecord[]>(app, `/labs/${lab.id}/records?kind=question`),
  ).toHaveLength(1);

  const pico = await call<{ content: string }>(app, `/labs/${lab.id}/pico`);
  expect(pico.content).toContain("Defesa Multimodal");
  await call(app, `/labs/${lab.id}/pico`, {
    method: "PUT",
    body: { content: "# Novo\n" },
  });
  expect(app.labs.context(lab.id).content).toBe("# Novo\n");
  expect(existsSync(join(lab.path, "PICO.md"))).toBe(false);

  writeFileSync(join(lab.path, "experiments", "notes.txt"), "hello");
  const root = await call<{
    kind: string;
    entries: { name: string; kind: string }[];
  }>(app, `/labs/${lab.id}/files`);
  expect(root.kind).toBe("directory");
  expect(root.entries.map((entry) => entry.name)).toContain("experiments");
  expect(root.entries.map((entry) => entry.name)).not.toContain(".git");
  const file = await call<{ kind: string; content: string }>(
    app,
    `/labs/${lab.id}/files?path=experiments/notes.txt`,
  );
  expect(file).toMatchObject({ kind: "file", content: "hello" });
  const outside = await app.fetch(
    request(`/labs/${lab.id}/files?path=../../etc`),
  );
  expect(outside.status).toBe(400);

  const job = await app.jobs.start(lab, {
    command: "echo api",
    name: "api job",
  });
  await until(
    () => app.jobs.get(lab.id, job.id).status === "succeeded",
    10_000,
    "job",
  );
  const jobs = await call<Job[]>(app, `/labs/${lab.id}/jobs`);
  expect(jobs[0]?.id).toBe(job.id);
  const one = await call<{ job: Job; log: string }>(
    app,
    `/labs/${lab.id}/jobs/${job.id}`,
  );
  expect(one.log.trim()).toBe("api");
  const stopped = await app.fetch(
    request(`/labs/${lab.id}/jobs/${job.id}/stop`, { method: "POST" }),
  );
  expect(stopped.status).toBe(409);

  const missing = await app.fetch(request("/labs/nope"));
  expect(missing.status).toBe(404);
  const foreign = await app.fetch(
    new Request("http://127.0.0.1:4317/api/labs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ name: "Evil" }),
    }),
  );
  expect(foreign.status).toBe(403);
});
