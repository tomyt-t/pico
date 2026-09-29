import { describe, expect, test } from "bun:test";
import {
  highlight,
  knownLanguage,
  languageForPath,
} from "@/web/components/highlight";
import { attemptDeltas } from "@/web/features/experiments/attempt-comparison";

describe("code presentation", () => {
  test("workspace files and fenced blocks map to loaded grammars only", () => {
    expect(languageForPath("main.py")).toBe("python");
    expect(languageForPath("launcher.mjs")).toBe("javascript");
    expect(languageForPath("bun.lock")).toBeUndefined();
    expect(knownLanguage("bash")).toBe("shellscript");
    expect(knownLanguage("rust")).toBeUndefined();
  });
  test("highlighting keeps the source text and themes for both color schemes", async () => {
    const source = 'print("RED")\nvalue = 1';
    const tree = await highlight(source, "python");
    const text: string[] = [];
    const styles: string[] = [];
    const visit = (node: unknown) => {
      const entry = node as {
        type: string;
        value?: string;
        properties?: { style?: string };
        children?: unknown[];
      };
      if (entry.type === "text" && entry.value) text.push(entry.value);
      if (entry.properties?.style) styles.push(entry.properties.style);
      for (const child of entry.children ?? []) visit(child);
    };
    visit(tree);
    expect(text.join("")).toBe(source.replace("\n", ""));
    expect(styles.some((style) => style.includes("--shiki-dark"))).toBe(true);
  });
});

describe("attempt comparison", () => {
  test("changes compare with the previous attempt that has a value", () => {
    expect(attemptDeltas([0, 0, null, 0.5])).toEqual([null, 0, null, 0.5]);
    expect(attemptDeltas([null, 2, 1])).toEqual([null, null, -1]);
    expect(attemptDeltas([0.1 + 0.2, 0.3])).toEqual([null, 0]);
  });
});
