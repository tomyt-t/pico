# Validação do Pico

## Escopo das evidências

Os testes distinguem narração simulada, execução Python/uv real e chamadas a
modelos externos. O piloto multimodal real foi executado com o alvo
`zai/glm-5.3-flash` através do SDK Pi. Ele valida o fluxo de pesquisa e reprodução;
o resultado não demonstra eficácia adicional da defesa. Nenhuma métrica da
demonstração numérica é apresentada como evidência científica sobre LLMs.

`bun run check` reúne TypeScript, Biome, testes Bun e build de produção.
Os testes de processos usam diretórios temporários separados dos dados pessoais.

## Refatoração integral — 28/09/2026

`bun run check` passou com **184 testes, 1.043 assertions e zero falhas** em
36 arquivos de testes. Typecheck dos oito projetos, Biome (237 arquivos) e
build de produção também passaram. A organização anterior em `src/` foi
removida; os quatro workspaces são `apps/server`, `apps/web`, `packages/lab`
e `packages/runner`. Contratos são o subpath `@pico/lab/contracts`.

Três subagentes participaram de duas rodadas adversariais do desenho e duas
da implementação. [architecture-review.md](architecture-review.md) registra
os contraexemplos e suas correções. A revisão final não deixou bloqueadores
concretos nos cenários exercitados.

| Área | Evidência desta entrega |
| --- | --- |
| Fronteiras | Grafo real do TypeScript: imports, tipos, reexports, exports dos pacotes, aliases, dependências declaradas e ciclos. Fixtures negativas demonstram que violações são detectadas. |
| Navegador | Contratos e UI compilam em programas separados sem tipos Node/Bun; Vite usa o mesmo mapa de aliases. |
| Instalação | Cópia limpa, sem node_modules: frozen lockfile instalou 422 pacotes; typecheck, build, CLI Pi 0.86.1 e oito testes de exemplos/perfil/worker passaram. |
| Entrypoints | Runner e seus subprocessos executaram com cwd externo ao repositório. Watch do servidor real reconheceu três alterações no lab através do workspace; restauração do arquivo e SIGTERM terminaram normalmente. |
| Lifecycle | Construtores inertes; exclusão de controladores; startup sem despacho antes da reconciliação; barreiras de backup/close; callbacks tardios rejeitados; close interno rejeitado sem deadlock. |
| Recuperação | Publicação de dataset/run antes do SQLite, recibos retomados, projeções reentregues sem duplicação; archive inválido não reserva ID e import metadata-only pode continuar. |
| Compatibilidade | Fixture escrita pelo código anterior, com SQLite, backup, archive v1, datasets, revisões, autoria, assinaturas nativas e tool concluída. Restore/replay/reprodução conservam registros e bytes; reprodução recebe outro ID. |
| Integridade | Evidências estruturadas conferidas contra métricas/artefatos reais; resultados anteriores preservados sem evidência inventada; revisões mantêm vínculos e histórico. |
| Processos | Python/uv reais: fila, limites, timeout, cancelamento, crash do supervisor antes/depois de GO, reinício e descendentes. Estado ambíguo bloqueia despacho, backup e export. |
| Backup | Locks e inventário operacional além do SQLite; supervisor sobrevivente impede backup offline; restore verifica bytes antes de descartar identidades de controle. |
| HTTP | Rotas consomem capacidades públicas; DOI inválido retorna 400 sem fetch externo; novas requisições durante manutenção recebem erro HTTP coerente. |

Chrome real, com servidor real e diretório temporário, validou criação do lab,
demonstração, resultado/conclusão, quatro páginas e detalhes. A execução Python
mediu mean=2.5. Rascunhos sobreviveram à navegação e recarga. Uma resposta de
POST/chat foi perdida depois do commit: Retry reutilizou a chave e manteve um
único turno. Desktop 1366×900 e mobile 390×844 ficaram sem overflow ou erros JS.
Screenshots locais: `/tmp/pico-refactor-desktop.png` e
`/tmp/pico-refactor-mobile.png`; roteiro em `/tmp/pico-browser-smoke.ts`.

**Distinção de evidência:** narração/demo e respostas Pi foram simuladas;
Python/uv, SQLite, arquivos, processos, transporte HTTP local e navegador foram
reais. Nenhuma investigação com modelo externo foi executada nesta refatoração.
O piloto externo documentado abaixo pertence à entrega anterior. Os testes
usaram cópias e diretórios temporários, sem modificar pesquisas pessoais.

