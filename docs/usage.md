# Usar o laboratório

## Primeira investigação

1. Crie um laboratório com nome e linha de pesquisa. Perguntas específicas podem
   surgir depois; uma hipótese não é obrigatória para começar a explorar.
2. Em Conversa, converse com Pico sobre a pergunta e o primeiro teste. O modelo usa
   tools para manter os registros; não há campanha nem equipe para configurar.
3. Acompanhe perguntas, hipóteses e conclusões na Visão geral. Os links levam aos
   mesmos experimentos e evidências usados na conversa.
4. Em Experimentos, consulte protocolo, tentativas, métricas, logs, código e dados.
   Um run continua independentemente do turno do modelo.
5. O término volta à mesma conversa. Se várias condições estão enfileiradas ou
   executando, a análise automática aguarda o lote terminar para compará-las juntas.
   As observações parciais já ficam disponíveis, e você pode pedir sua análise.
   Pico registra resultado, interpretação e limitações. A próxima investigação
   pode revisar a hipótese, mudar o protocolo ou abrir outra pergunta.

O modo Demonstração possui um narrador determinístico. Ele usa as tools reais e
executa a média de quatro números com Python. Essa demonstração verifica a
infraestrutura; não avalia defesas de LLMs e não substitui um modelo científico.

## Provedor de Pico

O modo **Pi** usa o SDK incluído no projeto e um perfil exclusivo do Pico em
`PICO_DATA_DIR/pi`. Faça login com `bun run pi`, depois `/login`, e escolha provedor, modelo e reasoning nas
configurações do laboratório. Novos laboratórios preferem o padrão autenticado
desse perfil; abrir um laboratório existente não muda sua seleção. A UI mostra se o
modelo aceita imagens. Credenciais ficam no diretório próprio, fora dos registros
científicos e backups do laboratório.

O estado de conexão confirma a existência de configuração de autenticação.
Validade da credencial, disponibilidade do serviço e eventual renovação OAuth
são verificadas na próxima inferência. Essa consulta não gera texto nem executa
comandos de obtenção de chave configurados no Pi.

A integração usa `ModelRuntime` do SDK público Pi 0.86.1. Pico mantém sua sessão
durável e suas tools de domínio. A extensão fixada `pi-web-access` fornece busca
e leitura em processos por lab; extensões e skills do Pi pessoal não são carregadas.
Respostas nativas ficam preservadas para retomar tools e reasoning corretamente;
a interface recebe apenas mensagens e resultados projetados. Cada chamada usa
timeout de 120 segundos e zero retries automáticos do provedor.

Consulte [busca e isolamento](search.md) para configurar Google, usar a busca
padrão sem chave própria e compartilhar o código com outras pessoas.

O modo **Avançado · API compatível com OpenAI** usa Chat Completions com function
calling. Configure base URL, modelo e nome da variável de ambiente da chave.
Seu botão de conexão consulta `/models`; a resposta não garante disponibilidade
para geração. Endpoints locais HTTP são permitidos; remotos exigem HTTPS.

Cada bloco de trabalho tem limite de passos e pode ter limites de tokens e custo
informados pelo provedor. A conversa mostra o consumo acumulado; valores sem
metadados do provedor ficam sinalizados como desconhecidos. Se você configurou
um limite cujo consumo não foi informado, Pico pausa antes de outra chamada.
Deixe o campo vazio para remover o limite correspondente.

Os limites de tokens/custo são verificados após cada resposta, antes da próxima
chamada: a última resposta pode ultrapassar a franquia. Não são um teto financeiro
rígido nem incluem automaticamente as chamadas feitas pelo código do experimento.
O orçamento de um alvo externo também deve ser definido no protocolo/programa.

Ao esgotar um limite, o turno pausa e oferece **Continuar investigação**, mantendo
as chamadas já concluídas. Continuar concede outro bloco de trabalho e preserva
o consumo total. **Parar o turno do Pico** interrompe o turno; runs submetidos
continuam e têm seu próprio botão **Cancelar execução**. Turnos falhos, parados
ou interrompidos também podem ser retomados. Após falha de servidor, um turno
em execução fica **Interrompido**.

