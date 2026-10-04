# Pico Claude — migração do runtime Pi para o Claude Agent SDK

Branch: `pico-claude` (git não aceita espaço em nome de branch).
Coloque este arquivo em `docs/pico-claude/README.md` na própria branch.

## Objetivo

Trocar o runtime de agentes do Pico (Pi SDK) pelo **Claude Agent SDK oficial**
(`@anthropic-ai/claude-agent-sdk`), autenticado com a assinatura Claude do
pesquisador, mantendo o máximo do produto: laboratórios, registros, jobs,
campanhas, subagentes paralelos, editorial, UI e HTTP.

O que muda é só a camada de execução do modelo. Banco, tools de domínio,
HTTP e web devem continuar chamando as mesmas funções.

## Restrições (não negociáveis)

1. **Uso pessoal, autenticação oficial.** Login pelo próprio Claude Code
   (`/login` com Pro/Max). Nada de adapter, proxy, header falsificado ou reuso
   de token OAuth fora do SDK/CLI oficial.
2. **Somente consumo do plano. Nunca API paga.** Não existe modo API nesta
   branch. O servidor remove do ambiente passado ao SDK toda credencial ou
   rota que cobre por uso: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
   `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
   `CLAUDE_CODE_USE_FOUNDRY`. Se a chave estivesse presente, o CLI a usaria e
   a cobrança iria para a API. Na subida, o servidor confirma que a
   autenticação ativa é a da assinatura (claude.ai) e **se recusa a iniciar**
   se não for.
3. **Sem cobrança além do plano.** Manter desativado, na conta Claude, qualquer
   uso extra pago / créditos de uso além do limite da assinatura. Com isso
   desativado, ao bater no limite as requisições param até o reset em vez de
   gerar cobrança. Conferir essa configuração antes do primeiro uso.
4. **Só modelos Claude.** O seletor provedor/modelo vira seletor de modelo
   Claude. Não manter Pi em paralelo nesta branch.
5. **Respeitar limites da assinatura.** Os limites de Pro/Max pressupõem uso
   individual comum. Padrões menores de concorrência (ver Fase 6) e tratamento
   explícito de rate limit.
6. Manter as regras do `AGENTS.md`: simplicidade, sem fila/sandbox/validação
   científica novas, migrações aditivas em `server/src/db.ts`, `contracts.ts`
   como módulo folha, testes sem provedor real.

## Regras para o agente que implementar este plano

**Nunca commitar.** O pesquisador lê, aprova e commita manualmente.

- Proibido: `git commit`, `git commit --amend`, `git push`, `git merge`,
  `git rebase`, `git reset` com descarte, `git stash drop`, criar tags ou
  reescrever histórico de qualquer forma.
- Permitido: `git status`, `git diff`, `git diff --staged`, `git log`,
  `git add` e `git restore --staged` (para ajustar o que está em staged).
- Ao fim de cada fase (ou quando houver um conjunto coerente pronto para
  revisão): rodar `bun run check`, colocar **só os arquivos daquela fase** em
  staged com `git add <arquivos>` (nunca `git add -A` às cegas) e parar.
- Ao parar, entregar: lista dos arquivos em staged, resumo do que mudou e por
  quê, resultado do `bun run check`, e uma **sugestão** de mensagem de commit.
  Não seguir para a fase seguinte até o pesquisador confirmar que commitou.
- Se o próprio pesquisador pedir um commit numa conversa, ainda assim só
  preparar o staged e a mensagem sugerida.

Isso vale para o repositório do Pico. Os commits automáticos que o Pico faz
dentro das pastas dos laboratórios (`~/pico-labs/<lab>/`, em `git.ts`) são
comportamento do produto e continuam como estão.

## Criar a branch

```bash
git checkout main && git pull
git checkout -b pico-claude
cd server
bun remove @earendil-works/pi-agent-core @earendil-works/pi-ai \
  @earendil-works/pi-coding-agent pi-web-access
bun add @anthropic-ai/claude-agent-sdk@0.3.288 zod@^4 \
  @anthropic-ai/sdk @modelcontextprotocol/sdk
