# Busca web e perfil isolado

Pico usa `pi-web-access@0.30.0`, fixado no package.json e bun.lock. A extensão
é carregada pelo SDK local do Pi; não depende de `pi install` nem do Pi global.

## Configuração inicial

```sh
bun install --frozen-lockfile
bun run pi
```

No Pi aberto pelo comando, use `/login`, selecione o provedor e termine com
`/exit`. Depois rode `bun run dev` ou `bun run build` e `bun start`. Na página de
configurações do laboratório escolha o provedor/modelo autenticado.

O comando e o servidor usam os mesmos `PICO_DATA_DIR` e `PICO_PI_AGENT_DIR`.
O primeiro define a instalação; o segundo é um override opcional do perfil.
Uma instalação nova não copia credenciais do Pi pessoal. Laboratórios existentes
mantêm sua pesquisa, conversa e seleção de modelo; basta autenticar o modelo no
novo perfil. Os snapshots antigos dos experimentos são preservados.

```text
PICO_DATA_DIR/                  # padrão ~/.local/share/pico
  pico.sqlite                  # pesquisa e conversa durável
  labs/                        # fontes registradas, datasets, experimentos e runs
  pi/
    auth.json                  # criado pelo login; não compartilhar
    models.json                # modelos/endpoints próprios, se necessários
    models-store.json          # cache do catálogo próprio
    settings.json              # preferências do Pi do Pico
    web-search.json            # configuração da busca do Pico
    workspace/                 # diretório do CLI de configuração
  runtime/web/<lab-id>/         # host, cache e temporários de busca por lab
```

Somente registros científicos e arquivos de `labs/` entram no backup do lab.
Perfis e caches devem ser configurados novamente após restaurar em outra máquina.
Compartilhar o repositório não compartilha autenticação nem pesquisas; para
compartilhar uma pesquisa use a exportação/backup explícito.

## Provedor de busca

O arquivo `pi/web-search.json` é criado na primeira inicialização sem sobrescrever
uma configuração existente. O padrão é:

```json
{"provider":"exa","maxInlineContentChars":16000}
```

Exa usa o endpoint público MCP quando `EXA_API_KEY` não está configurada. Não há
garantia de disponibilidade ou quota ilimitada. A busca não exige login em um
modelo; a conversa com Pico exige seu provedor ou o modo demonstrativo.

Para resultados do Google, escolha **um** dos serviços:

| Provedor no JSON | Variável no ambiente do Pico |
| --- | --- |
| `serper` | `SERPER_API_KEY` |
| `serpapi` | `SERPAPI_KEY` |
| `brave` | `BRAVE_API_KEY` |
| `exa` com API própria | `EXA_API_KEY` |

Exemplo de Google: `{"provider":"serper"}`. Esses serviços exigem conta/chave
próprias e podem cobrar por uso. Coloque a variável em `.env` local ou no ambiente
do servidor. Não escreva chaves na conversa ou nos arquivos do experimento.
Reinicie Pico após alterar a configuração de busca. Um provedor explicitamente
selecionado não troca silenciosamente por outro.

## Uso na conversa

> Procure trabalhos sobre defesas para LLMs multimodais, leia os métodos e
> limitações dos mais relevantes e salve as fontes que usarmos na Library.

Pico dispõe de `web_search`, `fetch_content` e `get_search_content`. A busca
retorna fontes e resumos; a leitura recupera páginas/PDFs com texto selecionável;
o cache permite continuar por trechos ou localizar passagens. Conteúdo inacessível,
PDFs escaneados e páginas que exigem JavaScript podem não ser extraídos.
O adaptador transforma o arquivo gerado pelo extrator PDF em texto paginado;
as respostas preservam os marcadores de página. No GitHub, use páginas públicas
e URLs de arquivos raw: clonagem e especializações que dependem do ambiente Git
pessoal ficam desabilitadas nesta integração.
Busca direcionada ao arXiv usa `domainFilter: ["arxiv.org"]`; esta entrega não
instala um MCP acadêmico nem consulta diretamente a API estruturada do arXiv.

`register_paper` preserva na Library os trechos relevantes, URL/DOI/versão e
proveniência. Trechos de busca não equivalem à leitura do artigo completo.
Resultados originais das tools ficam na conversa; caches são auxiliares e não
substituem as fontes registradas. Stop cancela a chamada web e permite tentar
novamente. Cada requisição tem limite de 90 segundos.

## Fronteira da integração

O Pico continua dono de uma conversa e do loop de raciocínio por laboratório.
Cada lab tem um processo auxiliar que hospeda somente as três tools da extensão.
O host usa o ciclo de vida do SDK, mas nunca chama `session.prompt` nem conduz
uma investigação paralela. A separação em processos isola configurações e caches
globais do pacote. Tools e resultados passam pelo histórico durável do Pico.

O carregador desativa descoberta automática de extensões, skills, prompts, temas
e arquivos de contexto, carregando apenas o pacote fixado pelo projeto. O modo de
busca é `workflow: none`; curadoria interativa, acesso a cookies pessoais e
geração adicional de resumos ficam desabilitados. PDFs usam extração local.
O executor também recebe o perfil Pi do Pico, inclusive para reproduzir códigos
antigos que consultam `PI_CODING_AGENT_DIR`.

Esse isolamento é de configuração, estado e processos. Código de experimento
continua sendo código local confiado, conforme a arquitetura do executor.

Referência do pacote: https://github.com/nicobailon/pi-web-access