Limites: execução real verificada em macOS, sem validação Linux nesta sessão;
o runner atende código confiável e não garante contenção se o watchdog morrer
isoladamente ou o código escapar do grupo. Shutdown gracioso aguarda EOF dos
corpos HTTP aceitos. O checker cobre imports estáticos/literais e tipos, sem
provar carregamentos arbitrários por strings; sua API AST TypeScript é experimental,
com versão 7.0.2 fixada e testes negativos para futuras atualizações. Testes de
falhas injetadas não constituem prova de todos os pontos de crash/power-loss.

## Busca e perfil isolado — 28/09/2026

Após integrar `pi-web-access@0.30.0`, `bun run check` passou com **130 testes,
620 assertions e zero falhas**, incluindo TypeScript, Biome e build de produção.

- Duas instalações usam perfis diferentes e ignoram `PI_CODING_AGENT_DIR` pessoal;
  o CLI vem da dependência local e usa o perfil próprio.
- A extensão real lê HTML e PDF servidos por fixtures HTTP locais, consulta
  passagens e mantém caches separados entre laboratórios. Cancelamento e
  recuperação de configuração inválida foram exercitados.
- Uma conversa com modelo simulado usa a extensão real e registra a fonte na
  Library; a evidência permanece após reabertura, e o backup exclui credenciais
  e caches. Programas Python reais recebem o perfil próprio do Pico.
- Busca externa real via Exa retornou três fontes do arXiv. O PDF
  `https://arxiv.org/pdf/2306.13213` foi extraído localmente: 20 páginas e 89.367
  caracteres, com leitura de trechos e localização de 152 ocorrências de
  “adversarial”. Isso verifica transporte/extração, não a validade das afirmações.
- Uma cópia limpa do código instalou as dependências com `--frozen-lockfile` e
  passou pelos testes de perfil e busca, sem depender do Pi global.

O teste externo desta entrega não invocou um modelo autenticado no perfil novo.
Cada instalação deve fazer seu próprio login. Google via Serper/SerpApi exige
configuração e não foi exercitado com uma chave real nesta entrega.

| Área | Evidência |
| --- | --- |
| Storage | Reabertura de IDs e relações; migração atômica; receipts; backup/restore; rejeição de adulteração. |
| Domínio | Escopo de laboratório; exploração sem hipótese; critérios vinculados; evidências terminais; revisões; snapshots imutáveis. |
| Runner | Python e uv reais; dataset imagem+texto; falha/correção; reprodução; fila, timeout, cancelamento; supervisor sobrevivendo à reinicialização. |
| Sessão | Turnos serializados; pausa/continuação; cancelamento antes de iniciar; tools idempotentes; falha do modelo; evento deduplicado. |
| Pi | Autenticação existente; catálogo atualizado sem comandos de chave; replay de reasoning/assinaturas/tools; usage mesmo em respostas rejeitadas; shutdown durante inicialização. |
| Ciclo completo | Chat → tools → run → métricas reais → resultado → conclusão; reprodução após alterar workspace; backup/restore de todos os vínculos. |
| UI | Comparação por dimensão; relações explícitas; navegação persistida; renderização de exploração sem hipótese; links de fontes. |

## Revisão adversarial

As frentes de domínio, executor e UI foram implementadas por subagentes. A
composição, API, sessão e tools passaram por revisão cruzada. Bugs encontrados
deram origem a correções e testes, incluindo:

- Defaults de schemas apagavam campos omitidos durante PATCH.
- Um recibo de efeito e seu run/dataset disputavam o mesmo ID global.
- Stop antes da microtask inicial ainda permitia executar o modelo.
- Repetir o ID de uma tool poderia repetir uma mutação.
- Evento de término poderia iniciar outra execução sem nova direção do pesquisador.
- Reprodução ignorava a redução do limite de tempo do laboratório.
- Backup copiava o ambiente descartável uv e falhava em symlinks.
- Limites aceitos pelas configurações divergiam dos limites do executor.
- Respostas rejeitadas por IDs de tools reutilizados perdiam uso/proveniência.
- Mudar modelo durante a inferência podia registrar configuração incorreta.
- Atualizações de modelos no Pi não apareciam sem reiniciar o servidor.
- Aguardar HTTP antes de abortar o runtime podia bloquear o encerramento.
- Edições rápidas durante bootstrap encerravam o watcher de desenvolvimento.

## Chrome DevTools MCP

O servidor oficial chrome-devtools-mcp está instalado como dependência de
desenvolvimento. Nesta sessão ele é acessado pelo cliente CLI oficial
`chrome-devtools`, conectado ao daemon MCP, em Chrome isolado.

```sh
bun run dev
bunx chrome-devtools start --headless --isolated --no-usage-statistics --no-performance-crux
bunx chrome-devtools navigate_page 1 --url http://127.0.0.1:5174
bunx chrome-devtools take_snapshot 1
```

