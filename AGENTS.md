# Desenvolvimento do Pico

Leia README.md antes de mudanças estruturais. O produto se chama Pico; a pasta
tiny-pico distingue o repositório.

## Direção

Pico é um co-líder de pesquisa com o mínimo de lógica própria. O Pi SDK cuida
de sessão, contexto, compactação, retries e tools de arquivo e shell. Pico
acrescenta uma pasta por laboratório, registros estruturados em SQLite, jobs em
segundo plano com notificação, commits automáticos, fontes e datasets, e a UI.

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
- Credenciais ficam no perfil Pi em `PICO_DATA_DIR/pi`, nunca no banco.

## Verificação

`bun run check` roda typecheck, Biome, testes e build. Testes usam um modelo
falso OpenAI-compatível (`server/tests/support.ts`) e processos reais. Não
chamar provedores externos em testes. Distinguir sempre o que foi testado com
modelo falso do que foi validado com modelo real.

Atualizar README.md quando uma decisão de produto ou de persistência mudar.
