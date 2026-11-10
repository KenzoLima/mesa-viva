using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace MtgAr.Data
{
    public enum ModelKind
    {
        Creature,
        Terrain,
        Prop,
        Spell,
    }

    public sealed class ModelChoice
    {
        public string ModelId;
        public ModelKind Kind;
        public string Reason;
        public List<string> Tint = new();
        public float Scale = 1f;
        /// <summary>Só terrenos: um bioma por cor de mana.</summary>
        public List<string> TerrainMix = new();
    }

    /// <summary>
    /// Escolhe o modelo 3D de cada carta a partir de Resources/Config/model_map.json.
    /// Porte de ml/mtgar_data/model_resolver.py — mesmas regras, mesmos textos de "motivo".
    ///
    /// Criaturas: escolha do usuário → byOracleId → subtipo (raças antes de classes) → família
    /// de subtipos → keyword → tipo (Artifact → golem) → cor (M = multicolor, C = incolor).
    /// </summary>
    public sealed class ModelResolver
    {
        const string ColorOrder = "WUBRG";

        readonly Dictionary<string, object> map;
        readonly Dictionary<string, string> userOverrides;
        readonly HashSet<string> classSubtypes;
        readonly Dictionary<string, (string family, string model)> familyBySubtype = new();
        readonly Dictionary<string, string> labels;

        public ModelResolver(Dictionary<string, object> modelMap, Dictionary<string, string> userOverrides = null)
        {
            map = modelMap;
            this.userOverrides = userOverrides ?? new Dictionary<string, string>();
            classSubtypes = new HashSet<string>(List("classSubtypes").Cast<string>());
            foreach (var pair in Dict("families"))
            {
                var spec = (Dictionary<string, object>)pair.Value;
                foreach (var subtype in ((List<object>)spec["subtypes"]).Cast<string>())
                    familyBySubtype[subtype] = (pair.Key, (string)spec["model"]);
            }
            labels = Strings(Dict("labels"));
        }

        public static ModelResolver FromJson(string json, Dictionary<string, string> userOverrides = null) =>
            new ModelResolver((Dictionary<string, object>)MiniJson.Parse(json), userOverrides);

        /// <summary>Nome amigável de um modelo ("dragon" → "Dragão"), vindo da seção "labels".</summary>
        public string Label(string modelId) => modelId != null && labels.TryGetValue(modelId, out var label) ? label : modelId;

        /// <summary>Todos os modelos de criatura conhecidos, na ordem do arquivo (para "Trocar modelo" e o Bestiário).</summary>
        public List<string> CreatureModels()
        {
            var models = new List<string>();
            void Add(string id) { if (!string.IsNullOrEmpty(id) && !models.Contains(id)) models.Add(id); }
            foreach (var value in Strings(Dict("bySubtype")).Values) Add(value);
            foreach (var spec in Dict("families").Values) Add((string)((Dictionary<string, object>)spec)["model"]);
            foreach (var value in Strings(Dict("byKeyword")).Values) Add(value);
            foreach (var value in Strings(Dict("byCreatureCardType")).Values) Add(value);
            foreach (var value in Strings(Dict("byColorFallback")).Values) Add(value);
            return models;
        }

        public ModelChoice Resolve(CardRecord card)
        {
            var tint = card.Colors.Count > 0 ? new List<string>(card.Colors) : new List<string> { "C" };
            if (card.HasType("Creature"))
                return ResolveCreature(card, tint);
            if (card.HasType("Land"))
                return ResolveLand(card);
            if (card.HasType("Instant") || card.HasType("Sorcery"))
            {
                var key = card.ColorKey;
                return new ModelChoice { ModelId = Str(Dict("spells"), key), Kind = ModelKind.Spell, Reason = $"mágica, cor {key}", Tint = tint };
            }
            return ResolveNonCreature(card, tint);
        }

        ModelChoice ResolveCreature(CardRecord card, List<string> tint)
        {
            var scale = ScaleForPower(card.Power);
            ModelChoice Choice(string modelId, string reason) =>
                new ModelChoice { ModelId = modelId, Kind = ModelKind.Creature, Reason = reason, Tint = tint, Scale = scale };

            if (userOverrides.TryGetValue(card.OracleId, out var userModel))
                return Choice(userModel, "escolha do usuário");
            var byOracle = Strings(Dict("byOracleId"));
            if (byOracle.TryGetValue(card.OracleId, out var heroModel))
                return Choice(heroModel, "modelo exclusivo da carta");

            var ordered = card.Subtypes.Where(s => !classSubtypes.Contains(s))
                .Concat(card.Subtypes.Where(s => classSubtypes.Contains(s))).ToList();
            var bySubtype = Strings(Dict("bySubtype"));
            foreach (var subtype in ordered)
                if (bySubtype.TryGetValue(subtype, out var model))
                    return Choice(model, $"subtipo {subtype}");
            foreach (var subtype in ordered)
                if (familyBySubtype.TryGetValue(subtype, out var family))
                    return Choice(family.model, $"família {family.family} ({subtype})");

            foreach (var pair in Strings(Dict("byKeyword")))
                if (card.Keywords.Contains(pair.Key))
                    return Choice(pair.Value, $"habilidade {pair.Key}");
            foreach (var pair in Strings(Dict("byCreatureCardType")))
                if (card.HasType(pair.Key))
                    return Choice(pair.Value, $"tipo {pair.Key}");

            var key = card.ColorKey;
            return Choice(Str(Dict("byColorFallback"), key), $"cor {key} (genérico)");
        }

        public float ScaleForPower(string power)
        {
            var spec = Dict("scale");
            float min = Num(spec, "min", 0.8f), max = Num(spec, "max", 1.6f);
            float lo = Num(spec, "powerAtMin", 1f), hi = Num(spec, "powerAtMax", 7f);
            if (power == null || !int.TryParse(power, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
                return 1f; // "*", "1+*", "X"
            var t = (Math.Min(Math.Max(value, lo), hi) - lo) / (hi - lo);
            return (float)Math.Round(min + t * (max - min), 3);
        }

        ModelChoice ResolveLand(CardRecord card)
        {
            var lands = Dict("lands");
            var bySubtype = Strings(Dict(lands, "bySubtype"));
            var byColor = Strings(Dict(lands, "byManaColor"));
            var biomes = new List<string>();
            foreach (var subtype in card.Subtypes)
                if (bySubtype.TryGetValue(subtype, out var biome) && !biomes.Contains(biome))
                    biomes.Add(biome);

            var reason = "tipo básico";
            if (biomes.Count == 0)
            {
                reason = "mana produzida";
                foreach (var color in ColorOrder)
                    if (card.ProducedMana.Contains(color.ToString()) && byColor.TryGetValue(color.ToString(), out var biome) && !biomes.Contains(biome))
                        biomes.Add(biome);
            }

            if (biomes.Count == 0)
            {
                var fallback = (string)lands["default"];
                return new ModelChoice
                {
                    ModelId = fallback, Kind = ModelKind.Terrain, Reason = "terreno incolor",
                    Tint = new List<string> { "C" }, TerrainMix = new List<string> { fallback },
                };
            }

            var tint = ColorOrder.Select(c => c.ToString()).Where(c => card.ProducedMana.Contains(c)).ToList();
            if (tint.Count == 0)
                tint.Add("C");
            return new ModelChoice { ModelId = biomes[0], Kind = ModelKind.Terrain, Reason = reason, Tint = tint, TerrainMix = biomes };
        }

        ModelChoice ResolveNonCreature(CardRecord card, List<string> tint)
        {
            if (userOverrides.TryGetValue(card.OracleId, out var userModel))
                return new ModelChoice { ModelId = userModel, Kind = ModelKind.Prop, Reason = "escolha do usuário", Tint = tint };
            var props = Strings(Dict("nonCreature"));
            foreach (var cardType in new[] { "Planeswalker", "Battle", "Artifact", "Enchantment" })
                if (card.HasType(cardType) && props.TryGetValue(cardType, out var model))
                    return new ModelChoice { ModelId = model, Kind = ModelKind.Prop, Reason = $"tipo {cardType}", Tint = tint };
            return new ModelChoice { ModelId = props["default"], Kind = ModelKind.Prop, Reason = "permanente genérico", Tint = tint };
        }

        // ---------- acesso ao JSON ----------

        Dictionary<string, object> Dict(string key) => Dict(map, key);

        static Dictionary<string, object> Dict(Dictionary<string, object> source, string key) =>
            source.TryGetValue(key, out var value) && value is Dictionary<string, object> d ? d : new Dictionary<string, object>();

        List<object> List(string key) =>
            map.TryGetValue(key, out var value) && value is List<object> l ? l : new List<object>();

        static Dictionary<string, string> Strings(Dictionary<string, object> source) =>
            source.Where(p => p.Value is string).ToDictionary(p => p.Key, p => (string)p.Value);

        static string Str(Dictionary<string, object> source, string key) =>
            source.TryGetValue(key, out var value) ? value as string : null;

        static float Num(Dictionary<string, object> source, string key, float fallback) =>
            source.TryGetValue(key, out var value) && value is double d ? (float)d : fallback;
    }
}
