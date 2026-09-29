# Estabilização — 29/09/2026

Entrega solicitada pelo pesquisador após duas análises do Pico. O trabalho usa
três subagentes, revisão adversarial do desenho e duas rodadas de revisão da
implementação. As alterações de interface anteriores à entrega são preservadas.

## Escopo e aceite

| Frente | Aceite |
| --- | --- |
| Avaliações científicas | Hipótese e critérios preservados antes do run, métricas correspondentes, execução bem-sucedida para avaliação confirmatória; falhas continuam analisáveis. |
| Revisões de evidências | Avaliações identificam a revisão usada e sinalizam quando essa base muda, sem apagar a decisão anterior. |
| Recuperação operacional | Corrupção permite diagnóstico; publicação órfã é reconciliada preservando bytes; identidade incerta continua impedindo despacho e backup até resolução verificável. |
| Execução local | Limpeza segura de workdirs, término com prazo, identidade Linux, acesso explícito ao Pi e capacidades/limites de recursos honestos. |
| Contexto durável | Tools com leitura limitada, compactação com checkpoint, replay nativo preservado, conclusões agrupadas e orçamento observado de tokens/custo. |
| Interface | Retomada de falhas, histórico paginado, envio durante trabalho, links para registros, realce sob demanda e polling condicional com backoff. |
| Navegador | Markdown não carrega recursos externos automaticamente; CSP e política de referência. |
| Operação cotidiana | Backup acessível, uso observado visível, testes automatizados e CI. |
| Validação real | GLM 5.3 autorizado pelo pesquisador, sem teto de gasto/chamadas, em laboratório separado. |

## Decisões da revisão do desenho

- `unknown` não é prova de término. Não será liberado por prazo ou por um botão
  que apenas declare encerramento.
- Um registro corrompido não será silenciosamente ignorado; pode corresponder a
  processo ainda vivo. Diagnóstico e reparo preservam o original.
- Retirar variáveis de ambiente do Pi controla o acesso intencional, mas não é
  sandbox: Python local conserva as permissões do usuário. Essa fronteira deve
  ser explícita; nenhuma proteção contra código hostil será alegada sem prova.
- Histórico e resumos já existiam. A correção acrescenta limite de volume,
  checkpoint efetivo e navegação; não apaga mensagens antigas.
- A Biblioteca já mostra conclusões que citam papers e utilização de datasets.
  Esse item do relatório não é uma funcionalidade ausente.
- Dados operacionais de término não recebem autoridade de instrução do modelo.
- Limites de custo baseados em uso reportado não são um teto financeiro rígido;
  uma chamada em andamento pode ultrapassá-los e custo desconhecido permanece
  identificado como desconhecido.

## Evidências

Baseline anterior: `bun run check`, 191 testes e 1.073 assertions aprovados.
Os resultados finais abaixo distinguem testes com modelo simulado, processos
locais reais e inferência externa.

## Entregas implementadas

