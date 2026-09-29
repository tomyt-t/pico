import type { Lab, LabSettings, ProviderStatus } from "@pico/lab/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { Notice } from "@/web/components/primitives";
import { ModelFields } from "@/web/features/settings/model-fields";
import { useModelSelection } from "@/web/features/settings/model-selection";
import { useProviderStatus } from "@/web/features/settings/settings-queries";

export function LabForm({
  lab,
  onSaved,
  onCancel,
}: {
  lab?: Lab;
  onSaved: (lab: Lab) => void;
  onCancel?: () => void;
}) {
  const selection = useModelSelection(lab);
  const [name, setName] = useState(lab?.name ?? "My laboratory");
  const [line, setLine] = useState(lab?.researchLine ?? "");
  const [execution, setExecution] = useState(
    lab?.settings.executionEnabled ?? false,
  );
  const [seconds, setSeconds] = useState(lab?.settings.maxRunSeconds ?? 120);
  const [steps, setSteps] = useState(lab?.settings.maxModelSteps ?? 16);
  const action = useMutation();
  const test = useMutation();
  const provider = useProviderStatus(lab?.id);
  const [tested, setTested] = useState<ProviderStatus | null>(null);

  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const settings: LabSettings = {
          executionEnabled: execution,
          maxRunSeconds: seconds,
          maxConcurrentRuns: lab?.settings.maxConcurrentRuns ?? 1,
          maxModelSteps: steps,
          provider: selection.configuration,
        };
        const saved = await action.mutate<Lab>(
          lab ? labPath(lab.id) : "/labs",
          { name: name.trim(), researchLine: line.trim(), settings },
          lab ? "PATCH" : "POST",
        );
        if (saved) onSaved(saved);
      }}
    >
      {action.error && (
        <Notice error>
          {action.error} You can retry without duplicating the request.
        </Notice>
      )}
      <label className="field">
        Laboratory name
        <input
          name="laboratoryName"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        Research line
        <textarea
          name="researchLine"
          placeholder="For example, defenses for multimodal language models"
          value={line}
          maxLength={3000}
          onChange={(e) => setLine(e.target.value)}
        />
        <small>
          A direction for the work. Questions can emerge during the
          conversation.
        </small>
      </label>
      <ModelFields selection={selection} lab={lab} />
      <label className="run-selection">
        <input
          name="executionEnabled"
          type="checkbox"
          checked={execution}
          onChange={(e) => setExecution(e.target.checked)}
        />
        <span>Allow experiments to execute on this machine</span>
      </label>
      <div className="field-row">
        <label className="field">
          Run time limit (seconds)
          <input
            name="runTimeLimit"
            type="number"
            required
            min={1}
            max={86400}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
        <label className="field">
          Model steps per turn
          <input
            name="turnStepLimit"
            type="number"
            required
            min={1}
            max={100}
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
          />
        </label>
      </div>
      {lab && (
        <div className="stack">
          <div className="actions">
            <span className="meta">
              Saved provider:{" "}
              {provider.data?.detail ??
                (provider.error || "Checking configuration…")}
            </span>
            <button
              type="button"
              className="small"
              disabled={test.busy}
              onClick={async () => {
                const result = await test.mutate<ProviderStatus>(
                  labPath(lab.id, "/provider/test"),
                );
                if (result) setTested(result);
              }}
            >
              {test.busy ? "Checking…" : "Check saved provider"}
            </button>
          </div>
          {tested && (
            <Notice error={!tested.configured}>{tested.detail}</Notice>
          )}
          {test.error && <Notice error>{test.error}</Notice>}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={action.busy || selection.piIncomplete}
        >
          {action.busy ? "Saving…" : lab ? "Save changes" : "Create laboratory"}
        </button>
      </div>
    </form>
  );
}
