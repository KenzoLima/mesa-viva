using System.Collections.Generic;
using System.IO;
using System.Linq;
using MtgAr.Data;
using NUnit.Framework;

namespace MtgAr.Tests
{
    // Estes testes espelham ml/tests/test_text_and_types.py, test_deck_parser.py, test_card_db.py e
    // test_model_resolver.py: as mesmas entradas precisam dar as mesmas saídas no Python e no app.

    public class TextNormalizerTests
    {
        [Test]
        public void Equivalences()
        {
            var pairs = new[]
            {
                ("Æther Vial", "Aether Vial"), ("Jötun Grunt", "jotun grunt"), ("Relâmpago", "relampago"),
                ("Urza’s Saga", "Urza's Saga"), ("  Llanowar   Elves ", "llanowar elves"),
                ("Fire/Ice", "Fire // Ice"), ("Fire / Ice", "fire // ice"),
            };
            foreach (var (a, b) in pairs)
                Assert.AreEqual(TextNormalizer.Normalize(b), TextNormalizer.Normalize(a), a);
        }

        [Test]
        public void ExactKeys()
        {
            Assert.AreEqual("elfos de llanowar", TextNormalizer.Normalize("Elfos de Llanowar"));
            Assert.AreEqual("fire // ice", TextNormalizer.Normalize("Fire//Ice"));
            Assert.AreEqual("", TextNormalizer.Normalize(""));
            Assert.AreEqual("", TextNormalizer.Normalize(null));
        }
    }

    public class DeckParserTests
    {
        [Test]
        public void BasicFormats()
        {
            var deck = DeckParser.Parse("\n4 Llanowar Elves\n4x Elvish Mystic\n1 Shivan Dragon (DMR) 123\n1 Delver of Secrets (ISD) 51 *F*\n2 Fire // Ice\n");
            Assert.AreEqual(0, deck.Errors.Count);
            CollectionAssert.AreEqual(
                new[] { "4 Llanowar Elves", "4 Elvish Mystic", "1 Shivan Dragon", "1 Delver of Secrets", "2 Fire // Ice" },
                deck.Entries.Select(e => $"{e.Quantity} {e.Name}").ToList());
            Assert.AreEqual("DMR", deck.Entries[2].SetCode);
            Assert.AreEqual("123", deck.Entries[2].CollectorNumber);
            Assert.IsTrue(deck.Entries[3].Foil);
            Assert.AreEqual("ISD", deck.Entries[3].SetCode);
            Assert.IsFalse(deck.Entries[0].Foil);
            Assert.IsTrue(deck.Entries.All(e => e.Section == DeckSection.Main));
        }

        [Test]
        public void ArenaSections()
        {
            var deck = DeckParser.Parse("Commander\n1 Progenitus\n\nDeck\n10 Forest\n\nSideboard\n2 Duress\n");
            CollectionAssert.AreEqual(new[] { DeckSection.Commander, DeckSection.Main, DeckSection.Sideboard },
                deck.Entries.Select(e => e.Section).ToList());
            Assert.AreEqual(10, deck.Count(DeckSection.Main));
        }

        [Test]
        public void PortugueseHeadersAndColon()
        {
            var deck = DeckParser.Parse("Baralho:\n4 Forest\nReserva:\n2 Duress\n");
            CollectionAssert.AreEqual(new[] { DeckSection.Main, DeckSection.Sideboard }, deck.Entries.Select(e => e.Section).ToList());
        }

        [Test]
        public void BlankLinesDoNotChangeSection()
        {
            var deck = DeckParser.Parse("4 Forest\n\n2 Duress\n");
            Assert.IsTrue(deck.Entries.All(e => e.Section == DeckSection.Main));
        }

        [Test]
        public void MtgoSideboardPrefix()
        {
            var deck = DeckParser.Parse("4 Forest\nSB: 2 Duress\nSB:\n");
            Assert.AreEqual(DeckSection.Sideboard, deck.Entries[1].Section);
            Assert.AreEqual("Duress", deck.Entries[1].Name);
            Assert.AreEqual(0, deck.Errors.Count);
        }

