"""Gera fixtures no formato do bulk data do Scryfall (dados de exemplo, IDs fictícios)."""
import json, sys, uuid
from pathlib import Path

out = Path(sys.argv[1])
def oid(name): return str(uuid.uuid5(uuid.NAMESPACE_URL, "oracle:" + name))
def sid(name, extra=""): return str(uuid.uuid5(uuid.NAMESPACE_URL, "scry:" + name + extra))
def img(name, extra=""):
    s = sid(name, extra)
    return {"small": f"https://cards.scryfall.io/small/front/{s[0]}/{s[1]}/{s}.jpg",
            "normal": f"https://cards.scryfall.io/normal/front/{s[0]}/{s[1]}/{s}.jpg",
            "large": f"https://cards.scryfall.io/large/front/{s[0]}/{s[1]}/{s}.jpg",
            "art_crop": f"https://cards.scryfall.io/art_crop/front/{s[0]}/{s[1]}/{s}.jpg"}

def card(name, type_line, colors, mana_cost="", power=None, toughness=None, keywords=(),
         produced=None, layout="normal", set_code="tst", number="1", lang="en", **extra):
    c = {"object": "card", "id": sid(name, set_code + number + lang), "oracle_id": oid(name),
         "name": name, "lang": lang, "layout": layout, "mana_cost": mana_cost, "cmc": 0.0,
         "type_line": type_line, "oracle_text": "", "colors": list(colors),
         "color_identity": list(colors), "keywords": list(keywords), "set": set_code,
         "collector_number": number, "digital": False,
         "illustration_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "ill:" + name + set_code)),
         "image_uris": img(name, set_code + number)}
    if power is not None: c["power"], c["toughness"] = power, toughness
    if produced is not None: c["produced_mana"] = list(produced)
    c.update(extra)
    return c

delver = card("Delver of Secrets // Insectile Aberration", "Creature — Human Wizard // Creature — Human Insect",
              [], layout="transform", keywords=["Transform"])
for k in ("colors", "image_uris", "illustration_id", "mana_cost"): delver.pop(k)
delver["color_identity"] = ["U"]
delver["card_faces"] = [
    {"object": "card_face", "name": "Delver of Secrets", "mana_cost": "{U}", "type_line": "Creature — Human Wizard",
     "oracle_text": "...", "colors": ["U"], "power": "1", "toughness": "1",
     "illustration_id": "11111111-0000-0000-0000-000000000001", "image_uris": img("Delver front")},
    {"object": "card_face", "name": "Insectile Aberration", "mana_cost": "", "type_line": "Creature — Human Insect",
     "oracle_text": "Flying", "colors": ["U"], "power": "3", "toughness": "2",
     "illustration_id": "11111111-0000-0000-0000-000000000002", "image_uris": img("Delver back")}]

fire_ice = card("Fire // Ice", "Instant // Instant", ["R", "U"], mana_cost="{1}{R} // {1}{U}", layout="split")
fire_ice["card_faces"] = [
    {"object": "card_face", "name": "Fire", "mana_cost": "{1}{R}", "type_line": "Instant", "oracle_text": "..."},
    {"object": "card_face", "name": "Ice", "mana_cost": "{1}{U}", "type_line": "Instant", "oracle_text": "..."}]

reversible = {"object": "card", "id": sid("Reversible Elves"), "name": "Llanowar Visionary // Llanowar Visionary",
              "lang": "en", "layout": "reversible_card", "set": "tst", "collector_number": "99",
              "digital": False, "keywords": [],
              "card_faces": [
                  {"object": "card_face", "oracle_id": oid("Llanowar Visionary"), "name": "Llanowar Visionary",
                   "mana_cost": "{2}{G}", "type_line": "Creature — Elf Druid", "oracle_text": "...",
                   "colors": ["G"], "power": "2", "toughness": "2", "image_uris": img("rev front"),
                   "illustration_id": "22222222-0000-0000-0000-000000000001"},
                  {"object": "card_face", "oracle_id": oid("Llanowar Visionary"), "name": "Llanowar Visionary",
                   "mana_cost": "{2}{G}", "type_line": "Creature — Elf Druid", "oracle_text": "...",
                   "colors": ["G"], "power": "2", "toughness": "2", "image_uris": img("rev back"),
                   "illustration_id": "22222222-0000-0000-0000-000000000002"}]}

