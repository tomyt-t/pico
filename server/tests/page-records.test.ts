import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  PageFields,
  RecordDetailView,
  ResearchRecord,
} from "../src/contracts";
import { createPicoTools } from "../src/tools";
import { call, request, type Sandbox, sandbox } from "./support";

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
});

async function execute(tool: ToolDefinition, params: Record<string, unknown>) {
  const result = await tool.execute(
    "page-test",
    params,
    undefined,
    undefined,
    {} as Parameters<typeof tool.execute>[4],
  );
  const content = result.content.find((part) => part.type === "text");
  if (content?.type !== "text") throw new Error("Missing tool text");
  return JSON.parse(content.text);
}

test("pages use existing record revisions and replace whole block lists", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Pesquisa com páginas" });
  const question = app.records.save(
    lab.id,
    { kind: "question", title: "O que explica a diferença?" },
    "researcher",
  );
  const fields: PageFields = {
    placement: "panorama",
    blocks: [
      { type: "markdown", text: "A interpretação ainda é provisória." },
      { type: "records", ids: [question.id] },
      {
        type: "artifact",
        path: "figures/comparison.svg",
        caption: "Comparação observada",
      },
    ],
  };
  const initial = app.records.save(
    lab.id,
    {
      kind: "page",
      title: "O que sabemos até aqui",
      body: "Síntese e limites atuais.",
      fields,
      links: [{ kind: "question", id: question.id }],
    },
    "pico",
  );
  expect(initial.id).toMatch(/^page-[0-9a-f]{8}$/);
  expect(app.records.get(lab.id, initial.id)).toEqual(initial);

  const blocks: PageFields["blocks"] = [
    { type: "markdown", text: "O controle mudou nossa interpretação." },
  ];
  const revised = app.records.save(
    lab.id,
    {
      id: initial.id,
      kind: "page",
      fields: { blocks, editorial: { audience: "team" } },
      reason: "Incorporado o grupo de controle.",
    },
    "researcher",
  );
  expect(revised.fields).toEqual({
    placement: "panorama",
    blocks,
    editorial: { audience: "team" },
  });
  expect(revised.body).toBe(initial.body);
  expect(revised.links).toEqual(initial.links);
  expect(app.records.revisions(lab.id, initial.id)).toEqual([
    {
      revision: 1,
      snapshot: initial,
      author: "researcher",
      reason: "Incorporado o grupo de controle.",
      createdAt: revised.updatedAt,
    },
  ]);
  const cleared = app.records.save(
    lab.id,
    { id: initial.id, kind: "page", fields: { blocks: [] } },
    "pico",
  );
  expect(cleared.fields).toEqual({ ...revised.fields, blocks: [] });
  expect(app.records.history(lab.id, { kind: "page" })[0]).toMatchObject({
    type: "revised",
    before: revised,
    after: cleared,
  });
  expect(app.records.get(lab.id, question.id)).toEqual(question);
  expect(app.records.list(lab.id, { kind: "question" })).toEqual([question]);
  expect(app.records.list(lab.id, { kind: "page" })).toEqual([cleared]);
});

test("tools and HTTP share pages, free fields and laboratory isolation", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Páginas pelo Pico" });
  const other = await app.labs.create({ name: "Outra pesquisa" });
  const tools = createPicoTools({ lab, records: app.records, jobs: app.jobs });
  const save = tools.find((tool) => tool.name === "save_record");
  const read = tools.find((tool) => tool.name === "read_records");
  if (!save || !read) throw new Error("Record tools are missing");

  const fields = {
    placement: "panorama",
    blocks: [
      { type: "markdown", text: "Uma síntese com fontes." },
      { type: "records", ids: ["p-not-yet-created"] },
      { type: "artifact", path: "analysis/chart.svg" },
      { type: "future-block", custom: { uncertainty: "high" } },
      { type: "artifact" },
    ],
    audience: "researcher",
  };
  const saved = await execute(save, {
    kind: "page",
    title: "Panorama inicial",
    body: "Entendimento provisório.",
    fields,
  });
  expect(saved).toMatchObject({ kind: "page", revision: 1 });
  const detail = await call<RecordDetailView>(
    app,
    `/labs/${lab.id}/records/${saved.saved}`,
  );
  expect(detail.record.fields).toEqual(fields);
  expect(detail.record.author).toBe("pico");
  expect(detail.revisions).toEqual([]);
  expect(await execute(read, { id: saved.saved })).toEqual(detail.record);

  const revised = await call<ResearchRecord>(
    app,
    `/labs/${lab.id}/records/${saved.saved}`,
    {
      method: "PATCH",
      body: {
        fields: { blocks: [{ type: "markdown", text: "Leitura atual." }] },
        reason: "Novas evidências",
      },
    },
  );
  expect(await execute(read, { id: saved.saved })).toEqual(revised);
  expect(revised.fields).toEqual({
    ...fields,
    blocks: [{ type: "markdown", text: "Leitura atual." }],
  });
  const updated = await call<RecordDetailView>(
    app,
    `/labs/${lab.id}/records/${saved.saved}`,
  );
  expect(updated.revisions[0]).toMatchObject({
    snapshot: detail.record,
    author: "researcher",
    reason: "Novas evidências",
  });

  const bare = await call<ResearchRecord>(app, `/labs/${lab.id}/records`, {
    body: { kind: "page", title: "Página em preparação" },
  });
  expect(await execute(read, { id: bare.id })).toEqual(bare);
  expect(bare.fields).toEqual({});
  const foreign = await call<ResearchRecord>(app, `/labs/${other.id}/records`, {
    body: {
      kind: "page",
      title: "Panorama do outro lab",
      fields: { placement: "elsewhere", blocks: "incomplete", custom: 42 },
    },
  });
  expect(foreign.fields).toEqual({
    placement: "elsewhere",
    blocks: "incomplete",
    custom: 42,
  });
  const listed = (await execute(read, { kind: "page" })) as { id: string }[];
  expect(new Set(listed.map((record) => record.id))).toEqual(
    new Set([saved.saved, bare.id]),
  );
  const listedApi = await call<ResearchRecord[]>(
    app,
    `/labs/${lab.id}/records?kind=page`,
  );
  expect(new Set(listedApi.map((record) => record.id))).toEqual(
    new Set([saved.saved, bare.id]),
  );
  expect(
    (await app.fetch(request(`/labs/${lab.id}/records/${foreign.id}`))).status,
  ).toBe(404);
  await expect(execute(read, { id: foreign.id })).rejects.toThrow("not found");
  await expect(
    execute(save, { kind: "page", id: foreign.id, title: "Overwrite" }),
  ).rejects.toThrow("belongs to another laboratory");
  expect(app.records.get(other.id, foreign.id)).toEqual(foreign);
  expect(readdirSync(app.paths.sessionsDir)).toEqual([]);
});
