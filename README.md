# Pico

Pico é o coordenador de um laboratório de pesquisa: conversa com o pesquisador,
distribui tarefas a agentes especializados e integra os resultados. Cada
laboratório tem uma pasta compartilhada, registros estruturados e uma sessão
Pi persistente para o coordenador. Campanhas perseguem objetivos definidos com
coordenadores próprios e sessões persistentes. Os especialistas trabalham em
sessões Pi efêmeras, com liberdade para ler, escrever e executar código. A UI
mostra a conversa, campanhas e agentes em atividade, registros, jobs e arquivos.

A pasta deste projeto se chama **tiny-pico**; o produto se chama **Pico**.

O [planejamento da nova experiência](docs/nova-versao/README.md) reúne decisões,
issues e referências visuais da próxima versão. Este README descreve o
funcionamento atual.

## Como funciona

- Cada laboratório é uma pasta em `~/pico-labs/<nome>/` e uma sessão Pi
  persistente. O modelo trabalha ali com `read`, `write`, `edit`, `bash`,
  `grep`, `find` e `ls`, sem sandbox.
- O contexto do laboratório guarda linha de pesquisa, direção atual e decisões
  em `labs.context_markdown`. O Pi recebe esse Markdown a cada turno; a tool
  `lab_context` e a interface consultam e atualizam a mesma coluna, com revisões
  e autoria. Um `PICO.md` existente é importado uma única vez e preservado como
  arquivo histórico. Laboratórios novos não criam esse arquivo.
- Tools do Pico: `save_record` e `read_records` para registros estruturados
  (pergunta, hipótese, experimento, resultado, conclusão, nota, paper,
  dataset, página), `save_page` para a edição de páginas, `read_skill` para
  procedimentos e exemplos, `lab_context` para direção e decisões, `run_job`, `list_jobs` e `stop_job` para execuções longas em
  segundo plano, `save_paper` para baixar e registrar fontes, e
  `register_dataset` para registrar pastas de dados ou baixar URLs.
- `read_records` com `history: true` consulta criações e revisões do laboratório,
  com filtro opcional `kind` e `limit` (padrão 100, máximo 500). A HTTP usa a
  mesma consulta em `GET /api/labs/:id/history`. Cada mudança reúne versões
  anterior e posterior, autoria, data e motivo quando registrado. Excluir um
  registro também exclui seu histórico, conforme a persistência existente.
- A extensão `pi-web-access` dá `web_search`, `fetch_content` e
  `get_search_content`.
- Um job é um processo desanexado com log próprio. O workspace é commitado no
  git antes de cada job e ao fim de cada turno. Quando o job termina, uma
  mensagem com estado, métricas de `metrics.json` e o fim do log entra na
  conversa.
- Registros, jobs, laboratórios, definições de agentes e suas execuções ficam
  em um SQLite global. As conversas ficam nos arquivos de sessão do Pi.

## Agentes

O catálogo global vem com cinco perfis fixos, armazenados em `agent_definitions`:

- **Campaign Coordinator:** conduz uma campanha com objetivo e entrega definidos,
  adapta o plano, delega aos especialistas e informa avanços ao Pico.

- **Literature Researcher:** busca e lê fontes, compara métodos e evidências,
  registra referências e explicita lacunas.
- **Experimenter:** desenha protocolos, controles e métricas, prepara dados,
  implementa e executa experimentos, preservando resultados negativos e
  inconclusivos e informação suficiente para reproduzir o trabalho.
- **Critical Analyst:** formula hipóteses verificáveis e explicações alternativas,
  revisa protocolos antes da execução e avalia evidências e limitações depois.
- **Research Editor:** transforma o entendimento consolidado em explicações,
  mantém o Panorama e as páginas por tema, contextualiza interpretações revistas,
  confere referências e figuras e registra o que revisou e o que ficou pendente.

Pico define a pergunta e as prioridades com o pesquisador, delega essas etapas,
consolida o aprendizado e decide os próximos passos. Os prompts orientam o
ciclo científico; a ordem se adapta ao trabalho. Todos os perfis têm acesso às
mesmas ferramentas de pesquisa, arquivo e shell. Pico e os coordenadores de
campanha têm tools de delegação; especialistas não criam outros agentes.

