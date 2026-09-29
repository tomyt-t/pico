import { useState } from "react";

export function savedDrafts(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem("pico-drafts") ?? "{}",
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
  } catch {}
  return {};
}

export function useChatDrafts(labId: string) {
  const [drafts, setDrafts] = useState(savedDrafts);
  const updateDraft = (text: string) =>
    setDrafts((previous) => {
      const next = { ...previous, [labId]: text };
      try {
        sessionStorage.setItem("pico-drafts", JSON.stringify(next));
      } catch {}
      return next;
    });
  return { draft: drafts[labId] ?? "", updateDraft };
}
