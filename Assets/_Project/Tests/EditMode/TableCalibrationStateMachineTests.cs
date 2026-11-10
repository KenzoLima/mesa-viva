using System.Collections.Generic;
using MtgAr.Table;
using NUnit.Framework;

namespace MtgAr.Tests
{
    public class TableCalibrationStateMachineTests
    {
        static TableCalibrationStateMachine Ready()
        {
            var machine = new TableCalibrationStateMachine(15f);
            machine.Tick(0.1f, tableFound: true, trackingOk: true);
            return machine;
        }

        [Test]
        public void HappyPath_ScanTapConfirm()
        {
            var machine = new TableCalibrationStateMachine();
            var seen = new List<CalibrationState>();
            machine.StateChanged += (_, next) => seen.Add(next);

            machine.Tick(1f, tableFound: false, trackingOk: true);
            Assert.AreEqual(CalibrationState.Scanning, machine.State);

            machine.Tick(0.1f, tableFound: true, trackingOk: true);
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);

            Assert.AreEqual(TapResult.CenterSet, machine.OnTap(hitTable: true));
            Assert.AreEqual(CalibrationState.Adjusting, machine.State);

            Assert.IsTrue(machine.Confirm());
            Assert.AreEqual(CalibrationState.Confirmed, machine.State);

            CollectionAssert.AreEqual(new[]
            {
                CalibrationState.AwaitingCenterTap, CalibrationState.Adjusting, CalibrationState.Confirmed,
            }, seen);
        }

