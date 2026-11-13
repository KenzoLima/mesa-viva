# Mesa Viva Web

O Mesa Viva no navegador. Não precisa de loja, conta da Apple nem build nativo.

| Modo | Tecnologia | Onde roda | O que faz |
|---|---|---|---|
| **Cartas** | MindAR (rastreamento de imagem) + Three.js | iPhone (Safari) e Android (Chrome) | Reconhece a carta e faz a criatura surgir em cima dela |
| **Mesa (RA)** | WebXR `immersive-ar` + `hit-test` (ARCore) | Android (Chrome) | Detecta o plano da mesa, calibra a área de jogo e invoca criaturas onde você toca |
| **Mesa com câmera parada** | câmera + calibração por uma folha A4 (homografia) + Three.js | PC (webcam), iPhone, qualquer Android | A câmera fica num suporte; você marca os 4 cantos de uma folha na mesa e invoca criaturas onde clicar |
| **Bestiário** | catálogo + `ModelResolver` | qualquer navegador | Mostra qual modelo cada carta usa e por quê |

O Safari do iPhone e os navegadores de PC não têm WebXR com RA. Neles o botão **Mesa** abre a versão com câmera parada.

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

## Modo Mesa no Android

Precisa do **Chrome no Android** com o **Google Play Services para RA** (ARCore) instalado. Abra o app pela Vercel ou pelo `npm run dev` (HTTPS), vá em **Batalha → Mesa** e aceite a câmera.

O fluxo é o da calibração do plano (`docs/PLANO.md` §3.5 e `docs/MESA_GUIA.md`):

1. **Procurar:** mova o celular devagar sobre a mesa. A barra enche e, se o aparelho der detecção de planos, a grade dourada aparece na mesa. Depois de 15 s sem mesa aparece a dica, com **Tentar de novo**.
2. **Tocar no centro:** toque na mesa (onde está o anel dourado). Tocar fora avisa e vibra.
3. **Ajustar:** arraste dentro da área para mover; arraste a **alça** (o disco além do lado do oponente) para girar. Há **Girar 90°**, **Trocar lados**, **De que lado você está?** e **Tamanho**.
4. **Confirmar:** a mesa vira uma âncora do ARCore (não escorrega quando você anda) e a área pisca e some.
5. **Jogar:** escolha a carta e toque na mesa: a criatura surge ali, olhando para o outro lado, com sombra e altura pelo poder (PLANO §5.4). Fora da área, a área aparece de relance. **Recalibrar** refaz a mesa sem apagar as criaturas.

Com o rastreamento perdido (câmera coberta, movimento brusco), aparece "Rastreamento perdido" e as criaturas congelam até voltar.

Recursos do WebXR usados: `hit-test` (obrigatório) e, quando o aparelho dá, `dom-overlay`, `anchors`, `plane-detection` e `light-estimation`. Sem os opcionais o modo continua funcionando (sem grade nos planos, mesa sem âncora, luz padrão).

### Checklist no aparelho
- [ ] A barra enche em poucos segundos sobre a mesa (e a grade aparece, se houver detecção de planos).
- [ ] Tocar fora da mesa mostra o aviso e vibra.
- [ ] Tocar na mesa mostra a área com VOCÊ perto do celular e OPONENTE longe.
- [ ] Arrastar a alça gira a área; arrastar dentro dela a move. "Girar 90°", "Trocar lados", os lados e o tamanho funcionam.
- [ ] "Confirmar" faz a área piscar e sumir. Ao andar com o celular, as criaturas ficam no mesmo lugar.
- [ ] Tocar no seu lado invoca a criatura olhando para o oponente; no outro lado, olhando para você.
- [ ] Ao cobrir a câmera, aparece "Rastreamento perdido". Ao descobrir, volta sozinho.
- [ ] Numa mesa lisa e branca, depois de ~15 s aparece "Não encontrei a mesa".

## Mesa com câmera parada (PC, iPhone, Android sem ARCore)

Sem WebXR o app não sabe onde a câmera está. Então a câmera fica **parada** (webcam do PC ou celular num suporte, apontada para a mesa de cima e de lado, como no `docs/PLANO.md` §2) e a mesa é calibrada por um retângulo de tamanho conhecido:

