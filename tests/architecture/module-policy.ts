import { builtinModules } from "node:module";
import { relative, resolve } from "node:path";
import type { ImportEdge } from "./typescript-resolution";

export const workspacePaths = {
  lab: "packages/lab",
  runner: "packages/runner",
  server: "apps/server",
  web: "apps/web",
} as const;
export type Workspace = keyof typeof workspacePaths;

export interface WorkspaceManifest {
  name: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
}
export type Manifests = Record<Workspace, WorkspaceManifest>;

function inside(file: string, directory: string): boolean {
  return file.startsWith(`${directory}/`);
}

export function owner(root: string, file: string): Workspace | undefined {
  return (Object.keys(workspacePaths) as Workspace[]).find((name) =>
    inside(file, resolve(root, workspacePaths[name])),
  );
}

export function productionModule(
  root: string,
  file: string,
): string | undefined {
  const workspace = owner(root, file);
  if (!workspace) return undefined;
  const source = resolve(root, workspacePaths[workspace], "src");
  if (!inside(file, source) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
    return undefined;
  const path = relative(source, file);
  if (workspace === "lab") {
    if (path === "contracts.ts" || path.startsWith("contracts/"))
      return "contracts";
    if (path === "lab-runtime.ts" || path === "lab-administration.ts")
      return "lab-entry";
    if (path.startsWith("pico/tools/")) return "pico-tools";
    return path.split("/")[0];
  }
  if (workspace === "runner") return "runner";
  if (workspace === "server")
    return path.startsWith("http/") ? "http" : "server";
  if (path === "app/navigation.ts") return "web/navigation";
  if (path.startsWith("features/")) return `web/feature/${path.split("/")[1]}`;
  return `web/${path.includes("/") ? path.split("/")[0] : "entry"}`;
}

const publicLabEntries: Record<string, Set<string>> = {
  research: new Set(["research/laboratory.ts"]),
  pico: new Set(["pico/session.ts"]),
  models: new Set(["models/model-contract.ts", "models/model-gateway.ts"]),
  sources: new Set(["sources/source-access.ts"]),
  storage: new Set([
    "storage/research-repository.ts",
    "storage/conversation-repository.ts",
    "storage/operation-repository.ts",
    "storage/research-files.ts",
  ]),
  runtime: new Set([
    "runtime/application.ts",
    "runtime/runtime-contract.ts",
    "runtime/paths.ts",
    "runtime/backup.ts",
  ]),
};
const compositionEntries = new Set([
  "models/pi-profile.ts",
  "sources/web-config.ts",
  "storage/storage.ts",
  "storage/database.ts",
  "storage/backup.ts",
  "storage/application-lock.ts",
  "storage/migrations/migrate.ts",
]);
const allowedModules: Record<string, Set<string>> = {
  contracts: new Set(),
  research: new Set(["contracts", "storage", "runner", "sources"]),
  "pico-tools": new Set(["contracts", "research", "models"]),
  pico: new Set(["contracts", "research", "models", "storage", "pico-tools"]),
  models: new Set(["contracts"]),
  sources: new Set(["contracts"]),
  storage: new Set(["contracts", "runner"]),
  runner: new Set(),
  runtime: new Set([
    "contracts",
    "research",
    "pico",
    "models",
    "sources",
    "storage",
    "runner",
  ]),
  "lab-entry": new Set([
    "contracts",
    "research",
    "models",
    "sources",
    "storage",
    "runtime",
  ]),
  http: new Set(["contracts", "lab-entry"]),
  server: new Set(["http", "contracts", "lab-entry"]),
};

function allowedDependency(from: string, to: string): boolean {
  if (from === to) return true;
  if (from.startsWith("web/")) {
    if (to === "contracts") return true;
    if (!to.startsWith("web/")) return false;
    if (from === "web/app" || from === "web/entry") return true;
    if (from.startsWith("web/feature/"))
      return ["web/api", "web/components", "web/navigation"].includes(to);
    if (from === "web/api") return false;
    if (from === "web/components") return false;
    return false;
  }
  return allowedModules[from]?.has(to) ?? false;
}

export function checkBoundaries(
  root: string,
  edges: ImportEdge[],
  manifests: Manifests,
): string[] {
  const violations = new Set<string>();
  for (const edge of edges) {
    if (
      !inside(edge.from, root) ||
      edge.from.includes("/node_modules/") ||
      inside(edge.from, resolve(root, "src"))
    )
      continue;
    const sourceOwner = owner(root, edge.from);
    const targetOwner = edge.to ? owner(root, edge.to) : undefined;
    const from = productionModule(root, edge.from);
    const to = edge.to ? productionModule(root, edge.to) : undefined;
    const label = `${relative(root, edge.from)} -> ${edge.specifier}`;
    const reject = (reason: string) => violations.add(`${label}: ${reason}`);
    const alias = edge.specifier.match(/^@\/([^/]+)(?:\/|$)/)?.[1];
    if (alias && alias !== sourceOwner)
      reject("alias belongs to another workspace; use its package export");
    if (edge.specifier.startsWith("@pico/")) {
      const packageOwner = (Object.keys(manifests) as Workspace[]).find(
        (name) =>
          edge.specifier === manifests[name].name ||
          edge.specifier.startsWith(`${manifests[name].name}/`),
      );
      if (!packageOwner) reject("unknown workspace package");
      else {
        const manifest = manifests[packageOwner];
        const subpath =
          edge.specifier === manifest.name
            ? "."
            : `.${edge.specifier.slice(manifest.name.length)}`;
        const exported = manifest.exports?.[subpath];
        if (!exported) reject("package subpath is private");
        else if (
          edge.to !== resolve(root, workspacePaths[packageOwner], exported)
        )
          reject("package resolved outside its declared export");
      }
    }
    if (
      targetOwner &&
      sourceOwner !== targetOwner &&
      !edge.specifier.startsWith("@pico/")
    ) {
      reject(
        "cross-workspace path bypasses package exports (also applies to tests)",
      );
    }
    if (!from) continue;
    if (
      sourceOwner &&
      !edge.specifier.startsWith(".") &&
      !edge.specifier.startsWith("@/") &&
      !/^(?:node:|bun(?::|$))/.test(edge.specifier) &&
      !nativeModules.has(edge.specifier)
    ) {
      const dependency = edge.specifier.startsWith("@")
        ? edge.specifier.split("/").slice(0, 2).join("/")
        : edge.specifier.split("/")[0];
      if (!dependency || !manifests[sourceOwner].dependencies?.[dependency])
        reject("production dependency is not declared by its owning workspace");
    }
    if (edge.specifier.startsWith("."))
      reject("source imports must use the workspace @/ alias");
    if (
      edge.to &&
      inside(edge.to, root) &&
      !edge.to.includes("/node_modules/") &&
      !to
    )
      reject("production imports a test, config or legacy source");
    if (to && !allowedDependency(from, to))
      reject(`forbidden module dependency ${from} -> ${to}`);
    if (
      sourceOwner === "lab" &&
      targetOwner === "lab" &&
      from !== to &&
      to &&
      to !== "contracts" &&
      to !== "pico-tools"
    ) {
      const target = relative(
        resolve(root, workspacePaths.lab, "src"),
        edge.to ?? "",
      );
      const composition = from === "runtime" || from === "lab-entry";
      if (
        !publicLabEntries[to]?.has(target) &&
        !(composition && compositionEntries.has(target))
      )
        reject("private module entry");
      if (
        from === "pico-tools" &&
        to === "models" &&
        target !== "models/model-contract.ts"
      )
        reject("tools may only use the technical model contract");
      if (
        from === "pico" &&
        to === "storage" &&
        ![
          "storage/conversation-repository.ts",
          "storage/operation-repository.ts",
        ].includes(target)
      )
        reject("Pico may only access conversation and receipt repositories");
    }
    if (
      (edge.specifier.startsWith("@earendil-works/") ||
        edge.specifier.startsWith("pi-web-access")) &&
      from !== "models" &&
      relative(root, edge.from) !== "packages/lab/src/sources/web-worker.ts"
    )
      reject("provider SDK outside its explicit host");
    if (from === "contracts" && !to && edge.specifier !== "zod")
      reject(
        "contracts may depend only on neutral validation and other contracts",
      );
  }
  return [...violations].sort();
}

const nativeModules = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
export function checkBrowserGraph(
  root: string,
  edges: ImportEdge[],
  entrypoints: string[],
): string[] {
  const imports = new Map<string, ImportEdge[]>();
  for (const edge of edges)
    imports.set(edge.from, [...(imports.get(edge.from) ?? []), edge]);
  const queue = entrypoints.map((file) => ({
    file,
    via: relative(root, file),
  }));
  const seen = new Set<string>();
  const violations = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (!item || seen.has(item.file)) continue;
    seen.add(item.file);
    for (const edge of imports.get(item.file) ?? []) {
      const path = `${item.via} -> ${edge.specifier}`;
      const module = edge.to ? productionModule(root, edge.to) : undefined;
      if (
        nativeModules.has(edge.specifier) ||
        /^(?:node:|bun(?::|$)|bun-types(?:\/|$)|@types\/(?:node|bun)|@earendil-works\/|pi-web-access)/.test(
          edge.specifier,
        ) ||
        (edge.to &&
          /\/(?:@types\/(?:node|bun)|bun-types|@earendil-works|pi-web-access)\//.test(
            edge.to,
          )) ||
        (module && module !== "contracts" && !module.startsWith("web/"))
      ) {
        violations.add(`browser dependency: ${path}`);
      } else if (edge.to) queue.push({ file: edge.to, via: path });
    }
  }
  return [...violations].sort();
}

/** Cycles are checked across modules; tightly related files inside one module may refer to each other. */
export function moduleCycles(root: string, edges: ImportEdge[]): string[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = productionModule(root, edge.from);
    const to = edge.to ? productionModule(root, edge.to) : undefined;
    if (!from || !to || from === to) continue;
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from)?.add(to);
  }
  const complete = new Set<string>();
  const active: string[] = [];
  const cycles = new Set<string>();
  function visit(node: string) {
    const start = active.indexOf(node);
    if (start >= 0) {
      cycles.add([...active.slice(start), node].join(" -> "));
      return;
    }
    if (complete.has(node)) return;
    active.push(node);
    for (const dependency of [...(graph.get(node) ?? [])].sort())
      visit(dependency);
    active.pop();
    complete.add(node);
  }
  for (const node of [...graph.keys()].sort()) visit(node);
  return [...cycles];
}
