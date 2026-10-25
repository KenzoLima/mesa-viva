using UnityEngine;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    /// <summary>
    /// Mantém o conteúdo longe do notch / Dynamic Island e da barra de gestos do iPhone,
    /// aplicando a Screen.safeArea como padding no elemento indicado (padrão: a raiz do documento).
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public class SafeAreaPadding : MonoBehaviour
    {
        [SerializeField] string elementName = "app";

        VisualElement target;
        Rect lastSafeArea;
        Vector2Int lastScreen;

        void OnEnable()
        {
            var root = GetComponent<UIDocument>().rootVisualElement;
            target = root.Q(elementName) ?? root;
            lastSafeArea = default;
        }

        void Update()
        {
            if (target == null || target.panel == null)
                return;
            var safe = Screen.safeArea;
            var size = new Vector2Int(Screen.width, Screen.height);
            if (safe == lastSafeArea && size == lastScreen)
                return;
            lastSafeArea = safe;
            lastScreen = size;

            // Pixels de tela → unidades do painel (o PanelSettings pode escalar a UI).
            var panelRoot = target.panel.visualTree.worldBound;
            if (panelRoot.width <= 0 || Screen.width <= 0)
                return;
            var k = panelRoot.width / Screen.width;
            target.style.paddingLeft = safe.xMin * k;
            target.style.paddingRight = (Screen.width - safe.xMax) * k;
            target.style.paddingTop = (Screen.height - safe.yMax) * k;
            target.style.paddingBottom = safe.yMin * k;
        }
    }

    /// <summary>Menus em retrato, mesa em paisagem. Vai num objeto de cada cena.</summary>
    public class SceneOrientation : MonoBehaviour
    {
        public enum Mode
        {
            Portrait,
            Landscape,
        }

        [SerializeField] Mode mode = Mode.Portrait;

        void Awake()
        {
            var landscape = mode == Mode.Landscape;
            Screen.autorotateToPortrait = !landscape;
            Screen.autorotateToPortraitUpsideDown = false;
            Screen.autorotateToLandscapeLeft = landscape;
            Screen.autorotateToLandscapeRight = landscape;
            // Na paisagem, deixa girar entre as duas (o celular pode estar de qualquer lado no suporte).
            Screen.orientation = landscape ? ScreenOrientation.AutoRotation : ScreenOrientation.Portrait;
        }
    }
}
