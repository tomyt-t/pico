import { afterEach, expect, test } from "bun:test";
import type { RecordDetailView, ResearchRecord } from "../src/contracts";
import type { Job } from "../src/jobs";
import type { Lab } from "../src/labs";
import type { SessionState, UiMessage } from "../src/sessions";
import {
  call,
  type FakeModel,
  type Sandbox,
  sandbox,
  startFakeModel,
  until,
} from "./support";

let box: Sandbox | undefined;
let fake: FakeModel | undefined;
afterEach(async () => {
  await box?.cleanup();
  fake?.stop();
  box = undefined;
  fake = undefined;
});

const idle = (state: SessionState) => !state.streaming;

test("a real Pi session records research, receives a job outcome and revises a Panorama with a fake model", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url, pollMs: 100 });
  const { app } = box;
  const lab = await call<Lab>(app, "/labs", {
    body: {
      name: "Futebol",
      researchLine: "Modelos de previsão",
      provider: "fake",
      model: "fake-1",
      thinking: "off",
    },
  });

  fake.script.push(
    {
      toolCalls: [
        {
          name: "save_record",
          arguments: {
            kind: "question",
            title: "Elo prevê resultados?",
            body: "Primeira pergunta",
          },
        },
      ],
    },
    { text: "Registrei a pergunta." },
  );
  const sent = await call<{ mode: string }>(app, `/labs/${lab.id}/chat`, {
    body: { message: "Registre a primeira pergunta" },
  });
  expect(sent.mode).toBe("prompt");
  await until(
    () => app.records.list(lab.id, { kind: "question" }).length === 1,
    15_000,
    "record",
  );
  await until(
    async () => idle(await app.sessions.state(lab.id)),
    15_000,
    "idle",
  );

  const chat = await call<{ state: SessionState; messages: UiMessage[] }>(
    app,
    `/labs/${lab.id}/chat`,
  );
  expect(chat.state.model).toMatchObject({ provider: "fake", id: "fake-1" });
  expect(
    chat.messages.some(
      (message) =>
        message.role === "user" && message.text.includes("primeira pergunta"),
    ),
  ).toBe(true);
  expect(
    chat.messages.some(
      (message) =>
        message.role === "tool" && message.toolName === "save_record",
    ),
  ).toBe(true);
  expect(chat.messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "Registrei a pergunta.",
  });

  const first = fake.requests[0];
  if (!first) throw new Error("model was not called");
  const toolNames = (first.tools ?? []).map((tool) => tool.function.name);
  for (const name of [
    "bash",
    "read",
    "write",
    "edit",
    "save_record",
    "run_job",
    "web_search",
    "fetch_content",
  ])
    expect(toolNames).toContain(name);
  const system = first.messages.find(
    (message) => message.role === "system" || message.role === "developer",
  );
  const systemText =
    typeof system?.content === "string"
      ? system.content
      : JSON.stringify(system?.content);
  expect(systemText).toContain("You are Pico");
  expect(systemText).toContain("Modelos de previsão");

  fake.script.push(
    {
      toolCalls: [
        {
          name: "run_job",
          arguments: {
            command:
              'printf \'[{"name":"logloss","value":0.61}]\' > metrics.json && echo trained',
            name: "treino baseline",
          },
        },
      ],
    },
    { text: "Job iniciado, aguardando." },
    { text: "O job terminou com logloss 0.61; anotado." },
  );
  await call(app, `/labs/${lab.id}/chat`, {
    body: { message: "Treine o baseline" },
  });
  await until(
    () => app.jobs.list(lab.id).some((job) => job.status === "succeeded"),
    15_000,
    "job",
  );
  await until(
    () => fake?.requests.length === 5,
    15_000,
    "job notification turn",
  );
  await until(
    async () => idle(await app.sessions.state(lab.id)),
    15_000,
    "idle again",
  );

  const job = app.jobs.list(lab.id)[0] as Job;
  expect(job.metrics).toEqual([{ name: "logloss", value: 0.61 }]);
  expect(job.commitHash).toMatch(/^[0-9a-f]{40}$/);
  expect(job.notified).toBe(true);
  const messages = await app.sessions.messages(lab.id);
  const notification = messages.find(
    (message) => message.role === "user" && message.text.includes("[Pico] Job"),
  );
  expect(notification?.text).toContain(
    `(${job.id}) finished: succeeded (exit code 0)`,
  );
  expect(notification?.text).toContain("trained");
  expect(messages.at(-1)?.text).toContain("anotado");

  const question = app.records.list(lab.id, {
    kind: "question",
  })[0] as ResearchRecord;
  const originalBlocks = [
    {
      type: "markdown",
      text: "## Entendimento\nElo ainda precisa de avaliação.",
    },
    { type: "records", ids: [question.id] },
    { type: "artifact", path: "metrics.json", caption: "Medição do baseline" },
  ];
  fake.script.push(
    {
      toolCalls: [
        {
          name: "save_record",
          arguments: {
            kind: "page",
            title: "Panorama",
            body: "Entendimento provisório.",
            fields: { placement: "panorama", blocks: originalBlocks },
            links: [{ kind: "question", id: question.id }],
          },
        },
      ],
    },
    {
      text: "Organizei o Panorama com a pergunta e os resultados disponíveis.",
    },
  );
  await call(app, `/labs/${lab.id}/chat`, {
    body: { message: "Organize o Panorama com a pergunta e metrics.json" },
  });
  await until(
    () => app.records.list(lab.id, { kind: "page" }).length === 1,
    15_000,
    "page",
  );
  await until(
    async () => idle(await app.sessions.state(lab.id)),
    15_000,
    "page idle",
  );
  const page = app.records.list(lab.id, { kind: "page" })[0] as ResearchRecord;
  expect(page.fields.blocks).toEqual(originalBlocks);

  const revisedBlocks = [
    {
      type: "markdown",
      text: "## O que mudou\nO baseline teve logloss 0.61; falta comparar outros métodos.",
    },
    { type: "records", ids: [question.id] },
  ];
  fake.script.push(
    {
      toolCalls: [
        {
          name: "save_record",
          arguments: {
            id: page.id,
            kind: "page",
            body: "Baseline medido; comparação ainda aberta.",
            fields: { blocks: revisedBlocks },
            reason: "Incluí a medição e seus limites.",
          },
        },
        {
          name: "save_record",
          arguments: {
            kind: "note",
            title: "Baseline disponível",
            body: "Logloss 0.61 não basta para responder a pergunta; precisamos de comparação.",
            links: [
              { kind: "question", id: question.id },
              { kind: "page", id: page.id },
            ],
          },
        },
      ],
    },
    { text: "Atualizei o Panorama e registrei o que segue incerto." },
  );
  await call(app, `/labs/${lab.id}/chat`, {
    body: {
      message: `Atualize ${page.id} com o resultado do baseline e registre os limites.`,
    },
  });
  await until(
    () => app.records.get(lab.id, page.id).revision === 2,
    15_000,
    "page revision",
  );
  await until(
    async () => idle(await app.sessions.state(lab.id)),
    15_000,
    "revision idle",
  );
  const revised = await call<RecordDetailView>(
    app,
    `/labs/${lab.id}/records/${page.id}`,
  );
  expect(revised.record.fields).toEqual({
    placement: "panorama",
    blocks: revisedBlocks,
  });
  expect(revised.revisions[0]?.snapshot.fields.blocks).toEqual(originalBlocks);
  expect(revised.revisions[0]?.reason).toBe("Incluí a medição e seus limites.");
  expect(app.records.list(lab.id, { kind: "note" })[0]?.links).toContainEqual({
    kind: "page",
    id: page.id,
  });
  expect(systemText).toContain("Pages and Panorama");

  const events = await app.fetch(
    new Request(`http://127.0.0.1:4317/api/labs/${lab.id}/events`),
  );
  const reader = events.body?.getReader();
  const chunk = await reader?.read();
  expect(new TextDecoder().decode(chunk?.value)).toContain('"type":"state"');
  await reader?.cancel();
}, 60_000);

test("a lab without a usable model reports the error instead of hanging", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Sem modelo" });
  const response = await app.fetch(
    new Request(`http://127.0.0.1:4317/api/labs/${lab.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "olá" }),
    }),
  );
  expect(response.status).toBe(500);
  const state = await app.sessions.state(lab.id);
  expect(state.streaming).toBe(false);
  expect(state.lastError).toBeTruthy();
}, 30_000);