Após consolidar um avanço significativo em registros, Pico delega sua explicação
ao Editor de pesquisa (`research-editor`), com pergunta, materiais, páginas e
incertezas relevantes. Cada laboratório admite uma execução editorial por vez;
os especialistas podem continuar pesquisando em paralelo. O editor mantém os
mesmos IDs para os mesmos temas, cria páginas quando há um assunto distinto com
conteúdo suficiente e registra também revisões que dispensam mudanças no texto.
Ao receber a entrega, Pico consulta as páginas salvas e a cobertura editorial,
informa o que mudou e encaminha questões científicas aos especialistas. O fluxo
é orientado pelos prompts, com pendências persistidas; abrir páginas não inicia
agentes e interromper um editor não dispara automaticamente outro.

Em **Configurações → Agentes**, o pesquisador escolhe provedor/modelo e nível de
raciocínio por perfil. A configuração vale para todos os laboratórios. Os
perfis começam sem modelo selecionado: é preciso configurá-los antes de usar;
não há substituição silenciosa por outro modelo. As credenciais continuam no
perfil Pi, nunca no SQLite. Alterações valem para os próximos spawns; execuções
em andamento conservam sua configuração, e o histórico registra modelo,
nível de raciocínio efetivo, tokens e custo informado pelo provedor.

`list_agents` consulta o catálogo; `run_subagent` recebe `agent_id`, uma tarefa
livre com contexto, caminhos e entrega esperada e um `label` opcional: um
recorte curto (até 30 caracteres) que a UI mostra ao lado do nome do perfil
para distinguir instâncias paralelas. Sem rótulo, a UI numera as instâncias do
mesmo perfil. Cada chamada inicia uma sessão nova em segundo plano. É possível executar várias instâncias do mesmo
perfil em paralelo, inclusive três pesquisas bibliográficas com recortes
diferentes. Instâncias não herdam o chat do Pico nem o contexto de outras
execuções; compartilham arquivos e registros do laboratório. Pico delimita os
escopos para coordenar alterações nos mesmos arquivos.

`list_subagents` consulta execuções e resultados; com `id`, abre a conversa
paginada (`before` e `limit`, como no chat). `stop_subagent` interrompe uma
instância. As tools e a HTTP usam as mesmas funções. Registros produzidos por
um agente identificam sua execução em `author: subagent:<run-id>`.

Cada spawn fica em `agent_runs`, com tarefa, estado, resultado ou erro e
referência à sessão Pi. A conclusão é entregue ao Pico enquanto ele trabalha
ou inicia um novo turno quando está livre. A instância continua visível como
“Entregando resultado” até a mensagem entrar na sessão do coordenador; a
entrega é tentada novamente se o coordenador estiver indisponível. O histórico
permanece consultável após a entrega. O servidor marca execuções em andamento
como interrompidas ao encerrar ou reiniciar, sem retomá-las automaticamente.
Jobs de shell continuam independentes: sobrevivem ao servidor e à interrupção
do agente. Agentes e jobs de uma campanha entregam seus resultados ao coordenador
dela; os demais entregam ao Pico.

## Campanhas

Uma campanha tem nome, objetivo, entrega esperada e contexto. Seu coordenador
escolhe e adapta o caminho, mantendo plano, atividade atual, resumo e resultado
no banco. Pico inicia campanhas com `start_campaign`, acompanha com
`list_campaigns` e continua conversando com o pesquisador enquanto elas trabalham.
Também é possível iniciar uma campanha pelo botão **Nova campanha** na sidebar.
Configure o modelo de **Campaign Coordinator** em **Configurações → Agentes**.

Cada campanha mantém uma sessão Pi própria em `sessions/campaigns/<id>/`.
`campaign_progress` registra plano e avanços e escolhe continuar, aguardar
resultados, pedir uma decisão ou concluir com a entrega. O caminho científico
fica a cargo do coordenador: respostas negativas e inconclusivas são válidas.
Concluir exige uma entrega textual e reconciliação de agentes e jobs pendentes,
sem validação científica do conteúdo. Um turno que acaba sem trabalho pendente
nem próximo passo explícito aguarda orientação, evitando um ciclo vazio.

