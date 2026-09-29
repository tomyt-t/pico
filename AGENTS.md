# Desenvolvimento de Pico

## Direção do produto

Leia README.md e docs/architecture.md antes de mudanças estruturais.
As entregas e sua validação estão em docs/development.md.
A estrutura implementada, as fronteiras e o mapa de trabalho para agentes
estão em docs/code-architecture.md: apps/server e apps/web são aplicações;
packages/lab contém o motor e packages/runner a execução independente.
Contratos públicos são o subpath @pico/lab/contracts, sem workspace separado.
As rodadas adversariais estão em docs/architecture-review.md.

Pico é o co-líder do pesquisador. A baseline usa uma sessão principal por
laboratório e tools. A pesquisa fica organizada em entidades persistentes,
mantidas naturalmente durante a conversa.

- Manter Pico como nome do produto; tiny-pico distingue a pasta/repositório.
- A refatoração integral foi realizada conforme decisão do pesquisador.
  Nas próximas evoluções, trabalhar em entregas pequenas que demonstrem
  uma capacidade real.
- Introduzir abstrações quando houver uma necessidade concreta.
- Campanhas, equipes e papéis de agentes não são requisitos da nova jornada.
- Reaproveitar componentes da implementação anterior somente após revisar suas
  dependências. A origem dos registros antigos deve ser preservada na importação.

## Limites entre módulos

- Tools chamam operações de lab; regras científicas ficam em lab.
- Pico e UI consultam os mesmos registros e projeções.
- Storage implementa persistência e migrações; web usa somente a API e contratos.
- Runner executa jobs e devolve observações; o modelo escreve interpretações.
- Dados e credenciais de modelo são tratados separadamente do código da aplicação.
- Usar imports com alias @/ dentro de src, configurado de forma coerente para
  TypeScript, runtime, bundler e testes. Usar prefixos únicos
  @/lab, @/runner, @/server e @/web
  dentro do respectivo workspace. Imports entre pacotes usam nomes e exports
  públicos; aliases internos não podem contornar essa fronteira.
- Testes privados ficam no workspace proprietário. Scripts e testes da raiz
  usam APIs públicas. Preservar os bytes das fixtures históricas.
- Conferir a matriz em tests/architecture/module-policy.ts ao mudar dependências;
  não relaxar a regra apenas para acomodar um import indevido.

## Integridade da pesquisa

- Preservar IDs, relações, autoria e histórico nas migrações.
- Não substituir uma execução antiga para registrar uma nova tentativa.
- Cada run referencia entradas, código e configuração preservados.
- Resultados quantitativos devem apontar para observações coletadas do run.
- Hipóteses e previsões são opcionais em exploração; critérios de um teste de
  hipótese precisam distinguir o que foi previsto do que foi observado.
- Registrar conclusões com fontes e limitações; avaliação por Pico não representa
  uma revisão independente.
- Mutações repetidas por recuperação não podem criar runs ou registros duplicados.

## Verificação

Executar verificações proporcionais à mudança. Priorizar testes de invariantes,
integração, migração/restore e cenários científicos completos.

Distinguir explicitamente: comportamento testado com modelo simulado, execução
local real e investigação realizada com modelo externo. A configuração de acesso
e orçamento para serviços externos pertence ao laboratório/pesquisador.

Atualizar a documentação quando uma decisão de produto ou persistência mudar.
