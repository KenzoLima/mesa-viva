"""Liga as linhas de um deck às cartas do banco local."""

from __future__ import annotations

from dataclasses import dataclass, field

from .card_db import CardDatabase, CardRecord
from .deck_parser import DeckEntry, ParsedDeck


@dataclass(frozen=True)
class ResolvedEntry:
    entry: DeckEntry
    card: CardRecord


@dataclass(frozen=True)
class UnresolvedEntry:
    entry: DeckEntry
    suggestions: list[str]


@dataclass
class DeckResolution:
    resolved: list[ResolvedEntry] = field(default_factory=list)
    unresolved: list[UnresolvedEntry] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.unresolved

    def totals(self, section: str) -> list[tuple[CardRecord, int]]:
        """Quantidade por carta na seção, juntando linhas que apontam para a mesma carta
        (ex.: "4 Llanowar Elves" e "2 Elfos de Llanowar")."""
        totals: dict[str, tuple[CardRecord, int]] = {}
        for item in self.resolved:
            if item.entry.section != section:
                continue
            card, qty = totals.get(item.card.oracle_id, (item.card, 0))
            totals[item.card.oracle_id] = (card, qty + item.entry.quantity)
        return list(totals.values())


def resolve_deck(deck: ParsedDeck, db: CardDatabase) -> DeckResolution:
    result = DeckResolution()
    for entry in deck.entries:
        matches = db.lookup(entry.name)
        if matches:
            result.resolved.append(ResolvedEntry(entry, matches[0]))
        else:
            result.unresolved.append(UnresolvedEntry(entry, db.suggest(entry.name)))
    return result