Você pode enviar outro pedido enquanto Pico trabalha: ele entra na mesma fila,
com prioridade sobre análises automáticas ainda não iniciadas. **Carregar mensagens
anteriores** permite percorrer o histórico preservado. O resumo do notebook e os
checkpoints automáticos ajudam a manter contexto; checkpoints são trechos com
referências, não uma nova conclusão. Pico pode consultar as mensagens originais.

Leituras extensas são paginadas. Quando uma tool retorna `nextOffset`, Pico deve
repetir a leitura com esse offset e o mesmo `fingerprint`; se a fonte mudou,
reinicia a leitura para não misturar versões. Arquivos binários fornecem metadados
ao modelo e continuam disponíveis na página do experimento. Uma janela de modelo
excedida provoca compactação e uma tentativa menor, sem executar novamente as
tools já confirmadas. Se nem o contexto mínimo couber, escolha outro modelo antes
de continuar.

## Programas de experimento

O primeiro executor é local e executa código confiado com as permissões do
processo. O isolamento de paths protege os arquivos gerenciados pelas tools;
não constitui um sandbox do sistema operacional para código Python.

Cada execução recebe:

| Variável | Conteúdo |
| --- | --- |
| `PICO_INPUTS_DIR` | Diretórios dos datasets, identificados pelo ID da versão. |
| `PICO_CONFIG_PATH` | Arquivo JSON com a configuração preservada. |
| `PICO_OUTPUT_DIR` | Diretório para métricas, respostas por exemplo e outros artefatos. |
| `PICO_RUN_DIR` | Diretório da tentativa. |

Escreva `metrics.json` em `PICO_OUTPUT_DIR` como uma lista:

```json
[{"name":"accuracy","value":0.8,"unit":"fraction","split":"test","step":0}]
```

Os campos unit, split e step são opcionais. Valores precisam ser finitos. A
comparação distingue essas dimensões e informa quando condições diferem.
Arquivos JSON/CSV adicionais podem preservar respostas por exemplo. Imagens e
outros arquivos saem como artefatos consultáveis/exportáveis.

Pico pode revisar observações, interpretação e limitações de um resultado pela
tool `revise_result`, registrando motivo e histórico. Essa correção mantém o
experimento e as execuções de evidência fixos; analisar outro conjunto de runs
gera outro resultado. Conclusões também mantêm suas revisões e fontes.

Python básico usa a biblioteca padrão. Para dependências, escreva pyproject.toml,
resolva uv.lock pela tool lock_dependencies e use runtime uv. A execução usa o
lock preservado. Há limites operacionais para duração, concorrência, logs e
arquivos. Em Linux, Recursos da próxima execução permite limitar espaço de
endereçamento por processo (`memoryMiB`, RLIMIT_AS) e selecionar dispositivos
CUDA (`gpuDevices`, incluindo `[]` para desativar CUDA). Não são quotas de RAM
somada da árvore, tempo de GPU, CPU ou disco. Em plataformas sem suporte os
campos ficam desativados e a API recusa pedidos que não conseguiria cumprir.
Cancelamento e timeout enviam SIGTERM antes de SIGKILL com prazo curto.

Depois do término confirmado, **Limpar ambiente descartável** remove `work/`
e a `.venv`, mantendo snapshot, observações e logs. As cópias verificadas usam
copy-on-write quando o filesystem suporta; nunca hardlinks graváveis para dados
preservados.

Datasets locais maiores podem ser registrados com o servidor parado:

```sh
bun scripts/import-dataset.ts <lab-id> /caminho/absoluto/dataset nome v1 "origem dos dados" "licença"
```

O comando usa importação e hashes em streaming, preserva proveniência e aceita
até 1 GiB por arquivo, 16 GiB por versão e 2.000 arquivos. Esses limites são
independentes dos limites menores de código, outputs e upload JSON. Arquivos
devem ser regulares, sem symlinks. Não dispara runs nem inferência pendentes.

## Reprodução e histórico

O exemplo em `examples/multimodal-defense` contém um piloto controlado de quatro
imagens, com o alvo `zai/glm-5.3-flash` via Pi. Após criar um laboratório e pedir
ao Pico que registre a pergunta, importe os materiais:

```sh
bun scripts/prepare-multimodal-pilot.ts <lab-id> <question-id>
```

