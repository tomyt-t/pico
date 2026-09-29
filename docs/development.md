# Desenvolvimento por marcos

Os marcos entregam capacidades demonstráveis. A interface cresce junto de cada
fluxo. M1–M4 implementam a baseline; M5 registra o primeiro caso
de pesquisa pretendido. As entregas concluídas permanecem documentadas abaixo.

## Situação inicial

- [x] Nome do produto: Pico; pasta de trabalho pretendida: tiny-pico.
- [x] Direção: uma sessão principal por lab, tools e registros persistentes.
- [x] Arquitetura inicial e critérios de evolução registrados.
- [x] M1 — Laboratório durável.
- [x] M2 — Pico operando o laboratório.
- [x] M3 — Experimento local rastreável.
- [x] M4 — Ciclo científico completo.
- [x] M5 — Piloto de defesas em LLMs multimodais.

M1–M5 demonstrados pela implementação, por 121 testes automatizados e pela UI
em Chrome DevTools MCP. Typecheck, Biome e build de produção passaram.
Detalhes e limitações estão em [validation.md](validation.md).

M5 foi executado com Pi e o alvo `zai/glm-5.3-flash`: quatro inferências baseline,
quatro com defesa e quatro reproduzindo a baseline preservada. Pico leu os
artefatos e registrou análise comparativa e conclusão provisória. ASR foi zero
nos dois braços, com acurácia 1.0 nos dois splits: efeito de piso, sem evidência
de ganho da defesa. O protocolo e estímulos estão em `examples/multimodal-defense`.
O piloto original usou a autenticação então configurada no Pi, por referência.
A entrega de isolamento abaixo passou a usar o perfil próprio do Pico.

## Entrega posterior — busca e instalação independente

- [x] Pi incluído no projeto, com perfil próprio e comando `bun run pi`.
- [x] `pi-web-access` fixado como dependência e isolado por laboratório.
- [x] Busca web, leitura de HTML/PDF e consulta de passagens na conversa.
- [x] Fontes preservadas na Library pelo fluxo científico existente.
- [x] Executor usa o perfil Pi do Pico; dados/snapshots anteriores permanecem.
- [x] Instalação limpa, leitura externa e testes de isolamento/cancelamento.

Validação daquela entrega: 130 testes, 620 assertions, typecheck, lint e build aprovados.
Google pode ser configurado via Serper/SerpApi; o teste externo usou Exa.
Consulte [search.md](search.md) para configuração e compartilhamento.

## Entrega concluída — Refatoração integral da organização do código

A [arquitetura implementada](code-architecture.md) substituiu a árvore antiga
em uma única entrega, com três subagentes e duas rodadas adversariais do desenho,
seguidas de duas rodadas sobre a implementação. Os contraexemplos e as correções
estão em [architecture-review.md](architecture-review.md).

- [x] Separar apps/server, apps/web, packages/lab e packages/runner.
- [x] Expor contratos por @pico/lab/contracts, sem workspace separado.
- [x] Executar o ciclo científico sem HTTP e o runner sem lab/Pi.
- [x] Atualizar API, tools, UI, scripts e testes para as mesmas operações.
- [x] Verificar imports reais, exports, aliases, fronteiras e ciclos automaticamente.
- [x] Preservar snapshots v1, recibos, IDs, autoria, revisões e replay nativo.
- [x] Validar referências estruturadas a observações e tratar registros anteriores.
- [x] Demonstrar recuperação de publicação antes da projeção SQLite.
- [x] Demonstrar backup/restore, quiescência e exclusão operacional.
- [x] Demonstrar supervisão, cancelamento e morte do supervisor com processos reais.
- [x] Validar UI, rascunhos, navegação e retry após resposta de escrita perdida.
- [x] Remover implementação antiga e sincronizar documentação/instruções.

