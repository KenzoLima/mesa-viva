import filecmp
import json
import subprocess
import sys
from pathlib import Path

from mtgar_data.text_norm import normalize_name

ML = Path(__file__).parents[1]
REPO = ML.parent
SCRIPTS = ML / "scripts"
UNITY_CATALOG = REPO / "unity-app" / "Assets" / "StreamingAssets" / "Catalog"


def _read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")]
    return lines[0].split("\t"), [l.split("\t") for l in lines[1:]]


def test_export_writes_expected_columns(db, tmp_path):
    db.commit()
    out = tmp_path / "catalog"
    subprocess.run([sys.executable, str(SCRIPTS / "export_app_catalog.py"), "--db", str(db.path), "--out", str(out)],
                   check=True, capture_output=True, text=True)

    header, cards = _read_tsv(out / "cards.tsv")
    assert header[:2] == ["oracle_id", "name"] and len(header) == 12
    by_name = {row[1]: row for row in cards}
    assert len(cards) == db.count("cards")

    delver = by_name["Delver of Secrets // Insectile Aberration"]
    assert delver[5] == "Creature" and delver[6] == "Human|Wizard" and delver[7] == "U"
    goyf = by_name["Tarmogoyf"]
    assert (goyf[8], goyf[9]) == ("*", "1+*")
    pool = by_name["Breeding Pool"]
    assert pool[11] == "G|U" and pool[3] == "0"
    assert by_name["Goblin"][3] == "1"  # token

    header, names = _read_tsv(out / "names.tsv")
    assert header == ["norm_name", "oracle_id", "lang", "display_name"]
    pt = [row for row in names if row[2] == "pt"]
    assert ["elfos de llanowar", by_name["Llanowar Elves"][0], "pt", "Elfos de Llanowar"] in pt
    for row in names:
        assert row[0] == normalize_name(row[3])  # a chave é sempre a normalização do nome exibido


def test_no_field_contains_tabs_or_newlines(db, tmp_path):
    out = tmp_path / "catalog"
    subprocess.run([sys.executable, str(SCRIPTS / "export_app_catalog.py"), "--db", str(db.path), "--out", str(out)],
                   check=True, capture_output=True, text=True)
    for name in ("cards.tsv", "names.tsv"):
        header, rows = _read_tsv(out / name)
        assert all(len(row) == len(header) for row in rows)


def test_model_map_copies_are_identical():
    """O Unity lê a cópia em Assets/_Project/Config; as duas precisam ficar iguais."""
    assert filecmp.cmp(ML / "config" / "model_map.json",
                       REPO / "unity-app" / "Assets" / "_Project" / "Resources" / "Config" / "model_map.json", shallow=False)


def test_model_map_has_label_for_every_model():
    data = json.loads((ML / "config" / "model_map.json").read_text(encoding="utf-8"))
    used = set()

    def walk(node, key=None):
        if key in ("labels", "classSubtypes", "subtypes", "scale", "_comment", "version"):
            return
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, str):
            used.add(node)

    walk(data)
    assert used - set(data["labels"]) == set()


def test_sample_catalog_in_unity_is_up_to_date(tmp_path, fixtures_dir):
    """O catálogo de exemplo do app (gerado das fixtures) precisa bater com o exportador atual."""
    db_path = tmp_path / "cards.db"
    subprocess.run([sys.executable, str(SCRIPTS / "build_card_db.py"),
                    "--oracle", str(fixtures_dir / "oracle_cards.json"),
                    "--artwork", str(fixtures_dir / "unique_artwork.json"),
                    "--all-cards", str(fixtures_dir / "all_cards.json"), "--out", str(db_path)],
                   check=True, capture_output=True, text=True)
    out = tmp_path / "catalog"
    subprocess.run([sys.executable, str(SCRIPTS / "export_app_catalog.py"), "--db", str(db_path), "--out", str(out)],
                   check=True, capture_output=True, text=True)
    for name in ("cards.tsv", "names.tsv"):
        assert _read_tsv(out / name) == _read_tsv(UNITY_CATALOG / name), (
            f"{name} desatualizado: rode tools/make_sample_catalog.py")
