# Magic em RA no estilo Guerra de Cartas — Plano detalhado

## 0. Contexto

O objetivo é um app de celular que, apontado para uma mesa de Magic: The Gathering, reconheça as cartas jogadas e faça surgir modelos 3D animados sobre elas, como no episódio "Guerra de Cartas" de Hora de Aventura. Os terrenos viram o cenário, as criaturas surgem, atacam quando são viradas e somem quando saem da mesa.

Nesta primeira fase, **todos os modelos 3D são assets gratuitos da internet, só para teste**. O sistema precisa ser feito de modo que trocá-los depois seja trivial.

O diretório de trabalho está vazio (projeto do zero). Este documento é o **plano de design e execução**: arquitetura, UX, visão computacional, rastreamento, problemas previstos e soluções, e um roadmap por fases com critérios de aceite.

### Premissas (ajustáveis)
- Desenvolvedor solo ou dupla, ritmo de hobby, uso pessoal e não comercial (Fan Content Policy da Wizards).
- **iPhone primeiro** (atualizado em out/2026): desenvolvimento no Windows, aparelho de teste iPhone 12 Pro ou mais novo (com LiDAR), builds na nuvem pelo Unity Build Automation (ver `IPHONE_GUIA.md`). Android continua possível com o mesmo código.
- **Unity 6 LTS + AR Foundation 6 + URP**. O plugin principal é o Apple ARKit XR Plugin; o ARCore XR Plugin entra se houver versão Android.
- Iteração diária no Editor com XR Simulation e Device Simulator; o iPhone recebe builds agrupados.
- Celulares de 2021 em diante, com suporte a ARKit (A12+) ou ARCore.
- Cartas em inglês **e** português precisam funcionar.

---

## 1. Decisão de arquitetura mais importante (e por quê)

### O problema que mata a abordagem "óbvia"
O **Image Tracking nativo** do ARCore e do ARKit (via `ARTrackedImageManager`) parece perfeito, mas tem limitações graves para Magic:

| Limitação | Impacto no Magic |
|---|---|
| **Só rastreia 1 instância por imagem de referência** | Um deck tem 4 cópias da mesma carta e mais de 20 Florestas iguais. A 2ª Floresta **não aparece**. |
| ARCore rastreia no máximo **cerca de 20 imagens simultâneas** e aceita até 1000 por banco | Não escala para mais de 30 mil cartas, e uma mesa cheia passa de 20. |
| Precisa que a imagem ocupe boa parte do frame para a detecção inicial | Uma carta a 60–80 cm é pequena demais. |
| A moldura das cartas é igual entre elas, e só a arte as diferencia | A nota de qualidade da imagem fica baixa e há confusão entre cartas. |
| Sleeves brilhantes e foils | Os reflexos quebram os pontos de referência (features). |

### A arquitetura escolhida: SLAM do AR Foundation + visão computacional própria
Os papéis ficam separados:

1. **AR Foundation (ARCore/ARKit)** só faz o que faz bem: **saber onde o celular está no espaço** (SLAM), detectar o **plano da mesa**, criar **âncoras**, estimar a luz e calcular a oclusão.
2. **Pipeline próprio de visão**, rodando sobre a imagem da câmera (`XRCpuImage`), faz o resto:
   - **detecta** quantas cartas houver, inclusive cópias repetidas;
   - **retifica** cada carta;
   - **identifica** a carta pela arte;
   - **projeta** a carta no mundo 3D.

Assim o modelo fica preso ao **mundo**, e não à detecção. Se a mão cobre a carta ou ela sai do campo de visão, o modelo continua parado e estável no lugar.

```
 Câmera ──► AR Foundation ──► pose do celular (SLAM), plano da mesa, luz, oclusão
    │
    └─► FrameGrabber (5–10 Hz, thread separada)
           │
           ▼
      CardDetector (rede neural → 4 cantos de cada carta)
           │
           ▼
      CardRectifier (homografia → carta "reta" 488×680)
           │
           ▼
      CardIdentifier (embedding da arte → busca no banco → oracle_id + confiança)
           │
           ▼
      PoseEstimator (cantos → raycast no plano / PnP → posição+rotação no mundo)
           │
           ▼
      CardTracker (associa com cartas já conhecidas, máquina de estados, votação temporal)
           │  eventos: Entrou, Identificada, Virou, Desvirou, Moveu, Saiu(motivo)
           ▼
      GameStateManager (campo de batalha lógico, lado de cada jogador)
           │
           ▼
      Apresentação (modelos, terreno, animações, VFX, sons)  +  UI/HUD
```

A Fase 0 ainda usa Image Tracking nativo, mas só para validar a experiência rapidamente (ver o roadmap).

---

## 2. Uso físico do celular (hardware e montagem)

### Modos de uso
| Modo | Descrição | Prós | Contras |
|---|---|---|---|
| **Mesa (recomendado)** | Celular num **suporte articulado/tripé** na lateral da mesa, a 60–80 cm de altura, inclinado de 45° a 70° para baixo, cobrindo as duas metades. Tela espelhada numa TV (Chromecast/cabo) opcional. | Imagem estável, mãos livres, os dois jogadores veem | Exige um suporte (~R$50–100) |
| **Janela (mão)** | O jogador aponta o celular quando quer ver | Zero setup | Cansa, treme, e as cartas fora da vista não são atualizadas |
| **Dois celulares** | Cada jogador roda o app de forma independente, vendo a mesa do seu ângulo | Não precisa sincronizar nada | Dobra o hardware |

> Decisão: o app suporta os três, porque o pipeline é o mesmo. A UX e os testes priorizam o **modo Mesa**. No início, os modos de dois celulares **não sincronizam** entre si, já que cada um reconhece a mesa sozinho.

