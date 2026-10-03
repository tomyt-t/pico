export function savedTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem("pico-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return systemTheme();
}

/** The operating system preference; dark outside a browser, as in the CSS default. */
export function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function savedSidebar(): "collapsed" | "expanded" {
  try {
    if (localStorage.getItem("pico-sidebar") === "collapsed")
      return "collapsed";
  } catch {}
  return "expanded";
}

export const dockWidthRange = { min: 360, max: 640, step: 24 } as const;

export function clampDockWidth(value: number): number {
  if (!Number.isFinite(value)) return 400;
  return Math.min(dockWidthRange.max, Math.max(dockWidthRange.min, value));
}

export function savedDockWidth(): number {
  try {
    const stored = localStorage.getItem("pico-dock-width");
    if (stored) return clampDockWidth(Number(stored));
  } catch {}
  return 400;
}

export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
