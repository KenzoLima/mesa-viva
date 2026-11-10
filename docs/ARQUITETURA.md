# Mesa Viva — Proposta de arquitetura (multiplayer)

> **Status:** proposta com as quatro decisões de §9 registradas. Nada aqui foi implementado.
> **Base:** `README.md` (tabela de status), `docs/PLANO.md` e o código dos dois projetos Unity. Não encontrei o relatório da auditoria em arquivo; se ele tiver conclusões que não estão no README, me aponte e eu ajusto.
> **Preços e limites de planos gratuitos** citados abaixo vêm do meu conhecimento e **não foram conferidos hoje**; confira antes de adotar qualquer serviço pago. A solução recomendada não depende de nenhum deles.

## 1. Resumo das decisões

| Área | Escolha | Motivo principal | Custo |
|---|---|---|---|
| Multiplayer | Um celular é o **host** na rede Wi-Fi local; protocolo próprio de mensagens sobre **Unity Transport**; entrada na sala por **QR code** | O estado do jogo é pequeno e não é "GameObjects sincronizados"; funciona sem internet e sem servidor | R$ 0 |
| Sincronização espacial | **As próprias cartas são as âncoras**: cada celular alinha seu sistema de coordenadas ao "referencial da mesa" pelas cartas que todos enxergam | Único método que é multiplataforma, sem internet, sem marcador impresso e que corrige drift sozinho | R$ 0 |
| Visão computacional | SLAM do AR Foundation + **detector neural de 4 cantos** rodando no **Unity Inference Engine** | Image Tracking nativo não aceita cópias repetidas nem mesa cheia (já demonstrado no PLANO §1) | R$ 0 |
| Reconhecimento | **Embedding da arte + vizinho mais próximo**, restrito aos decks da sala | Independe de idioma, não precisa retreinar a cada coleção, roda offline | R$ 0 |
| Banco de cartas | **Scryfall bulk** → pipeline Python existente → pacote versionado; no app continua em **arquivos planos (TSV/binário)** | Já existe, tem 86 testes, não exige plugin nativo de SQLite | R$ 0 |
| Modelos 3D | **Pacote base embutido** + **pacotes extras por Addressables** em host estático + **GLB em runtime** (glTFast) para modelos próprios e de IA | Jogo funciona offline desde o início; conteúdo novo não exige nova versão do app | R$ 0 |
| Backend | **Nenhum servidor.** Só hospedagem estática de arquivos | Nenhum requisito pede conta, ranking ou partida remota | R$ 0 |

Custos fixos que não dependem da arquitetura: Apple Developer Program (US$ 99/ano, para instalar no iPhone por mais de 7 dias e usar TestFlight), Google Play (US$ 25, uma vez, só se publicar) e os minutos de build de iOS na nuvem (ver `IPHONE_GUIA.md`).

## 2. Princípios que guiam as escolhas

1. **Perceber é local, decidir é central.** Cada celular só *observa* ("vejo uma carta X na posição P"). Um único lugar — o host — transforma observações em estado de jogo e eventos. É isso que garante que todos vejam os mesmos acontecimentos.
2. **Tudo que é compartilhado vive no referencial da mesa**, em metros sobre o plano (x, z, yaw). Nenhuma mensagem de rede carrega coordenadas do mundo de um celular específico.
3. **Um só caminho de código.** Jogar sozinho é ser host de uma sala sem clientes (transporte em loopback). Não existe "modo solo" separado para manter.
4. **Núcleo em C# puro.** Estado da sala, protocolo, rastreador e alinhamento não dependem de `UnityEngine` além de tipos matemáticos, para rodarem em testes EditMode com observações simuladas — sem celular.
5. **Sem internet por padrão.** Internet só é usada para baixar dados e modelos, nunca durante a partida.

## 3. Comparativo de alternativas

### 3.1 Multiplayer e comunicação

