import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePiProfile } from "@/lab/models/pi-profile";
import { picoPaths } from "@/lab/runtime/paths";
import { createSourceAccess } from "@/lab/sources/source-access";
import { createWebAccess } from "@/lab/sources/web-client";
import { defaultWebConfig } from "@/lab/sources/web-config";
import { isolatedWebConfig } from "@/lab/sources/web-protocol";
import { createRuntime } from "../support/runtime";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pico-web-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const paths = picoPaths(join(root, "data"), join(root, "profile"));
  preparePiProfile(paths.agentDir, defaultWebConfig);
  await writeFile(
    join(paths.agentDir, "web-search.json"),
    JSON.stringify({
      provider: "exa",
      ssrf: { allowRanges: ["127.0.0.1/32"] },
    }),
  );
  const article =
    "Synthetic scientific evidence: baseline 10, defense 12. This local fixture does not demonstrate efficacy. ".repeat(
      30,
    );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/paper.pdf") {
        return new Response(pdfFixture(), {
          headers: { "Content-Type": "application/pdf" },
        });
      }
      if (new URL(request.url).pathname === "/slow") await Bun.sleep(500);
      return new Response(
        `<!doctype html><html><head><title>Defense fixture</title></head><body><main><article><h1>Defense fixture</h1><p>${article}</p><p>${article}</p></article></main></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  cleanups.push(async () => {
    await server.stop(true);
  });
  const web = createWebAccess(paths);
  cleanups.push(() => web.close());
  return { root, paths, web, url: server.url.href };
}

type Response = {
  result: {
    content: { type: string; text: string }[];
    details: { responseId: string };
  };
};

function pdfFixture() {
  const stream =
    "BT /F1 12 Tf 50 700 Td (Synthetic PDF evidence: baseline 10 and defense 12.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

test("PDF fetch returns actual extracted text and searchable passages instead of an inaccessible local path", async () => {
  const { web, url } = await fixture();
  const source = `${url}paper.pdf`;
  const result = (await web.execute("pdf-lab", "fetch_content", {
    url: source,
  })) as Response;
  const text = result.result.content.map((part) => part.text).join();
  expect(text).toContain("Synthetic PDF evidence");
  expect(text).not.toContain("PDF extracted and saved to:");
  const cached = (await web.execute("pdf-lab", "get_search_content", {
    responseId: result.result.details.responseId,
    url: source,
    findText: "baseline 10",
  })) as { result: { details: { matchCount: number } } };
  expect(cached.result.details.matchCount).toBe(1);
  const unrelated = (await web.execute("pdf-lab", "get_search_content", {
    responseId: result.result.details.responseId,
    url: source,
    findText: "nonexistent-evidence",
  })) as { result: { details: { matchCount: number } } };
  expect(unrelated.result.details.matchCount).toBe(0);
});

test("installed web extension reads and retrieves real HTTP text while keeping lab caches separate", async () => {
  const { web, url, paths } = await fixture();
  const result = (await web.execute("lab-a", "fetch_content", {
    url,
  })) as Response;
  expect(result.result.content.map((part) => part.text).join()).toContain(
    "Synthetic scientific evidence",
  );
  const responseId = result.result.details.responseId;
  expect(responseId).toBeTruthy();
  const retrieved = await web.execute("lab-a", "get_search_content", {
    responseId,
    url,
    findText: "baseline 10",
  });
  expect(JSON.stringify(retrieved)).toContain("baseline 10");
  await expect(
    web.execute("lab-b", "get_search_content", { responseId, url }),
  ).rejects.toThrow("Web tool failed");
  const profile = JSON.parse(
    await readFile(
      join(paths.runtimeDir, "web/lab-a/agent/web-search.json"),
      "utf8",
    ),
  );
  expect(profile.allowBrowserCookies).toBe(false);
  expect(profile.workflow).toBe("none");
  expect(profile.pdf.provider).toBe("unpdf");
  expect(
    JSON.parse(
      await readFile(
        join(paths.runtimeDir, "web/lab-a/agent/auth.json"),
        "utf8",
      ),
    ),
  ).toEqual({});
});

test("cancellation stops an in-flight web request and a later call gets a working host", async () => {
  const { web, url } = await fixture();
  await web.execute("lab-a", "fetch_content", { url });
  const controller = new AbortController();
  const call = web.execute(
    "lab-a",
    "fetch_content",
    { url: `${url}slow` },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 50);
  await expect(call).rejects.toThrow("cancelled");
  // The process exits asynchronously; cancellation must be safe to retry immediately.
  await Bun.sleep(50);
  expect(
    JSON.stringify(await web.execute("lab-a", "fetch_content", { url })),
  ).toContain("Synthetic scientific evidence");
});

test("Pico web calls reject local paths and interactive or credential-reading arguments", async () => {
  const { web } = await fixture();
  await expect(
    web.execute("a", "fetch_content", { url: "file:///tmp/private" }),
  ).rejects.toThrow();
  await expect(
    web.execute("a", "fetch_content", {
      url: "https://example.com",
      auth: true,
    }),
  ).rejects.toThrow();
  await expect(
    web.execute("a", "web_search", {
      query: "papers",
      workflow: "summary-review",
    }),
  ).rejects.toThrow();
  const config = isolatedWebConfig({
    allowBrowserCookies: true,
    workflow: "auto-summary",
    pdf: { provider: "gemini" },
  });
  expect(config.allowBrowserCookies).toBe(false);
  expect(config.workflow).toBe("none");
  expect(config.pdf.provider).toBe("unpdf");
});

test("one durable conversation can read a source and save it to Library; restart and backup preserve evidence without credentials", async () => {
  const { root, paths, url, web } = await fixture();
  let step = 0;
  const app = await createRuntime({
    dataDir: paths.dataDir,
    piAgentDir: paths.agentDir,
    sources: createSourceAccess({ ...paths, web }),
    model: async ({ tools, messages }) => {
      expect(tools.some((tool) => tool.name === "fetch_content")).toBe(true);
      if (step++ === 0)
        return {
          content: "Reading the source",
          calls: [
            { id: "read-web", name: "fetch_content", arguments: { url } },
          ],
        };
      if (step === 2) {
        const last = messages.at(-1);
        expect(last?.role).toBe("tool");
        const read = JSON.parse(last?.content ?? "{}") as Response;
        const text = read.result.content.map((part) => part.text).join("\n");
        return {
          content: "Preserving the evidence",
          calls: [
            {
              id: "save-paper",
              name: "register_paper",
              arguments: {
                title: "Defense fixture",
                authors: [],
                identifier: url,
                url,
                text,
                source: "Local test fixture; pi-web-access excerpt",
              },
            },
          ],
        };
      }
      return { content: "Source saved with its limitations.", calls: [] };
    },
  });
  cleanups.push(() => app.close());
  const lab = app.research.createLab({ name: "Web investigation" });
  const turn = app.conversation.enqueue(lab.id, "Read and save this source", {
    key: "read-source",
    actor: { kind: "researcher" },
  });
  for (
    let i = 0;
    i < 200 &&
    ["queued", "running"].includes(
      app.conversation.getTurn(lab.id, turn.id)?.status ?? "",
    );
    i++
  )
    await Bun.sleep(20);
  expect(app.conversation.getTurn(lab.id, turn.id)?.status).toBe("completed");
  const paper = app.research.overview(lab.id).papers[0];
  expect(paper?.text).toContain("Synthetic scientific evidence");
  await writeFile(
    join(paths.agentDir, "auth.json"),
    JSON.stringify({ test: { type: "api_key", key: "private-fixture-key" } }),
  );
  const backup = join(root, "export");
  await app.administration.backup(backup, {
    key: "backup",
    actor: { kind: "researcher" },
  });
  expect(existsSync(join(backup, "pi"))).toBe(false);
  expect(existsSync(join(backup, "runtime"))).toBe(false);
  await app.close();
  const restored = await createRuntime({
    dataDir: paths.dataDir,
    piAgentDir: paths.agentDir,
  });
  cleanups.push(() => restored.close());
  expect(restored.research.overview(lab.id).papers[0]?.id).toBe(paper?.id);
  const toolResults = restored.research
    .conversationView(lab.id)
    .messages.filter((message) => message.toolCall);
  expect(toolResults.map((message) => message.toolCall?.name)).toEqual([
    "fetch_content",
    "register_paper",
  ]);
  expect(JSON.stringify(toolResults)).not.toContain("private-fixture-key");
});
