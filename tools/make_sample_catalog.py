#!/usr/bin/env python3
"""Gera o catálogo de EXEMPLO do app (as cartas das fixtures de teste) em
unity-app/Assets/StreamingAssets/Catalog, para desenvolver sem baixar o Scryfall.

O catálogo completo vem de:
    python ml/scripts/download_scryfall.py --with-all-cards
    python ml/scripts/build_card_db.py ... --out ml/data/cards.db
    python ml/scripts/export_app_catalog.py --db ml/data/cards.db
"""

import subprocess
import sys
import tempfile
from pathlib import Path

ML = Path(__file__).resolve().parents[1] / "ml"
FIXTURES = ML / "tests" / "fixtures"


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "cards.db"
        subprocess.run([sys.executable, str(ML / "scripts" / "build_card_db.py"),
                        "--oracle", str(FIXTURES / "oracle_cards.json"),
                        "--artwork", str(FIXTURES / "unique_artwork.json"),
                        "--all-cards", str(FIXTURES / "all_cards.json"), "--out", str(db)], check=True)
        subprocess.run([sys.executable, str(ML / "scripts" / "export_app_catalog.py"), "--db", str(db)], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
