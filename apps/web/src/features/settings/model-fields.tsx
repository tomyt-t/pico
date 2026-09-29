import type { Lab, ProviderConfig } from "@pico/lab/contracts";
import { Notice } from "@/web/components/primitives";
import type { useModelSelection } from "@/web/features/settings/model-selection";
export function ModelFields({
  selection,
  lab,
}: {
  selection: ReturnType<typeof useModelSelection>;
  lab?: Lab;
}) {
  const {
    mode,
    changeMode,
    catalog,
    piProvider,
    setPiProvider,
    piModel,
    setPiModel,
    thinking,
    setThinking,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    keyEnv,
    setKeyEnv,
    selectedProvider,
    selectedModel,
  } = selection;
  return (
    <>
      <label className="field">
        Pico's model
        <select
          name="providerMode"
          value={mode}
          onChange={(e) => changeMode(e.target.value as ProviderConfig["mode"])}
        >
          <option value="pi">Pi · Pico's isolated profile</option>
          <option value="demo">Demonstration · simulated model</option>
          <option value="openai-compatible">
            Advanced · OpenAI-compatible API
          </option>
        </select>
      </label>
      {mode === "pi" ? (
        <>
          <Notice>
            Sign in with <code>bun run pi</code>, then <code>/login</code>. Pico
            keeps its own profile, separate from your personal Pi.
          </Notice>
          {catalog.loading && (
            <p className="meta" role="status">
              Loading your Pi providers and models…
            </p>
          )}
          {catalog.error && (
            <Notice error>
              Could not refresh the Pi catalog: {catalog.error}.{" "}
              {lab?.settings.provider.mode === "pi"
                ? "Your saved selection is preserved."
                : "You can retry, use the demonstration, or configure the advanced API."}{" "}
              <button
                type="button"
                className="text-button"
                onClick={catalog.refresh}
              >
                Retry
              </button>
            </Notice>
          )}
          {catalog.data?.warning && <Notice>{catalog.data.warning}</Notice>}
          {catalog.data && !catalog.data.providers.length && (
            <Notice>
              No Pi providers are available yet. Run <code>bun run pi</code> and
              sign in with <code>/login</code>, then refresh the catalog.{" "}
              <button
                type="button"
                className="text-button"
                onClick={catalog.refresh}
              >
                Refresh catalog
              </button>
            </Notice>
          )}
          <div className="field-row">
            <label className="field">
              Pi provider
              <select
                name="piProvider"
                required
                value={piProvider}
                onChange={(event) => {
                  const next = catalog.data?.providers.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setPiProvider(event.target.value);
                  setPiModel(next?.models[0]?.id ?? "");
                  setThinking("off");
                }}
              >
                <option value="" disabled>
                  Select a provider
                </option>
                {piProvider && !selectedProvider && (
                  <option value={piProvider}>
                    {piProvider} · saved selection
                  </option>
                )}
                {catalog.data?.providers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.authenticated
                      ? " · signed in"
                      : " · sign-in required"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Pi model
              <select
                name="piModel"
                required
                value={piModel}
                onChange={(event) => {
                  setPiModel(event.target.value);
                  if (
                    selectedProvider?.models.find(
                      (entry) => entry.id === event.target.value,
                    )?.reasoning === false
                  )
                    setThinking("off");
                }}
              >
                <option value="" disabled>
                  Select a model
                </option>
                {piModel && !selectedModel && (
                  <option value={piModel}>{piModel} · saved selection</option>
                )}
                {selectedProvider?.models.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedProvider && !selectedProvider.authenticated && (
            <Notice>
              This provider has no Pi sign-in available. You can save the
              selection now; sign in through Pi before starting an
              investigation.
            </Notice>
          )}
          {catalog.data && piProvider && !selectedProvider && (
            <Notice>
              The saved provider is not in the current Pi catalog. It has been
              preserved; check your Pi configuration before starting an
              investigation.
            </Notice>
          )}
          {selectedProvider && piModel && !selectedModel && (
            <Notice>
              The saved model is not listed by this provider. Choose an
              available model or check your Pi configuration.
            </Notice>
          )}
          {selectedModel && (
            <p className="meta">
              {selectedModel.input.includes("image") ? "Text + image" : "Text"}{" "}
              · {selectedModel.contextWindow.toLocaleString()} token context ·
              up to {selectedModel.maxTokens.toLocaleString()} output tokens
            </p>
          )}
          <label className="field">
            Reasoning effort
            <select
              name="piThinking"
              value={selectedModel?.reasoning === false ? "off" : thinking}
              disabled={selectedModel?.reasoning === false}
              onChange={(event) =>
                setThinking(
                  event.target.value as NonNullable<ProviderConfig["thinking"]>,
                )
              }
            >
              {(
                [
                  "off",
                  "minimal",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {value === "xhigh"
                    ? "Extra high"
                    : value[0]?.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
            <small>
              {selectedModel?.reasoning === false
                ? "This model does not expose reasoning effort."
                : "The selected provider and model determine the available reasoning behavior."}
            </small>
          </label>
        </>
      ) : mode === "demo" ? (
        <Notice>
          The demonstration uses a scripted model. Its tool calls create real
          laboratory records; scientific narration is simulated. Local
          experiments execute only when enabled below.
        </Notice>
      ) : (
        <>
          <label className="field">
            API endpoint
            <input
              name="providerEndpoint"
              required
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <div className="field-row">
            <label className="field">
              Model name
              <input
                name="providerModel"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model identifier"
              />
            </label>
            <label className="field">
              Server key variable
              <input
                name="credentialVariable"
                required
                pattern="[A-Z_][A-Z0-9_]*"
                value={keyEnv}
                onChange={(e) => setKeyEnv(e.target.value)}
                placeholder="PICO_MODEL_API_KEY"
              />
            </label>
          </div>
          <p className="meta">
            Set the API key in that environment variable on the server. Enter
            only its variable name here. Calls use your provider account.
          </p>
        </>
      )}
    </>
  );
}
