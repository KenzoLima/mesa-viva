# Fase 0: guia passo a passo ("Uau" rápido)

**Objetivo:** colocar 5 cartas diferentes na mesa e ver 5 criaturas animadas surgirem em cima delas, no seu iPhone.

**Pré-requisito:** o projeto aberto no Unity, seguindo o `COMECE_AQUI.md` (Unity 6, URP, AR Foundation e ARKit já configurados).

> Esta fase usa o Image Tracking nativo do ARKit. Ele tem limitações conhecidas que **não precisam ser resolvidas agora** (ver o `PLANO.md` §1):
> - só uma criatura por carta igual (duas Florestas = uma criatura);
> - a carta precisa estar relativamente perto da câmera.
>
> A Fase 3 troca isso por visão computacional própria. O objetivo aqui é sentir a experiência e aprender o ciclo de build na nuvem.

---

## 1. O que você precisa

| Item | Observação |
|---|---|
| O projeto aberto no Unity | `COMECE_AQUI.md` |
| A esteira de build do iPhone funcionando | `IPHONE_GUIA.md` (conta Apple Developer + Unity Build Automation) |
| 5 cartas de Magic **diferentes**, de preferência com arte bem colorida e contrastada | Evite terrenos básicos nesta fase |

## 2. Montar a cena `Fase0`

1. **File → New Scene → Basic (URP)** e salve como `Assets/_Project/Scenes/Fase0.unity`.
2. Apague a **Main Camera**.
3. **GameObject → XR → AR Session**.
4. **GameObject → XR → XR Origin (Mobile AR)**. Ele já traz uma câmera com a tag `MainCamera`.

Os scripts desta fase já estão em `Assets/_Project/Scripts/Phase0/`:
- `CardCreatureSpawner.cs` faz surgir e remove as criaturas;
- `CardPrefabLibrary.cs` é a tabela carta → prefab;
- `CreatureSpawnFx.cs` é a animação de "pop" e de flutuação para modelos sem animação.

## 3. Biblioteca de imagens das cartas

1. Consiga a imagem das 5 cartas. Há duas formas:
   - **Foto das suas cartas** (recomendado): carta sobre um fundo liso, foto bem de cima, boa luz e sem reflexo, recortada exatamente na borda da carta.
   - **Imagem do Scryfall**: no terminal, na pasta `ml/`:
     ```bash
     python scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" "Serra Angel" "Goblin Guide" "Grizzly Bears" --out ref_images
     ```
2. Importe as imagens no Unity (`Assets/_Project/RefImages/`).
3. **Assets → Create → XR → Reference Image Library**, com o nome `CardLibrary`.
4. Em **Add Image**, adicione as 5. Para cada uma:
   - **Name:** um nome simples (`llanowar_elves`). Esse nome liga a imagem ao prefab;
   - ✅ **Specify Size:** **0.063 × 0.088** (largura × altura em metros, o tamanho real da carta). **O ARKit exige o tamanho físico**: sem ele a imagem é ignorada.
5. Artes escuras ou lisas são difíceis de reconhecer. Se uma carta não for detectada nunca, troque por outra de arte mais contrastada.

## 4. Modelos 3D de teste (Quaternius)

1. Baixe o pack **Ultimate Monsters** em https://quaternius.com. É gratuito, com licença **CC0**, e os modelos já vêm animados. Use a versão **FBX**.
2. Arraste 5 monstros (`.fbx`) para `Assets/_Project/Models/TestAssets/Quaternius/`. Eles vão para o Git LFS automaticamente (`.gitattributes`).
3. Para cada FBX, no Inspector:
   - aba **Rig** → **Animation Type: Generic** → Apply;
   - aba **Animation** → selecione o clipe de idle (ex.: `Idle`) → ✅ **Loop Time** → Apply.
4. Crie um **Animator Controller** (`Assets → Create → Animator Controller`) por monstro e arraste o clipe de idle para dentro dele, para ele virar o estado padrão (laranja).
5. Arraste o FBX para a cena, coloque o Animator Controller no componente **Animator** e arraste o objeto da cena para `Assets/_Project/Prefabs/`, o que cria o prefab. Depois apague o objeto da cena.
6. Se o modelo ficar **rosa**: **Window → Rendering → Render Pipeline Converter** → converter os materiais.
7. Anote no `docs/CREDITS.md` de onde veio cada modelo.

