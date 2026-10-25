using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace MtgAr.Data
{
    public enum CardKind
    {
        Creature,
        Land,
        Spell,
        Permanent,
    }

    /// <summary>Uma carta (por oracle_id). Os tipos e subtipos são os da face frontal.</summary>
    public sealed class CardRecord
    {
        public string OracleId;
        public string Name;
        public string Layout;
        public bool IsToken;
        public string TypeLine;
        public List<string> CardTypes = new();
        public List<string> Subtypes = new();
        public List<string> Colors = new();
        public string Power;
        public string Toughness;
        public List<string> Keywords = new();
        public List<string> ProducedMana = new();

        public bool HasType(string cardType) => CardTypes.Contains(cardType);

        public CardKind Kind
        {
            get
            {
                if (HasType("Creature")) return CardKind.Creature;
                if (HasType("Land")) return CardKind.Land;
                if (HasType("Instant") || HasType("Sorcery")) return CardKind.Spell;
                return CardKind.Permanent;
            }
        }

        /// <summary>W, U, B, R, G; "M" para multicolor; "C" para incolor.</summary>
        public string ColorKey => Colors.Count == 0 ? "C" : Colors.Count > 1 ? "M" : Colors[0];
    }

    /// <summary>
    /// Catálogo de cartas do app, lido de dois TSV gerados por ml/scripts/export_app_catalog.py:
    ///   cards.tsv  oracle_id, name, layout, is_token, type_line, card_types, subtypes, colors,
    ///              power, toughness, keywords, produced_mana   (listas separadas por "|")
    ///   names.tsv  norm_name, oracle_id, lang, display_name     (nomes em inglês, de cada face e traduzidos)
    /// TSV em vez de SQLite: sem plugin nativo no iOS, e carrega as ~35 mil cartas em menos de um segundo.
    /// </summary>
    public sealed class CardCatalog
    {
        public const int SchemaVersion = 1;

        readonly Dictionary<string, CardRecord> byOracleId = new();
        readonly Dictionary<string, List<(string oracleId, string lang, string display)>> byName = new();

        public int CardCount => byOracleId.Count;
        public int NameCount => byName.Count;

        public static CardCatalog Load(TextReader cards, TextReader names)
        {
            var catalog = new CardCatalog();
            foreach (var fields in ReadRows(cards, 12))
            {
                var card = new CardRecord
                {
                    OracleId = fields[0],
                    Name = fields[1],
                    Layout = fields[2],
                    IsToken = fields[3] == "1",
                    TypeLine = fields[4],
                    CardTypes = SplitList(fields[5]),
                    Subtypes = SplitList(fields[6]),
                    Colors = SplitList(fields[7]),
                    Power = NullIfEmpty(fields[8]),
                    Toughness = NullIfEmpty(fields[9]),
                    Keywords = SplitList(fields[10]),
                    ProducedMana = SplitList(fields[11]),
                };
                catalog.byOracleId[card.OracleId] = card;
            }

            foreach (var fields in ReadRows(names, 4))
            {
                if (!catalog.byOracleId.ContainsKey(fields[1]))
                    continue;
                if (!catalog.byName.TryGetValue(fields[0], out var list))
                    catalog.byName[fields[0]] = list = new List<(string, string, string)>();
                list.Add((fields[1], fields[2], fields[3]));
            }
            return catalog;
        }

        public static CardCatalog Load(string cardsTsv, string namesTsv) =>
            Load(new StringReader(cardsTsv), new StringReader(namesTsv));

        public CardRecord Get(string oracleId) => oracleId != null && byOracleId.TryGetValue(oracleId, out var c) ? c : null;

        /// <summary>
        /// Cartas cujo nome (inglês, de uma face ou traduzido) bate com o texto.
        /// Cartas de jogo antes de tokens; nome em inglês antes de traduções — igual ao Python.
        /// </summary>
        public List<CardRecord> Lookup(string name)
        {
            if (!byName.TryGetValue(TextNormalizer.Normalize(name), out var matches))
                return new List<CardRecord>();

            return matches
                .GroupBy(m => m.oracleId)
                .Select(g => (card: byOracleId[g.Key], langRank: g.Any(m => m.lang == "en") ? 0 : 1))
                .OrderBy(x => x.card.IsToken ? 1 : 0)
                .ThenBy(x => x.langRank)
                .ThenBy(x => x.card.Name, StringComparer.Ordinal)
                .Select(x => x.card)
                .ToList();
        }

        public CardRecord Find(string name) => Lookup(name).FirstOrDefault();

        /// <summary>Até `limit` nomes parecidos (para "Você quis dizer…?"). Similaridade ≥ 0,75.</summary>
        public List<string> Suggest(string name, int limit = 3, float minSimilarity = 0.75f)
        {
            var key = TextNormalizer.Normalize(name);
            if (key.Length == 0)
                return new List<string>();

            return byName
                .Select(pair => (pair, score: Similarity(key, pair.Key)))
                .Where(x => x.score >= minSimilarity)
                .OrderByDescending(x => x.score)
                .ThenBy(x => x.pair.Key, StringComparer.Ordinal)
                .Take(limit)
                .Select(x => DisplayName(x.pair.Value))
                .ToList();
        }

        static string DisplayName(List<(string oracleId, string lang, string display)> entries)
        {
            foreach (var e in entries)
                if (e.lang == "en")
                    return e.display;
            return entries[0].display;
        }

        /// <summary>1 - distância de Levenshtein / tamanho do maior texto.</summary>
        public static float Similarity(string a, string b)
        {
            var longest = Math.Max(a.Length, b.Length);
            if (longest == 0)
                return 1f;
            // Corte barato: textos muito diferentes em tamanho nunca passam do limite.
            if (Math.Abs(a.Length - b.Length) > longest / 2)
                return 0f;
            return 1f - (float)Levenshtein(a, b) / longest;
        }

        public static int Levenshtein(string a, string b)
        {
            var previous = new int[b.Length + 1];
            var current = new int[b.Length + 1];
            for (var j = 0; j <= b.Length; j++)
                previous[j] = j;
            for (var i = 1; i <= a.Length; i++)
            {
                current[0] = i;
                for (var j = 1; j <= b.Length; j++)
                {
                    var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                    current[j] = Math.Min(Math.Min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + cost);
                }
                (previous, current) = (current, previous);
            }
            return previous[b.Length];
        }

        static IEnumerable<string[]> ReadRows(TextReader reader, int expectedFields)
        {
            string line;
            var header = true;
            while ((line = reader.ReadLine()) != null)
            {
                if (line.Length == 0 || line[0] == '#')
                    continue;
                if (header)
                {
                    header = false; // primeira linha não comentada = nomes das colunas
                    continue;
                }
                var fields = line.Split('\t');
                if (fields.Length < expectedFields)
                    throw new FormatException($"linha do catálogo com {fields.Length} colunas (esperado {expectedFields}): {line}");
                yield return fields;
            }
        }

        static List<string> SplitList(string value) =>
            string.IsNullOrEmpty(value) ? new List<string>() : value.Split('|').ToList();

        static string NullIfEmpty(string value) => string.IsNullOrEmpty(value) ? null : value;
    }
}
