import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import type { Campaign, CampaignDetail } from "../src/contracts";
import { processAlive } from "../src/jobs";
import {
  call,
  type FakeModel,
  hasToolResult,
  pico,
  request,
  requestText,
  type Sandbox,
  sandbox,
  startFakeModel,
  systemText,
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
const text = (req: FakeModel["requests"][number]) => requestText(req);
const worker = (req: FakeModel["requests"][number]) =>
  systemText(req).includes("fresh, ephemeral session");
const coordinator = (req: FakeModel["requests"][number]) =>
  systemText(req).includes("You are a persistent campaign coordinator");
const progress = (args: Record<string, unknown>) => ({
  toolCalls: [{ name: pico("campaign_progress"), arguments: args }],
});
const input = (tag = "alpha") => ({
  title: tag,
  objective: `Investigate scope-${tag}`,
  deliverable: `Evidence and limitations for ${tag}`,
});

test("a response that exhausts the budget ends the campaign before another model request", async () => {
  fake = startFakeModel((req) =>
    coordinator(req)
      ? {
          toolCalls: [
            {
              name: pico("run_job"),
              arguments: { command: "echo late", name: "Late job" },
            },
          ],
        }
      : { text: "Budget pending" },
  );
  const { app, lab } = await setup(true);
  app.campaigns.configure({ budgetUsd: 0.1 });
  const campaign = app.campaigns.start(lab, input());
  await app.campaigns.poll();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "pending",
  );
  await until(() => !app.campaigns.get(lab.id, campaign.id).isWorking);
  expect(app.campaigns.get(lab.id, campaign.id).reason).toBe("budget");
  expect(app.campaigns.get(lab.id, campaign.id).usage.total).toBeGreaterThan(
    75_000,
  );
  expect(app.campaigns.get(lab.id, campaign.id).usage.cost).toBeCloseTo(
    perCall,
    3,
  );
  // Claude Code learns a response's cost only after it; that response's
  // tools may still run, but no further model request is made.
  await app.campaigns.poll();
  expect(fake.requests.filter(coordinator)).toHaveLength(1);
}, 20_000);

test("a paused campaign's session cannot request more model work", async () => {
  fake = startFakeModel(() => ({ text: "Evidence and limitations." }));
  const { app, lab } = await setup(true);
  const campaign = app.campaigns.start(lab, input());
  app.db.run("UPDATE campaigns SET wake_requested=0 WHERE id=?", [campaign.id]);
  const session = await app.sessions.createSession(lab, undefined, campaign);
  try {
    await session.prompt("Inspect the first evidence");
    await session.prompt("Inspect the second evidence");
    expect(app.campaigns.get(lab.id, campaign.id).usage.cost).toBeCloseTo(
      2 * perCall,
      3,
    );
    const calls = fake.requests.length;
    await app.campaigns.control(lab.id, campaign.id, { action: "pause" });
    await session.prompt("No further model work");
    expect(fake.requests).toHaveLength(calls);
    expect(session.lastResult).toMatchObject({ ok: false });
    expect(app.campaigns.get(lab.id, campaign.id).status).toBe("paused");
  } finally {
    await session.abort();
    await session.dispose();
  }
}, 20_000);

