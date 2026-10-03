import { afterEach, expect, setSystemTime, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Sandbox, sandbox } from "./support";

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
  setSystemTime();
});

test("laboratory history pairs each transition with its actual before and after", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Leituras" });
  setSystemTime(new Date("2026-09-28T12:00:00Z"));
  const initial = app.records.save(
    lab.id,
    {
      kind: "conclusion",
      title: "Interpretação inicial",
      body: "A hipótese parece sustentada.",
      status: "provisional",
      links: [{ kind: "paper", id: "p-source" }],
    },
    "researcher",
  );
  setSystemTime(new Date("2026-09-29T12:00:00Z"));
  const second = app.records.save(
    lab.id,
    {
      id: initial.id,
      kind: "conclusion",
      title: "O controle contradiz a hipótese",
      body: "O efeito desapareceu no controle.",
      status: "refuted",
      reason: "O grupo de controle mostrou a mesma diferença.",
    },
    "pico",
  );
  setSystemTime(new Date("2026-09-30T12:00:00Z"));
  const third = app.records.save(
    lab.id,
    {
      id: initial.id,
      kind: "conclusion",
      body: "A comparação ainda depende de novos dados.",
      status: "inconclusive",
    },
    "researcher",
  );

  expect(app.records.history(lab.id)).toEqual([
    {
      type: "revised",
      recordId: initial.id,
      at: third.updatedAt,
      author: "researcher",
      reason: null,
      before: second,
      after: third,
    },
    {
      type: "revised",
      recordId: initial.id,
      at: second.updatedAt,
      author: "pico",
      reason: "O grupo de controle mostrou a mesma diferença.",
      before: initial,
      after: second,
    },
    {
      type: "created",
      recordId: initial.id,
      at: initial.createdAt,
      author: "researcher",
      reason: null,
      before: null,
      after: initial,
    },
  ]);
});

test("history has stable ties, filters kinds before limiting and isolates laboratories", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Principal" });
  const other = await app.labs.create({ name: "Outro" });
  setSystemTime(new Date("2026-09-30T12:00:00Z"));
  const note = app.records.save(
    lab.id,
    {
      id: "n-a",
      kind: "note",
      title: "Nova direção",
      body: "Primeira leitura",
    },
    "pico",
  );
  app.records.save(
    lab.id,
    { id: note.id, kind: "note", body: "Outra leitura", reason: "Fonte nova" },
    "pico",
  );
  app.records.save(
    lab.id,
    { id: "n-z", kind: "note", title: "Coleta pendente" },
    "pico",
  );
  app.records.save(
    lab.id,
    { id: "e-a", kind: "experiment", title: "Teste operacional" },
    "pico",
  );
  const foreign = app.records.save(
    other.id,
    { kind: "note", title: "Somente outro lab" },
    "researcher",
  );
  app.records.save(
    other.id,
    { id: foreign.id, kind: "note", body: "Mudança privada" },
    "pico",
  );

  const history = app.records.history(lab.id);
  expect(
    history.map((entry) => [entry.recordId, entry.after.revision]),
  ).toEqual([
    ["e-a", 1],
    ["n-a", 2],
    ["n-a", 1],
    ["n-z", 1],
  ]);
  expect(app.records.history(lab.id)).toEqual(history);
  expect(app.records.history(lab.id, { kind: "note", limit: 2 })).toEqual(
    history.slice(1, 3),
  );
  expect(app.records.history(lab.id, { kind: "absent" })).toEqual([]);
  expect(app.records.history("missing-lab")).toEqual([]);
  expect(app.records.history(other.id)).toHaveLength(2);
  expect(history.every((entry) => entry.after.labId === lab.id)).toBe(true);
  app.records.remove(lab.id, note.id);
  expect(
    app.records.history(lab.id).some((entry) => entry.recordId === note.id),
  ).toBe(false);
  expect(app.records.history(other.id)).toHaveLength(2);
});

