import {
  createRunner,
  fileAccess,
  localRunnerCapabilities,
} from "@pico/runner";
import type { Experiment } from "@/lab/contracts";
import type { ModelAccess } from "@/lab/models/model-contract";
import { createModelGateway } from "@/lab/models/model-gateway";
import { preparePiProfile } from "@/lab/models/pi-profile";
import { PicoSession } from "@/lab/pico/session";
import {
  createLaboratory,
  createResearch,
  createResearchOperations,
  LabError,
  type Research,
  ResearchExecution,
} from "@/lab/research/laboratory";
import { Admission, RuntimeUnavailable } from "@/lab/runtime/admission";
import { publishBackup } from "@/lab/runtime/backup";
import { picoPaths } from "@/lab/runtime/paths";
import type {
  LabRuntime,
  LabRuntimeOptions,
} from "@/lab/runtime/runtime-contract";
import {
  createSourceAccess,
  type SourceAccess,
} from "@/lab/sources/source-access";
import { defaultWebConfig } from "@/lab/sources/web-config";
import { acquireApplicationLock } from "@/lab/storage/application-lock";
import { createStorage, type Storage } from "@/lab/storage/storage";

const researchCapabilities = [
  "getLab",
  "getRecord",
  "labStatus",
  "revisions",
  "history",
  "listLabs",
  "createLab",
  "updateLab",
  "createQuestion",
  "reviseQuestion",
  "createHypothesis",
  "reviseHypothesis",
  "createExperiment",
  "reviseExperiment",
  "registerDataset",
  "importDatasetDirectory",
  "registerPaper",
  "recordResult",
  "reviseResult",
  "recordConclusion",
  "reviseConclusion",
  "overview",
  "recordIndex",
  "experimentDetail",
  "getConversation",
  "conversationView",
  "readHistory",
  "updateSummary",
  "listFiles",
  "readFile",
  "writeFile",
  "lockDependencies",
  "startRun",
  "cancelRun",
  "readDatasetFile",
  "searchLiterature",
  "importPaper",
  "accessSource",
  "readLogs",
  "readRunFile",
  "exportRun",
] as const satisfies readonly (keyof Research)[];

