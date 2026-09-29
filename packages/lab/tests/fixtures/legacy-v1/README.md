# Fixture histórica v1

Este diretório contém somente pesquisa sintética, escrita pela implementação
anterior à separação em workspaces. O código do novo writer não foi usado.

- `backup/`: backup completo `pico-backup-v1`, incluindo SQLite, datasets,
  workspace, snapshot, observações, logs e `run-records`.
- `archive-v1.json`: archive científico v1 e envelope operacional original.
- `expected.json`: IDs, registros, revisões, hash do snapshot, bytes esperados,
  model steps nativos e mensagens de tool. Também identifica o código escritor
  por SHA-256 de cada arquivo original em `src/`.
- `generate-legacy-v1.ts.txt`: gerador executado no checkout histórico. A extensão
  `.txt` impede sua execução/coleta como teste pelo checkout novo.

A execução Python foi real e local: leu `[1, 2, 3, 4]`, mediu média 2.5 e
contagem 4, e preservou os arquivos usados. A conversa foi **simulada** pelo
provedor `faux` do SDK Pi; inclui assinaturas sintéticas de thinking/text/tool,
resposta nativa, tool `create_question` concluída e turno concluído. Nenhum
modelo externo foi chamado; não há credenciais nem dados pessoais no fixture.

Origem desta geração: snapshot anterior à refatoração criado em
`/var/folders/43/yg10h6_d6z9_bnvh7vh8pcdw0000gn/T/pico-before-refactor-_jhqnkex`.
O snapshot é temporário; os hashes em `expected.json` identificam o conteúdo
escritor independentemente desse caminho.

Para reproduzir em uma cópia dessa versão histórica (Bun 1.4, Python 3 e
dependências fixadas instaladas), copie o gerador para seu diretório `scripts`:

```sh
cp /caminho/legacy-v1/generate-legacy-v1.ts.txt scripts/generate-legacy-v1.ts
bun scripts/generate-legacy-v1.ts /diretorio/novo/legacy-v1
```

O destino deve ser novo. IDs e timestamps mudam em uma nova geração; a referência
versionada deve permanecer congelada para que testes do leitor novo não produzam
suas próprias expectativas. Os testes devem restaurar uma cópia em diretório
temporário e jamais modificar este backup ou recalcular seus hashes esperados.
