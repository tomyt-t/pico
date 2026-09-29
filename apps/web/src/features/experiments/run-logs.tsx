import { useState } from "react";
import { Code, Loading, Notice } from "@/web/components/primitives";
import { useRunLogs } from "@/web/features/experiments/experiment-queries";

export function RunLogs({ labId, runId }: { labId: string; runId: string }) {
  const [stream, setStream] = useState("stdout");
  const logs = useRunLogs(labId, runId, stream);
  return (
    <div>
      <label className="field" style={{ marginTop: 12, marginBottom: 10 }}>
        Log stream
        <select
          value={stream}
          onChange={(event) => setStream(event.target.value)}
        >
          <option value="stdout">Standard output</option>
          <option value="stderr">Standard error</option>
        </select>
      </label>
      {logs.error ? (
        <Notice error>{logs.error}</Notice>
      ) : logs.loading ? (
        <Loading>Reading logs…</Loading>
      ) : (
        <Code>{logs.data?.text || "No output recorded."}</Code>
      )}
      <p className="meta" style={{ marginTop: 8 }}>
        Last 200 lines · updates while this panel is open
      </p>
    </div>
  );
}
