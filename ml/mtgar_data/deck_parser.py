"""Parser de listas de deck em texto (Arena, Moxfield, Archidekt, MTGO).

Formatos de linha aceitos:
    4 Llanowar Elves
    4x Llanowar Elves
    1 Shivan Dragon (DMR) 123
    1 Shivan Dragon (DMR) 123 *F*
    SB: 2 Duress
    Llanowar Elves          (sem quantidade = 1 cópia)

Seções: "Deck", "Sideboard", "Commander", "Companion", "Maybeboard" (com ou sem ":",
também em português). Cabeçalhos de categoria como "Creatures (20)" são ignorados.
Linhas em branco NÃO mudam de seção: a regra é previsível e não depende do site
de onde a lista foi exportada.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAIN, SIDEBOARD, COMMANDER, COMPANION, MAYBEBOARD = "main", "sideboard", "commander", "companion", "maybeboard"

_SECTION_HEADERS = {
    "deck": MAIN, "main": MAIN, "maindeck": MAIN, "main deck": MAIN, "mainboard": MAIN, "baralho": MAIN,
    "sideboard": SIDEBOARD, "side": SIDEBOARD, "reserva": SIDEBOARD,
    "commander": COMMANDER, "commanders": COMMANDER, "comandante": COMMANDER,
    "companion": COMPANION, "companheiro": COMPANION,
    "maybeboard": MAYBEBOARD, "maybe": MAYBEBOARD, "considering": MAYBEBOARD,
}

_CARD_LINE = re.compile(
    r"""^
    (?P<qty>\d+)\s*x?\s+                       # 4  /  4x
    (?P<name>.+?)                              # nome (não guloso)
    (?:\s+\((?P<set>[A-Za-z0-9]{2,6})\)        # (DMR)
       (?:\s+(?P<number>[A-Za-z0-9\-★†]+))?    # 123, 123a, ★
    )?
    (?:\s+(?P<foil>\*[FE]\*))?                 # *F* (foil) / *E* (etched)
    \s*$""",
    re.VERBOSE,
)
_CATEGORY_HEADER = re.compile(r"^[^\d].*\(\d+\)\s*$")  # "Creatures (20)"
_CATEGORY_WORDS = {
    "creature", "creatures", "land", "lands", "instant", "instants", "sorcery", "sorceries",
    "artifact", "artifacts", "enchantment", "enchantments", "planeswalker", "planeswalkers",
    "battle", "battles", "spells", "other", "tokens",
    "criaturas", "terrenos", "magicas instantaneas", "mágicas instantâneas", "feiticos", "feitiços",
    "artefatos", "encantamentos", "planeswalkers", "outros",
}
_SIDEBOARD_PREFIX = re.compile(r"^SB:\s*", re.IGNORECASE)


@dataclass(frozen=True)
class DeckEntry:
    quantity: int
    name: str
    section: str
    line_no: int
    set_code: str | None = None
    collector_number: str | None = None
    foil: bool = False


@dataclass(frozen=True)
class ParseError:
    line_no: int
    text: str
    reason: str


@dataclass
class ParsedDeck:
    entries: list[DeckEntry] = field(default_factory=list)
    errors: list[ParseError] = field(default_factory=list)

    def section(self, section: str) -> list[DeckEntry]:
        return [e for e in self.entries if e.section == section]

    def count(self, section: str = MAIN) -> int:
        return sum(e.quantity for e in self.section(section))


def _section_header(line: str) -> str | None:
    key = line.rstrip(":").strip().casefold()
    return _SECTION_HEADERS.get(key)


def parse_deck(text: str) -> ParsedDeck:
    deck = ParsedDeck()
    section = MAIN
    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("//") or line.startswith("#"):
            continue

        header = _section_header(line)
        if header:
            section = header
            continue

        line_section = section
        if _SIDEBOARD_PREFIX.match(line):
            line = _SIDEBOARD_PREFIX.sub("", line)
            line_section = SIDEBOARD
            if not line:
                continue

        if _CATEGORY_HEADER.match(line) or line.rstrip(":").casefold() in _CATEGORY_WORDS:
            # "Creatures (20)", "Lands": categorias do Archidekt/Moxfield, não mudam de seção.
            continue

        match = _CARD_LINE.match(line)
        if not match and not line[0].isdigit():
            # Linha só com o nome ("Llanowar Elves"): conta como 1 cópia.
            match = _CARD_LINE.match(f"1 {line}")
        if not match:
            deck.errors.append(ParseError(line_no, raw, "formato não reconhecido (esperado: '4 Nome da Carta')"))
            continue

        quantity = int(match["qty"])
        if quantity <= 0:
            deck.errors.append(ParseError(line_no, raw, "quantidade precisa ser maior que zero"))
            continue

        deck.entries.append(DeckEntry(
            quantity=quantity,
            name=match["name"].strip(),
            section=line_section,
            line_no=line_no,
            set_code=match["set"].upper() if match["set"] else None,
            collector_number=match["number"],
            foil=bool(match["foil"]),
        ))
    return deck
