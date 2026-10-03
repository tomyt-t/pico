import { useEffect, useState } from "react";

export const pageIds = [
  "chat",
  "overview",
  "experiments",
  "library",
  "files",
  "investigations",
  "collection",
  "evolution",
  "panorama",
  "pages",
] as const;
export type Page = (typeof pageIds)[number];

export interface Route {
  labId: string;
  page: Page;
  id?: string;
  path?: string;
  kind?: string;
  /** Collection tab: sources, records, files or executions. */
  tab?: string;
  /** The route to return to, as a hash, when a detail was opened from elsewhere. */
  from?: string;
}

export function parseRoute(hash: string): Route | null {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts[0] !== "labs" || !parts[1]) return null;
  try {
    const page = (pageIds as readonly string[]).includes(parts[2] ?? "")
      ? (parts[2] as Page)
      : "chat";
    const params = new URLSearchParams(query);
    return {
      labId: decodeURIComponent(parts[1]),
      page,
      ...(parts[3] && { id: decodeURIComponent(parts[3]) }),
      ...(params.get("path") && { path: params.get("path") ?? undefined }),
      ...(params.get("kind") && { kind: params.get("kind") ?? undefined }),
      ...(params.get("tab") && { tab: params.get("tab") ?? undefined }),
      ...(params.get("from")?.startsWith("#/labs/") && {
        from: params.get("from") ?? undefined,
      }),
    };
  } catch {
    return null;
  }
}

export function routePath(route: Route): string {
  const query = new URLSearchParams();
  if (route.path) query.set("path", route.path);
  if (route.kind) query.set("kind", route.kind);
  if (route.tab) query.set("tab", route.tab);
  if (route.from) query.set("from", route.from);
  return `#/labs/${encodeURIComponent(route.labId)}/${route.page}${
    route.id ? `/${encodeURIComponent(route.id)}` : ""
  }${query.size ? `?${query}` : ""}`;
}

export function navigate(route: Route): void {
  window.location.hash = routePath(route);
}

export function useRoute(): Route | null {
  const [route, setRoute] = useState(() =>
    typeof window === "undefined" ? null : parseRoute(window.location.hash),
  );
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}

/** Where a record of a given kind is shown. Jobs live in the experiments page. */
export function recordRoute(
  labId: string,
  link: { kind: string; id: string },
): Route {
  const page: Page =
    link.kind === "page" || (!link.kind && link.id.startsWith("page-"))
      ? "pages"
      : link.kind === "question"
        ? "investigations"
        : link.kind === "experiment" ||
            link.kind === "result" ||
            link.kind === "job" ||
            link.id.startsWith("job-")
          ? "experiments"
          : "collection";
  return { labId, page, id: link.id };
}

/** The current page as a `from` value, so a detail can lead back to it. */
export function currentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const hash = window.location.hash;
  return hash.startsWith("#/labs/") ? hash : undefined;
}
