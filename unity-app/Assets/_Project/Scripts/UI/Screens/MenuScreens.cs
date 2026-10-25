using System.Linq;
using MtgAr.Data;
using UnityEngine;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    public sealed class SplashScreen : AppScreen
    {
        Button start;
        Label loading;

        protected override void Bind()
        {
            start = Q<Button>("start");
            loading = Q<Label>("loading");
            start.clicked += () =>
            {
                if (AppSettings.OnboardingDone)
                    Router.Reset(ScreenId.Home);
                else
                    Router.Navigate(ScreenId.Onboarding);
            };
            Root.schedule.Execute(Refresh).Every(100);
        }

        public override void OnShow(object argument) => Refresh();

        void Refresh()
        {
            start.SetEnabled(AppServices.IsReady);
            if (AppServices.LoadError != null)
                loading.text = "Erro ao carregar: " + AppServices.LoadError;
            UiKit.Show(loading, !AppServices.IsReady);
        }
    }

    public sealed class OnboardingScreen : AppScreen
    {
        static readonly (LineArtKind art, string title, string text)[] Steps =
        {
            (LineArtKind.Stand, "Prenda o celular num suporte", "Na lateral da mesa, a 60–80 cm de altura, olhando para as duas metades. As mãos ficam livres e a imagem não treme."),
            (LineArtKind.Sleeve, "Prefira sleeves foscos", "Reflexo de sleeve brilhante ou de carta foil confunde a câmera. Sem sleeve também funciona."),
            (LineArtKind.Lamp, "Jogue com boa luz", "Luz forte e difusa ajuda a reconhecer a arte das cartas. Um playmat ajuda o celular a encontrar a mesa."),
        };

        int step;
        LineArt art;
        Label title, text;
        VisualElement dots;
        Button next;

        protected override void Bind()
        {
            art = Q<LineArt>("art");
            title = Q<Label>("step-title");
            text = Q<Label>("step-text");
            dots = Q("dots");
            next = Q<Button>("next");
            next.clicked += () =>
            {
                if (step < Steps.Length - 1)
                {
                    step++;
                    Refresh();
                }
                else
                {
                    Router.Navigate(ScreenId.Permission);
                }
            };
            Q<Button>("skip").clicked += () => Router.Navigate(ScreenId.Permission);
        }

        public override void OnShow(object argument)
        {
            step = 0;
            Refresh();
        }

        void Refresh()
        {
            var (kind, stepTitle, stepText) = Steps[step];
            art.Kind = kind;
            title.text = stepTitle;
            text.text = stepText;
            next.text = step < Steps.Length - 1 ? "Próximo" : "Entendi";
            dots.Clear();
            for (var i = 0; i < Steps.Length; i++)
            {
                var dot = new VisualElement();
                dot.AddToClassList("mv-dot");
                dot.EnableInClassList("mv-dot--active", i == step);
                dots.Add(dot);
            }
        }
    }

    public sealed class PermissionScreen : AppScreen
    {
        Label denied;

        protected override void Bind()
        {
            denied = Q<Label>("denied");
            Q<Button>("allow").clicked += RequestCamera;
            Q<Button>("later").clicked += Finish;
        }

        void RequestCamera()
        {
            // No iPhone isso mostra o pedido do sistema com o texto de "Camera Usage Description".
            var request = Application.RequestUserAuthorization(UserAuthorization.WebCam);
            request.completed += _ =>
            {
                if (Application.HasUserAuthorization(UserAuthorization.WebCam))
                    Finish();
                else
                    UiKit.Show(denied, true);
            };
        }

        void Finish()
        {
            AppSettings.OnboardingDone = true;
            AppSettings.Save();
            Router.Reset(ScreenId.Home);
        }
    }

    public sealed class HomeScreen : AppScreen
    {
        Label decksSub;

        protected override void Bind()
        {
            decksSub = Q<Label>("decks-sub");
            Q<Button>("play").clicked += () => Router.Navigate(ScreenId.Setup);
            Q<Button>("decks").clicked += () => Router.Navigate(ScreenId.Decks);
            Q<Button>("bestiary").clicked += () => Router.Navigate(ScreenId.Bestiary);
            Q<Button>("settings").clicked += () => Router.Navigate(ScreenId.Settings);
            Q<Button>("settings-row").clicked += () => Router.Navigate(ScreenId.Settings);
        }

        public override void OnShow(object argument)
        {
            var count = AppServices.Decks?.Decks.Count ?? 0;
            decksSub.text = UiKit.Plural(count, "deck salvo", "decks salvos");
        }
    }

    public sealed class BestiaryScreen : AppScreen
    {
        VisualElement grid;

        protected override void Bind() => grid = Q("grid");

        public override void OnShow(object argument)
        {
            grid.Clear();
            var usage = AppServices.CreatureModelUsage();
            foreach (var model in AppServices.Resolver.CreatureModels())
            {
                var tile = new VisualElement();
                tile.AddToClassList("mv-beast");
                var art = new VisualElement();
                art.AddToClassList("mv-beast__art");
                var figure = new LineArt(LineArtKind.Creature);
                figure.style.flexGrow = 1;
                art.Add(figure);
                tile.Add(art);
                tile.Add(UiKit.Text(AppServices.Resolver.Label(model), "mv-row__title"));
                usage.TryGetValue(model, out var n);
                tile.Add(UiKit.Text(n > 0 ? "Usado por " + UiKit.Plural(n, "carta", "cartas") : "Sem cartas ainda", "mv-row__sub"));
                grid.Add(tile);
            }
        }
    }

    public sealed class SettingsScreen : AppScreen
    {
        static readonly (Quality value, string label, string hint)[] Qualities =
        {
            (Quality.High, "Alta", "Sombras, oclusão por profundidade (LiDAR) e 60 fps quando possível."),
            (Quality.Medium, "Média", "Sombras simples e 30 fps."),
            (Quality.Eco, "Economia", "30 fps, sem oclusão e menos partículas. Ideal para partidas longas."),
        };

        VisualElement qualityRow, toggles;
        Label qualityHint, epicValue;
        Slider epic;

        protected override void Bind()
        {
            qualityRow = Q("quality");
            qualityHint = Q<Label>("quality-hint");
            toggles = Q("toggles");
            epic = Q<Slider>("epic");
            epicValue = Q<Label>("epic-value");
            epic.RegisterValueChangedCallback(evt =>
            {
                AppSettings.EpicScale = evt.newValue;
                epicValue.text = UiKit.Decimal(AppSettings.EpicScale) + "×";
            });
        }

        public override void OnShow(object argument)
        {
            RefreshQuality();
            toggles.Clear();
            AddToggle("Sons", "Invocações, ataques e efeitos", AppSettings.Sounds, v => AppSettings.Sounds = v);
            AddToggle("Vibração", "Ao invocar e ao mudar a vida", AppSettings.Haptics, v => AppSettings.Haptics = v);
            AddToggle("Plaquinha de P/T", "Mostra poder e resistência sobre as criaturas", AppSettings.PowerToughnessPlates, v => AppSettings.PowerToughnessPlates = v);
            AddToggle("Overlay de depuração", "Caixas de detecção, confiança e FPS", AppSettings.DebugOverlay, v => AppSettings.DebugOverlay = v);
            epic.SetValueWithoutNotify(AppSettings.EpicScale);
            epicValue.text = UiKit.Decimal(AppSettings.EpicScale) + "×";
        }

        void RefreshQuality()
        {
            qualityRow.Clear();
            foreach (var (value, label, _) in Qualities)
                qualityRow.Add(UiKit.Chip(label, AppSettings.Quality == value, () =>
                {
                    AppSettings.Quality = value;
                    AppSettings.Save();
                    RefreshQuality();
                }));
            qualityHint.text = Qualities.First(q => q.value == AppSettings.Quality).hint;
        }

        void AddToggle(string label, string hint, bool on, System.Action<bool> set)
        {
            var row = new VisualElement();
            row.AddToClassList("mv-toggle-row");
            var body = new VisualElement();
            body.AddToClassList("mv-row__body");
            body.style.marginLeft = 0;
            body.Add(UiKit.Text(label, "mv-row__title"));
            body.Add(UiKit.Text(hint, "mv-row__sub"));
            row.Add(body);
            row.Add(UiKit.Switch(on, value => { set(value); AppSettings.Save(); }, label));
            toggles.Add(row);
        }
    }
}