test("a Claude plan limit leaves the campaign pending with its reset time until the researcher resumes it", async () => {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fake = startFakeModel(async (req) => {
    if (!coordinator(req)) return { text: "Pico noted the plan limit." };
    if (text(req).includes("PLAN-RESET"))
      return progress({ action: "complete", result: "Finished after reset" });
    started = true;
    await gate;
    return { text: "Work cut short by the plan limit" };
  });
  const { app, lab } = await setup();
  const campaign = app.campaigns.start(lab, input());
  app.db.run("UPDATE campaigns SET wake_requested=0 WHERE id=?", [campaign.id]);
  const session = await app.sessions.createSession(lab, undefined, campaign);
  try {
    const done = session.prompt("Inspect the evidence");
    await until(() => started);
    // Claude Code reports plan limits only to subscription logins, which
    // tests never use: deliver the event as the CLI would.
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    await (
      session as unknown as { handle(message: unknown): Promise<void> }
    ).handle({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt },
      uuid: crypto.randomUUID(),
      session_id: session.sessionId,
    });
    await done;
    release();
    const reset = new Date(resetsAt * 1000).toISOString();
    expect(app.campaigns.get(lab.id, campaign.id)).toMatchObject({
      status: "pending",
      reason: "rate_limit",
      limitResetsAt: reset,
    });
    expect(app.campaigns.get(lab.id, campaign.id).summary).toContain(reset);
    expect(session.lastResult).toMatchObject({ ok: false });
    const count = fake.requests.filter(coordinator).length;
    await app.campaigns.poll();
    expect(fake.requests.filter(coordinator)).toHaveLength(count);
    await until(async () =>
      JSON.stringify(await app.sessions.messages(lab.id)).includes(
        "rate_limit",
      ),
    );
  } finally {
    await session.dispose();
  }
  await app.campaigns.control(lab.id, campaign.id, {
    action: "resume",
    message: "PLAN-RESET: the plan limit has reset",
  });
  expect(app.campaigns.get(lab.id, campaign.id).limitResetsAt).toBeNull();
  await app.campaigns.poll();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "completed",
  );
}, 20_000);

/** Fake usage priced by Claude Code for Sonnet ($2/$10 per Mtok): about
 *  US$ 0.15 per agent request. */
const perCall = 0.15;