| Alternativa | Vantagens | Desvantagens | Custo | Dificuldade |
|---|---|---|---|---|
| **Unity Transport + protocolo próprio (escolhida)** | Oficial, multiplataforma, UDP confiável/não confiável; a mesma API funciona depois com Unity Relay; mensagens sob medida (observações, eventos, snapshot) | Serialização, reconexão e troca de host são código nosso | 0 | Média |
| Netcode for GameObjects (em cima do Unity Transport) | RPCs e variáveis de rede prontos | Modelo centrado em GameObjects, que não é o nosso caso (o estado é uma tabela de cartas); sem migração de host no modo LAN; difícil de testar fora do Play Mode | 0 | Média |
| Mirror / FishNet | Maduros, gratuitos, descoberta em LAN pronta | Mesmo descompasso de modelo; a descoberta por broadcast UDP esbarra na permissão de multicast do iOS (abaixo) | 0 | Média |
| LiteNetLib + protocolo próprio | Minúsculo, MIT, C# puro | Equivalente à escolhida, mas sem caminho pronto para Relay | 0 | Média |
| Photon (Fusion/PUN) | Migração de host pronta, salas e matchmaking | **Exige internet**; proprietário; plano grátis limitado (~20 jogadores simultâneos); dependência de fornecedor | 0 até o limite, depois pago | Baixa |
| Unity Relay + Lobby | Atravessa NAT, funciona em redes que isolam aparelhos | **Exige internet**; plano grátis com teto de uso | 0 até o limite | Baixa |
| Servidor próprio (Nakama, Colyseus, WebSocket) | Controle total, estado persistente | Exige internet, hospedagem e manutenção | US$ 0–10/mês | Alta |
| APIs nativas (MultipeerConnectivity, Nearby Connections) | Sem Wi-Fi comum | Não conversam bem entre iOS e Android | 0 | Alta |

**Pontos de atenção da escolha**
- **Descoberta da sala:** broadcast/multicast UDP no iOS exige uma permissão especial pedida à Apple. Por isso a entrada é por **QR code na tela do host** (IP, porta, código da sala). Zero configuração e sem depender da Apple. Bonjour fica como melhoria opcional.
- **iOS pede permissão de "rede local"** na primeira conexão; a tela de entrada precisa explicar isso.
- **Redes que isolam aparelhos** (Wi-Fi público, algumas operadoras): a saída é o hotspot de um dos celulares. Unity Relay entra como fase opcional se isso se mostrar comum.

**Entrada, saída e reconexão**
- O host mantém o **snapshot completo** da sala (no máximo ~200 cartas, poucos kB) e o transmite periodicamente. Todo cliente guarda o último.
- **Entrou no meio:** recebe o snapshot e alinha o espaço pelas cartas visíveis (§3.2).
- **Caiu e voltou:** reconecta com o token da sessão, informa o último número de evento recebido e recebe os eventos faltantes ou um snapshot novo.
- **Host saiu:** o cliente com o menor ID assume com o snapshot que já tem e avisa os demais (o QR não é necessário de novo; os endereços dos pares vão no snapshot). Há uma pausa de 2–5 s.
- **Relógio:** os clientes estimam a diferença para o relógio do host por ping; eventos são agendados ~150 ms à frente para as animações começarem juntas.

### 3.2 Sincronização espacial

O requisito difícil: todos precisam ver a criatura **no mesmo ponto físico**, com ARKit e ARCore misturados.

| Alternativa | Vantagens | Desvantagens | Custo | Dificuldade |
|---|---|---|---|---|
| **Cartas como âncoras (escolhida)** | Multiplataforma, offline, sem marcador; corrige drift continuamente; quanto mais cartas, mais preciso; reconexão e retomada do app resolvidas de graça | Depende do pipeline de visão estar funcionando; exige ao menos uma carta visível em comum | 0 | Média-alta (matemática simples, ajuste fino trabalhoso) |
| ARCore Cloud Anchors (via ARCore Extensions) | Feito para isso, funciona em iOS e Android | **Exige internet** e projeto no Google Cloud; pede 10–30 s de varredura; falha em mesa lisa; compatibilidade com AR Foundation 6 precisa ser conferida | 0 | Média |
| ARKit World Map / sessão colaborativa | Muito preciso | **Só iOS** | 0 | Baixa |
| Azure Spatial Anchors | — | Serviço encerrado em 2024 | — | — |
| Niantic Lightship (colocalização) | Pronto para uso | Dependência de fornecedor e de licença; colocalização offline exige uma imagem-alvo | Plano grátis limitado | Média |
| QR code na tela do host | Offline, simples | Só alinha no instante da leitura; não corrige drift; erro angular grande por o QR ser pequeno | 0 | Baixa |
| Marcador impresso na mesa | Robusto | Descartado nos requisitos | 0 | Baixa |

