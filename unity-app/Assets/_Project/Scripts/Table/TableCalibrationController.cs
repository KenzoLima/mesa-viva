using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace MtgAr.Table
{
    public enum DragMode
    {
        None,
        Rotate,
        Move,
    }

    /// <summary>
    /// Calibração da mesa por toque: detecta o plano horizontal, o jogador toca no centro,
    /// ajusta lado/rotação/tamanho e confirma. Ao confirmar, a mesa vira uma âncora AR
    /// (a altura fica travada) e a detecção de planos é desligada para economizar bateria.
    ///
    /// Coloque no XR Origin, ao lado do ARPlaneManager, ARRaycastManager e ARAnchorManager.
    /// A lógica de estados fica em TableCalibrationStateMachine; a geometria, em TableFrame.
    /// </summary>
    public class TableCalibrationController : MonoBehaviour
    {
        [SerializeField] ARPlaneManager planeManager;
        [SerializeField] ARRaycastManager raycastManager;
        [SerializeField] ARAnchorManager anchorManager;
        [SerializeField] TrackingStatusMonitor trackingMonitor;
        [SerializeField] Camera arCamera;

        [Tooltip("Área mínima (m²) de um plano horizontal para contar como mesa.")]
        [SerializeField] float minTableArea = 0.15f;

        [SerializeField] float noTableTimeoutSeconds = 15f;

        [Tooltip("Raio em pixels (em 160 dpi) para agarrar a alça de rotação.")]
        [SerializeField] float handleGrabRadiusDp = 48f;

        [Tooltip("Distância da alça de rotação além da borda do oponente (m).")]
        [SerializeField] float handleOffset = 0.07f;

        [Tooltip("Desliga a detecção de planos depois de confirmar (economiza bateria).")]
        [SerializeField] bool stopPlaneDetectionWhenConfirmed = true;

        public TableCalibrationStateMachine Machine { get; private set; }
        public CalibrationState State => Machine.State;
        public TableFrame Frame { get; private set; }
        public float SizeScale { get; private set; } = 1f;
        public PlayerSeat? Seat { get; private set; }
        public ARAnchor Anchor { get; private set; }

        /// <summary>0..1: maior plano horizontal encontrado em relação à área mínima.</summary>
        public float ScanProgress { get; private set; }

        public Vector3 HandleWorldPosition => Frame.TableToWorld(new Vector2(0f, Frame.Depth / 2f + handleOffset));

        public event Action<CalibrationState> StateChanged;
        public event Action<TableFrame> FrameChanged;
        public event Action<TableFrame> Confirmed;
        public event Action InvalidTap;
        public event Action<bool> TrackingLostChanged;

        static readonly List<ARRaycastHit> Hits = new();

        ARPlane tablePlane;
        DragMode dragMode;

        void Awake()
        {
            if (arCamera == null)
                arCamera = Camera.main;

            Machine = new TableCalibrationStateMachine(noTableTimeoutSeconds);
            Machine.StateChanged += OnMachineStateChanged;
            Machine.TrackingLostChanged += lost => TrackingLostChanged?.Invoke(lost);
        }

        void OnEnable()
        {
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal;
        }

        void Update()
        {
            var trackingOk = trackingMonitor == null || trackingMonitor.IsTracking;
            var largest = FindLargestHorizontalPlane(out var area);
            ScanProgress = Mathf.Clamp01(area / minTableArea);
            Machine.Tick(Time.deltaTime, largest != null && area >= minTableArea, trackingOk);

            // Depois de confirmar, a âncora é a verdade: o AR corrige drift e a mesa acompanha.
            if (State == CalibrationState.Confirmed && Anchor != null)
            {
                var t = Anchor.transform;
                if ((t.position - Frame.Origin).sqrMagnitude > 1e-8f || Vector3.Angle(t.forward, Frame.Forward) > 0.05f)
                    SetFrame(new TableFrame(t.position, t.up, t.forward, Frame.Width, Frame.Depth));
            }
        }

        // ---------------- entrada ----------------

        /// <summary>Toque simples na tela (coordenadas de tela, origem embaixo à esquerda).</summary>
        public TapResult Tap(Vector2 screenPosition)
        {
            var hitTable = TryHitHorizontalPlane(screenPosition, out var pose, out var plane);
            var previous = State;
            var result = Machine.OnTap(hitTable);

            switch (result)
            {
                case TapResult.CenterSet:
                    tablePlane = plane;
                    var normal = pose.rotation * Vector3.up;
                    var frame = TableFrame.FromCamera(pose.position, normal, arCamera.transform.position).Scaled(SizeScale);
                    Seat = PlayerSeat.NearCamera;
                    SetFrame(frame);
                    break;

                case TapResult.Recentered:
                    SetFrame(Frame.MovedTo(pose.position));
                    break;

                case TapResult.Invalid:
                    Vibrate();
                    InvalidTap?.Invoke();
                    break;
            }

            // No ajuste, a grade dos planos sai de cena para não brigar com o desenho da área de jogo.
            if (previous != State && State == CalibrationState.Adjusting)
                ShowPlanes(false);
            return result;
        }

        /// <summary>Começo de um arrasto: perto da alça gira, dentro da área move.</summary>
        public DragMode BeginDrag(Vector2 screenPosition)
        {
            dragMode = DragMode.None;
            if (State != CalibrationState.Adjusting || Machine.TrackingLost)
                return dragMode;

            var handleScreen = (Vector2)arCamera.WorldToScreenPoint(HandleWorldPosition);
            var dpi = Screen.dpi > 0 ? Screen.dpi : 160f;
            if (Vector2.Distance(handleScreen, screenPosition) <= handleGrabRadiusDp * dpi / 160f)
                dragMode = DragMode.Rotate;
            else if (Frame.Raycast(arCamera.ScreenPointToRay(screenPosition), out var hit) && Frame.Contains(hit))
                dragMode = DragMode.Move;
            return dragMode;
        }

        public void Drag(Vector2 screenPosition)
        {
            if (dragMode == DragMode.None || !Frame.Raycast(arCamera.ScreenPointToRay(screenPosition), out var hit))
                return;

            if (dragMode == DragMode.Rotate)
            {
                var direction = hit - Frame.Origin;
                if (direction.sqrMagnitude > 1e-4f)
                {
                    Seat = null;
                    SetFrame(Frame.WithForward(direction));
                }
            }
            else
            {
                SetFrame(Frame.MovedTo(hit));
            }
        }

        public void EndDrag() => dragMode = DragMode.None;

        // ---------------- ajustes ----------------

        public void Rotate(float degrees)
        {
            if (State != CalibrationState.Adjusting)
                return;
            Seat = null;
            SetFrame(Frame.RotatedBy(degrees));
        }

        public void Flip() => Rotate(180f);

        public void SetSeat(PlayerSeat seat)
        {
            if (State != CalibrationState.Adjusting)
                return;
            Seat = seat;
            SetFrame(TableFrame.ForSeat(seat, Frame.Origin, Frame.Normal, arCamera.transform.position, Frame.Width, Frame.Depth));
        }

        public void SetSizeScale(float scale)
        {
            SizeScale = Mathf.Clamp(scale, 0.5f, 1.6f);
            if (State == CalibrationState.Adjusting)
                SetFrame(Frame.Scaled(SizeScale));
        }

        public bool Confirm()
        {
            if (!Machine.Confirm())
                return false;

            CreateAnchor();
            ShowPlanes(false);
            if (stopPlaneDetectionWhenConfirmed)
                planeManager.requestedDetectionMode = PlaneDetectionMode.None;

            Confirmed?.Invoke(Frame);
            return true;
        }

        public void Recalibrate()
        {
            DestroyAnchor();
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal;
            ShowPlanes(true);
            var tableStillKnown = tablePlane != null && tablePlane.trackingState == TrackingState.Tracking;
            Machine.Recalibrate(tableStillKnown);
        }

        public void RetryScan() => Machine.RetryScan();

        // ---------------- AR ----------------

        bool TryHitHorizontalPlane(Vector2 screenPosition, out Pose pose, out ARPlane plane)
        {
            pose = default;
            plane = null;
            if (!raycastManager.Raycast(screenPosition, Hits, TrackableType.PlaneWithinPolygon) &&
                !raycastManager.Raycast(screenPosition, Hits, TrackableType.PlaneEstimated))
                return false;

            foreach (var hit in Hits)
            {
                var candidate = planeManager.GetPlane(hit.trackableId);
                if (candidate == null || candidate.alignment != PlaneAlignment.HorizontalUp)
                    continue;
                pose = hit.pose;
                plane = candidate;
                return true;
            }
            return false;
        }

        ARPlane FindLargestHorizontalPlane(out float area)
        {
            ARPlane best = null;
            area = 0f;
            foreach (var plane in planeManager.trackables)
            {
                if (plane.alignment != PlaneAlignment.HorizontalUp || plane.subsumedBy != null ||
                    plane.trackingState != TrackingState.Tracking)
                    continue;
                var planeArea = plane.size.x * plane.size.y;
                if (planeArea > area)
                {
                    area = planeArea;
                    best = plane;
                }
            }
            return best;
        }

        void CreateAnchor()
        {
            DestroyAnchor();
            var pose = new Pose(Frame.Origin, Frame.Rotation);
            if (tablePlane != null && anchorManager != null)
                Anchor = anchorManager.AttachAnchor(tablePlane, pose);

            if (Anchor == null)
            {
                // Plano B: âncora solta no mundo (o AR Foundation registra um ARAnchor adicionado como componente).
                var go = new GameObject("Mesa (âncora)");
                go.transform.SetPositionAndRotation(pose.position, pose.rotation);
                Anchor = go.AddComponent<ARAnchor>();
            }
        }

        void DestroyAnchor()
        {
            if (Anchor != null)
                Destroy(Anchor.gameObject);
            Anchor = null;
        }

        void ShowPlanes(bool visible)
        {
            foreach (var plane in planeManager.trackables)
                plane.gameObject.SetActive(visible);
        }

        void SetFrame(TableFrame frame)
        {
            Frame = frame;
            FrameChanged?.Invoke(frame);
        }

        void OnMachineStateChanged(CalibrationState previous, CalibrationState next)
        {
            StateChanged?.Invoke(next);
        }

        static void Vibrate()
        {
#if UNITY_ANDROID || UNITY_IOS
            Handheld.Vibrate();
#endif
        }
    }
}
