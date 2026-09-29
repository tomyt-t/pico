import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner } from "@pico/runner";
import type { MutationContext } from "@/lab/contracts";
import {
  createLaboratory,
  createResearch,
  createResearchOperations,
  ResearchExecution,
} from "@/lab/research/laboratory";
import type { ResearchOperations } from "@/lab/research/operations";
import { createStorage } from "@/lab/storage/storage";

const intent = (key: string): MutationContext => ({
  key,
  actor: { kind: "researcher" },
});

test("a durable submission survives projection failure and restart without another identity or execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-projection-recovery-"));
  let storage = createStorage(root);
  let operations: ResearchOperations | undefined;
  let runner = await createRunner({
    dataDir: root,
    onUpdate: (record) => operations?.acceptObservation(record),
  });
  try {
    let lab = createLaboratory(storage);
    let execution = new ResearchExecution(storage.files, runner);
    operations = createResearchOperations(lab, storage, execution);
    const laboratory = lab.createLab({
      name: "Projection recovery",
      settings: { executionEnabled: true },
    });
    const question = lab.createQuestion(
      laboratory.id,
      { text: "Does an interrupted projection preserve one attempt?" },
      intent("question"),
    );
    const experiment = lab.createExperiment(
      laboratory.id,
      {
        title: "One process",
        objective: "Recover",
        questionIds: [question.id],
        protocol: "Append one line in output",
      },
      intent("experiment"),
    );
    await operations.workspace.writeFile(
      laboratory.id,
      experiment.id,
      {
        path: "experiment.py",
        content:
          "import os\nfrom pathlib import Path\nwith Path(os.environ['PICO_OUTPUT_DIR'], 'executions.txt').open('a') as output: output.write('executed\\n')\n",
      },
      intent("code"),
    );
    await runner.start();
    const originalUpdate = lab.updateRun;
    lab.updateRun = () => {
      throw new Error("Injected SQLite projection failure");
    };
    await expect(
      operations.startRun(
        laboratory.id,
        experiment.id,
        {},
        intent("submit-once"),
      ),
    ).rejects.toThrow("projection failure");
    lab.updateRun = originalUpdate;
    const durable = await runner.allRuns();
    expect(durable).toHaveLength(1);
    const id = durable[0]?.id;
    if (!id) throw new Error("Missing durable attempt");
    expect(storage.operations.pendingEffects()).toHaveLength(1);
    expect(lab.getRecord(laboratory.id, "run", id)).toMatchObject({
      id,
      status: "queued",
    });
    await runner.close();
    storage.close();
    storage = createStorage(root);
    lab = createLaboratory(storage);
    runner = await createRunner({
      dataDir: root,
      onUpdate: (record) => operations?.acceptObservation(record),
    });
    execution = new ResearchExecution(storage.files, runner);
    operations = createResearchOperations(lab, storage, execution);
    await runner.start();
    await operations.reconcile();
    const recovered = await operations.startRun(
      laboratory.id,
      experiment.id,
      {},
      intent("submit-once"),
    );
    expect(recovered.id).toBe(id);
    expect(storage.operations.pendingEffects()).toHaveLength(0);
    await runner.resumeDispatch();
    const completed = await execution.waitForRun(laboratory.id, id);
    await operations.reconcile();
    expect(completed.status).toBe("succeeded");
    expect(
      (
        await execution.readRunFile(
          laboratory.id,
          id,
          "outputs",
          "executions.txt",
        )
      ).toString(),
    ).toBe("executed\n");
    expect(
      lab.experimentDetail(laboratory.id, experiment.id).runs,
    ).toHaveLength(1);
    expect(storage.conversation.consumeCompletionEvents()).toHaveLength(1);
    expect(storage.conversation.consumeCompletionEvents()).toHaveLength(0);
    const publicResearch = createResearch({ lab, operations, execution });
    expect("createRun" in publicResearch).toBe(false);
    expect("updateRun" in publicResearch).toBe(false);
  } finally {
    await runner.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
