# Backlog de subagentes

Pico poderá coordenar sessões filhas mantendo uma conversa principal com o
pesquisador. Essa capacidade é uma entrega posterior à [migração da
UI](issues.md). As quatro issues abaixo são planejamento futuro e devem ser
refinadas quando a primeira delegação concreta for implementada.

O Pi SDK continua responsável por sessão, contexto, compactação, tools e
retries. O Pico atual já entrega resultados de jobs à sessão principal; a
evolução deve aproveitar essa base, sem criar um supervisor que envia
mensagens de continuação repetidamente.

## Issue A01 Delegação simples pelo Pi

**Objetivo:** avaliar uma tarefa delegada a uma sessão filha real.

**Escopo:** uma tool cria a sessão filha, passa tarefa e contexto necessário,
acompanha sua conclusão e devolve o retorno a Pico. Começar com um nível de
delegação, aguardado pela tool. O cancelamento alcança a sessão filha.

Identificar explicitamente a conversa principal, pois selecionar a sessão
mais recente pelo mesmo diretório pode passar a escolher uma filha. Injetar a
autoria na construção das tools, em vez de atribuir tudo a `pico`. Usar as APIs
do SDK, consultando a versão instalada durante a implementação.

**Conclusão:** pai e filho têm sessões distintas, a tarefa produz retorno
identificável e registros com origem correta; cancelamento e falha não deixam
a tool aguardando indefinidamente. A sessão principal correta é reaberta.

**Verificação:** modelo falso, sessão Pi real e casos de sucesso, falha,
cancelamento e reabertura. Aceitação do prompt não pode ser confundida com
conclusão do filho.

**Dependências:** nova experiência validada pela issue 14. Não inclui execução
independente em segundo plano, scheduler ou retomada automática após reinício.

## Issue A02 Delegações na árvore da conversa

**Objetivo:** acompanhar tarefas reais sem multiplicar as conversas principais.

**Escopo:** acrescentar filhos reais ao painel de acompanhamento, mostrando
tarefa, estado, retorno e materiais produzidos. O pesquisador continua falando
com Pico; os detalhes da delegação ficam acessíveis por expansão ou navegação.

**Conclusão:** a árvore distingue trabalho em execução, retorno disponível e a
interpretação escrita por Pico. Perguntas, jobs e dependências humanas mantêm
identificação própria. Sem delegações, o painel permanece útil.

**Verificação:** tarefa ativa, concluída, cancelada e com erro; referências ao
retorno; uso móvel e por teclado. Consumir dados da delegação sem criar um
segundo domínio apenas para preencher a árvore.

**Dependências:** A01 e painel da issue 07.

## Issue A03 Escrita concorrente no workspace

**Objetivo:** permitir concorrência com comportamento de arquivos e commits
compreensível.

**Escopo:** examinar colisões de escrita e commits, definir a menor solução
necessária e documentar sua semântica. Os commits atuais incluem o estado do
workspace inteiro; não atribuir seu conteúdo exclusivamente a um filho.

**Conclusão:** existe uma estratégia explícita para alterações e commits
concorrentes, verificada com processos reais e sem perda silenciosa de dados.
Limitações do workspace compartilhado ficam claras. Não introduzir worktrees,
sandbox ou snapshots genéricos apenas para preparar capacidades hipotéticas.

**Verificação:** duas tarefas alterando arquivos, tentativas de commit
simultâneas e falha de uma tarefa. Refinar o tamanho desta issue com base no
experimento A01, dividindo-a se a solução exigir mudanças independentes.

**Dependências:** A01. Deve anteceder a liberação de filhos independentes com
escrita concorrente na A04.

## Issue A04 Delegações em segundo plano

**Objetivo:** permitir que Pico continue investigando enquanto filhos trabalham.

**Escopo:** introduzir apenas os metadados de execução necessários para tarefa,
origem, sessão filha, estado e retorno. Entregar contribuições ao coordenador
pelo mecanismo de notificação, observando a conclusão real da sessão filha.
Definir tratamento de erro, interrupção e reinício antes de declarar execução
durável ou recuperação automática.

**Conclusão:** Pico recebe retornos enquanto trabalha ou está ocioso; identifica
qual delegação os produziu; pode incorporar o resultado na conversa e nas
páginas. Estados interrompidos são apresentados corretamente, e cancelamento
tem alcance documentado. Reabertura não confunde filhos com a conversa principal.

**Verificação:** dois filhos, conclusão durante turno do pai, falha, interrupção,
reinício e entrega de retornos pendentes. Usar modelo falso nos testes e
identificar separadamente a avaliação com modelo real.

**Dependências:** A01 a A03. Ao iniciar, quebrar persistência e entrega de
retornos em PRs menores se necessário, sem unificar jobs e agentes em uma
abstração de execução apenas por semelhança de nomes.

## Capacidades ainda fora do escopo

Agendamento recorrente, delegações em vários níveis, descoberta de agentes,
workflows configuráveis e pausa global da pesquisa dependem de necessidade
observada. Hoje interromper uma resposta e parar um job têm efeitos diferentes;
um retorno de job pode iniciar outro turno. Uma pausa global exigiria política
adicional de entrega e continuidade e não deve ser apenas um novo rótulo na UI.
