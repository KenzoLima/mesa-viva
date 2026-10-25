namespace MtgAr.Table
{
    public enum TrackingStatus
    {
        Initializing,
        Good,
        LowLight,
        ExcessiveMotion,
        FewFeatures,
        Relocalizing,
        Lost,
        Unsupported,
    }

    public enum StatusLevel
    {
        Ok,
        Warning,
        Error,
    }

    public static class TrackingStatusText
    {
        /// <summary>Texto do chip de status (curto, cabe numa linha em paisagem).</summary>
        public static string Label(TrackingStatus status)
        {
            switch (status)
            {
                case TrackingStatus.Good: return "Rastreando bem";
                case TrackingStatus.LowLight: return "Pouca luz: acenda uma luz";
                case TrackingStatus.ExcessiveMotion: return "Mova o celular mais devagar";
                case TrackingStatus.FewFeatures: return "Aponte para uma área com mais textura";
                case TrackingStatus.Relocalizing: return "Reencontrando a mesa…";
                case TrackingStatus.Lost: return "Rastreamento perdido: aponte para a mesa";
                case TrackingStatus.Unsupported: return "Este celular não suporta RA";
                default: return "Iniciando a câmera…";
            }
        }

        public static StatusLevel Level(TrackingStatus status)
        {
            switch (status)
            {
                case TrackingStatus.Good: return StatusLevel.Ok;
                case TrackingStatus.Lost:
                case TrackingStatus.Unsupported: return StatusLevel.Error;
                default: return StatusLevel.Warning;
            }
        }

        /// <summary>A sessão AR consegue posicionar coisas no mundo neste estado?</summary>
        public static bool IsTracking(TrackingStatus status) => status == TrackingStatus.Good || status == TrackingStatus.LowLight;
    }

    /// <summary>
    /// Histerese do status: um estado novo só aparece depois de persistir por holdSeconds,
    /// para o chip não ficar piscando com variações de um frame. A primeira leitura vale na hora.
    /// </summary>
    public sealed class TrackingStatusFilter
    {
        public TrackingStatus Current { get; private set; } = TrackingStatus.Initializing;
        public float HoldSeconds { get; }

        TrackingStatus candidate = TrackingStatus.Initializing;
        float candidateSeconds;
        bool hasValue;

        public TrackingStatusFilter(float holdSeconds = 1f)
        {
            HoldSeconds = holdSeconds;
        }

        /// <summary>Retorna true quando o status estável mudou.</summary>
        public bool Update(TrackingStatus raw, float deltaTime)
        {
            if (!hasValue)
            {
                hasValue = true;
                candidate = raw;
                return Set(raw);
            }

            if (raw == Current)
            {
                candidate = raw;
                candidateSeconds = 0f;
                return false;
            }

            if (raw != candidate)
            {
                candidate = raw;
                candidateSeconds = 0f;
            }

            candidateSeconds += deltaTime;
            return candidateSeconds >= HoldSeconds && Set(raw);
        }

        bool Set(TrackingStatus value)
        {
            candidateSeconds = 0f;
            if (value == Current)
                return false;
            Current = value;
            return true;
        }
    }
}
