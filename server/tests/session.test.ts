import { afterEach, expect, test } from "bun:test";
import type { RecordDetailView, ResearchRecord } from "../src/contracts";
import type { Job } from "../src/jobs";
import type { Lab } from "../src/labs";
import type { SessionState, UiMessage } from "../src/sessions";
import {
  call,
  type FakeModel,
  pico,
  requestText,
  type Sandbox,
  sandbox,
  startFakeModel,
  systemText,
  toolNames,
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

test("a real Claude Code session records research, receives a job outcome and revises a Panorama with a fake model", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url, pollMs: 100 });
  const { app } = box;
  const lab = await call<Lab>(app, "/labs", {
    body: {
      name: "Futebol",
      researchLine: "Modelos de previsão",
      provider: "anthropic",
      model: "sonnet",
      thinking: "off",
    },
  });

  fake.script.push(
    {
      toolCalls: [
        {
          name: pico("save_record"),
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
  expect(chat.state.model).toMatchObject({ provider: "anthropic" });
  expect(chat.state.sessionId).toBeTruthy();
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
  expect(app.labs.sessionId(lab.id)).toBe(chat.state.sessionId);

  const first = fake.requests[0];
  if (!first) throw new Error("model was not called");
  expect(first.model).toContain("sonnet");
  for (const name of [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "WebSearch",
    "WebFetch",
    pico("save_record"),
    pico("run_job"),
  ])
    expect(toolNames(first)).toContain(name);
  for (const name of ["Task", "Agent", "TodoWrite"])
    expect(toolNames(first)).not.toContain(name);
  expect(systemText(first)).toContain("You are Pico");
  expect(systemText(first)).toContain("Pages and Panorama");
  // Laboratory context is fresh per prompt, so it travels with the messages.
  expect(requestText(first)).toContain("Modelos de previsão");

  fake.script.push(
    {
      toolCalls: [
        {
          name: pico("run_job"),
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
    () => app.jobs.list(lab.id).some((job) => job.notified),
    15_000,
    "job delivered",
  );
  await until(() => fake?.script.length === 0, 15_000, "job notification turn");
  await until(
    async () => idle(await app.sessions.state(lab.id)),
    15_000,
    "idle again",
  );

  const job = app.jobs.list(lab.id)[0] as Job;
  expect(job.status).toBe("succeeded");
  expect(job.metrics).toEqual([{ name: "logloss", value: 0.61 }]);
  expect(job.commitHash).toMatch(/^[0-9a-f]{40}$/);
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
          name: pico("save_record"),
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
          name: pico("save_record"),
          arguments: {
            id: page.id,
            kind: "page",
            body: "Baseline medido; comparação ainda aberta.",
            fields: { blocks: revisedBlocks },
            reason: "Incluí a medição e seus limites.",
          },
        },
        {
          name: pico("save_record"),
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

  const events = await app.fetch(
    new Request(`http://127.0.0.1:4317/api/labs/${lab.id}/events`),
  );
  const reader = events.body?.getReader();
  const chunk = await reader?.read();
  expect(new TextDecoder().decode(chunk?.value)).toContain('"type":"state"');
  await reader?.cancel();
}, 60_000);

test("the laboratory conversation resumes after a server restart", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Retomada",
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  fake.script.push({ text: "Guardei o número 7." });
  await app.sessions.send(lab.id, "Lembre o número 7");
  await until(async () => idle(await app.sessions.state(lab.id)), 15_000);
  const sessionId = app.labs.sessionId(lab.id);
  expect(sessionId).toBeTruthy();
  const paths = app.paths;
  await app.close();
  const { createApp } = await import("../src/app");
  const restarted = createApp(paths);
  try {
    const before = await restarted.sessions.messages(lab.id);
    expect(before.map((message) => message.text)).toEqual([
      "Lembre o número 7",
      "Guardei o número 7.",
    ]);
    fake.script.push({ text: "Era 7." });
    await restarted.sessions.send(lab.id, "Qual número?");
    await until(
      async () => idle(await restarted.sessions.state(lab.id)),
      15_000,
    );
    expect(restarted.labs.sessionId(lab.id)).toBe(sessionId);
    expect(requestText(fake.requests.at(-1))).toContain("Lembre o número 7");
    expect((await restarted.sessions.messages(lab.id)).at(-1)?.text).toBe(
      "Era 7.",
    );
  } finally {
    await restarted.close();
  }
}, 40_000);

test("model errors and unavailable models are reported instead of hanging", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Com erro",
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  fake.script.push({
    error: {
      status: 400,
      type: "invalid_request_error",
      message: "prompt is too long",
    },
  });
  await call(app, `/labs/${lab.id}/chat`, { body: { message: "olá" } });
  await until(
    async () => !!(await app.sessions.state(lab.id)).lastError,
    15_000,
    "error",
  );
  await until(async () => idle(await app.sessions.state(lab.id)), 15_000);

  const removed = await app.labs.create({ name: "Sem modelo" });
  app.db.run(
    "UPDATE labs SET provider='anthropic', model='removed-model' WHERE id=?",
    [removed.id],
  );
  const response = await app.fetch(
    new Request(`http://127.0.0.1:4317/api/labs/${removed.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "olá" }),
    }),
  );
  expect(response.status).toBe(400);
  expect(JSON.stringify(await response.json())).toContain("not available");
}, 40_000);