### Problemas físicos e soluções
| Problema | Solução |
|---|---|
| **Resolução:** uma carta a 70 cm, com a câmera em 640×480, ocupa uns 50×70 px, pouco demais para reconhecer a arte | Usar uma `XRCameraConfiguration` de **alta resolução** (1920×1440 / 1920×1080). **Detectar** numa versão reduzida (640 px) e **identificar** num recorte da imagem em resolução cheia (a carta fica com ~150×210 px). |
| **Foco:** o ARCore pode usar foco fixo | `ARCameraManager.autoFocusRequested = true`. |
| **Ângulo raso:** as cartas do lado oposto ficam muito em perspectiva | No onboarding, orientar a posicionar o celular **na lateral e no meio** da mesa, mais alto. Um aviso na UI mostra quando as cartas aparecem pequenas ou inclinadas demais. |
| **Pouca luz** em casa (ruído e borrão de movimento) | Usar a estimativa de luz do ARKit/ARCore para detectar ambiente escuro e exibir "Pouca luz: acenda uma luz". Usar augmentation de ruído no treino. |
| **Reflexo de sleeve ou foil** | Recomendar sleeves foscos (aviso no onboarding). Treinar com reflexos sintéticos. Fazer votação temporal, porque o reflexo muda conforme o ângulo. |
| **Mesa lisa sem textura:** o SLAM perde o rastreamento e o plano não é detectado | Recomendar um playmat (que tem textura). Como plano B, estimar o plano **pelas próprias cartas** via PnP (tamanho conhecido de 63×88 mm; ver §5.2). |
| **Bateria e aquecimento** em partidas de 40–60 min | Ver §10 (performance): taxa de inferência adaptativa e recomendação de usar carregador. |

---

## 3. Fluxo do usuário e UI

### 3.1 Mapa de telas
```
[Splash] → [Onboarding (1ª vez)] → [Home]
                                     ├─ Jogar ─► [Setup da Partida] ─► [Calibração da Mesa] ─► [Partida (AR)] ─► [Resumo]
                                     ├─ Meus Decks ─► [Lista] ─► [Importar deck] / [Detalhe do deck] ─► [Ajustar modelo da carta]
                                     ├─ Bestiário (galeria 3D dos modelos de teste)
                                     └─ Configurações (qualidade, sons, debug, créditos/licenças)
```

### 3.2 Onboarding (primeira execução)
1. Pedido de permissão da câmera, com explicação ("o vídeo não sai do seu celular").
2. Três cards ilustrados: "Use um suporte", "Sleeves foscos funcionam melhor", "Boa iluminação".
3. Verificação de compatibilidade com ARCore/ARKit. Se não houver suporte, uma tela explica e oferece o Bestiário.
4. Download do banco de cartas (ver §8), com barra de progresso e opção de usar só Wi-Fi.

### 3.3 Meus Decks
- **Importar**: colar uma lista no formato padrão (`4 Llanowar Elves`, `20 Forest`, `1 Shivan Dragon (DMR) 123`), compatível com o export do Moxfield, Arena e Archidekt.
  - O parser tolera linhas `Deck`, `Sideboard` e `//` e nomes em português (a busca usa `printed_name`).
  - Linhas não reconhecidas ficam marcadas em vermelho, com um campo de busca para corrigir.
- **Detalhe do deck**: a lista de cartas com miniatura, o modelo 3D atribuído (ícone) e a contagem.
  - Tocar numa carta abre um **preview 3D** com a opção "Trocar modelo", que atribui manualmente qualquer modelo do Bestiário.
- **Escanear deck** (opcional, Fase 5): passar as cartas na frente da câmera uma a uma. Isso registra **fotos reais** das suas cópias, o que melhora o reconhecimento (sleeve e foil reais).
- Por que decks importam: o **modo deck** restringe a busca a cerca de 60–100 cartas, em vez de 30 mil. A precisão sobe de ~90% para ~99% e fica mais rápido.

### 3.4 Setup da Partida
- Escolher o **meu deck** e o **deck do oponente** (um deck salvo ou "Desconhecido", que ativa o reconhecimento global, mais lento e menos preciso).
- Escolher o **modo de uso** (Mesa, Janela ou Dois celulares).
- Vida inicial (20/40) e formato (o Commander mostra a zona de comandante).

### 3.5 Calibração da Mesa (cerca de 20 s)
1. "Mova o celular devagar sobre a mesa." O AR Foundation detecta o plano, e uma grade translúcida aparece quando o plano é encontrado.
2. "Coloque **uma carta no centro da mesa**, virada para você." Essa carta define:
   - a **origem** da área de jogo;
   - o **eixo "frente"** (do meu lado para o do oponente), que é a referência para saber se uma carta está virada;
   - a **linha divisória** entre os lados (perpendicular ao eixo, passando pela carta);
   - a **escala real**, que valida o plano porque a carta tem 63×88 mm conhecidos.
3. (Opcional) Marcar as **zonas** tocando na tela: meu cemitério, meu exílio, e os do oponente. Sem marcação, o sistema infere as zonas pelas pilhas de cartas fora do grid de jogo (Fase 4).
4. Fixar o celular no suporte e tocar em "Começar".
- **Problema:** o celular é reposicionado no meio do jogo. **Solução:** um botão "Recalibrar" no HUD. Como as âncoras ficam no mundo, um reposicionamento pequeno não exige recalibrar, porque o SLAM compensa.

### 3.6 HUD da Partida (paisagem, minimalista)
```
┌──────────────────────────────────────────────────────────────┐
│ [♥ Oponente 20  − +]                     [⚙] [⏸ visão] [⏺]   │
│                                                              │
│                (visão AR da mesa com os modelos)             │
│                                                              │
│  status: ● Rastreando bem  /  ⚠ Pouca luz / Mova devagar      │
│ [♥ Eu 20  − +]            [⚔ Combate]           [↺ Desfazer] │
└──────────────────────────────────────────────────────────────┘
```
- **Vida**: botões grandes, com toque longo para ±5. Feedback háptico.
- **Indicadores sobre as cartas** (no mundo, não na tela):
  - carta detectada mas não identificada: **portal de invocação pulsando** (ver o "truque de latência" no §6.4);
  - baixa confiança: um pequeno "?" flutuante. Tocar nele abre uma busca manual;
  - criatura identificada: o modelo, com uma plaquinha opcional de P/T (configurável).
- **Tocar num modelo** abre um painel lateral com a imagem da carta, o texto, o P/T e as ações: *Atacar*, *Morreu*, *Exilar*, *Voltar à mão*, *Trocar identificação*, *Ocultar modelo*. É o **override manual**, a rede de segurança para todo erro do reconhecimento.
- **⚔ Combate**: liga o modo em que criaturas viradas avançam para o lado oposto. Tocar numa criatura do oponente a marca como bloqueadora, e o combate é animado.
- **⏸ Pausar visão**: congela o reconhecimento, útil enquanto alguém embaralha ou mexe muito na mesa. Os modelos ficam.
- **↺ Desfazer**: reverte o último evento automático (por exemplo, uma remoção falsa).
- **⏺ Gravar**: grava um clipe de vídeo da tela.
- **Overlay de debug** (Configurações → Desenvolvedor): caixas de detecção, ID, confiança, estado de cada track, FPS, ms por etapa e temperatura. É **essencial desde o primeiro dia**.
- Acessibilidade: a identidade de cor aparece com **ícones de mana**, não só com cor. Textos com tamanho ajustável.

