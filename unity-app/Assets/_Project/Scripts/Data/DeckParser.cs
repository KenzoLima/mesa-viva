using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace MtgAr.Data
{
    public enum DeckSection
    {
        Main,
        Sideboard,
        Commander,
        Companion,
        Maybeboard,
    }

    public sealed class DeckEntry
    {
        public int Quantity;
        public string Name;
        public DeckSection Section;
        public int LineNo;
        public string SetCode;
        public string CollectorNumber;
        public bool Foil;
    }

    public sealed class DeckParseError
    {
        public int LineNo;
        public string Text;
        public string Reason;
    }

    public sealed class ParsedDeck
    {
        public readonly List<DeckEntry> Entries = new();
        public readonly List<DeckParseError> Errors = new();

        public IEnumerable<DeckEntry> InSection(DeckSection section) => Entries.Where(e => e.Section == section);

        public int Count(DeckSection section = DeckSection.Main) => InSection(section).Sum(e => e.Quantity);
    }

    /// <summary>
    /// Lê listas de deck em texto (Arena, Moxfield, Archidekt, MTGO). Porte de ml/mtgar_data/deck_parser.py,
    /// com as mesmas regras e os mesmos casos de teste:
    ///   4 Llanowar Elves · 4x Llanowar Elves · 1 Shivan Dragon (DMR) 123 *F* · SB: 2 Duress · Llanowar Elves (= 1)
    /// Seções por cabeçalho (Deck, Sideboard, Commander… também em pt). Linhas em branco não mudam a seção.
    /// </summary>
    public static class DeckParser
    {
        public const string ErrorFormat = "formato não reconhecido (esperado: '4 Nome da Carta')";
        public const string ErrorQuantity = "quantidade precisa ser maior que zero";

        static readonly Dictionary<string, DeckSection> SectionHeaders = new()
        {
            ["deck"] = DeckSection.Main, ["main"] = DeckSection.Main, ["maindeck"] = DeckSection.Main,
            ["main deck"] = DeckSection.Main, ["mainboard"] = DeckSection.Main, ["baralho"] = DeckSection.Main,
            ["sideboard"] = DeckSection.Sideboard, ["side"] = DeckSection.Sideboard, ["reserva"] = DeckSection.Sideboard,
            ["commander"] = DeckSection.Commander, ["commanders"] = DeckSection.Commander, ["comandante"] = DeckSection.Commander,
            ["companion"] = DeckSection.Companion, ["companheiro"] = DeckSection.Companion,
            ["maybeboard"] = DeckSection.Maybeboard, ["maybe"] = DeckSection.Maybeboard, ["considering"] = DeckSection.Maybeboard,
        };

        static readonly HashSet<string> CategoryWords = new()
        {
            "creature", "creatures", "land", "lands", "instant", "instants", "sorcery", "sorceries",
            "artifact", "artifacts", "enchantment", "enchantments", "planeswalker", "planeswalkers",
            "battle", "battles", "spells", "other", "tokens",
            "criaturas", "terrenos", "magicas instantaneas", "mágicas instantâneas", "feiticos", "feitiços",
            "artefatos", "encantamentos", "outros",
        };

        static readonly Regex CardLine = new Regex(
            @"^(?<qty>\d+)\s*x?\s+(?<name>.+?)" +
            @"(?:\s+\((?<set>[A-Za-z0-9]{2,6})\)(?:\s+(?<number>[A-Za-z0-9\-★†]+))?)?" +
            @"(?:\s+(?<foil>\*[FE]\*))?\s*$",
            RegexOptions.Compiled);

        static readonly Regex CategoryHeader = new Regex(@"^[^\d].*\(\d+\)\s*$", RegexOptions.Compiled);
        static readonly Regex SideboardPrefix = new Regex(@"^SB:\s*", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        static readonly Regex LineBreaks = new Regex(@"\r\n|\r|\n", RegexOptions.Compiled);

        public static ParsedDeck Parse(string text)
        {
            var deck = new ParsedDeck();
            var section = DeckSection.Main;
            var lines = LineBreaks.Split(text ?? "");

            for (var i = 0; i < lines.Length; i++)
            {
                var raw = lines[i];
                var lineNo = i + 1;
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("//") || line.StartsWith("#"))
                    continue;

                if (SectionHeaders.TryGetValue(line.TrimEnd(':').Trim().ToLowerInvariant(), out var header))
                {
                    section = header;
                    continue;
                }

                var lineSection = section;
                if (SideboardPrefix.IsMatch(line))
                {
                    line = SideboardPrefix.Replace(line, "");
                    lineSection = DeckSection.Sideboard;
                    if (line.Length == 0)
                        continue;
                }

                if (CategoryHeader.IsMatch(line) || CategoryWords.Contains(line.TrimEnd(':').ToLowerInvariant()))
                    continue;

                var match = CardLine.Match(line);
                if (!match.Success && !char.IsDigit(line[0]))
                    match = CardLine.Match("1 " + line); // só o nome: 1 cópia

                if (!match.Success)
                {
                    deck.Errors.Add(new DeckParseError { LineNo = lineNo, Text = raw, Reason = ErrorFormat });
                    continue;
                }

                if (!int.TryParse(match.Groups["qty"].Value, out var quantity) || quantity <= 0)
                {
                    deck.Errors.Add(new DeckParseError { LineNo = lineNo, Text = raw, Reason = ErrorQuantity });
                    continue;
                }

                var set = match.Groups["set"];
                var number = match.Groups["number"];
                deck.Entries.Add(new DeckEntry
                {
                    Quantity = quantity,
                    Name = match.Groups["name"].Value.Trim(),
                    Section = lineSection,
                    LineNo = lineNo,
                    SetCode = set.Success ? set.Value.ToUpperInvariant() : null,
                    CollectorNumber = number.Success ? number.Value : null,
                    Foil = match.Groups["foil"].Success,
                });
            }
            return deck;
        }
    }
}
