# Issues da migração

As 14 issues abaixo descrevem a implementação da nova experiência. As issues
01–09 estão implementadas, com limites de verificação nos relatórios das levas;
10–14 continuam planejadas. Os números são IDs
locais; não foram criadas issues externas. A direção e os limites estão em
[Decisões](decisoes.md), e as capturas em [Referências](referencias.md).

Cada issue deve produzir um PR coerente, com comportamento observável. As
issues seguintes devem ser refinadas ao iniciar, usando o que aprendermos
com dados reais.

Em todas as mudanças, preservar separação por laboratório, acesso aos dados
existentes, mensagens de erro, foco de teclado e responsividade. Verificações
acompanham a implementação. A issue 14 confere a integração completa.

## Issue 01 Identidade visual

**Estado:** implementada; validação visual interativa pendente. Ver [primeira leva](primeira-leva.md).

**Objetivo:** aplicar a direção grafite e violeta à aplicação atual.

**Escopo:** revisar tokens de cores, espaçamento, bordas, foco e tipografia nos
estilos existentes; usar DM Sans no texto e Manrope nos títulos, com fontes
locais e licenças. Preservar o tema claro como alternativa legível. Não copiar
a sequência de folhas de estilo sobrepostas do protótipo.

**Conclusão:** telas atuais usam a nova identidade, mantendo contraste, estados
de interação, tabelas legíveis e layout em telas estreitas.

**Verificação:** comparar Conversa, registros e Acervo com as referências;
conferir tema claro, teclado e viewport móvel no Chrome DevTools MCP.

**Dependências:** nenhuma. **Pontos de partida:** `web/src/styles/`, estilos de
componentes e recursos locais de fontes.

## Issue 02 Sidebar e seletor de laboratórios

**Estado:** implementada; validação de dialogs no navegador pendente. Ver [primeira leva](primeira-leva.md).

**Objetivo:** navegar no novo shell e trocar de pesquisa pelo cabeçalho.

**Escopo:** identidade do lab no topo, lista pesquisável de laboratórios,
acesso à criação, sidebar recolhível, cabeçalho e navegação móvel. Usar a API e
as regras de criação atuais; não adicionar rail externo. As novas áreas entram
na navegação quando suas issues forem implementadas, sem links para telas vazias.

**Conclusão:** trocar e criar laboratórios funciona; o lab atual é identificável
com a sidebar aberta ou recolhida; o menu é acessível no celular e por teclado.

**Verificação:** seleção, busca sem resultados, criação, cancelamento, foco
depois de fechar o seletor e navegação com nome de laboratório longo.

**Dependências:** 01. **Pontos de partida:** `app-shell.tsx`, `navigation.ts`,
`settings-dialog.tsx` e estilos do shell.

## Issue 03 Controle único da conversa

**Estado:** implementada; integração com modelo falso bloqueada neste ambiente. Ver [primeira leva](primeira-leva.md).

**Objetivo:** preservar a conversa enquanto o usuário navega pelo laboratório.

**Escopo:** extrair estado e ações para um hook como `useLabChat`, mantido no
laboratório aberto; reaproveitar rascunhos, polling e SSE. Não adicionar store
global, transporte ou cache próprios. Scroll e foco permanecem na apresentação.

**Conclusão:** sair da página durante streaming e retornar preserva a resposta;
rascunhos e contexto ficam separados por lab; existe um dono da assinatura de
eventos; interrupção e direcionamento durante execução continuam funcionando.

**Verificação:** mudança de rota durante resposta, troca de laboratório,
reconexão, erro de modelo e retorno a uma aba que ficou em segundo plano.
Automação de sessão usa modelo falso.

**Dependências:** nenhuma. **Pontos de partida:** `chat-page.tsx`, `app.tsx`,
`chat-drafts.ts`, `use-events.ts` e `use-poll.ts`.

## Issue 04 Conversa no painel lateral

**Estado:** implementada; validação responsiva interativa pendente. Ver [primeira leva](primeira-leva.md).

**Objetivo:** discutir materiais sem perder o contexto da leitura.

**Escopo:** apresentar a mesma conversa como página ou painel, com uma
instância visual por vez. Adaptar o compositor à largura disponível. Discutir
um registro acrescenta sua referência ao rascunho sem envio automático.

**Conclusão:** abrir material, discuti-lo, expandir a conversa e voltar mantém
rascunho, contexto e resposta em andamento; fechar o painel não cancela o turno.

**Verificação:** fluxo de uma fonte até a conversa, rascunho já preenchido,
streaming durante troca de apresentação, foco e comportamento no celular.

**Dependências:** 02 e 03. **Pontos de partida:** `app.tsx`, componentes de chat
e ações atuais de discussão dos registros.

## Issue 05 Investigações a partir de perguntas

**Estado:** implementada; revisão e testes concluídos, validação interativa pendente. Ver [segunda leva](segunda-leva.md).

**Objetivo:** organizar as frentes de pesquisa com os vínculos existentes.

