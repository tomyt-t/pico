# Planejamento da nova versão do Pico

Este diretório reúne o planejamento da nova experiência do laboratório,
consolidado em 30 de setembro de 2026. A proposta organiza a pesquisa em torno
da conversa com Pico e torna visíveis seus caminhos, evidências e mudanças de
entendimento.

O plano preserva a base atual: uma sessão Pi por laboratório, tools finas,
registros, jobs e uma UI. As issues 01–13 foram implementadas, com validação
interativa e integrada ainda pendente; a issue 14 continua planejada. O
[README do projeto](../../README.md) descreve o produto atual.

## Documentos

| Documento | Conteúdo |
| --- | --- |
| [Decisões](decisoes.md) | Visão do produto, organização das páginas e limites de complexidade. |
| [Issues da migração](issues.md) | As 14 etapas, com escopo, dependências e critérios de conclusão. |
| [Subagentes](subagentes.md) | Quatro etapas futuras, separadas da migração da UI. |
| [Referências visuais](referencias.md) | Capturas incluídas nesta pasta, direção visual e acesso ao protótipo. |
| [Primeira leva](primeira-leva.md) | Implementação das issues 01–04, revisões adversariais e limites da verificação. |
| [Segunda leva](segunda-leva.md) | Investigações, Acervo, acompanhamento e Evolução: issues 05–09. |
| [Terceira leva](terceira-leva.md) | Páginas compostas por Pico, catálogo mínimo e Panorama: issues 10–13. |

## Entregas

| Entrega | Issues | Resultado utilizável |
| --- | --- | --- |
| Interface e conversa | 01 a 04 | Nova identidade visual, sidebar, troca de lab e conversa como página ou painel. |
| Acompanhamento da pesquisa | 05 a 09 | Investigações, Acervo, lateral da conversa e Evolução com dados reais. |
| Páginas compostas por Pico | 10 a 13 | Tipo `page`, catálogo mínimo, páginas na navegação e Panorama editorial. |
| Validação integrada | 14 | Fluxos completos conferidos com o laboratório existente e diferentes cenários. |

A próxima entrega é a validação integrada, issue 14. A conferência no
navegador e o ciclo completo com modelo falso continuam pendentes. As dependências
de cada issue indicam o mínimo necessário para iniciá-la;
não são um incentivo a implementar muitas frentes simultaneamente.

Subagentes entram depois, conforme o [backlog próprio](subagentes.md). A UI
nova deve ser útil enquanto Pico ainda for uma única sessão.

## Como executar

Começar com uma base conhecida do repositório e do `bun run check`, preservando
alterações já existentes. Trabalhar em uma issue principal por vez e abrir um
PR por mudança coerente, com o comportamento entregue e a verificação realizada.
Extrair componentes e funções quando houver necessidade concreta de reutilização.

Os IDs 01 a 14 e A01 a A04 são identificadores locais deste planejamento, não
números de issues publicadas. Enquanto não houver um tracker externo, os
documentos de issues são a fonte de execução. Se forem publicados, registrar
os links aqui e acompanhar o andamento no tracker, evitando dois quadros de
status independentes.

Atualizar as decisões quando o escopo mudar. Atualizar o README do projeto nas
issues que alterarem comportamento ou persistência, descrevendo apenas o que
já estiver implementado. Testes relevantes acompanham cada mudança; a issue 14
confere a integração e não substitui essa verificação incremental.

## Como avaliar a entrega

O pesquisador deve conseguir voltar ao laboratório e entender o que avançou,
por que isso importa, o que permanece aberto e onde consultar as evidências.
O fluxo de referência é:

```text
Conversa → trabalho do Pico → registro de uma mudança → Evolução
    → evidência → discussão contextual → atualização do Panorama
```

Um job concluído descreve execução. O significado para a pesquisa precisa ser
explicado nos registros por Pico. A validação técnica usa modelo falso e
processos reais; a avaliação da qualidade dos registros com modelo real deve
ser identificada separadamente.
