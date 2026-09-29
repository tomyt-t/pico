import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { forbiddenRunnerSymbols, readImportSymbols } from "./import-symbols";
import {
  checkBoundaries,
  checkBrowserGraph,
  type Manifests,
  moduleCycles,
  productionModule,
  workspacePaths,
} from "./module-policy";
import {
  mergeEdges,
  type ResolutionGraph,
  resolveProject,
} from "./typescript-resolution";

const root = fileURLToPath(new URL("../..", import.meta.url));
const projects = [
  "packages/lab/tsconfig.json",
  "packages/runner/tsconfig.json",
  "apps/server/tsconfig.json",
  "apps/web/tsconfig.json",
  "apps/web/tests/tsconfig.json",
  "tests/architecture/browser-contracts/tsconfig.json",
  "tests/architecture/browser-web/tsconfig.json",
  "tsconfig.json",
];
const manifests = Object.fromEntries(
  await Promise.all(
    Object.entries(workspacePaths).map(async ([name, path]) => [
      name,
      JSON.parse(await readFile(resolve(root, path, "package.json"), "utf8")),
    ]),
  ),
) as Manifests;
let graphs: ResolutionGraph[] = [];
let edges: ReturnType<typeof mergeEdges> = [];
let scratch: string | undefined;

beforeAll(async () => {
  graphs = await Promise.all(
    projects.map((project) => resolveProject(root, project)),
  );
  edges = mergeEdges(graphs);
}, 60_000);
afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test("every production source participates in the actual TypeScript programs", async () => {
  for (const [index, graph] of graphs.entries()) {
    expect({
      project: projects[index],
      diagnostics: graph.diagnostics,
    }).toEqual({ project: projects[index], diagnostics: [] });
    expect(graph.status).toBe(0);
  }
  const compiled = new Set(graphs.flatMap((graph) => graph.files));
  for (const directory of Object.values(workspacePaths)) {
    const source = resolve(root, directory, "src");
    for await (const file of new Bun.Glob("**/*.{ts,tsx,mts,cts}").scan({
      cwd: source,
      absolute: true,
    })) {
      expect(compiled.has(file), `source omitted from tsconfig: ${file}`).toBe(
        true,
      );
    }
  }
});

test("imports, reexports and erased types obey workspace exports and module entries", () => {
  expect(checkBoundaries(root, edges, manifests)).toEqual([]);
});

test("the production module graph has no cycles, including type dependencies", () => {
  expect(moduleCycles(root, edges)).toEqual([]);
});

test("storage uses only the runner's file primitives and file data types", async () => {
  const files = [...new Set(edges.map((edge) => edge.from))].filter(
    (file) => productionModule(root, file) === "storage",
  );
  const imports = await readImportSymbols(
    root,
    resolve(root, "packages/lab/tsconfig.json"),
    files,
  );
  expect(forbiddenRunnerSymbols(imports)).toEqual([]);
});

test("contracts and browser source have no transitive native or engine dependencies", () => {
  const browserFiles = [...new Set(edges.map((edge) => edge.from))].filter(
    (file) => productionModule(root, file)?.startsWith("web/"),
  );
  expect(
    checkBrowserGraph(root, edges, [
      resolve(root, "packages/lab/src/contracts.ts"),
      ...browserFiles,
    ]),
  ).toEqual([]);
  for (const project of ["browser-contracts", "browser-web"]) {
    const browserProgram =
      graphs[projects.indexOf(`tests/architecture/${project}/tsconfig.json`)];
    expect(
      browserProgram?.files.filter((file) =>
        /\/(?:@types\/(?:node|bun)|bun-types|@earendil-works|pi-web-access)\//.test(
          file,
        ),
      ),
    ).toEqual([]);
  }
});

test("workspace manifests expose only the agreed explicit package entries", async () => {
  expect(manifests.lab.exports).toEqual({
    ".": "./src/lab-runtime.ts",
    "./contracts": "./src/contracts.ts",
    "./administration": "./src/lab-administration.ts",
  });
  expect(manifests.runner.exports).toEqual({ ".": "./src/runner.ts" });
  expect(manifests.server.exports).toEqual({ ".": "./src/server.ts" });
  expect(manifests.web.exports).toBeUndefined();
  for (const [name, manifest] of Object.entries(manifests)) {
    expect(manifest.name).toBe(`@pico/${name}`);
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      expect(`${subpath}${target}`).not.toContain("*");
      expect(target.startsWith("./src/")).toBe(true);
      const directory = workspacePaths[name as keyof typeof workspacePaths];
      expect(await Bun.file(resolve(root, directory, target)).exists()).toBe(
        true,
      );
    }
  }
});

