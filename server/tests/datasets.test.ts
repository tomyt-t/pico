import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestOf, registerDataset } from "../src/datasets";
import { type Sandbox, sandbox } from "./support";

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.cleanup();
  box = undefined;
});

test("register_dataset hashes a folder and records it", async () => {
  box = sandbox();
  const { app } = box;
  const lab = await app.labs.create({ name: "Dados" });
  const dir = join(lab.path, "data", "matches");
  mkdirSync(join(dir, "2024"), { recursive: true });
  writeFileSync(join(dir, "2024", "games.csv"), "home,away,score\nA,B,1-0\n");
  writeFileSync(join(dir, "README.md"), "Partidas");
  const manifest = await manifestOf(dir);
  expect(manifest.map((entry) => entry.path)).toEqual([
    "2024/games.csv",
    "README.md",
  ]);
  expect(manifest[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

  const record = await registerDataset(
    lab,
    app.records,
    {
      name: "Partidas",
      path: "data/matches",
      source: "football-data",
      license: "CC-BY",
    },
    "pico",
  );
  expect(record.kind).toBe("dataset");
  expect(record.fields).toMatchObject({
    path: "data/matches",
    files: 2,
    bytes: manifest.reduce((sum, entry) => sum + entry.bytes, 0),
    source: "football-data",
    manifest: `.pico/datasets/${record.id}.json`,
  });
  const again = await registerDataset(
    lab,
    app.records,
    { name: "Partidas v2", path: dir },
    "pico",
  );
  expect(again.fields.sha256).toBe(record.fields.sha256);
  await expect(
    registerDataset(
      lab,
      app.records,
      { name: "Missing", path: "data/none" },
      "pico",
    ),
  ).rejects.toThrow("does not exist");
});