        [Test]
        public void CategoryHeadersAndCommentsAreIgnored()
        {
            var deck = DeckParser.Parse("// meu deck\n# nota\nCreatures (4)\n4 Llanowar Elves\nLands\n20 Forest\nTerrenos:\n");
            CollectionAssert.AreEqual(new[] { "Llanowar Elves", "Forest" }, deck.Entries.Select(e => e.Name).ToList());
            Assert.AreEqual(0, deck.Errors.Count);
        }

        [Test]
        public void NameWithoutQuantityCountsAsOne()
        {
            Assert.AreEqual(1, DeckParser.Parse("Llanowar Elves\n").Entries[0].Quantity);
        }

        [Test]
        public void ErrorsKeepLineNumbers()
        {
            var deck = DeckParser.Parse("4 Forest\n0 Island\n4 \n");
            Assert.AreEqual(2, deck.Errors[0].LineNo);
            Assert.IsTrue(deck.Errors.Any(e => e.LineNo == 3));
        }

        [Test]
        public void WindowsLineEndings()
        {
            var deck = DeckParser.Parse("Deck\r\n4 Forest\r\nSideboard\r\n1 Duress\r\n");
            Assert.AreEqual(2, deck.Entries.Count);
            Assert.AreEqual(DeckSection.Sideboard, deck.Entries[1].Section);
        }
    }

    public class CardCatalogTests
    {
        static CardCatalog Catalog => DataTestUtil.Catalog;

        [Test]
        public void LoadsSampleCatalog_WithoutDigitalOrArtSeries()
        {
            Assert.AreEqual(24, Catalog.CardCount);
            Assert.IsNull(Catalog.Find("Shivan Dragon Art Card"));
            Assert.IsNull(Catalog.Find("A-Llanowar Elves"));
        }

        [Test]
        public void BasicFields()
        {
            var elves = Catalog.Find("Llanowar Elves");
            CollectionAssert.AreEqual(new[] { "Creature" }, elves.CardTypes);
            CollectionAssert.AreEqual(new[] { "Elf", "Druid" }, elves.Subtypes);
            CollectionAssert.AreEqual(new[] { "G" }, elves.Colors);
            Assert.AreEqual("1", elves.Power);
            Assert.AreEqual(CardKind.Creature, elves.Kind);
        }

        [Test]
        public void TransformCard_FrontAndBackNames()
        {
            var delver = Catalog.Find("Delver of Secrets");
            Assert.AreEqual("Delver of Secrets // Insectile Aberration", delver.Name);
            CollectionAssert.AreEqual(new[] { "Human", "Wizard" }, delver.Subtypes);
            CollectionAssert.AreEqual(new[] { "U" }, delver.Colors);
            Assert.AreEqual(delver.OracleId, Catalog.Find("Insectile Aberration").OracleId);
        }

        [Test]
        public void SplitCardNames()
        {
            var full = Catalog.Find("Fire // Ice");
            Assert.AreEqual(full.OracleId, Catalog.Find("Fire/Ice").OracleId);
            Assert.AreEqual(full.OracleId, Catalog.Find("Ice").OracleId);
            Assert.AreEqual(CardKind.Spell, full.Kind);
        }

        [Test]
        public void StarPowerAndTokens()
        {
            var goyf = Catalog.Find("Tarmogoyf");
            Assert.AreEqual("*", goyf.Power);
            Assert.AreEqual("1+*", goyf.Toughness);
            var goblin = Catalog.Lookup("Goblin");
            Assert.AreEqual(1, goblin.Count);
            Assert.IsTrue(goblin[0].IsToken);
        }

        [Test]
        public void AccentsLigaturesAndPortuguese()
        {
            Assert.AreEqual("Jötun Grunt", Catalog.Find("Jotun Grunt").Name);
            Assert.AreEqual("Aether Vial", Catalog.Find("Æther Vial").Name);
            Assert.AreEqual("Llanowar Elves", Catalog.Find("Elfos de Llanowar").Name);
            Assert.AreEqual("Lightning Bolt", Catalog.Find("relampago").Name);
            Assert.IsTrue(Catalog.Find("Aberração Insetoide").Name.StartsWith("Delver of Secrets"));
        }