| Achado | Resolução |
| --- | --- |
| HARKing, runs falhos e métricas sem relação com critérios | Critérios ancorados à revisão da hipótese, preservados no snapshot; avaliação exige sucesso de todos os runs citados, dimensões exatas e coerência com comparadores. Evidência conflitante exige avaliação inconclusiva. Legado continua legível, sem inventar pré-registro. |
| Resultados corrigidos deixavam avaliações aparentemente atuais | `resultRevisions` preserva a base; revisão marca hipóteses/conclusões `needsReview`. UI abre inclusive a revisão histórica avaliada. |
| `unknown` bloqueava sem diagnóstico | Inventário operacional na Visão geral, com link ao outro laboratório responsável, e reparo condicionado à prova de término. Sem liberação por prazo ou declaração do usuário. |
| `.pending-*` órfão e `run.json` inválido | Partida diagnostica e preserva arquivos ilegíveis; publicação comprovadamente órfã vai para `run-recovery/` com hashes. Corrupção de proveniência científica também vira diagnóstico bloqueante. |
| Credenciais fornecidas a todo experimento | Binding Pi opt-in por experimento, concedido somente por pesquisador e consultado no despacho. Revogação cobre fila e reprodução. Não é sandbox de Python. |
| Imagens Markdown e ausência de CSP | Imagens viram links explícitos; documentos de produção recebem CSP, nosniff e no-referrer. |
| Saídas de tools e overflow irrecuperável | Páginas UTF-8 com fingerprint, limite serializado, metadados para binários, clipping do replay legado e redução durável do contexto. No piso inviável, retomada exige trocar provedor/modelo. |
| Contexto sem compactação efetiva e índice volátil no prefixo | Checkpoint transacional de prefixos completos, mensagens originais preservadas e índice após histórico. Blocos nativos assinados não são reescritos. |
| Tempestades de conclusões e eventos com autoridade system | Um turno agregado por lote, `eventRuns` paginável e dedup inclusive para eventos secundários após restart. Mensagens são dados user com autoria de laboratório; pedidos do pesquisador têm prioridade. |
| Prompt só operacional e orçamento só de passos | Orientação de baseline, controles, confundidores, amostragem, pré-registro e data UTC. Uso observado de tokens/custo, pausas opcionais e preço desconhecido explícito. |
| `.venv` acumulada e três cópias caras dos dados | Limpeza explícita segura de `work/`; cópias verificadas tentam reflink, nunca hardlink gravável. Fallback conserva cópias físicas onde CoW não existe. |
| Teto pequeno para datasets | Importação local offline em streaming: 1 GiB/arquivo, 16 GiB/versão, 2.000 arquivos; backup/restore também em blocos. Upload/export JSON continuam pequenos, com orientação para backup completo. |
| SIGKILL imediato, dependência de ps, ausência de recursos | SIGTERM seguido de SIGKILL com prazo; identidade por procfs no Linux. RLIMIT_AS por processo e seleção CUDA configuráveis e preservados, com rejeição em hosts sem suporte. |
| Polling e realce custosos | ETag/304, backoff e pausa em aba oculta; tool bodies e realce só montam ao abrir. Overview não carrega o histórico da conversa para consultar turnos. |
| Conversa e navegação incompletas | Envio enfileirado enquanto Pico trabalha, rascunho preservado durante POST, intent opaco retido para retry, retomada de falhas, histórico paginado e preenchimento de lacunas após aba oculta. IDs levam aos registros. |
| i18n e dependência sem uso | Fallbacks do cliente HTTP traduzidos; chaves pt-BR/en tipadas; remoção de lucide-react. Alterações anteriores de i18n, realce e comparação preservadas. |
| Biblioteca sem uso de fontes | A análise confirmou que os vínculos já existiam; a entrega preserva essa capacidade. |

## Rodadas adversariais cruzadas

Três subagentes atuaram em ciência, runner e contexto. A coordenação integrou
segurança, HTTP, UI e validação externa. Além das duas rodadas de desenho, duas
rodadas de implementação trocaram os revisores entre as frentes:

- Ciência → runner: claim incompleto não prova morte; run admitted sem controles
  não pode ser reparado como encerrado; dispatch órfão só resolve com PID
  comprovadamente ausente; reparo de metadados não exige os recursos do host original.
- Runner → ciência: editar hipótese inconclusiva exige sinalizar avaliação antiga;
  reprodução compara todos os inputs científicos, sem exigir mesmo ambiente observado.
- Coordenação → contexto: dedup de evento secundário, referências completas do
  lote, fingerprint de páginas mutáveis e preservação de IDs em recibos grandes.
- Contexto → UI/API: autoria dos eventos, corrida de rascunho, janelas móveis e
  lacunas após mais de 200 mensagens, diagnóstico de bloqueio vindo de outro lab.
- Ciência → UI: impedir iniciar run enquanto alteração de acesso Pi está pendente
  e reinicializar opções de recursos ao trocar de experimento.
- Runner → contexto: cursor inicial de histórico deve ficar antes do grupo de
  tools em andamento, evitando páginas cuja própria execução altera os bytes.