### 3.7 Resumo da partida
Duração, vencedor (marcado pelo usuário), criaturas invocadas, o clipe gravado e o botão "Jogar de novo" (que mantém a calibração).

---

## 4. Visão computacional: detectar, retificar e identificar

### 4.1 Captura do frame
- `ARCameraManager.TryAcquireLatestCpuImage` → `XRCpuImage.ConvertAsync` para RGB, numa **thread de fundo**.
- Rodar o pipeline a **5–10 Hz**, não a 30/60. O render continua a 30–60 fps porque o modelo está ancorado no mundo.
- Guardar junto do frame: a **pose da câmera** e as **intrínsecas** (`TryGetIntrinsics`) do instante da captura. Sem isso, a projeção no mundo erra quando o celular se move.
- **Abstração `IFrameSource`**, com três implementações: ARCamera, VideoFile e ImageFolder. Permite desenvolver e testar a visão **no Editor do Unity e em Python com vídeos gravados**, sem gerar build para o celular a cada mudança. É o maior ganho de produtividade do projeto.

### 4.2 Detecção das cartas (onde está cada carta)
**Etapa A, para começar rápido:** detecção clássica (OpenCV no Python para protótipo; no Unity, OpenCV for Unity ou porte simples).
- Cinza → blur → Canny → `findContours` → `approxPolyDP` → quadriláteros com proporção ~0,716 (63/88) ou ~1,397 (virada) e área mínima.
- Funciona com cartas **espaçadas sobre um fundo liso contrastante**. Serve para os testes iniciais.
- Falha com: cartas encostadas ou sobrepostas (terrenos em fileira), carta de borda preta em playmat escuro, playmat com bordas retangulares desenhadas, e mãos cobrindo.

**Etapa B, a solução definitiva:** uma rede neural de **caixa orientada (OBB) ou keypoints dos 4 cantos**.
- Modelo pequeno (classe YOLO-OBB "nano" ou keypoint-RCNN leve), entrada de 640 px, exportado para **ONNX** e executado com **Unity Inference Engine (antigo Sentis)** na GPU do celular.
- Classes: `carta_frente`, `carta_verso` (o grimório e as cartas viradas para baixo são ignorados) e talvez `token` depois.
- **Dados de treino sintéticos** (ver §9), que eliminam quase todo o trabalho de anotação manual, mais ~500–1000 fotos reais anotadas no CVAT/Label Studio para ajuste fino e validação.
- ⚠ **Licença:** o Ultralytics (YOLOv8/11) é **AGPL-3.0**. Para uso pessoal está ok. Se um dia for produto, trocar por uma alternativa Apache/MIT (YOLOX, RT-DETR) ou comprar a licença.

**Problemas de detecção e soluções:**
| Problema | Solução |
|---|---|
| Cartas sobrepostas (aura, equipamento, terrenos em leque) | Treinar com sobreposição sintética. Uma carta parcialmente visível mantém a identidade anterior do track e não reidentifica. |
| Falsos positivos (celular, caixa de deck, bloco de vida, dado) | Limiar de confiança + **a identificação precisa achar uma correspondência**; sem match, a detecção é descartada. |
| Cartas na **mão** dos jogadores, perto da câmera | Descartar as que não estão sobre o plano da mesa: altura > 2 cm via PnP (§5.2). |
| Carta de cabeça para baixo (lado do oponente) | A OBB dá a orientação a menos de 180°. Identificar nas duas rotações (0° e 180°) e ficar com a melhor, ou usar a posição da caixa de texto como pista. |
| Pilhas (cemitério, grimório) | O verso vira "grimório" e é ignorado. Uma pilha virada para cima só tem a carta do topo visível, tratada como uma carta numa zona (§6.6). |

