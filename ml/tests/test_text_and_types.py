import pytest

from mtgar_data.text_norm import normalize_name
from mtgar_data.type_line import parse_type_line, split_faces


@pytest.mark.parametrize(
    "a, b",
    [
        ("Æther Vial", "Aether Vial"),
        ("Jötun Grunt", "jotun grunt"),
        ("Relâmpago", "relampago"),
        ("Urza’s Saga", "Urza's Saga"),
        ("  Llanowar   Elves ", "llanowar elves"),
        ("Fire/Ice", "Fire // Ice"),
        ("Fire / Ice", "fire // ice"),
    ],
)
def test_normalize_name_equivalences(a, b):
    assert normalize_name(a) == normalize_name(b)


def test_normalize_name_empty():
    assert normalize_name("") == ""


def test_parse_type_line_full():
    t = parse_type_line("Legendary Creature — Elf Druid")
    assert t.supertypes == ["Legendary"]
    assert t.card_types == ["Creature"]
    assert t.subtypes == ["Elf", "Druid"]


def test_parse_type_line_without_subtypes_and_multiple_types():
    t = parse_type_line("Artifact Creature")
    assert t.card_types == ["Artifact", "Creature"]
    assert t.subtypes == []
    assert parse_type_line("Basic Land").supertypes == ["Basic"]


def test_parse_type_line_uses_front_face_and_ascii_dash():
    t = parse_type_line("Creature - Human Wizard // Creature - Human Insect")
    assert t.subtypes == ["Human", "Wizard"]


def test_parse_type_line_empty():
    assert parse_type_line(None).card_types == []


def test_split_faces():
    assert split_faces("Instant // Instant") == ["Instant", "Instant"]
    assert split_faces(None) == []