Várias campanhas e instâncias de um mesmo especialista podem trabalhar em paralelo.
`agent_runs.campaign_id` e `jobs.campaign_id` registram o proprietário; resultados
entram na sessão correspondente antes de serem considerados entregues. Pausas e
decisões pendentes continuam recebendo resultados, sem iniciar chamadas de modelo.
O Pico recebe avanços significativos, bloqueios e entregas, não cada chamada de
tool. Ele integra as campanhas e coordena o **Research Editor** compartilhado:
o coordenador de campanha inclui pedidos editoriais e referências em seus resumos.
A cobertura editorial existente continua sinalizando material ainda não revisado.
Quando a entrega depende dessa revisão, `campaign_progress` com
`action: "wait_for_pico"` aguarda o Pico sem ocupar um modelo nem pedir decisão
ao pesquisador. Após a revisão, Pico usa `message_campaign` para devolver páginas
e pendências. A mensagem é acrescentada ao contexto da campanha no banco e lida
no próximo turno, inclusive se chegar durante outro turno ou antes de um reinício.
Pico também usa essa tool para compartilhar achados e orientações; ela nunca
retoma uma campanha pausada ou com decisão pendente, nem aumenta seus limites.

**Configurações → Campanhas** define orçamento estimado por campanha (padrão
**US$ 5**), especialistas simultâneos por campanha (**3**) e por laboratório
(**6**, incluindo agentes iniciados diretamente pelo Pico). Orçamento e limite
por campanha são copiados na criação; mudar os padrões não modifica campanhas
existentes. O limite do laboratório é compartilhado e vale para novas admissões;
reduzi-lo não interrompe execuções já iniciadas. O perfil/modelo do coordenador
é escolhido na criação e conservado na retomada.

O uso soma coordenador e especialistas, incluindo requisições de compactação
do Pi. O custo é uma estimativa calculada pelo Pi com os preços do modelo; modelos
sem preços configurados não permitem impor um limite monetário confiável. Chamadas
já em andamento podem ultrapassar o orçamento. Jobs e serviços externos não entram
nessa estimativa. Antes de novas requisições e tools, o servidor verifica o estado
e o orçamento. Ao atingir o limite, a campanha fica com **decisão pendente**:
o pesquisador pode acrescentar orçamento e retomar a mesma sessão, deixá-la
pendente ou encerrar preservando o trabalho parcial. O coordenador não pode
aumentar o próprio limite.

Capacidade ocupada significa **aguardar**, sem pedir aprovação. Uma tentativa
sem capacidade não enfileira a tarefa: a campanha retoma quando há espaço e
seu coordenador escolhe o próximo passo. **Pausar** interrompe coordenador e
especialistas, preservando arquivos, registros e jobs. **Encerrar** é diferente
de concluir a entrega; havendo jobs em execução, o pesquisador escolhe mantê-los
ou pará-los. Resultados tardios de campanhas encerradas são entregues ao Pico.

O servidor precisa permanecer ligado para executar turnos dos coordenadores.
Após um reinício, campanhas ativas retomam sua sessão e recebem resultados
pendentes, incluindo avisos de especialistas interrompidos. O prompt orienta
reconciliar jobs existentes antes de iniciar substitutos: jobs desanexados
sobrevivem e não são reexecutados automaticamente. Campanhas pausadas ou com
decisão pendente não retomam sozinhas. Agentes efêmeros interrompidos são mantidos
no histórico; o coordenador decide se precisa de uma nova tentativa.

`campaigns` persiste estado, plano, resumos, resultado, limites, consumo, modelo,
sessão e entrega de notificações; `campaign_settings` guarda os padrões globais.
Registros salvos com `save_record` dentro da campanha recebem `fields.campaignId`;
o coordenador usa `author: campaign:<id>` e especialistas mantêm a autoria da
execução. Arquivos e registros continuam compartilhados no laboratório.

HTTP: `GET/PATCH /api/campaign-settings`, `GET/POST /api/labs/:id/campaigns`,
`GET /api/labs/:id/campaigns/:campaignId` (inclui conversa paginada, agentes e jobs)
e `POST /api/labs/:id/campaigns/:campaignId/control`. Controles: `{action:"pause"}`,
`{action:"resume", addBudgetUsd?, maxAgents?, message?}` e
`{action:"end", jobs?:"keep"|"stop"}`. `?active=1` exclui concluídas e encerradas.
`POST /api/labs/:id/campaigns/:campaignId/message` recebe `{message}` e usa a
mesma atualização de contexto da tool `message_campaign`.

### Instruções e skills no banco

Todas as instruções mantidas pelo Pico têm o SQLite como fonte de verdade:

| Dados | Persistência |
| --- | --- |
| Nome, descrição, papel, instruções, modelo e skill principal | `agent_definitions`, incluindo `instructions` e `skill_id` |
| Procedimentos e exemplos em Markdown | `agent_skills.instructions` e `agent_skills.examples` |
| Prompts de Pico, campanha, turno de campanha, delegação, worker, prática compartilhada e template inicial de contexto | `prompt_templates.content` |
| Direção e decisões por laboratório | `labs.context_markdown`, `context_revision`, `context_updated_at` |
| Versões do contexto, com autoria e data | `lab_context_revisions` |

Os especialistas usam `literature-review`, `research-experiment`,
`critical-review` e `research-editorial`; o coordenador de campanha usa
`campaign-coordination`. Definições, prompts, skills, exemplos e
o template inicial são escritos em inglês; respostas e páginas acompanham o idioma
do pesquisador. A migração traduz os nomes e descrições antigos que ainda são os
padrões de fábrica, preservando instruções personalizadas, modelos e o conteúdo
original dos laboratórios.

No spawn, o Pi recebe diretamente em memória as instruções e a skill principal
lidas do banco. `read_skill` lista as skills ou lê uma por ID; `examples: true`
carrega também seus exemplos. Não há cópias de `SKILL.md` em disco nem descoberta
automática de skills ou templates externos. A integração usa o carregador de
contexto, eventos e custom tools do Pi. Modelo, instruções e skills de uma execução
em andamento permanecem fixos; mudanças valem para novos spawns. O contexto do
laboratório é atualizado a cada turno. Prompts do coordenador são relidos a cada
turno, inclusive em sessões continuadas.

Configurações tem seções à esquerda (Laboratório, Agentes, Campanhas, Prompts e
skills), cada uma com um único rodapé que indica alterações não salvas e grava
tudo de uma vez. Agentes lista os perfis em tabela com modelo e raciocínio;
selecionar um perfil abre suas instruções. Nomes e descrições padrão do catálogo
aparecem no idioma da interface; um perfil renomeado mantém o nome gravado.
Configurações → Agentes permite editar instruções dos perfis, skills, exemplos e
prompts compartilhados; a aba do laboratório permite editar seu contexto. Os
valores em `prompt-defaults.ts` e `skill-defaults.ts` servem somente para popular
linhas ausentes. Reiniciar o servidor não sobrescreve edições. Templates aceitam
`{{lab_name}}`, `{{lab_path}}`, `{{agent_name}}`, `{{agent_instructions}}` e
`{{research_line}}` conforme seu propósito.

HTTP: `GET/PATCH /api/skills/:id`, `GET/PATCH /api/prompts/:id`, com listagens em
`/api/skills` e `/api/prompts`. `GET/PUT /api/labs/:id/context` acessa o contexto,
e `/context/history` consulta suas versões. `/pico` é um alias HTTP para esse
mesmo dado no banco. Editar o arquivo histórico `PICO.md` não atualiza o contexto.
A importação considera somente colunas ainda nulas: um contexto vazio salvo
intencionalmente também é preservado.

HTTP: `GET /api/agents`, `PATCH /api/agents/:id` para modelos e instruções;
`GET/POST /api/labs/:id/agent-runs`, `GET /api/labs/:id/agent-runs/:runId` e
`POST /api/labs/:id/agent-runs/:runId/stop`. A listagem com `?active=1` inclui
execuções em andamento e as que ainda aguardam entrega; a listagem completa
preserva o histórico.

## Interface

A sidebar identifica o laboratório e abre um seletor com busca e criação. A
legenda sob o nome é a linha de pesquisa do lab ou, na falta dela, a seção
“Research line” do contexto do laboratório; sem nenhuma das duas, não há legenda. A
sidebar pode ser recolhida no desktop (estado lembrado no navegador) e abre
como menu no celular. A identidade visual usa grafite, violeta discreto e
fontes locais DM Sans e Manrope; o tema segue o sistema até o pesquisador
escolher, e a escolha fica no navegador.

A paleta de comandos (⌘K ou Ctrl+K, e o ícone de busca na sidebar) navega
entre páginas, registros, execuções, páginas do laboratório e laboratórios,
com busca sem distinção de acentos. ⌘/ foca a conversa de qualquer página.
No desktop, o chip de modelo no topo abre o painel de conversa e foca o
seletor de modelo; na página de Conversa o seletor já está no compositor.

