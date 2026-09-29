import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerApplication } from "@pico/server";
import { durableRecords } from "./durable-records";

test("Pi catalog, saved lab settings and provider status share the existing credential configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-pi-api-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      zai: { type: "api_key", key: "fixture-private-pi-key" },
    }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "zai",
      defaultModel: "glm-5.3",
      defaultThinkingLevel: "max",
    }),
  );
  const app = await createServerApplication({
    dataDir: join(root, "data"),
    piAgentDir: agentDir,
  });
  const request = (path: string, body?: unknown) =>
    new Request(
      `http://127.0.0.1:4317/api${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify(body),
          },
    );
  try {
    const catalogResponse = await app.fetch(request("/providers"));
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.defaultSelection).toEqual({
      provider: "zai",
      model: "glm-5.3",
      thinking: "max",
    });
    expect(JSON.stringify(catalog)).not.toContain("fixture-private-pi-key");
    const created = await app.fetch(
      request("/labs", {
        name: "Pi laboratory",
        settings: { provider: { mode: "pi", ...catalog.defaultSelection } },
      }),
    );
    expect(created.status).toBe(201);
    const lab = await created.json();
    const status = await (
      await app.fetch(request(`/labs/${lab.id}/provider`))
    ).json();
    expect(status.configured).toBe(true);
    expect(status.mode).toBe("pi");
    expect(status.detail).toContain("next inference");
    const checked = await (
      await app.fetch(request(`/labs/${lab.id}/provider/test`, {}))
    ).json();
    expect(checked).toEqual(status);
    expect(JSON.stringify(app.runtime.research.listLabs())).not.toContain(
      "fixture-private-pi-key",
    );
    expect(durableRecords(join(root, "data"), "model_step")).toHaveLength(0);
    const invalid = await app.fetch(
      request("/labs", {
        name: "Missing provider",
        settings: { provider: { mode: "pi" } },
      }),
    );
    expect(invalid.status).toBe(400);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
