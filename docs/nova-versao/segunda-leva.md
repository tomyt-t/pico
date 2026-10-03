# Segunda leva: acompanhar a pesquisa

Issues 05–09 implementadas em 30 de setembro de 2026. Três subagentes dividiram
Investigações, Acervo e histórico; o agente principal integrou a navegação,
o acompanhamento e a Evolução. Duas rodadas adversariais cruzaram autores,
com correções e nova verificação dos fluxos afetados.

## Comportamento entregue

| Issue | Entrega |
| --- | --- |
| 05 | Investigações usa perguntas existentes e percorre vínculos explícitos nos dois sentidos. Materiais desconectados continuam acessíveis; fontes compartilhadas e outras perguntas são destinos, sem unir automaticamente pesquisas. |
| 06 | Acervo reúne Fontes e dados, Todos os registros e Arquivos, com busca e filtro por tipo. Leitores, previews, downloads, origem, revisões e acesso às execuções reutilizam os componentes existentes. |
| 07 | Acompanhamento à esquerda da conversa mostra estado da sessão, perguntas e jobs relacionados. No celular, abre sob demanda. São registros e execuções reais, sem agentes ou porcentagens de progresso inventados. |
| 08 | `Records.history` agrega criações e alterações em uma consulta, usada pela HTTP e pela opção `history: true` da tool existente `read_records`. Não cria tabela ou tool. |
| 09 | Evolução mostra notas, hipóteses e conclusões, motivo registrado e comparação das versões antes/depois, inclusive referências. Atividade operacional aparece separada. Pico recebe orientação curta para explicar mudanças em notas e em `reason`. |

A sidebar agora oferece Conversa, Visão geral, Investigações, Evolução e
Acervo. As rotas anteriores de Biblioteca, Arquivos e Experimentos permanecem
válidas. Perguntas abrem Investigações; outros registros abrem detalhes no
Acervo, mantendo experimentos/resultados/jobs em seus detalhes de execução.
Contadores por categoria levam ao filtro correspondente do Acervo.

Navegar mantém um controlador e uma assinatura de eventos do chat por lab.
Discutir uma mudança ou material acrescenta contexto ao rascunho sem envio.
O acompanhamento ganha filhos de subagentes apenas quando houver delegação
real, conforme o [backlog futuro](subagentes.md).

## Histórico e limites

`GET /api/labs/:id/history` e `read_records({history:true})` retornam entradas
`created` ou `revised`, com `recordId`, `at`, `author`, `reason`, `before` e
`after`. Uma linha de `revisions` guarda a versão anterior; sua autoria, data
e motivo descrevem a transição para a seguinte. A consulta combina snapshots
existentes e a versão atual, preservando essa semântica.

Há filtro opcional `kind`, padrão de 100 e máximo de 500 eventos. A ordem é
data decrescente, ID crescente e revisão resultante decrescente nos empates.
Histórico respeita `kind`/`limit` e ignora `id`/`status`; para detalhes de um
registro, a leitura por `id` continua disponível. Excluir um registro também
remove suas revisões, conforme o comportamento existente.

Evolução faz três consultas limitadas por categoria, sem requisição por
registro. Mostra até 100 entradas de cada categoria e declara o recorte na
tela. Links das versões históricas abrem os registros e arquivos atuais;
não congelam o destino das referências. Motivo ou explicação ausentes são
apresentados como ausência, sem descoberta inferida pela UI.

Investigações e Acervo usam a consulta de registros existente, limitada por
padrão aos 500 mais recentes. Referências fora dessa lista continuam abrindo
o detalhe por ID; a falta na consulta local não prova inexistência. Vínculos
de jobs por pasta preservam a regra já usada em Experimentos. Uma execução
concluída não altera o estado científico de uma pergunta.

## Revisão adversarial e correções

| Achado | Correção conferida |
| --- | --- |
| Evolução declarava ausência durante carregamento ou falha inicial. | Mostrar vazio apenas depois de receber arrays válidos; preservar resultados parciais e erros. |
| Comparação omitia as evidências anteriores numa revisão só de vínculos. | Mostrar links nas duas versões, com aviso de destinos atuais. |
| Referência fora da lista carregada perdia o link e era declarada inexistente. | Manter URL canônica, com aviso de referência não carregada; o detalhe confirma eventual ausência. |
| Contadores de notas/hipóteses/conclusões abriam Fontes e dados. | Encaminhar `kind` na URL e abrir Registros com esse filtro. |
| Referências a jobs apareciam ausentes antes da consulta de execuções responder. | Aguardar dados para classificá-las; mostrar carregamento e erro sem inferir ausência. |
| Navegar pela atividade removia a âncora focada; a primeira correção roubava foco dos filtros. | Restaurar foco no conteúdo somente quando perdido após desmontagem, preservando controles conectados. |
| Sidebar anunciava sessão ociosa sem estado disponível, inclusive em leitor de tela. | Texto, título e nome acessível usam o mesmo estado desconhecido. |
| Componente de jobs era importado de uma feature de chat pela Evolução. | Extrair apenas o componente puro compartilhado, junto das extrações concretas de queries e vínculo de jobs. |

Não foi introduzido serviço de investigação, engine de progresso, store global,
cache, novo ciclo Pi ou domínio escondido em campos de notas. O banco continua
com o esquema existente. Os testes operam sobre fixtures próprias; nenhum
laboratório real recebeu registros de demonstração.

## Verificação

- Typecheck passou. Biome passou com os dois avisos de especificidade CSS já
  existentes em `styles/pages.css`.
- `bun run check`: 50 testes passaram, um falhou, 301 verificações. A falha
  permanece no bind de `Bun.serve({port:0})` do modelo falso, antes de executar
  a sessão, como na primeira leva. O comando completo para nesse teste.
- Build executado separadamente passou. Vite avisa sobre o chunk principal
  de aproximadamente 512 kB; nenhuma dependência nova foi adicionada.
- Testes de histórico verificam criação, várias revisões, autoria, razões,
  datas iguais, limites, exclusão e isolamento. HTTP e tool foram executadas
  diretamente com a mesma consulta, sem abrir sessão ou chamar modelo.
- Testes web verificam percursos de investigação, fontes compartilhadas,
  materiais desconectados, dois jobs, ciclos, referências não carregadas,
  fontes com vários formatos, datasets, arquivos sem preview e versões com
  evidências divergentes.
- Diagnóstico temporário com React DOM, LinkeDOM e fetch/EventSource simulados
  passou com 242 assertions, incluindo verificações auxiliares de elementos
  e chamadas somente GET. Cobriu leitores, filtros e URLs, loading/503,
  atividade, discussão preservando rascunho, assinatura SSE única, troca de
  lab, foco, status acessível e expansão móvel. Não usa rede ou modelo e não
  substitui renderização nem foco nativos do Chrome.

Chrome DevTools MCP continua indisponível neste ambiente. Permanecem pendentes
a inspeção visual desktop/móvel, o fluxo completo com servidor de modelo falso
em ambiente que permita o bind e a avaliação editorial com modelo real.
As limitações preexistentes de retry/backoff do Pi registradas na
[primeira leva](primeira-leva.md) não foram alteradas.

A próxima entrega são as issues 10–13: registros de páginas, catálogo mínimo,
documentos na sidebar e Panorama editorial. A issue 14 continua sendo a
validação integrada, sem substituir as verificações de cada leva.
