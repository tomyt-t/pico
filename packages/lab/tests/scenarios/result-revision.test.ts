import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerApplication } from "@pico/server";
import type { MutationContext, Result } from "@/lab/contracts";
import { createTools } from "@/lab/pico/tools/catalog";
import { createLaboratory } from "@/lab/research/laboratory";
import { createStorage } from "@/lab/storage/storage";

const context = (): MutationContext => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" },
});

test("result corrections preserve run evidence, authored history and retry identity across API and tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pico-result-revision-"));
  const storage = createStorage(directory);
  const setup = createLaboratory(storage);
  let app: Awaited<ReturnType<typeof createServerApplication>> | undefined;
  try {
    const lab = setup.createLab({ name: "Scientific corrections" });
    const other = setup.createLab({ name: "Other laboratory" });
    const question = setup.createQuestion(
      lab.id,
      { text: "What did the pilot show?" },
      context(),
    );
    const experiment = setup.createExperiment(
      lab.id,
      {
        title: "Pilot",
        objective: "Validate evidence handling",
        protocol: "Synthetic test observations",
        questionIds: [question.id],
      },
      context(),
    );
    const run = setup.createRun(
      lab.id,
      { experimentId: experiment.id },
      context(),
    );
    setup.updateRun(
      lab.id,
      run.id,
      {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: "Synthetic test failure",
      },
      context(),
    );
    const original = setup.recordResult(
      lab.id,
      {
        experimentId: experiment.id,
        runIds: [run.id],
        observations: "Execution failed before observation.",
        interpretation: "No preregistered measure changed.",
        limitations: "No completed inference.",
      },
      context(),
    );
    storage.close();
    const server = await createServerApplication({
      dataDir: directory,
      model: async () => ({
        content: "Simulated failure inspection",
        calls: [],
      }),
    });
    app = server;
    const patch = {
      interpretation:
        "The failed execution provides no comparison of preregistered measures.",
      reason: "Correct unsupported stability claim",
    };
    const key = crypto.randomUUID();
    async function revise(
      body: unknown,
      mutationKey = crypto.randomUUID(),
      labId = lab.id,
    ) {
      return server.fetch(
        new Request(
          `http://127.0.0.1:4317/api/labs/${labId}/results/${original.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": mutationKey,
            },
            body: JSON.stringify(body),
          },
        ),
      );
    }
    const first = await revise(patch, key);
    expect(first.status).toBe(200);
    const corrected = (await first.json()) as Result;
    expect(corrected).toMatchObject({
      id: original.id,
      experimentId: experiment.id,
      runIds: [run.id],
      revision: 2,
      observations: original.observations,
      interpretation: patch.interpretation,
      limitations: original.limitations,
      author: original.author,
    });
    expect(await (await revise(patch, key)).json()).toEqual(corrected);
    expect(
      (await revise({ ...patch, interpretation: "Different mutation" }, key))
        .status,
    ).toBe(409);
    for (const invalid of [
      { experimentId: "other-experiment" },
      { runIds: [] },
    ]) {
      expect(
        (await revise({ ...invalid, reason: "Attempt to replace evidence" }))
          .status,
      ).toBe(400);
    }
    expect((await revise(patch, crypto.randomUUID(), other.id)).status).toBe(
      404,
    );
    expect(server.runtime.research.history(lab.id, original.id)).toHaveLength(
      1,
    );
    expect(
      server.runtime.research.history(lab.id, original.id)[0],
    ).toMatchObject({
      snapshot: original,
      reason: patch.reason,
      author: { kind: "researcher" },
    });

    const tool = createTools(server.runtime.research, lab.id).get(
      "revise_result",
    );
    if (!tool) throw new Error("revise_result is missing from Pico's tools");
    const toolContext: MutationContext = {
      key: crypto.randomUUID(),
      actor: { kind: "pico", turnId: "correction-turn" },
    };
    const toolInput = {
      id: original.id,
      patch: {
        limitations:
          "A failed run cannot establish stability or defense efficacy.",
      },
      reason: "Clarify evidentiary limitation",
    };
    const updated = (await tool.execute(toolInput, toolContext)) as Result;
    expect(await tool.execute(toolInput, toolContext)).toEqual(updated);
    expect(updated).toMatchObject({
      revision: 3,
      experimentId: experiment.id,
      runIds: [run.id],
      interpretation: patch.interpretation,
    });
    const history = server.runtime.research.history(lab.id, original.id);
    expect(history).toHaveLength(2);
    expect(
      history.find((revision) => revision.snapshot.revision === 2),
    ).toMatchObject({
      snapshot: corrected,
      reason: toolInput.reason,
      author: toolContext.actor,
    });
    await expect(
      tool.execute({ ...toolInput, patch: { runIds: [] } }, context()),
    ).rejects.toThrow();
    expect(
      server.runtime.research.getRecord<Result>(lab.id, "result", original.id),
    ).toEqual(updated);
    expect(server.runtime.research.history(lab.id, original.id)).toHaveLength(
      2,
    );
    expect(
      server.runtime.research
        .overview(lab.id)
        .events.filter((event) => event.kind === "result_revised"),
    ).toHaveLength(2);
  } finally {
    await app?.close();
    try {
      storage.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