        [Test]
        public void Suggestions()
        {
            Assert.AreEqual("Llanowar Elves", Catalog.Suggest("Llanowar Elfs")[0]);
            Assert.AreEqual(0, Catalog.Suggest("xyzxyzxyz").Count);
        }
    }

    public class ModelResolverTests
    {
        static ModelChoice Pick(string name) => DataTestUtil.Resolver.Resolve(DataTestUtil.Catalog.Find(name));

        [Test]
        public void CreaturePriorities_MatchPython()
        {
            var cases = new[]
            {
                ("Llanowar Elves", "elf", "subtipo Elf"),
                ("Goblin Guide", "goblin", "subtipo Goblin"),
                ("Delver of Secrets", "human", "subtipo Human"),
                ("Jötun Grunt", "giant", "subtipo Giant"),
                ("Grizzly Bears", "beast", "família beast (Bear)"),
                ("Progenitus", "lizard", "família reptile (Hydra)"),
                ("Ornithopter", "winged", "habilidade Flying"),
                ("Myr Enforcer", "golem", "tipo Artifact"),
                ("Tarmogoyf", "elemental", "cor G (genérico)"),
                ("Dryad Arbor", "elemental", "cor G (genérico)"),
            };
            foreach (var (name, model, reason) in cases)
            {
                var choice = Pick(name);
                Assert.AreEqual(model, choice.ModelId, name);
                Assert.AreEqual(ModelKind.Creature, choice.Kind, name);
                Assert.AreEqual(reason, choice.Reason, name);
            }
        }

        [Test]
        public void UserOverrideWins()
        {
            var elves = DataTestUtil.Catalog.Find("Llanowar Elves");
            var resolver = ModelResolver.FromJson(DataTestUtil.ModelMapJson, new Dictionary<string, string> { [elves.OracleId] = "my_elf" });
            var choice = resolver.Resolve(elves);
            Assert.AreEqual("my_elf", choice.ModelId);
            Assert.AreEqual("escolha do usuário", choice.Reason);
        }

        [Test]
        public void ScaleByPower()
        {
            var expected = new (string power, float scale)[] { ("0", 0.8f), ("1", 0.8f), ("4", 1.2f), ("7", 1.6f), ("10", 1.6f), ("*", 1f), (null, 1f), ("1+*", 1f) };
            foreach (var (power, scale) in expected)
                Assert.AreEqual(scale, DataTestUtil.Resolver.ScaleForPower(power), 1e-4f, power ?? "null");
        }

        [Test]
        public void Lands()
        {
            var forest = Pick("Forest");
            Assert.AreEqual("terrain_forest", forest.ModelId);
            Assert.AreEqual(ModelKind.Terrain, forest.Kind);
            CollectionAssert.AreEqual(new[] { "terrain_forest", "terrain_water" }, Pick("Breeding Pool").TerrainMix);
            Assert.AreEqual("tipo básico", Pick("Breeding Pool").Reason);
            var wastes = Pick("Llanowar Wastes");
            CollectionAssert.AreEqual(new[] { "terrain_swamp", "terrain_forest" }, wastes.TerrainMix);
            Assert.AreEqual("mana produzida", wastes.Reason);
            Assert.AreEqual("terrain_wasteland", Pick("Wastes").ModelId);
        }

        [Test]
        public void SpellsAndProps()
        {
            Assert.AreEqual("vfx_fire", Pick("Lightning Bolt").ModelId);
            Assert.AreEqual(ModelKind.Spell, Pick("Lightning Bolt").Kind);
            Assert.AreEqual("vfx_prism", Pick("Fire // Ice").ModelId);
            Assert.AreEqual("prop_artifact", Pick("Sol Ring").ModelId);
            Assert.AreEqual("hero_planeswalker", Pick("Liliana of the Veil").ModelId);
            Assert.AreEqual(ModelKind.Prop, Pick("Liliana of the Veil").Kind);
        }

