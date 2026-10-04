import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveUserPath } from "../src/paths";

test("paths expand ~ and hang relative paths off the laboratory", () => {
  // An absolute laboratory folder on this system ("C:\labs\x" on Windows).
  const lab = resolve("/labs/x");
  expect(resolveUserPath(lab, "~/salab/data")).toBe(
    join(homedir(), "salab", "data"),
  );
  expect(resolveUserPath(lab, "~")).toBe(homedir());
  expect(resolveUserPath(lab, "data/raw")).toBe(join(lab, "data", "raw"));
  expect(resolveUserPath(lab, "/abs/path")).toBe("/abs/path");
  expect(resolveUserPath(lab, " experiments/a ")).toBe(
    join(lab, "experiments", "a"),
  );
});