O comando registra dataset, protocolo e código pelas mesmas operações da UI,
sem inferência ou execução. Sua saída inclui o ID do experimento e os pedidos
de execução para baseline e defesa. Na conversa, peça ao Pico que leia esse
experimento, use os arquivos `config.baseline.json` e `config.defense.json` e
inicie uma tentativa para cada condição, com limite de 360 segundos. O lab
precisa permitir execução local e esse limite de duração.

Antes de executar este piloto, o pesquisador deve marcar **Permitir uso do perfil
Pi neste experimento**. Só então o runner fornece `PICO_PI_AGENT_DIR` e
`PI_CODING_AGENT_DIR` apontando para o perfil próprio do Pico; por padrão não
fornece essas referências. A autorização atual é consultada no despacho,
inclusive em reproduções; revogá-la também vale para jobs ainda na fila. Pico
não pode conceder esse acesso a si mesmo. Snapshots antigos continuam intactos.
Isso controla o acesso intencional ao modelo; código executado como seu usuário
ainda tem acesso aos arquivos desse usuário. Não é isolamento contra código hostil.
Para outro alvo, prepare uma nova versão explícita do experimento. Cada condição faz no
máximo quatro inferências, com retries desativados. Reprodução fará outras quatro.

Consulte o protocolo preservado: dois exemplos por split verificam o fluxo, mas
não permitem alegar eficácia geral da defesa.

Reproduce cria outro run a partir do snapshot de referência, preservando código,
argumentos, configuração e bytes de inputs. Não executa o workspace atual. O
limite de tempo atual do laboratório continua sendo respeitado; aumente-o
explicitamente se a referência exigir mais tempo.

Export record contém metadados. Export snapshot + files contém os bytes
preservados e hashes para runs dentro dos limites do formato JSON. Para datasets
maiores, use o backup completo, que copia e verifica bytes em streaming. O runner também verifica hashes ao
importar um arquivo de run; importar arquivos da antiga aplicação continua sendo
uma operação de migração separada, ainda não implementada.

Uma reprodução não promete igualdade numérica entre versões de hardware,
serviços remotos ou algoritmos não determinísticos. Modelo, prompts, parâmetros
e seeds relevantes devem constar no protocolo/configuração preservados.

## Diagnóstico e recuperação

A Visão geral mostra registros ilegíveis, identidade de processo incerta e o
laboratório responsável quando a fila global está bloqueada. **Reconciliar
execução** tenta comprovar encerramento antes de reparar; um clique não atesta
que um processo morreu. O original corrompido é preservado. Se houver processos
sem identidade verificável, encerre-os pelos meios do sistema operacional e
tente novamente. Não remova controles enquanto houver possibilidade de processo vivo.

Publicações `.pending-*` órfãs comprovadamente inativas são preservadas com
hashes em `run-recovery/`, sem bloquear backups para sempre. Corrupção de
metadados ou uma publicação com atividade incerta permanece visível e bloqueia
novo despacho/backup até resolução.

O backup completo também está em Configurações do laboratório. Restore continua
offline, pelo comando de administração documentado abaixo. Credenciais Pi não
fazem parte do backup científico.

## Biblioteca

Datasets aceitam arquivos de texto e imagens; cada versão é imutável e contém
origem, manifesto e hashes. Para mudar o conteúdo, registre nova versão.

Importar DOI usa [metadados e resumos do Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
O texto não é apresentado como artigo completo. Outras fontes, inclusive arXiv,
podem ser adicionadas com título, URL, origem e texto fornecido pelo pesquisador.

## Backup e recuperação

O backup exige laboratório sem runs, turnos ou efeitos de arquivo em andamento.
Ele coordena snapshot SQLite com arquivos científicos e gera manifesto de
integridade. Ambientes uv e cópias de trabalho de runs são descartáveis;
snapshots, datasets, saídas e logs são preservados.

```sh
bun scripts/backup.ts create /caminho/backup-novo
bun scripts/backup.ts restore /caminho/backup-novo /caminho/dados-restaurados
```

O destino de restauração precisa não existir. Inicie com
`PICO_DATA_DIR=/caminho/dados-restaurados bun start`. Nunca substitua o diretório
atual para testar uma restauração. A aplicação aceita apenas uma instância dona
do mesmo diretório de dados.