async function setup(expensive = false) {
  if (!fake) throw new Error("Fake model required");
  if (expensive) fake.usage.input_tokens = 75_000;
  box = sandbox({ fakeModelUrl: fake.url });
  const app = box.app;
  for (const id of ["campaign-coordinator", "bibliography", "experimentation"])
    await app.catalog.configure(id, {
      provider: "anthropic",
      model: "sonnet",
      thinking: "off",
    });
  const lab = await app.labs.create({
    name: "Campaign lab",
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  return { app, lab };
}

test("campaign defaults are copied, HTTP validates limits and reads stay passive and lab-scoped", async () => {
  fake = startFakeModel();
  const { app, lab } = await setup();
  const settings = app.campaigns.settings();
  expect(settings).toEqual({ budgetUsd: 5, maxAgents: 2, labMaxAgents: 3 });
  const campaign = await call<Campaign>(app, `/labs/${lab.id}/campaigns`, {
    body: input(),
  });
  await app.campaigns.control(lab.id, campaign.id, { action: "pause" });
  await call(app, "/campaign-settings", {
    method: "PATCH",
    body: { budgetUsd: 8, maxAgents: 1, labMaxAgents: 4 },
  });
  expect(app.campaigns.get(lab.id, campaign.id)).toMatchObject({
    budgetUsd: 5,
    maxAgents: 2,
    status: "paused",
  });
  const next = app.campaigns.start(lab, input("beta"));
  expect(next).toMatchObject({ budgetUsd: 8, maxAgents: 1 });
  await app.campaigns.control(lab.id, next.id, { action: "pause" });
  for (const body of [
    { budgetUsd: 0 },
    { maxAgents: 1.5 },
    { labMaxAgents: "6" },
    null,
  ])
    expect(
      (
        await app.fetch(
          request("/campaign-settings", { method: "PATCH", body }),
        )
      ).status,
    ).toBe(400);
  const other = await app.labs.create({ name: "Other" });
  expect(
    (await app.fetch(request(`/labs/${other.id}/campaigns/${campaign.id}`)))
      .status,
  ).toBe(404);
  const detail = await call<CampaignDetail>(
    app,
    `/labs/${lab.id}/campaigns/${campaign.id}`,
  );
  expect(detail.messages).toEqual([]);
  expect(detail.campaign.sessionId).toBeNull();
  expect(fake.requests).toHaveLength(0);
});

test("parallel campaigns have separate persistent coordinators and deliver specialist results to their owner", async () => {
  fake = startFakeModel((req) => {
    const tag = text(req).includes("scope-alpha") ? "alpha" : "beta";
    if (worker(req)) return { text: `PRIVATE-REPORT-${tag}` };
    if (!coordinator(req)) return { text: "Pico integrated the milestone." };
    if (text(req).includes(`PRIVATE-REPORT-${tag}`))
      return progress({
        action: "complete",
        result: `Final evidence for ${tag}`,
        summary: `Revise the page for ${tag}`,
      });
    return {
      toolCalls: [
        {
          name: pico("run_subagent"),
          arguments: {
            agent_id: "bibliography",
            task: `Research scope-${tag}`,
          },
        },
        {
          name: pico("campaign_progress"),
          arguments: {
            action: "wait",
            plan: `Compare sources for ${tag}`,
            activity: "Reading literature",
          },
        },
      ],
    };
  });
  const { app, lab } = await setup();
  const a = app.campaigns.start(lab, input("alpha"));
  const b = app.campaigns.start(lab, input("beta"));
  await app.campaigns.poll();
  await until(
    () => app.campaigns.list(lab.id).every((c) => c.status === "completed"),
    15_000,
  );
  const sessions = new Set<string | null>();
  for (const campaign of [a, b]) {
    const detail = await app.campaigns.detail(lab.id, campaign.id);
    const tag = campaign.title;
    expect(detail.agents).toHaveLength(1);
    expect(detail.agents[0]).toMatchObject({
      campaignId: campaign.id,
      notified: true,
    });
    expect(JSON.stringify(detail.messages)).toContain(`PRIVATE-REPORT-${tag}`);
    expect(JSON.stringify(detail.messages)).not.toContain(
      `PRIVATE-REPORT-${tag === "alpha" ? "beta" : "alpha"}`,
    );
    expect(detail.campaign.sessionId).toBeTruthy();
    sessions.add(detail.campaign.sessionId);
    expect(detail.campaign.result).toBe(`Final evidence for ${tag}`);
  }
  expect(sessions.size).toBe(2);
  expect(app.subagents.list(lab.id, true)).toEqual([]);
  expect(app.campaigns.list(lab.id, true)).toEqual([]);
  await until(async () =>
    JSON.stringify(await app.sessions.messages(lab.id)).includes(
      "Final evidence for beta",
    ),
  );
  expect(fake.requests.filter(coordinator)).toHaveLength(4);
}, 25_000);

test("campaign budget includes workers, blocks further requests and resumes the same session with additional budget", async () => {
  fake = startFakeModel((req) => {
    if (worker(req)) return { text: "PAID-WORKER-RESULT" };
    if (!coordinator(req)) return { text: "Pico reports the decision." };
    if (text(req).includes("PAID-WORKER-RESULT"))
      return progress({
        action: "complete",
        result: "Delivered after budget extension",
      });
    return {
      toolCalls: [
        {
          name: pico("run_subagent"),
          arguments: { agent_id: "bibliography", task: "Research paid scope" },
        },
        { name: pico("campaign_progress"), arguments: { action: "wait" } },
      ],
    };
  });
  const { app, lab } = await setup(true);
  app.campaigns.configure({ budgetUsd: 0.2 });
  const campaign = app.campaigns.start(lab, input());
  await app.campaigns.poll();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "pending",
  );
  await until(() => app.subagents.list(lab.id).every((run) => run.notified));
  const pending = app.campaigns.get(lab.id, campaign.id);
  expect(pending.reason).toBe("budget");
  expect(pending.usage.cost).toBeCloseTo(2 * perCall, 3);
  const count = fake.requests.filter(
    (req) => coordinator(req) || worker(req),
  ).length;
  await app.campaigns.poll();
  expect(
    fake.requests.filter((req) => coordinator(req) || worker(req)),
  ).toHaveLength(count);
  await expect(
    app.campaigns.control(lab.id, campaign.id, { action: "resume" }),
  ).rejects.toThrow("budget");
  await app.campaigns.control(lab.id, campaign.id, {
    action: "resume",
    addBudgetUsd: 1,
  });
  await app.campaigns.poll();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "completed",
  );
  // Claude Code reports a turn's cost with its result, after the tools ran.
  await until(() => !app.campaigns.get(lab.id, campaign.id).isWorking);
  const completed = app.campaigns.get(lab.id, campaign.id);
  expect(completed.budgetUsd).toBe(1.2);
  expect(completed.sessionId).toBe(pending.sessionId);
  expect(completed.usage.cost).toBeCloseTo(3 * perCall, 3);
}, 20_000);

