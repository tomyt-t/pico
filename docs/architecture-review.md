# Revisão adversarial da arquitetura de código

Estado: refatoração integral implementada, com duas rodadas sobre o desenho e
duas sobre a implementação, em 28 de setembro de 2026. A organização atual
está em [code-architecture.md](code-architecture.md).

O pesquisador pediu uma refatoração integral, organização simples para pessoas
e agentes e revisão com subagentes. Três revisores participaram das duas rodadas:

| Revisor | Responsabilidade contestada |
| --- | --- |
| `research_architecture` | Pesquisa, atomicidade, formatos persistidos, backup e replay |
| `runtime_architecture` | Runner independente, processos, identidade, lifecycle e recuperação |
| `web_agent_ergonomics` | Contratos, exports, navegador, aliases e ferramentas do monorepo |

Cada revisor recebeu o desenho e a instrução de procurar um cenário concreto
que o invalidasse. A segunda rodada recebeu as correções da primeira e atacou
suas lacunas. Consenso dos revisores não substitui testes da implementação.

## Decisão sobre pacotes

```text
apps/
  server/                 HTTP, assets e sinais do processo
  web/                    UI React e cliente HTTP
packages/
  lab/                    Pesquisa, conversa, persistência, modelos e fontes
    src/contracts/        Tipos/schemas públicos por assunto
    src/contracts.ts      Export @pico/lab/contracts, seguro no navegador
  runner/                 Execução, snapshots, supervisão e observações
```

O fluxo é `web → HTTP → server → lab → runner`. A web importa somente o
subpath de contratos do lab. Runner não importa lab, nem seus tipos.

Contratos são necessários para manter comandos, schemas e projeções comuns;
um workspace exclusivo não é necessário agora. O subpath isola o grafo do
navegador, mas o manifest da web ainda depende do pacote lab e de sua instalação.
Distribuir a web sem instalar dependências do motor seria uma razão concreta
para reconsiderar um pacote de contratos.

Models, sources, storage e Pico permanecem módulos internos do lab. Não há
outro consumidor independente que justifique mais manifests neste momento.

## Desenho — rodada 1: objeções iniciais

| Objeção | Cenário de falha | Correção incorporada |
| --- | --- | --- |
| Runner atual depende de conceitos científicos | Mover `runner/types.ts` e `runner/index.ts` cria `lab → runner → lab` | Adaptação em `research/execution`; contrato operacional e formato histórico locais ao runner |
| Engine também publica datasets e edita workspace | Dois pacotes tornam-se escritores da mesma pesquisa | Dataset/workspace ficam no lab; runner apenas copia inputs autorizados para snapshots |
| API nova altera identidade de registros históricos | Trocar campos ou ordem do request invalida hash baseado em `JSON.stringify` | API operacional separada do formato v1; reader e fixtures anteriores à refatoração |
| Backup olha apenas SQLite | Supervisor segue vivo ou submissão ainda não foi projetada enquanto arquivos são copiados | Uma barreira administrativa, inventário operacional e manifesto total de SQLite + arquivos |
| Claims de run não limitam dois controladores | Dois schedulers escolhem runs diferentes e excedem concorrência global | Lock exclusivo por raiz operacional, além do lock do lab e dos claims por run |
| PID não prova identidade | Supervisor morre, filho continua; PID pode ser reutilizado | Identidade verificável, confirmação de término e capacidade bloqueada se estado for ambíguo |
| Callback pode falhar depois da publicação | Rename termina, SQLite falha, caller trata como submissão inexistente | Recuperar pelo ID reservado e reentregar projeção sem nova execução |
| Contratos podem vazar implementação | `import type` alcança runtime/Bun, embora JS seja removido pelo bundler | Checagem transitiva de tipos/reexports e consumidor com ambiente de navegador |
| Mesmo alias local diverge entre ferramentas | Pacote exporta TS que usa `@/identity`; Vite/TypeScript escolhem o arquivo homônimo do app | Prefixos únicos em mapa comum, preservando a convenção `@/` do projeto |
| Worker depende da configuração do consumidor | Mudar cwd ou workspace faz imports internos falharem | Entrypoint absoluto do pacote, tsconfig coerente e teste fora do repositório |
| Runner conhece perfil Pi | Execução independente ainda depende de configuração do produto | Lab resolve bindings; runner aplica ambiente permitido; paths e credenciais fora do plano preservado |
| Envelope nativo novo ignora registros antigos | Replay perde assinaturas ou repete tools ao reconstruir mensagens públicas | Leitura compatível do payload nativo antigo ou migração explícita |