```

Versão de referência inspecionada: `@anthropic-ai/claude-agent-sdk@0.3.288`
(peer deps: `zod ^4`, `@anthropic-ai/sdk >=0.93`, `@modelcontextprotocol/sdk ^1.29`).
Fixar a versão exata; o SDK muda rápido.

## Onde o Pi está acoplado hoje

| Arquivo | Uso do Pi |
| --- | --- |
| `server/src/sessions.ts` | `createAgentSession`, `DefaultResourceLoader`, `ModelRuntime`, `SessionManager`, eventos, steer/followUp, projeção de mensagens |
| `server/src/tools.ts` | `defineTool` + `typebox` para todas as tools do Pico |
| `server/src/subagents.ts` | `AgentSession` por spawn, `SessionManager.open` para histórico |
| `server/src/campaigns.ts` | `session.agent.streamFunction` / `beforeToolCall` / `shouldStopAfterTurn` (orçamento e parada), `sendCustomMessage` |
| `server/src/pi.ts` | abre o CLI do Pi para `/login` |
| `server/src/config.ts` | `agentDir` (perfil Pi), `web-search.json` |
| `server/src/agent-catalog.ts` | lista de modelos via `ModelRuntime` |
| `server/src/prompt-defaults.ts`, `skill-defaults.ts` | citam tools do Pi (`read`, `bash`, `web_search`, `fetch_content`…) e "Pi session" |
| `server/tests/support.ts` | modelo falso **OpenAI-compatível** |

## Mapeamento de conceitos

| Pi | Agent SDK |
| --- | --- |
| `AgentSession` persistente | `query()` em modo streaming input (`prompt: AsyncIterable<SDKUserMessage>`), mantido vivo por lab/campanha |
| `SessionManager.continueRecent/open` | `resume: <sessionId>`; persistir `session_id` (vem nas mensagens) no lugar de `session_file` |
| `session.messages` | `getSessionMessages(sessionId, { dir })` + buffer em memória do stream |
| `prompt()` | empurrar `SDKUserMessage` na fila de entrada |
| `steer()` | `SDKUserMessage` com `priority: 'now'` (validar semântica, ver Riscos) |
| `followUp()` | `priority: 'next'` ou `'later'` |
| `abort()` | `query.interrupt()`; `close()` ao descartar |
| `before_agent_start` relendo contexto do SQLite | hook `UserPromptSubmit` devolvendo `additionalContext` com contexto do lab, skill, estado da campanha e status editorial |
| `appendSystemPrompt` | `systemPrompt: { type: 'preset', preset: 'claude_code', append: <prompt do Pico> }` |
| `noContextFiles/noSkills/noExtensions` | `settingSources: []` (isola de `~/.claude` e de `CLAUDE.md` no lab) |
| `defineTool` + typebox | `tool(name, desc, zodShape, handler)` dentro de `createSdkMcpServer({ name: 'pico', tools })`; o modelo vê `mcp__pico__save_record` etc. |
| `read, write, edit, bash, grep, find, ls` | `Read, Write, Edit, Bash, Grep, Glob` |
| `pi-web-access` (`web_search`, `fetch_content`, `get_search_content`) | `WebSearch`, `WebFetch` nativos; remover Exa e `web-search.json` |
| `beforeToolCall` bloqueando campanha | hook `PreToolUse` com `permissionDecision: 'deny'` quando `assertRunnable` falha |
| `streamFunction` contando uso | somar `usage` de `SDKAssistantMessage` e/ou `total_cost_usd` de `SDKResultMessage` |
| `shouldStopAfterTurn` | `interrupt()` + `maxBudgetUsd` por query como rede de segurança |
| `message_update` text/thinking delta | `includePartialMessages: true` → `SDKPartialAssistantMessage` (stream events) |
| `compaction_start/end` | `SDKCompactBoundaryMessage` |
| `auto_retry_start` | `SDKAPIRetryMessage` |
| `sendCustomMessage(customType)` | mensagem de usuário com marcador estável, ex. `[pico:campaign-result source=<id>]` no início; a projeção da UI reconhece o marcador e mostra como `role: "system"` |
| thinking levels (`off…max`) | `off` → `thinking: {type:'disabled'}`; `minimal`/`low` → `effort: 'low'`; `medium`, `high`, `xhigh`, `max` → `effort` homônimo, com `thinking: {type:'adaptive'}` |
| sem sandbox | `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` (mesmo comportamento atual; o lab é do modelo) |

Subagentes nativos do SDK (`agents`, tool `Task`/`Agent`) **não** substituem
os subagentes do Pico: o Pico precisa de execuções persistidas, paralelas,
visíveis na UI e entregues ao coordenador. Bloquear com
`disallowedTools: ['Task', 'Agent']` para o modelo não ter dois mecanismos.

## Plano por fases

Cada fase termina com `bun run check` verde e as mudanças da fase em staged
para revisão, sem commit (ver "Regras para o agente").

### Fase 0 — Runtime isolado (`server/src/claude-runtime.ts`, novo)

Criar uma classe `ClaudeSession` que expõe **só o subconjunto da API do Pi
que o Pico usa**, para que `sessions.ts`, `subagents.ts` e `campaigns.ts`
mudem o mínimo:

- `prompt(text)`, `steer(text)`, `followUp(text)`, `abort()`, `dispose()`
- `isStreaming`, `messages` (já projetáveis), `sessionId`, `model`, `thinkingLevel`
- `subscribe(listener)` emitindo os eventos que o Pico já consome
  (`agent_start`, `agent_end`, `message_update`, `message_end`,
  `tool_execution_start/end`, `queue_update`, `compaction_*`, `retry`)
- `appendNote(kind, content, details)` para o antigo `sendCustomMessage`
- `setModel()` / `setThinkingLevel()` via `query.setModel()`; para effort,
  aplicar na próxima query se o SDK não permitir trocar a quente
- ganchos `onBeforeTool` e `onUsage` para campanhas

Internamente: uma fila assíncrona alimenta `query({ prompt: fila, options })`;
um laço consome `SDKMessage` e traduz para os eventos acima. Um turno termina
em `SDKResultMessage`.

Opções base para todo spawn:

```ts
{
  cwd: lab.path,
  model,                       // alias ou id Claude
  systemPrompt: { type: 'preset', preset: 'claude_code', append: picoPrompt },
  settingSources: [],
  mcpServers: { pico: picoServer },
  allowedTools: ['Read','Write','Edit','Bash','Grep','Glob','WebSearch','WebFetch','mcp__pico__*'],
  disallowedTools: ['Task', 'Agent'],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  hooks: { UserPromptSubmit: [...], PreToolUse: [...] },
  resume: sessionId ?? undefined,
  env: claudeEnv(),            // CLAUDE_CONFIG_DIR do Pico, sem nenhuma credencial de API
}
```

### Fase 1 — Autenticação e caminhos

- `config.ts`: `agentDir` vira `claudeConfigDir` (`PICO_DATA_DIR/claude`,
  variável `PICO_CLAUDE_CONFIG_DIR`), modo 0700. Remover `web-search.json`.
- Substituir `pi.ts` por `login.ts`: roda o CLI oficial do Claude Code com
  `CLAUDE_CONFIG_DIR` apontando para o diretório do Pico, para `/login` com a
  assinatura. Script `bun run login` no `package.json` raiz (remover `bun run pi`).
- `claudeEnv()`: copia `process.env`, define `CLAUDE_CONFIG_DIR` e apaga
  sempre as variáveis listadas na restrição 2. Não há opção para mantê-las.
- Na inicialização, verificar a autenticação ativa (`accountInfo()` /
  `SDKAuthStatusMessage`; validar o formato no spike). Se não for login de
  assinatura, encerrar com erro claro pedindo `bun run login`. Nunca imprimir
  segredo.

### Fase 2 — Tools do Pico como MCP in-process (`tools.ts`)

- Reescrever schemas de typebox para zod (mesmos campos, mesmas descrições).
- `createPicoTools` passa a devolver `SdkMcpToolDefinition[]`; um helper
  `picoMcpServer(deps)` monta `createSdkMcpServer({ name: 'pico', tools, alwaysLoad: true })`.
- Handlers chamam exatamente as mesmas funções (`records`, `jobs`, `papers`,
  `datasets`, `subagents`, `campaigns`, `editorial`). Retorno no formato
  `CallToolResult` (`{ content: [{ type: 'text', text }] }`, `isError` em falha).
- O conjunto de tools por papel continua igual (Pico, coordenador de
  campanha, especialista, editor).
- Remover dependência de `typebox` se nada mais usar.

### Fase 3 — Sessão do laboratório (`sessions.ts`)

- `createSession` monta `ClaudeSession` com as opções da Fase 0.
- Contexto dinâmico: o hook `UserPromptSubmit` devolve `additionalContext` com
  o que hoje está em `loader.getAgentsFiles()` (contexto do lab com revisão,
  skill principal, estado da campanha, status editorial). Assim o contexto
  continua fresco a cada turno, como no Pi.
- Persistir `session_id` do Pico por lab (coluna nova aditiva em `labs`, ex.
  `claude_session_id`) e retomar com `resume` após reinício.
- Reescrever `projectMessages`/`projectMessagePage` para o formato do SDK:
  blocos `text`, `thinking`, `tool_use` do assistente; `tool_result` do
  usuário; marcadores `[pico:…]` como `role: "system"`; uso por mensagem a
  partir de `message.usage`. Manter o contrato `UiMessage`/`ChatMessagePage`
  intacto para a web não mudar.
- `send`, `notify`, `deliverSubagentResult`, `abort`, `state`, `subscribe`,
  `setModel` mantêm assinatura. Recibo de entrega continua sendo "o texto está
  no histórico da sessão".
- Commit git em `agent_end` continua igual.

### Fase 4 — Subagentes (`subagents.ts`)

- Cada spawn: nova `ClaudeSession` sem `resume`, prompt = tarefa.
- Gravar `session_id` em `agent_runs.session_file` (ou coluna nova
  `session_id`; preferir coluna nova e deixar a antiga nula).
- Resultado = texto final do `SDKResultMessage` (`result`) ou último
  assistente; `subtype` de erro → `failed`; interrupção → `stopped`.
- Uso: `total_tokens` e `cost` a partir do resultado.
- `detail()` lê histórico com `getSessionMessages(sessionId, { dir: lab.path })`
  quando a execução já terminou.
- Comportamento de reinício igual: execuções `running` viram `interrupted`.

### Fase 5 — Campanhas (`campaigns.ts`)

- `attach()` vira configuração da `ClaudeSession`:
  - `PreToolUse`: se `assertRunnable` falhar, negar e interromper.
  - `onUsage`: `recordUsage` com tokens e custo de cada turno.
  - Antes de enviar um prompt de turno (`campaign-wake`), checar
    `assertRunnable`; a query também recebe `maxBudgetUsd` igual ao saldo.
- `sendCustomMessage` → `appendNote('campaign-result' | 'campaign-direction', …)`.
  A deduplicação por `source` passa a procurar o marcador no histórico.
- Rate limit: ao receber `SDKRateLimitEvent` indicando bloqueio, colocar a
  campanha em `pending` com motivo novo `rate_limit` (adicionar ao contrato) e
  mostrar na UI o horário de reset quando vier no evento. Não tentar em loop
  e nunca cair para outro meio de autenticação.

### Fase 6 — Catálogo de modelos e padrões

- `agent-catalog.ts` e `/api/models`: listar modelos Claude via
  `query.supportedModels()` (cachear na subida) ou lista fixa de aliases
  (`opus`, `sonnet`, `haiku`). `provider` fixo `anthropic`.
- Padrões novos em `campaign_settings` (migração só altera padrões, nunca
  campanhas existentes): especialistas por campanha **2**, por laboratório **3**.
  Sugerir Sonnet para especialistas e Opus só para Pico/coordenador.
- O orçamento em USD continua só como **medida de consumo**: com assinatura,
  `total_cost_usd` é uma estimativa a preço de API, não uma cobrança. Renomear
  na UI para "consumo estimado" e deixar isso claro em Configurações →
  Campanhas. O limite real é o da assinatura.

### Fase 7 — Prompts e skills

- Atualizar `prompt-defaults.ts` e `skill-defaults.ts`: nomes de tools
  (`Read`, `Bash`, `WebSearch`, `WebFetch`, `mcp__pico__save_record`…) e
  remover menções a "Pi session".
- Como seeds não sobrescrevem o banco, adicionar migração que atualiza
  **apenas linhas ainda iguais ao padrão de fábrica antigo** (mesma estratégia
  já usada para nomes traduzidos). Personalizações ficam intactas.

### Fase 8 — Testes

- Trocar o modelo falso OpenAI por um **servidor falso compatível com a
  Messages API da Anthropic** (SSE: `message_start`, `content_block_*`,
  `message_delta`, `message_stop`), suportando texto e `tool_use`.
- Testes usam `ANTHROPIC_BASE_URL=<fake local>` e `ANTHROPIC_API_KEY=test`,
  uma chave falsa que só existe para o servidor falso em `127.0.0.1`; nenhuma
  requisição sai para a Anthropic e nada é cobrado. Isso fica restrito ao
  harness de teste (flag interna `PICO_TEST_FAKE_MODEL`, recusada fora de
  `bun test`), nunca disponível no servidor normal. `CLAUDE_CONFIG_DIR`
  temporário.
- O SDK sobe o CLI como subprocesso, então o fake precisa ser HTTP real;
  `PICO_TEST_IN_PROCESS_MODEL` deixa de valer (documentar).
- Portar os testes existentes (`session`, `subagents`, `campaigns`,
  `editorial-flow`, `chat-history`, `page-records`) mantendo as asserções de
  produto.
- Testes específicos: nenhuma variável da restrição 2 chega ao subprocesso; o
  servidor recusa iniciar sem login de assinatura.

### Fase 9 — Documentação

- README: requisitos (Bun + Claude Code CLI vindo do SDK), `bun run login`,
  variáveis novas, nota de uso pessoal e de limites da assinatura.
- `AGENTS.md`: trocar "Pi SDK cuida de sessão…" por "Claude Agent SDK cuida de…".
- Registrar aqui o que foi validado com modelo falso e o que foi validado com
  a assinatura real.

## Dados existentes

Sessões Pi não são convertidas. A branch deve rodar com um
`PICO_DATA_DIR` novo; labs e registros podem ser reimportados copiando o
SQLite, mas conversas antigas começam do zero. Isso é coerente com "não há
código legado a preservar" no `AGENTS.md`.

## O que se perde ou muda

- Só modelos Claude (sem OpenAI, Gemini, locais).
- Busca web passa a ser a do Claude (`WebSearch`/`WebFetch`), sem Exa.
- `steer` pode não interromper exatamente no mesmo ponto que no Pi.
- Compactação e retries passam a ser os do Claude Code, não configuráveis do
  mesmo jeito.
- Cada sessão ativa é um subprocesso do Claude Code: mais memória por agente.

## Riscos a validar cedo (fazer um spike antes da Fase 3)

1. Semântica de `priority: 'now' | 'next' | 'later'` em streaming input
   durante um turno em andamento (é o equivalente de steer/followUp?).
2. `UserPromptSubmit.additionalContext` dispara também para mensagens
   injetadas no meio do turno, ou só no início? Se só no início, o contexto
   fresco vale por turno, que é o comportamento atual.
3. `resume` + `mcpServers` in-process após reinício do servidor.
4. Formato de `getSessionMessages` para montar a paginação da UI sem reler o
   JSONL inteiro a cada página.
5. Uso e custo por turno em sessões longas (cumulativo ou por query).
6. Política de autenticação: confirmar na data da implementação, em
   https://code.claude.com/docs/en/legal-and-compliance e
   https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan,
   que o Agent SDK com login da assinatura para uso pessoal continua coberto.

## Critério de pronto

- `bun run check` verde com o fake Anthropic.
- Com a assinatura real: criar lab, conversar, rodar um job, iniciar uma
  campanha com 2 especialistas em paralelo, receber resultados no
  coordenador, revisão editorial, pausar/retomar, reiniciar o servidor e
  retomar a sessão do lab.
- Nenhuma referência a `@earendil-works/*` ou `pi-web-access` no código.
- Nenhuma credencial ou rota de API paga no ambiente dos subprocessos.
- Servidor recusa iniciar se a autenticação ativa não for a da assinatura.
- Uso extra pago desativado na conta Claude antes do primeiro uso.

## Registro da implementação

### Fase 0 — spike e runtime (2026-10-03)

Spike feito com `@anthropic-ai/claude-agent-sdk@0.3.288` (CLI embutido
2.1.288) contra o servidor falso da Messages API (`server/tests/fake-anthropic.ts`,
só `127.0.0.1`). Nenhum prompt foi enviado à Anthropic. O único contato com a
conta real foi `accountInfo()` sem prompt, para ver o formato (item 6 abaixo).

Riscos do plano:

1. **`priority`.** `'now'` interrompe a tool em execução (o turno termina com
   `terminal_reason: aborted_tools`) e começa outro turno: não é o `steer` do
   Pi. `'next'` espera a tool terminar e dobra a mensagem no mesmo turno, junto
   do próximo `tool_result`: é o `steer`. `'later'` vira um turno próprio
   depois do atual: é o `followUp`. O runtime usa `next` e `later`.
2. **`UserPromptSubmit`.** Dispara no início do turno e também para cada
   mensagem dobrada no meio dele. Não dispara para notas `shouldQuery: false`.
   O contexto fresco continua valendo por mensagem recebida, como no Pi.
3. **`resume` + MCP in-process.** Funciona num processo novo: mesmo
   `session_id`, tools `mcp__pico__*` disponíveis. Uma instância de
   `createSdkMcpServer` só se liga a um transporte, então o runtime recebe uma
   fábrica de servidores e cria um conjunto por processo. Transcript
   inexistente vira conversa nova em vez de erro.
4. **Histórico.** `getSessionMessages` devolve `user`/`assistant` com
   `timestamp` e `usage` final. Cada bloco de conteúdo é uma entrada separada
   que compartilha `message.id` (a projeção da Fase 3 deve juntar por id e
   contar o uso uma vez). Mensagens dobradas aparecem como mensagens de usuário
   comuns (`isQueuedCommand`), então o recibo "o texto está no histórico"
   continua valendo. O SDK lê `CLAUDE_CONFIG_DIR` do **processo do servidor**,
   não do subprocesso: a Fase 1 precisa defini-lo no processo. A opção `dir`
   falha no Windows quando o caminho do lab difere do canônico (nome curto
   8.3); como os ids são UUIDs num diretório de config privado, o runtime lê
   sem `dir`. O runtime mantém o transcript em memória e relê do disco uma vez
   ao fim de cada turno; páginas da UI saem da memória.
5. **Uso e custo.** `result.usage` é por turno. `total_cost_usd` é cumulativo
   por processo e, após `resume`, continua do total salvo no transcript. O
   runtime calcula o delta por turno a partir de `costBaseline`; a campanha
   (Fase 5) precisa persistir o total já registrado da sessão do coordenador.
6. **Autenticação.** Com login da assinatura, `accountInfo()` traz `email`,
   `organization`, `subscriptionType` (ex. `"Claude Pro"`) e
   `apiProvider: "firstParty"`, sem `apiKeySource`/`tokenSource`. Com
   `ANTHROPIC_API_KEY`, traz `apiKeySource: "ANTHROPIC_API_KEY"` e nenhum
   `subscriptionType`; `system/init.apiKeySource` também muda. Regra para a
   Fase 1: exigir `subscriptionType`, `apiProvider === "firstParty"` e
   `apiKeySource` ausente ou `"none"`.

Política, consultada em 2026-10-03 (a decisão final é do pesquisador):

- support.claude.com/…/15036540: "Update June 15: We're pausing the changes
  to Claude Agent SDK usage described below. For now, nothing has changed:
  Claude Agent SDK, `claude -p`, and third-party app usage still draw from
  your subscription's usage limits."
- code.claude.com/docs/en/legal-and-compliance: "Advertised usage limits for
  Pro and Max plans assume ordinary, individual usage of Claude Code and the
  Agent SDK." A mesma página diz que desenvolvedores que constroem produtos ou
  serviços com o Agent SDK devem usar chave de API, e proíbe oferecer login
  Claude.ai em apps de terceiros ou rotear pedidos de outros usuários pela
  assinatura; também diz que isso não impede um usuário de entrar no binário
  oficial e não modificado com a própria assinatura. O uso aqui (um
  pesquisador, a própria conta, login pelo fluxo oficial do CLI) é o caso
  pessoal; Pico não deve ser distribuído a terceiros nesse modo.

Outros achados:

- Notas `shouldQuery: false` ficam no transcript, entram junto do próximo
  prompt e geram um `result` vazio (uso zero) que ecoa o uuid da nota.
- Toda mensagem enviada leva um `uuid`; `result.user_message_uuids` diz quais
  entradas o turno consumiu (inclusive as dobradas). É assim que o runtime
  sabe quando o turno e a fila terminaram.
- `interrupt()` encerra o turno com `error_during_execution`; mensagens ainda
  na fila sobrevivem e rodam em seguida (`still_queued`).
- A memória automática do Claude Code criava `projects/<lab>/memory`;
  desligada com `settings: { autoMemoryEnabled: false }`. O contexto do lab
  continua só no SQLite.
- `tools: [...]` limita as tools nativas exatamente à lista (o init mostra
  `Bash, Edit, Glob, Grep, Read, WebFetch, WebSearch, Write` + `mcp__pico__*`).
- `systemPrompt.snapshot: false`, para prompts editados valerem no próximo
  processo também em sessões retomadas.
- Windows: a pasta de trabalho só pode ser apagada depois que o processo sai;
  `dispose()` espera a saída.
- `supportedModels()` lista `default`, `opus`, `fable`, `sonnet`, `haiku` com
  `resolvedModel` (dado para a Fase 6).

Desvios do plano nesta fase:

- Os pacotes do Pi só saem quando o último import sair (fim da Fase 5), para
  `bun run check` continuar passando entre fases.
- Versões exatas, como o resto do repositório: `zod 4.6.5`,
  `@anthropic-ai/sdk 0.131.0`, `@modelcontextprotocol/sdk 1.32.0`.
- O servidor falso Anthropic e o teste do runtime (adiantados da Fase 8)
  entram agora, para a Fase 0 ter verificação própria.

### Fases 1 a 9 (2026-10-03)

A pedido do pesquisador, as fases restantes foram feitas de uma vez e ficaram
todas em staged, sem commit. Como vários arquivos mudam em mais de uma fase,
o conjunto vai para revisão como uma unidade.

1. **Autenticação e caminhos.** `config.ts` troca `agentDir` por
   `claudeConfigDir` (`PICO_DATA_DIR/claude`, `PICO_CLAUDE_CONFIG_DIR`, modo
   0700) e não cria mais `web-search.json`. `login.ts` substitui `pi.ts`:
   `bun run login` abre `claude auth login --claudeai` do binário que vem com o
   SDK, no perfil do Pico, e recusa `--console`. `claudeEnv()` remove sempre as
   seis variáveis da restrição 2. O servidor define `CLAUDE_CONFIG_DIR` no
   próprio processo, porque o SDK lê os transcripts ali (item 4 do spike). Na
   subida, `main.ts` chama `verifySubscription()`: exige `subscriptionType`,
   `apiProvider: "firstParty"` e nenhuma `apiKeySource`; sem isso, encerra
   pedindo `bun run login`, sem imprimir segredo.
2. **Tools.** Schemas em zod, servidor MCP `pico` no processo. Uma comparação
   automática com o `HEAD` (JSON Schema de cada tool, por papel: Pico,
   coordenador, especialista e editor) deu os mesmos nomes, campos,
   obrigatoriedade e descrições. A única diferença intencional são os nomes de
   tools citados nas descrições, agora com o prefixo `mcp__pico__` que o
   modelo vê. `typebox` saiu.
3. **Sessão do laboratório.** `sessions.ts` monta a `ClaudeSession`; o
   contexto do lab, a skill principal, o estado da campanha e o status
   editorial vão no `UserPromptSubmit` de cada mensagem.
   `labs.claude_session_id` é gravado na primeira resposta do turno, não só no
   fim, para um reinício no meio do primeiro turno retomar a conversa. A
   projeção junta blocos por `message.id` e mostra notas `[pico:…]` como
   `role: "system"`; o consumo do chat é o total da conversa, porque o SDK não
   informa custo por mensagem.
4. **Subagentes.** Uma `ClaudeSession` nova por spawn, `agent_runs.session_id`
   (coluna nova; `session_file` fica nula), resultado do `result`, histórico
   lido do transcript depois do fim.
5. **Campanhas.** `Campaigns.sessionOptions()` liga os ganchos do runtime:
   prompt recusado no `UserPromptSubmit`, tool negada no `PreToolUse` com
   `continue: false`, fim do turno depois das tools no `PostToolUse`, consumo
   por turno no `onUsage`, `maxBudgetUsd` igual ao saldo e
   `campaigns.session_cost`/`session_tokens` como base de uma conversa
   retomada. Notas `campaign-result` e `campaign-direction` deduplicam pelo
   marcador no histórico. Limite do plano: um `rate_limit_event` com
   `status: "rejected"` interrompe o turno e deixa a campanha `pending` com
   motivo `rate_limit` e `limit_resets_at`; vale para o coordenador e para os
   especialistas da campanha. A UI mostra "Limite do plano Claude até <hora>".
6. **Modelos e padrões.** `supportedModels()` uma vez por execução do
   servidor, sem `default`, com recuo fixo `opus`/`sonnet`/`haiku` se o CLI não
   responder. O seletor mostra o nome com a versão ("Sonnet 5.5"), tirado da
   descrição do Claude Code. A migração muda os padrões de especialistas para
   2 por campanha e 3 por laboratório só se ainda forem os de fábrica (3 e 6),
   e devolve a "sem modelo" laboratórios e perfis com modelos de outros
   provedores. A UI chama o orçamento de consumo estimado e explica que não é
   cobrança.
7. **Prompts e skills.** Nomes das tools atualizados e menções ao Pi
   removidas. `default-upgrades.ts` troca só textos ainda iguais ao padrão
   antigo, por hash; os 27 hashes (7 prompts, 5 skills com instruções e
   exemplos, 5 perfis com instruções e "quando usar") foram conferidos contra
   os textos do `HEAD`, cada um no id e na coluna certos.
8. **Testes.** Os testes de sessão, subagentes, campanhas, editorial,
   histórico e registros rodam no servidor falso. Novos:
   `claude-auth.test.ts` (nenhuma variável da restrição 2 chega ao
   subprocesso, conferido pelo `env` que o próprio Bash do Claude Code grava;
   o `main.ts` real recusa subir sem login de assinatura, com e sem
   `ANTHROPIC_API_KEY`, e recusa `PICO_TEST_FAKE_MODEL` fora do `bun test`),
   limite do plano (runtime e campanha) e recibo de entrega.
9. **Documentação.** README, `AGENTS.md` e `.env.example`.

Achados desta etapa:

- **Custo de conversas retomadas.** O transcript grava um registro
  `cost-state` ao fim de cada turno, inclusive interrompido, e um processo
  retomado continua dele mesmo depois de outra sessão rodar na mesma pasta.
  A base gravada pela campanha bate com esse total.
- **Custo chega no fim do turno.** O consumo de um turno só existe no
  `result`, depois das tools; um teste de campanha precisou esperar o
  coordenador ficar ocioso antes de conferir o total. Com o Pi o custo vinha
  por resposta.
- **Recibo de entrega.** O prompt aparece no histórico em memória assim que é
  enviado; o recibo para o Pico (resultados de agentes, jobs e marcos de
  campanha) só vale quando o Claude Code assume a mensagem, o que ele indica
  com `user_message_uuid` no primeiro quadro da resposta ou no `result`. Antes
  disso, se o processo morresse, a mensagem estaria marcada como entregue sem
  estar no transcript.
- **Rate limit.** Com chave de API o CLI trata 429 com até dez novas
  tentativas e não emite `rate_limit_event`; o evento é só para login de
  assinatura. Por isso os testes entregam o evento ao runtime diretamente.
- **Haiku.** O Claude Code converte `thinking: adaptive` em thinking por
  orçamento e não envia `effort` para o Haiku; o Pico não precisa tratar isso.
- **Lentidão de subida.** Cada processo do Claude Code leva perto de um
  segundo para começar, então um coordenador pode acordar antes de seus
  especialistas responderem; com o Pi isso quase nunca acontecia.
- Com `maxBudgetUsd`, o Claude Code mostra ao modelo o saldo
  ("USD budget: …; … remaining").

Validação:

- **Com modelo falso:** tudo o que `bun run check` cobre. Com o Bun 1.4.0
  instalado no Windows do pesquisador, `bun run check` passa inteiro:
  typecheck, Biome (16 avisos de CSS que o `main` já tinha), 199 de 199 testes
  e build. Para isso entraram três correções de Windows, fora da migração:
  `.gitattributes` com LF em todo checkout (o `core.autocrlf=true` deixava os
  arquivos em CRLF e o Biome acusava o repositório inteiro, também no
  `main`); `resolveMetricsPath` comparava caminhos com `/` e duplicava a pasta
  do job (`experiments\11\experiments\11\metrics.json`); manifestos e campos de
  datasets gravavam `\`, o que mudava o hash do mesmo dataset conforme o
  sistema. Os testes de caminhos passaram a montar as expectativas com
  `join`/`resolve`, e o teste do symlink externo é dispensado quando o Windows
  não permite criar symlinks. No Linux e no macOS do CI não foi rodado.
- **Com a assinatura real (Windows, 2026-10-03):** `bun run login` abriu o
  login oficial e o pesquisador autorizou no navegador; o Claude Code concluiu
  sozinho, sem colar código. `bun start` aceitou o login ("Claude
  subscription: Claude Pro"), serviu a UI e a API, e `/api/models` trouxe os
  modelos da assinatura (Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 4.5 e versões
  anteriores por id completo). Nenhum prompt foi enviado ao modelo. O resto do
  roteiro do critério de pronto continua com o pesquisador: conferir o uso
  extra pago desativado na conta; criar um lab, conversar e rodar um job;
  iniciar uma campanha com 2 especialistas em paralelo e ver os resultados
  chegarem ao coordenador; pedir uma revisão editorial; pausar e retomar;
  reiniciar o servidor e ver a conversa do lab continuar.

Além do plano:

- O recibo de entrega descrito acima e a proteção que não reinicia um
  processo do Claude Code com mensagens ainda em trânsito.
- O limite do plano também para especialistas de campanha, e a hora do reset
  aparece na UI.
- `bun run login` recusa o login de Console.
