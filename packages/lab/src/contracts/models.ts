export interface ProviderConfig {
  mode: "demo" | "pi" | "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  provider?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface PiModelOption {
  id: string;
  name: string;
  input: ("text" | "image")[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface PiProviderOption {
  id: string;
  name: string;
  authenticated: boolean;
  models: PiModelOption[];
}

export interface PiCatalog {
  providers: PiProviderOption[];
  defaultSelection: Pick<
    ProviderConfig,
    "provider" | "model" | "thinking"
  > | null;
  agentDir: string;
  warning?: string;
}

export interface ProviderStatus {
  mode: ProviderConfig["mode"];
  model: string;
  configured: boolean;
  detail: string;
}