test("Pico coordinates the shared editor and hands real reviewed pages back to the waiting campaign", async () => {
  let editorTurn = 0;
  let campaignId = "";
  fake = startFakeModel((req) => {
    if (worker(req)) {
      editorTurn++;
      if (editorTurn === 1)
        return {
          toolCalls: [
            {
              name: pico("save_page"),
              arguments: {
                title: "Campaign synthesis",
                body: "Evidence is inconclusive; the comparison needs additional measurements.",
                placement: "panorama",
              },
            },
          ],
        };
      const page = app.records.list(lab.id, { kind: "page" })[0];
      if (!page) throw new Error("Editor did not save the page");
      if (editorTurn === 2)
        return {
          toolCalls: [
            {
              name: pico("review_pages"),
              arguments: {
                pages: [
                  {
                    id: page.id,
                    revision: page.revision,
                    summary: "Explained the current evidence and limitations",
                  },
                ],
              },
            },
          ],
        };
      return { text: `EDITORIAL-DONE ${page.id}` };
    }
    if (coordinator(req)) {
      if (text(req).includes("EDITORIAL-READY"))
        return progress({
          action: "complete",
          result: `Reviewed research page: ${app.records.list(lab.id, { kind: "page" })[0]?.id}`,
        });
      return progress({
        action: "wait_for_pico",
        summary:
          "EDITORIAL-REQUEST: Please prepare and review the campaign synthesis page.",
      });
    }
    if (text(req).includes("EDITORIAL-READY"))
      return { text: "Pico integrated the completed campaign." };
    if (text(req).includes("EDITORIAL-DONE"))
      return {
        toolCalls: [
          {
            name: pico("message_campaign"),
            arguments: {
              id: campaignId,
              message: `EDITORIAL-READY ${app.records.list(lab.id, { kind: "page" })[0]?.id}. Page coverage inspected; no outstanding issues.`,
            },
          },
        ],
      };
    if (hasToolResult(req)) return { text: "The shared editor is working." };
    return {
      toolCalls: [
        {
          name: pico("run_subagent"),
          arguments: {
            agent_id: "research-editor",
            task: `Prepare the synthesis page for campaign ${campaignId}, and acknowledge its review.`,
          },
        },
      ],
    };
  });
  const { app, lab } = await setup();
  await app.catalog.configure("research-editor", {
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  const campaign = app.campaigns.start(lab, input());
  campaignId = campaign.id;
  await app.campaigns.poll();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "completed",
  );
  expect(app.subagents.list(lab.id)).toHaveLength(1);
  expect(app.subagents.list(lab.id)[0]).toMatchObject({
    agentId: "research-editor",
    campaignId: null,
    notified: true,
  });
  expect(app.editorial.status(lab).needsReview).toBe(false);
  expect(app.campaigns.get(lab.id, campaign.id).context).toContain(
    "EDITORIAL-READY",
  );
  expect(app.campaigns.get(lab.id, campaign.id).result).toContain(
    app.records.list(lab.id, { kind: "page" })[0]?.id ?? "missing",
  );
}, 15_000);

test("Pico's direction arriving during a turn is durable, and messages never override a researcher pause", async () => {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fake = startFakeModel(async (req) => {
    if (!coordinator(req)) return { text: "Pico recorded the request." };
    if (text(req).includes("DURABLE-DIRECTION"))
      return progress({
        action: "complete",
        result: "Integrated the new direction",
      });
    started = true;
    await gate;
    return progress({
      action: "wait_for_pico",
      summary: "Please provide direction",
    });
  });
  const { app, lab } = await setup();
  const campaign = app.campaigns.start(lab, input());
  await app.campaigns.poll();
  await until(() => started);
  await call(app, `/labs/${lab.id}/campaigns/${campaign.id}/message`, {
    body: { message: "DURABLE-DIRECTION: use the revised evidence" },
  });
  release();
  await until(
    () => app.campaigns.get(lab.id, campaign.id).status === "completed",
  );
  const paused = app.campaigns.start(lab, input("paused"));
  await app.campaigns.control(lab.id, paused.id, { action: "pause" });
  app.campaigns.message(
    lab.id,
    paused.id,
    "DURABLE-DIRECTION: keep this for later",
  );
  const count = fake.requests.filter(coordinator).length;
  await app.campaigns.poll();
  expect(fake.requests.filter(coordinator)).toHaveLength(count);
  expect(app.campaigns.get(lab.id, paused.id).status).toBe("paused");
  expect(app.campaigns.get(lab.id, paused.id).context).toContain(
    "keep this for later",
  );
}, 15_000);

test("capacity limits count parallel instances and wait without a user decision", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fake = startFakeModel(async (req) => {
    if (worker(req)) {
      await gate;
      return { text: "Capacity released" };
    }
    if (!coordinator(req)) return { text: "Recorded" };
    // A coordinator that wakes before its specialist returns waits for it.
    return text(req).includes("Capacity released")
      ? progress({ action: "complete", result: "Reconciled capacity results" })
      : progress({ action: "wait" });
  });
  const { app, lab } = await setup();
  app.campaigns.configure({ maxAgents: 1, labMaxAgents: 2 });
  const a = app.campaigns.start(lab, input());
  const b = app.campaigns.start(lab, input("beta"));
  app.subagents.start(lab, "bibliography", "A", a.id);
  expect(() => app.subagents.start(lab, "bibliography", "A2", a.id)).toThrow(
    "capacity",
  );
  expect(app.campaigns.get(lab.id, a.id)).toMatchObject({
    status: "waiting",
    reason: "capacity",
  });
  app.subagents.start(lab, "bibliography", "B", b.id);
  expect(() => app.subagents.start(lab, "bibliography", "Standalone")).toThrow(
    "capacity",
  );
  await until(() => fake?.requests.filter(worker).length === 2);
  release();
  await until(() => app.subagents.list(lab.id).every((run) => run.notified));
  await app.campaigns.poll();
  await until(() => app.campaigns.get(lab.id, a.id).status === "completed");
  expect(app.subagents.list(lab.id)).toHaveLength(2);
}, 20_000);