**Como funciona**
1. ARKit e ARCore já entregam o mundo em metros e com o eixo Y alinhado à gravidade. Entre dois celulares sobram só **4 incógnitas**: deslocamento (x, y, z) e rotação em torno da vertical.
2. O host define o **referencial da mesa** na calibração (o `TableFrame` que já existe).
3. Cada celular detecta as cartas no seu próprio mundo. O snapshot da sala traz a posição das mesmas cartas no referencial da mesa. Com os pares correspondentes, o celular resolve a transformação (ajuste rígido 2D com RANSAC, que descarta cartas que estão sendo movidas).
4. **Uma carta já basta** para começar: ela dá posição e direção (a identificação da arte resolve a ambiguidade de 180°). É a "carta-âncora" da calibração atual. Com erro de ~1° na direção, uma criatura a 50 cm da âncora fica ~9 mm fora; conforme mais cartas entram, o erro cai.
5. **Cartas repetidas** são pareadas pela geometria do conjunto, não só pela identidade; cartas únicas servem de semente.
6. A transformação é recalculada a cada poucos segundos e **suavizada** (nada de saltos); entre um cálculo e outro o SLAM mantém tudo parado.

**Maior risco da proposta:** a precisão do alinhamento é limitada pela precisão dos cantos detectados. Por isso há um experimento barato antes de tudo (§8, S1).

### 3.3 Visão computacional (detecção, movimento, rotação, remoção)

| Alternativa | Vantagens | Desvantagens | Custo | Dificuldade |
|---|---|---|---|---|
| Image Tracking nativo (ARKit/ARCore) | Pronto | 1 instância por imagem (a 2ª Floresta não aparece), ~20 imagens simultâneas, carta precisa estar perto | 0 | Baixa |
| OpenCV clássico (bordas + contornos) | Sem treino | Quebra com cartas encostadas, playmat escuro, mãos; o plugin bom para Unity é pago (~US$ 95) | 0–95 | Média |
| **Detector neural de 4 cantos + Inference Engine (escolhida)** | Aguenta sobreposição, mãos, luz ruim (treinado com dados sintéticos); um único modelo ONNX para iOS e Android | Exige gerar dados e treinar; desempenho em aparelhos fracos é incerto | 0 (GPU própria ou Kaggle/Colab grátis) | Alta |
| Mesmo detector em runtime nativo (Core ML + LiteRT) | Usa o chip de IA do aparelho, mais rápido | Dois plugins nativos para manter | 0 | Alta |
| Segmentação por instância + ajuste de quadrilátero | Bordas precisas | Mais pesado que cantos | 0 | Alta |

- **Runtime:** começa no Inference Engine. Só vai para nativo se o detector passar de ~40 ms num aparelho intermediário.
- **Licença do treino:** Ultralytics (YOLO) é AGPL-3.0, o que obriga a abrir o código do app distribuído. Como o código será público (decisão D2), o detector pode ser treinado com Ultralytics, desde que o repositório seja publicado sob **AGPL-3.0**. Se essa licença for indesejada, a alternativa é uma base Apache-2.0 (RTMDet/RTMPose).
- **Movimento, rotação e remoção** seguem o PLANO §5–6 (associação no mundo, filtro One Euro, histerese de 30°/60°, janela "SAINDO"), com uma mudança importante: o rastreador roda **no host e recebe observações de todos os celulares**.
  - Uma carta só é dada como removida se **nenhum** celular a vê e **pelo menos um** tem visão limpa do lugar.
  - A mão que tapa a carta para um jogador normalmente não tapa para o outro: o multiplayer melhora o ponto mais frágil do plano original.
- **Iluminação variável:** aumentos de dados (ruído, temperatura de cor, reflexo de sleeve), votação temporal, estimativa de luz do AR Foundation para avisar "pouca luz" e câmera em alta resolução com foco automático.

### 3.4 Reconhecimento de imagens (qual carta é)

| Alternativa | Vantagens | Desvantagens | Custo | Dificuldade |
|---|---|---|---|---|
| Hash perceptual (pHash) | Trivial, sem ML | Frágil a reflexo e perspectiva | 0 | Baixa |
| Features locais (ORB/AKAZE) | Robusto a perspectiva | Lento por candidato; não escala a dezenas de milhares | 0 | Média |
| **Embedding + vizinho mais próximo (escolhida)** | Independe de idioma; carta nova = só reindexar; busca força-bruta basta | Diferença entre scan e foto real exige ajuste fino | 0 | Média (pronto) → Alta (treinado) |
| Classificador com uma classe por carta | Simples | Retreinar a cada coleção | 0 | Média |
| OCR do nome | Desempata artes parecidas | Depende de idioma; texto ilegível a 70 cm | 0 | Média |
| API de nuvem | Sem treino | Internet, latência, custo por chamada | Pago por uso | Baixa |