### 4.3 Retificação
- Com os 4 cantos, calcular a **homografia** (DLT de 4 pontos, uma conta pequena feita à mão em C#) e aplicar o *warp* na **GPU** (shader com `Graphics.Blit` + a matriz). O recorte vem da imagem em **resolução cheia**.
- Saída: carta reta de 488×680 (o mesmo tamanho "normal" do Scryfall), mais um recorte padronizado só da **arte**.
- **Problema:** cartas *borderless*, *full-art* e *showcase* têm a arte em lugares diferentes. **Solução:** gerar **dois embeddings** (carta inteira e região da arte) e combinar as similaridades. O treino inclui todos os tipos de moldura.

### 4.4 Identificação (qual carta é)
**Abordagem principal: embedding visual + vizinho mais próximo.**
- Uma rede leve (MobileNetV3/EfficientNet-Lite, ~1–3M parâmetros) transforma a imagem num vetor de 256 dimensões.
- O índice é pré-calculado a partir das imagens do Scryfall (bulk `unique_artwork`, cerca de 40–50 mil artes). Ocupa uns 25 MB em float16 e fica dentro do app ou no download inicial.
- Busca: produto escalar contra o índice.
  - Modo deck: ~100 vetores, instantâneo.
  - Modo global: 50 mil × 256 = ~13M operações, ~5–10 ms no celular, sem precisar de biblioteca de ANN.
- **Por que pela arte e não por OCR do nome:** a arte **não depende do idioma**. Uma carta em português e outra em inglês têm a mesma arte, e a busca devolve o `oracle_id`. Várias impressões da mesma carta mapeiam para o mesmo `oracle_id` e, portanto, para o mesmo modelo.
- **Bootstrap sem treino:** a primeira versão pode usar um extrator pronto (DINOv2-small ou CLIP ViT-B/32), mais pesado (~30–60 ms), que só roda em cartas *novas*. Depois, **treinar o modelo próprio com metric learning** (ArcFace/triplet) sobre augmentations do Scryfall (perspectiva, reflexo, ruído, cor), para fechar a diferença entre a imagem do scan e a foto real.
- **OCR como plano B (Fase 5):** o ML Kit (Android) e o Vision (iOS) leem o nome quando o embedding fica em dúvida entre dois candidatos. Ajuda muito em reimpressões com artes parecidas.

**Problemas de identificação e soluções:**
| Problema | Solução |
|---|---|
| Diferença entre domínios: scan perfeito vs. foto com sleeve, perspectiva e luz amarela | Treino com augmentations pesadas. Fotos reais do "Escanear deck" entram no índice como exemplos extras daquela carta. |
| Cartas com arte quase igual (Terrenos Básicos de um mesmo set, reimpressões) | Não importa se tudo leva ao mesmo `oracle_id`. Para básicos, basta saber o **tipo** (Floresta/Ilha…). |
| Cartas de duas faces (DFC) e tokens | Indexar **cada face** e os **tokens** do Scryfall como entradas próprias. A face visível define o modelo. |
| Confiança baixa ou ambiguidade | **Votação temporal**: confirmar só quando os últimos N quadros concordam (por exemplo, 3 de 5) com margem entre o 1º e o 2º candidato. Até lá, o portal de invocação continua girando. |
| Carta fora do deck registrado (o oponente "Desconhecido" ou uma carta emprestada) | Se o melhor match no deck for fraco, cair para a busca global. |
| Cartas novas lançadas após o download | Atualização incremental do banco a cada set (§8). |
| Proxies e cartas alteradas (arte pintada) | Fora de escopo. A busca manual pelo menu de override resolve. |

---

## 5. Posicionamento no mundo e estabilidade dos modelos

### 5.1 Plano da mesa
- O `ARPlaneManager` detecta planos horizontais. Usar o maior plano horizontal sob a área calibrada como **"plano da mesa"** e travá-lo depois da calibração (planos detectados mudam de tamanho e de altura com o tempo).
- Criar uma **âncora mestre** (`ARAnchorManager`) na origem calibrada. Todas as cartas ficam como filhas lógicas dela.

### 5.2 De cantos na imagem para posição 3D
- **Método 1 (principal):** projetar os 4 cantos com raycast da câmera, usando a pose do frame, até o plano da mesa. O resultado são 4 pontos 3D, de onde saem o centro, a orientação (yaw) e o tamanho.
- **Método 2 (validação e plano B):** **PnP** (`solvePnP`) com o tamanho conhecido da carta (63×88 mm) e as intrínsecas da câmera dá a pose completa da carta, sem depender do plano.
  - Serve para **validar**: se o tamanho medido pelo método 1 não bate com 63×88 mm (±15%), o plano está errado ou a carta está na mão de alguém e não na mesa.
  - Serve para **estimar o plano** quando o ARCore não acha nenhum (mesa lisa): a mediana das poses de várias cartas define o plano.

### 5.3 Estabilidade (sem tremer)
| Problema | Solução |
|---|---|
| **Tremor (jitter):** cada detecção dá uma posição levemente diferente | Filtro **One Euro** na posição e no yaw, mais uma **zona morta**: só mover o modelo se o deslocamento for > 1,5 cm ou > 8°. Abaixo disso, a carta "não se moveu". |
| **Atraso do pipeline:** a detecção roda a 5–10 Hz e com dezenas de ms de latência | O modelo não depende do frame atual: fica ancorado no mundo e o SLAM mantém tudo estável a 60 fps. A posição só é corrigida quando a carta realmente se move. |
| **Drift do SLAM** ao longo de 40 min | Âncoras do ARCore/ARKit se corrigem sozinhas. As detecções periódicas também "reancoram" as cartas visíveis. Se o drift passar de 3 cm, sugerir "Recalibrar". |
| **Perda de rastreamento** (celular coberto, movimento brusco) | Ao receber `ARSession.state`/`trackingState` limitado: congelar os modelos, mostrar "Rastreamento perdido: aponte para a mesa" e **não** gerar eventos de "carta saiu" enquanto isso durar. |
| **Relocalização** depois de perder | Ao voltar, revalidar as posições com as próximas detecções antes de liberar eventos. Se as posições divergirem muito, sugerir recalibração. |

### 5.4 Realismo visual (o modelo "pertencer" à mesa)
- **Sombras:** um plano invisível *shadow catcher* sobre a mesa recebe as sombras dos modelos. É o maior ganho de realismo por esforço.
- **Iluminação:** a estimativa de luz do AR Foundation (intensidade e cor, e no ARKit também a direção) ajusta a luz da cena.
- **Oclusão por mãos:** ativar o `AROcclusionManager` (profundidade do ambiente no ARCore Depth API e segmentação de pessoas no iOS) quando disponível. Sem isso, o modelo é desenhado **por cima da mão**, o que é estranho mas aceitável no MVP.
- **Escala:** a carta tem 8,8 cm, e um modelo desse tamanho a 70 cm parece pequeno.
  - Altura base de 6–8 cm, multiplicada por um fator de **poder** (1 → 0,8×; 7+ → 1,6×).
  - Um slider "Modo épico" nas configurações aumenta tudo.
  - **Limitar a escala** pela distância até as cartas vizinhas, para os modelos não se atravessarem.
- **Orientação:** as criaturas olham para o lado do oponente (eixo calibrado) e podem girar levemente de forma aleatória para parecer naturais.

---

## 6. Rastreamento e ciclo de vida de cada carta

### 6.1 Associação: "esta detecção é qual carta?"
- Cada carta conhecida é um **track** com posição no mundo, identidade, estado e histórico.
- A cada frame do pipeline, as detecções (já em coordenadas de mundo) são associadas aos tracks por **distância no mundo** (raio de ~4 cm), com o **algoritmo húngaro** para resolver conflitos.
- Associar no **mundo**, e não na imagem, torna o sistema imune ao movimento do celular.
- Cópias idênticas (4 Elfos de Llanowar) não confundem: cada uma tem o **seu track pela posição**.

### 6.2 Máquina de estados do track
```
          detecção nova sem track
                   │
                   ▼
            ┌─ CANDIDATO ──(some < 0,5 s sem confirmar)──► descartado (ruído)
            │      │ 3 detecções estáveis
            │      ▼
            │  IDENTIFICANDO ──(portal de invocação na tela)
            │      │ votação confirma identidade
            │      ▼
            │  ATIVO ◄──────────────────────────┐
            │   │  │ ↕ VIRADA/DESVIRADA (yaw)   │ reapareceu
            │   │  └──► NÃO VISTO ──────────────┘
            │   │        │ (decide pelo motivo — §6.3)
            │   │        ▼
            │   │    SAINDO (pendente, 1,5 s) ──► REMOVIDO (morreu / exilado / saiu)
            │   │        │ a mesma identidade apareceu em outro lugar do campo
            │   │        ▼
            │   └──► MOVIDO (anima o deslocamento)
```

### 6.3 "A carta saiu da mesa?" (o ponto mais delicado)
Ao **não detectar** uma carta, existem quatro situações muito diferentes. A carta só pode ser removida na última:

| Situação | Como reconhecer | Ação |
|---|---|---|
| **Fora do campo de visão** | Projetar a posição 3D do track na câmera atual: está fora do frustum ou longe demais/em ângulo ruim | **Manter** o modelo (opcional: deixá-lo semitransparente, como um "fantasma"). Nada de remover. |
| **Rastreamento do AR perdido** | `trackingState != Tracking` | Congelar tudo e ignorar ausências. |
| **Coberta (mão, dado, outra carta)** | Está no campo de visão, mas a região está "ocupada": há **pixels de pele/mão** (segmentação de mão ou profundidade mais próxima que a mesa, quando disponível), **outra detecção** se sobrepõe, ou o conteúdo da região ainda se parece com a carta (comparação rápida de histograma com a última aparência). | **Manter** e esperar, com um *timeout* longo (~10 s). Depois disso, perguntar via um "?" sobre o modelo em vez de remover sozinho. |
| **Realmente saiu** | Visível, região **limpa** (parecida com a textura da mesa capturada na calibração ou num frame anterior sem a carta) e **sem detecção por ≥1,5 s** em vários frames | Entra em **SAINDO**. |

Na fase **SAINDO** (janela de 1,5–2 s), o sistema decide o motivo:
- a mesma identidade apareceu na **zona de cemitério** → **morreu** (animação de morte);
- apareceu na **zona de exílio** → **exilada** (dissolve em luz);
- apareceu **em outro ponto do campo** → **movida** (a criatura anda até lá);
- não apareceu em lugar nenhum → **saiu** (animação neutra de "poof"). Pode ter voltado para a mão ou o grimório.

**Rede de segurança:**
- ↺ **Desfazer** no HUD reverte uma remoção falsa.
- Se uma carta removida reaparece **no mesmo lugar** em < 5 s, ela é restaurada automaticamente sem nova animação de invocação, porque foi um falso negativo.
- Os limiares (1,5 s, 4 cm etc.) ficam todos num **ScriptableObject de configuração**, ajustáveis no menu de debug sem recompilar.

### 6.4 O truque da latência (portal de invocação)
A identificação leva de 0,3 a 1,5 s. Em vez de esconder esse atraso, ele vira parte da experiência:
1. Assim que a carta é **detectada** (antes de ser identificada), um **portal/círculo mágico** aparece sobre ela, na cor neutra.
2. Quando a identidade é confirmada, o portal assume a **cor da carta** e a criatura **surge de dentro dele**.

O tempo de reconhecimento passa a parecer "o tempo da invocação". No episódio também há esse momento dramático.

### 6.5 Virar e desvirar (tap/untap)
- yaw relativo = ângulo entre o eixo longo da carta e o eixo "frente" calibrado (com o sinal do lado do jogador).
- **Histerese:** passa a "virada" se > 60°, volta a "desvirada" se < 30°. Isso evita ficar alternando com cartas tortas.
- Também exige 2–3 frames consistentes.
- Eventos: `Virou`, que no modo combate significa ataque e fora dele mostra a criatura agachada, cansada ou "usada". `Desvirou` faz a criatura se espreguiçar e voltar ao idle.
- Terrenos virados mostram uma pequena partícula de mana subindo, na cor do terreno.

### 6.6 Zonas e lados
- **Dono da carta:** o lado da linha divisória em que ela está.
- **Zonas** (cemitério e exílio): retângulos marcados na calibração ou inferidos (uma pilha de cartas para cima fora do grid principal, perto da borda).
  - A carta do topo de uma pilha do cemitério **não** gera um modelo no campo, só eventos de zona.
- **Grimório:** a classe `carta_verso` é ignorada.
- **Cartas empilhadas em cima de outras** (aura e equipamento parcialmente por cima): a carta de baixo mantém o track e vira a "portadora". A de cima vira um **anexo**, mostrado como acessório ou aura visual.

---

## 7. Mapeamento de jogo para apresentação

### 7.1 Eventos → efeitos
| Evento | Criatura | Terreno | Outros permanentes |
|---|---|---|---|
| Entrou | Portal → surge (animação *Spawn*) | Um "patch" de bioma cresce ao redor da carta | Um prop surge (cristal, totem, estandarte) |
| Virou | Postura de ataque/cansada (ou avança no modo combate) | Partícula de mana | Brilho |
| Desvirou | Volta ao idle | — | — |
| Morreu | Animação *Death* + dissolve | — | Quebra/estilhaça |
| Exilada | Dissolve em luz branca | Some | Some |
| Saiu (neutro) | "Poof" de fumaça | Encolhe | "Poof" |
| Movida | Anda/voa até o novo ponto | Patch se desloca | Desliza |

### 7.2 Terreno e cenário (o mais "Guerra de Cartas")
- Cada terreno cria um **patch** de terreno de ~12×15 cm centrado na carta (sem cobrir a carta, só ao redor dela ou com transparência sobre ela):
  - Floresta → grama e arbustos
  - Ilha → água com ondas (shader)
  - Montanha → rochas
  - Pântano → lama e névoa
  - Planície → campo dourado
  - Terrenos não básicos → mistura pelas **cores de mana que produzem** (campo `produced_mana` do Scryfall)
- Patches vizinhos **se fundem** (um shader de terreno baseado em máscara/vertex color ou decals projetados). O lado de cada jogador ganha uma "paisagem" dominante conforme os terrenos dele.
- **Problema:** muitos patches pesam no celular. **Solução:** um único mesh de terreno por lado (grid low-poly), cujas cores e texturas são **pintadas** pelos terrenos detectados, em vez de um objeto por terreno.

### 7.3 Combate
- Botão ⚔ ativa o modo combate. Criaturas **viradas** do jogador ativo avançam até a linha divisória.
- Tocar numa criatura do oponente e depois num atacante cria o **bloqueio**: as duas se enfrentam (*Attack* ↔ *Hit*).
- O resultado (quem morre) vem das cartas reais: quando uma carta vai para o cemitério, a animação de morte toca. O app **não calcula regras**, só **reflete a mesa**. Isso evita implementar o motor de regras do Magic, que é enorme e fora de escopo.

### 7.4 Feitiços e mágicas instantâneas
Se uma mágica instantânea ou um feitiço for detectado sobre a mesa (os jogadores costumam mostrá-los ao conjurar), toca um **VFX por cor** (vermelho: bola de fogo; azul: espiral arcana; preto: sombra; branco: luz; verde: vinhas) e a carta é ignorada até sair.

---

## 8. Dados de cartas (Scryfall)

- **Fonte:** API do Scryfall, via **bulk data** (`default_cards` para os dados, `unique_artwork` para as imagens a indexar) e as imagens de tokens.
  - Regras de uso: enviar `User-Agent` e `Accept`, respeitar ~10 req/s, cachear localmente e não usar a API como CDN de imagens dentro do app.
- **Pré-processamento offline (script Python, roda no PC):**
  1. baixa o bulk e as imagens (com rate limit e retomada);
  2. gera o **SQLite** `cards.db` com `oracle_id`, `name`, `printed_name` (pt), `type_line`, `subtypes`, `colors`, `color_identity`, `power`, `toughness`, `keywords`, `produced_mana`, `layout` e as faces;
  3. gera os **embeddings** (`embeddings.f16.bin` + `ids.json`), mapeando cada arte/face para um `oracle_id`;
  4. publica um pacote versionado (`v2026.10.0`) num host estático (GitHub Releases).
- **No app:** baixa o pacote na primeira execução (~40–60 MB) e depois só **atualizações incrementais** por set, conferindo a versão ao abrir.
- **Problema:** o download inicial é grande no plano de dados móveis. **Solução:** oferecer "Só os meus decks" (baixa apenas as cartas dos decks importados, poucos MB) e o pacote completo como opcional no Wi-Fi.
- **Imagens das cartas para a UI** (painel de detalhe): carregar sob demanda do Scryfall e guardar em cache em disco.

---

## 9. Modelos 3D de teste

### 9.1 Fontes (gratuitas, com licença clara)
| Fonte | O que tem | Licença |
|---|---|---|
| **Quaternius** (Ultimate Monsters, Animated Animals, RPG Characters) | Monstros low-poly **já animados** (Idle/Walk/Attack/Death) | **CC0**, ideal para teste |
| **KayKit** (Adventurers, Skeletons, Dungeon) | Personagens e esqueletos animados | CC0 |
| **Kenney** | Props, natureza e terreno | CC0 |
| **Poly Pizza** | Milhares de modelos low-poly | CC0 / CC-BY (conferir cada um) |
| **Mixamo** | Humanoides + **animações** aplicáveis a qualquer humanoide | Gratuito para usar em projetos (não redistribuir os arquivos crus) |
| **Sketchfab** (filtro "Downloadable") | Dragões, criaturas de fantasia de alta qualidade | Varia: CC-BY, CC-BY-NC… **conferir cada um** |
| **Unity Asset Store** (packs grátis, ex.: "RPG Monster Duo PBR Polyart") | Monstros animados prontos para Unity | Asset Store EULA |

- Manter um `CREDITS.md`, e a tela de créditos no app, com **fonte, autor e licença de cada asset**.
- Guardar os assets de teste numa pasta isolada (`Assets/_Project/Models/TestAssets/`) para facilitar a troca futura.
- Evitar CC-BY-NC se houver qualquer chance de uso comercial.

### 9.2 Padronização (o "contrato" de um modelo)
Todo modelo vira um **prefab de criatura** com:
- **pivot nos pés**, centrado e com a frente no eixo +Z;
- altura normalizada (bounding box → 1 unidade; o script aplica a escala final);
- **orçamento:** ≤ 15k triângulos, ≤ 2 materiais, texturas ≤ 1024², shader URP Lit/Simple Lit;
- **Animator Override Controller** sobre um controlador base com os estados: `Spawn`, `Idle`, `Attack`, `Hit`, `Tapped`, `Death`, `Walk`.
- **Fallback procedural** quando o modelo não tem alguma animação (muito comum nos assets grátis):
  - Spawn: escala de 0 → 1 com *overshoot*;
  - Idle: leve flutuação e respiração;
  - Attack: investida (tween para frente e de volta);
  - Death: shader de dissolve;
  - Tapped: inclinar 15° e agachar.

  Assim **qualquer modelo estático** já funciona.
- Ferramenta no Editor (`CreatureImporter`): arrastar um FBX/GLB e gerar automaticamente o prefab padronizado (pivot, escala, controller e colisor de toque).
- Formatos: FBX/GLB importados no projeto. Carregamento em runtime (glTFast + Addressables) fica para depois, quando os modelos forem baixáveis.

### 9.3 Qual modelo cada carta usa (`ModelResolver`)
Ordem de prioridade:
1. **Override do usuário** para aquela carta (definido em Meus Decks).
2. **Override por `oracle_id`** no arquivo de mapeamento (cartas "hero").
3. **Subtipo de criatura** do `type_line`: `Goblin` → goblin, `Dragon` → dragão, `Elf` → elfo, `Zombie`/`Skeleton` → morto-vivo, `Angel` → anjo, `Beast`/`Wolf`/`Cat` → animal…
4. **Palavras-chave e tipo genérico:** `Flying` sem subtipo mapeado → criatura alada genérica; `Artifact Creature` → golem.
5. **Fallback por cor:** um "elemental" genérico tingido com a cor da carta.

Variação procedural sobre o modelo: **tint pela cor**, **escala pelo poder** e **partículas por keyword** (Voar = flutua e bate asas; Atropelar = poeira; Toque Mortífero = névoa verde; Iniciativa = faíscas).

Arquivo `model_map.json` (editável sem recompilar):
```json
{
  "bySubtype": { "Goblin": "goblin_quaternius", "Dragon": "dragon_sketchfab_01", "Elf": "elf_mixamo" },
  "byOracleId": { "<oracle_id do Shivan Dragon>": "dragon_red_hero" },
  "byKeyword": { "Flying": "winged_generic" },
  "byColorFallback": { "W": "elemental", "U": "elemental", "B": "elemental", "R": "elemental", "G": "elemental", "C": "golem" },
  "landTerrain": { "W": "plains", "U": "water", "B": "swamp", "R": "mountain", "G": "forest" }
}
```
- **Problema:** criaturas com vários subtipos (`Elf Druid`, `Human Wizard`). **Solução:** o primeiro subtipo encontrado numa lista de prioridade (raças antes de classes) vence. Classes como `Wizard`/`Warrior` podem só adicionar um **acessório** (cajado, espada) se o modelo tiver um ponto de encaixe.
- **Problema:** existem mais de 300 subtipos de criatura e uns 30 modelos de teste. **Solução:** uma tabela de **sinônimos/famílias** (Wolf/Hound/Dog → canino; Horror/Nightmare → horror), com o fallback por cor cobrindo o resto.

---

## 10. Performance, bateria e aquecimento

Orçamento por frame do pipeline, em celular intermediário, rodando a 5–10 Hz:

| Etapa | Alvo |
|---|---|
| Conversão do frame | ~5 ms |
| Detector | ~15–25 ms (GPU) |
| Retificação + embedding (só de cartas novas ou em dúvida) | ~10 ms cada |

Render: 30 fps garantidos, 60 se possível.

| Problema | Solução |
|---|---|
| Aquecimento (*thermal throttling*) em 10–15 min | **Taxa adaptativa:** se nenhuma carta se moveu nos últimos segundos, cair o detector para 2 Hz e voltar a 8 Hz ao detectar movimento (diferença de imagem barata). Ler o estado térmico (Android `PowerManager` / iOS `thermalState`) e reduzir a qualidade gráfica automaticamente. |
| Identificação cara | **Só identificar tracks novos ou em dúvida.** Uma carta confirmada não é reidentificada enquanto o track estiver vivo, exceto por uma checagem leve de vez em quando. |
| Muitos modelos na mesa (20+) | LOD, GPU instancing para terreno e partículas, limite de partículas e de sombras (sombra só dos 10 maiores, por exemplo). |
| Bateria | Recomendar o carregador no onboarding. Opção "Economia" (30 fps, sem oclusão de profundidade, menos partículas). |
| Memória (modelos + índice) | O índice em float16 e o modo deck carregam só os vetores relevantes. Os modelos são carregados sob demanda (Addressables) na versão futura. |

---

## 11. Pipeline de ML offline (Python)

1. **Gerador sintético de cenas** (`ml/synth/`):
   - fundos: fotos de playmats e mesas (fotografadas por você mais texturas CC0);
   - cartas do Scryfall coladas com perspectiva aleatória, rotação (incluindo 90° e 180°), sobreposição, leques e pilhas;
   - "sleeves": borda colorida + camada brilhante; **reflexos** (gradientes e manchas), sombras, borrão de movimento, ruído, compressão JPEG e variação de cor e temperatura;
   - **mãos** como oclusores (recortes de datasets de mãos, ex.: EgoHands);
   - saída: imagens + anotação OBB/cantos automática (perfeita, já que foi gerada).
2. **Fotos reais:** gravar vídeos da sua mesa com o próprio app (Fase 2) e anotar ~500–1000 frames no CVAT. Usar para **ajuste fino e validação**, nunca só sintético.
3. **Detector:** treinar o modelo OBB/keypoints e exportar para ONNX. Validar a recall de cartas e o erro dos cantos em pixels.
4. **Embedding:** treinar com ArcFace/triplet (cada arte é uma classe) usando augmentations fortes e exportar para ONNX. Validar com **top-1 em fotos reais** nos modos deck e global.
5. **Gerar o índice** (`build_index.py`) e o pacote de dados (§8).
6. Testar os ONNX no **Unity Inference Engine** no Editor e no celular, verificando os operadores suportados e a latência.

---

## 12. Estrutura do repositório

```
mtg-ar/
├─ unity-app/                         # projeto Unity 6 (URP)
│  └─ Assets/_Project/
│     ├─ Scripts/
│     │  ├─ AR/            (ARSessionController, TableCalibration, FrameGrabber)
│     │  ├─ Vision/        (IFrameSource, CardDetector, CardRectifier, CardIdentifier, Homography)
│     │  ├─ Tracking/      (CardTracker, CardTrack, TrackStateMachine, OneEuroFilter, HungarianMatcher)
│     │  ├─ Game/          (GameStateManager, Zones, PlayerSide, GameEvents)
│     │  ├─ Presentation/  (ModelResolver, CreatureController, TerrainPainter, VfxLibrary, SummonPortal)
│     │  ├─ UI/            (telas: Onboarding, Home, Decks, Setup, Calibration, HUD, CardPanel, Summary)
│     │  ├─ Data/          (CardDatabase/SQLite, DeckParser, DeckRepository, DataPackageUpdater)
│     │  └─ DebugTools/    (DebugOverlay, SessionRecorder, TuningConfig ScriptableObject)
│     ├─ Models/TestAssets/ (Quaternius, KayKit, Mixamo… + licenças)
│     ├─ Prefabs/ Shaders/ (dissolve, terrain blend, shadow catcher)  VFX/  Audio/
│     ├─ Config/  (model_map.json, TuningConfig.asset)
│     └─ Scenes/  (Boot, Menu, ARGame, Bestiary, VisionSandbox ← testa visão com vídeos no Editor)
├─ ml/                                # Python
│  ├─ data/        (download_scryfall.py, build_card_db.py, build_index.py)
│  ├─ synth/       (gerador de cenas sintéticas)
│  ├─ train/       (detector, embedding)
│  └─ eval/        (avaliação em vídeos gravados)
├─ test-videos/   (gravações reais da mesa + gabarito de eventos)
└─ docs/          (este plano, CREDITS.md, decisões)
```

---

## 13. Roadmap por fases (entregáveis e critérios de aceite)

### Fase 0 — "Uau" rápido (1–2 semanas)
- Instalar Unity 6 LTS, URP, AR Foundation e ARCore, e gerar o build de um app vazio no celular Android (modo desenvolvedor + USB).
- Cena com `ARTrackedImageManager` e uma **biblioteca de 5 cartas diferentes** (sem cópias).
- Ao detectar uma carta, instanciar um monstro do **Quaternius** com Idle e Spawn.
- **Aceite:** 5 cartas na mesa → 5 criaturas animadas por cima, com o celular na mão.
- **Objetivo real:** aprender o ciclo de build e sentir a experiência. As limitações conhecidas (sem cópias e com distância curta) já estão documentadas no §1.

### Fase 1 — Dados, decks e bestiário (2–3 semanas, sem RA)
- Scripts Python: Scryfall → `cards.db`.
- No app: importar uma lista de deck, mostrar as cartas, rodar o `ModelResolver` e o `model_map.json`, e abrir o **Bestiário** (visualizar e girar os modelos de teste).
- `CreatureImporter` + prefabs padronizados + fallback de animação procedural.
- **Aceite:** colar um deck real → cada carta mostra o modelo atribuído, e é possível trocá-lo.

### Fase 2 — Visão no laboratório (3–5 semanas)
- `IFrameSource` + gravação de vídeos da mesa com o celular, mais o gabarito do que aconteceu em cada vídeo.
- Detecção **clássica** (Etapa A) + retificação + identificação com **extrator pronto** (DINOv2/CLIP) em **modo deck**.
- Desenvolvimento em Python com os vídeos e depois o porte para a cena `VisionSandbox` no Editor do Unity.
- Começar o gerador sintético e treinar o **detector neural** (Etapa B).
- **Aceite (com os vídeos gravados):** ≥95% das cartas detectadas e ≥95% identificadas corretamente em até 2 s, no modo deck.

### Fase 3 — Pipeline no celular + mundo + rastreamento (3–5 semanas)
- Trocar o Image Tracking pelo pipeline próprio.
- Calibração da mesa, raycast/PnP, âncoras, `CardTracker` com a máquina de estados, filtros, virar/desvirar e a lógica de "saiu da mesa" com oclusão e visibilidade.
- Overlay de debug completo e **ScriptableObject de tuning**.
- **Aceite (partida real de 20 min):**
  - cópias repetidas funcionam;
  - tremor menor que 3 mm;
  - no máximo 1 remoção falsa por partida;
  - tap/untap detectado em < 1 s;
  - mão sobre a carta não a remove.

### Fase 4 — Experiência de jogo (3–4 semanas)
- HUD completo (vida, combate, desfazer, pausar, gravar), painel da carta com overrides.
- Portal de invocação, terreno pintado por bioma, combate animado, zonas de cemitério e exílio, VFX de mágicas, sombras, luz estimada e sons.
- **Aceite:** partida completa jogada com amigos usando só o app como "mesa mágica". Todos os erros foram corrigíveis pelos overrides.

### Fase 5 — Robustez (contínuo)
- Embedding **treinado** (metric learning), modo global ("oponente desconhecido"), OCR como desempate, "Escanear deck", tokens e DFC.
- Taxa adaptativa e gestão térmica, oclusão por profundidade, modo economia.
- iOS (precisa de Mac + Xcode; conta Apple Developer para distribuição).
- **Aceite:** modo global com ≥90% de top-1; 45 min de partida sem throttling grave.

### Fase 6 — Futuro
Modelos próprios ou gerados (imagem → 3D com limpeza), sincronização entre dois celulares (vida e overrides), espelhamento na TV, headset (Quest 3 com acesso à câmera).

---

## 14. Catálogo consolidado de riscos

| # | Risco | Prob. | Impacto | Mitigação principal |
|---|---|---|---|---|
| 1 | Image tracking nativo não suporta cópias nem escala | Certa | Alto | Pipeline próprio (§1). Image tracking só na Fase 0. |
| 2 | Cartas pequenas demais na imagem | Alta | Alto | Câmera em alta resolução + recorte em resolução cheia + orientação de montagem (§2). |
| 3 | Reflexo de sleeves e foils | Alta | Médio | Sleeves foscos, augmentations, votação temporal. |
| 4 | Diferença entre scan e foto real | Alta | Alto | Metric learning com augmentations + fotos reais no índice. |
| 5 | Remoção falsa (mão, sombra, oclusão) | Alta | Alto | Visibilidade + oclusão + janela SAINDO + desfazer + restauração automática (§6.3). |
| 6 | Tremor dos modelos | Média | Médio | Âncoras no mundo + One Euro + zona morta (§5.3). |
| 7 | Mesa lisa sem plano detectado | Média | Alto | Playmat + plano estimado por PnP das cartas. |
| 8 | Aquecimento e bateria | Alta | Médio | Taxa adaptativa, identificar só cartas novas, modo economia. |
| 9 | Latência de identificação | Certa | Médio | Portal de invocação mascara a espera (§6.4). |
| 10 | Assets grátis inconsistentes (escala, pivot, sem animações) | Certa | Médio | `CreatureImporter` + fallback procedural (§9.2). |
| 11 | Licenças (Wizards, assets, AGPL do YOLO) | Média | Médio/Alto se comercial | Não comercial, `CREDITS.md`, alternativas Apache/MIT. |
| 12 | Cartas em português | Média | Médio | Identificação pela arte (independe do idioma) + `printed_name`. |
| 13 | Cartas novas fora do banco | Certa | Baixo | Pacote de dados versionado com atualização incremental. |
| 14 | Iterar a visão exige build no celular a cada teste (lento) | Alta | Alto (produtividade) | `IFrameSource` com vídeos no Editor e em Python. |
| 15 | Escopo explode (motor de regras do Magic) | Média | Alto | O app só **reflete a mesa**, sem calcular regras (§7.3). |

---

## 15. Verificação e testes

- **Vídeos de regressão:** uma pasta `test-videos/` com gravações reais (luzes diferentes, sleeves, playmats, partidas inteiras) e um **gabarito de eventos** (`entrou X em t=12s`, `virou`, `morreu`…).
  - O script `ml/eval/` roda o pipeline e calcula: recall de detecção, top-1 de identificação, tempo até identificar, **precisão de eventos** (remoções falsas, taps perdidos) e tremor.
  - Rodar a cada mudança na visão ou no rastreamento.
- **Gravação de sessões AR:** gravação e reprodução de sessões do ARCore (Recording & Playback API) para reproduzir bugs com a mesma pose da câmera. No iOS, gravar sessões no Reality Composer e reproduzir no Xcode.
- **Testes unitários (Unity Test Framework):**
  - `DeckParser` (formatos Moxfield/Arena/pt);
  - `ModelResolver` (prioridades e sinônimos);
  - `TrackStateMachine` (sequências de detecções simuladas → eventos esperados, incluindo oclusão e fora do campo de visão);
  - histerese do tap;
  - associação húngara com cópias idênticas.
- **Teste de campo** a cada fase: uma partida real de 20–40 min com um checklist (remoções falsas, cartas não reconhecidas, temperatura e bateria no fim, FPS mínimo), anotado num log.
- **Métricas-alvo do MVP (fim da Fase 4):**
  - modo deck com ≥97% de identificação correta em ≤2 s;
  - ≤1 remoção falsa por partida;
  - tap detectado em ≤1 s;
  - ≥30 fps;
  - 40 min de partida sem perda grave de desempenho.

---

## 16. Próximos passos imediatos (ao aprovar o plano)

1. Salvar este plano em `docs/PLANO.md` no diretório de trabalho e, se quiser, publicá-lo como uma página para compartilhar.
2. Criar a estrutura do repositório (§12) e o `README`.
3. Escrever e testar aqui os **scripts Python da Fase 1** (`download_scryfall.py`, `build_card_db.py`) e o **parser de deck** com testes, já que eles rodam neste ambiente.
4. Preparar o guia passo a passo da **Fase 0** (instalação do Unity, pacotes, configuração do ARCore e a lista dos assets do Quaternius a baixar) e os scripts C# iniciais. O Unity e o celular ficam do seu lado, porque não dá para rodá-los neste container.