test("paused and pending campaigns survive restart, and closing running jobs requires an explicit choice", async () => {
  fake = startFakeModel((req) =>
    coordinator(req)
      ? progress({
          action: "needs_input",
          summary: "Which dataset should be used?",
        })
      : { text: "Decision recorded" },
  );
  const { app, lab } = await setup();
  const paused = app.campaigns.start(lab, input());
  const job = await app.jobs.start(lab, {
    command: "sleep 30",
    campaignId: paused.id,
  });
  await expect(
    app.campaigns.control(lab.id, paused.id, { action: "end" }),
  ).rejects.toThrow("keep or stop");
  await app.campaigns.control(lab.id, paused.id, { action: "pause" });
  const pending = app.campaigns.start(lab, input("beta"));
  await app.campaigns.poll();
  await until(() => app.campaigns.get(lab.id, pending.id).status === "pending");
  await app.close();
  const restarted = createApp(app.paths);
  try {
    const count = fake.requests.filter(coordinator).length;
    await restarted.campaigns.poll();
    expect(restarted.campaigns.get(lab.id, paused.id).status).toBe("paused");
    expect(restarted.campaigns.get(lab.id, pending.id)).toMatchObject({
      status: "pending",
      reason: "input",
    });
    expect(restarted.jobs.get(lab.id, job.id).status).toBe("running");
    expect(fake.requests.filter(coordinator)).toHaveLength(count);
    await restarted.campaigns.control(lab.id, paused.id, {
      action: "end",
      jobs: "stop",
    });
    expect(restarted.jobs.get(lab.id, job.id).status).toBe("stopped");
    expect(restarted.campaigns.get(lab.id, paused.id).status).toBe("ended");
  } finally {
    await restarted.close();
  }
}, 20_000);

