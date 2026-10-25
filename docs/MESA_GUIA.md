# Reconhecimento da mesa: como montar no Unity

**Objetivo:** o app encontra a mesa, você toca no centro, ajusta de que lado está e confirma. A partir daí o app sabe onde fica cada metade da mesa (sua e do oponente), mesmo se o celular se mexer.

**Pré-requisito:** o projeto aberto no Unity, seguindo o `COMECE_AQUI.md` (Unity 6 + URP + AR Foundation + ARKit). A Fase 0 não é obrigatória antes desta.

O fluxo e o visual são os do protótipo (quadro "Calibração e partida"). As cores vêm do quadro "Tokens de design".

---

## O que tem em `Assets/_Project/`

| Arquivo | Para que serve |
|---|---|
| `Scripts/Table/TableFrame.cs` | A "mesa" em matemática pura: centro, frente, lados, altura, ângulo de uma carta. Também será usada no reconhecimento de cartas (Fase 3). |
| `Scripts/Table/TableCalibrationStateMachine.cs` | As etapas da calibração (procurando → tocar no centro → ajustar → confirmada) e as regras de cada uma. |
| `Scripts/Table/TableCalibrationController.cs` | Liga as etapas ao AR: planos detectados, toque na tela, âncora da mesa. |
| `Scripts/Table/TrackingStatus.cs` + `TrackingStatusMonitor.cs` | O chip de status ("Rastreando bem", "Pouca luz"…), sem piscar. |
| `Scripts/Table/TableAreaVisualizer.cs` | Desenha a área de jogo dourada, a linha do meio, a seta e os rótulos VOCÊ/OPONENTE. |
| `Scripts/Table/PlaneScanVisualizer.cs` + `Shaders/RunicGrid.shader` | A grade dourada que aparece na mesa enquanto o app procura. |
| `UI/CalibrationScreen.uxml` + `.uss` + `Theme.uss` | A tela de calibração em UI Toolkit, com as cores do protótipo. |
| `Scripts/Table/UI/CalibrationScreenView.cs` | Liga a tela aos scripts e transforma toques e arrastos em comandos. |
| `Scripts/MtgAr.Runtime.asmdef`, `Tests/EditMode/*` | Assembly do projeto e os testes automáticos (Test Runner). |

---

## 1. Preparar o projeto

1. **Window → TextMeshPro → Import TMP Essential Resources** (para os rótulos VOCÊ/OPONENTE).
2. Confira os pacotes do `COMECE_AQUI.md` §4 (AR Foundation, Apple ARKit XR Plugin, Universal RP, Test Framework). Se aparecer erro de assembly, falta algum deles: o `MtgAr.Runtime.asmdef` depende de todos.
3. A orientação é controlada por cena: o componente **Scene Orientation** (passo 2.5) põe a mesa em paisagem e o menu em retrato.

## 2. Montar a cena `Mesa`

1. Crie uma cena nova (`Assets/_Project/Scenes/Mesa.unity`) e apague a Main Camera.
2. **GameObject → XR → AR Session** e **GameObject → XR → XR Origin (Mobile AR)**.
3. Na **Main Camera** (dentro do XR Origin), no componente **AR Camera Manager**: **Light Estimation → Ambient Intensity**.
4. No **XR Origin**, adicione:
   - **AR Plane Manager**: *Detection Mode* = **Horizontal**. O *Plane Prefab* vem no passo 3.
   - **AR Raycast Manager**
   - **AR Anchor Manager**
   - **Tracking Status Monitor**: *Camera Manager* = o AR Camera Manager da Main Camera.
   - **Table Calibration Controller**: arraste os quatro componentes acima e a Main Camera para os campos.
5. Crie um GameObject vazio `Cena` com **Add Component → Scene Orientation**, *Mode* = **Landscape**.
6. Salve e adicione `Mesa` em **File → Build Profiles → Scene List** (depois de `App`).

## 3. Grade dourada dos planos

1. **Assets → Create → Material**, com o nome `RunicGrid`, e escolha o shader **MtgAr/RunicGrid**.
2. **GameObject → XR → AR Default Plane**:
   - troque o material do **Mesh Renderer** por `RunicGrid`;
   - **remova** o *Line Renderer* (a borda branca padrão);
   - **Add Component → Plane Scan Visualizer**.
3. Arraste o objeto para `Assets/_Project/Prefabs/` (vira o prefab), apague-o da cena e ligue o prefab no *Plane Prefab* do AR Plane Manager.

## 4. Desenho da área de jogo

1. **Assets → Create → Material**, com o nome `LinhaDourada`:
   - shader **Universal Render Pipeline/Particles/Unlit**, que usa a cor de cada vértice, o que o fade precisa;
   - *Surface Type* = **Transparent**;
   - *Render Face* = **Both**.
2. Crie um GameObject vazio, `Área da mesa`, e adicione **Table Area Visualizer**:
   - *Controller* = o XR Origin;
   - *Line Material* = `LinhaDourada`.