- **Modo sala:** os decks de todos os jogadores são compartilhados ao entrar; a busca fica restrita a essas ~100–400 cartas. É aqui que a precisão vem.
- **Modo global** (~50 mil artes, ~25 MB de índice) fica para depois e só é acionado quando o melhor resultado na sala é fraco.
- Começa com um extrator pronto (DINOv2-small ou MobileNetV3); depois ajuste fino com aprendizado métrico.
- **Cópias repetidas** nunca dependem da identificação: cada cópia é um rastro separado pela posição.

### 3.5 Banco de dados de cartas

| Alternativa | Vantagens | Desvantagens | Custo |
|---|---|---|---|
| **Scryfall bulk + pacote offline (escolhida, já em uso)** | Completo, com imagens, nomes em português e `oracle_id`; atualização diária | Regras de uso (identificar o cliente, cachear, não usar como CDN) | 0 |
| MTGJSON | Licença MIT, já vem em SQLite | Sem imagens (precisa do Scryfall de qualquer jeito) | 0 |
| API ao vivo dentro do app | Sempre atual | Exige internet na partida; viola o espírito das regras do Scryfall | 0 |
| magicthegathering.io | — | Desatualizada, com limite de requisições | 0 |

Formato dentro do app: o PLANO previa SQLite; o código atual usa TSV em `StreamingAssets` e funciona com testes. **Manter arquivos planos**: ~30 mil cartas cabem em memória, e SQLite traria um plugin nativo por plataforma sem ganho real. O índice de embeddings é um binário `float16` + lista de IDs.

### 3.6 Distribuição de modelos 3D

| Alternativa | Vantagens | Desvantagens | Custo |
|---|---|---|---|
| Tudo embutido no app | Simples, offline | App cresce; todo modelo novo exige nova versão | 0 |
| **Addressables remoto** | Prefabs completos (Animator, VFX); atualização sem loja | Um pacote por plataforma; build do Unity para cada conteúdo | 0 |
| **GLB em runtime (glTFast)** | Arquivo único para as duas plataformas; é o formato que os geradores de IA entregam; sem build | Sem Animator pronto; materiais e animações precisam de adaptação | 0 |

**Escolha: os três, em camadas, atrás de um único contrato.**
1. **Pacote base embutido** (~30 arquétipos CC0: Quaternius, KayKit, Kenney) — garante jogo offline.
2. **Pacotes extras** via Addressables (modelos próprios caprichados).
3. **GLB avulso** para modelos de IA e do usuário.

Hospedagem dos arquivos: GitHub Releases (grátis, simples) para começar; Cloudflare R2 (10 GB grátis, sem cobrança de tráfego) se o volume crescer.

**Contrato do modelo** (`CreatureContract`): pivot nos pés, frente em +Z, altura normalizada, limite de triângulos e quatro animações — `Idle`, `Attack`, `Move`, `Death`. Quando o arquivo não traz alguma, entra a **animação procedural** (respiração, investida, deslizar, dissolver). Assim qualquer malha estática, inclusive de IA, funciona.

**Manifesto** (`models.json`): id, hash, origem, autor, **licença**, URL, mapa de animações, escala.
- O importador **recusa** modelo sem licença preenchida.
- Aceitas: CC0, CC-BY (crédito automático na tela de créditos), autoria própria, saída de IA cujo plano permita o uso.
- Bloqueadas: "ND" (proíbe modificar, e precisamos ajustar pivot e animação) e arquivos crus do Mixamo redistribuídos.
- "NC" só enquanto o projeto for não comercial.

**Associação carta → modelo:** continua o `ModelResolver` + `model_map.json` existentes (7 níveis de prioridade).

**No multiplayer:** o host resolve a associação uma vez e a envia na sala (carta → id do modelo + hash). Quem não tem o arquivo baixa do host estático; se não conseguir, usa o arquétipo de fallback — a criatura aparece no lugar certo para todos, só com aparência diferente naquele aparelho. Transferir modelos do usuário direto entre celulares fica para depois.