A conversa tem um controlador e uma assinatura de eventos para o laboratório
aberto. Navegar entre páginas mantém a resposta em andamento. Nas páginas de
materiais, “Conversar com Pico” abre a mesma conversa em um painel lateral,
redimensionável por arrasto ou setas (largura lembrada no navegador); em
telas estreitas ele ocupa o espaço da página até ser fechado. Fechar o painel
não interrompe Pico. “Discutir com o Pico” acrescenta a referência ao rascunho
sem enviar automaticamente; cada mensagem da conversa oferece “Copiar” e
“Discutir”, que cita o trecho no rascunho. Rascunhos ficam separados por
laboratório na aba, e um envio pendente não apaga edições posteriores nem
permite um segundo envio ao sair e voltar ao lab.

Enquanto Pico trabalha, uma linha de estado mostra a tool em execução, o tempo
do turno, o número de chamadas e a fila de mensagens; o raciocínio do modelo
aparece recolhido e renderizado como Markdown. O rodapé mostra tokens e custo
no formato do idioma. Ao rolar para cima, um botão volta à última mensagem e
avisa quando chegam mensagens novas.

O chat carrega inicialmente as 50 mensagens mais recentes. Ao subir perto do
início, busca mais 50 anteriores e preserva a posição de leitura; o botão
“Carregar mensagens anteriores” também permite buscar ou tentar novamente.
Atualizações ao vivo conservam as páginas já carregadas, sem duplicar mensagens.
O total de tokens e custo continua abrangendo o histórico da sessão, mesmo
quando apenas parte dele está na UI. A paginação afeta só a apresentação:
o contexto do Pi permanece intacto. `GET /api/labs/:id/chat` aceita `limit`
(padrão 50, máximo 100) e `before` (cursor retornado na página); `before: null`
indica que não há mensagens anteriores.

A desconexão do stream recupera o estado por HTTP, e a reconexão atualiza o
histórico. Trocar de laboratório troca a assinatura da UI; as sessões Pi
continuam pertencendo ao servidor.

Investigações organiza as perguntas pelos vínculos explícitos com hipóteses,
experimentos, resultados, conclusões e outros materiais. Fontes compartilhadas
e outras perguntas encerram o percurso, evitando juntar pesquisas distintas.
Materiais sem vínculo continuam acessíveis. Cada card resume até quatro
materiais e as três execuções mais relevantes, com link para o restante.
Execuções relacionadas conservam seus estados e links para métricas e logs;
terminar um job não responde uma pergunta automaticamente, e um job que
falhou mas cujo experimento tem resultado registrado é marcado como tal.

Ao lado da conversa, **Atividade** resume campanhas, especialistas e gasto e
mostra cada campanha como um cartão com faixa de estado, uma frase sobre o que
o coordenador faz agora, tempo decorrido e barra de orçamento. As instâncias
ainda trabalhando ou entregando resultados são linhas dentro do cartão, com o
rótulo de escopo, a tool atual traduzida e o tempo. O estado tem cor e forma
próprias: ocupado pulsa no acento, aguardando é azul, decisão pendente é âmbar,
pausada é vazada, erro é vermelho e concluída é verde. Depois da entrega, as
instâncias saem do cartão e permanecem no histórico da campanha. Campanhas
aguardando jobs, pausadas ou pendentes continuam visíveis mesmo sem agentes ativos.
Abrir uma campanha ou uma instância abre um painel lateral sobre a conversa.
O da campanha mostra, nesta ordem, o último avanço e o plano, a equipe com
custo por instância, jobs, orçamento, controles (pausar, mensagem ao
coordenador, encerrar, ou retomar com orçamento e orientação), o mandato
recolhido e a conversa do coordenador com turnos de sistema e resultados de
tools recolhidos. O da instância mostra a tarefa, um log cronometrado das
chamadas de tool com seus resultados sob demanda, o resultado e o consumo, com
o botão para interromper. Fechar devolve o foco ao item de origem. Concluídas
e encerradas ficam em **Histórico**. Agentes iniciados diretamente pelo Pico
aparecem em um grupo separado. Notificações do laboratório no chat (marcos de
campanha, retorno de agentes e término de jobs) aparecem como uma linha com
ação e o texto completo sob demanda. No celular, uma linha de resumo abre o
painel como uma folha sobre a conversa. Acervo é uma lista única de
registros, execuções e fontes, com facetas de tipo (incluindo execuções),
estado, frente e origem (Pico, pesquisador, campanhas, especialistas), busca
sobre o conjunto filtrado, grupos por dia e paginação de 100 em 100 sobre as
até 5.000 páginas mais recentes; os tipos escolhidos ficam na URL (`kind`), as
demais facetas ficam na tela. Arquivos é a segunda vista, em árvore. Fontes
aparecem como linhas com formato e tamanho; datasets com arquivos, tamanho e
licença. O detalhe de paper e dataset mostra os campos com rótulo (caminho,
origem, licença, hash do manifesto…), quem usa, o que produziu e a pasta. O
leitor de fontes abre dentro do Acervo. As URLs anteriores de Biblioteca,
Arquivos e Experimentos abrem o Acervo com a faceta correspondente. Status
conhecidos são traduzidos; status livres gravados pelo modelo aparecem como
foram escritos, em minúsculas. Um job que aponta para um experimento
inexistente mostra o id como referência não encontrada, sem link quebrado.

