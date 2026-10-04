import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import type { AgentDefinition, AgentRunDetail } from "../src/contracts";
import { lastAssistantText } from "../src/subagents";
import {
  call,
  type FakeModel,
  hasToolResult,
  pico,
  request,
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

const messageText = (content: unknown): string =>
  typeof content === "string" ? content : JSON.stringify(content);
const isWorker = (req: FakeModel["requests"][number]) =>
  systemText(req).includes("fresh, ephemeral session");
const appInTest = () => {
  if (!box) throw new Error("No sandbox");
  return box.app;
};
const configure = (agentId = "bibliography", model = "sonnet") =>
  call<AgentDefinition>(appInTest(), `/agents/${agentId}`, {
    method: "PATCH",
    body: { provider: "anthropic", model, thinking: "medium" },
  });
const newLab = (name = "Lab") =>
  appInTest().labs.create({
    name,
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
const reopen = async () => {
  if (!box) throw new Error("No sandbox");
  const paths = box.app.paths;
  await box.app.close();
  const reopened = createApp(paths);
  // sandbox.cleanup closes its original app; close the reopened app explicitly in each test.
  return reopened;
};

test("fixed catalog is global, validates model choices and preserves configuration on restart", async () => {
  fake = startFakeModel();
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const profiles = await call<AgentDefinition[]>(app, "/agents");
  expect(profiles.map((agent) => agent.id)).toEqual([
    "campaign-coordinator",
    "bibliography",
    "experimentation",
    "critical-analysis",
    "research-editor",
  ]);
  const lab = await newLab();
  expect(
    (
      await app.fetch(
        request(`/labs/${lab.id}/agent-runs`, {
          body: { agentId: "bibliography", task: "Find sources" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.fetch(
        request("/agents/new", { method: "POST", body: { name: "Injected" } }),
      )
    ).status,
  ).toBe(404);
  const configured = await configure("bibliography", "opus");
  expect(configured).toMatchObject({
    provider: "anthropic",
    model: "opus",
    thinking: "medium",
  });
  // Models without adaptive thinking keep reasoning off.
  expect(await configure("critical-analysis", "haiku")).toMatchObject({
    model: "haiku",
    thinking: "off",
  });
  expect(
    (
      await app.fetch(
        request("/agents/bibliography", {
          method: "PATCH",
          body: { provider: "anthropic", model: "missing", thinking: "off" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.fetch(
        request("/agents/bibliography", {
          method: "PATCH",
          body: { provider: "anthropic", model: "sonnet", thinking: "unknown" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.fetch(
        request("/agents/bibliography", { method: "PATCH", body: null }),
      )
    ).status,
  ).toBe(400);
  const restarted = await reopen();
  try {
    expect(restarted.catalog.get("bibliography")).toEqual(configured);
    expect(restarted.catalog.list()).toHaveLength(5);
  } finally {
    await restarted.close();
  }
});

test("Pico spawns three instances of one profile in parallel, isolated from each other, then receives their results", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workers: FakeModel["requests"] = [];
  fake = startFakeModel(async (req) => {
    if (isWorker(req)) {
      workers.push(req);
      const task = messageText(
        req.messages.find((msg) => msg.role === "user")?.content,
      );
      const tag = task.match(/scope-[ABC]/)?.[0] ?? "unknown";
      if (!hasToolResult(req))
        return {
          toolCalls: [
            {
              name: pico("save_record"),
              arguments: {
                kind: "note",
                title: tag,
                body: `Evidence for ${tag}`,
              },
            },
            {
              name: "Bash",
              arguments: { command: `echo ${tag} > ${tag}.txt` },
            },
          ],
        };
      await gate;
      return { text: `Report for ${tag}` };
    }
    if (!hasToolResult(req))
      return {
        toolCalls: ["A", "B", "C"].map((tag) => ({
          name: pico("run_subagent"),
          arguments: {
            agent_id: "bibliography",
            task: `Research scope-${tag}`,
          },
        })),
      };
    return { text: "Pico has integrated the available reports." };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  await configure();
  const lab = await newLab();
  const other = await newLab("Other");
  try {
    await app.sessions.send(lab.id, "Delegate three independent searches");
    await until(
      () => workers.length === 6,
      20_000,
      "parallel workers at the model gate",
    );
    const runs = app.subagents.list(lab.id, true);
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === "running")).toBe(true);
    await until(() =>
      app.subagents.list(lab.id, true).every((run) => run.sessionId !== null),
    );
    expect(
      new Set(app.subagents.list(lab.id, true).map((run) => run.sessionId))
        .size,
    ).toBe(3);
    expect(app.subagents.list(other.id)).toEqual([]);
    expect(
      (await app.fetch(request(`/labs/${other.id}/agent-runs/${runs[0]?.id}`)))
        .status,
    ).toBe(404);
    expect(
      (
        await app.fetch(
          request(`/labs/${other.id}/agent-runs/${runs[0]?.id}/stop`, {
            body: {},
          }),
        )
      ).status,
    ).toBe(404);
    for (const req of workers) {
      expect(req.model).toContain("sonnet");
      const text = JSON.stringify(req.messages);
      expect(text).not.toContain("Delegate three independent searches");
      expect(new Set(text.match(/scope-[ABC]/g)).size).toBe(1);
      expect(toolNames(req)).not.toContain(pico("run_subagent"));
    }
    await configure("bibliography", "opus");
    expect(
      app.subagents.list(lab.id).every((run) => run.model === "sonnet"),
    ).toBe(true);
    for (const run of runs) {
      const tag = run.task.split(" ").at(-1);
      if (!tag) throw new Error("Missing task tag");
      expect(readFileSync(join(lab.path, `${tag}.txt`), "utf8").trim()).toBe(
        tag,
      );
      expect(
        app.records.list(lab.id).find((record) => record.title === tag)?.author,
      ).toBe(`subagent:${run.id}`);
    }
    release();
    await until(
      () => app.subagents.list(lab.id, true).length === 0,
      20_000,
      "Pico receipts",
    );
    const history = app.subagents.list(lab.id);
    expect(history).toHaveLength(3);
    expect(
      history.every(
        (run) =>
          run.status === "completed" && run.notified && run.usage.total > 0,
      ),
    ).toBe(true);
    const messages = await app.sessions.messages(lab.id);
    for (const run of history)
      expect(
        messages.filter(
          (message) =>
            message.role === "user" &&
            message.text.includes(`(${run.id}) finished`),
        ),
      ).toHaveLength(1);
    const next = app.subagents.start(lab, "bibliography", "Research scope-A");
    await until(() => app.subagents.get(lab.id, next.id).notified, 20_000);
    expect(app.subagents.get(lab.id, next.id).model).toBe("opus");
    expect(app.subagents.get(lab.id, next.id).usage.cost).toBeGreaterThan(0);
    expect(
      workers.at(-2)?.messages.filter((msg) => msg.role === "user"),
    ).toHaveLength(1);
    const detail = await call<AgentRunDetail>(
      app,
      `/labs/${lab.id}/agent-runs/${next.id}?limit=2`,
    );
    expect(detail.messages).toHaveLength(2);
    expect(detail.before).not.toBeNull();
    const earlier = await call<AgentRunDetail>(
      app,
      `/labs/${lab.id}/agent-runs/${next.id}?before=${detail.before}`,
    );
    expect(
      earlier.messages.some(
        (message) => message.role === "user" && message.text === next.task,
      ),
    ).toBe(true);
    const restarted = await reopen();
    try {
      expect(restarted.subagents.list(lab.id)).toHaveLength(4);
      expect(restarted.subagents.list(lab.id, true)).toHaveLength(0);
      expect(
        (await restarted.subagents.detail(lab.id, next.id)).messages.at(-1)
          ?.text,
      ).toContain("Report for scope-A");
    } finally {
      await restarted.close();
    }
  } finally {
    release();
  }
}, 60_000);

test("a completed run remains active until its outcome enters Pico's busy session", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let coordinatorRequests = 0;
  fake = startFakeModel(async (req) => {
    if (isWorker(req)) return { text: "Evidence ready" };
    coordinatorRequests++;
    if (coordinatorRequests === 1) await gate;
    return { text: "Coordinator response" };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  await configure();
  const lab = await newLab();
  try {
    await app.sessions.send(lab.id, "Long coordinator turn");
    await until(() => coordinatorRequests === 1);
    const run = app.subagents.start(
      lab,
      "bibliography",
      "Independent research",
    );
    await until(
      () => app.subagents.get(lab.id, run.id).status === "completed",
      20_000,
    );
    await until(
      async () =>
        (await app.sessions.state(lab.id)).queue.steering.length === 1,
    );
    expect(app.subagents.list(lab.id, true)).toHaveLength(1);
    expect(app.subagents.get(lab.id, run.id).notified).toBe(false);
    release();
    await until(() => app.subagents.list(lab.id, true).length === 0, 20_000);
    expect(
      (await app.sessions.messages(lab.id)).some((message) =>
        message.text.includes("Evidence ready"),
      ),
    ).toBe(true);
  } finally {
    release();
  }
}, 40_000);

test("stopping, model failure and server shutdown have distinct durable outcomes", async () => {
  fake = startFakeModel((req) => {
    if (!isWorker(req)) return { text: "Outcome received" };
    return {
      toolCalls: [{ name: "Bash", arguments: { command: "sleep 8" } }],
    };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  await configure();
  const lab = await newLab();
  const immediate = app.subagents.start(
    lab,
    "bibliography",
    "Cancel before the session is ready",
  );
  await app.subagents.stop(lab.id, immediate.id);
  expect(app.subagents.get(lab.id, immediate.id).status).toBe("stopped");
  expect(fake.requests.filter(isWorker)).toHaveLength(0);
  await until(() => app.subagents.get(lab.id, immediate.id).notified, 20_000);
  const stopped = app.subagents.start(
    lab,
    "bibliography",
    "Work until interrupted",
  );
  await until(
    () => app.subagents.get(lab.id, stopped.id).currentTool === "Bash",
    20_000,
  );
  await app.subagents.stop(lab.id, stopped.id);
  expect(app.subagents.get(lab.id, stopped.id).status).toBe("stopped");
  await until(() => app.subagents.get(lab.id, stopped.id).notified, 20_000);
  const interrupted = app.subagents.start(lab, "bibliography", "Shutdown work");
  await until(
    () => app.subagents.get(lab.id, interrupted.id).currentTool === "Bash",
    20_000,
  );
  const restarted = await reopen();
  try {
    expect(restarted.subagents.get(lab.id, interrupted.id).status).toBe(
      "interrupted",
    );
    await until(
      () => restarted.subagents.get(lab.id, interrupted.id).notified,
      20_000,
    );
    restarted.db.run(
      "UPDATE agent_definitions SET model = 'removed-model' WHERE id = 'bibliography'",
    );
    const failed = restarted.subagents.start(
      lab,
      "bibliography",
      "Missing model",
    );
    await until(
      () => restarted.subagents.get(lab.id, failed.id).notified,
      20_000,
    );
    expect(restarted.subagents.get(lab.id, failed.id)).toMatchObject({
      status: "failed",
      model: "removed-model",
    });
    expect(restarted.subagents.get(lab.id, failed.id).error).toContain(
      "not available",
    );
  } finally {
    await restarted.close();
  }
}, 60_000);

test("an interrupted run resumes in its saved conversation instead of starting over", async () => {
  fake = startFakeModel((req) => {
    if (!isWorker(req)) return { text: "Outcome received" };
    const sent = req.messages.map((message) => messageText(message.content));
    if (sent.some((text) => text.includes("was cut short")))
      return { text: "Resumed: partial.md kept" };
    if (!hasToolResult(req))
      return {
        toolCalls: [
          {
            name: "Write",
            arguments: { file_path: "partial.md", content: "partial work" },
          },
        ],
      };
    return {
      toolCalls: [{ name: "Bash", arguments: { command: "sleep 8" } }],
    };
  });
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  await configure();
  const lab = await newLab();
  const run = app.subagents.start(lab, "bibliography", "Long shutdown work");
  await until(
    () => app.subagents.get(lab.id, run.id).currentTool === "Bash",
    20_000,
  );
  const sessionId = app.subagents.get(lab.id, run.id).sessionId;
  expect(sessionId).toBeTruthy();
  const restarted = await reopen();
  try {
    expect(restarted.subagents.get(lab.id, run.id).status).toBe("interrupted");
    await until(() => restarted.subagents.get(lab.id, run.id).notified, 20_000);
    expect(
      fake.requests
        .filter((req) => !isWorker(req))
        .some((req) =>
          req.messages.some((message) =>
            messageText(message.content).includes(
              `mcp__pico__resume_subagent with id ${run.id}`,
            ),
          ),
        ),
    ).toBe(true);
    const resumed = await call<{ status: string }>(
      restarted,
      `/labs/${lab.id}/agent-runs/${run.id}/resume`,
      { method: "POST", body: {} },
    );
    expect(resumed.status).toBe("running");
    await until(
      () => restarted.subagents.get(lab.id, run.id).status === "completed",
      20_000,
    );
    expect(restarted.subagents.get(lab.id, run.id)).toMatchObject({
      sessionId,
      result: "Resumed: partial.md kept",
      error: null,
    });
    const last = fake.requests.filter(isWorker).at(-1);
    const history = JSON.stringify(last?.messages);
    expect(history).toContain("Long shutdown work");
    expect(history).toContain("partial.md");
    expect(() => restarted.subagents.resume(lab, run.id)).toThrow("completed");
  } finally {
    await restarted.close();
  }
}, 60_000);

test("a plan limit notice never replaces the agent's last message", () => {
  const assistant = (text: string, model: string) => ({
    type: "assistant" as const,
    uuid: crypto.randomUUID(),
    message: { role: "assistant", model, content: [{ type: "text", text }] },
  });
  expect(
    lastAssistantText([
      assistant("Controls written; running the smoke test.", "claude-sonnet-5"),
      assistant("You've hit your session limit · resets 4:20am", "<synthetic>"),
    ]),
  ).toBe("Controls written; running the smoke test.");
});
