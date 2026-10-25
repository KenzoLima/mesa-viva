using System.Linq;
using MtgAr.Data;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    public sealed class SetupScreen : AppScreen
    {
        /// <summary>Nome da cena da mesa (precisa estar em Build Profiles → Scene List).</summary>
        public const string TableScene = "Mesa";

        static readonly (DeviceMode mode, string label, string hint)[] Modes =
        {
            (DeviceMode.Stand, "No suporte (recomendado)", "Celular fixo na lateral da mesa, mãos livres. Dá para espelhar na TV."),
            (DeviceMode.Handheld, "Na mão", "Aponte quando quiser ver. As criaturas fora da vista ficam paradas."),
            (DeviceMode.TwoPhones, "Dois celulares", "Cada jogador usa o seu, cada um do seu ângulo."),
        };

        readonly MatchConfig config = new MatchConfig();
        VisualElement myDecks, oppDecks, modes, lives;
        Label unknownHint, noDeck;
        Button calibrate;

        protected override void Bind()
        {
            myDecks = Q("my-decks");
            oppDecks = Q("opp-decks");
            modes = Q("modes");
            lives = Q("lives");
            unknownHint = Q<Label>("unknown-hint");
            noDeck = Q<Label>("no-deck");
            calibrate = Q<Button>("calibrate");
            calibrate.clicked += StartMatch;
        }

        public override void OnShow(object argument)
        {
            var decks = AppServices.Decks.Decks;
            if (argument is string deckId && decks.Any(d => d.id == deckId))
                config.MyDeckId = deckId;
            if (config.MyDeckId == null || decks.All(d => d.id != config.MyDeckId))
                config.MyDeckId = decks.FirstOrDefault()?.id;
            if (config.OpponentDeckId != null && decks.All(d => d.id != config.OpponentDeckId))
                config.OpponentDeckId = null;
            Refresh();
        }

        void Refresh()
        {
            var decks = AppServices.Decks.Decks;

            myDecks.Clear();
            foreach (var deck in decks)
            {
                var id = deck.id;
                myDecks.Add(UiKit.Chip(deck.name, config.MyDeckId == id, () => { config.MyDeckId = id; Refresh(); }));
            }

            oppDecks.Clear();
            foreach (var deck in decks)
            {
                var id = deck.id;
                oppDecks.Add(UiKit.Chip(deck.name, config.OpponentDeckId == id, () => { config.OpponentDeckId = id; Refresh(); }));
            }
            oppDecks.Add(UiKit.Chip("Desconhecido", config.OpponentDeckId == null, () => { config.OpponentDeckId = null; Refresh(); }));
            UiKit.Show(unknownHint, config.OpponentDeckId == null);

            modes.Clear();
            foreach (var (mode, label, hint) in Modes)
            {
                var row = UiKit.Row(label, hint, () => { config.Mode = mode; Refresh(); }, chevron: false);
                row.EnableInClassList("mv-row--selected", config.Mode == mode);
                row.style.marginBottom = 10;
                modes.Add(row);
            }

            lives.Clear();
            foreach (var life in new[] { 20, 40 })
                lives.Add(UiKit.Chip($"{life} vidas", config.StartingLife == life, () => { config.StartingLife = life; Refresh(); }));

            var hasDeck = config.MyDeckId != null;
            UiKit.Show(noDeck, !hasDeck);
            calibrate.SetEnabled(hasDeck);
        }

        void StartMatch()
        {
            MatchConfig.Current = new MatchConfig
            {
                MyDeckId = config.MyDeckId,
                OpponentDeckId = config.OpponentDeckId,
                Mode = config.Mode,
                StartingLife = config.StartingLife,
            };
            AppRouter.NextStartScreen = ScreenId.Home; // ao voltar da mesa, cai no Início
            SceneManager.LoadScene(TableScene);
        }
    }
}
