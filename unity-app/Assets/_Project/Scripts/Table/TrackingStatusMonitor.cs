using System;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace MtgAr.Table
{
    /// <summary>
    /// Junta o estado da sessão AR, o motivo de não rastrear e a luz do ambiente num único
    /// TrackingStatus estável (com histerese) para o chip de status e para a calibração.
    /// </summary>
    public class TrackingStatusMonitor : MonoBehaviour
    {
        [SerializeField] ARCameraManager cameraManager;

        [Tooltip("Tempo que um estado novo precisa durar para aparecer na tela.")]
        [SerializeField] float holdSeconds = 1f;

        [Tooltip("Abaixo disso (0..1, ARCore averageBrightness) consideramos pouca luz.")]
        [SerializeField] float lowBrightness = 0.18f;

        [Tooltip("Abaixo disso (lúmens, ARKit) consideramos pouca luz.")]
        [SerializeField] float lowLumens = 250f;

        public TrackingStatus Current => filter.Current;

        /// <summary>A sessão está rastreando agora (sem histerese): é o que libera ou trava a calibração.</summary>
        public bool IsTracking { get; private set; }

        public event Action<TrackingStatus> StatusChanged;

        TrackingStatusFilter filter;
        bool lowLight;

        void Awake()
        {
            filter = new TrackingStatusFilter(holdSeconds);
        }

        void OnEnable()
        {
            if (cameraManager == null)
                return;
            cameraManager.requestedLightEstimation |= LightEstimation.AmbientIntensity;
            cameraManager.frameReceived += OnFrameReceived;
        }

        void OnDisable()
        {
            if (cameraManager != null)
                cameraManager.frameReceived -= OnFrameReceived;
        }

        void OnFrameReceived(ARCameraFrameEventArgs args)
        {
            var light = args.lightEstimation;
            if (light.averageBrightness.HasValue)
                lowLight = light.averageBrightness.Value < lowBrightness;
            else if (light.averageIntensityInLumens.HasValue)
                lowLight = light.averageIntensityInLumens.Value < lowLumens;
        }

        void Update()
        {
            IsTracking = ARSession.state == ARSessionState.SessionTracking;
            if (filter.Update(ReadRawStatus(), Time.deltaTime))
                StatusChanged?.Invoke(filter.Current);
        }

        TrackingStatus ReadRawStatus()
        {
            var state = ARSession.state;
            if (state == ARSessionState.Unsupported)
                return TrackingStatus.Unsupported;

            if (state == ARSessionState.SessionTracking)
                return lowLight ? TrackingStatus.LowLight : TrackingStatus.Good;

            if (state < ARSessionState.SessionInitializing)
                return TrackingStatus.Initializing;

            switch (ARSession.notTrackingReason)
            {
                case NotTrackingReason.Initializing: return TrackingStatus.Initializing;
                case NotTrackingReason.Relocalizing: return TrackingStatus.Relocalizing;
                case NotTrackingReason.InsufficientLight: return TrackingStatus.LowLight;
                case NotTrackingReason.ExcessiveMotion: return TrackingStatus.ExcessiveMotion;
                case NotTrackingReason.InsufficientFeatures: return TrackingStatus.FewFeatures;
                default: return TrackingStatus.Lost;
            }
        }
    }
}
