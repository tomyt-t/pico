import { useEffect, useState } from "react";
export type Page = "chat" | "overview" | "experiments" | "library";
export interface Route {
  labId: string;
  page: Page;
  id?: string;
  tab?: string;
}
export function parseRoute(hash: string): Route | null {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts[0] !== "labs" || !parts[1]) return null;
  try {
    const page = ["chat", "overview", "experiments", "library"].includes(
      parts[2] ?? "",
    )
      ? (parts[2] as Page)
      : "chat";
    return {
      labId: decodeURIComponent(parts[1]),
      page,
      ...(parts[3] && { id: decodeURIComponent(parts[3]) }),
      ...(new URLSearchParams(query).get("tab") && {
        tab: new URLSearchParams(query).get("tab") ?? undefined,
      }),
    };
  } catch {
    return null;
  }
}
export function routePath(route: Route): string {
  return `#/labs/${encodeURIComponent(route.labId)}/${route.page}${route.id ? `/${encodeURIComponent(route.id)}` : ""}${route.tab ? `?tab=${encodeURIComponent(route.tab)}` : ""}`;
}
export function navigate(route: Route) {
  window.location.hash = routePath(route);
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}
