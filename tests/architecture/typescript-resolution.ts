import { resolve } from "node:path";

export interface ImportEdge {
  from: string;
  specifier: string;
  to?: string;
}

export interface ResolutionGraph {
  edges: ImportEdge[];
  files: string[];
  diagnostics: string[];
  status: number;
}

/** Use the compiler's graph, including erased type imports and literal import(). */
export function parseResolutionTrace(output: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  let current: ImportEdge | undefined;
  for (const line of output.split(/\r?\n/)) {
    const start = line.match(
      /^======== Resolving module '(.+)' from '(.+)'. ========$/,
    );
    const typeStart = line.match(
      /^======== Resolving type reference directive '([^']+)', containing file '([^']+)'/,
    );
    if (start || typeStart) {
      if (current)
        throw new Error(`Incomplete TypeScript trace: ${current.from}`);
      const match = start ?? typeStart;
      current = {
        from: resolve(match?.[2] ?? ""),
        specifier: match?.[1] ?? "",
      };
      continue;
    }
    if (!current) continue;
    const resolved = line.match(
      /^======== (?:Module name|Type reference directive) '.+' was successfully resolved to '([^']+)'/,
    );
    const missing =
      /^======== (?:Module name|Type reference directive) '.+' was not resolved/.test(
        line,
      );
    if (resolved || missing) {
      if (resolved?.[1]) current.to = resolve(resolved[1]);
      edges.push(current);
      current = undefined;
    }
  }
  if (current) throw new Error(`Incomplete TypeScript trace: ${current.from}`);
  return edges;
}

export async function resolveProject(
  root: string,
  project: string,
): Promise<ResolutionGraph> {
  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "--no-install",
      "tsc",
      "--project",
      project,
      "--traceResolution",
      "--listFiles",
      "--pretty",
      "false",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [output, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const diagnostics = output
    .split(/\r?\n/)
    .filter((line) => /error TS\d+:/.test(line));
  if (stderr.trim()) diagnostics.push(stderr.trim());
  const edges = parseResolutionTrace(output);
  if (!edges.length)
    throw new Error(`No compiler resolution records: ${project}`);
  return {
    edges,
    files: output
      .split(/\r?\n/)
      .filter((line) => /^\/.*\.[cm]?[jt]sx?$/.test(line)),
    diagnostics,
    status,
  };
}

export function mergeEdges(graphs: ResolutionGraph[]): ImportEdge[] {
  const unique = new Map<string, ImportEdge>();
  for (const graph of graphs) {
    for (const edge of graph.edges) {
      const key = `${edge.from}\0${edge.specifier}`;
      const previous = unique.get(key);
      if (previous && previous.to !== edge.to) {
        throw new Error(
          `Resolution differs between tsconfigs: ${edge.from} -> ${edge.specifier}\n${previous.to}\n${edge.to}`,
        );
      }
      unique.set(key, edge);
    }
  }
  return [...unique.values()];
}