> Não se preocupe com a escala: o `CardCreatureSpawner` mede o modelo e o ajusta para a altura definida (7 cm por padrão), com os pés apoiados na carta.

## 5. Ligar tudo

1. **Assets → Create → MTG AR → Card Prefab Library**, com o nome `CardPrefabs`.
   - Em **Entries**, adicione 5 itens: **Reference Image Name** = o mesmo nome do passo 3; **Prefab** = o monstro; **Height Meters** = 0.07.
   - **Fallback Prefab:** um cubo (GameObject → 3D Object → Cube, transformado em prefab). Ele aparece para cartas sem prefab e ajuda a descobrir se o problema é a detecção ou o mapeamento.
2. Selecione o **XR Origin** na hierarquia:
   - **Add Component → AR Tracked Image Manager**:
     - **Serialized Library:** `CardLibrary`
     - **Max Number Of Moving Images:** 5
     - **Tracked Image Prefab:** deixe vazio (o spawner cria as criaturas).
   - **Add Component → Card Creature Spawner**: **Library** = `CardPrefabs`.
3. Salve a cena. Para testar só a Fase 0 no iPhone, deixe `Fase0` como a **primeira** cena em **File → Build Profiles → Scene List**.

## 6. Gerar o app e instalar no iPhone

Siga o `IPHONE_GUIA.md`:
1. **commit + push** no GitHub Desktop;
2. **Start build** no Unity Build Automation;
3. quando terminar, abra o **link de instalação** no Safari do iPhone.

Cada rodada leva uns 15–25 minutos, então vale juntar várias mudanças antes de cada build.

## 7. Testar

1. Ambiente **bem iluminado**, cartas sobre uma mesa ou playmat, **sem sleeve brilhante** (ou sem sleeve).
2. Abra o app, aceite o pedido de câmera, aponte para a mesa e mova o celular devagar por 2–3 s.
3. Aproxime-se de uma carta, a uns **25–40 cm**. A criatura deve surgir com o "pop".
4. Repita com as outras 4.

### Checklist de aceite da Fase 0
- [ ] As 5 cartas fazem surgir as 5 criaturas certas.
- [ ] As criaturas ficam "grudadas" na carta ao mover o celular devagar.
- [ ] Mover a carta na mesa faz a criatura acompanhar.
- [ ] O idle está animado (ou flutuando, se o modelo não tiver animação).
- [ ] Você consegue repetir sozinho o ciclo de mudar algo → push → build na nuvem → instalar → testar.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| O app fecha assim que abre | Falta a *Camera Usage Description* | `IPHONE_GUIA.md` §4. É obrigatória no iOS. |
| Fundo preto, sem câmera | Falta o AR Background Renderer Feature no URP | `COMECE_AQUI.md` §5. |
| Nenhuma criatura aparece | Nome diferente entre a Reference Image Library e o CardPrefabs, imagem sem tamanho físico, ou carta longe demais | Ligue o **Fallback Prefab**: se o cubo aparece, o problema é o nome. Se nem o cubo aparece, é a detecção (confira o *Specify Size*). |
| Detecta só de muito perto | Normal no Image Tracking nativo | Limitação conhecida, resolvida na Fase 3. |
| Criatura gigante, minúscula ou enterrada | Prefab sem Renderer visível ou com bounds estranhos | Confira se o prefab tem malha. Ajuste **Height Meters**. |
| Criatura deitada ou de costas | Eixos do modelo diferentes do padrão | Use **Y Rotation Offset** no CardPrefabs. Se estiver deitada, corrija a rotação no prefab. |
| Criatura some ao tirar a câmera da carta | `Hide When Limited` ligado | Desligue no Card Creature Spawner. |
| Duas cartas iguais, uma criatura | Limitação do Image Tracking (1 instância por imagem) | Esperado nesta fase. |
| Modelo rosa | Material não convertido para URP | §4.6 |

---

## Lição de casa que ajuda a Fase 2

Grave com a **câmera normal do iPhone** alguns vídeos de 1–2 min da sua mesa de jogo, do ângulo em que você usaria o app (suporte na lateral, 60–80 cm de altura):
- luz boa e luz ruim;
- com sleeve e sem sleeve, foil e não foil;
- cartas sendo jogadas, viradas, empilhadas e retiradas, e mãos passando por cima.

Esses vídeos viram o material de teste do reconhecimento próprio. Guarde-os fora do Git (pasta `test-videos/`, que o `.gitignore` já ignora) ou num Drive.
