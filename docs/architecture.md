# Arquitetura da baseline

Estado: baseline e refatoração integral implementadas. O piloto com alvo
multimodal externo é uma validação anterior, preservada no histórico.

A organização atual está em [code-architecture.md](code-architecture.md):
aplicações server/web, motor do laboratório e runner em quatro workspaces.
Contratos públicos ficam no subpath @pico/lab/contracts. A
[revisão adversarial](architecture-review.md) registra decisões, correções
e evidências da implementação.

## Composição

Um backend modular coordena uma sessão principal do Pico por laboratório,
serviços científicos, um executor de experimentos e persistência. A interface
web oferece conversa e acompanhamento.

~~~mermaid
flowchart LR
    UI["Chat e páginas"] <--> P["Pico: sessão principal"]
    UI <--> L["Serviços do laboratório"]
    P --> T["Tools"]
    T --> L
    L <--> D["SQLite e arquivos"]
    L --> R["Executor"]
    R -->|"Estado e observações"| L
    L -->|"Evento persistido de conclusão"| P
~~~

A sessão é uma conversa lógica durável, com turnos serializados. Jobs podem
continuar enquanto o pesquisador conversa e novas mensagens podem entrar na fila.
Pedidos do pesquisador têm precedência sobre análises automáticas ainda enfileiradas.
O resultado de um job volta à mesma conversa através de evento persistido e
deduplicado. Condições de um lote são analisadas juntas quando não restam runs
queued/running no laboratório; as observações já ficam acessíveis antes disso.

## Entidades e relações

| Registro | Responsabilidade e vínculos |
| --- | --- |
| Lab | Nome, linha de pesquisa, direção atual, configuração e limites. |
| Conversation | Conversa principal do lab, mensagens e histórico de chamadas de tools. |
| Question | Pertence ao lab; pode refinar uma pergunta anterior. Texto, contexto, status e revisões. |
| Hypothesis | Pertence ao lab e referencia a pergunta investigada. Afirmação, estado e avaliações fundamentadas. |
| Experiment | Pertence ao lab; liga explicitamente uma ou mais perguntas. Contém objetivo, protocolo, código de trabalho e referências a dados. |
| Run | Pertence a um experimento. Preserva uma tentativa concreta: snapshot, configuração, inputs, estado, logs, métricas e artefatos. |
| Result | Análise de um conjunto explícito de runs do experimento; separa observações e interpretação. |
| Conclusion | Resposta provisória ou consolidada a uma pergunta, apoiada em resultados/fontes, com limitações e histórico. |
| Paper / DatasetVersion | Fontes do lab. Papers oferecem passagens citáveis; versões de datasets preservam arquivos, origem e manifesto. |

As relações são explícitas. O experimento continua ligado à pergunta quando é
exploratório e ainda não tem hipótese. O vínculo direto é usado tanto pelos
resumos de Pico quanto pelas páginas e contadores.

Os critérios previstos ficam no protocolo versionado do experimento, vinculados
às hipóteses que ele testa, e são copiados para a execução. Uma tabela separada
de previsões só será necessária se houver consultas ou operações que a justifiquem.

Autoria identifica pesquisador, Pico ou processo do sistema, com referência à
conversa/turno quando aplicável. Identificadores são estáveis e únicos; rótulos
curtos são apenas apresentação e não definem o escopo científico.

## Ciclo científico

O caminho comum passa por pergunta, hipótese, experimento, observações e conclusão.
A exploração pode começar apenas com pergunta, objetivo e procedimento mínimo.
Uma hipótese não deve ser inventada apenas para satisfazer uma exigência do sistema.

O resultado registra o que as execuções mostram e como isso foi interpretado.
A conclusão registra até onde essas evidências respondem à pergunta. Falhas,
ausência de efeito e resultados inconclusivos também são conhecimento preservado.

Resultados novos identificam evidências com `evidenceVersion: 1`: métricas
referenciam run, nome, valor e dimensões; artefatos referenciam run, path e hash.
O domínio verifica essas referências nas observações reais. Resultados antigos
permanecem sem referências inventadas; enriquecê-los exige revisão explícita.
Avaliações supported/refuted exigem evidência verificada e critérios previstos.

