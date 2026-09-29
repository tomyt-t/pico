export function savedTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem("pico-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
