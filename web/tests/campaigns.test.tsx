import { expect, spyOn, test } from "bun:test";
import type {
  AgentRun,
  Campaign,
  CampaignDetail,
  Job,
  Lab,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";

/** Currency formatting uses non-breaking spaces; the assertions read plain ones. */
const plain = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node).replace(/\u00a0/g, " ");

import * as polling from "@/web/api/use-poll";
import { shortTimestamp } from "@/web/components/format";
import {
  CampaignActivity,
  CampaignTree,
} from "@/web/features/campaigns/campaign-activity";
import {
  CampaignControls,
  CampaignDetailView,
  CampaignHeader,
  CampaignMandate,
} from "@/web/features/campaigns/campaign-dialog";
import { CampaignLimitsForm } from "@/web/features/campaigns/campaign-settings";
import {
  campaignStateLine,
  campaignTone,
  scopeLabel,
} from "@/web/features/campaigns/status";
import { summarize, summaryText } from "@/web/features/campaigns/summary";

const lab: Lab = {
  id: "lab",
  name: "Lab",
  path: "/labs/lab",
  researchLine: "",
  provider: "fake",
  model: "fake-1",
  thinking: "off",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};
const campaign: Campaign = {
  id: "campaign-1",
  labId: lab.id,
  title: "Evidência comparativa",
  objective: "Comparar métodos",
  deliverable: "Síntese com limites",
  context: "",
  plan: "Buscar fontes e confrontar resultados",
  activity: "Revisando literatura",
  summary: "",
  result: "",
  status: "active",
  reason: null,
  budgetUsd: 5,
  maxAgents: 3,
  usage: { cost: 0.5, total: 100 },
  provider: "fake",
  model: "fake-1",
  thinking: "off",
  sessionId: null,
  limitResetsAt: null,
  currentTool: null,
  isWorking: true,
  createdAt: lab.createdAt,
  updatedAt: lab.updatedAt,
  endedAt: null,
};
const run = (id: string, patch: Partial<AgentRun> = {}): AgentRun => ({
  id,
  labId: lab.id,
  campaignId: campaign.id,
  agentId: "bibliography",
  name: "Literature Researcher",
  task: `Tarefa ${id}`,
  label: null,
  status: "running",
  provider: "fake",
  model: "fake-1",
  thinking: "off",
  result: "",
  error: null,
  sessionId: null,
  currentTool: "WebSearch",
  streamingText: "",
  usage: { cost: 0, total: 0 },
  notified: false,
  createdAt: lab.createdAt,
  endedAt: null,
  ...patch,
});
const now = Date.parse("2026-10-01T10:12:00Z");