As conclusões podem ser revistas; a revisão registra sua origem e a razão da
mudança. Nenhuma mudança de estado apaga resultados anteriores.

## Pico e tools

O adaptador de modelo recebe contexto e tools e produz mensagens/chamadas. Ele
não é proprietário da pesquisa. O catálogo de tools é composto para o lab atual;
labId, autoria e autorização são fornecidos pelo servidor.

O acesso preferido ao modelo usa `ModelRuntime` do SDK público Pi: catálogo,
autenticação e inferência, mantendo o loop durável do Pico. Providers e modelos
são escolhidos por laboratório. Credenciais permanecem no perfil Pi exclusivo
do Pico (`PICO_DATA_DIR/pi` por padrão); nenhum
valor é copiado para SQLite, prompts ou snapshots. O adaptador preserva respostas
nativas (incluindo assinaturas de reasoning e grupos de tool calls) internamente,
sem reconstruí-las a partir do texto da UI. A compatibilidade Chat Completions e
o narrador de demonstração continuam como alternativas explícitas.

`pi-web-access` é uma dependência fixada do projeto. Um processo auxiliar por lab
carrega somente essa extensão pelo SDK e executa suas tools de busca/leitura.
Não faz inferência nem cria outra conversa de pesquisa. Caches e temporários
ficam em `runtime/web/<lab-id>`, sem descoberta de configuração pessoal do Pi.
O loop durável registra chamadas/resultados e o lab preserva fontes selecionadas.
Detalhes em [search.md](search.md).

Capacidades iniciais:

- Consultar o estado do laboratório e ler registros específicos.
- Criar/revisar perguntas, hipóteses e protocolos.
- Consultar literatura e registrar fontes com referências verificáveis.
- Registrar/vincular versões de datasets.
- Ler/escrever arquivos do experimento e declarar dependências.
- Iniciar, consultar e cancelar runs; ler logs, métricas e artefatos.
- Registrar resultados, avaliações e conclusões vinculadas às evidências.

As tools são adaptadores pequenos sobre operações do domínio. Não expõem escrita
arbitrária no banco. Comandos relacionados podem ser agrupados em uma operação
atômica quando isso evita estados científicos incompletos.

O contexto começa com instruções estáveis, resumo do notebook e checkpoint
extrativo, seguidos de grupos completos de histórico; o índice mutável do lab,
a data UTC e o pedido atual ficam ao final. Pedidos recentes do pesquisador
também permanecem explícitos, mesmo após muitos eventos de execução.

O checkpoint extrativo guarda trechos e IDs, sem produzir uma nova interpretação
científica. Seu cursor e conteúdo são gravados juntos; não avançam sobre pedidos
queued ainda não vistos nem grupos de tools pendentes. `summaryThroughMessageId`
é aplicado ao replay e o checkpoint automático tem cursor próprio. Nenhum deles
apaga mensagens, respostas nativas, assinaturas ou recibos. Uma resposta nativa
grande demais é retirada do replay como grupo inteiro e continua preservada.

As tools devolvem no máximo 24.000 bytes serializados. Leituras extensas usam
offset UTF-8, `nextOffset` e fingerprint SHA-256; uma mudança da origem invalida
a continuação, impedindo misturar revisões. Binários retornam metadados. Recibos
de mutações conservam o sucesso e o ID do registro mesmo quando sua projeção é
abreviada. Resultados legados também são limitados no replay, sem alterar a
resposta assinada do assistente. Erros de janela de contexto reduzem um orçamento
persistido e tentam uma projeção menor; uma janela insuficiente para as próprias
instruções/tools requer trocar o modelo, com todo o trabalho anterior preservado.

Cada bloco de trabalho limita passos e pode limitar tokens/custo observados.
O consumo agrega as respostas persistidas, inclusive respostas recusadas ou
interrompidas que informem uso. Ausência de preço/tokens é desconhecimento,
nunca custo zero comprovado. A pausa ocorre antes da próxima chamada quando o
limite foi atingido ou a unidade configurada não foi informada; uma resposta
pode ultrapassar a franquia. Continuar concede outro bloco e mantém o consumo
acumulado. Isso não constitui um teto financeiro pré-pago.

## Persistência e recuperação