1. Ponha uma **folha A4** no centro da mesa e toque (ou clique) nos **4 cantos** dela, em qualquer ordem. O lado de cima da imagem é o do oponente.
2. O "imã" encaixa cada canto na borda real do papel (precisão abaixo de 1 pixel) e o app calcula a posição da câmera e a abertura da lente. Ele descobre sozinho se a folha está em pé ou deitada.
3. Ajuste como no modo RA: arraste os cantos dourados se algum ficou fora, mova ou gire a área, "Girar 90°", "Trocar lados", lado do jogador e tamanho. **Confirmar** e pode tirar a folha da mesa.
4. Clique na mesa para invocar a criatura escolhida, com sombra e altura pelo poder.

Em **Referência** dá para trocar a folha A4 por folha carta (EUA), **playmat** (61 × 35 cm, o mais preciso) ou uma carta. Uma carta sozinha é pequena demais: um erro de 1 pixel no canto vira dezenas de pixels na borda da área. A folha A4, com o "imã", fica em poucos pixels.

Se a câmera levar um esbarrão (girar ou inclinar ~1–2° ou mais), aparece "A câmera se mexeu": recoloque a folha e toque em **Recalibrar** para marcar os cantos de novo. Mãos, cartas novas e a folha tirada da mesa não disparam o aviso, porque o app compara só as bordas que continuam no lugar. Limitações: mover a câmera de lado mantendo a mira no mesmo ponto passa despercebido, e numa mesa lisa e vazia (sem bordas) o aviso fica desligado.

A matemática fica em `src/table/cameraPose.js` (homografia, focal pelo método de Zhang, pose, "imã", câmera mexida), com testes em `tests/cameraPose.test.js`. O desenho da mesa é o mesmo do modo RA (`src/table/tableVisuals.js`).

## Reconhecimento das cartas na mesa (os dois modos Mesa)

Depois de confirmar a mesa, com **Reconhecer as cartas na mesa** ligado, o app lê as cartas sozinho e a criatura de cada uma surge em pé sobre ela, olhando para onde o topo da carta aponta:

- **carta nova** → a criatura surge; **carta arrastada** → a criatura desliza junto (abaixo de 1,5 cm ou 8° nada muda);
- **carta virada ~90°** → a criatura gira e ataca; desvirada, volta;
- **carta tirada da mesa** → a criatura sai (só depois de não ser vista nem em pé nem virada; carta coberta ou fora da câmera não conta);
- duas cópias da mesma carta em lugares diferentes viram duas criaturas; um nome mal lido em cima de uma carta conhecida é ignorado (só troca se repetir 3 vezes).

Como funciona (`src/table/cardScanner.js`, `tableCards.js`):

1. A área de jogo é dividida em blocos de ~30 × 17 cm: os do seu lado e os do lado do oponente.
2. Cada bloco vira uma **vista de cima** (5 px/mm) refeita a partir da calibração: a perspectiva some, a carta do outro lado da mesa deixa de aparecer achatada e toda carta tem o mesmo tamanho. O "para cima" da vista é o lado para onde o topo das cartas daquele bloco aponta (seu lado, lado do oponente; e, a cada duas voltas, as cartas viradas).
3. **Binarização local** e OCR do nome (o mesmo leitor do campo de batalha). Sem a binarização o Tesseract não lê nada com a mesa escura em volta.
4. O contorno da carta é achado na vista de cima e conferido com 63 × 88 mm (carta na mão de alguém fica de fora). Se o contorno parar na ilustração, a carta é completada pela borda de cima; se não aparecer, um nome lido com certeza dá a posição.

Cada bloco leva ~2–3 s no PC: uma carta do seu lado aparece em poucos segundos, uma do lado do oponente em ~15–20 s, e uma carta virada é percebida em até ~40 s.

**Resolução é o que manda.** O nome tem ~3 mm de altura; o OCR precisa dele com uns 10 px na imagem da câmera. Medido com uma câmera a ~60 cm da mesa e 45° para baixo:

| Câmera | Seu lado | Lado do oponente |
|---|---|---|
| 1080p (webcam comum) | lê | **não lê** (a carta fica com ~110 px de altura) |
| 4K (celular num suporte) | lê | lê |

O modo câmera parada pede 4K à câmera. Se, pela calibração, as cartas do lado de lá ficarem com menos de ~140 px, aparece o aviso para subir ou aproximar a câmera. Câmera mais alta e mais de cima ajuda mais que zoom.

**No modo RA (Android)** a imagem vem da própria sessão de RA pelo recurso `camera-access` do Chrome (a textura da câmera é copiada da GPU em `src/table/xrCameraImage.js`). Se o celular não oferecer esse recurso, a opção aparece desligada com o aviso para usar a Mesa com câmera parada.

