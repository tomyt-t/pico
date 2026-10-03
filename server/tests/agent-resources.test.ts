import { afterEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentCatalog } from "../src/agent-catalog";
import { AgentResources, renderPrompt } from "../src/agent-resources";
import { createApp } from "../src/app";
import type {
  AgentDefinition,
  LabContext,
  ResearchRecord,
} from "../src/contracts";
import { createPicoTools } from "../src/tools";
import {
  call,
  type FakeModel,
  request,
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

test("database resources preserve edited instructions, examples and model choices when reseeded", async () => {
  box = sandbox();
  const { app } = box;
  expect(app.catalog.list().map((agent) => agent.name)).toEqual([
    "Campaign Coordinator",
    "Literature Researcher",
    "Experimenter",
    "Critical Analyst",
    "Research Editor",
  ]);
  const editor = app.catalog.get("research-editor");
  expect(editor.skillId).toBe("research-editorial");
  await call(app, "/agents/research-editor", {
    method: "PATCH",
    body: {
      instructions: "Custom editorial responsibility",
      name: "My Editor",
    },
  });
  await call(app, "/skills/research-editorial", {
    method: "PATCH",
    body: { instructions: "Custom procedure", examples: "Custom example" },
  });
  await call(app, "/prompts/coordinator", {
    method: "PATCH",
    body: { content: "Coordinator for {{lab_name}}" },
  });
  const resources = new AgentResources(app.db);
  const catalog = new AgentCatalog(app.db, async () => []);
  expect(catalog.get(editor.id)).toMatchObject({
    name: "My Editor",
    instructions: "Custom editorial responsibility",
    provider: null,
  });
  expect(resources.skill("research-editorial")).toMatchObject({
    instructions: "Custom procedure",
    examples: "Custom example",
  });
  expect(resources.prompt("coordinator").content).toBe(
    "Coordinator for {{lab_name}}",
  );
  expect(
    (
      await app.fetch(
        request("/skills/missing", {
          method: "PATCH",
          body: { instructions: "x" },
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await app.fetch(
        request("/prompts/shared", { method: "PATCH", body: { content: 3 } }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.fetch(
        request("/agents/research-editor", {
          method: "PATCH",
          body: { skillId: "missing" },
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    renderPrompt("{{lab_name}} {{lab_path}}", {
      lab_name: "Keep {{lab_path}} literally",
      lab_path: "/workspace",
    }),
  ).toBe("Keep {{lab_path}} literally /workspace");
});

test("existing PICO.md is imported once, preserving text and intentionally empty later context across restarts", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Existing" });
  const other = await app.labs.create({ name: "Other" });
  expect(existsSync(join(other.path, "PICO.md"))).toBe(false);
  writeFileSync(
    join(lab.path, "PICO.md"),
    "# Direção original\n\nNão traduzir as decisões do pesquisador.\n",
  );
  // Simulate a lab from before migration 6: no database context yet.
  app.db.run("DELETE FROM lab_context_revisions WHERE lab_id=?", [lab.id]);
  app.db.run(
    "UPDATE labs SET context_markdown=NULL, context_revision=0, context_updated_at=NULL WHERE id=?",
    [lab.id],
  );
  const paths = app.paths;
  await app.close();
  const reopened = createApp(paths);
  try {
    expect(reopened.labs.context(lab.id)).toMatchObject({
      content:
        "# Direção original\n\nNão traduzir as decisões do pesquisador.\n",
      revision: 1,
    });
    expect(reopened.labs.contextHistory(lab.id)[0]).toMatchObject({
      author: "migration:PICO.md",
    });
    writeFileSync(
      join(lab.path, "PICO.md"),
      "Outdated file must not override the database",
    );
    await call(reopened, `/labs/${lab.id}/context`, {
      method: "PUT",
      body: { content: "" },
    });
    expect(await call(reopened, `/labs/${lab.id}/pico`)).toMatchObject({
      content: "",
      revision: 2,
    });
    expect(reopened.labs.context(other.id).revision).toBe(1);
  } finally {
    await reopened.close();
  }
  const again = createApp(paths);
  try {
    expect(again.labs.context(lab.id).content).toBe("");
    expect(again.labs.contextHistory(lab.id)).toHaveLength(2);
  } finally {
    await again.close();
  }
});

test("lab_context and save_page tools share HTTP data, revisions and authorship without acknowledging review", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Tools" });
  const tools = createPicoTools({
    lab,
    labs: app.labs,
    resources: app.resources,
    records: app.records,
    jobs: app.jobs,
    author: "subagent:test",
  });
  const execute = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`Missing ${name}`);
    const result = await tool.execute(
      "call",
      params,
      undefined,
      undefined,
      {} as Parameters<typeof tool.execute>[4],
    );
    const part = result.content.find((item) => item.type === "text");
    if (part?.type !== "text") throw new Error("Missing result");
    return JSON.parse(part.text);
  };
  await execute("lab_context", {
    content: "# Current direction\nCompare the revised protocol.",
  });
  expect(await call<LabContext>(app, `/labs/${lab.id}/context`)).toEqual(
    await execute("lab_context", {}),
  );
  expect(app.labs.contextHistory(lab.id)[0]).toMatchObject({
    author: "subagent:test",
    revision: 2,
  });
  const skill = await execute("read_skill", { id: "research-editorial" });
  expect(skill.examples).toBeUndefined();
  expect(
    (await execute("read_skill", { id: "research-editorial", examples: true }))
      .examples,
  ).toBe(app.resources.skill("research-editorial").examples);
  const created = await execute("save_page", {
    title: "Current understanding",
    placement: "panorama",
    blocks: [{ type: "markdown", text: "An explanation with limits." }],
  });
  const updated = await call<ResearchRecord>(app, `/labs/${lab.id}/pages`, {
    body: {
      id: created.saved,
      body: "Alternative summary",
      reason: "Clarify the fallback",
    },
  });
  expect(updated).toMatchObject({
    revision: 2,
    author: "researcher",
    fields: {
      placement: "panorama",
      blocks: [{ type: "markdown", text: "An explanation with limits." }],
    },
  });
  expect(app.records.revisions(lab.id, updated.id)[0]?.snapshot.author).toBe(
    "subagent:test",
  );
  expect(app.editorial.status(lab).pages[0]?.state).toBe("unreviewed");
  const missing = await execute("save_page", {
    id: updated.id,
    blocks: [{ type: "records", ids: ["absent-record"] }],
  });
  expect(missing.revision).toBe(3);
  expect(app.editorial.status(lab).pages[0]?.missingRecords).toEqual([
    "absent-record",
  ]);
});

test("real Pi worker sessions load database skills, fetch examples on demand and keep active instructions stable", async () => {
  let step = 0;
  fake = startFakeModel((req) => {
    const worker = req.messages.some(
      (msg) =>
        (msg.role === "system" || msg.role === "developer") &&
        JSON.stringify(msg.content).includes("fresh, ephemeral session"),
    );
    if (!worker) return { text: "Received" };
    if (!box) throw new Error("Missing sandbox");
    const { app } = box;
    if (step++ === 0) {
      app.resources.updateSkill("research-editorial", {
        instructions: "NEXT_RUN_PROCEDURE",
        examples: "NEXT_RUN_EXAMPLE",
      });
      return {
        toolCalls: [
          {
            name: "read_skill",
            arguments: { id: "research-editorial", examples: true },
          },
        ],
      };
    }
    if (step === 2)
      return {
        toolCalls: [
          {
            name: "save_page",
            arguments: {
              title: "Explained result",
              placement: "panorama",
              blocks: [
                {
                  type: "markdown",
                  text: "Measured improvement, with uncertainty still unresolved.",
                },
              ],
            },
          },
        ],
      };
    if (step === 3) {
      const page = app.records.list("worker", { kind: "page" })[0];
      if (!page) throw new Error("Page was not saved");
      return {
        toolCalls: [
          {
            name: "review_pages",
            arguments: {
              pages: [
                {
                  id: page.id,
                  revision: page.revision,
                  summary: "Explanation and available evidence reviewed",
                },
              ],
            },
          },
        ],
      };
    }
    return { text: "Editorial work delivered" };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  app.resources.updateSkill("research-editorial", {
    instructions: "CURRENT_RUN_PROCEDURE",
    examples: "CURRENT_RUN_EXAMPLE",
  });
  app.labs.saveContext(
    (
      await app.labs.create({
        name: "Worker",
        provider: "fake",
        model: "fake-1",
        thinking: "off",
      })
    ).id,
    "DATABASE_DIRECTION",
    "researcher",
  );
  const lab = app.labs.get("worker");
  await call<AgentDefinition>(app, "/agents/research-editor", {
    method: "PATCH",
    body: { provider: "fake", model: "fake-1", thinking: "off" },
  });
  const first = app.subagents.start(
    lab,
    "research-editor",
    "Explain this research",
  );
  await until(() => app.subagents.get(lab.id, first.id).notified, 15000);
  expect(app.subagents.get(lab.id, first.id).status).toBe("completed");
  expect(app.editorial.status(lab).needsReview).toBe(false);
  const workerRequests = fake.requests.filter((req) =>
    JSON.stringify(req.messages[0]).includes("fresh, ephemeral session"),
  );
  expect(JSON.stringify(workerRequests[0])).toContain("CURRENT_RUN_PROCEDURE");
  expect(JSON.stringify(workerRequests[0])).toContain("DATABASE_DIRECTION");
  expect(JSON.stringify(workerRequests[0])).not.toContain(
    "CURRENT_RUN_EXAMPLE",
  );
  expect(JSON.stringify(workerRequests[1])).toContain("CURRENT_RUN_EXAMPLE");
  expect(JSON.stringify(workerRequests)).not.toContain("NEXT_RUN_PROCEDURE");
  expect(JSON.stringify(workerRequests)).not.toContain("NEXT_RUN_EXAMPLE");
  const second = app.subagents.start(
    lab,
    "research-editor",
    "Revisit the explanation",
  );
  await until(() => app.subagents.get(lab.id, second.id).notified, 15000);
  expect(
    fake.requests.some((req) =>
      JSON.stringify(req.messages[0]).includes("NEXT_RUN_PROCEDURE"),
    ),
  ).toBe(true);
  expect(existsSync(join(lab.path, "PICO.md"))).toBe(false);
}, 35000);

test("database prompt and context edits reach an existing coordinator on its next turn", async () => {
  fake = startFakeModel(() => ({ text: "Acknowledged" }));
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Coordinator",
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  await app.sessions.send(lab.id, "Start");
  await until(async () => !(await app.sessions.state(lab.id)).streaming);
  app.resources.updatePrompt(
    "coordinator",
    "UPDATED_COORDINATOR for {{lab_name}}",
  );
  app.labs.saveContext(lab.id, "UPDATED_CONTEXT", "researcher");
  writeFileSync(join(lab.path, "PICO.md"), "OBSOLETE_FILE_CONTEXT");
  await app.sessions.send(lab.id, "Continue");
  await until(async () => !(await app.sessions.state(lab.id)).streaming);
  const system = JSON.stringify(fake.requests.at(-1)?.messages[0]);
  expect(system).toContain("UPDATED_COORDINATOR for Coordinator");
  expect(system).toContain("UPDATED_CONTEXT");
  expect(system).not.toContain("OBSOLETE_FILE_CONTEXT");
  expect(
    fake.requests.at(-1)?.tools?.map((tool) => tool.function.name),
  ).toEqual(expect.arrayContaining(["save_page", "read_skill", "lab_context"]));
});