        [Test]
        public void TapOutsideTable_IsInvalid_AndKeepsWaiting()
        {
            var machine = Ready();
            Assert.AreEqual(TapResult.Invalid, machine.OnTap(hitTable: false));
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);
        }

        [Test]
        public void TapWhileAdjusting_Recenters()
        {
            var machine = Ready();
            machine.OnTap(true);
            Assert.AreEqual(TapResult.Recentered, machine.OnTap(true));
            Assert.AreEqual(TapResult.Invalid, machine.OnTap(false));
            Assert.AreEqual(CalibrationState.Adjusting, machine.State);
        }

        [Test]
        public void TapDuringScanOrAfterConfirm_IsIgnored()
        {
            var machine = new TableCalibrationStateMachine();
            Assert.AreEqual(TapResult.Ignored, machine.OnTap(true));

            machine = Ready();
            machine.OnTap(true);
            machine.Confirm();
            Assert.AreEqual(TapResult.Ignored, machine.OnTap(true));
        }

        [Test]
        public void ConfirmOnlyWorksWhileAdjusting()
        {
            var machine = Ready();
            Assert.IsFalse(machine.Confirm());
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);
        }

        [Test]
        public void NoTable_ShowsHintAfterTimeout_AndRecoversWhenFound()
        {
            var machine = new TableCalibrationStateMachine(15f);
            for (var i = 0; i < 149; i++)
                machine.Tick(0.1f, tableFound: false, trackingOk: true);
            Assert.AreEqual(CalibrationState.Scanning, machine.State);

            machine.Tick(0.2f, tableFound: false, trackingOk: true);
            Assert.AreEqual(CalibrationState.NoTableHint, machine.State);

            machine.Tick(0.1f, tableFound: true, trackingOk: true);
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);
        }

        [Test]
        public void RetryScan_RestartsTheTimer()
        {
            var machine = new TableCalibrationStateMachine(1f);
            machine.Tick(1.5f, false, true);
            Assert.AreEqual(CalibrationState.NoTableHint, machine.State);

            machine.RetryScan();
            Assert.AreEqual(CalibrationState.Scanning, machine.State);
            Assert.AreEqual(0f, machine.ScanSeconds, 1e-6f);
        }

        [Test]
        public void TrackingLost_FreezesTimerAndIgnoresInput()
        {
            var machine = new TableCalibrationStateMachine(1f);
            var lostEvents = new List<bool>();
            machine.TrackingLostChanged += lostEvents.Add;

            machine.Tick(5f, tableFound: false, trackingOk: false);
            Assert.IsTrue(machine.TrackingLost);
            Assert.AreEqual(CalibrationState.Scanning, machine.State, "o tempo sem rastreamento não conta");

            machine.Tick(0.1f, tableFound: true, trackingOk: true);
            Assert.IsFalse(machine.TrackingLost);
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);
            CollectionAssert.AreEqual(new[] { true, false }, lostEvents);
        }

        [Test]
        public void TrackingLostWhileAdjusting_BlocksTapAndConfirm()
        {
            var machine = Ready();
            machine.OnTap(true);
            machine.Tick(0.1f, true, trackingOk: false);

            Assert.AreEqual(TapResult.Ignored, machine.OnTap(true));
            Assert.IsFalse(machine.Confirm());
            Assert.AreEqual(CalibrationState.Adjusting, machine.State);

            machine.Tick(0.1f, true, trackingOk: true);
            Assert.IsTrue(machine.Confirm());
        }

        [Test]
        public void Recalibrate_SkipsScanWhenTableIsStillKnown()
        {
            var machine = Ready();
            machine.OnTap(true);
            machine.Confirm();

            machine.Recalibrate(tableStillKnown: true);
            Assert.AreEqual(CalibrationState.AwaitingCenterTap, machine.State);

            machine.OnTap(true);
            machine.Confirm();
            machine.Recalibrate(tableStillKnown: false);
            Assert.AreEqual(CalibrationState.Scanning, machine.State);
        }
    }

    public class TrackingStatusFilterTests
    {
        [Test]
        public void FirstReading_AppliesImmediately()
        {
            var filter = new TrackingStatusFilter(1f);
            Assert.IsTrue(filter.Update(TrackingStatus.Good, 0.016f));
            Assert.AreEqual(TrackingStatus.Good, filter.Current);
        }

        [Test]
        public void ShortGlitch_DoesNotChangeStatus()
        {
            var filter = new TrackingStatusFilter(1f);
            filter.Update(TrackingStatus.Good, 0.016f);
            for (var i = 0; i < 30; i++)
                Assert.IsFalse(filter.Update(TrackingStatus.ExcessiveMotion, 0.016f));
            filter.Update(TrackingStatus.Good, 0.016f);
            Assert.AreEqual(TrackingStatus.Good, filter.Current);
        }

        [Test]
        public void PersistentChange_AppliesAfterHold()
        {
            var filter = new TrackingStatusFilter(1f);
            filter.Update(TrackingStatus.Good, 0.016f);
            var changed = false;
            for (var i = 0; i < 70 && !changed; i++)
                changed = filter.Update(TrackingStatus.LowLight, 0.016f);
            Assert.IsTrue(changed);
            Assert.AreEqual(TrackingStatus.LowLight, filter.Current);
        }

        [Test]
        public void AlternatingCandidates_ResetTheHold()
        {
            var filter = new TrackingStatusFilter(1f);
            filter.Update(TrackingStatus.Good, 0.016f);
            for (var i = 0; i < 20; i++)
            {
                filter.Update(TrackingStatus.LowLight, 0.3f);
                filter.Update(TrackingStatus.ExcessiveMotion, 0.3f);
            }
            Assert.AreEqual(TrackingStatus.Good, filter.Current);
        }

        [Test]
        public void Texts_AreInPortuguese_AndLevelsMakeSense()
        {
            Assert.AreEqual("Rastreando bem", TrackingStatusText.Label(TrackingStatus.Good));
            Assert.AreEqual(StatusLevel.Ok, TrackingStatusText.Level(TrackingStatus.Good));
            Assert.AreEqual(StatusLevel.Warning, TrackingStatusText.Level(TrackingStatus.LowLight));
            Assert.AreEqual(StatusLevel.Error, TrackingStatusText.Level(TrackingStatus.Lost));
            Assert.IsTrue(TrackingStatusText.IsTracking(TrackingStatus.LowLight));
            Assert.IsFalse(TrackingStatusText.IsTracking(TrackingStatus.Relocalizing));
        }
    }
}