A fixture histórica foi gerada pelo código anterior à refatoração, com Python
real e modelo Pi simulado. A validação desta entrega não usou inferência externa
nem alterou pesquisas pessoais. Aceite final: **184 testes, 1.043 assertions, zero falhas**, TypeScript, Biome
e build aprovados. Evidências e limites estão em
[validation.md](validation.md). O runner continua destinado a código confiável;
não oferece contenção contra escape do grupo ou morte isolada do watchdog.

## Próximas evoluções

Não há outra refatoração estrutural necessária para concluir esta entrega.
Novas abstrações e pacotes devem responder a um consumidor ou cenário concreto.
As possibilidades de produto após M5 continuam no fim deste documento; a próxima
capacidade será escolhida a partir do uso do laboratório.

## Estabilização — Conversas extensas e análise de lotes (29/09/2026)

Entrega implementada após as duas análises do produto, com desenho contestado
por subagentes e duas rodadas adversariais sobre a implementação. O relatório
integrado da estabilização registra a validação final das demais frentes.

- [x] Limitar todas as respostas de tools; oferecer páginas UTF-8 verificadas por
  fingerprint e metadados para binários.
- [x] Aplicar checkpoints duráveis sem cortar batches assinados, pedidos queued
  não vistos ou tools pendentes; conservar histórico e recibos originais.
- [x] Reduzir o contexto após overflow do provedor sem reenviar indefinidamente
  o mesmo conteúdo excessivo.
- [x] Agregar eventos de um lote, preservar todas as referências a runs e impedir
  reanálise duplicada mesmo quando um evento secundário é reentregue.
- [x] Tratar observações de execução como dados no modelo e manter a autoria
  identificável na UI; priorizar pedidos do pesquisador na fila.
- [x] Expor consumo observado por turno/laboratório e pausa por passos, tokens
  ou custo, distinguindo uso/preço desconhecidos.
- [x] Orientar Pico sobre baseline, controles, amostragem, confundidores e critérios
  anteriores à execução; informar a data atual fora das instruções estáveis.

O aceite usa providers simulados/transporte HTTP local para replay, orçamento,
erro de contexto e recuperações. O cenário de demonstração executa Python real.
A fixture histórica permanece intacta. Esses testes não demonstram raciocínio
de um modelo externo nem suporte operacional a outro sistema. Compactação é
extrativa, e o limite financeiro usa consumo informado depois da chamada; nenhuma
dessas capacidades representa uma garantia de memória sem perdas ou gasto pré-pago.

A entrega integrada também concluiu integridade científica, revisões de evidência,
diagnóstico/reparo do runner, segurança do navegador, Pi opt-in por experimento,
datasets grandes em streaming, limites Linux e melhorias de UI. Aceite final:
**248 testes e 1.521 assertions**, TypeScript, lint e build aprovados. Runner
executado em Linux sem ps; GLM 5.3 validou o ciclo com 25 chamadas reais e backup
restaurável. Detalhes, rodadas adversariais, custo e limites em
[stabilization-2026-09.md](stabilization-2026-09.md).

## M1 — Laboratório durável

Entregar:
- Projeto TypeScript/Bun com configuração de testes e alias @/.
- Composição do backend, SQLite e diretório de dados configurável.
- Migração inicial; Lab e Question com IDs, autoria e timestamps.
- Operações de criação/leitura e uma primeira projeção do overview.
- Backup e restauração coerentes de dados.

Demonstração:
Criar lab e pergunta, fechar a aplicação, reabrir e recuperar os mesmos IDs.
Aplicar uma migração de teste e restaurar um backup sem perder os vínculos.
Expor o overview mínimo pela API.

## M2 — Pico operando o laboratório

Entregar:
- Conversa principal persistente por laboratório e interface de Chat.
- Adaptador de modelo com execução simulada determinística para testes.
- Tools que consultam o lab e registram perguntas, hipóteses e experimentos.
- Registro incremental e idempotência de chamadas que alteram o lab.
- Contexto inicial com direção, trabalho recente e leitura detalhada por demanda.
- Overview e detalhes refletindo os registros produzidos pela conversa.