Evolução é a linha do tempo da pesquisa: as 500 mudanças mais recentes de
todos os tipos de registro, agrupadas por dia, duas linhas por mudança (o que
mudou; o motivo da revisão ou um trecho do texto), com o diff por palavras, as
versões completas e as referências sob demanda. Filtros por tipo e por
"Revisões" ficam na tela; execuções entram na linha do tempo só quando
pedidas. Motivo ausente fica identificado; links históricos abrem os materiais
no seu estado atual. O prompt orienta Pico a explicar mudanças em notas e em
`reason`, sem exigir novos tipos de registro.

Panorama mostra uma página editorial escrita por Pico: entendimento atual,
evidências, limites e próximos caminhos. Com uma página designada, ela fica
entre um sumário das seções (que acompanha a rolagem) e um trilho à direita
montado dos dados: frentes por estado, campanhas e perguntas abertas; o
próximo caminho (a frente mais recente ainda em andamento, com atalho para a
conversa); o que permanece aberto (perguntas e hipóteses não fechadas); e a
direção atual do contexto do laboratório, com atalho para editá-lo. O aviso
editorial ocupa uma linha ("3 registros mudaram desde a revisão de …") e abre
os detalhes ao clicar. Páginas do laboratório aparecem na sidebar e abrem por
URL. Uma página é lida como documento, não como ficha: título, uma linha de
assinatura (autor, revisão, data) com Histórico, Leitura alternativa e
Discutir como links, o aviso editorial numa linha entre filetes, coluna de
leitura de 680 px e figuras a 880 px alinhadas pela mesma margem. O primeiro
bloco de markdown é o lead; um bloco `records` vira "Evidência" (tipo, título
e data, registro superado riscado); um `artifact` vira figura numerada na
ordem, com legenda e o nome do arquivo como link; um blockquote que começa
com "Limite:" ou "Nota:" vira um aside. Os títulos de seção recebem ids
estáveis. A antiga Visão geral deixou de existir; sua URL abre o
Panorama. Um lab sem página de Panorama recebe um
Panorama montado automaticamente a partir dos dados: linha de pesquisa e
direção atual do contexto do laboratório, frentes abertas com suas evidências, últimas
conclusões, execuções e contagens do Acervo, com o convite para pedir a
página editorial ao Pico. Abrir a página apenas lê dados; planejar acrescenta
um pedido ao rascunho, sem enviá-lo.

Pico usa `save_page` para criar e atualizar páginas. A tool e
`POST /api/labs/:id/pages` chamam `Records.savePage`, que reutiliza a persistência
e as revisões dos registros. `save_record` com `kind: "page"` continua disponível.
`save_page` recebe `id?`, `title?`, `body?`, `placement?`, `blocks?`, `links?` e
`reason?`; campos omitidos são preservados e `placement: null` remove a designação
de Panorama. Salvar uma página não registra sua revisão editorial. `body` guarda uma leitura alternativa, e `fields.blocks` define
uma lista ordenada de três componentes:

```json
{
  "placement": "panorama",
  "blocks": [
    { "type": "markdown", "text": "## O que aprendemos\nEntendimento, evidências e limites." },
    { "type": "records", "ids": ["q-id-existente"] },
    { "type": "artifact", "path": "experiments/exemplo/runs/1/metrics.json", "caption": "Medições observadas" }
  ]
}
```

