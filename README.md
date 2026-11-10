# Mesa Viva — Magic em RA

App de celular que reconhece as cartas de Magic: The Gathering sobre a mesa e faz surgir criaturas 3D animadas em cima delas, no estilo do episódio "Guerra de Cartas" de Hora de Aventura.

> **Agora o desenvolvimento é na web:** [`web/README.md`](web/README.md). Modo Cartas (MindAR) no iPhone e no Android, e modo Mesa (WebXR, detecção de plano) no Android.
> O app Unity está inteiro e guardado: [`docs/UNITY_ARQUIVO.md`](docs/UNITY_ARQUIVO.md).

- 👉 **Primeiro dia (instalar, clonar, abrir no Unity):** [`docs/COMECE_AQUI.md`](docs/COMECE_AQUI.md)
- **iPhone (build na nuvem e instalação, sem Mac):** [`docs/IPHONE_GUIA.md`](docs/IPHONE_GUIA.md)
- **Plano completo** (arquitetura, UX, visão computacional, riscos, roadmap): [`docs/PLANO.md`](docs/PLANO.md)
- **Passo a passo da Fase 0** (Unity + ARKit + primeiras criaturas): [`docs/FASE0_GUIA.md`](docs/FASE0_GUIA.md)
- **Reconhecimento da mesa** (calibração por toque, montagem da cena, testes): [`docs/MESA_GUIA.md`](docs/MESA_GUIA.md)
- **Protótipo clicável da interface** (fantasia sombria): publicado como Artifact (link na conversa)
- **Licenças dos assets:** [`docs/CREDITS.md`](docs/CREDITS.md)

## Estrutura

```
docs/        plano, guias, créditos
ml/          ferramentas Python: dados do Scryfall, banco de cartas, decks, escolha de modelos, export do catálogo
tools/       utilitários do repositório (.meta do Unity, catálogo de exemplo)
Assets/      projeto Unity (abra a raiz do repositório no Unity Hub) — Assets/_Project:
               Scripts/Data     catálogo de cartas, leitor de deck, escolha de modelo, decks salvos
               Scripts/UI       roteador e telas do menu (UI Toolkit)
               Scripts/Table    calibração da mesa, status do rastreamento
               Scripts/Phase0   Image Tracking + criaturas (Fase 0)
               Editor/          menu Mesa Viva → Configurar projeto (URP, iOS/Android, ARKit/ARCore, Player)
                                menu Mesa Viva → Criar cenas (App, Mesa, Fase0 + materiais, prefabs, painéis)
               Settings/        URP e URP_Renderer (com AR Background Renderer Feature)
               Resources/       telas (UXML) e model_map.json
               UI/              estilos (Theme.uss, Menus.uss), AppShell e tela de calibração
               Shaders/         grade dourada dos planos
               Tests/EditMode   testes NUnit de dados e geometria (Test Runner)
               Tests/PlayMode   teste do fluxo menu → calibração → menu, com as cenas de verdade
             Assets/StreamingAssets/Catalog   catálogo de cartas do app (TSV)
```

## Ferramentas de dados (`ml/`)

Precisa de Python 3.10+. Em runtime só usa a biblioteca padrão; o `pytest` é só para os testes.

```bash
cd ml

# 1. Baixar os dados do Scryfall (~200 MB; --with-all-cards baixa mais ~2 GB para nomes em português)
python scripts/download_scryfall.py --out data/scryfall --with-all-cards

# 2. Gerar o banco local de cartas
python scripts/build_card_db.py \
    --oracle data/scryfall/oracle_cards.json \
    --artwork data/scryfall/unique_artwork.json \
    --all-cards data/scryfall/all_cards.json --langs pt \
    --out data/cards.db

# 3. Ver qual modelo 3D cada carta do seu deck vai usar
python scripts/preview_deck.py meu_deck.txt --db data/cards.db

# Imagens das cartas (para a Reference Image Library da Fase 0)
python scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" --out ref_images

# Testes
pip install -r requirements-dev.txt
pytest
```

O formato do deck é o mesmo do export do Arena, Moxfield e MTGO (`4 Llanowar Elves`, `1 Shivan Dragon (DMR) 123 *F*`, `SB: 2 Duress`, seções `Deck`/`Sideboard`/`Commander`). Nomes em português funcionam se o banco foi gerado com `--all-cards`.

O mapeamento carta → modelo fica em [`ml/config/model_map.json`](ml/config/model_map.json) e é editável sem programar. A ordem de prioridade é:
1. escolha do usuário;
2. carta específica;
3. subtipo (raças antes de classes);
4. família de subtipos;
5. habilidade;
6. tipo;
7. cor.

O app Unity lê o mesmo arquivo (cópia em `Assets/_Project/Resources/Config/`; um teste garante que as duas são iguais). O catálogo do app sai de `scripts/export_app_catalog.py`.

## Regras do repositório

- **Todo asset do Unity vai junto do seu `.meta`.** Depois de criar arquivos fora do Unity, rode `python tools/new_meta.py`; `python tools/new_meta.py --check` confere.
- Binários (modelos, texturas, áudio, fontes) vão pelo **Git LFS** automaticamente (`.gitattributes`).
- Certificados e perfis da Apple **nunca** entram no Git (`.gitignore`).

## Status

| Fase | Situação |
|---|---|
| M0 — Chão firme (roadmap da `docs/ARQUITETURA.md` §8) | Migração feita, Unity Transport instalado, testes verdes no Unity 6000.6.8f1 (57 EditMode, 1 PlayMode) e no Python (86). **Falta:** build de Android (módulo não instalado), build no iPhone e o aceite da calibração no aparelho. Detalhes na `ARQUITETURA.md` §11 |
| A — Projeto executável | Correções da auditoria, ARCore/Android, Input System e gerador de cenas escritos; o C# compila. **Falta rodar no Unity** (Configurar projeto, Criar cenas, testes) e testar no aparelho |
| 0 — Image Tracking + 5 criaturas | Scripts e guia prontos; a cena `Fase0` sai do gerador sem imagens nem modelos (você liga os seus). Nunca testada no aparelho |
| 1 — Dados, decks, bestiário | Python testado (86 testes). C# de dados com testes EditMode. Telas do menu em UI Toolkit (importar, detalhe, config., nova partida). **Incompleta:** o Bestiário só mostra um ícone (sem modelos 3D), e não há `CreatureImporter` nem modelos no projeto |
| Interface | Menus e tela de calibração em código; HUD da partida não existe. O modo "Dois celulares" aparece desabilitado ("em breve") |
| Reconhecimento da mesa | Scripts + testes de geometria prontos; a cena `Mesa` sai do gerador. Nunca testada no aparelho |
| Reconhecimento de cartas, rastreamento, multiplayer | **Não existem.** Nenhum código ainda |
| Próximas fases | Ver o roadmap no `docs/PLANO.md` (em revisão: partida entre dois celulares por Wi-Fi local, sem marcadores, reconhecimento automático) |

---

Projeto de fã, gratuito e não comercial. Magic: The Gathering é propriedade da Wizards of the Coast. Os dados das cartas vêm do Scryfall.
