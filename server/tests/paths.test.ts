import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveUserPath } from "../src/paths";

test("paths expand ~ and hang relative paths off the laboratory", () => {
  expect(resolveUserPath("/labs/x", "~/salab/data")).toBe(
    join(homedir(), "salab", "data"),
  );
  expect(resolveUserPath("/labs/x", "~")).toBe(homedir());
  expect(resolveUserPath("/labs/x", "data/raw")).toBe("/labs/x/data/raw");
  expect(resolveUserPath("/labs/x", "/abs/path")).toBe("/abs/path");
  expect(resolveUserPath("/labs/x", " experiments/a ")).toBe(
    "/labs/x/experiments/a",
  );
});
