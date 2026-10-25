using System;

namespace MtgAr.Table
{
    public enum CalibrationState
    {
        Scanning,
        NoTableHint,
        AwaitingCenterTap,
        Adjusting,
        Confirmed,
    }

    public enum TapResult
    {
        Ignored,
        CenterSet,
        Recentered,
        Invalid,
    }

    /// <summary>
    /// Fluxo da calibração, sem nenhuma dependência de AR (testável em EditMode).
    ///
    /// Scanning ──(achou plano)──► AwaitingCenterTap ──(toque válido)──► Adjusting ──(Confirm)──► Confirmed
    ///    │ 15 s sem plano                                                   ▲                      │
    ///    ▼                                                                   └──── Recalibrate ─────┘
    /// NoTableHint ──(achou plano)──► AwaitingCenterTap
    ///
    /// Com o rastreamento perdido (TrackingLost), nada avança: o tempo não conta e toques são ignorados.
    /// </summary>
    public sealed class TableCalibrationStateMachine
    {
        public CalibrationState State { get; private set; } = CalibrationState.Scanning;
        public bool TrackingLost { get; private set; }
        public float NoTableTimeoutSeconds { get; }
        public float ScanSeconds { get; private set; }

        /// <summary>(anterior, novo)</summary>
        public event Action<CalibrationState, CalibrationState> StateChanged;
        public event Action<bool> TrackingLostChanged;

        public TableCalibrationStateMachine(float noTableTimeoutSeconds = 15f)
        {
            NoTableTimeoutSeconds = noTableTimeoutSeconds;
        }

        public void Tick(float deltaTime, bool tableFound, bool trackingOk)
        {
            if (TrackingLost == trackingOk)
            {
                TrackingLost = !trackingOk;
                TrackingLostChanged?.Invoke(TrackingLost);
            }
            if (TrackingLost)
                return;

            switch (State)
            {
                case CalibrationState.Scanning:
                    if (tableFound)
                    {
                        SetState(CalibrationState.AwaitingCenterTap);
                        break;
                    }
                    ScanSeconds += deltaTime;
                    if (ScanSeconds >= NoTableTimeoutSeconds)
                        SetState(CalibrationState.NoTableHint);
                    break;

                case CalibrationState.NoTableHint:
                    if (tableFound)
                        SetState(CalibrationState.AwaitingCenterTap);
                    break;
            }
        }

        /// <summary>O jogador tocou na tela; hitTable = o toque acertou um plano horizontal.</summary>
        public TapResult OnTap(bool hitTable)
        {
            if (TrackingLost)
                return TapResult.Ignored;

            switch (State)
            {
                case CalibrationState.AwaitingCenterTap:
                    if (!hitTable)
                        return TapResult.Invalid;
                    SetState(CalibrationState.Adjusting);
                    return TapResult.CenterSet;

                case CalibrationState.Adjusting:
                    return hitTable ? TapResult.Recentered : TapResult.Invalid;

                default:
                    return TapResult.Ignored;
            }
        }

        public bool Confirm()
        {
            if (TrackingLost || State != CalibrationState.Adjusting)
                return false;
            SetState(CalibrationState.Confirmed);
            return true;
        }

        /// <summary>Volta ao começo. Se a mesa ainda é conhecida, pula direto para o toque no centro.</summary>
        public void Recalibrate(bool tableStillKnown)
        {
            ScanSeconds = 0f;
            SetState(tableStillKnown ? CalibrationState.AwaitingCenterTap : CalibrationState.Scanning);
        }

        /// <summary>Botão "Tentar de novo" da dica de mesa não encontrada.</summary>
        public void RetryScan()
        {
            ScanSeconds = 0f;
            if (State == CalibrationState.NoTableHint)
                SetState(CalibrationState.Scanning);
        }

        void SetState(CalibrationState next)
        {
            if (next == State)
                return;
            var previous = State;
            State = next;
            if (next == CalibrationState.Scanning)
                ScanSeconds = 0f;
            StateChanged?.Invoke(previous, next);
        }
    }
}
