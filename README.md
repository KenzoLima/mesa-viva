# Mesa Viva — Magic em RA

App de celular que reconhece as cartas de Magic: The Gathering sobre a mesa e faz surgir criaturas 3D animadas em cima delas, no estilo do episódio "Guerra de Cartas" de Hora de Aventura.

- 👉 **Primeiro dia (instalar, clonar, abrir no Unity):** [`docs/COMECE_AQUI.md`](docs/COMECE_AQUI.md)
- **iPhone (build na nuvem e instalação, sem Mac):** [`docs/IPHONE_GUIA.md`](docs/IPHONE_GUIA.md)
- **Plano completo** (arquitetura, UX, visão computacional, riscos, roadmap): [`docs/PLANO.md`](docs/PLANO.md)
- **Passo a passo da Fase 0** (Unity + ARCore + primeiras criaturas): [`docs/FASE0_GUIA.md`](docs/FASE0_GUIA.md)
- **Reconhecimento da mesa** (calibração por toque, montagem da cena, testes): [`docs/MESA_GUIA.md`](docs/MESA_GUIA.md)
- **Protótipo clicável da interface** (fantasia sombria): publicado como Artifact (link na conversa)
- **Licenças dos assets:** [`docs/CREDITS.md`](docs/CREDITS.md)

## Estrutura

```
docs/        plano, guias, créditos
ml/          ferramentas Python: dados do Scryfall, banco de cartas, decks, escolha de modelos, export do catálogo
tools/       utilitários do repositório (.meta do Unity, catálogo de exemplo)
unity-app/   projeto Unity (abra esta pasta no Unity Hub) — Assets/_Project:
               Scripts/Data     catálogo de cartas, leitor de deck, escolha de modelo, decks salvos
               Scripts/UI       roteador e telas do menu (UI Toolkit)
               Scripts/Table    calibração da mesa, status do rastreamento
               Scripts/Phase0   Image Tracking + criaturas (Fase 0)
               Resources/       telas (UXML) e model_map.json
               UI/              estilos (Theme.uss, Menus.uss), AppShell e tela de calibração
               Shaders/         grade dourada dos planos
               Tests/EditMode   testes NUnit (Test Runner)
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

O app Unity lê o mesmo arquivo (cópia em `unity-app/Assets/_Project/Resources/Config/`; um teste garante que as duas são iguais). O catálogo do app sai de `scripts/export_app_catalog.py`.

## Regras do repositório

- **Todo asset do Unity vai junto do seu `.meta`.** Depois de criar arquivos fora do Unity, rode `python tools/new_meta.py`; `python tools/new_meta.py --check` confere.
- Binários (modelos, texturas, áudio, fontes) vão pelo **Git LFS** automaticamente (`.gitattributes`).
- Certificados e perfis da Apple **nunca** entram no Git (`.gitignore`).

## Status

| Fase | Situação |
|---|---|
| 0 — Image Tracking + 5 criaturas | Scripts e guia prontos (iPhone); falta montar a cena e testar |
| 1 — Dados, decks, bestiário | Python e C# prontos e testados; telas do menu em UI Toolkit (importar, detalhe, bestiário, config., nova partida) |
| Interface | Protótipo aprovado; menus e calibração no Unity; HUD da partida na próxima etapa |
| Reconhecimento da mesa | Scripts + testes prontos; falta montar a cena e testar no iPhone |
| 2+ | Ver o roadmap no `docs/PLANO.md` |

---

Projeto de fã, gratuito e não comercial. Magic: The Gathering é propriedade da Wizards of the Coast. Os dados das cartas vêm do Scryfall.
