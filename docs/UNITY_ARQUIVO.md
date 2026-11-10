# O app Unity está guardado (e pronto para voltar)

Em 10/11/2026 o Mesa Viva passou a ser desenvolvido **na web** (`web/`), para rodar no iPhone sem pagar a conta de desenvolvedor da Apple nem o build na nuvem. **Nada do Unity foi apagado nem movido.**

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Projeto Unity completo (cenas, scripts, testes, configurações) | Este repositório, no mesmo lugar: `Assets/`, `Packages/`, `ProjectSettings/` |
| Retrato exato do Unity no momento da troca | Tag Git **`unity-arquivo-2026-11-10`** (`git checkout unity-arquivo-2026-11-10`) |
| Projeto antigo (`MesaViva/unity-app`) | Já unido ao histórico daqui (commit `fc81c8e`). As mudanças que estavam sem commit lá ficaram na branch local **`arquivo/unity-app-wip`** do repositório `Desktop/MesaViva/MesaViva` |
| Guias do Unity | `docs/COMECE_AQUI.md`, `FASE0_GUIA.md`, `MESA_GUIA.md`, `IPHONE_GUIA.md`, `ARQUITETURA.md` |

As tags e a branch de arquivo **ainda estão só neste PC**. Para guardar no GitHub:

```bash
git push origin unity-arquivo-2026-11-10
```

```bash
git -C ../MesaViva push origin arquivo/unity-app-wip
```

## O que continua compartilhado

O Unity e o web leem **os mesmos arquivos**. Uma melhoria nos dados vale para os dois:

- `ml/config/model_map.json`: carta → modelo;
- `Assets/StreamingAssets/Catalog/*.tsv`: catálogo de cartas;
- modelos 3D em `.glb`: o web usa direto; no Unity, instale o pacote **glTFast**.

As regras de escolha de modelo existem em três linguagens (Python de referência, C# e JS), com os mesmos casos de teste nas três.

## Como retomar o app nativo

1. Abra a raiz deste repositório no Unity Hub (Unity 6000.6.8f1).
2. **Mesa Viva → Configurar projeto** e **Mesa Viva → Criar cenas**.
3. Rode os testes (Window → General → Test Runner): 57 EditMode + 1 PlayMode.
4. Android: instale o módulo Android Build Support e use Build And Run. iPhone: `docs/IPHONE_GUIA.md`.

Quando voltar ao nativo, o que foi criado no web e vale portar de volta está no "Mapa do código" de `web/README.md`.

## Regra para não quebrar o Unity

O Unity só olha `Assets/`, `Packages/` e `ProjectSettings/`. As pastas `web/`, `ml/`, `tools/` e `docs/` podem mudar à vontade. Não mexa em `Assets/` pelo web sem rodar `python tools/new_meta.py --check`.
