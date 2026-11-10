using System.Collections.Generic;
using System.Linq;
using MtgAr.Data;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    public sealed class DecksScreen : AppScreen
    {
        ScrollView list;
        Label empty;

        protected override void Bind()
        {
            list = Q<ScrollView>("list");
            empty = Q<Label>("empty");
            Q<Button>("import").clicked += () => Router.Navigate(ScreenId.Import, ImportScreen.NewDeck);
        }

        public override void OnShow(object argument)
        {
            list.Clear();
            var decks = AppServices.Decks.Decks;
            UiKit.Show(empty, decks.Count == 0);
            foreach (var deck in decks)
            {
                var pips = new VisualElement { pickingMode = PickingMode.Ignore };
                pips.AddToClassList("mv-pips");
                foreach (var color in DeckStore.Colors(deck, AppServices.Catalog))
                    pips.Add(UiKit.Pip(color));
                var creatures = DeckStore.CountKind(deck, AppServices.Catalog, CardKind.Creature);
                var subtitle = $"{UiKit.Plural(deck.Count, "carta", "cartas")} · {UiKit.Plural(creatures, "criatura", "criaturas")}";
                var id = deck.id;
                list.Add(UiKit.Row(deck.name, subtitle, () => Router.Navigate(ScreenId.DeckDetail, id), pips));
            }
        }
    }

    public sealed class ImportScreen : AppScreen
    {
        /// <summary>Argumento de Navigate para começar uma importação do zero.</summary>
        public const string NewDeck = "new";

        TextField nameField, textField;
        Label okCount, problemCount;
        VisualElement preview;
        Button save;
        IVisualElementScheduledItem pendingRefresh;
        List<ImportLine> lines = new();

        protected override void Bind()
        {
            nameField = Q<TextField>("deck-name");
            textField = Q<TextField>("deck-text");
            okCount = Q<Label>("ok-count");
            problemCount = Q<Label>("problem-count");
            preview = Q("preview");
            save = Q<Button>("save");

            // Espera a pessoa parar de digitar (as sugestões varrem o catálogo inteiro).
            textField.RegisterValueChangedCallback(_ =>
            {
                pendingRefresh?.Pause();
                pendingRefresh = Root.schedule.Execute(Refresh).StartingIn(350);
            });
            save.clicked += Save;
        }

        public override void OnShow(object argument)
        {
            if (argument as string == NewDeck)
            {
                nameField.SetValueWithoutNotify("Novo deck");
                textField.SetValueWithoutNotify("");
            }
            Refresh();
        }

        void Refresh()
        {
            lines = DeckStore.Preview(textField.value, AppServices.Catalog);
            preview.Clear();
            int ok = 0, problems = 0;
            foreach (var line in lines)
            {
                if (line.Ok)
                    ok += line.Entry.Quantity;
                else
                    problems++;
                preview.Add(BuildRow(line));
            }
            UiKit.Show(preview, lines.Count > 0);

            okCount.text = UiKit.Plural(ok, "carta reconhecida", "cartas reconhecidas");
            problemCount.text = problems == 0 ? "Nenhum problema" : UiKit.Plural(problems, "linha com problema", "linhas com problema");
            problemCount.EnableInClassList("mv-bad-text", problems > 0);
            problemCount.EnableInClassList("mv-ok-text", problems == 0);
            save.SetEnabled(ok > 0);
            save.text = problems == 0 ? "Salvar deck" : "Salvar e ignorar " + UiKit.Plural(problems, "linha", "linhas");
        }

        VisualElement BuildRow(ImportLine line)
        {
            var row = new VisualElement();
            row.AddToClassList("mv-preview-row");
            row.EnableInClassList("mv-preview-row--problem", !line.Ok);

            var qty = UiKit.Text(line.Entry != null ? line.Entry.Quantity.ToString() : "!", "mv-preview-row__qty");
            var body = new VisualElement();
            body.AddToClassList("mv-preview-row__body");
            row.Add(qty);
            row.Add(body);

            if (line.Ok)
            {
                var typed = line.Entry.Name;
                var title = TextNormalizer.Normalize(typed) == TextNormalizer.Normalize(line.Card.Name) ? line.Card.Name : $"{typed} → {line.Card.Name}";
                var model = AppServices.Resolver.Label(AppServices.Resolver.Resolve(line.Card).ModelId);
                body.Add(UiKit.Text(title, "mv-row__title"));
                body.Add(UiKit.Text(model + SectionSuffix(line.Entry.Section), "mv-row__sub"));
            }
            else if (line.Entry != null)
            {
                var suggestion = line.Suggestions.FirstOrDefault();
                body.Add(UiKit.Text(line.Entry.Name, "mv-row__title"));
                body.Add(UiKit.Text(suggestion != null ? $"Não encontrada. Você quis dizer {suggestion}?" : "Carta não encontrada", "mv-row__sub"));
                if (suggestion != null)
                {
                    var entry = line.Entry;
                    var fix = UiKit.Chip("Corrigir", false, () => ApplySuggestion(entry, suggestion));
                    row.Add(fix);
                }
            }
            else
            {
                body.Add(UiKit.Text(line.Error.Text.Trim(), "mv-row__title"));
                body.Add(UiKit.Text(line.Error.Reason == DeckParser.ErrorQuantity
                    ? "A quantidade precisa ser maior que zero"
                    : "Formato não reconhecido: use \"4 Nome da Carta\"", "mv-row__sub"));
            }
            return row;
        }

        static string SectionSuffix(DeckSection section)
        {
            switch (section)
            {
                case DeckSection.Sideboard: return " · reserva (não entra no deck)";
                case DeckSection.Commander: return " · comandante";
                case DeckSection.Companion: return " · companheiro (não entra no deck)";
                case DeckSection.Maybeboard: return " · talvez (não entra no deck)";
                default: return "";
            }
        }

        void ApplySuggestion(DeckEntry entry, string suggestion)
        {
            var textLines = textField.value.Replace("\r\n", "\n").Split('\n');
            var index = entry.LineNo - 1;
            if (index < 0 || index >= textLines.Length)
                return;
            var at = textLines[index].IndexOf(entry.Name, System.StringComparison.Ordinal);
            if (at < 0)
                return;
            textLines[index] = textLines[index].Substring(0, at) + suggestion + textLines[index].Substring(at + entry.Name.Length);
            textField.SetValueWithoutNotify(string.Join("\n", textLines));
            Refresh();
        }

        void Save()
        {
            var deck = AppServices.Decks.AddFromImport(nameField.value, lines);
            Router.Replace(ScreenId.DeckDetail, deck.id);
        }
    }

    public sealed class DeckDetailScreen : AppScreen
    {
        SavedDeck deck;
        Label title, total, creatures, lands, sheetCard;
        ScrollView cards;
        VisualElement sheet, sheetOptions;
        CardRecord swapping;

        protected override void Bind()
        {
            title = Q<Label>("title");
            total = Q<Label>("stat-total");
            creatures = Q<Label>("stat-creatures");
            lands = Q<Label>("stat-lands");
            cards = Q<ScrollView>("cards");
            sheet = Q("sheet");
            sheetCard = Q<Label>("sheet-card");
            sheetOptions = Q("sheet-options");
            Q<Button>("play").clicked += () => Router.Navigate(ScreenId.Setup, deck?.id);
            Q<Button>("sheet-cancel").clicked += CloseSheet;
            Q<Button>("sheet-auto").clicked += () => PickModel(null);
            // Tocar fora da folha fecha.
            sheet.RegisterCallback<PointerDownEvent>(evt =>
            {
                if (evt.target == sheet)
                    CloseSheet();
            });
        }

        public override void OnShow(object argument)
        {
            deck = AppServices.Decks.Get(argument as string) ?? deck;
            CloseSheet();
            Refresh();
        }

        void Refresh()
        {
            if (deck == null)
                return;
            var catalog = AppServices.Catalog;
            title.text = deck.name;
            total.text = deck.Count.ToString();
            creatures.text = DeckStore.CountKind(deck, catalog, CardKind.Creature).ToString();
            lands.text = DeckStore.CountKind(deck, catalog, CardKind.Land).ToString();

            var resolver = AppServices.ResolverFor(deck);
            cards.Clear();
            foreach (var saved in deck.cards)
            {
                var card = catalog.Get(saved.oracleId);
                var row = new VisualElement();
                row.AddToClassList("mv-card-row");
                row.Add(UiKit.Text(saved.quantity.ToString(), "mv-card-row__qty"));
                row.Add(UiKit.Pip(card?.ColorKey ?? "C", small: true));

                var body = new VisualElement();
                body.AddToClassList("mv-row__body");
                body.style.marginLeft = 0;
                body.Add(UiKit.Text(saved.name, "mv-row__title"));
                if (card != null)
                {
                    var choice = resolver.Resolve(card);
                    var reason = string.IsNullOrEmpty(saved.modelOverride) ? Friendly(choice.Reason) : "escolha sua";
                    body.Add(UiKit.Text($"{resolver.Label(choice.ModelId)} · {reason}", "mv-row__sub"));
                }
                else
                {
                    body.Add(UiKit.Text("Carta fora do catálogo atual", "mv-row__sub"));
                }
                row.Add(body);

                if (card != null && card.Kind == CardKind.Creature)
                    row.Add(UiKit.Chip("Trocar", false, () => OpenSheet(card)));
                cards.Add(row);
            }
        }

        /// <summary>Os motivos do resolver vêm com nomes técnicos em inglês ("subtipo Elf"); aqui ficam só legíveis.</summary>
        static string Friendly(string reason) => reason.Replace("(genérico)", "· genérico");

        void OpenSheet(CardRecord card)
        {
            swapping = card;
            sheetCard.text = card.Name;
            var current = AppServices.ResolverFor(deck).Resolve(card).ModelId;
            sheetOptions.Clear();
            foreach (var model in AppServices.Resolver.CreatureModels())
                sheetOptions.Add(UiKit.Chip(AppServices.Resolver.Label(model), model == current, () => PickModel(model)));
            UiKit.Show(sheet, true);
        }

        void PickModel(string model)
        {
            if (swapping != null)
                AppServices.Decks.SetModelOverride(deck.id, swapping.OracleId, model);
            CloseSheet();
            Refresh();
        }

        void CloseSheet()
        {
            swapping = null;
            UiKit.Show(sheet, false);
        }
    }
}
