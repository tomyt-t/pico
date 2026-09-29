import { describe, expect, test } from "bun:test";
import type { Lab, PiCatalog } from "@pico/lab/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { LabForm } from "@/web/features/settings/laboratory-form";
import { piDefaultSelection } from "@/web/features/settings/model-selection";

const catalog: PiCatalog = {
  providers: [
    {
      id: "unsigned",
      name: "Needs sign-in",
      authenticated: false,
      models: [
        {
          id: "unavailable",
          name: "Unavailable model",
          input: ["text"],
          reasoning: true,
          contextWindow: 100000,
          maxTokens: 4000,
        },
      ],
    },
    {
      id: "signed",
      name: "Signed-in provider",
      authenticated: true,
      models: [
        {
          id: "fast",
          name: "Fast model",
          input: ["text"],
          reasoning: false,
          contextWindow: 32000,
          maxTokens: 4000,
        },
        {
          id: "research",
          name: "Research model",
          input: ["text", "image"],
          reasoning: true,
          contextWindow: 200000,
          maxTokens: 16000,
        },
      ],
    },
  ],
  defaultSelection: { provider: "signed", model: "research", thinking: "high" },
  agentDir: "/synthetic/pi/location",
};
const lab: Lab = {
  id: "existing-lab",
  name: "Existing laboratory",
  researchLine: "A research direction",
  createdAt: "2026-09-28T12:00:00Z",
  updatedAt: "2026-09-28T12:00:00Z",
  revision: 1,
  settings: {
    executionEnabled: false,
    maxRunSeconds: 120,
    maxConcurrentRuns: 1,
    maxModelSteps: 16,
    provider: {
      mode: "pi",
      provider: "saved-provider",
      model: "saved-model",
      thinking: "high",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  },
};

describe("Pi provider selection", () => {
  test("prefers the authenticated Pi default and retains its reasoning setting", () => {
    expect(piDefaultSelection(catalog)).toEqual({
      provider: "signed",
      model: "research",
      thinking: "high",
    });
  });
  test("a stale or unsigned default falls back only to an authenticated available model", () => {
    expect(
      piDefaultSelection({
        ...catalog,
        defaultSelection: {
          provider: "unsigned",
          model: "unavailable",
          thinking: "high",
        },
      }),
    ).toEqual({ provider: "signed", model: "fast", thinking: "off" });
    expect(
      piDefaultSelection({
        ...catalog,
        providers: catalog.providers.map((entry) => ({
          ...entry,
          authenticated: false,
        })),
      }),
    ).toBeNull();
  });
  test("a model without reasoning does not inherit an unsupported effort from Pi defaults", () => {
    expect(
      piDefaultSelection({
        ...catalog,
        defaultSelection: {
          provider: "signed",
          model: "fast",
          thinking: "xhigh",
        },
      }),
    ).toEqual({ provider: "signed", model: "fast", thinking: "off" });
  });
  test("a saved Pi selection stays visible while its catalog loads without exposing API-key fields", () => {
    const html = renderToStaticMarkup(<LabForm lab={lab} onSaved={() => {}} />);
    expect(html).toContain('value="pi" selected=""');
    expect(html).toContain('value="saved-provider" selected=""');
    expect(html).toContain('value="saved-model" selected=""');
    expect(html).toContain(
      "Pico keeps its own profile, separate from your personal Pi.",
    );
    expect(html).toContain('name="piThinking"');
    expect(html).not.toContain('name="credentialVariable"');
    expect(html).not.toContain('name="providerEndpoint"');
  });
  test("opening an existing demonstration laboratory retains its mode", () => {
    const html = renderToStaticMarkup(
      <LabForm
        lab={{
          ...lab,
          settings: {
            ...lab.settings,
            provider: { ...lab.settings.provider, mode: "demo", model: "demo" },
          },
        }}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain('value="demo" selected=""');
    expect(html).toContain("The demonstration uses a scripted model.");
    expect(html).not.toContain('name="piProvider"');
  });
});
