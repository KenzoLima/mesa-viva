#!/usr/bin/env python3
"""Mantém os dados do app web (web/public/data) alinhados com os do Unity/Python.

    ml/config/model_map.json -> web/public/data/model_map.json   (sempre igual ao do Unity)

Catálogo de cartas:
  - O web usa o catálogo COMPLETO (~35 mil cartas), gerado direto do banco:
        python ml/scripts/export_app_catalog.py --db ml/data/cards.db --out web/public/data
  - O Unity continua com o catálogo de amostra em Assets/StreamingAssets/Catalog (os testes EditMode dependem dele).
  - Se o web ainda não tem catálogo, este script copia a amostra do Unity para não ficar vazio.

Uso:
    python tools/sync_web_data.py           # copia
    python tools/sync_web_data.py --check   # só confere (CI)
"""

from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data"
MODEL_MAP = ROOT / "ml" / "config" / "model_map.json"
SAMPLE_CATALOG = ROOT / "Assets" / "StreamingAssets" / "Catalog"
CATALOG_FILES = ("cards.tsv", "names.tsv")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="não copia; falha se algo estiver faltando ou diferente")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    problems = []

    dst = OUT / "model_map.json"
    if not (dst.exists() and filecmp.cmp(MODEL_MAP, dst, shallow=False)):
        if args.check:
            problems.append("model_map.json desatualizado")
        else:
            shutil.copyfile(MODEL_MAP, dst)
            print("copiado: model_map.json")

    for name in CATALOG_FILES:
        if (OUT / name).exists():
            continue
        if args.check:
            problems.append(f"{name} faltando")
        else:
            shutil.copyfile(SAMPLE_CATALOG / name, OUT / name)
            print(f"copiado (amostra do Unity): {name}")

    if problems:
        print("; ".join(problems) + " (rode sem --check)", file=sys.stderr)
        return 1
    print("dados do web em dia")
    return 0


if __name__ == "__main__":
    sys.exit(main())
