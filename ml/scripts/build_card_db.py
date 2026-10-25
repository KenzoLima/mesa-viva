#!/usr/bin/env python3
"""Gera o banco local `cards.db` a partir do bulk data do Scryfall.

Uso:
    python scripts/build_card_db.py \\
        --oracle data/scryfall/oracle_cards.json \\
        --artwork data/scryfall/unique_artwork.json \\
        --all-cards data/scryfall/all_cards.json --langs pt \\
        --out data/cards.db

Só --oracle é obrigatório. --all-cards adiciona os nomes impressos nos idiomas de --langs.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mtgar_data.card_db import CardDatabase  # noqa: E402
from mtgar_data.json_stream import iter_json_array  # noqa: E402

COMMIT_EVERY = 5000


def _load(label: str, path: Path, handler, filter_fn=None) -> tuple[int, int]:
    seen = used = 0
    started = time.monotonic()
    for obj in iter_json_array(path):
        seen += 1
        if filter_fn is None or filter_fn(obj):
            used += 1 if handler(obj) else 0
        if seen % COMMIT_EVERY == 0:
            print(f"\r  {label}: {seen:,} lidos, {used:,} usados", end="", flush=True)
    print(f"\r  {label}: {seen:,} lidos, {used:,} usados ({time.monotonic() - started:.1f}s)")
    return seen, used


def build(oracle: Path, out: Path, artwork: Path | None = None, all_cards: Path | None = None,
          langs: set[str] | None = None) -> dict[str, int]:
    langs = langs or {"pt"}
    out.parent.mkdir(parents=True, exist_ok=True)
    db = CardDatabase.create(out)
    try:
        _load("cartas", oracle, db.add_card)
        db.commit()
        if artwork:
            _load("artes", artwork, db.add_artwork)
            db.commit()
        if all_cards:
            _load(f"nomes {','.join(sorted(langs))}", all_cards, db.add_printed_names,
                  filter_fn=lambda c: c.get("lang") in langs)
            db.commit()
        db.set_meta("built_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
        db.set_meta("sources", ",".join(p.name for p in (oracle, artwork, all_cards) if p))
        db.set_meta("langs", ",".join(sorted(langs)) if all_cards else "")
        return {table: db.count(table) for table in ("cards", "faces", "names", "artworks")}
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--oracle", required=True, type=Path, help="oracle_cards.json (ou default_cards.json)")
    parser.add_argument("--artwork", type=Path, help="unique_artwork.json")
    parser.add_argument("--all-cards", type=Path, help="all_cards.json (para nomes traduzidos)")
    parser.add_argument("--langs", nargs="+", default=["pt"], help="idiomas dos nomes traduzidos (padrão: pt)")
    parser.add_argument("--out", type=Path, default=Path("data/cards.db"))
    args = parser.parse_args(argv)

    for path in (args.oracle, args.artwork, args.all_cards):
        if path and not path.exists():
            print(f"ERRO: arquivo não encontrado: {path}", file=sys.stderr)
            return 2

    counts = build(args.oracle, args.out, args.artwork, args.all_cards, set(args.langs))
    print(f"\nBanco gerado em {args.out}: " + ", ".join(f"{v:,} {k}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