Demonstração:
Na mesma conversa, definir a pesquisa, registrar uma pergunta, uma hipótese e
um plano de experimento. Recarregar a UI e confirmar que Pico e páginas leem os
mesmos registros. Repetir uma chamada com a mesma chave sem duplicar a entidade.
Também criar um experimento exploratório sem hipótese.

Limite desta etapa: experimento planejado, ainda sem execução.

## M3 — Experimento local rastreável

Entregar:
- Filesystem limitado ao workspace e tools de arquivos/dependências.
- Registro de dataset/versionamento e vínculo com o experimento.
- Snapshot de código, protocolo, configuração e inputs por run.
- Executor local: fila, timeout, cancelamento, logs, métricas e artefatos.
- Estados de execução persistidos e reconciliação após reinício.
- Página Experiments com detalhe de runs e inspeção do registro de reprodução.

Demonstração:
Executar um programa pequeno com dados fixos e métrica verificável. Produzir uma
falha, inspecionar logs, corrigir código e executar outra tentativa. Confirmar que
o primeiro snapshot permanece igual. Reexecutar a referência como novo run.
Validar cancelamento, limite e reconciliação sem iniciar um processo duplicado.

Limite desta etapa: observações reais disponíveis; a análise automática ainda
será ligada no próximo marco.

## M4 — Ciclo científico completo

Entregar:
- Evento persistido de término/falha do run consumido na conversa principal.
- Tools de leitura de saídas, registro de resultado e conclusão fundamentada.
- Revisão de hipóteses e critérios, mantendo histórico.
- Biblioteca mínima: importar/ler fontes e consultar os datasets utilizados.
- Comparação entre execuções e ligação entre pergunta, experimento e conclusão.
- Pausa/continuação por orçamento de trabalho, resumo incremental e referências.

Demonstração de aceite da baseline:
Uma conversa registra pergunta, prepara e executa experimento, recebe seu término,
consulta métricas reais e registra análise e conclusão provisória. O pesquisador
discute o resultado e Pico prepara o próximo teste. Toda a rodada permanece
consultável após reinício.

Confirmar:
- Não foi criada campanha nem agente de equipe.
- As métricas citadas correspondem aos outputs das execuções referenciadas.
- A conclusão distingue observações, interpretação e limitações.
- Uma execução exploratória também pode produzir aprendizado registrado.
- Falha do modelo após o run terminar não perde o resultado operacional.
- Reentrega de evento não duplica análise automática nem inicia outro run.
- Nenhuma versão de código ou dados usada pela pesquisa foi sobrescrita.

## M5 — Piloto de defesas em LLMs multimodais

Recorte:
Um modelo alvo, um conjunto pequeno texto+imagem, uma linha de base e uma defesa.

Entregar:
- Versão do dataset preservando os bytes das imagens e textos, splits e hashes.
- Configuração do modelo alvo, prompts, parâmetros e revisão dos pesos quando
  local; credenciais referenciadas e limites de chamadas quando API externa.
- Registro de respostas por exemplo e métricas comparáveis.
- Registro de consumo do experimento compatível com o backend escolhido.

Demonstração:
Pico prepara e executa a comparação nas mesmas entradas. Registra sucesso dos
ataques, desempenho em exemplos legítimos e latência quando fizerem parte do
protocolo. Discute limitações e propõe a próxima investigação. Outra execução
consegue usar as condições preservadas, com diferenças não determinísticas
identificadas.

## Como trabalhar em cada marco

1. Escolher um cenário observável e os contratos necessários.
2. Implementar o fluxo mais curto que complete esse cenário.
3. Verificar invariantes e falhas relevantes.
4. Demonstrar a capacidade pela interface ou pelo cenário executável.
5. Atualizar este documento com o que funciona e o que continua pendente.

Fixar versões de dependências no início da implementação. Reutilizar código
antigo por componente, com revisão de escopo e testes; importar pesquisas antigas
tem seu próprio cenário de migração e não ocorre ao copiar código.

Melhorias posteriores, motivadas pelo uso: novos backends de execução, revisão
por agentes adicionais, colaboração entre pesquisadores e novas formas de análise.
