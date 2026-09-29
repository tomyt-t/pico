export interface ExecutionStatus {
  blocked: boolean;
  capabilities: {
    platform: string;
    processIdentity: "proc" | "ps";
    memoryLimit: "address-space" | null;
    gpuSelection: "cuda-visible-devices" | null;
    sandbox: false;
  };
  issues: {
    labId: string;
    runId?: string;
    directory: string;
    kind: string;
    reason: string;
  }[];
  runs: { runId: string; state: string; reason?: string }[];
  otherBlockedLabs: { labId: string; name: string }[];
  recoveredPublications: string[];
}
