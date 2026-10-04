# Desenvolvimento do Pico

Leia README.md antes de mudanças estruturais. O produto se chama Pico; a pasta
tiny-pico distingue o repositório.

## Direção

Pico é um co-líder de pesquisa com o mínimo de lógica própria. O Claude Agent
SDK (Claude Code) cuida de sessão, contexto, compactação, retries e tools de
arquivo, shell e web. Pico acrescenta uma pasta por laboratório, registros
estruturados em SQLite, jobs em segundo plano com notificação, commits
automáticos, fontes e datasets, e a UI. O SDK só aparece em
`claude-runtime.ts` (conversas), `claude-auth.ts` (ambiente, login e modelos)
e `tools.ts` (servidor MCP das tools do Pico).

- O sistema registra, não julga. Nenhuma regra impede o modelo de gravar um
  registro ou rodar um comando. Proveniência vem de graça: commit por job,
  revisões por registro, hash de manifesto por dataset.
- Simplicidade primeiro. Introduzir abstrações só com necessidade concreta.
  Não recriar fila, sandbox, snapshot, idempotência ou validação científica.
- Sem burocracia para o modelo: tools poucas, campos opcionais, texto livre.
- Não há código legado a preservar. Migrações do SQLite ficam em
  `server/src/db.ts`, aditivas.

## Limites

- `server/src/contracts.ts` é um módulo folha com os tipos compartilhados. A
  web importa somente `@pico/server/contracts`.
- Tools chamam funções de `records`, `jobs`, `papers` e `datasets`; a HTTP
  chama as mesmas funções. UI e modelo veem os mesmos dados.
- A pasta do laboratório pertence ao modelo e ao pesquisador. Pico só escreve
  `.gitignore` e `.pico/` para logs e manifestos. Prompts, skills e exemplos
  ficam no SQLite; o contexto do laboratório fica em `labs.context_markdown`.
  Um `PICO.md` anterior é importado uma única vez, preservando o original.
- O login fica no perfil Claude Code do Pico em `PICO_DATA_DIR/claude`, nunca
  no banco. Pico roda só com a assinatura Claude do pesquisador: nenhuma
  credencial ou rota de API paga chega aos subprocessos (`claude-auth.ts`), e o
  servidor não sobe sem o login da assinatura. Não acrescentar modo com chave
  de API nem outro provedor.

## Verificação

`bun run check` roda typecheck, Biome, testes e build. Testes usam um servidor
falso da Messages API da Anthropic em `127.0.0.1`
(`server/tests/fake-anthropic.ts`) e processos reais do Claude Code. Não
chamar a Anthropic nem outros provedores em testes. Distinguir sempre o que foi
testado com modelo falso do que foi validado com a assinatura real.

Atualizar README.md quando uma decisão de produto ou de persistência mudar.
