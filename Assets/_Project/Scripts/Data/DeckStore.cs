using System;
using System.Collections.Generic;
using System.Linq;

namespace MtgAr.Data
{
    [Serializable]
    public class SavedCard
    {
        public string oracleId;
        public string name;
        public int quantity;
        /// <summary>Modelo escolhido pelo jogador em "Trocar modelo" (vazio = automático).</summary>
        public string modelOverride;
    }

    [Serializable]
    public class SavedDeck
    {
        public string id;
        public string name;
        public List<SavedCard> cards = new();

        public int Count => cards.Sum(c => c.quantity);

        public Dictionary<string, string> ModelOverrides() => cards
            .Where(c => !string.IsNullOrEmpty(c.modelOverride))
            .GroupBy(c => c.oracleId)
            .ToDictionary(g => g.Key, g => g.First().modelOverride);
    }

    /// <summary>Formato do arquivo decks.json (JsonUtility precisa de uma classe raiz).</summary>
    [Serializable]
    public class DeckLibrary
    {
        public int version = 1;
        public List<SavedDeck> decks = new();
    }

    /// <summary>Uma linha da prévia de importação.</summary>
    public sealed class ImportLine
    {
        public DeckEntry Entry;
        public DeckParseError Error;
        public CardRecord Card;
        public List<string> Suggestions = new();

        public bool Ok => Card != null;
    }

    /// <summary>
    /// Regras dos decks salvos (sem tocar em disco: quem salva é o AppServices, via JsonUtility).
    /// </summary>
    public sealed class DeckStore
    {
        public DeckLibrary Library { get; }

        public event Action Changed;

        public DeckStore(DeckLibrary library = null)
        {
            Library = library ?? new DeckLibrary();
        }

        public IReadOnlyList<SavedDeck> Decks => Library.decks;

        public SavedDeck Get(string id) => Library.decks.FirstOrDefault(d => d.id == id);

        /// <summary>Lê a lista colada e casa cada linha com o catálogo (para a prévia ao vivo).</summary>
        public static List<ImportLine> Preview(string text, CardCatalog catalog)
        {
            var parsed = DeckParser.Parse(text);
            var lines = parsed.Entries.Select(e =>
            {
                var card = catalog.Find(e.Name);
                return new ImportLine { Entry = e, Card = card, Suggestions = card == null ? catalog.Suggest(e.Name) : new List<string>() };
            });
            var errors = parsed.Errors.Select(err => new ImportLine { Error = err });
            return lines.Concat(errors).OrderBy(l => l.Entry?.LineNo ?? l.Error.LineNo).ToList();
        }

        /// <summary>
        /// Cria um deck com as cartas reconhecidas do deck principal (e do comandante), somando as
        /// linhas que apontam para a mesma carta ("4 Llanowar Elves" + "2 Elfos de Llanowar" = 6).
        /// </summary>
        public SavedDeck AddFromImport(string name, IEnumerable<ImportLine> lines)
        {
            var deck = new SavedDeck { id = Guid.NewGuid().ToString("N"), name = string.IsNullOrWhiteSpace(name) ? "Novo deck" : name.Trim() };
            foreach (var line in lines)
            {
                if (!line.Ok || (line.Entry.Section != DeckSection.Main && line.Entry.Section != DeckSection.Commander))
                    continue;
                var existing = deck.cards.FirstOrDefault(c => c.oracleId == line.Card.OracleId);
                if (existing != null)
                    existing.quantity += line.Entry.Quantity;
                else
                    deck.cards.Add(new SavedCard { oracleId = line.Card.OracleId, name = line.Card.Name, quantity = line.Entry.Quantity });
            }
            Library.decks.Add(deck);
            Changed?.Invoke();
            return deck;
        }

        public void SetModelOverride(string deckId, string oracleId, string modelId)
        {
            var deck = Get(deckId);
            if (deck == null)
                return;
            foreach (var card in deck.cards.Where(c => c.oracleId == oracleId))
                card.modelOverride = modelId;
            Changed?.Invoke();
        }

        public void Rename(string deckId, string name)
        {
            var deck = Get(deckId);
            if (deck == null || string.IsNullOrWhiteSpace(name))
                return;
            deck.name = name.Trim();
            Changed?.Invoke();
        }

        public bool Remove(string deckId)
        {
            var removed = Library.decks.RemoveAll(d => d.id == deckId) > 0;
            if (removed)
                Changed?.Invoke();
            return removed;
        }

        /// <summary>Cores do deck (W U B R G na ordem; "C" se só tiver incolores).</summary>
        public static List<string> Colors(SavedDeck deck, CardCatalog catalog)
        {
            var colors = new HashSet<string>();
            foreach (var card in deck.cards)
                foreach (var color in catalog.Get(card.oracleId)?.Colors ?? new List<string>())
                    colors.Add(color);
            var ordered = "WUBRG".Select(c => c.ToString()).Where(colors.Contains).ToList();
            return ordered.Count > 0 ? ordered : new List<string> { "C" };
        }

        public static int CountKind(SavedDeck deck, CardCatalog catalog, CardKind kind) =>
            deck.cards.Where(c => catalog.Get(c.oracleId)?.Kind == kind).Sum(c => c.quantity);
    }
}
