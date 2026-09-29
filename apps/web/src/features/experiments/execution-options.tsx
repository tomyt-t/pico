import type { ExecutionStatus, Experiment, Lab } from "@pico/lab/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { usePoll } from "@/web/api/use-poll";
import { useTranslation } from "@/web/components/i18n";
import { Notice } from "@/web/components/primitives";

export function ExecutionOptions({
  lab,
  experiment,
  refresh,
}: {
  lab: Lab;
  experiment: Experiment;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const action = useMutation();
  const access = useMutation();
  const status = usePoll<ExecutionStatus>(labPath(lab.id, "/execution"), 10000);
  const [memory, setMemory] = useState("");
  const [gpu, setGpu] = useState("");
  const [selectGpu, setSelectGpu] = useState(false);
  return (
    <div className="stack">
      <label className="run-selection">
        <input
          type="checkbox"
          checked={experiment.executionAccess?.piProfile ?? false}
          disabled={access.busy}
          onChange={async (event) => {
            if (
              await access.mutate(
                labPath(lab.id, `/experiments/${experiment.id}`),
                {
                  executionAccess: { piProfile: event.target.checked },
                  reason: "Researcher changed execution model access",
                },
                "PATCH",
              )
            )
              refresh();
          }}
        />
        <span>{t("operations.piAccess")}</span>
      </label>
      <p className="meta">{t("operations.trustedCode")}</p>
      <details>
        <summary>{t("operations.resources")}</summary>
        <div className="field-row">
          <label className="field">
            {t("operations.memory")}
            <input
              type="number"
              min={64}
              step={1}
              value={memory}
              disabled={!status.data?.capabilities.memoryLimit}
              placeholder={t("operations.unlimited")}
              onChange={(event) => setMemory(event.target.value)}
            />
          </label>
          <label className="field">
            {t("operations.gpu")}
            <input
              value={gpu}
              disabled={!status.data?.capabilities.gpuSelection || !selectGpu}
              placeholder="0,1"
              onChange={(event) => setGpu(event.target.value)}
            />
          </label>
        </div>
        <label className="run-selection">
          <input
            type="checkbox"
            checked={selectGpu}
            disabled={!status.data?.capabilities.gpuSelection}
            onChange={(event) => setSelectGpu(event.target.checked)}
          />
          {t("operations.selectGpu")}
        </label>
        <p className="meta">{t("operations.resourceHint")}</p>
      </details>
      {status.error && <Notice error>{status.error}</Notice>}
      {status.data?.blocked && <Notice error>{t("operations.blocked")}</Notice>}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={
            access.busy ||
            action.busy ||
            !lab.settings.executionEnabled ||
            experiment.status === "archived" ||
            status.data?.blocked
          }
          onClick={async () => {
            const resources = {
              ...(memory && { memoryMiB: Number(memory) }),
              ...(selectGpu && {
                gpuDevices: gpu.trim()
                  ? gpu.split(",").map((id) => id.trim())
                  : [],
              }),
            };
            if (
              await action.mutate(
                labPath(lab.id, `/experiments/${experiment.id}/runs`),
                Object.keys(resources).length ? { resources } : {},
              )
            )
              refresh();
          }}
        >
          {action.busy ? t("common.requesting") : t("workspace.runCurrentCode")}
        </button>
        <span className="meta">
          {lab.settings.executionEnabled
            ? t("workspace.runHint")
            : t("workspace.enableExecution")}
        </span>
      </div>
      {(action.error || access.error) && (
        <Notice error>{action.error || access.error}</Notice>
      )}
    </div>
  );
}
