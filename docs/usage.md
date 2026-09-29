# Usar o laboratório

## Primeira investigação

1. Crie um laboratório com nome e linha de pesquisa. Perguntas específicas podem
   surgir depois; uma hipótese não é obrigatória para começar a explorar.
2. Em Chat, converse com Pico sobre a pergunta e o primeiro teste. O modelo usa
   tools para manter os registros; não há campanha nem equipe para configurar.
3. Acompanhe perguntas, hipóteses e conclusões no Overview. Os links levam aos
   mesmos experimentos e evidências usados na conversa.
4. Em Experiments, consulte protocolo, tentativas, métricas, logs, código e dados.
   Um run continua independentemente do turno do modelo.
5. O término volta à mesma conversa. Pico lê as observações e registra o resultado
   com interpretação e limitações. A próxima investigação pode revisar a hipótese,
   mudar o protocolo ou abrir outra pergunta.

O modo Demonstration possui um narrador determinístico. Ele usa as tools reais e
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

O modo **Advanced · OpenAI-compatible API** usa Chat Completions com function
calling. Configure base URL, modelo e nome da variável de ambiente da chave.
Seu botão de conexão consulta `/models`; a resposta não garante disponibilidade
para geração. Endpoints locais HTTP são permitidos; remotos exigem HTTPS.

Cada bloco de trabalho tem limite de passos. Ao esgotar, o turno pausa e oferece
Continue, mantendo as chamadas já concluídas. Stop interrompe o turno; runs
submetidos continuam e têm seu próprio botão Cancel. Após falha de servidor,
turnos em execução ficam Interrupted e podem ser continuados conscientemente.

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
arquivos; eles não equivalem a quotas rígidas de CPU, memória ou disco do SO.

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

O runner fornece `PICO_PI_AGENT_DIR` e `PI_CODING_AGENT_DIR` apontando para o
perfil próprio do Pico. O piloto atual usa esse perfil; os snapshots antigos
continuam intactos e recebem o mesmo destino pelo ambiente de execução.
Para outro alvo, prepare uma nova versão explícita do experimento. Cada condição faz no
máximo quatro inferências, com retries desativados. Reprodução fará outras quatro.

Consulte o protocolo preservado: dois exemplos por split verificam o fluxo, mas
não permitem alegar eficácia geral da defesa.

Reproduce cria outro run a partir do snapshot de referência, preservando código,
argumentos, configuração e bytes de inputs. Não executa o workspace atual. O
limite de tempo atual do laboratório continua sendo respeitado; aumente-o
explicitamente se a referência exigir mais tempo.

Export record contém metadados. Export snapshot + files contém os bytes
preservados e hashes, sem executar nada. O runner também verifica hashes ao
importar um arquivo de run; importar arquivos da antiga aplicação continua sendo
uma operação de migração separada, ainda não implementada.

Uma reprodução não promete igualdade numérica entre versões de hardware,
serviços remotos ou algoritmos não determinísticos. Modelo, prompts, parâmetros
e seeds relevantes devem constar no protocolo/configuração preservados.

## Library

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
