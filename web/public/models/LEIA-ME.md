# Modelos 3D

Coloque aqui arquivos `.glb` com o nome do id de modelo do `model_map.json`: `dragon.glb`, `elf.glb`, `terrain_forest.glb`...

- Sem arquivo, o app mostra uma criatura procedural nas cores da carta.
- A animação chamada `idle` (ou a primeira do arquivo) toca em loop.
- O mesmo `.glb` serve para o Unity (pacote glTFast, que lê meshopt), se um dia o app nativo voltar.

## Compressão (meshopt)

Os `.glb` daqui ficam comprimidos com meshopt (`EXT_meshopt_compression`, ~47% menores); o app decodifica com o `MeshoptDecoder` do three. Depois de pôr ou trocar um modelo:

```
git lfs pull                 # os .glb ficam no Git LFS: sem isso só há os ponteiros
cd web
npm run compress-models      # ou: npm run compress-models -- --dry (só mostra)
```

O script (`web/scripts/compress-models.mjs`) só grava um arquivo se, relido depois de comprimido, ele tem os mesmos nós, malhas, peles e animações e a caixa do modelo (na pose de repouso, com a pele aplicada) igual até 0,5%. Arquivos já comprimidos são pulados.
- Anote a licença de cada modelo em `docs/CREDITS.md`.
