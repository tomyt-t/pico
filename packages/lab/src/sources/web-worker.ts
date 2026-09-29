/** One isolated extension host per lab. Never prompts a model or runs an agent loop. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createPdfReader } from "@/lab/sources/pdf-reader";
import {
  isolatedWebConfig,
  type WebToolName,
  webSchemas,
  webToolNames,
} from "@/lab/sources/web-protocol";

const [agentDir, sourceConfig] = process.argv.slice(2);
if (!agentDir || !sourceConfig) throw new Error("Missing isolated web profile");
// Set by the parent before module loading; protects libraries with module-global config/cache.
if (process.env.PI_CODING_AGENT_DIR !== agentDir)
  throw new Error("Web profile mismatch");

async function initialize() {
  const config = JSON.parse(await readFile(sourceConfig as string, "utf8"));
  await writeFile(
    join(agentDir as string, "web-search.json"),
    JSON.stringify(isolatedWebConfig(config)),
    { mode: 0o600 },
  );
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: agentDir as string,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [
      join(
        dirname(
          fileURLToPath(import.meta.resolve("pi-web-access/package.json")),
        ),
        "dist",
      ),
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length)
    throw new Error("Could not load pi-web-access");
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir as string, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir as string, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  // A model identity satisfies the SDK host; it is never invoked by this host.
  const model = runtime
    .getProviders()
    .flatMap((provider) => runtime.getModels(provider.id))[0];
  if (!model) throw new Error("Pi catalog is unavailable");
  const sessionDir = join(agentDir as string, "sessions");
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir,
    modelRuntime: runtime,
    model,
    settingsManager,
    resourceLoader: loader,
    tools: webToolNames,
    sessionManager: SessionManager.continueRecent(process.cwd(), sessionDir),
  });
  await session.bindExtensions({});
  return session;
}

const ready = initialize();
const pdfs = createPdfReader(process.env.TMPDIR ?? "");
let queue = Promise.resolve();
process.on("message", (raw: unknown) => {
  queue = queue.then(async () => {
    const message = raw as { id: string; name: WebToolName; input: unknown };
    try {
      const session = await ready;
      if (!webToolNames.includes(message.name))
        throw new Error("Unsupported web tool");
      const input = webSchemas[message.name].parse(message.input);
      if (message.name === "get_search_content") {
        const pdf = pdfs.read(webSchemas.get_search_content.parse(input));
        if (pdf) {
          process.send?.({ id: message.id, result: pdf });
          return;
        }
      }
      const tool = session.agent.state.tools.find(
        (candidate) => candidate.name === message.name,
      );
      if (!tool) throw new Error("Web tool unavailable");
      if (message.name === "get_search_content") {
        const request = webSchemas.get_search_content.parse(input);
        const preview = await tool.execute(
          message.id,
          {
            ...request,
            findText: undefined,
            findMode: undefined,
            offset: 0,
            limit: 500,
          },
          AbortSignal.timeout(5000),
        );
        if (
          preview.content.some(
            (part) =>
              part.type === "text" &&
              part.text.includes("PDF extracted and saved to:"),
          )
        ) {
          process.send?.({
            id: message.id,
            error:
              "PDF text cache expired. Use fetch_content on the source URL again.",
          });
          return;
        }
      }
      const args =
        message.name === "web_search"
          ? { ...input, workflow: "none", includeContent: false }
          : input;
      const result = await tool.execute(
        message.id,
        args,
        AbortSignal.timeout(80000),
      );
      if (
        result.details &&
        typeof result.details === "object" &&
        "error" in result.details &&
        result.details.error
      ) {
        throw new Error("Provider returned an error");
      }
      process.send?.({
        id: message.id,
        result:
          message.name === "fetch_content"
            ? await pdfs.hydrate(result)
            : result,
      });
    } catch {
      // Do not send raw extension exceptions, which may contain credentials or request headers.
      process.send?.({
        id: message.id,
        error:
          "Web tool failed. Check Pico's web-search.json and provider configuration, then retry.",
      });
    }
  });
});
process.on("disconnect", () => process.exit(0));
ready
  .then(() => process.send?.({ ready: true }))
  .catch(() => {
    process.send?.({
      error:
        "Could not initialize Pico web tools. Check Pico's web-search.json.",
    });
    process.exitCode = 1;
    process.disconnect?.();
  });
