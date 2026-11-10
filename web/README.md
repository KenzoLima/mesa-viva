# Mesa Viva Web

O Mesa Viva no navegador. Não precisa de loja, conta da Apple nem build nativo.

| Modo | Tecnologia | Onde roda | O que faz |
|---|---|---|---|
| **Cartas** | MindAR (rastreamento de imagem) + Three.js | iPhone (Safari) e Android (Chrome) | Reconhece a carta e faz a criatura surgir em cima dela |
| **Mesa** | WebXR `immersive-ar` + `hit-test` (ARCore) | Android (Chrome) | Detecta o plano da mesa, calibra a área de jogo e invoca criaturas onde você toca |
| **Bestiário** | catálogo + `ModelResolver` | qualquer navegador | Mostra qual modelo cada carta usa e por quê |

O Safari do iPhone não tem WebXR. Por isso o modo Mesa fica só no Android, e o iPhone usa o modo Cartas.

## Rodar no PC e testar no celular

Precisa de Node 20+ e Python 3.10+.

```bash
cd web
npm install
npm run dev
```

O Vite mostra um endereço `https://192.168.x.x:5173`. Com o celular **no mesmo Wi-Fi**, abra esse endereço:

- o certificado é autoassinado: aceite o aviso (iPhone: "Mostrar detalhes" → "visitar este site"; Android: "Avançado" → "Continuar");
- a câmera só abre com HTTPS, por isso o `dev` já sobe com HTTPS.

Outros comandos:

- `npm test`: testes de dados e da mesa (Node, sem navegador);
- `npm run build`: gera o site em `dist/`;
- `npm run dev:http`: só o menu no PC, sem HTTPS.

## Publicar de graça (GitHub Pages)

O workflow `.github/workflows/web-pages.yml` publica o `web/` a cada push na `main`. Para ligar: **GitHub → Settings → Pages → Source: GitHub Actions**. O endereço fica `https://<usuário>.github.io/<repositório>/`, com HTTPS de verdade e sem aviso de certificado.

Atenção: no plano grátis, o Pages só publica repositório **público**.

## Primeiros passos do modo Cartas

1. Baixe as imagens: `python ml/scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" --out ref_images`.
2. Abra `compilar.html` no app, escolha as imagens (o nome do arquivo é o nome da carta) e clique em **Compilar**.
3. Salve `targets.mind` e `targets.json` em `web/public/targets/`.
4. Recarregue o app e aponte a câmera para a carta (na tela ou impressa).

Modelos 3D: coloque `<id>.glb` em `web/public/models/` (veja o `LEIA-ME.md` de lá). Sem eles aparece uma criatura procedural.

## De onde vêm os dados (fonte única)

O web **não tem dados próprios**: usa os mesmos arquivos do Unity e do Python.

```
ml/config/model_map.json             ─┐
Assets/StreamingAssets/Catalog/*.tsv ─┴─► python tools/sync_web_data.py ─► web/public/data/
```

Mudou o mapa ou o catálogo? Rode `npm run sync-data`. O CI confere com `--check`.

## Mapa do código (e o equivalente no Unity)

| Web | Unity (`Assets/_Project/Scripts`) | Python (`ml/`) |
|---|---|---|
| `src/data/textNorm.js` | `Data/TextNormalizer.cs` | `mtgar_data/text_norm.py` |
| `src/data/catalog.js` | `Data/CardCatalog.cs` | `scripts/export_app_catalog.py` (gera) |
| `src/data/modelResolver.js` | `Data/ModelResolver.cs` | `mtgar_data/model_resolver.py` (referência) |
| `src/table/tableFrame.js` | `Table/TableFrame.cs`, `Table/TableCalibrationStateMachine.cs` | — |
| `src/modes/table.js` | `Table/TableCalibrationController.cs`, `TableAreaVisualizer.cs`, cena `Mesa` | — |
| `src/modes/cards.js` | `Phase0/CardCreatureSpawner.cs`, cena `Fase0` | — |
| `src/creatures.js` | `Phase0/CardPrefabLibrary.cs`, `CreatureSpawnFx.cs` | — |

As três implementações do `ModelResolver` precisam decidir igual. Os testes em `tests/data.test.js` repetem os casos de `ml/tests/test_model_resolver.py`.

## Ainda não portado do Unity

Leitura e gerenciamento de decks (`DeckParser.cs`, `DeckStore.cs`), as telas de menu completas (`UI/Screens`), configurações (`AppSettings.cs`) e o filtro de status do rastreamento (`TrackingStatus*.cs`). O código C# continua no projeto como referência. Veja `docs/UNITY_ARQUIVO.md`.