test("a campaign resumes its persisted job outcome after restart without launching the experiment twice", async () => {
  fake = startFakeModel((req) => {
    if (worker(req)) {
      if (!hasToolResult(req))
        return {
          toolCalls: [
            {
              name: pico("run_job"),
              arguments: {
                name: "Persistent experiment",
                command:
                  "while [ ! -f release-experiment ]; do sleep 0.05; done; echo experiment-finished",
              },
            },
          ],
        };
      return { text: "Experiment started; the detached job is still running." };
    }
    if (!coordinator(req)) return { text: "Pico integrated the final result." };
    if (
      text(req).includes("experiment-finished") &&
      text(req).includes("finished: succeeded")
    )
      return progress({
        action: "complete",
        result: "Actual experiment output inspected",
      });
    if (text(req).includes("Experiment started"))
      return progress({
        action: "wait",
        activity: "Waiting for the existing experiment",
      });
    return {
      toolCalls: [
        {
          name: pico("run_subagent"),
          arguments: {
            agent_id: "experimentation",
            task: "Run the persistent experiment",
          },
        },
        { name: pico("campaign_progress"), arguments: { action: "wait" } },
      ],
    };
  });
  const { app, lab } = await setup();
  const campaign = app.campaigns.start(lab, input());
  await app.campaigns.poll();
  await until(
    () =>
      app.campaigns.get(lab.id, campaign.id).activity ===
      "Waiting for the existing experiment",
  );
  const sessionId = app.campaigns.get(lab.id, campaign.id).sessionId;
  expect(sessionId).toBeTruthy();
  const job = app.jobs.list(lab.id)[0];
  if (!job) throw new Error("The experiment did not create its job");
  expect(job?.campaignId).toBe(campaign.id);
  expect(job?.pid && processAlive(job.pid)).toBe(true);
  await app.close();
  const restarted = createApp(app.paths);
  try {
    expect(restarted.jobs.list(lab.id)).toHaveLength(1);
    expect(restarted.jobs.get(lab.id, job.id).pid).toBe(job.pid);
    writeFileSync(join(lab.path, "release-experiment"), "continue");
    await until(
      () => restarted.campaigns.get(lab.id, campaign.id).status === "completed",
    );
    expect(restarted.campaigns.get(lab.id, campaign.id).sessionId).toBe(
      sessionId,
    );
    expect(restarted.subagents.list(lab.id)).toHaveLength(1);
    expect(restarted.jobs.list(lab.id)).toHaveLength(1);
    expect(restarted.jobs.get(lab.id, job.id)).toMatchObject({
      status: "succeeded",
      notified: true,
    });
    const receipts = (
      await restarted.campaigns.detail(lab.id, campaign.id)
    ).messages.filter(
      (message) =>
        message.kind === "campaign-result" && message.text.includes(job.id),
    );
    expect(receipts).toHaveLength(1);
  } finally {
    if (restarted.jobs.get(lab.id, job.id).status === "running")
      await restarted.jobs.stop(lab.id, job.id, { notify: false });
    await restarted.close();
  }
}, 20_000);

test("active coordinators recover their plan after interruption, while kept jobs stay independent of campaign closure", async () => {
  let working = false;
  fake = startFakeModel(async (req) => {
    if (!coordinator(req)) return { text: "Pico recorded the change." };
    if (!text(req).includes("Persisted plan"))
      return progress({ plan: "Persisted plan", action: "continue" });
    if (!working) {
      working = true;
      await new Promise<void>(() => {});
    }
    return progress({
      action: "complete",
      result: "Resumed the persisted plan",
    });
  });
  const { app, lab } = await setup();
  const campaign = app.campaigns.start(lab, input());
  await app.campaigns.poll();
  await until(() => working);
  const sessionId = app.campaigns.get(lab.id, campaign.id).sessionId;
  expect(sessionId).toBeTruthy();
  await app.close();
  const restarted = createApp(app.paths);
  try {
    await restarted.campaigns.poll();
    await until(
      () => restarted.campaigns.get(lab.id, campaign.id).status === "completed",
    );
    expect(restarted.campaigns.get(lab.id, campaign.id)).toMatchObject({
      plan: "Persisted plan",
      sessionId,
    });
    const kept = restarted.campaigns.start(lab, input("kept"));
    const job = await restarted.jobs.start(lab, {
      campaignId: kept.id,
      command: "sleep 30",
    });
    try {
      await restarted.campaigns.control(lab.id, kept.id, {
        action: "end",
        jobs: "keep",
      });
      expect(restarted.campaigns.get(lab.id, kept.id).status).toBe("ended");
      expect(restarted.jobs.get(lab.id, job.id).status).toBe("running");
      expect(job.pid && processAlive(job.pid)).toBe(true);
    } finally {
      await restarted.jobs.stop(lab.id, job.id, { notify: false });
    }
  } finally {
    await restarted.close();
  }
}, 20_000);
