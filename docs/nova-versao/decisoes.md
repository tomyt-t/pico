# Decisões da nova experiência

Pico é um co-líder de pesquisa com iniciativa para investigar, seguir caminhos
e explicar o que aprendeu. O pesquisador conversa com ele e acompanha a
evolução sem precisar reconstruí-la a partir de logs e arquivos.

A migração mantém a arquitetura descrita no [README](../../README.md) e os
limites de [AGENTS.md](../../AGENTS.md). A revisão do plano com subagentes de
dados, UI e execução levou à redução descrita aqui. Estas são decisões de
planejamento. As issues 01–09 já estão implementadas; os relatórios das
[primeira](primeira-leva.md) e [segunda leva](segunda-leva.md) distinguem o que
foi entregue e validado das funcionalidades ainda futuras.

## Experiência pretendida

A interface deve responder a cinco perguntas: o que queremos entender, o que
Pico está investigando, o que aprendemos, por que a interpretação mudou e o que
continua aberto. A evolução inclui refutações, divergências, limitações e
caminhos encerrados; não existe um percentual universal de pesquisa concluída.

| Área | Responsabilidade |
| --- | --- |
| Cabeçalho da sidebar | Identificar, buscar, trocar e criar laboratórios. Sem rail externo. |
| Conversa | Uma conversa contínua com Pico, com acompanhamento à esquerda e acesso contextual aos materiais. |
| Panorama | Explicação atual da pesquisa, seus limites, referências e próximos caminhos. |
| Investigações | Perguntas acompanhadas dos registros e execuções relacionados. |
| Evolução | Mudanças explicadas no entendimento e na direção da pesquisa. |
| Páginas da pesquisa | Documentos compostos por Pico conforme o conteúdo de cada laboratório. |
| Acervo | Acesso a fontes, datasets, registros, arquivos e sua origem. |
| Configurações | Identidade do lab, modelo e preferências disponíveis. |

Experimentos, resultados, métricas e logs continuam acessíveis em detalhes. A
nova navegação não deve apagar esses recursos. A hierarquia visual distingue
perguntas, execução operacional e interpretação científica.

## Orçamento de complexidade

A migração propõe um novo tipo de registro, `page`; uma consulta agregada de
histórico; um controle compartilhado da conversa; e componentes React
específicos. Esse escopo não exige novas tabelas, novas tools ou outro ciclo de
execução do agente. Se aparecer uma necessidade adicional, explicá-la antes de
ampliar a implementação.

| Conceito visual | Representação inicial |
| --- | --- |
| Investigação | `question` e seus vínculos com registros existentes. |
| Síntese do laboratório | Conteúdo da própria página Panorama. |
| Mudança importante | `note` explicando o que mudou, por quê e com quais referências. |
| Alteração de interpretação | Revisão de hipótese ou conclusão, com `reason` quando houver explicação. |
| Página composta | Novo kind `page`, salvo e lido pelas tools atuais. |
| Trabalho em andamento | Estado real da sessão Pi e dos jobs. |

Não adicionar `investigation`, `synthesis` e `milestone` como entidades nesta
entrega, nem recriá-las como um domínio escondido em `note.fields.role`.
Convenções de apresentação devem ter contrato pequeno e documentado.

O caminho do código permanece direto: UI consulta contratos e API; HTTP e
tools chamam as mesmas funções; registros usam SQLite; sessão usa o Pi SDK.
Não introduzir serviços de Panorama e Evolução, barramento de eventos, motor
de workflows, cache próprio ou reconciliador de sínteses.

## Panorama e contexto do agente

`PICO.md` mantém objetivo, direção operacional e convenções. A página Panorama
explica o estado da pesquisa ao pesquisador. Resultados, conclusões e notas
sustentam essa explicação por referências.

O Panorama é uma página identificada por um metadado de posicionamento. Seu
contrato usa `fields.placement: "panorama"`. Entre as páginas do laboratório,
a mais recentemente atualizada é escolhida; ID crescente desempata. Status
não participa da seleção. Candidatas não escolhidas e páginas com posicionamento
desconhecido continuam acessíveis na sidebar como documentos comuns. A lista
compartilhada consulta até 5.000 páginas recentes com filtro `kind: "page"`.

Pico atualiza `PICO.md` quando muda a direção operacional e o Panorama quando
há algo relevante para comunicar. Não exigir cópia do mesmo resumo nas duas
superfícies nem sincronização automática. A UI mostra a data do conteúdo, sem
inferir se uma contribuição foi incorporada ou se uma síntese está obsoleta.