SQLite guarda entidades, relações, revisões, mensagens, chamadas de tools, jobs
e eventos pendentes. Os arquivos grandes ficam em diretório próprio configurado
por PICO_DATA_DIR, fora da árvore de código.

Layout conceitual:

~~~text
PICO_DATA_DIR/
  pico.sqlite
  .pico-owner.sqlite     # exclusão operacional entre instâncias; fora do backup
  labs/<lab-id>/
    datasets/<version-id>/files/
    experiments/<experiment-id>/workspace/
    run-records/
    runs/<run-id>/
      snapshot/
        inputs/
        code/
        config.json
        manifest.json
      work/               # cópia executável descartável; fora do backup
      outputs/
      run.json
~~~

O diretório de dados não é recriado por atualização, build ou instalação.
Migrações têm versão e testes sobre dados existentes. Backups coordenam banco e
arquivos; sua restauração deve ser demonstrada.

Cada chamada que modifica o lab recebe uma chave de idempotência. Registrar seu
início e resultado e reconciliar o estado após interrupções. Executar código é
um efeito externo: se o estado após falha for ambíguo, verificar processo e
arquivos existentes antes de iniciar outra tentativa.

A entrega de eventos é deduplicada por todos os `eventIds`, inclusive eventos
secundários de um lote após reinício. Consumo, mensagem e associação ao turno
compartilham a transação. Apenas turnos queued recebem novos eventos; `eventRuns`
preserva todas as referências, pagináveis por `read_turn`. Mensagens de observação
entram no modelo como dados, sem autoridade system, e mantêm `eventId` para a
UI identificar autoria do laboratório. Esses turnos não recebem `start_run`.
O término torna-se observável antes de solicitar análise a Pico; falhas do modelo
não perdem as observações. Um run com estado incerto pode adiar o lote até a
reconciliação, e o pesquisador pode pedir uma análise parcial explicitamente.

## Execuções e reprodução

Ao iniciar um run:

1. Fixar a versão do protocolo e os critérios previstos, quando existirem.
2. Preservar código, lockfile, configuração, seeds e referências de ambiente/modelo.
3. Fixar os inputs e seus manifestos/hashes.
4. Executar em diretório próprio daquela tentativa.
5. Registrar estado, comando, tempos, saídas por exemplo, métricas e artefatos.
6. Publicar o resultado operacional para a sessão de Pico analisar.

O código de trabalho pode evoluir para o próximo experimento sem modificar o
snapshot de uma execução já registrada. Reexecutar cria outro run e mantém a
relação com a tentativa usada como referência.

A rastreabilidade das condições é obrigatória; igualdade numérica pode depender
de determinismo, hardware ou serviço externo. Registrar essas limitações.

A execução usa limites do lab/run, alvo e ambiente explícitos. Credenciais são
referenciadas por configuração de execução e não copiadas para snapshots, logs
ou prompts. O backend atual é local; outros entram pela mesma fronteira
quando o uso exigir.

## Interface

- Conversa: investigação, decisões e informes de execução.
- Visão geral: perguntas, entendimento atual, trabalho em andamento e
  interrupções.
- Experimentos: planos, tentativas, comparação, código e reprodução.
- Biblioteca: papers e datasets, com origem e utilização.

A interface está disponível em português do Brasil (`pt-BR`, padrão) e inglês
(`en`), com react-i18next. O botão de idioma na barra superior troca textos,
datas e números sem recarregar; a escolha fica no navegador, como o tema.
Mensagens produzidas pelo servidor, como eventos e erros, e os nomes técnicos
de tools, métricas e arquivos permanecem como registrados.

A UI lê as projeções do lab por consultas periódicas enquanto a página está
visível. Eventos persistidos ligam o executor à sessão; não exigem conexão aberta
do navegador. Nenhum estado científico depende de uma página aberta.

## Evolução preservando pesquisas

Versões futuras mantêm IDs e relações, migram schemas e preservam arquivos.
Registros podem guardar versões de modelo, prompt e catálogo de tools para
rastrear a origem das interpretações.

Novos agentes poderão usar as mesmas operações e adicionar autoria própria.
A introdução deles não muda o proprietário dos dados científicos.

A importação da implementação anterior é uma operação explícita, com relatório
de correspondências e relações não resolvidas. Campanhas e agentes antigos
podem ser preservados como proveniência histórica.