**Modelos de IA:** Meshy, Tripo (planos grátis com créditos; conferir a licença de saída de cada plano) ou modelos abertos locais (Hunyuan3D, TRELLIS; pedem GPU de 12 GB+). Humanoides podem receber esqueleto e animações automáticos; os demais usam a animação procedural.

### 3.7 Backend e hospedagem

| Alternativa | Vantagens | Desvantagens | Custo |
|---|---|---|---|
| **Sem backend + arquivos estáticos (escolhida)** | Nada para manter, nada para cair, sem dados pessoais | Sem contas, sem partida pela internet | 0 |
| Unity Gaming Services (Auth, Relay, Lobby, Cloud Save) | Integrado; `MesaVivaAR` já tem Auth e Cloud Save instalados | Internet; teto no plano grátis; dependência | 0 até o limite |
| Firebase | Maduro | Armazenamento de arquivos saiu do plano grátis | 0 → pago |
| Supabase | Postgres, código aberto | Projeto grátis pausa por inatividade | 0 |
| Cloudflare Workers + R2 | Plano grátis generoso | Mais código de servidor | 0 |
| VPS com Nakama/Colyseus | Controle total | Manutenção e segurança por nossa conta | US$ 0–10/mês |

Nenhum requisito pede conta, nuvem ou ranking. O login anônimo do `ServicesBootstrap` hoje não serve a nenhuma função da proposta. Se um dia surgir backup de decks na nuvem ou salas pela internet, UGS é o caminho mais curto por já estar no ecossistema.

## 4. Diagrama arquitetural