## Desenho — rodada 2: ataques às correções

### Publicação antes da projeção

Conectar callbacks antes de iniciar o runner não é suficiente. Se o startup
também despacha jobs, ele pode executar um diretório publicado antes de o lab
recuperar o recibo e o vínculo científico.

Decisão: startup inspeciona o runner com despacho bloqueado. O lab reconcilia
efeitos/projeções; depois libera a fila. Vínculo irrecuperável bloqueia despacho
e backup, sem inventar registros. O teste de crash deve falhar exatamente após
rename e antes da projeção no SQLite.

### Capacidade capturada antes da barreira

Guardar `runtime.research.startRun` antes de começar backup/close e chamá-la
depois pode contornar uma verificação feita apenas ao acessar a propriedade.

Decisão: admissão é verificada a cada chamada. Trabalho aceito é acompanhado
até concluir seus efeitos e projeções. Drenagem permite finalizar operações já
aceitas. Nenhum método público ignora o estado do runtime.

### Morte do supervisor com server desligado

Um loop de recuperação no server não consegue impor prazo enquanto o server
está desligado. Apenas persistir o PID do filho também não resolve isso.

Decisão do desenho, implementada e testada nesta entrega: watchdog mínimo por tentativa, no pacote runner. Ele lidera
o grupo experimental, tem prazo próprio e monitora um pipe exclusivo do
supervisor. `READY → GO` antecede o início experimental. EOF, cancelamento ou
prazo provocam término do próprio grupo; estado terminal só é publicado após
confirmação de término. Não exige outro pacote ou daemon compartilhado.

A validação com processos reais está registrada abaixo. Não cobre morte isolada
do próprio watchdog nem código que escape do grupo. A recuperação conserva estado
indeterminado quando não consegue provar identidade/término. Uma garantia de
contenção mais ampla precisaria de supervisão específica por plataforma.

### Aliases únicos também podem contornar exports

`@/lab/*`, `@/runner/*`, `@/server/*` e `@/web/*` funcionaram nas sondas, mas o
mapa global permite resolver tecnicamente arquivos de outro workspace.

Decisão: o checker rejeita prefixos de outro workspace, inclusive em imports
de tipos. Entre workspaces usa-se exclusivamente `@pico/...`. Também compara
os mapas TypeScript/Vite e rejeita um alias genérico que capture os prefixos.

### Restore não restaura um controlador antigo

Locks e claims operacionais não podem voltar como prova de propriedade de um
processo. Restore preserva pesquisa e proveniência, abre novos locks e ignora
identidades antigas para fins de controle. A compatibilidade com backups
anteriores precisa distinguir histórico de autoridade operacional.

Os três revisores consideraram a separação viável sob essas condições. A
supervisão recebeu ressalva explícita: a garantia limitada precisa ser
demonstrada por testes reais antes de ser apresentada como implementada.

## Evidência das sondas do desenho

O revisor de ferramentas montou sondas em diretórios temporários usando as
ferramentas locais e arquivos `identity.ts` homônimos. Não alterou o código do
repositório nem fez chamadas a modelos externos.

| Sonda | Resultado observado |
| --- | --- |
| Exports TS + `@/` diferente por workspace | Lab isolado passa, mas typecheck do app escolhe arquivo errado; Vite compila silenciosamente a identidade do app |
| `#lab/*` por `package.json#imports` | Funcionou como alternativa; não foi escolhido para preservar a convenção `@/` solicitada |
| Quatro prefixos `@/` únicos, herdados da base | Typecheck dos quatro workspaces passou |
| Bun da raiz, do app e de cwd externo | Resolveu o pacote correto |
| Worker absoluto via spawn e fork/IPC, com cwd externo | Imports e execução funcionaram |
| Vite com os quatro prefixos explícitos | Incorporou as identidades corretas de lab e web |

As sondas validaram resolução em um monorepo mínimo antes da implementação.
A validação integrada abaixo exercitou depois o código real. Um futuro bundle
do backend ou executável único exigirá outra validação dos workers.

## Implementação — rodada 1: integração e recuperação

Os três subagentes implementaram áreas distintas e fizeram revisão cruzada.
Os caminhos antigos foram removidos após migração dos consumidores e testes.

