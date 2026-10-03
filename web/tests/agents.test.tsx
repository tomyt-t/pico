import { expect, spyOn, test } from "bun:test";
import type {
  AgentDefinition,
  AgentRun,
  AgentSkill,
  Lab,
  LabContext,
  ModelSummary,
} from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";

/** Currency formatting uses non-breaking spaces; the assertions read plain ones. */
const plain = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node).replace(/\u00a0/g, " ");

import * as polling from "@/web/api/use-poll";
import { CampaignActivity } from "@/web/features/campaigns/campaign-activity";
import {
  AgentRunHeader,
  AgentRunView,
  agentLog,
} from "@/web/features/chat/agent-activity";
import { AgentsPane, agentPatch } from "@/web/features/settings/agent-settings";
import {
  ResourceEditor,
  ResourcesPane,
  resources,
} from "@/web/features/settings/instruction-settings";
import { LabPane } from "@/web/features/settings/settings-dialog";

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
const agent: AgentDefinition = {
  id: "bibliography",
  name: "Pesquisa bibliográfica",
  description: "Busca e leitura de fontes",
  instructions: "Read sources",
  skillId: "literature-review",
  whenToUse: "Find literature",
  provider: "fake",
  model: "fake-1",
  thinking: "medium",
  updatedAt: lab.createdAt,
};
const model: ModelSummary = {
  provider: "fake",
  id: "fake-1",
  name: "Fake",
  reasoning: true,
  input: ["text"],
  contextWindow: 10000,
};
const run = (patch: Partial<AgentRun>): AgentRun => ({
  campaignId: null,
  id: "run-1",
  labId: lab.id,
  agentId: agent.id,
  name: agent.name,
  task: "Pesquisar métodos",
  label: null,
  status: "running",
  provider: "fake",
  model: "fake-1",
  thinking: "medium",
  result: "",
  error: null,
  sessionFile: "/sessions/run-1.jsonl",
  currentTool: "web_search",
  streamingText: "",
  usage: { total: 0, cost: 0 },
  notified: false,
  createdAt: lab.createdAt,
  endedAt: null,
  ...patch,
});
const now = Date.parse("2026-10-01T10:04:00Z");

function responses(values: Record<string, unknown>) {
  return spyOn(polling, "usePoll").mockImplementation(
    <T,>(path: string | null) => ({
      data: values[path ?? ""] as T,
      loading: false,
      error: undefined,
      status: undefined,
      refresh: () => {},
    }),
  );
}