- Uso real → reprodução: o modelo reenviou configuração idêntica com referenceRunId.
  A API passou a aceitar redundância exatamente igual, mantendo rejeição de mudanças.

Cada correção tem regressão ou cenário de integração correspondente. As regras
de fronteira arquitetural não foram relaxadas, e as fixtures históricas não
foram modificadas. Detalhes de contexto estão em [architecture-review.md](architecture-review.md).

## Validação local e externa

- macOS: `bun run check` aprovado — **248 testes, 1.521 assertions, zero falhas**,
  TypeScript, Biome e build de produção. Um teste específico de Linux foi pulado
  no macOS e executado separadamente em Linux. Instalação frozen-lockfile passou
  sem alterações de dependências; `git diff --check` limpo.
- Linux em Docker, offline, imagem sem `ps`: **35 testes / 142 assertions** do
  runner aprovados. Teste adicional confirmou RLIMIT_AS de 128 MiB no pai e filho
  e `MemoryError` ao pedir 256 MiB: **1 teste / 2 assertions**. Não havia GPU
  física; o teste CUDA valida a seleção por variável de ambiente, não cálculo GPU.
- Chrome real: criação de laboratório, demo com Python, link do chat para run,
  limpeza de workdir seguida de reprodução bem-sucedida, pt-BR/en, desktop/mobile
  e preservação de novo rascunho enquanto a resposta do POST estava atrasada.
  Sem overflow horizontal a 390 px e sem erros no console.
- GLM 5.3: laboratório separado, `zai/glm-5.3` pelo perfil Pi existente, sem teto
  de gasto/chamadas. O modelo criou pergunta, hipótese, critério prospectivo,
  código, duas execuções bem-sucedidas, resultado e conclusão. Um pedido de
  pesquisador enfileirado durante trabalho precedeu a análise agregada dos runs.
  O script de aceite verifica os 24 pares preservados, delta ≈ 0,2, reprodução
  com inputs iguais, hashes, evidências e revisões correntes de hipótese/conclusão.
  Houve também uma tentativa rejeitada, preservada como failed, antes da correção
  de configuração redundante. A revisão final corrigiu uma confusão de redação
  entre inferência do modelo e inferência estatística, mantendo histórico.
  Total incluindo essa revisão: **25 chamadas, 557.179 tokens e US$ 0,61355624
  reportados pelo provedor**, sem limite imposto. A leitura final de aceite após
  restart não fez novas chamadas. A observação sobre config+referenceRunId no
  registro é histórica da versão executada; o comportamento final está corrigido.
- Backup/restore do laboratório externo real: **119 registros e 3 revisões**
  idênticos após restauração, incluindo histórico de modelo e evidências; nenhum
  `auth.json` no backup. O manifesto também verifica os arquivos preservados.

Evidências locais ficam em `artifacts/stabilization-2026-09/`: logs de checks,
testes Linux, capturas Chrome e `external/report.json` / `external/validation.json`.
`scripts/validate-glm.ts <diretório> --resume` verifica o laboratório novamente;
uma execução nova faz inferência real e requer acesso configurado.

## Limites e próximo passo de pesquisa

Esta validação externa usa GLM real como Pico e dados sintéticos determinísticos
no Python. Não é benchmark de defesa de LLM nem resolve o efeito de piso do M5.
O próximo piloto empírico precisa de estímulos/target com taxa basal mensurável e
tamanho de amostra definido antes dos resultados. GLM 5.3 no catálogo usado aceita
texto; o piloto multimodal antigo usa outro modelo, GLM 5.3 Flash, e não foi
substituído silenciosamente.

O executor continua destinado a código confiável. RLIMIT_AS não limita RAM total
da árvore; seleção CUDA não é quota nem isolamento. CoW depende do filesystem.
ETag reduz transferência/renderização, mas o servidor ainda calcula a projeção.
Compactação automática é extrativa, com acesso às fontes completas, sem promessa
de resumo semântico perfeito. CI macOS/Linux foi configurada; sua execução remota
não é confundida com os testes locais já executados.
