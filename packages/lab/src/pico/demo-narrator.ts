import { createHash } from "node:crypto";
import type {
  Experiment,
  JsonObject,
  Result,
  Run,
  Turn,
} from "@/lab/contracts";
import type { ModelReply } from "@/lab/models/model-contract";
import type { Laboratory } from "@/lab/research/laboratory";

const program = `import json, os
from pathlib import Path
inputs = Path(os.environ['PICO_INPUTS_DIR'])
source = next(inputs.glob('*/samples.json'))
values = json.loads(source.read_text())
mean = sum(values) / len(values)
outputs = Path(os.environ['PICO_OUTPUT_DIR'])
(outputs / 'metrics.json').write_text(json.dumps([{'name': 'mean', 'value': mean, 'unit': 'score', 'split': 'demo'}, {'name': 'count', 'value': len(values), 'unit': 'examples', 'split': 'demo'}]))
(outputs / 'observations.json').write_text(json.dumps({'values': values, 'mean': mean}))
print(f'Processed {len(values)} preserved samples; mean={mean}')
`;

/** Scripted narrator for exercising the real tools/runner. It is never scientific model evidence. */
export function demoReply(lab: Laboratory, turn: Turn): ModelReply {
  const messages = lab
    .conversationView(turn.labId)
    .messages.filter((message) => message.turnId === turn.id);
  const calls = messages.flatMap((message) =>
    message.toolCall ? [message.toolCall] : [],
  );
  const failure = calls.find((call) => call.status === "failed");
  if (failure)
    return say(
      `The demonstration stopped at ${failure.name}: ${failure.error}. Existing records remain available. Fix the indicated setting or input, then start a new demonstration. This is a scripted narrator, not an external AI model.`,
    );
  const result = <T>(name: string) =>
    calls.find((call) => call.name === name && call.status === "completed")
      ?.result as T | undefined;
  const invoke = (name: string, args: JsonObject): ModelReply => ({
    content: "",
    calls: [{ id: `demo_${turn.steps}_${name}`, name, arguments: args }],
  });

  if (turn.trigger === "run_completed") {
    const event = lab
      .overview(turn.labId)
      .events.find((item) => item.id === turn.eventId);
    if (!event)
      return say(
        "The completion event is unavailable. Inspect the run in Experiments.",
      );
    const run = result<Run>("read_run");
    if (!run) return invoke("read_run", { runId: event.entityId });
    if (run.status !== "succeeded")
      return say(
        `Run ${run.id} ended as ${run.status}. ${run.error ?? "Inspect its logs before changing the experiment."} No scientific conclusion was inferred from this execution failure.`,
      );
    const experiment = lab.getRecord<Experiment>(
      turn.labId,
      "experiment",
      run.experimentId,
    );
    const source = run.snapshot?.codeFiles.find(
      (file) => file.path === "experiment.py",
    );
    const isDemonstration =
      run.snapshot?.config.demonstration === true &&
      source?.sha256 === createHash("sha256").update(program).digest("hex");
    if (!isDemonstration)
      return say(
        `Run ${run.id} completed with ${run.metrics.length} recorded metrics. Configure an external model for scientific interpretation. Demo narration only analyzes its own infrastructure example.`,
      );
    const mean = run.metrics.find((metric) => metric.name === "mean")?.value;
    const count = run.metrics.find((metric) => metric.name === "count")?.value;
    if (mean === undefined || count === undefined)
      return say(
        "Expected demonstration metrics were not collected. Inspect the preserved outputs.",
      );
    const analysis = result<Result>("record_result");
    if (!analysis)
      return invoke("record_result", {
        experimentId: experiment.id,
        runIds: [run.id],
        evidence: run.metrics.map((metric) => ({
          kind: "metric",
          runId: run.id,
          ...metric,
        })),
        observations: `The real local run measured mean=${mean} from count=${count} samples.`,
        interpretation:
          "The calculation demonstrates the laboratory's execution and evidence links.",
        limitations:
          "Four synthetic scalar samples and a scripted narrator. This does not evaluate an LLM or a multimodal defense.",
      });
    if (!result("record_conclusion"))
      return invoke("record_conclusion", {
        questionId: experiment.questionIds[0] ?? "",
        resultIds: [analysis.id],
        statement: `For the preserved demonstration inputs, the executed program reports a mean of ${mean}.`,
        confidence: "low",
        limitations:
          "Infrastructure demonstration only. No generalization to a scientific model or defense.",
      });
    const criterion = run.snapshot?.criteria.find(
      (item) =>
        item.metric === "mean" &&
        item.comparator === "eq" &&
        item.threshold === 2.5,
    );
    if (criterion && !result("revise_hypothesis"))
      return invoke("revise_hypothesis", {
        id: criterion.hypothesisId,
        patch: {
          status: mean === 2.5 ? "supported" : "refuted",
          resultIds: [analysis.id],
          assessment: `Observed mean=${mean}; the preregistered demonstration expectation was 2.5.`,
        },
        reason: "Assessed against the collected local run metric",
      });
    return say(
      `The local run finished: **mean = ${mean}**, **${count} samples**. I linked the run to a result and a provisional conclusion. You can inspect its code, inputs, metrics and logs in Experiments, or reproduce the preserved attempt. This is a real calculation with simulated narration, not a multimodal model evaluation.`,
    );
  }

  if (!/demo|demonstra|start|come[cç]|inici|investiga/i.test(turn.message)) {
    return say(
      "Pico is in demonstration mode: conversation is scripted, while records and local executions are real. Send ‘Start a demonstration’ to exercise the complete research cycle, or configure a model in Laboratory settings to investigate your own questions.",
    );
  }
  if (!lab.getLab(turn.labId).settings.executionEnabled)
    return say(
      "Enable local execution in Laboratory settings, then send ‘Start a demonstration’. Pico will execute a short Python calculation and preserve its inputs, code and outputs. The narration is simulated.",
    );
  const question = result<{ id: string }>("create_question");
  if (!question)
    return invoke("create_question", {
      text: "Can the laboratory preserve and reproduce the mean of a fixed dataset?",
      context:
        "Infrastructure demonstration, separate from the laboratory's real scientific questions.",
    });
  const hypothesis = result<{ id: string }>("create_hypothesis");
  if (!hypothesis)
    return invoke("create_hypothesis", {
      questionId: question.id,
      statement: "The mean of [1, 2, 3, 4] will be 2.5.",
      rationale:
        "A deterministic calculation provides a known reference for testing the execution flow.",
    });
  const dataset = result<{ id: string }>("register_dataset");
  if (!dataset)
    return invoke("register_dataset", {
      name: "Demonstration samples",
      version: turn.id,
      source:
        "Synthetic numbers authored by the built-in infrastructure demonstration",
      license: "CC0",
      splits: { demo: 4 },
      files: [{ path: "samples.json", content: "[1, 2, 3, 4]\n" }],
    });
  const experiment = result<{ id: string }>("create_experiment");
  if (!experiment)
    return invoke("create_experiment", {
      title: "Demonstration: preserved calculation",
      objective: "Exercise the complete record → execution → evidence flow.",
      questionIds: [question.id],
      hypothesisIds: [hypothesis.id],
      datasetVersionIds: [dataset.id],
      protocol:
        "Read the fixed samples.json dataset, compute arithmetic mean and sample count with Python, and preserve metrics and per-sample observations. No external model is invoked.",
      criteria: [
        {
          hypothesisId: hypothesis.id,
          metric: "mean",
          expectation: "Exactly 2.5 for these four fixed inputs",
          comparator: "eq",
          threshold: 2.5,
          unit: "score",
          split: "demo",
        },
      ],
      status: "ready",
    });
  if (!result("write_file"))
    return invoke("write_file", {
      experimentId: experiment.id,
      path: "experiment.py",
      content: program,
    });
  const run = result<Run>("start_run");
  if (!run)
    return invoke("start_run", {
      experimentId: experiment.id,
      timeoutSeconds: Math.min(
        30,
        lab.getLab(turn.labId).settings.maxRunSeconds,
      ),
      config: { seed: 0, demonstration: true },
    });
  return say(
    `I recorded a question, hypothesis, dataset and experiment, then submitted run ${run.id}. The calculation runs independently; its completion will return to this same conversation. All records are real. This demonstration uses a scripted narrator.`,
  );
}
function say(content: string): ModelReply {
  return { content, calls: [] };
}