O exemplo representa `fields`; IDs e arquivos precisam corresponder aos
materiais do laboratório. Texto reutiliza Markdown, referências usam cards
compactos em linha sem expandir páginas recursivamente e arquivos usam os
previews existentes, com origem e ações recolhidas. O leitor evita repetir o
título idêntico no primeiro bloco e destaca a situação da revisão editorial.
O editor escreve a explicação principal nos blocos Markdown, intercalando
evidências e figuras comentadas; o `body` continua como leitura alternativa.
Blocos desconhecidos ou incompletos são preservados e recebem avisos na UI;
referências não carregadas continuam abrindo diretamente por ID. Arquivos
indisponíveis oferecem erro, nova tentativa e acesso aos arquivos; o `body`
continua disponível como leitura alternativa. Não há consultas livres,
plugins ou execução de código nos blocos.

`fields.placement: "panorama"` designa a página editorial. Entre várias
candidatas, a mais recentemente atualizada é escolhida, com ID crescente
para desempate, independentemente do status. As demais continuam acessíveis
como páginas. Sem esse metadado, a página é um documento comum. A sidebar e
o Panorama compartilham uma consulta das até 5.000 páginas mais recentes do
lab, sem consulta individual por item.

Atualizar o mesmo ID conserva as revisões; `fields.blocks` substitui a lista
inteira, seguindo o merge superficial de campos já existente. Versões
anteriores mostram título, status e conteúdo salvo ao expandir; arquivos e
registros vinculados abrem seu estado atual, com aviso explícito. Revisões
fechadas não carregam arquivos. O Panorama comunica a pesquisa, enquanto
o contexto do laboratório mantém direção e convenções. A cobertura editorial usa os metadados
descritos abaixo.

### Revisão editorial

`review_pages` consulta a cobertura: mudanças de registros, arquivos alterados,
referências ausentes, blocos inválidos, questões declaradas pelo editor e
avisos de forma (`shape`): lead ausente ou longo, título em caixa alta, mais
de dois negritos num parágrafo, ids no texto corrido, mais de três registros
num bloco, dois blocos de registros seguidos, figura sem legenda ou legenda
que começa com "Figura n". Os avisos não mudam o estado da revisão; o skill
`research-editorial` descreve a forma de uma página (lead, seções de uma
pergunta, afirmação → evidência → figura, legenda em duas frases, limites em
blockquote, fecho "O que permanece aberto") com um exemplo completo e um
contraexemplo, e o editor é instruído a corrigir os avisos antes de encerrar.
Skills e perfis semeados não sobrescrevem o que já está no banco: um lab
existente recebe o texto novo pela tela de Configurações. Pico
usa a tool para consulta; o editor pode passar `pages: [{id, revision, summary,
pending?}]` para registrar a revisão da versão que efetivamente leu ou salvou.
Uma versão divergente pede releitura, sem impedir gravações de conteúdo. A
revisão não altera o texto nem incrementa a revisão científica da página.

`agent_runs.editorial_context` conserva IDs e versões dos registros presentes
no início da execução, versões de páginas observadas e identificadores dos
arquivos referenciados. `page_reviews` guarda a última revisão editorial de
cada página, a execução responsável, a versão considerada, resumo e pendências.
São metadados de cobertura; os conteúdos continuam em registros e arquivos.

A comparação considera todos os registros científicos do lab, inclusive novos
materiais ainda sem links. Mudanças indicam necessidade de leitura, não que uma
conclusão esteja errada. O editor decide a relevância e pode revisar sem editar.
Alterações que chegam durante a execução continuam pendentes para outra rodada.
Uma atualização de página não invalida todas as outras: páginas explicitamente
referenciadas são acompanhadas pela versão observada. As gravações de páginas
não entram no conjunto global de mudanças científicas, evitando um ciclo de
atualizações provocado pela própria edição.

Mudanças de direção são acompanhadas pela revisão do contexto no banco;
revisões editoriais anteriores à migração pedem uma nova leitura. Mudanças de
contexto durante uma execução também ficam pendentes para outra rodada.
Arquivos dos blocos `artifact` são acompanhados por identidade, tamanho e datas
de modificação; arquivos novos entram quando o editor lê ou
salva a página que os referencia. Arquivos externos não vinculados e destinos
de URLs livres não são monitorados. As verificações são técnicas, sem validar
afirmações científicas ou impedir a gravação de páginas incompletas.

