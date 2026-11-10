using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    public enum ScreenId
    {
        Splash,
        Onboarding,
        Permission,
        Home,
        Decks,
        Import,
        DeckDetail,
        Bestiary,
        Settings,
        Setup,
    }

    /// <summary>Uma tela do menu. O UXML dela fica em Resources/UI/Screens/&lt;ScreenId&gt;.uxml.</summary>
    public abstract class AppScreen
    {
        protected AppRouter Router { get; private set; }
        protected VisualElement Root { get; private set; }

        internal void Attach(AppRouter router, VisualElement root)
        {
            Router = router;
            Root = root;
            var back = root.Q<Button>("back");
            if (back != null)
                back.clicked += router.Back;
            Bind();
        }

        /// <summary>Uma vez, logo depois de criar a tela: pegar elementos e ligar eventos.</summary>
        protected abstract void Bind();

        /// <summary>Toda vez que a tela aparece. `argument` é o que foi passado em Navigate.</summary>
        public virtual void OnShow(object argument) { }

        protected T Q<T>(string name) where T : VisualElement => Root.Q<T>(name);
        protected VisualElement Q(string name) => Root.Q(name);
    }

    /// <summary>
    /// Navegação entre as telas de menu dentro de um único UIDocument (AppShell.uxml).
    /// Cada tela é criada uma vez e só escondida/mostrada, então o texto digitado não se perde.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public class AppRouter : MonoBehaviour
    {
        static readonly Dictionary<ScreenId, Func<AppScreen>> Factories = new()
        {
            [ScreenId.Splash] = () => new SplashScreen(),
            [ScreenId.Onboarding] = () => new OnboardingScreen(),
            [ScreenId.Permission] = () => new PermissionScreen(),
            [ScreenId.Home] = () => new HomeScreen(),
            [ScreenId.Decks] = () => new DecksScreen(),
            [ScreenId.Import] = () => new ImportScreen(),
            [ScreenId.DeckDetail] = () => new DeckDetailScreen(),
            [ScreenId.Bestiary] = () => new BestiaryScreen(),
            [ScreenId.Settings] = () => new SettingsScreen(),
            [ScreenId.Setup] = () => new SetupScreen(),
        };

        /// <summary>Tela inicial ao voltar da mesa (em vez da abertura).</summary>
        public static ScreenId? NextStartScreen;

        readonly Dictionary<ScreenId, (AppScreen screen, VisualElement root)> screens = new();
        readonly Stack<(ScreenId id, object argument)> history = new();
        VisualElement host;

        public ScreenId? Current => history.Count > 0 ? history.Peek().id : (ScreenId?)null;

        void OnEnable()
        {
            host = GetComponent<UIDocument>().rootVisualElement.Q("screen-host");
            screens.Clear();
            history.Clear();
            var start = NextStartScreen ?? ScreenId.Splash;
            NextStartScreen = null;
            Navigate(start);
        }

        public void Navigate(ScreenId id, object argument = null)
        {
            history.Push((id, argument));
            Show(id, argument);
        }

        /// <summary>Troca a tela atual sem empilhar (ex.: depois de salvar, ir direto ao detalhe).</summary>
        public void Replace(ScreenId id, object argument = null)
        {
            if (history.Count > 0)
                history.Pop();
            Navigate(id, argument);
        }

        /// <summary>Limpa o histórico e vai para a tela (ex.: Início depois do onboarding).</summary>
        public void Reset(ScreenId id)
        {
            history.Clear();
            Navigate(id);
        }

        public void Back()
        {
            if (history.Count <= 1)
                return;
            history.Pop();
            var (id, argument) = history.Peek();
            Show(id, argument);
        }

        void Show(ScreenId id, object argument)
        {
            if (!screens.TryGetValue(id, out var entry))
            {
                var asset = Resources.Load<VisualTreeAsset>($"UI/Screens/{id}");
                if (asset == null)
                {
                    Debug.LogError($"[AppRouter] Resources/UI/Screens/{id}.uxml não encontrado");
                    return;
                }
                var root = asset.Instantiate();
                root.AddToClassList("mv-screen");
                host.Add(root);
                var screen = Factories[id]();
                screen.Attach(this, root);
                entry = (screen, root);
                screens[id] = entry;
            }

            foreach (var pair in screens)
                UiKit.Show(pair.Value.root, pair.Key == id);
            entry.screen.OnShow(argument);
        }
    }
}
