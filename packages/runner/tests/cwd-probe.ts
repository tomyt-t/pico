import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRunner, fileAccess } from "@pico/runner";

const root = process.argv[2];
if (!root) throw new Error("Expected probe data directory");
const workspaceDir = join(root, "source");
await mkdir(workspaceDir, { recursive: true });
await fileAccess.writeBytes(workspaceDir, "main.py", 'print("external cwd")');
const runner = createRunner({ dataDir: root, pollMs: 30 });
await runner.start();
try {
  await runner.submit(
    {
      runId: "r",
      labId: "l",
      experimentId: "e",
      protocol: "cwd probe",
      config: {},
      entrypoint: "main.py",
      timeoutMs: 3000,
    },
    { workspaceDir, datasets: [] },
  );
  await runner.resumeDispatch();
  const run = await runner.waitForRun("l", "r");
  console.info(
    JSON.stringify({
      status: run.status,
      stdout: (await runner.readLogs("l", "r")).stdout,
    }),
  );
} finally {
  await runner.close();
}