test("the panel shows parallel instances and pending deliveries as rows, excluding delivered history", () => {
  const query = responses({
    "/labs/lab/campaigns": [],
    "/labs/lab/agent-runs?active=1": [
      run({ task: "Métodos A" }),
      run({ id: "run-2", task: "Métodos B" }),
      run({
        id: "run-3",
        task: "Falha pendente",
        status: "failed",
        error: "Unavailable",
      }),
      run({
        id: "run-4",
        task: "Histórico entregue",
        status: "completed",
        notified: true,
      }),
    ],
  });
  try {
    const html = plain(<CampaignActivity lab={lab} />);
    expect(html.match(/class="agent-row is-/g)).toHaveLength(3);
    expect(html).toContain('class="agent-row is-error"');
    expect(html).toContain("2 de 3");
    expect(html).toContain("buscando na web");
    expect(html).toContain("Falhou · Entregando resultado ao Pico");
    expect(html).toContain("Nenhuma campanha em andamento.");
    expect(html).toContain("2 especialistas");
    expect(html).not.toContain("Histórico entregue");
    expect(html).not.toContain("Métodos A");
  } finally {
    query.mockRestore();
  }
});

test("empty and unknown activity are distinct", () => {
  let query = responses({
    "/labs/lab/campaigns": [],
    "/labs/lab/agent-runs?active=1": [],
  });
  try {
    const html = plain(<CampaignActivity lab={lab} />);
    expect(html).toContain("Nada em execução");
    expect(html).toContain('class="dot idle"');
  } finally {
    query.mockRestore();
  }
  query = responses({});
  try {
    const html = plain(<CampaignActivity lab={lab} />);
    expect(html).toContain('class="dot"');
    expect(html).not.toContain("Nada em execução");
  } finally {
    query.mockRestore();
  }
});

test("the agents pane lists profiles with their models and saves only what changed", () => {
  const query = responses({
    "/agents": [
      agent,
      {
        ...agent,
        id: "experimentation",
        name: "Experimenter",
        description:
          "Design experiments, prepare data, implement and run protocols.",
        model: null,
        provider: null,
      },
    ],
    "/models": [model],
  });
  try {
    const html = plain(<AgentsPane onClose={() => {}} />);
    expect(html).toContain("Pesquisa bibliográfica");
    expect(html).toContain("Experimentação");
    expect(html).toContain('value="fake/fake-1" selected=""');
    expect(html).toContain("Selecione um modelo");
    expect(html).toContain("Raciocínio");
    expect(html).toContain("todos os laboratórios");
    expect(html).toMatch(/<button type="submit" class="primary" disabled=""/);
  } finally {
    query.mockRestore();
  }
  expect(agentPatch(agent, {}, [model])).toBeNull();
  expect(agentPatch(agent, { model: "fake/fake-1" }, [model])).toBeNull();
  expect(agentPatch(agent, { thinking: "high" }, [model])).toEqual({
    provider: "fake",
    model: "fake-1",
    thinking: "high",
  });
  expect(
    agentPatch(agent, { thinking: "high" }, [{ ...model, reasoning: false }]),
  ).toEqual({ provider: "fake", model: "fake-1", thinking: "off" });
  expect(agentPatch(agent, { name: "Bibliografia" }, [model])).toEqual({
    name: "Bibliografia",
  });
  expect(agentPatch(agent, { name: agent.name }, [model])).toBeNull();
});

test("the instance panel names the agent, keeps errors and outcomes and logs each tool call", () => {
  const failed = run({
    status: "failed",
    error: "Provider unavailable",
    result: "Evidências parciais",
    notified: false,
    usage: { total: 125, cost: 0.012 },
  });
  const started = Date.parse(failed.createdAt);
  const messages = [
    {
      id: "m-1",
      role: "user" as const,
      text: failed.task,
      timestamp: started,
    },
    {
      id: "m-2",
      role: "assistant" as const,
      text: "",
      toolCalls: [
        { id: "c1", name: "web_search", arguments: { query: "métodos" } },
      ],
      timestamp: started + 5_000,
    },
    {
      id: "m-3",
      role: "tool" as const,
      toolCallId: "c1",
      toolName: "web_search",
      text: "3 resultados",
      timestamp: started + 65_000,
    },
    {
      id: "m-4",
      role: "assistant" as const,
      text: "Leitura realizada",
      timestamp: started + 70_000,
    },
  ];
  const log = agentLog(messages, failed.createdAt, true);
  expect(log.map((entry) => entry.kind)).toEqual(["tool", "text"]);
  expect(log[0]).toMatchObject({ time: "1:05" });
  const html = plain(
    <>
      <AgentRunHeader run={failed} scope="2 de 3" now={now} />
      <AgentRunView
        detail={{ run: failed, messages, before: null, usage: failed.usage }}
        messages={messages}
        now={now}
      />
    </>,
  );
  expect(html).toContain("Pesquisa bibliográfica");
  expect(html).toContain("2 de 3");
  expect(html).toContain('class="chip error"');
  expect(html).toContain("Provider unavailable");
  expect(html).toContain("Evidências parciais");
  expect(html).toContain("Entregando resultado ao Pico");
  expect(html).toContain("1 chamada");
  expect(html).toContain("web_search");
  expect(html).toContain("Leitura realizada");
  expect(html.match(/Pesquisar métodos/g)).toHaveLength(1);
});

test("settings expose database instructions, skill examples, shared templates and lab context", () => {
  const skill: AgentSkill = {
    id: "literature-review",
    name: "Literature review",
    description: "Stored scope",
    instructions: "DATABASE_SKILL_PROCEDURE",
    examples: "DATABASE_SKILL_EXAMPLE",
    updatedAt: lab.updatedAt,
  };
  const prompt = {
    id: "shared",
    name: "Shared instructions",
    content: "DATABASE_SHARED_PROMPT",
    updatedAt: lab.updatedAt,
  };
  const context: LabContext = {
    content: "DATABASE_LAB_DIRECTION",
    revision: 3,
    updatedAt: lab.updatedAt,
  };
  const query = responses({
    "/skills": [skill],
    "/prompts": [prompt],
    "/labs/lab/context": context,
  });
  try {
    const html = plain(<ResourcesPane onClose={() => {}} />);
    expect(html).toContain("Shared instructions");
    expect(html).toContain("DATABASE_SHARED_PROMPT");
    expect(html).toContain("Literature review");
    expect(html).toContain("Stored scope");
    expect(html).not.toContain("DATABASE_SKILL_PROCEDURE");
    const [item] = resources([], [skill]);
    if (!item) throw new Error("expected a skill");
    const editor = plain(
      <ResourceEditor item={item} draft={{}} onChange={() => {}} />,
    );
    expect(editor).toContain("DATABASE_SKILL_PROCEDURE");
    expect(editor).toContain("DATABASE_SKILL_EXAMPLE");
    const laboratory = plain(
      <LabPane lab={lab} onSaved={() => {}} onClose={() => {}} />,
    );
    expect(laboratory).toContain("DATABASE_LAB_DIRECTION");
    expect(laboratory).toContain("revisão 3");
  } finally {
    query.mockRestore();
  }
});
