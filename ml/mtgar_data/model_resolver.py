"""Escolhe o modelo 3D de cada carta a partir do `model_map.json`.

Esta é a implementação de referência: o `ModelResolver` em C# do app deve seguir
exatamente as mesmas regras (e os mesmos testes) para o arquivo valer nos dois lados.

Prioridade para criaturas:
  1. override do usuário (por oracle_id)
  2. byOracleId (cartas "hero")
  3. subtipo direto (raças antes de classes)
  4. família de subtipos (Wolf/Hound/Dog -> canino)
  5. keyword (Flying -> alado)
  6. tipo de carta da criatura (Artifact -> golem)
  7. fallback pela cor (M = multicolor, C = incolor)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .card_db import CardRecord

CREATURE, TERRAIN, PROP, SPELL = "creature", "terrain", "prop", "spell"
COLOR_ORDER = "WUBRG"


@dataclass(frozen=True)
class ModelChoice:
    model_id: str
    kind: str
    reason: str
    tint: list[str]
    scale: float = 1.0
    terrain_mix: list[str] = field(default_factory=list)  # só terrenos: um bioma por cor de mana


def color_key(colors: list[str]) -> str:
    if not colors:
        return "C"
    if len(colors) > 1:
        return "M"
    return colors[0]


class ModelResolver:
    def __init__(self, model_map: dict[str, Any], user_overrides: dict[str, str] | None = None):
        self.map = model_map
        self.user_overrides = dict(user_overrides or {})
        self._classes = set(model_map.get("classSubtypes", []))
        self._family_by_subtype: dict[str, tuple[str, str]] = {}
        for family, spec in model_map.get("families", {}).items():
            for subtype in spec["subtypes"]:
                self._family_by_subtype[subtype] = (family, spec["model"])

    @classmethod
    def from_file(cls, path: str | Path, user_overrides: dict[str, str] | None = None) -> "ModelResolver":
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f), user_overrides)

    def resolve(self, card: CardRecord) -> ModelChoice:
        tint = card.colors or ["C"]
        if card.has_type("Creature"):
            return self._resolve_creature(card, tint)
        if card.has_type("Land"):
            return self._resolve_land(card)
        if card.has_type("Instant") or card.has_type("Sorcery"):
            key = color_key(card.colors)
            return ModelChoice(self.map["spells"][key], SPELL, f"mágica, cor {key}", tint)
        return self._resolve_noncreature(card, tint)

    # ---------- criaturas ----------

    def _resolve_creature(self, card: CardRecord, tint: list[str]) -> ModelChoice:
        scale = self.scale_for_power(card.power)

        def choice(model_id: str, reason: str) -> ModelChoice:
            return ModelChoice(model_id, CREATURE, reason, tint, scale)

        if card.oracle_id in self.user_overrides:
            return choice(self.user_overrides[card.oracle_id], "escolha do usuário")
        if card.oracle_id in self.map.get("byOracleId", {}):
            return choice(self.map["byOracleId"][card.oracle_id], "modelo exclusivo da carta")

        # Raças antes de classes: em "Elf Druid" vale o Elfo, em "Human Wizard" vale o Humano.
        ordered = [s for s in card.subtypes if s not in self._classes]
        ordered += [s for s in card.subtypes if s in self._classes]
        by_subtype = self.map.get("bySubtype", {})
        for subtype in ordered:
            if subtype in by_subtype:
                return choice(by_subtype[subtype], f"subtipo {subtype}")
        for subtype in ordered:
            if subtype in self._family_by_subtype:
                family, model_id = self._family_by_subtype[subtype]
                return choice(model_id, f"família {family} ({subtype})")

        for keyword, model_id in self.map.get("byKeyword", {}).items():
            if keyword in card.keywords:
                return choice(model_id, f"habilidade {keyword}")
        for card_type, model_id in self.map.get("byCreatureCardType", {}).items():
            if card.has_type(card_type):
                return choice(model_id, f"tipo {card_type}")

        key = color_key(card.colors)
        return choice(self.map["byColorFallback"][key], f"cor {key} (genérico)")

    def scale_for_power(self, power: str | None) -> float:
        spec = self.map.get("scale", {"min": 0.8, "max": 1.6, "powerAtMin": 1, "powerAtMax": 7})
        try:
            value = int(power) if power is not None else None
        except ValueError:
            value = None  # "*", "1+*", "X"
        if value is None:
            return 1.0
        lo, hi = spec["powerAtMin"], spec["powerAtMax"]
        t = (min(max(value, lo), hi) - lo) / (hi - lo)
        return round(spec["min"] + t * (spec["max"] - spec["min"]), 3)

    # ---------- terrenos ----------

    def _resolve_land(self, card: CardRecord) -> ModelChoice:
        lands = self.map["lands"]
        biomes: list[str] = []
        for subtype in card.subtypes:
            biome = lands["bySubtype"].get(subtype)
            if biome and biome not in biomes:
                biomes.append(biome)
        reason = "tipo básico"
        if not biomes:
            reason = "mana produzida"
            for color in COLOR_ORDER:
                if color in card.produced_mana:
                    biome = lands["byManaColor"][color]
                    if biome not in biomes:
                        biomes.append(biome)
        if not biomes:
            return ModelChoice(lands["default"], TERRAIN, "terreno incolor", ["C"], terrain_mix=[lands["default"]])
        tint = [c for c in COLOR_ORDER if c in card.produced_mana] or ["C"]
        return ModelChoice(biomes[0], TERRAIN, reason, tint, terrain_mix=biomes)

    # ---------- outros permanentes ----------

    def _resolve_noncreature(self, card: CardRecord, tint: list[str]) -> ModelChoice:
        if card.oracle_id in self.user_overrides:
            return ModelChoice(self.user_overrides[card.oracle_id], PROP, "escolha do usuário", tint)
        props = self.map["nonCreature"]
        for card_type in ("Planeswalker", "Battle", "Artifact", "Enchantment"):
            if card.has_type(card_type) and card_type in props:
                return ModelChoice(props[card_type], PROP, f"tipo {card_type}", tint)
        return ModelChoice(props["default"], PROP, "permanente genérico", tint)
