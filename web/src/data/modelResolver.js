// Porta de ml/mtgar_data/model_resolver.py (implementação de referência) e ModelResolver.cs.
// Mesmas regras, mesmos textos de "reason". Os testes em tests/ espelham ml/tests/test_model_resolver.py.

export const CREATURE = 'creature';
export const TERRAIN = 'terrain';
export const PROP = 'prop';
export const SPELL = 'spell';
const COLOR_ORDER = 'WUBRG';

export function colorKey(colors) {
  if (!colors || colors.length === 0) return 'C';
  if (colors.length > 1) return 'M';
  return colors[0];
}

const choice = (modelId, kind, reason, tint, scale = 1.0, terrainMix = []) =>
  ({ modelId, kind, reason, tint, scale, terrainMix });

export class ModelResolver {
  constructor(modelMap, userOverrides = {}) {
    this.map = modelMap;
    this.userOverrides = { ...userOverrides };
    this.classes = new Set(modelMap.classSubtypes ?? []);
    this.familyBySubtype = new Map();
    for (const [family, spec] of Object.entries(modelMap.families ?? {})) {
      for (const subtype of spec.subtypes) this.familyBySubtype.set(subtype, [family, spec.model]);
    }
  }

  label(modelId) {
    return this.map.labels?.[modelId] ?? modelId;
  }

  resolve(card) {
    const tint = card.colors.length ? card.colors : ['C'];
    if (card.hasType('Creature')) return this.#creature(card, tint);
    if (card.hasType('Land')) return this.#land(card);
    if (card.hasType('Instant') || card.hasType('Sorcery')) {
      const key = colorKey(card.colors);
      return choice(this.map.spells[key], SPELL, `mágica, cor ${key}`, tint);
    }
    return this.#nonCreature(card, tint);
  }

  #creature(card, tint) {
    const scale = this.scaleForPower(card.power);
    const pick = (id, reason) => choice(id, CREATURE, reason, tint, scale);

    if (card.oracleId in this.userOverrides) return pick(this.userOverrides[card.oracleId], 'escolha do usuário');
    const byOracle = this.map.byOracleId ?? {};
    if (card.oracleId in byOracle) return pick(byOracle[card.oracleId], 'modelo exclusivo da carta');

    // Raças antes de classes: em "Elf Druid" vale o Elfo, em "Human Wizard" vale o Humano.
    const ordered = [
      ...card.subtypes.filter((s) => !this.classes.has(s)),
      ...card.subtypes.filter((s) => this.classes.has(s)),
    ];
    // Raça + classe com modelo próprio ("Human Knight" -> cavaleiro) vence a raça sozinha.
    const byRaceClass = this.map.byRaceClass ?? {};
    for (const race of card.subtypes.filter((s) => !this.classes.has(s) && s in byRaceClass)) {
      for (const cls of card.subtypes.filter((s) => this.classes.has(s))) {
        if (cls in byRaceClass[race]) return pick(byRaceClass[race][cls], `subtipo ${race} ${cls}`);
      }
    }
    const bySubtype = this.map.bySubtype ?? {};
    for (const s of ordered) if (s in bySubtype) return pick(bySubtype[s], `subtipo ${s}`);
    for (const s of ordered) {
      const fam = this.familyBySubtype.get(s);
      if (fam) return pick(fam[1], `família ${fam[0]} (${s})`);
    }
    for (const [kw, id] of Object.entries(this.map.byKeyword ?? {})) {
      if (card.keywords.includes(kw)) return pick(id, `habilidade ${kw}`);
    }
    for (const [type, id] of Object.entries(this.map.byCreatureCardType ?? {})) {
      if (card.hasType(type)) return pick(id, `tipo ${type}`);
    }
    const key = colorKey(card.colors);
    return pick(this.map.byColorFallback[key], `cor ${key} (genérico)`);
  }

  scaleForPower(power) {
    const spec = this.map.scale ?? { min: 0.8, max: 1.6, powerAtMin: 1, powerAtMax: 7 };
    const value = power != null && /^-?\d+$/.test(String(power)) ? parseInt(power, 10) : null;
    if (value === null) return 1.0;
    const lo = spec.powerAtMin;
    const hi = spec.powerAtMax;
    const t = (Math.min(Math.max(value, lo), hi) - lo) / (hi - lo);
    return Math.round((spec.min + t * (spec.max - spec.min)) * 1000) / 1000;
  }

  #land(card) {
    const lands = this.map.lands;
    const biomes = [];
    for (const s of card.subtypes) {
      const b = lands.bySubtype[s];
      if (b && !biomes.includes(b)) biomes.push(b);
    }
    let reason = 'tipo básico';
    if (biomes.length === 0) {
      reason = 'mana produzida';
      for (const c of COLOR_ORDER) {
        if (card.producedMana.includes(c)) {
          const b = lands.byManaColor[c];
          if (!biomes.includes(b)) biomes.push(b);
        }
      }
    }
    if (biomes.length === 0) return choice(lands.default, TERRAIN, 'terreno incolor', ['C'], 1.0, [lands.default]);
    const tint = [...COLOR_ORDER].filter((c) => card.producedMana.includes(c));
    return choice(biomes[0], TERRAIN, reason, tint.length ? tint : ['C'], 1.0, biomes);
  }

  #nonCreature(card, tint) {
    if (card.oracleId in this.userOverrides) {
      return choice(this.userOverrides[card.oracleId], PROP, 'escolha do usuário', tint);
    }
    const props = this.map.nonCreature;
    for (const type of ['Planeswalker', 'Battle', 'Artifact', 'Enchantment']) {
      if (card.hasType(type) && type in props) return choice(props[type], PROP, `tipo ${type}`, tint);
    }
    return choice(props.default, PROP, 'permanente genérico', tint);
  }

  static async load(url = 'data/model_map.json', userOverrides = {}) {
    return new ModelResolver(await fetch(url).then((r) => r.json()), userOverrides);
  }
}