oracle = [
    card("Llanowar Elves", "Creature — Elf Druid", ["G"], "{G}", "1", "1", produced=["G"]),
    card("Forest", "Basic Land — Forest", [], produced=["G"]),
    card("Island", "Basic Land — Island", [], produced=["U"]),
    card("Breeding Pool", "Land — Forest Island", [], produced=["G", "U"]),
    card("Llanowar Wastes", "Land", [], produced=["B", "C", "G"]),
    card("Wastes", "Basic Land", [], produced=["C"]),
    card("Dryad Arbor", "Land Creature — Forest Dryad", ["G"], power="1", toughness="1", produced=["G"]),
    card("Shivan Dragon", "Creature — Dragon", ["R"], "{4}{R}{R}", "5", "5", keywords=["Flying"]),
    card("Goblin Guide", "Creature — Goblin Scout", ["R"], "{R}", "2", "2", keywords=["Haste"]),
    card("Serra Angel", "Creature — Angel", ["W"], "{3}{W}{W}", "4", "4", keywords=["Flying", "Vigilance"]),
    card("Grizzly Bears", "Creature — Bear", ["G"], "{1}{G}", "2", "2"),
    card("Ornithopter", "Artifact Creature — Thopter", [], "{0}", "0", "2", keywords=["Flying"]),
    card("Myr Enforcer", "Artifact Creature — Myr", [], "{7}", "4", "4", keywords=["Affinity"]),
    card("Tarmogoyf", "Creature — Lhurgoyf", ["G"], "{1}{G}", "*", "1+*"),
    card("Progenitus", "Legendary Creature — Hydra Avatar", ["W", "U", "B", "R", "G"], power="10", toughness="10"),
    card("Jötun Grunt", "Creature — Giant Soldier", ["W"], "{1}{W}", "4", "4"),
    card("Lightning Bolt", "Instant", ["R"], "{R}"),
    card("Sol Ring", "Artifact", [], "{1}"),
    card("Liliana of the Veil", "Legendary Planeswalker — Liliana", ["B"], "{1}{B}{B}"),
    card("Aether Vial", "Artifact", [], "{1}"),
    delver, fire_ice, reversible,
    card("Goblin", "Token Creature — Goblin", ["R"], power="1", toughness="1", layout="token", set_code="ttst"),
    card("Shivan Dragon Art Card", "Card // Card", [], layout="art_series", set_code="atst"),
    card("A-Llanowar Elves", "Creature — Elf Druid", ["G"], "{G}", "1", "1", digital=True, set_code="ytst"),
]

artwork = [
    card("Llanowar Elves", "Creature — Elf Druid", ["G"], "{G}", "1", "1", set_code="m19", number="314"),
    card("Llanowar Elves", "Creature — Elf Druid", ["G"], "{G}", "1", "1", set_code="dom", number="168"),
    card("Forest", "Basic Land — Forest", [], set_code="one", number="276"),
    card("Forest", "Basic Land — Forest", [], set_code="one", number="277"),
    delver,
    card("Shivan Dragon Art Card", "Card // Card", [], layout="art_series", set_code="atst"),
    card("Unknown Card", "Creature — Elf", ["G"]),  # oracle_id que não está no banco
]

all_cards = oracle + [
    card("Llanowar Elves", "Creature — Elf Druid", ["G"], "{G}", "1", "1", lang="pt", set_code="m19",
         printed_name="Elfos de Llanowar"),
    card("Lightning Bolt", "Instant", ["R"], "{R}", lang="pt", set_code="m10", printed_name="Relâmpago"),
    card("Shivan Dragon", "Creature — Dragon", ["R"], lang="es", printed_name="Dragón de Shiva"),
]
dpt = json.loads(json.dumps(delver)); dpt["lang"] = "pt"; dpt["id"] = sid("delver pt")
dpt["card_faces"][0]["printed_name"] = "Explorador dos Segredos"
dpt["card_faces"][1]["printed_name"] = "Aberração Insetoide"
all_cards.append(dpt)

def dump(name, data):
    # Um objeto por linha, como nos arquivos reais do Scryfall.
    (out / name).write_text("[\n" + ",\n".join(json.dumps(o, ensure_ascii=False) for o in data) + "\n]\n", encoding="utf-8")

out.mkdir(parents=True, exist_ok=True)
dump("oracle_cards.json", oracle)
dump("unique_artwork.json", artwork)
dump("all_cards.json", all_cards)
print("fixtures ok", len(oracle), len(artwork), len(all_cards))