**Escopo:** página de perguntas com hipóteses, experimentos, resultados,
conclusões e notas relacionados. Reutilizar detalhes existentes e os vínculos
de jobs a experimentos. Extrair consultas/helpers da Overview quando isso
evitar dependência entre telas. Não criar o kind `investigation`.

**Conclusão:** uma pergunta abre seus materiais e permite discussão contextual;
vínculos incompletos não ocultam registros; a UI não infere pergunta respondida
a partir de processo concluído. URLs de detalhes existentes continuam úteis.

**Verificação:** pergunta sem resposta, hipótese refutada, conclusão provisória,
material sem vínculo e um experimento com mais de um job.

**Dependências:** 02. **Pontos de partida:** Overview, `record-card.tsx`,
detalhes de experimentos e `navigation.ts`.

## Issue 06 Acervo integrado

**Estado:** implementada; leitores e navegação verificados com HTTP/DOM simulados, Chrome pendente. Ver [segunda leva](segunda-leva.md).

**Objetivo:** encontrar materiais sem depender do tipo de pesquisa.

**Escopo:** reunir acesso a fontes, datasets, demais registros e arquivos.
Reaproveitar biblioteca, leitores, previews e tela de registro. Preservar
links para experimentos, métricas, logs e arquivos; evitar um segundo catálogo
de dados ou repositório de conteúdo.

**Conclusão:** todo material hoje acessível tem um caminho na nova organização;
fontes e dados conservam origem, arquivos relacionados e links de discussão.

**Verificação:** fonte com vários arquivos, dataset, arquivo sem registro,
referência ausente, preview não disponível e acervo vazio.

**Dependências:** 02. **Pontos de partida:** `library-page.tsx`, `files-page.tsx`,
`file-preview.tsx`, `record-card.tsx` e navegação.

## Issue 07 Acompanhamento ao lado da conversa

**Estado:** implementada com sessão, perguntas e jobs reais; nenhuma delegação Pico adicionada. Ver [segunda leva](segunda-leva.md).

**Objetivo:** tornar o trabalho atual visível sem sair do chat.

**Escopo:** painel à esquerda com Pico, perguntas e execuções reais, usando
os dados disponíveis. Rotular perguntas, jobs e dependências conforme sua
natureza. No celular, abrir o acompanhamento sob demanda.

**Conclusão:** o painel permite identificar o trabalho em curso, abrir seus
materiais e levá-los à conversa. O laboratório vazio continua completo e não
mostra agentes, contribuições ou progresso fictícios.

**Verificação:** sessão ociosa e ativa, job em andamento, falha, retorno
disponível, várias perguntas e abertura do painel em viewport móvel.

**Dependências:** 03 e 05. **Pontos de partida:** apresentação do chat,
consultas de registros/jobs e estado atual da sessão.

## Issue 08 Consulta do histórico do laboratório

**Estado:** implementada por Records, HTTP e read_records; testes de semântica e isolamento passaram. Ver [segunda leva](segunda-leva.md).

**Objetivo:** consultar alterações sem fazer uma requisição por registro.

**Escopo:** acrescentar uma consulta em `Records` reunindo criações e revisões
do lab, com limite e ordenação estável. Expor o acesso por HTTP e pela
`read_records` existente, com uma opção pequena e documentada. Não criar uma
tabela de eventos ou um histórico paralelo.

**Conclusão:** a resposta identifica registro, revisão, data, autoria e motivo;
representa corretamente que o snapshot salvo é anterior à alteração. Conteúdo
de outros laboratórios não aparece e a consulta não chama o modelo.

**Verificação:** criação, revisões sucessivas, razão ausente, datas iguais,
limite, exclusão conforme comportamento atual e isolamento entre labs.

**Dependências:** nenhuma. **Pontos de partida:** `records.ts`, `contracts.ts`,
`http.ts`, `tools.ts` e testes de registros/API.

## Issue 09 Evolução do entendimento

**Estado:** implementada com histórico existente e orientação do prompt; qualidade editorial com modelo real não validada. Ver [segunda leva](segunda-leva.md).

**Objetivo:** explicar como e por que a pesquisa mudou.

**Escopo:** apresentar notas sobre mudanças e revisões explicadas de hipóteses
e conclusões, com acesso às evidências e versões. Atividade operacional fica
identificada em um nível secundário. Orientar Pico a escrever notas úteis e
usar `reason`, sem exigir um formulário ou criar o kind `milestone`.

**Conclusão:** uma revisão de conclusão mostra o que mudou e o motivo, permite
consultar o conteúdo anterior e discutir suas evidências. Ausência de
explicação não vira uma descoberta inferida pela UI.

**Verificação:** cenário de refutação, leituras divergentes, mudança de direção,
revisão sem motivo e nota de dependência humana. Validar autoria e sequência
temporal com a semântica da issue 08.

**Dependências:** 04 e 08. **Pontos de partida:** consulta de histórico,
componentes de registro, navegação e `prompt.ts`.

## Issue 10 Registro de página

**Estado:** Implementada; ciclo com sessão Pi e modelo falso pendente neste ambiente. Ver [terceira leva](terceira-leva.md).

**Objetivo:** salvar documentos compostos pelo mesmo mecanismo dos registros.

