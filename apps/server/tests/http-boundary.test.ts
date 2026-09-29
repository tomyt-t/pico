import { expect, test } from "bun:test";
import type { LabRuntime } from "@pico/lab";
import { createApi } from "@/server/http/api";
import { requestContext } from "@/server/http/request-context";

/** These are transport tests with a stub runtime, not scientific/domain validation. */
function transport() {
  const calls: string[] = [];
  const lab = { id: "lab", name: "Synthetic lab" };
  const runtime = {
    research: {
      getLab: () => {
        calls.push("getLab");
        return lab;
      },
      labStatus: () => {
        calls.push("labStatus");
        return { lab, activeTurn: null };
      },
      overview: () => {
        calls.push("overview");
        throw new Error("Full history must not load for header polling");
      },
    },
  } as unknown as LabRuntime;
  return { fetch: createApi(runtime), calls };
}

test("header polling uses the lightweight public laboratory projection", async () => {
  const app = transport();
  const response = await app.fetch(
    new Request("http://127.0.0.1/api/labs/lab/status"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    lab: { id: "lab", name: "Synthetic lab" },
    activeTurn: null,
  });
  expect(app.calls).toEqual(["getLab", "labStatus"]);
});

test("unknown and inherited resource names do not dispatch routes", async () => {
  const app = transport();
  for (const resource of [
    "__proto__",
    "constructor",
    "status/unexpected",
    "provider/test/unexpected",
  ]) {
    const response = await app.fetch(
      new Request(`http://localhost/api/labs/lab/${resource}`),
    );
    expect(response.status).toBe(404);
  }
});

test("origin and malformed intent checks happen before laboratory access", async () => {
  const app = transport();
  for (const headers of [
    {
      Origin: "https://foreign.invalid",
      "Content-Type": "application/json",
      "Idempotency-Key": "intent",
    },
    { "Content-Type": "application/json", "Idempotency-Key": "" },
    { "Content-Type": "text/plain", "Idempotency-Key": "intent" },
  ] as Record<string, string>[]) {
    const response = await app.fetch(
      new Request("http://localhost/api/labs/lab/questions", {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    expect([400, 403]).toContain(response.status);
  }
  expect(app.calls).toEqual([]);
});

test("transport preserves retry identity while supplying researcher authorship", async () => {
  const context = await requestContext(
    new Request("http://localhost/api/labs/lab/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "same-intent",
      },
      body: JSON.stringify({ text: "Question" }),
    }),
  );
  expect(context.mutation).toEqual({
    key: "same-intent",
    actor: { kind: "researcher" },
  });
  expect(context.body).toEqual({ text: "Question" });
});