| Contraexemplo encontrado | Correção e evidência |
| --- | --- |
| Dataset publicado por rename, sem projeção SQLite | Recuperar ID, bytes, metadados e autoria do efeito reservado; teste de falha nessa janela e retomada sem duplicação |
| Recibos mudaram nome/argumentos ao separar serviços | Conservar nomes e fingerprints históricos; restore da fixture anterior retoma tool sem repetir mutação |
| Run legado interrupted ainda tinha claim | Tratar autoridade como desconhecida; bloquear despacho, backup e export em vez de admitir término apenas pelo status |
| Método HTTP lançava erro síncrono durante backup | Serializar recusa da barreira como 503, com teste de requisição durante manutenção |
| Callback escapava do scope já concluído | Expirar permissão ao terminar a operação e selar recursos no encerramento; teste de callback tardio |
| Runtime aguardava HTTP enquanto inferência ainda rodava | Abortar modelos/fontes antes de aguardar toda drenagem; cenários de SDK inicializando e requisição ativa |
| Exemplo multimodal importava SDK pela raiz | Carregar SDK local só em inferência real; harness simulado injeta runtime/versão; execução preserva manifest e lock próprios |

Também foram demonstrados projeção de run recuperável, reprodução com snapshot
v1, exclusão de dois controladores, watchdog com processos reais e compatibilidade
de replay nativo. A fixture histórica inclui SQLite, archive, datasets, revisões,
assinaturas e recibos produzidos pelo código antigo.

## Implementação — rodada 2: ataques ao código corrigido

| Contraexemplo encontrado | Decisão/correção |
| --- | --- |
| Backup em uma operação admitida e close em outra esperavam um ao outro | close dentro de withOperation rejeita CONFLICT antes de mudar estado; teste confirma backup concluído e fechamento externo normal |
| Import inválido ocupava ID com run-record sem publicação operacional | Validar hashes/bytes antes de reservar metadados; retry do mesmo archive completa publicação interrompida, e imports concorrentes do mesmo ID são rejeitados |
| Domínio recebia o agregado completo de storage por tipo | Capacidades restritas em research/persistence.ts; checker impede acessar a entrada privada de composição |
| Vite config podia levar tipos Node ao programa da UI | Compilação adicional da UI com ambiente estritamente browser; grafo transitivo também barra tipos/imports nativos |
| Verificar apenas imports JS não capturava tipos e reexports | Resolver real do TypeScript e fixtures negativas para import type, reexport, import() literal, subpaths privados e ciclos |

O encerramento externo permanece idempotente. A barreira não deixa métodos
capturados ou callbacks de scopes encerrados usarem SQLite depois do fechamento.
A regra de lifecycle foi simplificada para evitar autoespera, em vez de esconder
operações pendentes da drenagem.

## Evidência integrada e limites

`bun run check` reúne todos os workspaces, consumidor browser, Biome, testes e
build. Os testes separam modelo simulado de execução real Python/uv. A extensão
Pi lê fontes de servidores locais; nenhuma inferência externa foi feita nesta
refatoração. Instalação pelo lockfile, resolução de workers fora do repositório
e watch do backend foram exercitados.

Chrome real validou criação de lab, demonstração com mean=2.5, quatro páginas,
detalhes, rascunhos após navegação/recarga e ausência de overflow em desktop e
mobile. Uma resposta de POST/chat foi descartada após commit; Retry manteve a
mesma chave e apenas um turno. Screenshots locais: `/tmp/pico-refactor-desktop.png`
e `/tmp/pico-refactor-mobile.png` (fora do versionamento).

Limites: execução real validada neste macOS, sem afirmar validação Linux nesta
sessão; watchdog morto isoladamente ou código escapando do grupo não têm garantia
de contenção. Estado ambíguo bloqueia operações. Shutdown gracioso aguarda corpos
HTTP aceitos até EOF; não foi introduzido um prazo global para essa drenagem.
O subpath de contratos isola código/tipos, não a instalação das dependências do
lab. Ver [validation.md](validation.md) para resultados finais.

## Estabilização de contexto e conversa — 29/09/2026

O pesquisador autorizou corrigir os achados dos relatórios e pediu subagentes
com rodadas adversariais. A divisão foi integridade científica, execução,
contexto durável e coordenação/UI/API. Esta seção registra os contraexemplos da
conversa; o relatório integrado da estabilização reúne as demais frentes e seus
limites de validação.

### Desenho — duas rodadas