test("campaign tree keeps only its active children and outcomes awaiting receipt", () => {
  const html = plain(
    <CampaignTree
      campaign={campaign}
      agents={[
        run("active"),
        run("delivery", { status: "completed" }),
        run("history", { status: "completed", notified: true }),
        run("foreign", { campaignId: "campaign-2" }),
      ]}
      now={now}
      onOpen={() => {}}
      onAgent={() => {}}
    />,
  );
  expect(html).toContain('class="campaign-card is-busy"');
  expect(html).toContain("Evidência comparativa");
  expect(html).toContain("Coordenador trabalhando");
  expect(html).toContain("1 especialista · 12 min · US$ 0,50 de US$ 5,00");
  expect(html).toContain('aria-controls="children-campaign-1"');
  expect(html.match(/class="agent-row is-/g)).toHaveLength(2);
  expect(html).toContain("Pesquisa bibliográfica");
  expect(html).toContain("1 de 2");
  expect(html).toContain("buscando na web");
  expect(html).toContain("Concluído · Entregando ao coordenador da campanha");
  expect(html).not.toContain("Tarefa");
});

test("states have their own colour and sentence", () => {
  expect(campaignTone(campaign, 0)).toBe("busy");
  expect(campaignTone({ ...campaign, isWorking: false }, 0)).toBe("active");
  expect(campaignTone({ ...campaign, status: "waiting" })).toBe("waiting");
  expect(campaignTone({ ...campaign, status: "paused" })).toBe("paused");
  expect(campaignTone({ ...campaign, status: "pending" })).toBe("pending");
  expect(
    campaignTone({ ...campaign, status: "pending", reason: "error" }),
  ).toBe("error");
  expect(campaignTone({ ...campaign, status: "completed" })).toBe("done");
  expect(campaignStateLine({ ...campaign, currentTool: "read_records" })).toBe(
    "Coordenador lendo registros",
  );
  expect(campaignStateLine({ ...campaign, isWorking: false }, 2)).toBe(
    "2 especialistas ativos",
  );
  expect(campaignStateLine({ ...campaign, isWorking: false })).toBe(
    "Revisando literatura",
  );
  expect(campaignStateLine({ ...campaign, status: "waiting" })).toBe(
    "Aguardando",
  );
  expect(
    campaignStateLine({ ...campaign, status: "waiting", reason: "results" }),
  ).toBe("Aguardando resultados");
  expect(campaignStateLine({ ...campaign, status: "paused" })).toBe(
    "Por sua decisão",
  );
  expect(
    campaignStateLine({ ...campaign, status: "pending", reason: "rate_limit" }),
  ).toBe("Limite do plano Claude");
  expect(
    campaignStateLine({
      ...campaign,
      status: "pending",
      reason: "rate_limit",
      limitResetsAt: "2026-10-01T15:00:00.000Z",
    }),
  ).toBe(
    `Limite do plano Claude até ${shortTimestamp("2026-10-01T15:00:00.000Z")}`,
  );
  const siblings = [
    run("b"),
    run("a"),
    run("c", { agentId: "experimentation" }),
  ];
  expect(scopeLabel(run("b"), siblings)).toBe("2 de 2");
  expect(scopeLabel(run("c"), siblings)).toBeUndefined();
  expect(
    summaryText(
      summarize(
        [campaign, { ...campaign, id: "closed", status: "completed" }],
        [
          run("x"),
          run("y", { campaignId: null, usage: { cost: 0.25, total: 1 } }),
        ],
      ),
    ).replace(/\u00a0/g, " "),
  ).toBe("1 campanha · 2 especialistas · US$ 0,75");
  expect(summaryText(summarize([], []))).toBe("Nada em execução");
  expect(summaryText(summarize(undefined, []))).toBe("");
});

test("an idle laboratory names the detached job it waits for", () => {
  const job = (id: string, status: Job["status"] = "running") =>
    ({
      id,
      name: `train-${id}`,
      status,
      createdAt: `2026-10-04T1${id}:00:00Z`,
    }) as Job;
  expect(
    summaryText(summarize([], [], [job("2"), job("1", "succeeded")])),
  ).toBe("train-2");
  const two = summarize([], [], [job("2"), job("1")]);
  expect(two.jobs.map((entry) => entry.id)).toEqual(["1", "2"]);
  expect(summaryText(two)).toBe("2 execuções");
});

test("sidebar keeps pending roots without workers, hides closed history and separates Pico agents", () => {
  const values: Record<string, unknown> = {
    "/labs/lab/campaigns": [
      { ...campaign, status: "pending", reason: "budget", isWorking: false },
      { ...campaign, id: "closed", title: "Old campaign", status: "completed" },
    ],
    "/labs/lab/agent-runs?active=1": [run("standalone", { campaignId: null })],
  };
  const query = spyOn(polling, "usePoll").mockImplementation(
    <T,>(path: string | null) => ({
      data: values[path ?? ""] as T,
      loading: false,
      error: undefined,
      status: undefined,
      refresh: () => {},
    }),
  );
  try {
    const html = plain(<CampaignActivity lab={lab} />);
    expect(html).toContain("1 campanha · 1 especialista · US$ 0,50");
    expect(html).toContain('class="campaign-card is-pending"');
    expect(html).toContain("Consumo estimado atingido");
    expect(html).toContain('class="meter"');
    expect(html).not.toContain("campaign-expand");
    expect(html).toContain("Agentes do Pico");
    expect(html).toContain('class="agent-row is-busy"');
    expect(html).toContain("Histórico · 1");
    expect(html).toContain("Nova campanha");
    expect(html).not.toContain("Old campaign");
  } finally {
    query.mockRestore();
  }
});

test("campaign panel leads with the latest progress, the team, the budget and resumption controls", () => {
  const pending: Campaign = {
    ...campaign,
    status: "pending",
    reason: "budget",
    usage: { cost: 5.02, total: 4000 },
  };
  const detail: CampaignDetail = {
    campaign: pending,
    agents: [run("done", { status: "completed", notified: true })],
    jobs: [],
    messages: [],
    before: null,
    usage: pending.usage,
  };
  const html = plain(
    <>
      <CampaignHeader campaign={pending} workers={0} now={now} />
      <CampaignDetailView detail={detail} now={now} />
      <CampaignControls campaign={pending} runningJobs={2} refresh={() => {}} />
      <CampaignMandate campaign={pending} />
    </>,
  );
  expect(html).toContain('class="chip pending"');
  expect(html).toContain("Consumo estimado atingido");
  expect(html).toContain("iniciada há 12 minutos");
  expect(html).toContain("Revisando literatura");
  expect(html).toContain("Buscar fontes e confrontar resultados");
  expect(html).toContain("Histórico da campanha · 1");
  expect(html).toContain("US$ 5,02 de US$ 5,00");
  expect(html).toContain('class="meter warn"');
  expect(html).toContain("Ampliar consumo estimado (US$)");
  expect(html).toMatch(/<input[^>]*step="0.01"[^>]*required=""/);
  expect(html).toContain("Retomar");
  expect(html).toContain("Encerrar");
  expect(html).toContain("Síntese com limites");
  expect(html).not.toContain(">Pausar<");
  const active = plain(
    <CampaignControls campaign={campaign} runningJobs={0} refresh={() => {}} />,
  );
  expect(active).toContain("Pausar");
  expect(active).toContain("Mensagem ao coordenador");
  const closed = plain(
    <CampaignControls
      campaign={{ ...pending, status: "ended" }}
      runningJobs={2}
      refresh={() => {}}
    />,
  );
  expect(closed).toBe("");
  const fresh = plain(
    <CampaignDetailView
      detail={{
        ...detail,
        campaign: { ...campaign, plan: "", activity: "", summary: "" },
      }}
      now={now}
    />,
  );
  expect(fresh).toContain("O coordenador está no primeiro turno");
});

test("campaign defaults expose budget and both parallelism limits", () => {
  const html = plain(
    <CampaignLimitsForm
      initial={{ budgetUsd: 5, maxAgents: 3, labMaxAgents: 6 }}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Limite de consumo estimado por campanha");
  expect(html).toContain("Especialistas por campanha");
  expect(html).toContain("Especialistas no laboratório");
  expect(html).toContain('value="5"');
  expect(html).toContain('value="3"');
  expect(html).toContain('value="6"');
  expect(html).toMatch(/<button type="submit" class="primary" disabled=""/);
});
