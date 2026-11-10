#!/usr/bin/env python3
"""Mostra qual modelo 3D cada carta de um deck vai usar.

Uso:
    python scripts/preview_deck.py meu_deck.txt --db data/cards.db
    pbpaste | python scripts/preview_deck.py - --db data/cards.db     # deck da área de transferência

Sai com código 1 se alguma linha não for reconhecida.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mtgar_data.card_db import CardDatabase  # noqa: E402
from mtgar_data.deck_parser import parse_deck  # noqa: E402
from mtgar_data.deck_resolver import resolve_deck  # noqa: E402
from mtgar_data.model_resolver import ModelResolver  # noqa: E402

DEFAULT_MAP = Path(__file__).resolve().parents[1] / "config" / "model_map.json"
SECTION_LABELS = {"main": "Deck", "sideboard": "Sideboard", "commander": "Comandante",
                  "companion": "Companheiro", "maybeboard": "Talvez"}


def _table(rows: list[list[str]], headers: list[str]) -> str:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows)]
    fmt = " | ".join(f"{{:<{w}}}" for w in widths)
    lines = [fmt.format(*headers), "-+-".join("-" * w for w in widths)]
    lines += [fmt.format(*row) for row in rows]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("deck", help="arquivo .txt com a lista, ou '-' para ler da entrada padrão")
    parser.add_argument("--db", type=Path, default=Path("data/cards.db"))
    parser.add_argument("--map", type=Path, default=DEFAULT_MAP)
    args = parser.parse_args(argv)

    if not args.db.exists():
        print(f"ERRO: banco não encontrado: {args.db} (rode scripts/build_card_db.py antes)", file=sys.stderr)
        return 2
    text = sys.stdin.read() if args.deck == "-" else Path(args.deck).read_text(encoding="utf-8")

    deck = parse_deck(text)
    resolver = ModelResolver.from_file(args.map)
    with CardDatabase(args.db) as db:
        resolution = resolve_deck(deck, db)

    for section, label in SECTION_LABELS.items():
        rows = []
        for card, quantity in resolution.totals(section):
            choice = resolver.resolve(card)
            rows.append([
                str(quantity), card.name, card.type_line,
                choice.model_id + (f" (+{', '.join(choice.terrain_mix[1:])})" if len(choice.terrain_mix) > 1 else ""),
                f"{choice.scale:.2f}", choice.reason,
            ])
        if rows:
            total = sum(int(r[0]) for r in rows)
            print(f"\n{label} ({total} cartas)")
            print(_table(rows, ["qtd", "carta", "tipo", "modelo", "escala", "motivo"]))

    problems = 0
    for error in deck.errors:
        problems += 1
        print(f"\nlinha {error.line_no}: {error.text.strip()!r} -> {error.reason}")
    for item in resolution.unresolved:
        problems += 1
        hint = f" Você quis dizer: {', '.join(item.suggestions)}?" if item.suggestions else ""
        print(f"\nlinha {item.entry.line_no}: carta não encontrada: {item.entry.name!r}.{hint}")

    if problems:
        print(f"\n{problems} linha(s) com problema.")
        return 1
    print("\nTodas as cartas foram reconhecidas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
