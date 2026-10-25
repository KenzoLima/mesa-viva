import subprocess
import sys
from pathlib import Path

from mtgar_data.card_db import CardDatabase
from mtgar_data.deck_parser import parse_deck
from mtgar_data.deck_resolver import resolve_deck

SCRIPTS = Path(__file__).parents[1] / "scripts"


def test_skips_art_series_and_digital_cards(db):
    assert db.lookup("Shivan Dragon Art Card") == []
    assert db.lookup("A-Llanowar Elves") == []
    assert db.count("cards") == 24


def test_basic_card_fields(db):
    elves = db.lookup("Llanowar Elves")[0]
    assert elves.card_types == ["Creature"]
    assert elves.subtypes == ["Elf", "Druid"]
    assert elves.colors == ["G"]
    assert (elves.power, elves.toughness) == ("1", "1")


def test_transform_card_uses_front_face(db):
    delver = db.lookup("Delver of Secrets")[0]
    assert delver.name == "Delver of Secrets // Insectile Aberration"
    assert delver.subtypes == ["Human", "Wizard"]
    assert delver.colors == ["U"]  # vem das faces: o topo não tem "colors"
    assert delver.power == "1" and delver.mana_cost == "{U}"
    assert [f.name for f in delver.faces] == ["Delver of Secrets", "Insectile Aberration"]
    assert db.lookup("Insectile Aberration")[0].oracle_id == delver.oracle_id


def test_split_card_names(db):
    full = db.lookup("Fire // Ice")[0]
    assert db.lookup("Fire/Ice")[0].oracle_id == full.oracle_id
    assert db.lookup("Ice")[0].oracle_id == full.oracle_id
    assert full.card_types == ["Instant"]


def test_reversible_card_oracle_id_from_faces(db):
    card = db.lookup("Llanowar Visionary")[0]
    assert card.layout == "reversible_card"
    assert card.subtypes == ["Elf", "Druid"]
    assert card.colors == ["G"]


def test_star_power_is_kept_as_text(db):
    goyf = db.lookup("Tarmogoyf")[0]
    assert (goyf.power, goyf.toughness) == ("*", "1+*")


def test_tokens_are_found(db):
    goblins = db.lookup("Goblin")
    assert len(goblins) == 1 and goblins[0].is_token


def test_accents_and_ligatures(db):
    assert db.lookup("Jotun Grunt")[0].name == "Jötun Grunt"
    assert db.lookup("Æther Vial")[0].name == "Aether Vial"


def test_portuguese_names(db):
    assert db.lookup("Elfos de Llanowar")[0].name == "Llanowar Elves"
    assert db.lookup("relampago")[0].name == "Lightning Bolt"
    assert db.lookup("Aberração Insetoide")[0].name.startswith("Delver of Secrets")


def test_only_requested_languages_are_loaded_by_build_script(tmp_path, fixtures_dir):
    out = tmp_path / "cards.db"
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "build_card_db.py"),
         "--oracle", str(fixtures_dir / "oracle_cards.json"),
         "--artwork", str(fixtures_dir / "unique_artwork.json"),
         "--all-cards", str(fixtures_dir / "all_cards.json"),
         "--langs", "pt", "--out", str(out)],
        capture_output=True, text=True, check=True,
    )
    assert "Banco gerado" in result.stdout
    with CardDatabase(out) as built:
        assert built.lookup("Relâmpago")
        assert built.lookup("Dragón de Shiva") == []  # espanhol não foi pedido
        assert built.get_meta("langs") == "pt"
        assert built.get_meta("built_at")


def test_artworks(db):
    elves = db.lookup("Llanowar Elves")[0]
    rows = db.conn.execute("SELECT set_code FROM artworks WHERE oracle_id = ? ORDER BY set_code",
                           (elves.oracle_id,)).fetchall()
    assert [r[0] for r in rows] == ["dom", "m19"]
    delver = db.lookup("Delver of Secrets")[0]
    faces = db.conn.execute("SELECT face_index, illustration_id FROM artworks WHERE oracle_id = ?",
                            (delver.oracle_id,)).fetchall()
    assert sorted(f[0] for f in faces) == [0, 1]
    assert db.count("artworks") == 6  # art_series e carta desconhecida ficam de fora


def test_suggestions(db):
    assert "Llanowar Elves" in db.suggest("Llanowar Elfs")
    assert db.suggest("xyzxyzxyz") == []


def test_resolve_deck(db, fixtures_dir):
    deck = parse_deck((fixtures_dir / "sample_deck.txt").read_text(encoding="utf-8"))
    resolution = resolve_deck(deck, db)
    assert resolution.ok, resolution.unresolved
    names = {r.card.name for r in resolution.resolved}
    assert {"Llanowar Elves", "Fire // Ice", "Jötun Grunt", "Lightning Bolt"} <= names


def test_resolve_deck_reports_unknown_with_suggestion(db):
    resolution = resolve_deck(parse_deck("4 Llanowar Elfs\n"), db)
    assert not resolution.ok
    assert resolution.unresolved[0].suggestions[0] == "Llanowar Elves"


def test_totals_merge_lines_of_the_same_card(db):
    deck = parse_deck("4 Llanowar Elves\n2 Elfos de Llanowar\n10 Forest\nSB: 1 Llanowar Elves\n")
    resolution = resolve_deck(deck, db)
    main = {card.name: qty for card, qty in resolution.totals("main")}
    assert main == {"Llanowar Elves": 6, "Forest": 10}
    assert [(c.name, q) for c, q in resolution.totals("sideboard")] == [("Llanowar Elves", 1)]