**Escopo:** adicionar `page` aos contratos, identificação, labels e descrição
das tools. Definir um contrato pequeno para os três blocos e metadados de
apresentação, incluindo designação de Panorama e sua seleção determinística.
Usar `fields` e revisões existentes, sem nova tabela ou tool.

**Conclusão:** `save_record` cria e atualiza uma página, `read_records` a
encontra e as revisões preservam versões. Atualizar blocos substitui a lista
inteira. Metadados e dados incompletos têm comportamento documentado.

**Verificação:** criação/leitura pela tool com modelo falso, atualização pela
API, preservação de revisões, isolamento entre labs e registros antigos.

**Dependências:** nenhuma. **Pontos de partida:** `contracts.ts`, `records.ts`,
`tools.ts`, labels da web e testes de registros/sessão.

## Issue 11 Renderer do catálogo mínimo

**Estado:** Implementada; conferência visual interativa pendente. Ver [terceira leva](terceira-leva.md).

**Objetivo:** renderizar páginas legíveis com três componentes concretos.

**Escopo:** `markdown`, `records` e `artifact`, com tipos explícitos e um
renderer com `switch`. Reutilizar Markdown, cards e previews; usar o `body`
como leitura alternativa. Não introduzir consultas livres ou engine de layout.

**Conclusão:** uma página combina texto, registros e figura/arquivo. Blocos
desconhecidos, referência ausente e artifact indisponível não quebram a tela.

**Verificação:** conteúdo longo, tabela larga, citação, lista, figura, arquivo
sem preview e página incompleta. Conferir leitura e navegação no celular.

**Dependências:** 10. **Pontos de partida:** componentes de Markdown,
registros e preview; novos componentes de página na web.

## Issue 12 Páginas na navegação

**Estado:** Implementada; conferência visual interativa pendente. Ver [terceira leva](terceira-leva.md).

**Objetivo:** acessar os documentos que Pico organiza para cada pesquisa.

**Escopo:** listar páginas na sidebar, abrir uma página por URL e permitir
discussão contextual. Preservar a distinção entre páginas do lab e navegação
fixa. Usar o router e as consultas existentes.

**Conclusão:** cada lab exibe suas páginas; recarregar uma URL abre o documento
certo; títulos longos e páginas ausentes têm apresentação útil; lab vazio não
recebe documentos artificiais.

**Verificação:** alternar labs, criar/atualizar uma página, abrir URL direta,
consultar revisões e discutir conteúdo com rascunho já preenchido.

**Dependências:** 02, 04 e 11. **Pontos de partida:** shell, navegação,
renderer e API de registros.

## Issue 13 Panorama editorial

**Estado:** Implementada; ciclo com sessão Pi e modelo falso pendente neste ambiente. Ver [terceira leva](terceira-leva.md).

**Objetivo:** comunicar o entendimento atual sem outra entidade de síntese.

**Escopo:** usar a página designada para Panorama com texto, referências e data
da atualização. Dar a Pico exemplos curtos do catálogo e orientar a atualização
do mesmo documento quando houver algo relevante a comunicar. Manter estado
inicial útil quando ainda não existir essa página.

**Conclusão:** Pico consegue salvar e revisar um Panorama com pergunta,
entendimento, limites e próximos caminhos; a UI não exige seções fixas para
considerá-lo válido. Abrir a tela não chama o modelo nem atualiza o conteúdo.

**Verificação:** ciclo com modelo falso que grava página, notas e referências;
ausência de Panorama; mais de uma candidata segundo a regra da issue 10;
atualização sem perda de histórico. Avaliar qualidade editorial separadamente
com modelo real quando essa validação for realizada.

**Dependências:** 09 e 12. **Pontos de partida:** renderer, navegação,
`prompt.ts` e testes de sessão.

## Issue 14 Validação integrada

**Estado:** pendente. As issues 01–13 estão implementadas; faltam o ciclo integrado com modelo falso e a inspeção no Chrome. Ver [terceira leva](terceira-leva.md).

**Objetivo:** conferir que a experiência completa ajuda a acompanhar pesquisa.

**Escopo:** verificar o laboratório existente sem importar conteúdo fictício;
usar cenários de teste computacional, qualitativo, teórico, bancada e vazio.
Conferir a sequência conversa, trabalho, registro, evolução, evidência,
discussão e Panorama. Revisar README e decisões para refletir a entrega.

**Conclusão:** dados, sessões, IDs e jobs existentes continuam acessíveis; não
há regras específicas para Mit Sloan; fluxos funcionam com teclado e no
celular; `bun run check` passa. Impedimentos preexistentes devem ser registrados
e resolvidos antes de declarar a validação concluída. Limitações da entrega
estão registradas.

**Verificação:** testes com modelo falso e processos reais, navegação no Chrome
DevTools MCP e inspeção visual. Separar resultados automatizados da avaliação
com modelo real. Não iniciar chamadas externas dentro dos testes.

**Dependências:** 01 a 13. **Pontos de partida:** testes existentes de servidor
e web, cenários de pesquisa e referências visuais.