/** Constructs capabilities only; start acquires ownership and completes recovery before admitting work. */
export function createLabRuntime(options: LabRuntimeOptions): LabRuntime {
  let state: LabRuntime["state"] = "constructed";
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let maintenance: Promise<{ path: string }> | undefined;
  let maintaining = false;
  let shutdownRequested = false;
  let release: (() => void) | undefined;
  let storage: Storage | undefined;
  let runner: ReturnType<typeof createRunner> | undefined;
  let operations: ReturnType<typeof createResearchOperations> | undefined;
  let research: Research | undefined;
  let session: PicoSession | undefined;
  let models: ModelAccess | undefined;
  let sources: SourceAccess | undefined;
  const admission = new Admission();

  function required<T>(value: T | undefined): T {
    if (!value) throw new RuntimeUnavailable("Pico runtime is not initialized");
    return value;
  }
  function capabilities<T extends object>(
    keys: readonly (keyof T)[],
    source: () => T,
  ): T {
    return Object.fromEntries(
      keys.map((key) => [
        key,
        (...args: unknown[]) =>
          admission.run(() => {
            const target = source();
            const operation = target[key];
            if (typeof operation !== "function")
              throw new Error(`Unknown capability ${String(key)}`);
            return Reflect.apply(operation, target, args);
          }),
      ]),
    ) as T;
  }

  async function abortConversation(): Promise<void> {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => session?.interrupt()),
      Promise.resolve().then(() => models?.close()),
      Promise.resolve().then(() => sources?.close()),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async function releaseResources(): Promise<void> {
    admission.seal();
    try {
      await runner?.close();
    } finally {
      try {
        for (const conversation of storage?.conversation.listConversations() ??
          [])
          models?.releaseSession?.(conversation.id);
      } finally {
        try {
          storage?.close();
          storage = undefined;
        } finally {
          release?.();
          release = undefined;
        }
      }
    }
  }

  const runtime: LabRuntime = {
    get state() {
      return state;
    },
    withOperation: (operation) => admission.run(operation),
    research: capabilities<Research>(researchCapabilities, () =>
      required(research),
    ),
    conversation: capabilities<LabRuntime["conversation"]>(
      ["enqueue", "stop", "continue", "getTurn"],
      () => required(session),
    ),
    models: {
      catalog: () => admission.run(() => required(models).catalog()),
      status: (labId) =>
        admission.run(() =>
          required(models).status(
            required(research).getLab(labId).settings.provider,
          ),
        ),
      test: (labId) =>
        admission.run(() => {
          const gateway = required(models);
          const config = required(research).getLab(labId).settings.provider;
          return gateway.test ? gateway.test(config) : gateway.status(config);
        }),
    },
    administration: {
      executionStatus: (labId) =>
        admission.run(async () => {
          required(research).getLab(labId);
          const inventory = await required(runner).inventory();
          return {
            blocked:
              inventory.issues.length > 0 ||
              inventory.runs.some((item) => item.state === "unknown"),
            capabilities: localRunnerCapabilities(),
            otherBlockedLabs: [
              ...new Set([
                ...inventory.issues.map((issue) => issue.labId),
                ...inventory.runs
                  .filter((item) => item.state === "unknown")
                  .map((item) => item.record.labId),
              ]),
            ]
              .filter((id) => id !== labId)
              .map((id) => ({
                labId: id,
                name:
                  required(research)
                    .listLabs()
                    .find((item) => item.id === id)?.name ?? id,
              })),
            issues: inventory.issues.filter((issue) => issue.labId === labId),
            runs: inventory.runs
              .filter((item) => item.record.labId === labId)
              .map((item) => ({
                runId: item.record.id,
                state: item.state,
                reason: item.reason,
              })),
            recoveredPublications: inventory.recoveredPublications.filter(
              (path) => path.startsWith(`labs/${labId}/`),
            ),
          };
        }),
      repairExecution: (labId, runId, context) =>
        admission.run(async () => {
          required(research).getRecord(labId, "run", runId);
          return required(operations).effects.run(
            labId,
            "repairExecution",
            { runId },
            context,
            async () => {
              const inspected = await required(runner).repairExecution(
                labId,
                runId,
              );
              await required(operations).reconcile();
              return { state: inspected.state, reason: inspected.reason };
            },
          );
        }),
      cleanupWork: (labId, runId, context) =>
        admission.run(async () => {
          required(research).getRecord(labId, "run", runId);
          return required(operations).effects.run(
            labId,
            "cleanupWork",
            { runId },
            context,
            () => required(runner).cleanupWork(labId, runId),
          );
        }),
      backup(destination, context) {
        admission.assertOpen();
        if (maintaining)
          throw new LabError("CONFLICT", "A backup is already in progress");
        maintaining = true;
        admission.pause();
        session?.pause();
        maintenance = (async () => {
          try {
            await required(runner).pauseDispatch();
            await admission.drain();
            await required(operations).effects.drain();
            if (session?.busy)
              throw new LabError(
                "CONFLICT",
                "Wait for the active conversation before backing up",
              );
            return await publishBackup({
              destination,
              context,
              storage: required(storage),
              runner: required(runner),
              operations: required(operations),
            });
          } finally {
            maintaining = false;
            if (!shutdownRequested && state === "active") {
              await required(runner).resumeDispatch();
              admission.open();
              session?.resume();
            }
          }
        })();
        return maintenance;
      },
    },
    start() {
      if (shutdownRequested || state === "closed")
        return Promise.reject(new RuntimeUnavailable("Pico runtime is closed"));
      starting ??= (async () => {
        state = "starting";
        try {
          const paths = picoPaths(options.dataDir, options.piAgentDir);
          release = acquireApplicationLock(paths.dataDir);
          storage = createStorage(paths.dataDir);
          const lab = createLaboratory(storage);
          preparePiProfile(paths.agentDir, defaultWebConfig);
          models =
            options.models ?? createModelGateway({ agentDir: paths.agentDir });
          sources = options.sources ?? createSourceAccess(paths);
          runner = createRunner({
            dataDir: paths.dataDir,
            maxConcurrent: 4,
            datasetLimits: fileAccess.LOCAL_DATASET_LIMITS,
            environmentBindings: (request): Record<string, string> => {
              const experiment = lab.getRecord<Experiment>(
                request.labId,
                "experiment",
                request.experimentId,
              );
              return experiment.executionAccess?.piProfile
                ? {
                    PICO_PI_AGENT_DIR: paths.agentDir,
                    PI_CODING_AGENT_DIR: paths.agentDir,
                  }
                : {};
            },
            getLabConcurrency: (labId) =>
              lab.getLab(labId).settings.maxConcurrentRuns,
            onUpdate: (record) =>
              required(operations).acceptObservation(record),
          });
          const execution = new ResearchExecution(storage.files, runner);
          operations = createResearchOperations(
            lab,
            storage,
            execution,
            sources,
          );
          research = createResearch({ lab, operations, execution });
          session = new PicoSession({
            lab,
            research,
            conversations: storage.conversation,
            operations: storage.operations,
            adapter: options.model,
            defaultAdapter: models.complete,
          });
          await runner.start();
          await operations.reconcile();
          if (shutdownRequested) return;
          await runner.resumeDispatch();
          if (shutdownRequested) return;
          state = "active";
          admission.open();
          session.start();
        } catch (error) {
          admission.pause();
          try {
            await abortConversation();
          } finally {
            await session?.close();
            await releaseResources();
            state = "closed";
          }
          throw error;
        }
      })();
      return starting;
    },
    close() {
      if (admission.inOperation)
        return Promise.reject(
          new LabError(
            "CONFLICT",
            "Close the runtime outside an admitted operation",
          ),
        );
      if (closing) return closing;
      if (state === "closed") return Promise.resolve();
      shutdownRequested = true;
      admission.pause();
      state = "closing";
      closing ??= (async () => {
        await starting?.catch(() => undefined);
        const stopping = abortConversation();
        const settled = await Promise.allSettled([
          stopping,
          admission.drain(),
          maintenance,
        ]);
        try {
          await session?.close();
          await operations?.effects.drain();
          const stopping = settled[0];
          if (stopping?.status === "rejected") throw stopping.reason;
        } finally {
          await releaseResources();
          state = "closed";
        }
      })();
      return closing;
    },
  };
  return runtime;
}
