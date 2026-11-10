using System;
using System.Collections;
using System.Linq;
using MtgAr.Data;
using MtgAr.Table;
using MtgAr.UI;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
using UnityEngine.UIElements;
using Object = UnityEngine.Object;

namespace MtgAr.Tests
{
    /// <summary>
    /// O caminho menu → "Calibrar a mesa" → "‹ Menu", com as cenas de verdade (App e Mesa) e cliques
    /// nos botões das telas. Confere que as cenas existem, estão na Scene List e que os componentes
    /// estão ligados. NÃO confere o AR em si (planos, toque na mesa): isso só no XR Simulation ou no celular.
    /// </summary>
    public class MenuToTableFlowTests
    {
        const string TestDeckName = "__teste de fluxo__";
        const float TimeoutSeconds = 20f;

        string deckId;

        [UnityTearDown]
        public IEnumerator RemoveTestDeck()
        {
            if (deckId != null && AppServices.Decks != null)
                AppServices.Decks.Remove(deckId);
            deckId = null;
            AppRouter.NextStartScreen = null;
            MatchConfig.Current = null;
            yield return null;
        }

        [UnityTest]
        public IEnumerator Menu_OpensCalibration_AndComesBackToHome()
        {
            AppRouter.NextStartScreen = null;
            yield return SceneManager.LoadSceneAsync("App");
            yield return WaitFor(() => AppServices.IsReady || AppServices.LoadError != null, "catálogo carregar");
            Assert.IsNull(AppServices.LoadError);

            var router = Object.FindFirstObjectByType<AppRouter>();
            Assert.IsNotNull(router, "a cena App precisa de um AppRouter");
            Assert.AreEqual(ScreenId.Splash, router.Current);

            // "Calibrar a mesa" só habilita com um deck salvo.
            var lines = DeckStore.Preview("4 Llanowar Elves\n20 Forest", AppServices.Catalog);
            deckId = AppServices.Decks.AddFromImport(TestDeckName, lines).id;

            router.Reset(ScreenId.Home);
            yield return null;
            Click(VisibleButton("play"));
            yield return null;
            Assert.AreEqual(ScreenId.Setup, router.Current);

            var calibrate = VisibleButton("calibrate");
            Assert.IsTrue(calibrate.enabledSelf, "com um deck salvo, 'Calibrar a mesa' fica habilitado");
            Click(calibrate);
            yield return WaitFor(() => SceneManager.GetActiveScene().name == "Mesa", "a cena Mesa abrir");
            yield return null;

            Assert.IsNotNull(MatchConfig.Current, "a escolha da partida passa para a cena da mesa");
            var controller = Object.FindFirstObjectByType<TableCalibrationController>();
            Assert.IsNotNull(controller, "a cena Mesa precisa de um TableCalibrationController");
            Assert.IsNotNull(controller.Machine);
            Assert.IsNotNull(Object.FindFirstObjectByType<TableAreaVisualizer>());

            // Alguns frames com a tela de calibração viva: um campo sem ligar apareceria aqui como exceção.
            for (var i = 0; i < 30; i++)
                yield return null;
            Assert.AreNotEqual(CalibrationState.Confirmed, controller.State);

            Click(VisibleButton("menu"));
            yield return WaitFor(() => SceneManager.GetActiveScene().name == "App", "voltar para a cena App");
            yield return null;
            router = Object.FindFirstObjectByType<AppRouter>();
            Assert.AreEqual(ScreenId.Home, router.Current, "ao voltar da mesa, o menu abre no Início");
        }

        static Button VisibleButton(string name)
        {
            var button = Object.FindObjectsByType<UIDocument>(FindObjectsSortMode.None)
                .SelectMany(document => document.rootVisualElement.Query<Button>(name).ToList())
                .FirstOrDefault(candidate => candidate.resolvedStyle.display != DisplayStyle.None && IsShown(candidate));
            Assert.IsNotNull(button, $"botão '{name}' visível na tela");
            return button;
        }

        static bool IsShown(VisualElement element)
        {
            for (var e = element; e != null; e = e.parent)
                if (e.resolvedStyle.display == DisplayStyle.None)
                    return false;
            return true;
        }

        /// <summary>Mesmo evento que o Enter/toque envia: dispara o Button.clicked.</summary>
        static void Click(Button button)
        {
            using var submit = NavigationSubmitEvent.GetPooled();
            submit.target = button;
            button.SendEvent(submit);
        }

        static IEnumerator WaitFor(Func<bool> done, string what)
        {
            var deadline = Time.realtimeSinceStartup + TimeoutSeconds;
            while (!done())
            {
                if (Time.realtimeSinceStartup > deadline)
                    Assert.Fail($"passou de {TimeoutSeconds} s esperando {what}");
                yield return null;
            }
        }
    }
}
