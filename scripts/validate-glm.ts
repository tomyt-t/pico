import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLabRuntime } from "@pico/lab";
import { verifyGlmProtocol } from "./glm-protocol";

// Explicit opt-in command: real inference, using the isolated Pico profile.
const arguments_ = process.argv.slice(2);
const resume = arguments_.includes("--resume");
if (
  arguments_.some(
    (argument) => argument.startsWith("--") && argument !== "--resume",
  )
)
  throw new Error("Usage: bun scripts/validate-glm.ts [directory] [--resume]");
const root = resolve(
  arguments_.find((argument) => !argument.startsWith("--")) ??
    "artifacts/stabilization-2026-09/external",
);
await mkdir(root, { recursive: true });
const saved = resume
  ? ((await Bun.file(join(root, "lab.json")).json()) as {
      labId: string;
      model: string;
    })
  : undefined;
if (saved && saved.model !== "zai/glm-5.3")
  throw new Error("The saved validation belongs to another model");
const runtime = createLabRuntime({
  dataDir: join(root, "data"),
  piAgentDir:
    process.env.PICO_PI_AGENT_DIR ?? join(homedir(), ".local/share/pico/pi"),
});
const ctx = () => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" as const },
});
try {
  await runtime.start();
  const lab = saved
    ? runtime.research.getLab(saved.labId)
    : runtime.research.createLab(
        {
          name: "Validação externa — GLM 5.3 — estabilização",
          researchLine:
            "Validação do produto com inferência real e observações sintéticas locais; não é evidência empírica sobre uma população ou outro modelo.",
          settings: {
            executionEnabled: true,
            maxModelSteps: 100,
            maxModelTokens: null,
            maxModelCostUsd: null,
            maxConcurrentRuns: 4,
            maxRunSeconds: 300,
            provider: {
              mode: "pi",
              provider: "zai",
              model: "glm-5.3",
              thinking: "high",
              baseUrl: "https://api.z.ai/api/paas/v4",
              apiKeyEnv: "ZAI_API_KEY",
            },
          },
        },
        ctx(),
      );
  if (
    lab.settings.provider.mode !== "pi" ||
    lab.settings.provider.provider !== "zai" ||
    lab.settings.provider.model !== "glm-5.3"
  )
    throw new Error("Validation laboratory is not configured for zai/glm-5.3");
  await Bun.write(
    join(root, "lab.json"),
    JSON.stringify(
      { labId: lab.id, dataDir: join(root, "data"), model: "zai/glm-5.3" },
      null,
      2,
    ),
  );
  if (!resume) {
    const turn = runtime.conversation.enqueue(
      lab.id,
      `Faça uma validação completa do fluxo científico de Pico, com tools e execução Python local real, sem serviços externos dentro dos runs. É um estudo SINTÉTICO de integração, nunca generalize suas conclusões.
Crie pergunta, hipótese e critérios ANTES de rodar. Use um experimento com 24 observações pareadas: baseline = i/24 e tratamento = baseline+0.2 para i de 0 a 23. Preveja que a média da diferença pareada excede 0.1; registre critério numérico para a métrica delta, sem split/unit/step. Gere Python mínimo que calcula a média e emite métricas segundo o protocolo do runner. Preserve as 24 observações num arquivo de saída JSON/CSV com campos numéricos baseline, treatment e difference em cada linha. Use runtime python, sem dependências de terceiros.
Inicie duas tentativas com a mesma configuração (a segunda deve usar referenceRunId da primeira depois que esta terminar). Avalie os resultados com referências estruturadas às métricas, avalie a hipótese apenas quando existir evidência válida e registre conclusão com limitações. Não invente IDs nem observações. Ao terminar de iniciar um run, aguarde o evento; não faça polling em laço de tools. Sua resposta final deve apontar os registros e distinguir inferência real de GLM 5.3 dos dados sintéticos.`,
      ctx(),
    );
    // Also exercise queueing a researcher's direction while Pico is working.
    runtime.conversation.enqueue(
      lab.id,
      "Orientação adicional: a conclusão deve informar n=24, o uso de dados sintéticos determinísticos, a ausência de variabilidade amostral real e que reproduzir os mesmos dados não cria amostras independentes. Preserve esta instrução durante toda a tarefa.",
      ctx(),
    );
    console.log(
      JSON.stringify({
        event: "started",
        labId: lab.id,
        turnId: turn.id,
        model: "zai/glm-5.3",
        budget: "unlimited",
      }),
    );
  } else
    console.log(
      JSON.stringify({ event: "resumed", labId: lab.id, model: "zai/glm-5.3" }),
    );
  let previous = "";
  let idle = 0;
  const resumed = new Set<string>();
  while (true) {
    const overview = runtime.research.overview(lab.id);
    const view = runtime.research.conversationView(lab.id);
    const state = JSON.stringify({
      turns: view.turns.map((t) => ({
        id: t.id,
        status: t.status,
        steps: t.steps,
        error: t.error,
      })),
      runs: overview.runs.map((r) => ({ id: r.id, status: r.status })),
      results: overview.results.length,
      conclusions: overview.conclusions.length,
      usage: view.usage,
    });
    if (state !== previous) {
      console.log(state);
      previous = state;
    }
    for (const t of view.turns) {
      if (
        (t.status === "paused" ||
          (resume &&
            ["interrupted", "cancelled", "failed"].includes(t.status))) &&
        !resumed.has(`${t.id}:${t.steps}`)
      ) {
        resumed.add(`${t.id}:${t.steps}`);
        runtime.conversation.continue(lab.id, t.id, ctx());
      } else if (t.status === "failed")
        throw new Error(`External turn failed: ${t.error}`);
    }
    const original = [...overview.runs]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .find((run) => run.status === "succeeded" && !run.referenceRunId);
    const researcherBusy = view.turns.some(
      (t) =>
        t.trigger === "researcher" &&
        ["queued", "running", "paused", "interrupted"].includes(t.status),
    );
    const hasReproduction =
      original &&
      overview.runs.some(
        (run) =>
          run.referenceRunId === original.id &&
          ["queued", "running", "succeeded"].includes(run.status),
      );
    if (original && !hasReproduction && !researcherBusy) {
      const followup = runtime.conversation.enqueue(
        lab.id,
        `Continue a validação sintética autorizada: o run original ${original.id} do experimento ${original.experimentId} terminou com sucesso. Se ainda não houver reprodução em fila, executando ou concluída, inicie UMA reprodução usando somente experimentId e referenceRunId=${original.id}; omita args, config e resources, pois reprodução preserva esses campos. Depois aguarde os eventos sem polling em laço. Analise as duas execuções, cite métricas verificadas e registre hipótese/conclusão com n=24, dados sintéticos determinísticos, ausência de variabilidade amostral real e nenhuma amostra independente adicional pela reprodução.`,
        {
          key: `external-validation:${lab.id}:reproduce:${original.id}`,
          actor: { kind: "researcher" },
        },
      );
      if (
        ["queued", "running", "paused"].includes(
          runtime.conversation.getTurn(lab.id, followup.id).status,
        )
      ) {
        idle = 0;
        await Bun.sleep(2000);
        continue;
      }
    }
    const busy =
      view.turns.some((t) =>
        ["queued", "running", "paused"].includes(t.status),
      ) || overview.runs.some((r) => ["queued", "running"].includes(r.status));
    idle = busy ? 0 : idle + 1;
    if (idle >= 3) {
      const report = {
        labId: lab.id,
        model: "zai/glm-5.3",
        overview,
        conversation: view,
        history: runtime.research.readHistory(lab.id, { limit: 200 }),
      };
      await Bun.write(
        join(root, "report.json"),
        JSON.stringify(report, null, 2),
      );
      const validation = await verifyGlmProtocol(overview, async (run, path) =>
        (
          await runtime.research.readRunFile(lab.id, run.id, "outputs", path)
        ).toString("utf8"),
      );
      await Bun.write(
        join(root, "validation.json"),
        JSON.stringify(validation, null, 2),
      );
      console.log(
        JSON.stringify({
          event: "complete",
          labId: lab.id,
          report: join(root, "report.json"),
          validation: join(root, "validation.json"),
          usage: view.usage,
        }),
      );
      break;
    }
    await Bun.sleep(2000);
  }
} finally {
  await runtime.close();
}