Cada página conserva seu checkpoint independentemente do estado final do
agente. Uma falha depois de revisar um tema deixa o restante pendente; reiniciar
o servidor preserva esse progresso. O próximo turno de trabalho recebe um
resumo atualizado da cobertura pelo Pi, e Pico pode retomar a partir dele.
A UI mostra revisão registrada, novidades ou pendências e edição em andamento,
com referências aos materiais e um botão que prepara o pedido de revisão no chat.
Concluir a execução ou entregar sua mensagem ao Pico não marca páginas como
revisadas. HTTP e tools usam o mesmo serviço: `GET /api/labs/:id/editorial` e
`POST /api/labs/:id/editorial` com `{runId, pages}` de uma execução editorial ativa.

```text
~/pico-labs/<lab>/            workspace do modelo
  experiments/<nome>/         código, README.md e runs/<n>/
  data/                       datasets
  papers/                     fontes salvas: pdf/html e .md com o texto
  .pico/                      logs de jobs e manifestos, fora do git

~/.local/share/pico/          estado do Pico (PICO_DATA_DIR)
  pico.sqlite                 labs e contexto, prompts, skills, registros, revisões, jobs e agentes
  pi/                         perfil Pi do Pico: login, modelos, busca
  sessions/                   sessões Pi do coordenador por laboratório
  sessions/agents/<run-id>/    uma sessão Pi nova por spawn
  sessions/campaigns/<id>/     sessão persistente por campanha
```

## Executar

Requisitos: Bun 1.4+. Git é usado para o histórico do workspace.

```sh
bun install
bun run pi        # no Pi: /login, escolha o provedor, depois /exit
bun run dev       # UI em http://127.0.0.1:5174
```

Crie um laboratório na UI, escolha o modelo e converse. Para produção:

```sh
bun run build
bun start         # UI e API em http://127.0.0.1:4317
```

Se `PICO_DATA_DIR` ainda tiver o `pico.sqlite` da versão anterior do Pico, o
servidor recusa abrir e explica o que fazer: mover ou apagar `pico.sqlite*`
e a pasta `labs/` antiga. O perfil Pi em `pi/` continua válido.

Variáveis: `PICO_DATA_DIR`, `PICO_LABS_DIR` (padrão `~/pico-labs`),
`PICO_PI_AGENT_DIR`, `PICO_PORT`, `PICO_HOST`. Busca web usa Exa por padrão;
outros provedores em `<PICO_DATA_DIR>/pi/web-search.json` com a chave no
ambiente do servidor.

## Verificar

```sh
bun run check     # typecheck, lint, testes e build
```

Os testes usam um modelo falso OpenAI-compatível e processos reais; nenhum
teste chama um provedor externo.

Em ambientes que impedem escutar em portas locais, use
`PICO_TEST_IN_PROCESS_MODEL=1 bun run check`. O mesmo endpoint falso e seus
eventos SSE são atendidos em memória; sessões Pi, SQLite, arquivos e processos
continuam reais. Isso verifica o fluxo e a persistência, não a qualidade editorial
de um modelo real.

## Estrutura

```text
server/src/
  agent-resources.ts  prompts, skills e exemplos no banco
  prompt-defaults.ts  valores iniciais dos prompts
  skill-defaults.ts   procedimentos e exemplos iniciais em inglês
  main.ts        boot: API, UI estática, sinais
  app.ts         composição
  contracts.ts   tipos compartilhados com a web
  sessions.ts    sessão Pi por laboratório e eventos
  tools.ts       tools do Pico
  agent-catalog.ts perfis globais e configuração de modelos
  subagents.ts   spawns efêmeros, resultados e entrega ao coordenador
  campaigns.ts   campanhas, retomada, limites e encaminhamento de resultados
  editorial.ts   cobertura das revisões e pendências das páginas
  jobs.ts        jobs em segundo plano e notificações
  records.ts     registros com revisões
  labs.ts        laboratórios e workspace
  papers.ts      save_paper
  datasets.ts    register_dataset
  git.ts         commits automáticos
  http.ts        rotas
web/             React: Conversa, Panorama, Frentes, Evolução e Acervo
```