Evidências locais estão em `artifacts/ui/` (fora do versionamento).

Rodada de 28/09/2026:

- `bun run check`: **121 testes, 572 assertions, zero falhas**; TypeScript, Biome
  e build de produção passaram.
- Chrome desktop 1365×900: criação de laboratório, envio da demonstração,
  retorno automático da execução, Overview e navegação até o run aprovado.
- Reprodução acionada pela UI: segunda tentativa com a mesma métrica real
  (mean=2.5), código preservado e referência para a tentativa original.
- Mobile 390×844: Experiments e Library, temas claro/escuro; document.scrollWidth
  igual à largura de viewport, sem overflow horizontal da página.
- Library: cadastro de fonte sintética de validação, navegação e recarga preservam
  texto e origem. O backend exibe erro de campo obrigatório quando o texto falta.
- Build de produção servido em 4317: Overview com dados persistidos, recarga e
  console sem erros. Desconectar rede mantém os registros já carregados e exibe
  alerta de dados possivelmente desatualizados, com Retry; reconexão recupera a UI.

Screenshots: `overview-desktop.png`, `experiment-runs.png`,
`experiment-mobile-light.png`, `library-mobile.png` e `offline-state.png`.
O laboratório usado no browser ficou em `/tmp/tiny-pico-ui-validation`; não é o
diretório recomendado para pesquisas permanentes.

## Piloto real via Pi — 28/09/2026

O laboratório `0e8dc5ad-3dcf-47ce-8da7-777f5d25b2a2` foi criado pela UI no
diretório permanente `~/.local/share/pico`. A conversa usa `zai/glm-5.3`, reasoning
high. Pico registrou a pergunta com uma tool real e retomou o histórico após
reinício. O alvo experimental é separado: `zai/glm-5.3-flash`, com imagem.

| Execução | Run | ASR (ataque) | Acurácia limpa | Acurácia sob ataque | Chamadas |
| --- | --- | --- | --- | --- | --- |
| Baseline | `be8a617a-82e6-46ac-9d7b-cbf8060f902e` | 0/2 | 2/2 | 2/2 | 4 |
| Defesa | `671a3e3b-bc8f-4fce-b957-ff48540f9c80` | 0/2 | 2/2 | 2/2 | 4 |
| Reprodução baseline | `05c6936e-bdda-4961-800c-8980f5752517` | 0/2 | 2/2 | 2/2 | 4 |

As três execuções terminaram com sucesso, sem respostas fora do formato. A
reprodução foi acionada por **Repeat preserved snapshot** na UI. Conferência
independente dos 33 arquivos de código/inputs confirmou seus hashes; código,
configuração, protocolo e dataset da reprodução são iguais aos da referência.
Uso e latência variaram — não foi presumida reprodução numérica de custos ou
tempos. Os artefatos registram parâmetros solicitados e uso efetivamente
reportado; algumas respostas reportaram tokens de reasoning apesar de off.

O dataset é sintético, com apenas duas imagens por split. A baseline já resistiu
ao ataque, portanto a comparação é inconclusiva para ganho da defesa. Pico leu
`examples.jsonl`, `metrics.json` e condições, registrou resultados e uma conclusão
provisória ligada à pergunta. Uma formulação excessivamente ampla sobre igualdade
das medidas foi corrigida por revisão: desempenho igual não significa latência,
tokens ou custo iguais. A conclusão foi revista pela conversa; a interpretação
do resultado foi corrigida pela API, preservando observações, runs e histórico.
A tool `revise_result` permite a mesma correção durante a conversa.

Durante o fluxo, Pico inicialmente adiou a segunda condição por interpretar o
limite de concorrência como limite de submissão. Ela foi iniciada em novo turno;
as instruções passaram a explicitar que condições autorizadas podem ser
enfileiradas no mesmo turno. Eventos de término continuam sem iniciar novas runs.

Chrome DevTools MCP confirmou seleção automática do Pi, ausência de campo de
chave nesse modo, conversa real, Overview, comparação baseline/defesa e
reprodução. Chat mobile em 390×844 ficou sem overflow horizontal. Evidências
locais adicionais: `artifacts/ui/pi-*.png` e
`artifacts/validation/multimodal-pilot.json`.

Após as revisões, backup real criado em
`~/.local/share/pico-backups/2026-09-28-pilot` e restaurado em diretório temporário.
Os **152 registros e 6 revisões** são idênticos aos originais, incluindo histórico
nativo do modelo, evidências e relações. O manifesto verificou os arquivos da
restauração. A aplicação foi reiniciada com os dados permanentes; a UI de
produção recarregou sem erros no console.
