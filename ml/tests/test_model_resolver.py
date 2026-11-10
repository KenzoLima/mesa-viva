import pytest

from mtgar_data.model_resolver import CREATURE, PROP, SPELL, TERRAIN, ModelResolver


def pick(db, resolver, name):
    return resolver.resolve(db.lookup(name)[0])


@pytest.mark.parametrize(
    "name, model, reason",
    [
        ("Llanowar Elves", "elf", "subtipo Elf"),          # Elf (raça) vence Druid (classe)
        ("Goblin Guide", "goblin", "subtipo Goblin"),       # Goblin vence Scout
        ("Delver of Secrets", "human", "subtipo Human"),    # Human vence Wizard
        ("Jötun Grunt", "giant", "subtipo Giant"),          # Giant vence Soldier
        ("Grizzly Bears", "beast", "família beast (Bear)"),
        ("Progenitus", "lizard", "família reptile (Hydra)"),
        ("Ornithopter", "winged", "habilidade Flying"),
        ("Myr Enforcer", "golem", "tipo Artifact"),
        ("Tarmogoyf", "elemental", "cor G (genérico)"),
        ("Dryad Arbor", "elemental", "cor G (genérico)"),   # terreno-criatura usa a criatura
    ],
)
def test_creature_priorities(db, resolver, name, model, reason):
    choice = pick(db, resolver, name)
    assert (choice.model_id, choice.kind, choice.reason) == (model, CREATURE, reason)


def test_oracle_override_and_user_override_win(db, resolver):
    elves = db.lookup("Llanowar Elves")[0]
    hero = ModelResolver({**resolver.map, "byOracleId": {elves.oracle_id: "elf_hero"}})
    assert hero.resolve(elves).model_id == "elf_hero"
    user = ModelResolver({**resolver.map, "byOracleId": {elves.oracle_id: "elf_hero"}},
                         user_overrides={elves.oracle_id: "my_elf"})
    assert user.resolve(elves).model_id == "my_elf"
    assert user.resolve(elves).reason == "escolha do usuário"


def test_multicolor_fallback(resolver, db):
    card = db.lookup("Tarmogoyf")[0]
    card.colors = ["G", "U"]
    assert resolver.resolve(card).model_id == resolver.map["byColorFallback"]["M"]


@pytest.mark.parametrize(
    "power, scale",
    [("0", 0.8), ("1", 0.8), ("4", 1.2), ("7", 1.6), ("10", 1.6), ("*", 1.0), (None, 1.0), ("1+*", 1.0)],
)
def test_scale_by_power(resolver, power, scale):
    assert resolver.scale_for_power(power) == pytest.approx(scale)


def test_lands(db, resolver):
    forest = pick(db, resolver, "Forest")
    assert (forest.model_id, forest.kind, forest.terrain_mix) == ("terrain_forest", TERRAIN, ["terrain_forest"])

    pool = pick(db, resolver, "Breeding Pool")
    assert pool.terrain_mix == ["terrain_forest", "terrain_water"]
    assert pool.reason == "tipo básico"

    wastes = pick(db, resolver, "Llanowar Wastes")
    assert wastes.terrain_mix == ["terrain_swamp", "terrain_forest"]
    assert wastes.reason == "mana produzida"

    colorless = pick(db, resolver, "Wastes")
    assert colorless.model_id == "terrain_wasteland"


def test_spells_and_props(db, resolver):
    bolt = pick(db, resolver, "Lightning Bolt")
    assert (bolt.model_id, bolt.kind) == ("vfx_fire", SPELL)
    fire_ice = pick(db, resolver, "Fire // Ice")
    assert fire_ice.model_id == "vfx_prism"  # vermelho e azul
    assert pick(db, resolver, "Sol Ring").model_id == "prop_artifact"
    liliana = pick(db, resolver, "Liliana of the Veil")
    assert (liliana.model_id, liliana.kind) == ("hero_planeswalker", PROP)


def test_every_model_map_section_is_consistent(resolver):
    m = resolver.map
    assert set(m["byColorFallback"]) == set("WUBRGMC")
    assert set(m["spells"]) == set("WUBRGMC")
    assert set(m["lands"]["byManaColor"]) == set("WUBRG")
    for family in m["families"].values():
        assert family["model"] and family["subtypes"]
