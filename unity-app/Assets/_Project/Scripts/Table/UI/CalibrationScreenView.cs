using MtgAr.Data;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace MtgAr.Table.UI
{
    /// <summary>
    /// Liga a tela CalibrationScreen.uxml ao TableCalibrationController e ao TrackingStatusMonitor.
    /// Também transforma toques e arrastos na camada de toque em chamadas ao controlador.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public class CalibrationScreenView : MonoBehaviour
    {
        [SerializeField] TableCalibrationController controller;
        [SerializeField] TrackingStatusMonitor trackingMonitor;

        [Tooltip("No modo 'No suporte' o celular fica na lateral, então perguntamos de que lado o jogador está. " +
                 "Quando a cena vem do menu, vale o modo escolhido em Nova partida.")]
        [SerializeField] bool askSeat = true;

        [Tooltip("Cena do menu, aberta pelo botão '‹ Menu'.")]
        [SerializeField] string menuScene = "App";

        [Tooltip("Arrastos menores que isso (px) contam como toque.")]
        [SerializeField] float tapSlopPixels = 12f;

        [SerializeField] float invalidTapSeconds = 1.8f;

        VisualElement root, tapLayer, banner, progress, progressFill, noTable, seat, toolbar, lost, statusDot;
        Label bannerTitle, bannerSub, statusLabel, invalidTap, flash;
        Slider sizeSlider;
        Button seatNear, seatFar, seatLeft, seatRight;

        Vector2 pointerDownScreen;
        bool pointerDown, dragging;
        float invalidTapUntil;

        void OnEnable()
        {
            var document = GetComponent<UIDocument>();
            root = document.rootVisualElement.Q("root");
            tapLayer = root.Q("tap-layer");
            banner = root.Q("banner");
            bannerTitle = root.Q<Label>("banner-title");
            bannerSub = root.Q<Label>("banner-sub");
            progress = root.Q("progress");
            progressFill = root.Q("progress-fill");
            statusDot = root.Q("status-dot");
            statusLabel = root.Q<Label>("status-label");
            invalidTap = root.Q<Label>("invalid-tap");
            noTable = root.Q("no-table");
            seat = root.Q("seat");
            toolbar = root.Q("toolbar");
            lost = root.Q("lost");
            flash = root.Q<Label>("flash");
            sizeSlider = root.Q<Slider>("size");
            seatNear = root.Q<Button>("seat-near");
            seatFar = root.Q<Button>("seat-far");
            seatLeft = root.Q<Button>("seat-left");
            seatRight = root.Q<Button>("seat-right");

            if (MatchConfig.Current != null)
                askSeat = MatchConfig.Current.AskSeat;
            root.Q<Button>("menu").clicked += () => SceneManager.LoadScene(menuScene);
            root.Q<Button>("retry").clicked += controller.RetryScan;
            root.Q<Button>("rotate").clicked += () => controller.Rotate(90f);
            root.Q<Button>("flip").clicked += controller.Flip;
            root.Q<Button>("confirm").clicked += () => controller.Confirm();
            seatNear.clicked += () => controller.SetSeat(PlayerSeat.NearCamera);
            seatFar.clicked += () => controller.SetSeat(PlayerSeat.FarFromCamera);
            seatLeft.clicked += () => controller.SetSeat(PlayerSeat.CameraLeft);
            seatRight.clicked += () => controller.SetSeat(PlayerSeat.CameraRight);
            sizeSlider.RegisterValueChangedCallback(evt => controller.SetSizeScale(evt.newValue));

            tapLayer.RegisterCallback<PointerDownEvent>(OnPointerDown);
            tapLayer.RegisterCallback<PointerMoveEvent>(OnPointerMove);
            tapLayer.RegisterCallback<PointerUpEvent>(OnPointerUp);
            tapLayer.RegisterCallback<PointerCancelEvent>(OnPointerCancel);

            controller.StateChanged += OnStateChanged;
            controller.FrameChanged += OnFrameChanged;
            controller.InvalidTap += OnInvalidTap;
            controller.TrackingLostChanged += OnTrackingLostChanged;
            if (trackingMonitor != null)
                trackingMonitor.StatusChanged += OnStatusChanged;
        }

        void Start()
        {
            // No Start, e não no OnEnable: aqui o Awake do controlador (que cria a máquina de estados) já rodou.
            Refresh();
            OnStatusChanged(trackingMonitor != null ? trackingMonitor.Current : TrackingStatus.Initializing);
        }

        void OnDisable()
        {
            controller.StateChanged -= OnStateChanged;
            controller.FrameChanged -= OnFrameChanged;
            controller.InvalidTap -= OnInvalidTap;
            controller.TrackingLostChanged -= OnTrackingLostChanged;
            if (trackingMonitor != null)
                trackingMonitor.StatusChanged -= OnStatusChanged;
        }

        void Update()
        {
            if (controller.State == CalibrationState.Scanning)
            {
                var pct = Mathf.RoundToInt(controller.ScanProgress * 100f);
                progressFill.style.width = Length.Percent(pct);
                bannerSub.text = $"Procurando uma superfície plana · {pct}%";
            }
            Show(invalidTap, Time.time < invalidTapUntil);
        }

        // ---------------- toques ----------------

        void OnPointerDown(PointerDownEvent evt)
        {
            pointerDown = true;
            dragging = false;
            pointerDownScreen = PanelToScreen(evt.position);
            tapLayer.CapturePointer(evt.pointerId);
        }

        void OnPointerMove(PointerMoveEvent evt)
        {
            if (!pointerDown)
                return;
            var screen = PanelToScreen(evt.position);
            if (!dragging && Vector2.Distance(screen, pointerDownScreen) > tapSlopPixels)
                dragging = controller.BeginDrag(pointerDownScreen) != DragMode.None;
            if (dragging)
                controller.Drag(screen);
        }

        void OnPointerUp(PointerUpEvent evt)
        {
            if (!pointerDown)
                return;
            pointerDown = false;
            tapLayer.ReleasePointer(evt.pointerId);
            if (dragging)
                controller.EndDrag();
            else
                controller.Tap(PanelToScreen(evt.position));
            dragging = false;
        }

        void OnPointerCancel(PointerCancelEvent evt)
        {
            pointerDown = false;
            tapLayer.ReleasePointer(evt.pointerId);
            if (dragging)
                controller.EndDrag();
            dragging = false;
        }

        /// <summary>
        /// Coordenada do painel (origem em cima à esquerda, unidades do PanelSettings) para
        /// coordenada de tela (origem embaixo à esquerda, pixels), que é o que o raycast AR usa.
        /// Vale porque a raiz ocupa a tela inteira.
        /// </summary>
        Vector2 PanelToScreen(Vector3 panelPosition)
        {
            var bounds = root.worldBound;
            var x = (panelPosition.x - bounds.xMin) / bounds.width * Screen.width;
            var y = (panelPosition.y - bounds.yMin) / bounds.height * Screen.height;
            return new Vector2(x, Screen.height - y);
        }

        // ---------------- estado ----------------

        void OnStateChanged(CalibrationState state)
        {
            Refresh();
            if (state == CalibrationState.Confirmed)
                PlayFlash();
        }

        void OnFrameChanged(TableFrame frame) => RefreshSeatButtons();

        void OnInvalidTap() => invalidTapUntil = Time.time + invalidTapSeconds;

        void OnTrackingLostChanged(bool isLost) => Refresh();

        void OnStatusChanged(TrackingStatus status)
        {
            statusLabel.text = TrackingStatusText.Label(status);
            var level = TrackingStatusText.Level(status);
            statusDot.EnableInClassList("cal-status__dot--warning", level == StatusLevel.Warning);
            statusDot.EnableInClassList("cal-status__dot--error", level == StatusLevel.Error);
        }

        void Refresh()
        {
            if (controller.Machine == null)
                return;
            var state = controller.State;
            var isLost = controller.Machine.TrackingLost;

            // Depois de confirmar, a tela sai do caminho dos toques (o HUD da partida assume).
            tapLayer.pickingMode = state == CalibrationState.Confirmed ? PickingMode.Ignore : PickingMode.Position;

            var scanning = state == CalibrationState.Scanning;
            Show(banner, !isLost && (scanning || state == CalibrationState.AwaitingCenterTap));
            Show(progress, scanning);
            if (scanning)
                bannerTitle.text = "Mova o celular devagar sobre a mesa";
            else if (state == CalibrationState.AwaitingCenterTap)
            {
                bannerTitle.text = "Toque no centro da mesa";
                bannerSub.text = "O ponto entre você e o oponente. Dá para ajustar depois.";
            }

            Show(noTable, !isLost && state == CalibrationState.NoTableHint);
            var adjusting = !isLost && state == CalibrationState.Adjusting;
            Show(toolbar, adjusting);
            Show(seat, adjusting && askSeat);
            Show(lost, isLost && state != CalibrationState.Confirmed);
            RefreshSeatButtons();
        }

        void RefreshSeatButtons()
        {
            var current = controller.Seat;
            seatNear.EnableInClassList("mv-chip--selected", current == PlayerSeat.NearCamera);
            seatFar.EnableInClassList("mv-chip--selected", current == PlayerSeat.FarFromCamera);
            seatLeft.EnableInClassList("mv-chip--selected", current == PlayerSeat.CameraLeft);
            seatRight.EnableInClassList("mv-chip--selected", current == PlayerSeat.CameraRight);
        }

        void PlayFlash()
        {
            flash.RemoveFromClassList("mv-hidden");
            flash.RemoveFromClassList("cal-flash--fading");
            // Um frame depois, para a transição de opacidade acontecer.
            flash.schedule.Execute(() => flash.AddToClassList("cal-flash--fading")).StartingIn(50);
            flash.schedule.Execute(() => flash.AddToClassList("mv-hidden")).StartingIn(1300);
        }

        static void Show(VisualElement element, bool visible) => element.EnableInClassList("mv-hidden", !visible);
    }
}
