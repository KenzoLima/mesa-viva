# Comece aqui: o primeiro dia com o projeto

Este guia leva o projeto até o seu PC (Windows) e deixa tudo pronto para trabalharmos juntos.

**Como dividimos o trabalho:**
- **Eu (Claude)** escrevo scripts, telas (UXML/USS), ferramentas e documentação, e envio para o GitHub.
- **Você** baixa as mudanças, abre no Unity, monta cenas e prefabs, testa no Editor e no iPhone, e envia de volta.
- **O GitHub** é o ponto de encontro: o repositório `mesa-viva`.

Tempo estimado: de 2 a 3 horas, a maior parte esperando instalações.

---

## 1. Instalar os programas

| Programa | Para quê | Onde |
|---|---|---|
| **GitHub Desktop** | Baixar e enviar mudanças sem usar a linha de comando (já traz o Git e o Git LFS) | https://desktop.github.com |
| **Unity Hub** | Instalar e abrir o Unity | https://unity.com/download |
| **Unity 6 LTS** | O motor do app | Pelo Hub: **Installs → Install Editor → Unity 6 (LTS)**, a versão mais recente da lista |
| **Visual Studio Community** | Ler e editar o C# | O Hub oferece junto na instalação do Unity. Deixe marcado. |
| Python 3.12 (opcional por enquanto) | Ferramentas de dados das cartas (§10) | https://www.python.org/downloads (marque "Add python.exe to PATH") |

Na instalação do Unity 6, marque o módulo **iOS Build Support**. Não precisa do Android.

## 2. Criar o repositório no GitHub

1. Crie uma conta em https://github.com, se ainda não tiver.
2. **New repository**:
   - nome `mesa-viva`;
   - **Private**;
   - **não** marque README, .gitignore nem licença, porque o repositório precisa nascer vazio.
3. Para eu conseguir enviar o código, conecte o GitHub ao Claude em **claude.ai → Configurações → Conectores → GitHub**.
4. Me diga o seu **nome de usuário do GitHub**. Eu envio o projeto e aviso quando terminar.

## 3. Baixar o projeto para o PC

1. Abra o GitHub Desktop e entre com a sua conta.
2. **File → Clone repository** → escolha `mesa-viva`.
3. **Local path:** `C:\Users\<seu usuário>\Desktop\MesaViva`.

> ⚠️ **Se a sua Área de Trabalho estiver no OneDrive** (o caminho tem `OneDrive\Desktop`), use `C:\Projetos\MesaViva`. O Unity cria milhares de arquivos temporários, e o OneDrive tentando sincronizar trava tudo. Se quiser, crie um atalho para a pasta na Área de Trabalho.

## 4. Abrir no Unity pela primeira vez

> ✅ **Os passos 4, 5 e 6 já vêm prontos no repositório** (Unity **6000.3.27f1**). `Packages/` e `ProjectSettings/` estão no Git, e a configuração dos passos 5 e 6 é feita pelo menu **Mesa Viva → Configurar projeto** (`Assets/_Project/Editor/ProjectSetup.cs`). Se algo sair do lugar, rode esse menu de novo: ele só mexe no que estiver errado.
> Sem abrir o Unity, dá para rodar o mesmo script pela linha de comando:
> `Unity.exe -batchmode -nographics -buildTarget iOS -projectPath unity-app -executeMethod MtgAr.EditorTools.ProjectSetup.RunBatch -logFile -`
> Os passos abaixo ficam como referência do que o script faz.

1. Unity Hub → **Projects → Add → Add project from disk** → selecione `MesaViva\unity-app`.
2. Abra com o **Unity 6000.3.27f1**. A primeira abertura demora de 5 a 15 min, porque o Unity cria a pasta `Library/`, que nunca vai para o Git.
3. Os pacotes já estão no `Packages/manifest.json`: AR Foundation e Apple ARKit 6.3.5, Universal RP 17.3.0 e Test Framework 1.6.0.

## 5. Configurar o visual (URP) e a câmera do AR

1. Na janela Project, vá em `Assets/_Project/` → botão direito → **Create → Folder** → `Settings`.
2. Dentro dela: botão direito → **Create → Rendering → URP Asset (with Universal Renderer)**. Ele cria `URP` e `URP_Renderer`.
3. **Edit → Project Settings → Graphics → Default Render Pipeline** = `URP`.
4. **Edit → Project Settings → Quality**: em cada nível da lista, **Render Pipeline Asset** = `URP`.
5. Selecione `URP_Renderer` → **Add Renderer Feature → AR Background Renderer Feature**. **Sem isso, o fundo fica preto em vez de mostrar a câmera.**

## 6. Configurar para iPhone e AR

1. **File → Build Profiles → iOS → Switch Platform**.
2. **Edit → Project Settings → XR Plug-in Management**:
   - aba **iOS** (ícone do celular): ✅ **Apple ARKit**;
   - aba **PC/Mac/Linux** (ícone do monitor): ✅ **XR Simulation**. É o que permite testar o AR no Editor, sem iPhone.
