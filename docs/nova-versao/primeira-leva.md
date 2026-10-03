# Primeira leva: interface e conversa

Implementação das issues 01–04 em 30 de setembro de 2026. Três subagentes
trabalharam em tema, navegação e controlador; a integração do painel ficou com
o agente principal. Duas rodadas adversariais revisaram arquivos de outros
autores. A validação visual no navegador ainda está pendente.

## Comportamento entregue

- Grafite e violeta, DM Sans no texto e Manrope nos títulos, fontes locais
  com licenças. Tema escuro inicial; preferência salva e tema claro preservados.
- Sidebar recolhível, seletor pesquisável no cabeçalho, criação existente e
  menu móvel em dialog nativo. Nenhum rail adicional ou link para área futura.
- Um controlador de conversa e uma assinatura SSE por laboratório aberto,
  mantidos entre páginas. Ao desconectar, HTTP recupera o estado; ao reconectar,
  o snapshot substitui a saída transitória e o histórico é consultado.
- Uma apresentação da conversa, como página ou painel. Discussão contextual
  acrescenta referência ao rascunho; fechar o painel não aborta o turno.
  Até 1100px, o painel ocupa a área do conteúdo e uma nova rota de material
  fecha o painel. No desktop, os grids do material são empilhados quando
  necessário para leitura ao lado da conversa.
- Rascunhos separados por laboratório; confirmação de envio usa comparação
  para preservar edições posteriores. Um pequeno bloqueio de POST pendente
  no App impede duplicação ao trocar de lab e voltar antes da resposta.

O código continua usando React local, router por hash, `usePoll`, EventSource
e contratos existentes. Não foram alterados runtime Pi, banco, tools, dados dos
laboratórios ou entidades. Investigações, Evolução, catálogo e subagentes do
Pico pertencem às próximas entregas.

## Revisão adversarial

| Achado da primeira rodada | Correção | Segunda rodada |
| --- | --- | --- |
| Evento `close` atrasado fechava seletor reaberto em StrictMode. | Ignorar `close` quando o dialog já está aberto novamente. | Reproduzido antes e aprovado depois em DOM simulado. |
| Resize com seletor sobre menu móvel perdia foco. | Fechar ambos e devolver foco ao cabeçalho desktop após desmontagem. | Conferido no código; comportamento nativo no browser pendente. |
| Troca de lab e expansão removiam o botão focado. | Focar novo workspace; expansão sinaliza foco no compositor preservado. | Revisão independente e DOM simulado. |
| Nova rota móvel continuava oculta pelo dock. | Fechar dock ao navegar para material em viewport estreito. | Revisão independente e DOM simulado. |
| Grids continuavam largos ao lado do dock. | Reduzir padding e empilhar grids internos, removendo sticky inadequado. | Revisão estática; comparação visual pendente. |
| Queda do SSE deixava status preso apesar do polling. | Desconexão devolve autoridade ao HTTP; novo snapshot SSE a retoma. | Revisão independente e simulação do hook. |
| Troca A → B → A durante POST permitia envio duplicado. | Bloqueio por lab no proprietário persistente da UI, liberado em `finally`. | Revisão independente e teste HTTP simulado. |

## Verificação

Typecheck e build passaram. Biome passou com os mesmos dois avisos de
especificidade CSS encontrados antes da implementação, em `styles/pages.css`.
Os 16 testes web passaram. Eles incluem recuperação de conversa, snapshots ativos, steering,
erro de modelo e envio pendente em labs distintos, com HTTP simulado e React
estático; não chamam um provedor.

Um diagnóstico temporário com React DOM e LinkeDOM já instalado verificou
uma única assinatura SSE, streaming entre rotas, abrir/fechar/expandir painel,
foco, seletor em StrictMode, navegação estreita, troca de laboratório, rascunho
editado durante POST e fallback HTTP. Ele usa DOM e eventos simulados; não
substitui teste de layout nem as regras nativas de dialog em Chrome.

`bun run check` foi executado, mas o teste de sessão que abre o servidor do
modelo falso falha em `Bun.serve({ port: 0 })` neste ambiente. A mesma falha
ocorreu antes das mudanças. Resultado final: 25 testes passaram, um falhou,
com 158 verificações. O build foi executado separadamente porque o
comando completo para no teste. Nenhum modelo real foi validado.

Chrome DevTools MCP não estava disponível entre as ferramentas; a conexão ao
bridge local existente foi negada pelo ambiente. Permanecem pendentes a
comparação com as referências, contraste/renderização reais, teclado e foco
dos dialogs, viewport móvel e o fluxo integrado com modelo falso em um
ambiente que permita abrir a porta local.

## Limitações identificadas para acompanhamento

- O protocolo atual de retry do Pi pode anunciar fim do turno e ocultar Parar
  durante backoff. É preexistente; uma correção deve representar `willRetry`
  e término do retry, em vez de presumir atividade permanente na UI.
- Um erro de POST concluído após desmontar seu controller não reaparece ao
  voltar ao lab. O rascunho permanece e o bloqueio é liberado. Não foi criado
  um armazenamento de erros por laboratório nesta leva.
- Selecionar a rota atual no menu móvel não gera `hashchange`; um painel já
  aberto nessa mesma rota continua aberto. O botão de fechar permanece disponível.
