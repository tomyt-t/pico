import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import type { EditorialStatus } from "../src/contracts";
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
const text = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
const worker = (req: FakeModel["requests"][number]) =>
  req.messages.some(
    (message) =>
      (message.role === "system" || message.role === "developer") &&
      text(message.content).includes("fresh, ephemeral session"),
  );

test("Pico delegates an editorial pass, verifies saved pages and keeps concurrent research pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let editorCalls = 0;
  let coordinatorCalls = 0;
  let pageId = "";
  let labId = "";
  let secondPass = false;
  fake = startFakeModel(async (req) => {
    if (!worker(req)) {
      if (++coordinatorCalls === 1)
        return {
          toolCalls: [
            {
              name: "run_subagent",
              arguments: {
                agent_id: "research-editor",
                task: "Review the Panorama and register actual coverage; preserve the existing page.",
              },
            },
          ],
        };
      return { text: "Saved pages and pending changes will be reported." };
    }
    const step = editorCalls++;
    if (step === 0)
      return { toolCalls: [{ name: "review_pages", arguments: {} }] };
    if (step === 1)
      return {
        toolCalls: [{ name: "read_records", arguments: { id: pageId } }],
      };
    if (step === 2 && !secondPass) {
      await gate;
      return {
        toolCalls: [
          {
            name: "save_record",
            arguments: {
              id: pageId,
              kind: "page",
              body: "Readable summary",
              fields: {
                blocks: [
                  {
                    type: "markdown",
                    text: "## What we learned\nEvidence and limitations, with an open next question.",
                  },
                  {
                    type: "artifact",
                    path: "figure.svg",
                    caption:
                      "Observed evidence; interpretation remains provisional.",
                  },
                ],
              },
              reason: "Explain the current evidence",
            },
          },
        ],
      };
    }
    if (step === (secondPass ? 2 : 3))
      return {
        toolCalls: [
          {
            name: "review_pages",
            arguments: {
              pages: [
                {
                  id: pageId,
                  revision: 2,
                  summary: secondPass
                    ? "Later source considered; explanation remains appropriate"
                    : "Initial evidence explained",
                },
              ],
            },
          },
        ],
      };
    return {
      text: "Review saved. Changes arriving after the start remain pending.",
    };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Editorial lab",
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  labId = lab.id;
  await app.catalog.configure("research-editor", {
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  const source = app.records.save(
    labId,
    { kind: "result", title: "Initial evidence" },
    "pico",
  );
  const page = app.records.save(
    labId,
    {
      kind: "page",
      title: "Panorama",
      fields: { placement: "panorama" },
      links: [{ kind: source.kind, id: source.id }],
    },
    "pico",
  );
  pageId = page.id;
  writeFileSync(
    join(lab.path, "figure.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
  );
  try {
    await app.sessions.send(lab.id, "Consolidate and explain this research");
    await until(
      () => editorCalls === 3,
      15000,
      "editor reading before writing",
    );
    const active = app.subagents
      .list(lab.id)
      .find((run) => run.agentId === "research-editor");
    expect(active?.status).toBe("running");
    expect(
      (
        await app.fetch(
          request(`/labs/${lab.id}/agent-runs`, {
            body: { agentId: "research-editor", task: "Overlapping work" },
          }),
        )
      ).status,
    ).toBe(409);
    const added = app.records.save(
      lab.id,
      { kind: "paper", title: "A newly arrived source" },
      "subagent:bibliography",
    );
    release();
    await until(
      () => !!active && app.subagents.get(lab.id, active.id).notified,
      20000,
      "editorial delivery",
    );
    const saved = app.records.get(lab.id, pageId);
    expect(saved.revision).toBe(2);
    expect(saved.author).toBe(`subagent:${active?.id}`);
    expect(app.records.list(lab.id, { kind: "page" })).toHaveLength(1);
    let status = await call<EditorialStatus>(app, `/labs/${lab.id}/editorial`);
    expect(status.pages[0]).toMatchObject({
      state: "pending",
      changedRecords: [added.id],
      missingFiles: [],
      invalidBlocks: [],
    });
    expect(status.activeRunId).toBeNull();
    expect(app.subagents.list(lab.id, true)).toHaveLength(0);
    expect(
      fake.requests.some((req) =>
        JSON.stringify(req).includes("1 pages need review"),
      ),
    ).toBe(true);
    secondPass = true;
    editorCalls = 0;
    const next = app.subagents.start(
      lab,
      "research-editor",
      "Consider the later source and explicitly review the unchanged page",
    );
    await until(
      () => app.subagents.get(lab.id, next.id).notified,
      20000,
      "second editorial delivery",
    );
    status = await call<EditorialStatus>(app, `/labs/${lab.id}/editorial`);
    expect(status.needsReview).toBe(false);
    expect(app.records.get(lab.id, pageId).revision).toBe(2);
    const before = fake.requests.length;
    await call(app, `/labs/${lab.id}/editorial`);
    expect(fake.requests).toHaveLength(before);
  } finally {
    release();
  }
}, 40000);

test("an interrupted editor preserves a partial review across restart without automatically launching another run", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let step = 0;
  let topicId = "";
  fake = startFakeModel(async (req) => {
    if (!worker(req))
      return { text: "Interrupted editorial work remains pending." };
    if (step++ === 0)
      return {
        toolCalls: [
          {
            name: "review_pages",
            arguments: {
              pages: [
                {
                  id: topicId,
                  revision: 1,
                  summary: "Topic read; no changes needed",
                },
              ],
            },
          },
        ],
      };
    await gate;
    return { text: "Finished" };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Partial",
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  await app.catalog.configure("research-editor", {
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  const topic = app.records.save(
    lab.id,
    { kind: "page", title: "Topic", body: "Existing explanation" },
    "pico",
  );
  const panorama = app.records.save(
    lab.id,
    { kind: "page", title: "Panorama", fields: { placement: "panorama" } },
    "pico",
  );
  topicId = topic.id;
  try {
    const run = app.subagents.start(
      lab,
      "research-editor",
      "Review the topic and then the Panorama",
    );
    await until(() => step === 2, 15000);
    await app.subagents.stop(lab.id, run.id);
    release();
    await until(() => app.subagents.get(lab.id, run.id).notified, 15000);
    const paths = app.paths;
    await app.close();
    const reopened = createApp(paths);
    try {
      const status = await call<EditorialStatus>(
        reopened,
        `/labs/${lab.id}/editorial`,
      );
      expect(status.pages.find((item) => item.pageId === topic.id)?.state).toBe(
        "reviewed",
      );
      expect(
        status.pages.find((item) => item.pageId === panorama.id)?.state,
      ).toBe("unreviewed");
      expect(status.lastRun?.status).toBe("stopped");
      expect(status.activeRunId).toBeNull();
      expect(reopened.subagents.list(lab.id)).toHaveLength(1);
    } finally {
      await reopened.close();
    }
  } finally {
    release();
  }
}, 35000);

test("an aborted coordinator receives a queued outcome once and preserves other queued input", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let coordinatorCalls = 0;
  fake = startFakeModel(async (req) => {
    if (worker(req)) return { text: "Evidence returned" };
    if (++coordinatorCalls === 1) await gate;
    return { text: "Received" };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Delivery",
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  await app.catalog.configure("bibliography", {
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  try {
    await app.sessions.send(lab.id, "Work until interrupted");
    await until(() => coordinatorCalls === 1);
    const run = app.subagents.start(lab, "bibliography", "Independent review");
    await until(
      async () =>
        (await app.sessions.state(lab.id)).queue.steering.length === 1,
      15000,
    );
    await app.sessions.send(lab.id, "Preserve this researcher instruction");
    await app.sessions.abort(lab.id);
    release();
    await until(() => app.subagents.get(lab.id, run.id).notified, 15000);
    await until(
      async () => !(await app.sessions.state(lab.id)).streaming,
      15000,
    );
    const messages = await app.sessions.messages(lab.id);
    expect(
      messages.filter(
        (message) =>
          message.role === "user" && message.text.includes("Evidence returned"),
      ),
    ).toHaveLength(1);
    expect(
      messages.filter(
        (message) =>
          message.role === "user" &&
          message.text === "Preserve this researcher instruction",
      ),
    ).toHaveLength(1);
  } finally {
    release();
  }
}, 35000);

test("continued coordinator sessions receive new tools and fresh editorial context on later turns", async () => {
  fake = startFakeModel(() => ({ text: "Acknowledged" }));
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Continued",
    provider: "fake",
    model: "fake-1",
    thinking: "off",
  });
  // Persist the older role loadout as a real Pi transcript.
  const old = await app.sessions.createSession(lab);
  old.setActiveToolsByName(
    old.getActiveToolNames().filter((name) => name !== "review_pages"),
  );
  await old.prompt("An earlier version of Pico", {
    expandPromptTemplates: false,
  });
  old.dispose();
  app.records.save(
    lab.id,
    { kind: "page", title: "Needs editorial review", body: "Original content" },
    "researcher",
  );
  await app.sessions.send(lab.id, "Resume our work");
  await until(async () => !(await app.sessions.state(lab.id)).streaming);
  const resumed = fake.requests.at(-1);
  expect(
    resumed?.tools?.some((tool) => tool.function.name === "review_pages"),
  ).toBe(true);
  expect(JSON.stringify(resumed)).toContain("1 pages need review");
  app.records.save(
    lab.id,
    { kind: "page", title: "Another page", body: "New content" },
    "researcher",
  );
  app.labs.saveContext(
    lab.id,
    "A newly adopted research direction",
    "researcher",
  );
  await app.sessions.send(lab.id, "Continue with the new direction");
  await until(async () => !(await app.sessions.state(lab.id)).streaming);
  const current = JSON.stringify(fake.requests.at(-1));
  expect(current).toContain("2 pages need review");
  expect(current).toContain("A newly adopted research direction");
}, 20000);