Abrir o Panorama apenas lê dados. Um laboratório sem página editorial tem um
estado inicial útil, com acesso à conversa e ao material já existente.

## Evolução e histórico

Notas sobre decisões, descobertas e caminhos descartados fornecem a narrativa.
O `reason` das revisões explica alterações em hipóteses e conclusões. O
histórico detalhado permite consultar versões anteriores. Atividade técnica,
como término de jobs, fica identificada e em um nível secundário.

Ausência de explicação deve ser apresentada como ausência. A UI não deduz uma
descoberta pelo exit code de um processo. A qualidade editorial depende de
Pico registrar conteúdo útil e deve ser avaliada como tal.

Uma linha de `revisions` guarda o snapshot anterior; motivo, autoria da
alteração e data descrevem a passagem para a próxima revisão. A consulta deve
preservar essa semântica. Reaproveitar o histórico existente, sem uma segunda
tabela de eventos ou snapshots de pesquisa.

Referências inicialmente apontam para os registros atuais. As revisões
continuam consultáveis, mas isso não congela os destinos dos links históricos.
Referências fixas a revisões entram quando um fluxo concreto exigir essa
capacidade; não prometer uma reconstrução histórica completa nesta entrega.

## Catálogo inicial

| Bloco | Conteúdo e implementação |
| --- | --- |
| `markdown` | Texto, títulos, listas, tabelas e citações, usando o renderer atual. |
| `records` | IDs explícitos de registros, apresentados com componentes existentes. |
| `artifact` | Arquivo ou figura com legenda, usando acesso e preview existentes. |

Um contrato tipado e um renderer com `switch` são suficientes. Pico escolhe
conteúdo e ordem; componentes e CSS definem apresentação e responsividade.
Não incluir plugins, consultas arbitrárias, código executável nos blocos,
árvore livre de layouts ou editor visual.

Uma atualização substitui a lista de blocos inteira, conforme a semântica de
merge superficial de `fields` em `save_record`. O `body` oferece uma leitura
alternativa. Blocos desconhecidos e referências ausentes não derrubam a página.

O contrato inicial é `{type:"markdown", text:string}`, `{type:"records",
ids:string[]}` e `{type:"artifact", path:string, caption?:string}`. Campos
incompletos ou desconhecidos continuam sendo persistidos pelas tools atuais;
o renderer mostra avisos locais, conserva o conteúdo válido e permite abrir
referências ainda não carregadas. Não há validação científica no renderer.
Com blocos válidos, `body` fica disponível em uma leitura alternativa recolhida;
sem blocos utilizáveis, aparece diretamente. Snapshots de revisões só montam
seus previews ao expandir; exibem aviso de que os materiais vinculados são atuais.

Tabelas não têm recursos de planilha e dependências começam como texto e
referências. Novos blocos precisam demonstrar utilidade em conteúdo real.

## Conversa e estado da UI

Extrair um controle de conversa mantido pelo laboratório aberto, com uma
assinatura de eventos e um estado de streaming. A apresentação usa uma
instância por vez, como página ou painel lateral. Scroll, foco e expansão de
tools pertencem à apresentação.

Reaproveitar rascunhos por laboratório, router por hash, EventSource e
`usePoll`. Na reconexão, consultar o estado atual. Discutir uma fonte adiciona
contexto ao compositor sem enviar automaticamente nem sobrescrever o rascunho.

A lateral mostra Pico e trabalho real. O evento `agent_start` da sessão atual
não representa a criação de um subagente. A árvore ganha filhos quando existir
delegação real, conforme o [backlog futuro](subagentes.md).

## Preservação e verificação

Preservar registros, IDs, revisões, sessões, arquivos e jobs existentes. Exibir
vínculos conhecidos e manter materiais sem associação acessíveis. Não fazer
backfill de investigações ou marcos fictícios, nem transferir dados simulados
do protótipo para laboratórios reais.

Os cenários de verificação cobrem pesquisa computacional, qualitativa, teórica,
de bancada e laboratório vazio. Separar execução encerrada de pergunta
respondida; preservar divergências e identificar dependências humanas.

Atualizar o README junto de mudanças de produto. Rodar os testes adequados a
cada mudança e `bun run check` nos marcos de integração. Testes usam modelo
falso, sem provedores externos; avaliação com modelo real é uma evidência
separada, não algo demonstrado pelo protótipo.

## Refinamentos adiados

Nome opcional e cor individual na criação de labs podem ser mudanças isoladas
posteriores; a issue da sidebar usa o contrato atual. Também ficam para depois
o marcador de última visita, detecção automática de síntese desatualizada,
referências históricas completas, pausa global da pesquisa e agendamento.
