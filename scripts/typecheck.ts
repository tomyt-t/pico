import { fileURLToPath } from "node:url";

const projects = [
  "packages/runner/tsconfig.json",
  "packages/lab/tsconfig.json",
  "apps/server/tsconfig.json",
  "apps/web/tsconfig.json",
  "apps/web/tests/tsconfig.json",
  "tests/architecture/browser-contracts/tsconfig.json",
  "tests/architecture/browser-web/tsconfig.json",
  "tsconfig.json",
];

for (const project of projects) {
  const child = Bun.spawn(
    [process.execPath, "x", "--no-install", "tsc", "-p", project],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const status = await child.exited;
  if (status !== 0) process.exit(status);
}