Testado com uma webcam sintética (mesa, folha e cartas desenhadas com nome, tipo e texto, em 1080p e 4K) passando pelo OCR real, nos dois modos; no modo RA, também com a imagem chegando por uma textura da GPU como no Chrome. Ainda não testado com cartas e câmeras reais.

## Publicar de graça (Vercel)

O app é publicado na Vercel, com HTTPS de verdade e sem aviso de certificado. A configuração fica em `web/vercel.json` (`npm ci`, `npm run build`, saída em `dist/`). Para publicar, rode `vercel --prod` dentro da pasta `web/`.

Antes de publicar, rode `npm test` e `npm run build` para conferir que está tudo certo.

## Primeiros passos do modo Cartas

1. Baixe as imagens: `python ml/scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" --out ref_images`.
2. Abra `compilar.html` no app, escolha as imagens (o nome do arquivo é o nome da carta) e clique em **Compilar**.
3. Salve `targets.mind` e `targets.json` em `web/public/targets/`.
4. Recarregue o app e aponte a câmera para a carta (na tela ou impressa).

Modelos 3D: coloque `<id>.glb` em `web/public/models/` (veja o `LEIA-ME.md` de lá). Sem eles aparece uma criatura procedural.

## De onde vêm os dados (fonte única)

O web usa o mesmo mapa de modelos e o mesmo formato de catálogo do Unity e do Python:

```
ml/config/model_map.json ──► python tools/sync_web_data.py ──► web/public/data/model_map.json
ml/data/cards.db         ──► export_app_catalog.py --out web/public/data ──► cards.tsv + names.tsv
```

- O web traz o **catálogo completo** do Scryfall: ~35 mil cartas, com ~25 mil nomes em português (~2 MB comprimido).
- O Unity continua com a **amostra** (24 cartas) em `Assets/StreamingAssets/Catalog`, porque os testes EditMode dependem dela.

Para atualizar o catálogo (cartas novas):

```bash
cd ml
python scripts/download_scryfall.py --out data/scryfall --with-all-cards
python scripts/build_card_db.py --oracle data/scryfall/oracle_cards.json --artwork data/scryfall/unique_artwork.json --all-cards data/scryfall/all_cards.json --langs pt --out data/cards.db
python scripts/export_app_catalog.py --db data/cards.db --out ../web/public/data
```

Mudou o `model_map.json`? Rode `npm run sync-data`. O CI confere com `--check`.

## Mapa do código (e o equivalente no Unity)

| Web | Unity (`Assets/_Project/Scripts`) | Python (`ml/`) |
|---|---|---|
| `src/data/textNorm.js` | `Data/TextNormalizer.cs` | `mtgar_data/text_norm.py` |
| `src/data/catalog.js` | `Data/CardCatalog.cs` | `scripts/export_app_catalog.py` (gera) |
| `src/data/modelResolver.js` | `Data/ModelResolver.cs` | `mtgar_data/model_resolver.py` (referência) |
| `src/table/tableFrame.js` | `Table/TableFrame.cs`, `Table/TableCalibrationStateMachine.cs`, `Table/TrackingStatus.cs` (histerese) | — |
| `src/modes/table.js` | `Table/TableCalibrationController.cs`, `PlaneScanVisualizer.cs`, `UI/CalibrationScreenView.cs`, cena `Mesa` | — |
| `src/table/tableVisuals.js` | `Table/TableAreaVisualizer.cs` | — |
| `src/modes/tableCamera.js`, `src/table/cameraPose.js` | — (só na web: Mesa sem ARCore, PLANO §5.2 método 2) | — |
| `src/table/cardScanner.js`, `src/table/tableCards.js`, `src/table/xrCameraImage.js` | — (cartas na mesa: PLANO §4 retificar, §5.2 método 1, §5.3) | — |
| `src/modes/cards.js` | `Phase0/CardCreatureSpawner.cs`, cena `Fase0` | — |
| `src/creatures.js` | `Phase0/CardPrefabLibrary.cs`, `CreatureSpawnFx.cs` | — |

As três implementações do `ModelResolver` precisam decidir igual. Os testes em `tests/data.test.js` repetem os casos de `ml/tests/test_model_resolver.py`.

## Ainda não portado do Unity

Leitura e gerenciamento de decks (`DeckParser.cs`, `DeckStore.cs`), as telas de menu completas (`UI/Screens`), configurações (`AppSettings.cs`) e os estados detalhados do rastreamento (`TrackingStatus*.cs`: pouca luz, movimento rápido; o WebXR só diz se o rastreamento está bom ou perdido). O código C# continua no projeto como referência. Veja `docs/UNITY_ARQUIVO.md`.
