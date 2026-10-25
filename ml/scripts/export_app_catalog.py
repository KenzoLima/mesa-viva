#!/usr/bin/env python3
"""Exporta o banco de cartas (cards.db) para o catálogo do app Unity (dois TSV).

Uso:
    python scripts/export_app_catalog.py --db data/cards.db
    # grava em ../unity-app/Assets/StreamingAssets/Catalog/{cards,names}.tsv

Formato (lido por CardCatalog.cs; listas separadas por "|"):
    cards.tsv  oracle_id, name, layout, is_token, type_line, card_types, subtypes, colors,
               power, toughness, keywords, produced_mana
    names.tsv  norm_name, oracle_id, lang, display_name
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mtgar_data.card_db import CardDatabase  # noqa: E402

SCHEMA_VERSION = 1
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "unity-app" / "Assets" / "StreamingAssets" / "Catalog"
CARD_COLUMNS = ["oracle_id", "name", "layout", "is_token", "type_line", "card_types", "subtypes", "colors",
                "power", "toughness", "keywords", "produced_mana"]
NAME_COLUMNS = ["norm_name", "oracle_id", "lang", "display_name"]


def _clean(value) -> str:
    """Tab e quebra de linha quebrariam o TSV: viram espaço."""
    if value is None:
        return ""
    return str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")


def _join(values: list[str]) -> str:
    return "|".join(_clean(v) for v in values)


def export(db_path: Path, out_dir: Path) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with CardDatabase(db_path) as db:
        header = f"# mesa-viva catalog schema={SCHEMA_VERSION} exported_at={stamp} source_built_at={db.get_meta('built_at') or ''}\n"

        rows = db.conn.execute("SELECT * FROM cards ORDER BY name, oracle_id").fetchall()
        with open(out_dir / "cards.tsv", "w", encoding="utf-8", newline="\n") as f:
            f.write(header)
            f.write("\t".join(CARD_COLUMNS) + "\n")
            for row in rows:
                f.write("\t".join([
                    row["oracle_id"], _clean(row["name"]), row["layout"], "1" if row["is_token"] else "0",
                    _clean(row["type_line"]), _join(json.loads(row["card_types"])), _join(json.loads(row["subtypes"])),
                    _join(json.loads(row["colors"])), _clean(row["power"]), _clean(row["toughness"]),
                    _join(json.loads(row["keywords"])), _join(json.loads(row["produced_mana"])),
                ]) + "\n")

        names = db.conn.execute("SELECT * FROM names ORDER BY norm_name, oracle_id, lang").fetchall()
        with open(out_dir / "names.tsv", "w", encoding="utf-8", newline="\n") as f:
            f.write(header)
            f.write("\t".join(NAME_COLUMNS) + "\n")
            for row in names:
                f.write("\t".join([_clean(row["norm_name"]), row["oracle_id"], row["lang"], _clean(row["display_name"])]) + "\n")

    return {"cards": len(rows), "names": len(names)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=Path("data/cards.db"))
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    if not args.db.exists():
        print(f"ERRO: banco não encontrado: {args.db} (rode scripts/build_card_db.py antes)", file=sys.stderr)
        return 2
    counts = export(args.db, args.out)
    print(f"Catálogo exportado em {args.out}: {counts['cards']:,} cartas, {counts['names']:,} nomes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
