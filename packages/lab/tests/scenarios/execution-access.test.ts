import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLabRuntime, type LabRuntime } from "@pico/lab";
import type { MutationContext, Run } from "@pico/lab/contracts";

const intent = (): MutationContext => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" },
});
const probe =
  'import json,os\nprint(json.dumps({"pico":bool(os.environ.get("PICO_PI_AGENT_DIR")),"pi":bool(os.environ.get("PI_CODING_AGENT_DIR"))}))';
async function waitFor(
  runtime: LabRuntime,
  labId: string,
  runId: string,
  terminal = true,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const run = runtime.research.getRecord<Run>(labId, "run", runId);
    if (
      terminal
        ? !["queued", "running"].includes(run.status)
        : run.status === "running"
    )
      return run;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Execution did not reach the expected state");
}

test("public runtime withholds profile bindings unless the researcher explicitly opts in", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-execution-access-"));
  const runtime = createLabRuntime({
    dataDir: root,
    model: async () => ({
      content: "Observed execution completion (simulated model).",
      calls: [],
    }),
  });
  try {
    await runtime.start();
    const lab = runtime.research.createLab({
      name: "Profile bindings",
      settings: { executionEnabled: true },
    });
    const question = runtime.research.createQuestion(
      lab.id,
      { text: "Are bindings explicitly selected?" },
      intent(),
    );
    const experiment = runtime.research.createExperiment(
      lab.id,
      {
        title: "Environment probe",
        objective: "Read presence only",
        questionIds: [question.id],
        protocol: "Print booleans, never credential values",
      },
      intent(),
    );
    await runtime.research.writeFile(
      lab.id,
      experiment.id,
      { path: experiment.entrypoint, content: probe },
      intent(),
    );
    const ordinary = await runtime.research.startRun(
      lab.id,
      experiment.id,
      {},
      intent(),
    );
    expect((await waitFor(runtime, lab.id, ordinary.id)).status).toBe(
      "succeeded",
    );
    expect(
      JSON.parse((await runtime.research.readLogs(lab.id, ordinary.id)).stdout),
    ).toEqual({ pico: false, pi: false });
    expect(() =>
      runtime.research.reviseExperiment(
        lab.id,
        experiment.id,
        { executionAccess: { piProfile: true } },
        { ...intent(), actor: { kind: "pico" } },
      ),
    ).toThrow("Only the researcher");
    runtime.research.reviseExperiment(
      lab.id,
      experiment.id,
      { executionAccess: { piProfile: true } },
      intent(),
    );
    const selected = await runtime.research.startRun(
      lab.id,
      experiment.id,
      {},
      intent(),
    );
    const completed = await waitFor(runtime, lab.id, selected.id);
    expect(completed.status).toBe("succeeded");
    expect(
      JSON.parse((await runtime.research.readLogs(lab.id, selected.id)).stdout),
    ).toEqual({ pico: true, pi: true });
    expect(JSON.stringify(completed.snapshot)).not.toContain(
      "PICO_PI_AGENT_DIR",
    );
    expect(JSON.stringify(completed.snapshot)).not.toContain(join(root, "pi"));
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

test("startup keeps scientific projection corruption visible and blocked until provenance is restored", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-projection-diagnosis-"));
  const options = {
    dataDir: root,
    model: async () => ({ content: "Observed (simulated model).", calls: [] }),
  };
  let runtime = createLabRuntime(options);
  try {
    await runtime.start();
    const lab = runtime.research.createLab({
      name: "Projection diagnosis",
      settings: { executionEnabled: true },
    });
    const question = runtime.research.createQuestion(
      lab.id,
      { text: "Can corruption be diagnosed after restart?" },
      intent(),
    );
    const experiment = runtime.research.createExperiment(
      lab.id,
      {
        title: "Preserved provenance",
        objective: "Restart safely",
        questionIds: [question.id],
        protocol: "Print a constant",
      },
      intent(),
    );
    await runtime.research.writeFile(
      lab.id,
      experiment.id,
      { path: experiment.entrypoint, content: "print('done')" },
      intent(),
    );
    const run = await runtime.research.startRun(
      lab.id,
      experiment.id,
      {},
      intent(),
    );
    await waitFor(runtime, lab.id, run.id);
    await runtime.close();
    const provenance = join(
      root,
      "labs",
      lab.id,
      "run-records",
      `${run.id}.json`,
    );
    const original = await readFile(provenance);
    await writeFile(provenance, "damaged scientific record");
    runtime = createLabRuntime(options);
    await runtime.start();
    expect(runtime.state).toBe("active");
    const diagnosis = await runtime.administration.executionStatus(lab.id);
    expect(diagnosis.blocked).toBe(true);
    expect(diagnosis.issues).toContainEqual(
      expect.objectContaining({ runId: run.id, kind: "observation_delivery" }),
    );
    await writeFile(provenance, original);
    expect(
      (await runtime.administration.repairExecution(lab.id, run.id, intent()))
        .state,
    ).toBe("terminal");
    expect((await runtime.administration.executionStatus(lab.id)).blocked).toBe(
      false,
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

test("revoking researcher access while a run is queued prevents its profile binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-revoked-access-"));
  const runtime = createLabRuntime({
    dataDir: root,
    model: async () => ({ content: "Observed (simulated model).", calls: [] }),
  });
  let labId: string | undefined;
  let blockerId: string | undefined;
  try {
    await runtime.start();
    const lab = runtime.research.createLab({
      name: "Revoked binding",
      settings: {
        executionEnabled: true,
        maxConcurrentRuns: 1,
        maxRunSeconds: 20,
      },
    });
    labId = lab.id;
    const question = runtime.research.createQuestion(
      lab.id,
      { text: "Is dispatch authorization current?" },
      intent(),
    );
    const blocker = runtime.research.createExperiment(
      lab.id,
      {
        title: "Occupy queue",
        objective: "Hold one slot",
        questionIds: [question.id],
        protocol: "Wait until cancelled",
      },
      intent(),
    );
    await runtime.research.writeFile(
      lab.id,
      blocker.id,
      { path: blocker.entrypoint, content: "import time\ntime.sleep(15)" },
      intent(),
    );
    const active = await runtime.research.startRun(
      lab.id,
      blocker.id,
      {},
      intent(),
    );
    blockerId = active.id;
    await waitFor(runtime, lab.id, active.id, false);
    const selected = runtime.research.createExperiment(
      lab.id,
      {
        title: "Revoke before dispatch",
        objective: "Read environment presence",
        questionIds: [question.id],
        protocol: "Print booleans only",
        executionAccess: { piProfile: true },
      },
      intent(),
    );
    await runtime.research.writeFile(
      lab.id,
      selected.id,
      { path: selected.entrypoint, content: probe },
      intent(),
    );
    const queued = await runtime.research.startRun(
      lab.id,
      selected.id,
      {},
      intent(),
    );
    expect(
      runtime.research.getRecord<Run>(lab.id, "run", queued.id).status,
    ).toBe("queued");
    runtime.research.reviseExperiment(
      lab.id,
      selected.id,
      { executionAccess: { piProfile: false } },
      intent(),
    );
    await runtime.research.cancelRun(lab.id, active.id, intent());
    await waitFor(runtime, lab.id, active.id);
    blockerId = undefined;
    expect((await waitFor(runtime, lab.id, queued.id)).status).toBe(
      "succeeded",
    );
    expect(
      JSON.parse((await runtime.research.readLogs(lab.id, queued.id)).stdout),
    ).toEqual({ pico: false, pi: false });
  } finally {
    if (labId && blockerId && runtime.state === "active") {
      await runtime.research.cancelRun(labId, blockerId, intent());
      await waitFor(runtime, labId, blockerId);
    }
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