| Ataque ao desenho | Decisão |
| --- | --- |
| Uma tool devolve binário ou milhares de eventos, e continuar repete o overflow | Teto serializado de resposta, páginas com continuação e clipping também no replay legado; resposta nativa gigante sai inteira da projeção, mantendo os bytes preservados |
| Atualizar resumo avança até um pedido recém-enfileirado que o modelo nunca viu | Cursor e resumo na mesma transação, limitados a prefixo anterior ao turno autor, às mensagens queued não vistas e aos grupos pending |
| Cortar só um resultado de tool quebra a assinatura ou deixa respostas órfãs | Seleção por grupos completos; só resultados projetados são abreviados, nunca o assistant assinado |
| Dez runs geram dez análises e empurram o pesquisador para fora da janela | Análise automática do lote após queued/running terminarem, fila com prioridade researcher e retenção explícita de seus pedidos recentes |
| Um custo ausente é tratado como zero e o orçamento nunca pausa | Flags de preço/tokens conhecidos; ao configurar uma unidade não informada, parar antes da próxima inferência |

### Implementação — rodada 1

| Contraexemplo encontrado | Correção e regressão |
| --- | --- |
| Reentregar o segundo evento de um grupo não encontra o turno pelo ID líder e cria outra análise | Buscar `eventId` e todos os `eventIds`, independentemente do estado; teste reentrega evento secundário após restart e mantém uma análise/mensagem |
| Um lote maior que o índice recente perde os primeiros run IDs | Guardar `eventRuns` completo e oferecer `read_turn` paginável; teste percorre 40 condições |
| Página 2 de um registro revisado concatena bytes de versões diferentes | SHA-256 obrigatório nas continuações; testes alteram registro/arquivo entre páginas e verificam rejeição |
| Acknowledgment abreviado de uma mutação perde o ID e induz repetição | Envelope conserva `operationCompleted` e `{kind,id}`; retry do mesmo recibo retorna o mesmo resultado com uma entidade |
| Mudança de role dos eventos para user faz a UI atribuir o texto ao pesquisador | `Message.eventId` identifica a origem do laboratório; autoridade de instrução continua ausente no modelo |
| Enviar mensagem e digitar durante POST apaga o novo rascunho ao receber resposta | Revisão cruzada identificou necessidade de comparar o rascunho atual ao texto enviado antes de limpá-lo |
| Janela móvel de 200 mensagens abre uma lacuna após carregar histórico | Revisão cruzada identificou a necessidade de acumular a timeline carregada e atualizar mensagens por ID |

### Implementação — rodada 2

Um pending tool pode ter uma mensagem assistant antes de si. Parar o checkpoint
na linha anterior à tool ainda cobria parte de seu batch. A correção recua até
a primeira mensagem do mesmo `modelStepId`; a regressão cria histórico posterior
grande e verifica que o cursor permanece anterior ao assistant pending.

Outro ataque usa um turno queued legado, criado antes de existir `eventRuns`,
e acrescenta uma condição nova. O agrupamento reconstrói a referência do evento
original antes de acrescentar outras, mantendo a leitura paginada completa.
As páginas reservam margem para JSON escapado e metadados; testes remontam
UTF-8 com acentos, emoji e caracteres de controle sem perda de bytes.

O último ataque força overflow mesmo no menor contexto permitido. Reduzir até
um piso e deixar cada clique Continuar repetir a mesma chamada ainda manteria
o problema original. O turno agora grava a identidade do provedor/modelo que
rejeitou o contexto mínimo e não reenvia enquanto essa configuração permanecer.
Uma troca de provedor/modelo permite retomar; o teste verifica zero chamadas
adicionais no caso bloqueado e conclusão depois da troca.

A revisão final da UI também simulou uma aba oculta durante mais de 200 mensagens.
Juntar a janela nova à timeline antiga deixava um intervalo inacessível. O chat
agora lê páginas até reencontrar a janela anterior antes de juntá-las; mantém
um aviso e retry se houver falha. Os testes cobrem 900 mensagens com timestamps
iguais, preservam a ordem do servidor e verificam que nenhuma timeline com buraco
é publicada em erro de rede. O indicador de atividade compara o último ID,
continuando a funcionar quando o tamanho da janela permanece em 200.

Os testes de contexto usam Pi simulado e HTTP local. O ciclo de demonstração usa
Python real; os testes de fixture verificam restore, replay e reprodução de uma
pesquisa anterior sem modificar seus arquivos. Validação externa e de plataformas
pertencem ao relatório integrado e não são inferidas desses cenários.