        [Test]
        public void LabelsAndCreatureModelList()
        {
            Assert.AreEqual("Dragão", DataTestUtil.Resolver.Label("dragon"));
            Assert.AreEqual("modelo_desconhecido", DataTestUtil.Resolver.Label("modelo_desconhecido"));
            var models = DataTestUtil.Resolver.CreatureModels();
            Assert.IsTrue(models.Contains("elf") && models.Contains("wolf") && models.Contains("winged"));
            Assert.AreEqual(models.Count, models.Distinct().Count());
        }
    }

    public class DeckStoreTests
    {
        [Test]
        public void Preview_MarksUnknownCardsWithSuggestionAndKeepsOrder()
        {
            var lines = DeckStore.Preview("4 Llanowar Elfs\n0 Island\n2 Forest\n", DataTestUtil.Catalog);
            Assert.AreEqual(3, lines.Count);
            Assert.IsFalse(lines[0].Ok);
            Assert.AreEqual("Llanowar Elves", lines[0].Suggestions[0]);
            Assert.IsNotNull(lines[1].Error);
            Assert.IsTrue(lines[2].Ok);
        }

        [Test]
        public void AddFromImport_MergesEnglishAndPortugueseLines_AndSkipsSideboard()
        {
            var store = new DeckStore();
            var changes = 0;
            store.Changed += () => changes++;
            var lines = DeckStore.Preview("4 Llanowar Elves\n2 Elfos de Llanowar\n10 Forest\nSB: 1 Lightning Bolt\n", DataTestUtil.Catalog);
            var deck = store.AddFromImport("  Elfos  ", lines);

            Assert.AreEqual("Elfos", deck.name);
            Assert.AreEqual(16, deck.Count);
            Assert.AreEqual(6, deck.cards.First(c => c.name == "Llanowar Elves").quantity);
            Assert.IsFalse(deck.cards.Any(c => c.name == "Lightning Bolt"));
            Assert.AreEqual(1, changes);
            CollectionAssert.AreEqual(new[] { "G" }, DeckStore.Colors(deck, DataTestUtil.Catalog));
            Assert.AreEqual(6, DeckStore.CountKind(deck, DataTestUtil.Catalog, CardKind.Creature));
            Assert.AreEqual(10, DeckStore.CountKind(deck, DataTestUtil.Catalog, CardKind.Land));
        }

        [Test]
        public void ModelOverride_FeedsTheResolver()
        {
            var store = new DeckStore();
            var deck = store.AddFromImport("Teste", DeckStore.Preview("4 Llanowar Elves\n", DataTestUtil.Catalog));
            var elves = DataTestUtil.Catalog.Find("Llanowar Elves");
            store.SetModelOverride(deck.id, elves.OracleId, "wolf");

            var resolver = ModelResolver.FromJson(DataTestUtil.ModelMapJson, deck.ModelOverrides());
            Assert.AreEqual("wolf", resolver.Resolve(elves).ModelId);
        }

        [Test]
        public void RenameAndRemove()
        {
            var store = new DeckStore();
            var deck = store.AddFromImport("A", DeckStore.Preview("1 Forest\n", DataTestUtil.Catalog));
            store.Rename(deck.id, " B ");
            Assert.AreEqual("B", store.Get(deck.id).name);
            Assert.IsTrue(store.Remove(deck.id));
            Assert.AreEqual(0, store.Decks.Count);
        }

        [Test]
        public void SampleDeckFromPythonFixtures_ResolvesCompletely()
        {
            var path = DataTestUtil.PythonFixture("sample_deck.txt");
            if (!File.Exists(path))
                Assert.Ignore("ml/tests/fixtures não está ao lado do projeto Unity");
            var lines = DeckStore.Preview(File.ReadAllText(path), DataTestUtil.Catalog);
            Assert.IsTrue(lines.All(l => l.Ok), string.Join(", ", lines.Where(l => !l.Ok).Select(l => l.Entry?.Name ?? l.Error.Text)));
            // Mesmo total que o preview_deck.py imprime para esse arquivo: 44 no deck principal.
            Assert.AreEqual(44, lines.Where(l => l.Entry.Section == DeckSection.Main).Sum(l => l.Entry.Quantity));
        }
    }
}