test("TypeScript and Vite use the same four namespaced aliases without a catchall", async () => {
  const base = JSON.parse(
    await readFile(resolve(root, "tsconfig.base.json"), "utf8"),
  );
  const expectedPaths = Object.fromEntries(
    Object.entries(workspacePaths).map(([name, path]) => [
      `@/${name}/*`,
      [`./${path}/src/*`],
    ]),
  );
  expect(base.compilerOptions.paths).toEqual(expectedPaths);
  for (const directory of Object.values(workspacePaths)) {
    const config = JSON.parse(
      await readFile(resolve(root, directory, "tsconfig.json"), "utf8"),
    );
    expect(resolve(root, directory, config.extends)).toBe(
      resolve(root, "tsconfig.base.json"),
    );
    expect(config.compilerOptions?.paths).toBeUndefined();
  }
  // Load build configuration as configuration data; application consumers cannot import private source paths.
  const { default: config } = await import(
    pathToFileURL(resolve(root, "apps/web/vite.config.ts")).href
  );
  expect(config.resolve.alias).toHaveLength(4);
  expect(
    Object.fromEntries(
      config.resolve.alias.map(
        (alias: { find: string; replacement: string }) => [
          alias.find,
          alias.replacement,
        ],
      ),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(workspacePaths).map(([name, path]) => [
        `@/${name}`,
        resolve(root, path, "src"),
      ]),
    ),
  );
});

test("the real resolver catches type leaks, private cross-workspace imports, dynamic imports and module cycles", async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "pico-boundaries-")));
  const fixtureRoot = scratch;
  const files: Record<string, string> = {
    "packages/lab/src/contracts.ts":
      'export type { Private } from "@/lab/models/private"; export type NativeFile = import("node:fs").Stats;',
    "packages/lab/src/models/private.ts":
      'import type { ResearchMarker } from "@/lab/research/laboratory"; export type Private = { value: ResearchMarker };',
    "packages/lab/src/research/laboratory.ts":
      'import type { Private } from "@/lab/models/private"; export interface ResearchMarker { nested?: Private }',
    "packages/lab/src/lab-runtime.ts":
      'export type { ResearchMarker } from "@/lab/research/laboratory";',
    "packages/lab/src/storage/private-runner.ts": [
      'import { createRunner as execute } from "@pico/runner";',
      'export type { Runner } from "@pico/runner";',
      'export const load = () => import("@pico/runner");',
      "export const templateLoad = () => import(`@pico/runner`);",
    ].join("\n"),
    "apps/web/src/main.ts": [
      'import type { Private } from "@/lab/models/private";',
      'export type { Private as Deep } from "../../../packages/lab/src/models/private";',
      'export type { Private as PackageDeep } from "@pico/lab/src/models/private";',
      'export const load = () => import("@pico/lab");',
      "export type WebPrivate = Private;",
      "export const nativeLeak = process.cwd();",
    ].join("\n"),
    "tests/outside-owner.ts":
      'export type { Private } from "../packages/lab/src/models/private";',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
        paths: { "@/lab/*": ["./packages/lab/src/*"] },
      },
      include: ["packages", "apps", "tests"],
    }),
    "packages/lab/package.json": JSON.stringify(manifests.lab),
  };
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(fixtureRoot, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  await mkdir(resolve(fixtureRoot, "node_modules/@pico"), { recursive: true });
  await symlink(
    resolve(fixtureRoot, "packages/lab"),
    resolve(fixtureRoot, "node_modules/@pico/lab"),
  );
  const graph = await resolveProject(
    root,
    resolve(fixtureRoot, "tsconfig.json"),
  );
  const problems = checkBoundaries(fixtureRoot, graph.edges, manifests).join(
    "\n",
  );
  expect(problems).toContain("alias belongs to another workspace");
  expect(problems).toContain("tests/outside-owner.ts");
  expect(problems).toContain("package subpath is private");
  expect(problems).toContain(
    "forbidden module dependency web/entry -> lab-entry",
  );
  expect(problems).toContain("contracts -> models");
  expect(graph.edges.some((edge) => edge.specifier === "node:fs")).toBe(true);
  expect(
    graph.diagnostics.some((diagnostic) =>
      /Cannot find name 'process'/.test(diagnostic),
    ),
  ).toBe(true);
  expect(
    graph.edges.some(
      (edge) =>
        edge.specifier === "@pico/lab" && edge.to?.endsWith("lab-runtime.ts"),
    ),
  ).toBe(true);
  expect(
    checkBrowserGraph(fixtureRoot, graph.edges, [
      resolve(fixtureRoot, "packages/lab/src/contracts.ts"),
    ]).join("\n"),
  ).toContain("node:fs");
  expect(moduleCycles(fixtureRoot, graph.edges)).toContain(
    "models -> research -> models",
  );
  const symbols = await readImportSymbols(
    fixtureRoot,
    resolve(fixtureRoot, "tsconfig.json"),
    [resolve(fixtureRoot, "packages/lab/src/storage/private-runner.ts")],
  );
  expect(forbiddenRunnerSymbols(symbols).map((entry) => entry.names)).toEqual([
    ["createRunner"],
    ["Runner"],
    ["*"],
    ["*"],
  ]);
}, 15_000);
