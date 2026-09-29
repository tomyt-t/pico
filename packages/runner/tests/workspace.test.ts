import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fixture } from "./support";

afterEach(cleanup);
test("package and both subprocess entrypoints run from outside the repository", async () => {
  const f = await fixture();
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./cwd-probe.ts", import.meta.url)),
      join(f.root, "external-runtime"),
    ],
    {
      cwd: f.root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  expect(error).toBe("");
  expect(await child.exited).toBe(0);
  expect(JSON.parse(output)).toEqual({
    status: "succeeded",
    stdout: "external cwd\n",
  });
});
