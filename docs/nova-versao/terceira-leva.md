# Terceira leva: páginas compostas por Pico

Issues 10–13 implementadas em 30 de setembro de 2026. Três subagentes
dividiram contrato/persistência, renderer e navegação. O agente principal
integrou o leitor, as revisões, o Panorama, as orientações do modelo e a
documentação. Duas rodadas adversariais cruzaram essas frentes; os achados
foram corrigidos e conferidos novamente, sem P1/P2 remanescentes no escopo.

## Comportamento entregue

| Issue | Entrega |
| --- | --- |
| 10 | Kind `page`, prefixo `page`, contrato `PageBlock`/`PageFields` e descrições nas tools existentes. SQLite e revisões continuam os mesmos. |
| 11 | Renderer com três casos: `markdown`, `records` e `artifact`. Reutiliza texto, cards e previews; preserva leitura alternativa, avisos e links quando há conteúdo incompleto ou indisponível. |
| 12 | Páginas do lab aparecem na sidebar, com URLs diretas, títulos acessíveis e discussão contextual. A consulta de páginas é compartilhada pelo workspace, sidebar e Panorama. |
| 13 | Panorama lê uma página designada, com data, autoria e revisões. O prompt orienta Pico a compor e atualizar esse documento com evidências, limites e próximos caminhos. Sem página, oferece planejamento na conversa e acesso à Evolução. |

O item fixo Panorama substitui Visão geral na sidebar; a rota anterior
continua disponível. Abrir páginas apenas consulta dados. Discutir ou planejar
acrescenta contexto ao rascunho sem envio automático, preservando a conversa
e a assinatura de eventos do laboratório.

## Contrato e seleção

`save_record` continua salvando registros com campos livres. Uma página usa
`fields.blocks` como lista ordenada:

```ts
type PageBlock =
  | { type: "markdown"; text: string }
  | { type: "records"; ids: string[] }
  | { type: "artifact"; path: string; caption?: string };

interface PageFields {
  placement?: "panorama";
  blocks?: PageBlock[];
}
```

Os tipos documentam a apresentação; campos incompletos ou desconhecidos não
impedem gravação. `fields.blocks` substitui a lista inteira na revisão, pelo
merge superficial existente. `body` aparece diretamente quando não há blocos
utilizáveis, ou em uma leitura alternativa recolhida quando há blocos.

`fields.placement: "panorama"` designa a página editorial. A UI seleciona a
candidata mais recentemente atualizada, com ID crescente nos empates,
independentemente do status. Candidatas não escolhidas permanecem como páginas
comuns, assim como posicionamentos desconhecidos. A consulta filtra `page`
antes de aplicar o limite de até 5.000 documentos mais recentes do lab.

Referências são IDs explícitos. Os cards usam a consulta existente de até 500
registros; IDs fora dela continuam abrindo o detalhe, sem requisição por item
ou declaração falsa de inexistência. Páginas referenciadas ficam como cards,
sem recursão. Artifacts usam caminhos relativos e a API de arquivos existente,
incluindo seu controle de acesso à pasta do laboratório.

Revisões preservam os blocos e texto antigos. Seu conteúdo é montado somente
ao expandir, com título e status históricos. Registros e arquivos vinculados
continuam atuais, com aviso explícito; não há snapshots extras dos destinos.
`PICO.md` mantém direção e convenções, sem sincronização obrigatória com o
Panorama. Nenhuma seção científica fixa ou porcentagem de progresso foi criada.

## Revisão adversarial e correções

| Achado | Correção conferida |
| --- | --- |
| Previews de todas as revisões eram consultados ao abrir a página, mesmo recolhidos. | Montar o conteúdo histórico somente ao expandir cada versão. |
| Artifacts indisponíveis ocultavam a síntese em `body`. | Oferecer leitura alternativa também quando existem blocos, sem coordenar estados dos filhos. |
| Revisão antiga mostrava registros e arquivos atuais sem identificação. | Aviso junto à versão histórica, mantendo título e status do snapshot. |
| Referência não carregada a uma página poderia abrir campos brutos no Acervo. | Renderer também no detalhe do Acervo quando o registro lido é `page`; inferência do prefixo `page-` apenas quando o tipo do link é desconhecido. |
| Falha na consulta de referências não tinha nova tentativa. | Aviso e retry junto ao leitor, conservando links individuais. |
| Títulos longos recusavam encolher no breadcrumb; heading aparecia na sidebar recolhida. | Permitir encolhimento e ellipsis; ocultar o heading no desktop recolhido, conservando nomes acessíveis. |
| Fixture de atualização por tool omitia `kind`, exigido pelo contrato existente. | Corrigir a fixture sem afrouxar a tool. |

Não foram adicionados tabelas, tools, dependências, store, cache, engine de
layout ou runtime. O leitor usa um callback pequeno no detalhe existente,
também aplicado aos snapshots. HTTP e tools continuam chamando `Records`.
Os cenários automatizados usam suas próprias fixtures; nenhum conteúdo de
demonstração foi gravado em um laboratório real. Subagentes de Pico continuam
no [backlog futuro](subagentes.md).

## Verificação

- Typecheck de servidor, web e testes passou. Biome passou com os dois avisos
  de especificidade CSS preexistentes em `styles/pages.css`.
- `bun run check`: 72 testes passaram, um falhou, 460 assertions. A falha
  continua no bind de `Bun.serve({port:0})` do endpoint do modelo falso, antes
  de executar a sessão. O comando completo interrompe antes do build.
- Build separado passou; Vite conserva o aviso do chunk principal, agora
  aproximadamente 522 kB, sem dependências novas.
- 22 testes das páginas passaram, com 159 assertions: tools executadas
  diretamente, HTTP via `app.fetch`, revisões, substituição integral de blocos,
  isolamento, conteúdo incompleto, artifacts indisponíveis, navegação,
  seleção, leitura atual e deferimento de arquivos históricos.
- Diagnóstico temporário com React DOM/LinkeDOM e fetch/EventSource simulados
  passou com 118 assertions: App real, uma assinatura SSE e consulta de páginas
  ao navegar, rascunhos, URLs, seleção atualizada, troca de lab, estados vazios,
  arquivos históricos só ao expandir e acesso a páginas fora da lista local.
  Uma conferência adicional verificou títulos, foco após rename/collapse e
  isolamento defensivo entre laboratórios. Sem rede ou modelo, esses testes
  não substituem layout, foco e elementos nativos no Chrome.
- O teste existente de sessão Pi foi estendido para criar Panorama com os
  três blocos e referências, revisá-lo e registrar uma nota sobre limites
  depois de um job. Esse trecho foi revisado e tipado, mas não executado por
  causa do bind bloqueado. Não declarar ciclo com modelo falso validado.

Chrome DevTools MCP permanece indisponível neste ambiente. A issue 14 ainda
precisa da inspeção visual/teclado/celular e do ciclo completo com modelo falso
em ambiente que permita sockets. Avaliação editorial com modelo real é
separada e não foi realizada. Cenários computacional, qualitativo, teórico,
de bancada e vazio continuam na conferência integrada, sem pressupor uma
estrutura científica específica para cada pesquisa.