3. **Alça de rotação** (opcional):
   - crie um **Cylinder** com escala (0.03, 0.002, 0.03), material dourado e **sem collider**;
   - transforme em prefab e ligue em *Handle Prefab*.
4. **Rótulos:** crie dois **GameObject → 3D Object → Text - TextMeshPro** dentro de `Área da mesa`:
   - textos "VOCÊ" e "OPONENTE", com *Font Size* 0.25, centralizados e na cor dourada (#E6C27A);
   - ligue-os em *Me Label* e *Opponent Label*.

## 5. Tela de calibração (UI Toolkit)

1. **Assets → Create → UI Toolkit → Panel Settings Asset**, com o nome `PainelRA`:
   - *Scale Mode* = **Scale With Screen Size**;
   - *Reference Resolution* = **844 × 390**;
   - *Match* = 0.5;
   - *Clear Color* **desmarcado**, para a câmera aparecer atrás.
2. **GameObject → UI Toolkit → UI Document**:
   - *Panel Settings* = `PainelRA`;
   - *Source Asset* = `CalibrationScreen.uxml`.
3. No mesmo objeto, **Add Component → Calibration Screen View**:
   - *Controller* = o XR Origin;
   - *Tracking Monitor* = o objeto com o Tracking Status Monitor;
   - *Ask Seat* = ligado no modo "No suporte" (pergunta de que lado você está).
4. **Fontes** (opcional agora):
   - baixe **Cinzel** e **Inter** no Google Fonts (licença OFL);
   - clique com o botão direito em cada `.ttf` → **Create → Text → Font Asset**;
   - descomente as linhas `-unity-font-definition` em `Theme.uss` apontando para eles.

## 6. Testar no Editor, sem celular (XR Simulation)

1. **Project Settings → XR Plug-in Management → aba do PC (Standalone)**: marque **XR Simulation**.
2. **Window → XR → AR Foundation → XR Environment**: escolha um ambiente com uma mesa. Se a lista só tiver o padrão, use **Install sample environments**.
3. Dê **Play** e use o botão direito do mouse + WASD para "andar" com a câmera.
   - A grade dourada aparece nos planos.
   - O clique do mouse faz o papel do toque.
4. Rode os testes: **Window → General → Test Runner → EditMode → Run All**. Todos devem passar.

## 7. Testar no celular

Gere o app pela nuvem, como no `IPHONE_GUIA.md`, com `App` e `Mesa` na Scene List. No app: **Jogar → Calibrar a mesa**.

> No iPhone Pro (com LiDAR), o ARKit costuma achar a mesa em cerca de 1 segundo, mesmo lisa.

### Checklist de aceite
- [ ] A grade dourada aparece na mesa em poucos segundos, e a barra de progresso enche.
- [ ] Tocar fora da mesa mostra o aviso "Toque sobre a mesa detectada" e vibra.
- [ ] Tocar na mesa mostra a área com VOCÊ perto do celular e OPONENTE longe.
- [ ] Arrastar a alça gira a área. Arrastar dentro da área a move. "Girar 90°", "Trocar lados" e o slider de tamanho funcionam.
- [ ] Os botões "De que lado você está?" deixam o VOCÊ do lado certo com o celular na lateral da mesa.
- [ ] "Confirmar" faz a área piscar e sumir. Ao andar com o celular, a mesa continua no mesmo lugar.
- [ ] Ao cobrir a câmera com a mão, aparece "Rastreamento perdido". Ao descobrir, volta sozinho.
- [ ] Numa mesa lisa e branca, depois de ~15 s aparece "Não encontrei a mesa" com as dicas.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| A grade nunca aparece | Mesa lisa ou sem luz, ou Detection Mode errado | Use um playmat, acenda a luz e confira *Detection Mode = Horizontal*. |
| A grade aparece rosa | Shader não compilou para o URP | Confira se o projeto usa URP e se o material está com **MtgAr/RunicGrid**. |
| O toque não faz nada | Faltou o *Calibration Screen View* ou o *Panel Settings* | §5. O UI Document precisa cobrir a tela inteira. |
| O toque cai no lugar errado | Panel Settings com escala diferente da tela | Use *Scale With Screen Size*. A conversão painel → tela assume a tela inteira. |
| Linhas da área invisíveis | Material sem cor de vértice ou com *Render Face Front* | §4.1: Particles/Unlit, Transparent, Both. |
| Rótulos VOCÊ/OPONENTE de cabeça para baixo | Lado escolhido errado | Use "Trocar lados" ou os botões de lado. |
| A mesa "escorrega" depois de confirmar | Pouca textura ou movimento brusco | Normal em mesa lisa. Recalibre e use um playmat. |
| Fundo preto | Igual à Fase 0 | AR Background Renderer Feature no URP. |

---

## Como a geometria foi conferida

A matemática da mesa (eixos, lados, ângulo de carta virada, raio da câmera até a mesa) e as regras da calibração têm 28 testes automáticos. Eles foram executados fora do Unity com uma réplica das funções matemáticas do Unity e passaram.

O teste de verdade é rodá-los no **Test Runner** do seu Unity e fazer o checklist no celular.
