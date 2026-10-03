import type { HighlighterCore } from "shiki/core";

const extensions: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  json: "json",
  jsonl: "jsonl",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "shellscript",
  md: "markdown",
  csv: "csv",
};
const aliases: Record<string, string> = {
  bash: "shellscript",
  shell: "shellscript",
  sh: "shellscript",
  zsh: "shellscript",
  py: "python",
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  md: "markdown",
};
const limit = 150_000;
let highlighter: Promise<HighlighterCore> | undefined;

export function languageForPath(path: string): string | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return extensions[extension];
}

export function knownLanguage(name: string): string | undefined {
  const language = aliases[name] ?? name;
  return Object.values(extensions).includes(language) ? language : undefined;
}

function load(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [
        import("shiki/themes/vitesse-light.mjs"),
        import("shiki/themes/vitesse-dark.mjs"),
      ],
      langs: [
        import("shiki/langs/python.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/jsonl.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/shellscript.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/csv.mjs"),
      ],
      engine: createJavaScriptRegexEngine(),
    }),
  );
  return highlighter;
}

export async function highlight(code: string, language: string) {
  if (code.length > limit) return null;
  const shiki = await load();
  return shiki.codeToHast(code, {
    lang: language,
    themes: { light: "vitesse-light", dark: "vitesse-dark" },
    defaultColor: false,
    structure: "inline",
  });
}
