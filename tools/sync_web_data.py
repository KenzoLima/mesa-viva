#!/usr/bin/env python3
"""Copia os dados compartilhados para o app web (web/public/data).

Fonte única dos dados (as mesmas que o Unity usa):
    ml/config/model_map.json                    -> web/public/data/model_map.json
    Assets/StreamingAssets/Catalog/cards.tsv    -> web/public/data/cards.tsv
    Assets/StreamingAssets/Catalog/names.tsv    -> web/public/data/names.tsv

Uso:
    python tools/sync_web_data.py           # copia
    python tools/sync_web_data.py --check   # só confere se estão iguais (para CI/testes)
"""

from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data"
SOURCES = {
    "model_map.json": ROOT / "ml" / "config" / "model_map.json",
    "cards.tsv": ROOT / "Assets" / "StreamingAssets" / "Catalog" / "cards.tsv",
    "names.tsv": ROOT / "Assets" / "StreamingAssets" / "Catalog" / "names.tsv",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="não copia; falha se algum arquivo estiver diferente")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, src in SOURCES.items():
        dst = OUT / name
        if not src.exists():
            print(f"faltando: {src}", file=sys.stderr)
            return 1
        if dst.exists() and filecmp.cmp(src, dst, shallow=False):
            continue
        if args.check:
            stale.append(name)
        else:
            shutil.copyfile(src, dst)
            print(f"copiado: {src.relative_to(ROOT)} -> {dst.relative_to(ROOT)}")
    if stale:
        print("desatualizados (rode sem --check): " + ", ".join(stale), file=sys.stderr)
        return 1
    print("dados do web em dia")
    return 0


if __name__ == "__main__":
    sys.exit(main())