test("history bounds requested limits without loading an unbounded result", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Muitos registros" });
  app.db.transaction(() => {
    for (let index = 0; index < 505; index++)
      app.records.save(
        lab.id,
        { kind: "note", title: `Nota ${index}` },
        "pico",
      );
  })();
  expect(app.records.history(lab.id)).toHaveLength(100);
  expect(app.records.history(lab.id, { limit: 1 })).toHaveLength(1);
  expect(app.records.history(lab.id, { limit: 2.9 })).toHaveLength(2);
  expect(app.records.history(lab.id, { limit: 0 })).toHaveLength(1);
  expect(app.records.history(lab.id, { limit: -4 })).toHaveLength(1);
  expect(app.records.history(lab.id, { limit: 900 })).toHaveLength(500);
  expect(app.records.history(lab.id, { limit: Number.NaN })).toHaveLength(100);
  expect(app.records.history(lab.id, { limit: Infinity })).toHaveLength(100);
});

test("records are created, updated with revisions, listed and removed", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({
    name: "Futebol ML",
    researchLine: "Previsão de resultados",
  });
  expect(lab.id).toBe("futebol-ml");
  expect(existsSync(join(lab.path, "PICO.md"))).toBe(false);
  expect(app.labs.context(lab.id).content).toContain("## Research line");
  expect(existsSync(join(lab.path, "experiments"))).toBe(true);

  const question = app.records.save(
    lab.id,
    {
      kind: "question",
      title: "Elo com decaimento prevê melhor?",
      body: "Contexto inicial",
    },
    "pico",
  );
  expect(question.id).toMatch(/^q-[0-9a-f]{8}$/);
  expect(question.revision).toBe(1);

  const hypothesis = app.records.save(
    lab.id,
    {
      kind: "hypothesis",
      title: "Decaimento temporal reduz logloss",
      status: "proposed",
      links: [
        { kind: "question", id: question.id },
        { kind: "question", id: question.id },
      ],
      fields: { metric: "logloss" },
    },
    "pico",
  );
  expect(hypothesis.links).toEqual([{ kind: "question", id: question.id }]);

  const revised = app.records.save(
    lab.id,
    {
      kind: "hypothesis",
      id: hypothesis.id,
      status: "testing",
      fields: { season: "2024" },
      reason: "started testing",
    },
    "pico",
  );
  expect(revised.revision).toBe(2);
  expect(revised.status).toBe("testing");
  expect(revised.title).toBe(hypothesis.title);
  expect(revised.fields).toEqual({ metric: "logloss", season: "2024" });
  const revisions = app.records.revisions(lab.id, hypothesis.id);
  expect(revisions).toHaveLength(1);
  expect(revisions[0]?.snapshot.status).toBe("proposed");
  expect(revisions[0]?.reason).toBe("started testing");

  expect(app.records.list(lab.id).map((record) => record.id)).toEqual([
    hypothesis.id,
    question.id,
  ]);
  expect(app.records.list(lab.id, { kind: "question" })).toHaveLength(1);
  expect(app.records.list(lab.id, { status: "testing" })).toHaveLength(1);

  expect(() => app.records.save(lab.id, { kind: "note" }, "pico")).toThrow(
    "title is required",
  );
  expect(() =>
    app.records.save(
      lab.id,
      { kind: "result", id: hypothesis.id, title: "x" },
      "pico",
    ),
  ).toThrow("is a hypothesis");
  expect(() =>
    app.records.save(lab.id, { kind: "plan" as never, title: "x" }, "pico"),
  ).toThrow("Unknown kind");

  const other = await app.labs.create({ name: "Kernels" });
  expect(app.records.find(other.id, question.id)).toBeUndefined();

  app.records.remove(lab.id, question.id);
  expect(app.records.find(lab.id, question.id)).toBeUndefined();
  expect(app.records.list(lab.id)).toHaveLength(1);
});
