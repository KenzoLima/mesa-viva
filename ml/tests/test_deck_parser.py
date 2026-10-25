from mtgar_data.deck_parser import COMMANDER, MAIN, SIDEBOARD, parse_deck


def test_basic_formats():
    deck = parse_deck(
        """
        4 Llanowar Elves
        4x Elvish Mystic
        1 Shivan Dragon (DMR) 123
        1 Delver of Secrets (ISD) 51 *F*
        2 Fire // Ice
        """
    )
    assert deck.errors == []
    entries = deck.entries
    assert [(e.quantity, e.name) for e in entries] == [
        (4, "Llanowar Elves"), (4, "Elvish Mystic"), (1, "Shivan Dragon"),
        (1, "Delver of Secrets"), (2, "Fire // Ice"),
    ]
    assert entries[2].set_code == "DMR" and entries[2].collector_number == "123"
    assert entries[3].foil and entries[3].set_code == "ISD"
    assert not entries[0].foil
    assert all(e.section == MAIN for e in entries)


def test_arena_sections():
    deck = parse_deck("Commander\n1 Progenitus\n\nDeck\n10 Forest\n\nSideboard\n2 Duress\n")
    assert [e.section for e in deck.entries] == [COMMANDER, MAIN, SIDEBOARD]
    assert deck.count(MAIN) == 10


def test_portuguese_headers_and_colon():
    deck = parse_deck("Baralho:\n4 Forest\nReserva:\n2 Duress\n")
    assert [e.section for e in deck.entries] == [MAIN, SIDEBOARD]


def test_blank_lines_do_not_change_section():
    deck = parse_deck("4 Forest\n\n2 Duress\n")
    assert all(e.section == MAIN for e in deck.entries)


def test_mtgo_sideboard_prefix():
    deck = parse_deck("4 Forest\nSB: 2 Duress\nSB:\n")
    assert deck.entries[1].section == SIDEBOARD
    assert deck.entries[1].name == "Duress"
    assert deck.errors == []


def test_category_headers_and_comments_are_ignored():
    deck = parse_deck("// meu deck\n# nota\nCreatures (4)\n4 Llanowar Elves\nLands\n20 Forest\nTerrenos:\n")
    assert [e.name for e in deck.entries] == ["Llanowar Elves", "Forest"]
    assert deck.errors == []


def test_name_without_quantity_counts_as_one():
    deck = parse_deck("Llanowar Elves\n")
    assert deck.entries[0].quantity == 1


def test_errors_keep_line_numbers():
    deck = parse_deck("4 Forest\n0 Island\n4 \n")
    assert [(e.line_no, e.reason) for e in deck.errors][0][0] == 2
    assert any(e.line_no == 3 for e in deck.errors)
