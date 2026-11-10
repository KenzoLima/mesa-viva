#!/usr/bin/env python3
"""Baixa o bulk data do Scryfall.

Uso:
    python scripts/download_scryfall.py                       # oracle_cards + unique_artwork
    python scripts/download_scryfall.py --with-all-cards      # + all_cards (~2 GB, para nomes em pt)
    python scripts/download_scryfall.py --force               # baixa mesmo se já estiver atualizado
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mtgar_data.scryfall_client import ScryfallClient, ScryfallError  # noqa: E402

DEFAULT_TYPES = ["oracle_cards", "unique_artwork"]


def _progress_printer(label: str):
    last = {"pct": -1}

    def report(done: int, total: int | None) -> None:
        if total:
            pct = int(done * 100 / total)
            if pct != last["pct"]:
                last["pct"] = pct
                print(f"\r  {label}: {pct:3d}% ({done / 1e6:,.0f} / {total / 1e6:,.0f} MB)", end="", flush=True)
        else:
            print(f"\r  {label}: {done / 1e6:,.0f} MB", end="", flush=True)

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="data/scryfall", help="pasta de destino (padrão: data/scryfall)")
    parser.add_argument("--types", nargs="+", default=DEFAULT_TYPES, help="tipos de bulk data a baixar")
    parser.add_argument("--with-all-cards", action="store_true", help="também baixa all_cards (nomes traduzidos)")
    parser.add_argument("--force", action="store_true", help="baixa de novo mesmo se estiver atualizado")
    args = parser.parse_args(argv)

    types = list(args.types) + (["all_cards"] if args.with_all_cards else [])
    client = ScryfallClient()
    try:
        for bulk_type in types:
            print(f"- {bulk_type}")
            path, downloaded = client.download_bulk(
                bulk_type, args.out, force=args.force, progress=_progress_printer(bulk_type)
            )
            print(f"\n  {'baixado' if downloaded else 'já atualizado'}: {path}")
    except ScryfallError as err:
        print(f"\nERRO: {err}", file=sys.stderr)
        print("Verifique a conexão com a internet e tente de novo.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
