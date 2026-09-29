import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MutationContext } from "@/lab/contracts";
import { createLaboratory } from "@/lab/research/laboratory";
import { ResearchOperations } from "@/lab/research/operations";
import { ResearchBackup } from "@/lab/storage/backup";
import { createStorage, type Storage } from "@/lab/storage/storage";
import { createRunner } from "../support/scientific-runner";

function intent(key: string): MutationContext {
  return { key, actor: { kind: "researcher" } };
}

test("backs up and restores a completed uv experiment without copying its disposable virtual environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-backup-uv-"));
  const store = createStorage(join(root, "data"));
  const lab = createLaboratory(store);
  const laboratory = lab.createLab({
    name: "Dependency preservation",
    settings: { executionEnabled: true },
  });
  const question = lab.createQuestion(
    laboratory.id,
    { text: "Are dependency snapshots durable?" },
    intent("question"),
  );
  const experiment = lab.createExperiment(
    laboratory.id,
    {
      title: "Frozen environment",
      objective: "Validate backup after uv execution",
      protocol: "Resolve and execute a minimal dependency-free uv project",
      runtime: "uv",
      questionIds: [question.id],
    },
    intent("experiment"),
  );
  let operations: ResearchOperations | undefined;
  const runner = await createRunner({
    dataDir: store.dataDir,
    onUpdate: (run) => {
      operations?.acceptRun(run);
    },
  });
  operations = new ResearchOperations(lab, store, runner);
  let restored: Storage | undefined;
  try {
    await runner.writeFile(laboratory.id, experiment.id, {
      path: "experiment.py",
      content: "print('measured in uv')",
    });
    await runner.writeFile(laboratory.id, experiment.id, {
      path: "pyproject.toml",
      content:
        '[project]\nname = "pico-backup-scenario"\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = []\n',
    });
    await runner.lockDependencies(laboratory.id, experiment.id);
    const submitted = await operations.startRun(
      laboratory.id,
      experiment.id,
      {},
      intent("run"),
    );
    const finished = await runner.waitForRun(laboratory.id, submitted.id);
    operations.acceptRun(finished);
    expect(finished.status).toBe("succeeded");
    const backup = store.backup.create(join(root, "backup"));
    ResearchBackup.restore(backup, join(root, "restored"));
    restored = createStorage(join(root, "restored"));
    const restoredLab = createLaboratory(restored);
    expect(
      restoredLab.experimentDetail(laboratory.id, experiment.id).runs[0]
        ?.snapshot,
    ).toEqual(finished.snapshot);
    const reopened = await createRunner({ dataDir: restored.dataDir });
    try {
      expect(
        (
          await reopened.readRunFile(
            laboratory.id,
            finished.id,
            "code",
            "uv.lock",
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(
        (await reopened.readLogs(laboratory.id, finished.id)).stdout,
      ).toContain("measured in uv");
    } finally {
      await reopened.close();
    }
  } finally {
    await runner.close();
    restored?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
