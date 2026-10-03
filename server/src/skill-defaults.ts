/** Bootstrap content only; the editable runtime source lives in agent_skills. */
export const defaultSkills = [
  {
    id: "campaign-coordination",
    name: "Campaign coordination",
    description:
      "Coordinate an autonomous research campaign toward a defined deliverable within its resource limits.",
    instructions: `# Campaign coordination
Read the campaign objective, deliverable, context, current plan and existing results. Keep the scope bounded, but adapt the path when evidence changes. Use campaign_progress to record the plan, current activity and meaningful findings.
Delegate self-contained assignments with run_subagent. Specify the question, scope, relevant records and files, expected output and boundaries around shared edits. Several instances may work in parallel. Capacity exhaustion means waiting; no assignment has been queued, so decide what to launch when capacity becomes available.
After launching work, call campaign_progress with action wait. End the turn instead of polling. Worker and detached-job outcomes arrive in this persistent session. Inspect unfinished jobs before starting replacements, especially after a restart. Interrupted workers may have saved useful partial records and files.
Integrate observations, interpretations and conflicting findings. Save useful records with evidence and limitations. At meaningful milestones use summary to tell Pico what changed, affected record ids and any request to create or revise research pages. Pico coordinates the shared Research Editor; do not edit the Panorama concurrently with it. If your deliverable depends on editorial work or Pico's coordination, use action wait_for_pico and explain the request in summary. Read Pico's response from the updated campaign context and inspect the referenced pages before completing the deliverable. Operational handoffs do not need a researcher decision.
Use action needs_input for a decision belonging to the researcher, explaining the precise question in summary. Budget exhaustion also waits for the researcher; only they can add budget. Existing jobs continue while paused or pending.
When the deliverable is ready and outstanding work is reconciled, call campaign_progress with action complete and a substantive result: answer or synthesis, evidence and references, relevant pages/records/files, limitations and unresolved questions. Distinguish an inconclusive scientific result from an unfinished process.`,
    examples: `# Example coordination
For a comparison of two approaches, assign independent literature scopes, integrate the reports, then ask a critical analyst which comparison would resolve the main uncertainty. If warranted, delegate a reproducible experiment. Wait for its actual outputs before interpreting them. Send Pico a milestone with the evidence and page ids to revise. These steps are suggestions, not a fixed workflow.`,
  },
  {
    id: "literature-review",
    name: "Literature review",
    description:
      "Find and compare literature for a bounded research question, grounding the synthesis in inspected sources.",
    instructions: `# Literature review

## Scope and evidence
Read the assignment and laboratory context. Identify the question, relevant terminology and search boundaries. Inspect existing paper records before saving another copy of a source.
Use web_search to discover sources, fetch_content or save_paper to retrieve them, and read to inspect saved text. Separate claims supported by full text from leads supported only by an abstract or search snippet. State access limitations.
Compare the methods, populations or datasets, measurements and limitations that matter for the assigned question. Follow disagreements to their assumptions and evidence. A lack of results in your search is not proof that no work exists.

## Records and handoff
Save useful sources with save_paper and keep their identifiers. Use save_record for the synthesis or research questions worth retaining; link the underlying sources. Include negative and conflicting findings.
Return the answer the literature currently supports, its sources, relevant record ids, limits of the search and concrete open questions. Propose critical analysis when the interpretation requires it.
Use read_skill with id literature-review and examples=true for an example of evidence comparison.`,
    examples: `# Comparing evidence
A useful synthesis might say: "Study A measures retrieval accuracy in a curated collection; Study B measures downstream decisions in a noisy collection. Their scores answer different questions. Our lab still needs a comparison using the same collection and metric."
Attach real source identifiers and relevant passages. Explain whether each source was read in full, partly accessible or only discovered. These illustrative studies are not actual references.`,
  },
  {
    id: "research-experiment",
    name: "Research experiment",
    description:
      "Design, implement and run an experiment whose outputs can answer the assigned research question.",
    instructions: `# Research experiment

## Before execution
Read the question, prior findings and dataset records. Describe the comparison, controls, measurement and how possible outcomes would bear on the hypothesis. Adapt the protocol to available data; identify decisions that require the researcher.
Inspect data definitions, units, identities, time boundaries and train/test separation before interpreting model performance. Keep transformations and exclusions explicit. Register new datasets with register_dataset.

## Execution and evidence
Keep code and protocol in experiments/<name>/ and each attempt's outputs in runs/<n>/. Use bash for quick checks and run_job for long executions, supplying experiment_id and metrics_path when available. Record inputs, command, parameters and environment details needed to repeat the work.
Inspect actual outputs before reporting a measurement. Check figure axes, units and ordering against the data. Preserve negative and inconclusive outcomes alongside successful ones.

## Handoff
Use save_record for the protocol and observations, linking the experiment, dataset, result and job. Distinguish measurements from interpretation and list relevant files and limitations.
For unfinished jobs, hand Pico their ids and the remaining analysis. A started or successful process alone does not establish a scientific result; do not wait in polling loops.`,
    examples: `# Reporting a pending experiment
"The protocol and implementation are saved in the linked experiment. Job <actual-job-id> is running. The main comparison will be evaluated after its output is available; no outcome has been measured yet."
Replace placeholders with actual ids and paths. After completion, report the measured comparison, uncertainty where available, diagnostic checks and limitations.`,
  },
  {
    id: "critical-review",
    name: "Critical review",
    description:
      "Review a proposed protocol or an existing conclusion against evidence and plausible alternative explanations.",
    instructions: `# Critical review

## Choose the review
Before execution, identify the claim the protocol could distinguish and whether the controls and measurements address it. After execution, read actual records, source material, code and outputs relevant to the claim.
Trace important assertions to their evidence. Examine plausible confounding, data leakage, selection effects, uncertainty and limits of generalization. Distinguish a demonstrated defect from a possible concern and from information that is unavailable.

## Useful criticism
State which conclusions remain supported, which need qualification and which are contradicted. Preserve evidence that works against a preferred explanation. Avoid turning a suggestive pattern into a causal claim.
For consequential uncertainty, propose a concrete check and explain how different outcomes would change the interpretation. Record the assessment with save_record and links to reviewed material; use reason when updating an existing hypothesis or conclusion.

## Handoff
Return the assessment, supporting record ids and paths, unresolved questions and the smallest useful next investigation. Scientific questions remain explicit for Pico to coordinate.`,
    examples: `# Revising an interpretation
"An early separation appeared in the figure. Inspection showed that the grouping used identities assigned from later outcomes, so the plot does not establish early predictive information. Recompute the grouping using only information available at prediction time. Until then, the early-prediction claim is unsupported."
Use this reasoning only when the lab's code and data demonstrate the dependency. Label an untested suspicion as a hypothesis.`,
  },
  {
    id: "research-editorial",
    name: "Research editorial",
    description:
      "Explain consolidated research in the Panorama and topic pages, and recover pending or partial editorial reviews.",
    instructions: `# Research editorial

## Establish what changed
Start with review_pages. Read existing pages, changed records and their history, laboratory context and relevant files. Your run covers research versions present at its start; later changes remain pending. Assess every existing page for relevance, including pages that need no text edit.
Use read_skill with id research-editorial and examples=true for examples of a Panorama, topic page and revised conclusion before drafting a new page structure.

## Write an explanation
The Panorama explains the current question, understanding, strongest evidence, limitations and next paths. A topic page develops one question in depth. Reuse its existing id; create another page only for a distinct topic with enough substance.
Lead with what the reader can learn. Build the explanation in Markdown blocks, interleaving selected record references and figures whose captions explain their meaning and limits. Inspect figures, labels and source data; report plotting or scientific problems to Pico for the relevant specialist.
Use save_page. Its body is an alternative readable summary; the main narrative belongs in blocks. Avoid repeating the page title, long undifferentiated lists of record cards and descriptions of internal system mechanics. Match the researcher's language.
Explain when new evidence revises an earlier interpretation. Separate observations, interpretations and hypotheses, keeping useful partial content and unresolved issues visible.

## The shape of a page
A page reads like an essay, and the reader renders it as one: the first block is the lead, records blocks become cited evidence, figures are numbered in order, a blockquote that opens with "Limite:" or "Nota:" becomes an aside.
- Open with a lead of two to four sentences: what the page knows today and the question it answers. No dates, counts of fronts or system details in the lead; the margin shows those.
- One question per section, four to seven sections. Headings in sentence case, short, without decorative dashes: "Quando: decidido no primeiro décimo do voo".
- Within a section: the claim, then the evidence, then the figure. One records block per section with at most three ids, the experiment, the result and the conclusion the passage rests on. Never two records blocks in a row.
- One bold span per paragraph, on the sentence the reader should take away. Numbers carry their unit and interval when known. Record ids never appear in the prose; they go in records blocks.
- A caption has two sentences: what to see, and what limits it. Do not start it with "Figura n"; the reader numbers figures.
- Limits and revisions go in a blockquote starting with "Limite:" or "Nota:", next to the claim they qualify.
- Close with a section "O que permanece aberto" of up to five items, each tied to the record that represents it.
review_pages returns form warnings for each page; fix them before finishing.

## Review and deliver
Re-read the current page before overwriting it and reconcile intervening edits. After saving or reviewing each page, call review_pages with its id, observed revision, a summary and pending issues. Read new artifact references through read_records before acknowledging an unchanged page. Saving content does not acknowledge a review.
Read the returned coverage. Deliver page ids, what changed in the explanation and remaining work. An ended run does not mean every page is current. Do not repeatedly poll or relaunch work.`,
    examples: `# Editorial examples
These examples illustrate structure and reasoning. Replace illustrative claims with evidence from the current laboratory. Select real record ids and existing file paths; omit unavailable references.

## A short page, as saved
save_page({
  "id": "page-signal",
  "title": "Quando o sinal se torna informativo?",
  "placement": "panorama",
  "blocks": [
    { "type": "markdown", "text": "A pergunta: em que momento da sequência o sinal passa a prever o desfecho? A evidência atual sustenta uma separação tardia; a separação precoce aparente dependia de informação futura e precisa de reanálise." },
    { "type": "markdown", "text": "## Quando: a separação acontece tarde\n\nAntes do corte o sinal é indistinguível do acaso (AUC 0,52 [0,49; 0,55]). O salto acontece **nos últimos 30% da sequência**, quando a identidade dos grupos se define." },
    { "type": "records", "ids": ["e-exp01", "r-res01", "c-con01"] },
    { "type": "artifact", "path": "experiments/01-signal/runs/1/figure_curve.png", "caption": "A curva de informação ao longo da sequência: plana até o corte, com o ganho concentrado no fim. Intervalos por bootstrap pareado; o braço sem covariáveis fica dentro do intervalo." },
    { "type": "markdown", "text": "> Limite: a identidade dos grupos é observada em cerca de metade dos instantes; a curva está medida só onde ela aparece." },
    { "type": "markdown", "text": "## O que permanece aberto\n\n- Se o sinal tardio generaliza para a segunda temporada (experimento desenhado, sem execução)." },
    { "type": "records", "ids": ["q-open01"] }
  ],
  "body": "Resumo legível em dois ou três parágrafos, para quem não abre os blocos.",
  "reason": "Separação precoce reinterpretada após a correção da identidade dos grupos"
})

## What not to do
{ "type": "markdown", "text": "## QUANDO — DECIDIDO NO PRIMEIRO DÉCIMO DO VOO\n\n**AUC 0,735** nos **primeiros 10%** com **dois terços** do ganho (r-5073e275, c-9169e28c)…" }
{ "type": "records", "ids": [eight ids] }
{ "type": "records", "ids": [four more ids] }
{ "type": "artifact", "path": "…/figure.png", "caption": "Figura 3 — figura-âncora" }
The heading shouts, three bold spans compete, ids sit in the prose, two records blocks follow each other with twelve cards, and the caption repeats a number the reader already shows.

## Revised conclusion
"The earlier analysis suggested that the signal separated the groups immediately. We later found that group identity depended on future outcomes, so that figure cannot support the early-prediction claim. The corrected analysis supports separation only later in the sequence. We still need to test whether that later signal generalizes."
Link the earlier result and the correction, explaining why the current interpretation supersedes the previous one. Preserve the distinction between an observed correction and an untested possibility.`,
  },
];
