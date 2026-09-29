# Pico

Um laboratório de pesquisa conduzido pelo pesquisador e por uma sessão principal
do Pico, usando tools para investigar, executar experimentos e registrar conhecimento.

A pasta deste projeto se chama **tiny-pico** para distingui-lo da implementação
anterior. O nome do produto continua sendo **Pico**.

## Estado atual

Baseline implementada com uma conversa persistente por laboratório, tools,
SQLite, executor Python/uv e quatro páginas: Chat, Overview, Experiments e Library.
O ciclo local completo é testado com narração simulada e execução Python real.
Pico também conversa e opera as tools com provedores configurados em seu perfil
Pi próprio. A extensão pi-web-access fornece busca e leitura de fontes.
O piloto multimodal foi executado com um alvo real via Pi, incluindo comparação,
análise na conversa e reprodução. Ele valida o fluxo; sua amostra pequena não
demonstrou ganho da defesa.

- [Mapa atual do código e fronteiras entre módulos](docs/code-architecture.md)
- [Arquitetura e decisões da baseline](docs/architecture.md)
- [Marcos de desenvolvimento e aceite](docs/development.md)
- [Orientações para trabalhar neste repositório](AGENTS.md)
- [Uso, execução e reprodução](docs/usage.md)
- [Contrato HTTP](docs/http-api.md)
- [Validações e revisão adversarial](docs/validation.md)

## Executar

Requisitos: Bun 1.4+, Python 3; uv para experimentos com dependências.

```sh
bun install --frozen-lockfile
bun run pi
# No terminal do Pi, use /login e depois /exit.
bun run dev
```

Abra http://127.0.0.1:5174. Crie um laboratório: **Pi** usa o login, provedor
e modelo do perfil exclusivo do Pico. O comando acima usa o Pi incluído nas
dependências; nenhuma instalação global é necessária. Para testar sem chamadas
externas, escolha **Demonstration**, ative execução local e envie a sugestão **Run a demonstration**.
Pico registra pergunta, hipótese, dataset e experimento; executa Python; recebe
o término na conversa; registra resultado e conclusão com limitações.

```sh
bun run check
bun run build
bun start
```

O servidor de produção publica UI e API em http://127.0.0.1:4317. Os dados ficam
em `~/.local/share/pico`, configurável por `PICO_DATA_DIR`, fora do código.
Use outro diretório explicitamente caso já possua uma instalação nesse caminho.
`PICO_PORT` altera a porta de produção/API; o proxy de desenvolvimento usa 4317.
Nenhuma pesquisa da implementação antiga é importada automaticamente.

Em **Pi**, escolha provedor, modelo e reasoning nas configurações do laboratório.
O servidor usa o SDK público do Pi com o perfil `<PICO_DATA_DIR>/pi`, por padrão
`~/.local/share/pico/pi`. `PICO_PI_AGENT_DIR` permite escolher outro perfil
exclusivo. O Pico não lê `~/.pi/agent`, não herda `PI_CODING_AGENT_DIR` do Pi pessoal
e não importa seus logins, extensões, skills ou sessões. Faça um novo login com
`bun run pi`; credenciais e configurações ficam fora dos registros científicos.

Busca web funciona inicialmente com Exa pelo endpoint público MCP, sem chave
própria, sujeita à disponibilidade e aos limites do serviço. Para usar Google,
selecione Serper ou SerpApi em `<PICO_DATA_DIR>/pi/web-search.json` e configure
a chave correspondente no ambiente do servidor. Veja [busca e isolamento](docs/search.md).

Para compartilhar, distribua o código e o lockfile. Cada pessoa instala as
dependências e faz o próprio login; `.env`, perfis e pesquisas ficam locais.
Backups da pesquisa não incluem credenciais nem caches de busca.

O modo **Advanced · OpenAI-compatible API** continua disponível para endpoints
Chat Completions e uma variável de ambiente com a chave. Não coloque o valor da
chave na interface, conversa ou arquivos de experimento.

## Objetivo da baseline

Completar uma investigação na mesma conversa:

**Pergunta → exploração/hipótese → experimento → execuções → resultado →
conclusão provisória → próxima investigação.**

O pesquisador conversa e acompanha. Pico mantém os registros pelas tools.
Os registros pertencem ao laboratório e sobrevivem às versões da aplicação.

## Estrutura

Quatro workspaces privados compartilham o lockfile e os comandos da raiz:

```text
apps/
  server/              HTTP, assets e lifecycle do processo
  web/                 React: Chat, Overview, Experiments e Library
packages/
  lab/                 Pesquisa, conversa, modelos, fontes e persistência
    src/contracts.ts   API de tipos/schemas: @pico/lab/contracts
  runner/              Jobs, snapshots, processos, logs e observações
scripts/               Comandos usando APIs públicas
tests/                 Fronteiras de módulos, exemplos e ciclo HTTP completo
docs/
```

API e tools chamam as mesmas operações científicas. O lab funciona sem HTTP;
o runner executa Python/uv sem depender do lab. Contratos públicos pertencem ao
lab, sem um pacote separado. A web importa somente esses contratos e consulta
a API. Testes internos ficam no workspace proprietário.

A refatoração integral removeu a antiga árvore `src/`, preservando IDs, revisões,
recibos, replay e snapshots. O [mapa de código](docs/code-architecture.md) explica
as responsabilidades e orienta mudanças por agentes. `bun run check` verifica
fronteiras/imports, TypeScript, testes, Biome e build da web.
