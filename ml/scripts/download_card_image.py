#!/usr/bin/env python3
"""Baixa a imagem de cartas pelo nome (para a Reference Image Library da Fase 0).

Uso:
    python scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" --out ref_images

Dica: para a Fase 0, foto das SUAS cartas (bem retas, bem iluminadas, recortadas)
costuma funcionar melhor que a imagem do Scryfall, porque inclui sleeve e impressão reais.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mtgar_data.scryfall_client import ScryfallClient, ScryfallError  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="+", help="nomes das cartas (busca aproximada)")
    parser.add_argument("--out", type=Path, default=Path("ref_images"))
    parser.add_argument("--version", default="large", choices=["small", "normal", "large", "png", "art_crop"])
    args = parser.parse_args(argv)

    client = ScryfallClient()
    failures = 0
    for name in args.names:
        try:
            for path in client.download_card_image(name, args.out, args.version):
                print(f"ok  {name} -> {path}")
        except ScryfallError as err:
            failures += 1
            print(f"ERRO {name}: {err}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
