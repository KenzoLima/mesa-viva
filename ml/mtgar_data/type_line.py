"""Parser da linha de tipo ("Legendary Creature — Elf Druid")."""

from __future__ import annotations

from dataclasses import dataclass, field

SUPERTYPES = {"Basic", "Legendary", "Snow", "World", "Ongoing", "Elite", "Host"}
CARD_TYPES = {
    "Artifact", "Battle", "Conspiracy", "Creature", "Dungeon", "Emblem",
    "Enchantment", "Hero", "Instant", "Kindred", "Land", "Phenomenon", "Plane",
    "Planeswalker", "Scheme", "Sorcery", "Tribal", "Vanguard", "Token",
}
FACE_SEPARATOR = " // "


@dataclass(frozen=True)
class TypeLine:
    supertypes: list[str] = field(default_factory=list)
    card_types: list[str] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)

    def has_type(self, card_type: str) -> bool:
        return card_type in self.card_types


def parse_type_line(type_line: str | None) -> TypeLine:
    """Analisa a linha de tipo de UMA face.

    Palavras antes do travessão que não são supertipos conhecidos contam como
    tipos de carta, para não perder tipos novos criados pela Wizards.
    """
    if not type_line:
        return TypeLine()
    type_line = type_line.split(FACE_SEPARATOR)[0]
    left, sep, right = type_line.replace(" - ", " — ").partition("—")
    supertypes, card_types = [], []
    for word in left.split():
        (supertypes if word in SUPERTYPES else card_types).append(word)
    subtypes = right.split() if sep else []
    return TypeLine(supertypes, card_types, subtypes)


def split_faces(type_line: str | None) -> list[str]:
    """'Creature — Human // Creature — Insect' -> uma linha de tipo por face."""
    if not type_line:
        return []
    return [part.strip() for part in type_line.split(FACE_SEPARATOR)]
