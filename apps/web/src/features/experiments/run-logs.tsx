import { useState } from "react";
import { useTranslation } from "@/web/components/i18n";
import { Code, Loading, Notice } from "@/web/components/primitives";
import { useRunLogs } from "@/web/features/experiments/experiment-queries";

export function RunLogs({ labId, runId }: { labId: string; runId: string }) {
  const { t } = useTranslation();
  const [stream, setStream] = useState("stdout");
  const logs = useRunLogs(labId, runId, stream);
  return (
    <div>
      <label className="field" style={{ marginTop: 12, marginBottom: 10 }}>
        {t("logs.stream")}
        <select
          value={stream}
          onChange={(event) => setStream(event.target.value)}
        >
          <option value="stdout">{t("logs.stdout")}</option>
          <option value="stderr">{t("logs.stderr")}</option>
        </select>
      </label>
      {logs.error ? (
        <Notice error>{logs.error}</Notice>
      ) : logs.loading ? (
        <Loading>{t("logs.reading")}</Loading>
      ) : (
        <Code>{logs.data?.text || t("logs.empty")}</Code>
      )}
      <p className="meta" style={{ marginTop: 8 }}>
        {t("logs.footer")}
      </p>
    </div>
  );
}