```
┌──────────────────────── CADA CELULAR (iOS ou Android) ────────────────────────┐
│                                                                               │
│  Câmera ─► AR Foundation (ARKit/ARCore) ─► pose do celular, plano, luz        │
│     │                                                                         │
│     ▼                                                                         │
│  VISÃO      FrameSource ─► Detector ─► Retificador ─► Identificador           │
│  (5–10 Hz)                 (4 cantos)  (homografia)   (embedding + índice)    │
│     │ cartas no mundo local                                                   │
│     ▼                                                                         │
│  ESPAÇO     Colocalizador ◄──── posições das cartas no snapshot               │
│             T(local ⇄ mesa), recalculado e suavizado                          │
│     │ observações no referencial da mesa                                      │
│     ▼                                                                         │
│  REDE       Cliente da sala ══════════════╗                                   │
│     ▲                                     ║                                   │
│     │ eventos + snapshot                  ║                                   │
│     ▼                                     ║                                   │
│  APRESENTAÇÃO  Espelho do estado ─► ModelResolver ─► Criaturas, terreno, VFX  │
│                (posições da mesa ─► mundo local via T)          + UI/HUD      │
│  CONTEÚDO      Catálogo de cartas · Provedor de modelos (base/Addressables/GLB)│
└───────────────────────────────────────────║───────────────────────────────────┘
                                            ║  Wi-Fi local (Unity Transport)
                 observações (não confiável, 5–10 Hz) ▲ ║ ▼ eventos (confiável, ordenado)
                                            ║            + snapshot periódico
┌───────────────────────── HOST (roda dentro de um dos celulares) ──────────────┐
│  Servidor da sala ─► Rastreador de fusão ─► Estado da sala ─► Log de eventos  │
│  (jogadores, token,   (associa observações    (cartas, lados,   (numerado,    │
│   relógio, QR)         de todos, vira/desvira, zonas, vida,      reenviável)  │
│                        saiu/moveu)             modelo de cada carta)          │
└───────────────────────────────────────────────────────────────────────────────┘

┌──────────────── FORA DA PARTIDA (PC e internet, nunca durante o jogo) ────────┐
│  ml/ (Python): Scryfall ─► catálogo + índice de embeddings ─► pacote de dados │
│  ml/ (Python): cenas sintéticas ─► treino ─► detector.onnx, embedder.onnx     │
│  Ferramentas Unity: importador de criaturas ─► pacotes de modelos + manifesto │
│  Hospedagem estática (GitHub Releases / R2): dados, modelos ONNX, modelos 3D  │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 5. Estrutura de diretórios

O repositório único passa a ser o `MesaVivaAR/` (decisão D1): o projeto Unity fica na raiz e as pastas de apoio ficam ao lado de `Assets/` (o Unity ignora o que está fora dela). Itens marcados com `←` são migrados do `MesaViva/` atual, que depois é arquivado.

```
MesaVivaAR/
├─ Assets/
│  ├─ _Project/
│  │  ├─ Scripts/
│  │  │  ├─ Bootstrap/         ServicesBootstrap (já existe; fica, mas nada depende dele)
│  │  │  ├─ Core/              tipos compartilhados, relógio, log, config de ajuste
│  │  │  ├─ Data/           ←  catálogo, decks, ModelResolver
│  │  │  ├─ Table/          ←  TableFrame, calibração, status do rastreamento
│  │  │  ├─ Vision/            IFrameSource, Detector, Rectifier, Identifier, índice
│  │  │  ├─ Spatial/           projeção no plano, PnP, Colocalizador, suavização
│  │  │  ├─ Room/              estado da sala, eventos, Rastreador de fusão (C# puro)
│  │  │  ├─ Net/               ITransport, Unity Transport, loopback, protocolo, QR
│  │  │  ├─ Content/           IModelProvider (embutido, Addressables, GLB), contrato
│  │  │  ├─ Presentation/      criaturas, terreno, portal, VFX, áudio
│  │  │  ├─ UI/             ←  menus + sala/lobby + HUD da partida
│  │  │  └─ DebugTools/        overlay, gravador de sessão, simulador de observações
│  │  ├─ Editor/            ←  configuração, gerador de cenas, CreatureImporter
│  │  ├─ Resources/ UI/ Shaders/ Settings/   ←
│  │  ├─ Models/Base/          pacote base embutido (CC0)
│  │  ├─ Tests/EditMode/    ←  + Room, Net (loopback), Spatial, Vision (imagens fixas)
│  │  └─ Tests/PlayMode/    ←  + duas instâncias na mesma máquina
│  ├─ StreamingAssets/      ←  Catalog/ · Models/ (ONNX) · Index/ (embeddings)
│  └─ XR/ Settings/ Scenes/    (já existem)
├─ Packages/ ProjectSettings/  (já existem)
├─ docs/                    ←  PLANO, guias, CREDITS, esta proposta
├─ ml/                      ←  Scryfall, banco de cartas, decks (pronto, 86 testes)
│  ├─ synth/                   gerador de cenas sintéticas
│  ├─ train/                   detector e embedding → ONNX
│  ├─ index/                   build_index.py (embeddings + ids)
│  └─ eval/                    métricas sobre vídeos gravados
├─ content/
│  ├─ models-src/              fontes dos modelos (FBX/GLB) + licença de cada um
│  └─ models.json              manifesto (id, hash, licença, autor, animações)
├─ test-videos/                gravações da mesa + gabarito de eventos (Git LFS)
├─ tools/                   ←  utilitários (.meta, catálogo de exemplo, publicação)
└─ LICENSE                     AGPL-3.0 (decisão D2)
```

**O que a migração exige** (parte do M0):
- Adicionar ao `MesaVivaAR` os pacotes que faltam: ARCore XR Plugin, Test Framework, Unity Transport e, mais tarde, Inference Engine, Addressables e glTFast.
- O código migrado foi escrito para AR Foundation 6.3 e nunca rodou em aparelho; no 6.7 pode haver ajustes de API. O `ProjectSetup` e o `SceneBuilder` precisam ser conferidos contra as configurações que o `MesaVivaAR` já tem (URP, Input System, XR).
- Trazer `.gitattributes` (Git LFS) e as regras do `.gitignore` sobre certificados da Apple.
- O `MesaVivaAR` usa Unity 6.6, que não é a versão LTS; vale conferir se o serviço de build de iOS na nuvem oferece essa versão.

## 6. Responsabilidade de cada módulo

Cada módulo é um assembly (`.asmdef`). A seta indica "depende de".

| Módulo | Faz | Não faz | Depende de |
|---|---|---|---|
| **Core** | Tipos (`CardKey`, `TablePose`, `PlayerId`), relógio sincronizado, parâmetros de ajuste | Nada de Unity além de matemática | — |
| **Data** *(existe)* | Catálogo, leitor de deck, decks salvos, carta → modelo | Rede, visão | Core |
| **Table** *(existe)* | Referencial da mesa, calibração, lados e zonas | Detectar cartas | Core |
| **Vision** | Capturar o quadro com pose e intrínsecas; detectar cantos; retificar; identificar | Saber de mundo, mesa ou rede | Core, Data |
| **Spatial** | Levar cantos para o plano; validar tamanho da carta; calcular e suavizar T(local ⇄ mesa) | Decidir o que é evento | Core, Table |
| **Room** | Estado único da sala; fundir observações; máquina de estados da carta; emitir eventos numerados; gerar e aplicar snapshot | Sockets, renderização | Core, Table |
| **Net** | Transporte, serialização, entrada por QR, reconexão, troca de host, sincronização de relógio | Regras de jogo | Core, Room |
| **Content** | Entregar um modelo pronto dado um id (embutido, Addressables ou GLB); validar contrato e licença; cache em disco | Escolher qual modelo (isso é do Data) | Core, Data |
| **Presentation** | Espelhar o estado em criaturas, terreno, efeitos e som; tocar animações na hora combinada | Alterar o estado | Core, Room, Content, Spatial |
| **UI** *(existe em parte)* | Menus, lobby, HUD, correções manuais (viram comandos enviados ao host) | Lógica de jogo | todos acima |
| **DebugTools** | Overlay, gravar/reproduzir sessões, simular jogadores e observações | — | todos |

Regra de ouro: **Presentation e UI nunca mudam o estado diretamente.** Toda mudança é um comando ou uma observação que passa pelo host e volta como evento.

## 7. Fluxo de dados

**A. Uma carta entra na mesa**
1. O celular de Ana captura um quadro junto com a pose da câmera daquele instante.
2. Vision devolve: 4 cantos, identidade provável e confiança.
3. Spatial projeta os cantos no plano e converte para o referencial da mesa.
4. Net envia a observação ao host (canal não confiável; ~40 bytes por carta). Cada pacote leva também a área da mesa que aquele celular está enxergando.
5. No host, Room associa a observação a um rastro (ou cria um candidato). Com detecções estáveis de um ou mais celulares, confirma a identidade por votação.
6. Room emite `CartaEntrou` (nº 57, com posição, identidade, dono, id do modelo, hora de início).
7. Todos os celulares recebem o evento nº 57 pelo canal confiável, pedem o modelo ao Content e tocam o portal e o surgimento na mesma hora combinada.
8. Cada celular converte a posição da mesa para o seu mundo local e desenha a criatura — no mesmo ponto físico para todos.

**B. Virar, mover, remover** — mesmo caminho; a decisão (histerese, janela de saída, motivo) é sempre do host, que sabe o que **cada** celular consegue ver.

**C. Correção manual** — o toque na UI vira um comando (`TrocarIdentidade`, `Desfazer`, `MudarVida`) enviado ao host, que o aplica e devolve como evento.

**D. Entrada de um jogador** — lê o QR → conecta → envia nome e deck → recebe snapshot e tabela de modelos → aponta para a mesa → Colocalizador resolve T → começa a ver tudo.

**E. Queda e retorno** — reconecta com o token → informa o último evento recebido → recebe o que faltou → Colocalizador revalida T (o mundo local pode ter mudado se o app foi para segundo plano).

## 8. Plano de implementação

Ordem por risco: primeiro o que pode inviabilizar a proposta. Prazos são estimativas em ritmo de hobby e dependem de aparelhos de teste (um iPhone e um Android com ARCore).

**Experimentos de viabilidade (antes de construir)**
- **S1 — Alinhamento entre aparelhos (2–4 dias).** Usar o Image Tracking da Fase 0, que já está escrito, com **uma** carta e dois celulares; cada um calcula T pela carta e ambos mostram um cubo a 40 cm dela. *Aceite:* cubos a menos de 1,5 cm um do outro. Se falhar, a sincronização espacial precisa ser repensada antes de qualquer outra coisa. **Precisa de dois aparelhos.** Enquanto não houver Android (decisão D4), roda com dois iPhones; a versão iOS + Android fica pendente e é o primeiro teste a fazer quando o Android chegar. Com um aparelho só, S1 não pode ser feito e o risco fica aberto até o M4.
- **S2 — Detector no aparelho (3–5 dias).** Um modelo de cantos pré-treinado ou treinado rápido, rodando no Inference Engine. *Aceite:* menos de 40 ms por quadro num aparelho intermediário e cartas detectadas a 70 cm. Define runtime e licença do treino.

| Fase | Entrega | Aceite |
|---|---|---|
| **M0 — Chão firme** (1–2 sem.) | Código, testes, `ml/`, `docs/` e `tools/` migrados para o `MesaVivaAR`; pacotes que faltam instalados; testes verdes; build instalada no iPhone; build de Android compilando | Calibração da mesa funciona no iPhone (hoje nunca foi testada em aparelho) |
| **M1 — Sala sem câmera** (2–3 sem.) | Core, Room, Net com loopback e Unity Transport; lobby com QR; simulador de observações | Dois celulares mostram os mesmos eventos falsos; sair, voltar e derrubar o host não perde estado; tudo coberto por testes EditMode |
| **M2 — Visão no laboratório** (3–5 sem.) | Gerador sintético, detector treinado, identificação com extrator pronto, avaliação em vídeos | ≥95% de detecção e ≥95% de identificação em até 2 s no modo sala, nos vídeos gravados |
| **M3 — Visão no aparelho, um jogador** (3–4 sem.) | Vision + Spatial no celular, ligados ao Room em loopback; cubos no lugar das criaturas | Cópias repetidas funcionam; ≤1 remoção falsa em 20 min; virar detectado em <1 s |
| **M4 — Mesa compartilhada** (2–3 sem.) | Colocalizador contínuo; fusão de observações de vários celulares | Dois celulares veem os cubos a <1,5 cm de diferença por 20 min; jogador entra no meio e alinha em <5 s. **Só fecha com iOS + Android**; até haver um Android, vale como parcial com dois iPhones |
| **M5 — Conteúdo** (2–3 sem.) | Contrato, CreatureImporter, pacote base, animações procedurais, manifesto com licenças, GLB em runtime | Um GLB de IA e um modelo CC0 entram pelo mesmo caminho e tocam as 4 animações; sem licença o importador recusa |
| **M6 — Experiência** (3–4 sem.) | HUD, portal, terreno, combate, zonas, som, pacotes remotos | Partida completa entre amigos, com todo erro corrigível pela UI |
| **M7 — Robustez** (contínuo) | Embedding treinado, modo global, gestão térmica, oclusão, Relay opcional | ≥90% no modo global; 45 min sem queda grave de desempenho |

M1 e M2 não dependem um do outro e podem se alternar.

## 9. Decisões tomadas (10/11/2026)

- **D1 — Projeto Unity:** `MesaVivaAR` é a base. O código do `MesaViva/unity-app` é migrado para ele no M0 (§5) e o `MesaViva/` é arquivado.
- **D2 — Código público.** O detector pode usar Ultralytics; o repositório é publicado sob AGPL-3.0.
- **D3 — Dois jogadores por enquanto.** O `TableFrame` ("eu" e "oponente") fica como está. O protocolo identifica jogadores por `PlayerId`, sem assumir que são dois, para que 3–4 jogadores seja depois uma mudança só no `Table` e na UI.
- **D4 — Sem Android de teste ainda.** O desenvolvimento segue no iPhone; o build de Android é mantido compilando desde o M0. S1 e M4 só são validados entre plataformas quando houver um Android com ARCore.

## 10. Pendências

- Confirmar se há um **segundo iPhone** disponível para o S1 e para os testes de sala do M1.
- Confirmar a licença AGPL-3.0 para o repositório (em 10/11/2026 a decisão foi adiada; não há arquivo `LICENSE`).

## 11. Situação do M0 (10/11/2026)

**O M0 não está concluído.** O que roda no PC está feito e verificado; o critério de aceite depende de aparelho.

| Item do M0 | Situação | Evidência |
|---|---|---|
| Código, testes, `ml/`, `docs/`, `tools/` migrados | Feito | commit `9db83cd`; `python tools/new_meta.py --check` sem faltas |
| Pacotes que faltavam | Feito | ARCore 6.7.1 e Test Framework 1.8.0 já estavam; **Unity Transport 6.6.0** adicionado em 10/11; 0 erros de compilação |
| Testes verdes | Feito | Unity 6000.6.8f1: 57/57 EditMode e 1/1 PlayMode, rodados depois da troca de pacotes; Python: 86/86 |
| Build de Android compilando | **Pendente** | O Editor 6000.6.8f1 só tem o módulo iOS; falta instalar o Android Build Support |
| Build instalada no iPhone | **Pendente** | Depende do build na nuvem e do aparelho (`IPHONE_GUIA.md`); o Bundle Identifier ainda é o do template |
| Aceite: calibração da mesa funciona no iPhone | **Pendente** | Nunca testada em aparelho |

Inference Engine, Addressables e glTFast ficam para as fases que os usam (M2/M3 e M5).
