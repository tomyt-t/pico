import type { WebToolName } from "@/lab/contracts";

export { type WebToolName, webSchemas, webToolNames } from "@/lab/contracts";

export interface WebAccess {
  execute(
    labId: string,
    name: WebToolName,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Keep Pi Web Access in tool mode: the Pico conversation owns all reasoning. */
export function isolatedWebConfig(config: Record<string, unknown>) {
  return {
    ...config,
    workflow: "none",
    autoOpenBrowser: false,
    allowBrowserCookies: false,
    maxInlineContentChars: 16000,
    webSearch: { allowedProviders: ["exa", "brave", "serpapi", "serper"] },
    fetch: { defaultMode: "readable", allowedModes: ["readable", "raw"] },
    fetchRouting: { allowRemoteHostedProviders: false },
    pdf: { provider: "unpdf", maxPages: 100, maxSizeMB: 20 },
    image: { enabled: false },
    githubClone: { enabled: false },
    githubPrIssue: { enabled: false },
    tools: { sourceCheck: { enabled: false } },
    toolNames: {
      webSearch: "web_search",
      fetchContent: "fetch_content",
      getSearchContent: "get_search_content",
    },
    commands: {
      websearch: { enabled: false },
      curator: { enabled: false },
      search: { enabled: false },
      "google-account": { enabled: false },
    },
  };
}