3. **XR Plug-in Management → Project Validation** → **Fix All**, e repita até não sobrar erro.
4. Os ajustes do **Player** estão no `IPHONE_GUIA.md` §4. O script já preenche nome, versão, texto do pedido de câmera, ARM64 e assinatura manual. **Company Name e Bundle Identifier ficam com você**, porque dependem da sua conta Apple.

## 7. Montar as duas cenas

### Cena `App` (os menus)
1. **File → New Scene → Basic (URP)** e salve como `Assets/_Project/Scenes/App.unity`.
2. Na **Main Camera**: *Environment → Background Type* = **Solid Color**, cor `#0F0D0B`.
3. **Assets/_Project/UI** → botão direito → **Create → UI Toolkit → Panel Settings Asset**, com o nome `PainelMenu`:
   - *Scale Mode* = **Scale With Screen Size**;
   - *Reference Resolution* = **390 × 844**;
   - *Screen Match Mode* = Match Width Or Height, *Match* = **0.5**.
4. **GameObject → UI Toolkit → UI Document**:
   - *Panel Settings* = `PainelMenu`;
   - *Source Asset* = `Assets/_Project/UI/AppShell.uxml`.
5. No mesmo objeto, **Add Component**: **App Router**, **App Bootstrap**, **Safe Area Padding**.
6. Crie um GameObject vazio `Cena` → **Add Component → Scene Orientation**, *Mode* = **Portrait**.
7. Salve.

### Cena `Mesa` (calibração em RA)
Siga o `MESA_GUIA.md` §2 a §5.

### Ordem das cenas
**File → Build Profiles → Scene List:** `App` em primeiro, `Mesa` em segundo.

## 8. Testar no Editor

1. **Window → General → Device Simulator** e escolha um **iPhone 14 Pro** (ou o seu modelo). Ele mostra o notch e a Dynamic Island, e confere se a interface respeita a área segura.
2. Abra a cena `App` e dê **Play**. Navegue: abertura → onboarding → pedido de câmera → Início → **Meus decks → Importar**.
3. Cole este deck de teste:
   ```
   4 Llanowar Elves
   2 Elfos de Llanowar
   2 Shivan Dragon
   2 Grizzly Bears
   2 Serra Angel
   4 Lightning Bolt
   1 Llanowar Elfs
   12 Forest
   ```
   A última carta tem um erro de digitação de propósito: o botão **Corrigir** deve aparecer.
   > O catálogo que vem no projeto é só de **exemplo** (umas 20 cartas). O catálogo completo está no §10.
4. Salve o deck, toque em **Trocar** numa criatura e escolha outro modelo. Depois vá em **Jogar → Calibrar a mesa**: a cena `Mesa` abre (no Editor, com XR Simulation).
5. Rode os testes: **Window → General → Test Runner → EditMode → Run All**. Todos devem passar.

## 9. Enviar a configuração para o GitHub

No GitHub Desktop vão aparecer muitos arquivos novos: `ProjectSettings/`, `Packages/`, cenas, `.meta`, o URP.
- **Não deve aparecer** nada de `Library/`, `Temp/` ou `Logs/`. Se aparecer, me avise antes de enviar.
- Em **Summary** escreva `Configuração inicial do Unity` → **Commit to main** → **Push origin**.
- Me avise: "subi a configuração". Daí em diante eu trabalho em cima dela.

### O ritual de todo dia
1. **Antes de abrir o Unity:** no GitHub Desktop, **Fetch origin → Pull**, para pegar o que eu enviei.
2. **Ao terminar:** **Commit → Push**, com uma frase dizendo o que mudou.
3. **Divisão para não dar conflito:** **cenas (`.unity`) e prefabs são seus**; scripts, UXML/USS e docs são meus. Se você precisar mudar um script, tudo bem: só me avise para eu puxar antes de mexer no mesmo arquivo.
4. Se o GitHub Desktop mostrar **conflito**, não resolva no chute: me chame.

## 10. Catálogo completo de cartas (quando quiser)

Tudo roda no PowerShell, na pasta `MesaViva\ml`:
```powershell
python scripts\download_scryfall.py --with-all-cards
python scripts\build_card_db.py --oracle data\scryfall\oracle_cards.json --artwork data\scryfall\unique_artwork.json --all-cards data\scryfall\all_cards.json --langs pt --out data\cards.db
python scripts\export_app_catalog.py --db data\cards.db
```
- O primeiro comando baixa uns 2 GB, que ficam fora do Git.
- O último grava o catálogo do app em `unity-app/Assets/StreamingAssets/Catalog/` (alguns MB). **Commit + push** desse catálogo.
- Para voltar ao catálogo de exemplo: `python ..\tools\make_sample_catalog.py`.
