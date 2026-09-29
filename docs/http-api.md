# HTTP contract

All routes below are under `/api`. Successful responses are the indicated JSON
value directly. Errors use `{ "error": { "code": "...", "message": "..." } }`.
Mutating clients send `Idempotency-Key: <unique UUID>` and reuse it when retrying
the same intent. Shared types and schemas are exported by `@pico/lab/contracts`.

| Method / path | Input | Output |
| --- | --- | --- |
| GET /health | — | `{ok:true,version:string}` |
| GET /labs | — | `Lab[]` |
| POST /labs | `CreateLabInput` | `Lab` |
| GET /labs/:labId | — | `Lab` |
| PATCH /labs/:labId | name/researchLine/settings patch | `Lab` |
| GET /labs/:labId/status | — | `LabStatus`: lab and active turn |
| GET /labs/:labId/overview | — | `LabOverview` |
| GET /labs/:labId/conversation | — | `ConversationView` |
| GET /labs/:labId/history?before=messageId&limit=100 | optional cursor and limit 1–200 | `Message[]`, chronological page before the cursor |
| GET /labs/:labId/record-index | — | `RecordReference[]` for navigation |
| GET /labs/:labId/execution | — | `ExecutionStatus`, local capabilities, diagnostic issues and other blocked labs |
| POST /labs/:labId/execution/:runId/repair | `{}` | verified operational state; refuses uncertain live processes |
| POST /labs/:labId/execution/:runId/cleanup | `{}` | `{removed:boolean}`; removes only disposable work after verified termination |
| POST /labs/:labId/chat | `{message:string}` | `Turn` (202; continues on server) |
| POST /labs/:labId/turns/:turnId/stop | `{}` | `Turn` |
| POST /labs/:labId/turns/:turnId/continue | `{}` | `Turn` |
| GET /labs/:labId/provider | — | `ProviderStatus` (no credential values) |
| GET /providers | — | `PiCatalog`: providers, model capabilities, credential-configuration presence and Pi default selection; no secrets |
| POST /labs/:labId/provider/test | `{}` | `ProviderStatus` |
| POST /labs/:labId/questions | text/context/parentId? | `Question` |
| PATCH /labs/:labId/questions/:id | text/context/status + reason | `Question` |
| POST /labs/:labId/hypotheses | questionId/statement/rationale? | `Hypothesis` |
| PATCH /labs/:labId/hypotheses/:id | statement/status/assessment/resultIds + reason | `Hypothesis` |
| POST /labs/:labId/experiments | title/objective/questionIds/protocol + optional Experiment fields | `Experiment` |
| GET /labs/:labId/experiments/:id | — | `ExperimentDetail` |
| PATCH /labs/:labId/experiments/:id | editable Experiment fields + reason | `Experiment` |
| GET /labs/:labId/experiments/:id/files | — | `{files: {path:string,size:number}[]}` |
| GET /labs/:labId/experiments/:id/file?path=... | — | `{path:string,content:string,clipped:boolean}` |
| PUT /labs/:labId/experiments/:id/file | `{path:string,content:string}` | `{path:string}` |
| POST /labs/:labId/experiments/:id/dependencies | `{}`; resolves the existing pyproject.toml into uv.lock | `{output:string}` |
| POST /labs/:labId/experiments/:id/runs | `RunRequest` | `Run` |
| GET /labs/:labId/runs/:runId | — | `Run` |
| GET /labs/:labId/runs/:runId/logs?stream=stdout&tail=200 | — | `{text:string}` |
| POST /labs/:labId/runs/:runId/cancel | `{}` | `Run` |
| GET /labs/:labId/runs/:runId/record | — | export JSON with `run`, referenced results and snapshot |
| GET /labs/:labId/runs/:runId/archive | — | complete run archive with preserved bytes and hashes |
| GET /labs/:labId/runs/:runId/artifact?path=... | — | artifact bytes |
| POST /labs/:labId/results | experimentId/runIds/observations/interpretation/limitations/evidence? | `Result` |
| PATCH /labs/:labId/results/:id | observations/interpretation/limitations/evidence? + reason; runIds stay fixed | `Result` with preserved revision history |
| POST /labs/:labId/conclusions | questionId/statement/resultIds/paperIds/confidence/limitations | `Conclusion` |
| PATCH /labs/:labId/conclusions/:id | status/statement/... + reason | `Conclusion` |
| POST /labs/:labId/datasets | `DatasetRegistration` with uploaded file bytes encoded base64 or utf8 | `DatasetVersion` |
| POST /labs/:labId/papers | title/text/source with authors?/identifier?/url? | `Paper` |
| POST /labs/:labId/papers/import | `{identifier:string}` (DOI or doi.org URL; metadata and abstract) | `Paper` |
| GET /labs/:labId/records/:kind/:id/history | — | `Revision[]` |
| POST /backup | `{destination:string}` local administrative operation | `{path:string}` |

GET JSON responses use ETag and private revalidation, returning 304 for unchanged
data. UI polls while visible, backs off after errors and does not re-render unchanged
responses. Server projections are still computed before conditional comparison.
Keep drafts through
navigation and show request errors. No record is inferred from an optimistic
chat response. REST creation defaults to **demo**; the UI prefers an authenticated
Pi default for new laboratories. Demo tools perform real, bounded local operations
but its scientific narration is simulated. Pi config uses mode=pi, provider,
model and optional thinking. Provider status checks configuration only; actual
inference validates connection/OAuth. The legacy endpoint/model/apiKeyEnv fields
remain for compatibility but are not used for Pi authentication. An advanced
OpenAI-compatible provider can use a server environment variable for its key.
Never transmit the key value to the browser or store it in the research transcript.

The HTTP server binds to loopback, requires JSON for mutations, rejects foreign
origins/hosts, and limits a request to 16 MB. Keys identify one intent; reuse with
different arguments returns 409. Scientific validation errors return 400 and
records outside the selected laboratory return 404. Backups require quiescence.
Artifacts download as attachments with nosniff; arbitrary experiment HTML is
never rendered on the UI origin.

New results persist `evidenceVersion: 1` and an `evidence` array. A metric reference
contains `{kind:"metric",runId,name,value,unit,split,step}`; nullable dimensions
must match the collected observation. An artifact reference contains
`{kind:"artifact",runId,path,sha256}`. References must match terminal runs included
in the result. Legacy records remain readable without fabricated references;
adding evidence creates an authored revision. Supported/refuted hypothesis
assessments require all cited runs to have succeeded, the assessed hypothesis
revision and criteria to be preserved in the run snapshot, matching metric
dimensions and numeric agreement with the criterion. Conflicting outcomes require
an inconclusive assessment. Result revisions mark dependent assessments
`needsReview`, retaining the historical `resultRevisions` used.

Experiment `executionAccess.piProfile` can be changed only by a researcher.
The runner resolves that permission at dispatch and does not inherit the server
environment. This is a trusted local execution policy, not an OS sandbox.
`RunRequest.resources` accepts `memoryMiB` and `gpuDevices`; capabilities specify
which controls the host supports. Reproductions preserve these resources.

Production document responses carry CSP restricting scripts and connections to
the same origin, plus `Referrer-Policy: no-referrer`. Markdown remote images are
explicit links; they never trigger an automatic image request.

During backup or shutdown, new requests receive 503 `UNAVAILABLE`; a concurrent
backup receives 409 `CONFLICT`. Already admitted requests drain before resources
close. The public lab API also rejects `close()` inside `withOperation` with
`CONFLICT`; transport owners close the runtime outside request scopes.
