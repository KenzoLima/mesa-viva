using MtgAr.Table;
using NUnit.Framework;
using UnityEngine;

namespace MtgAr.Tests
{
    public class TableFrameTests
    {
        const float Eps = 1e-4f;

        static void AssertVec(Vector3 expected, Vector3 actual, float eps = Eps)
        {
            Assert.AreEqual(expected.x, actual.x, eps, "x");
            Assert.AreEqual(expected.y, actual.y, eps, "y");
            Assert.AreEqual(expected.z, actual.z, eps, "z");
        }

        static TableFrame Flat(Vector3 origin, float yawDegrees = 0f)
        {
            return new TableFrame(origin, Vector3.up, Vector3.forward).RotatedBy(yawDegrees);
        }

        [Test]
        public void Axes_AreOrthonormal_AndRightFollowsUnityHandedness()
        {
            var frame = Flat(Vector3.zero);
            AssertVec(Vector3.forward, frame.Forward);
            AssertVec(Vector3.right, frame.Right);
            AssertVec(Vector3.up, frame.Normal);
        }

        [Test]
        public void ForwardHint_IsProjectedOntoTable()
        {
            // Câmera olhando para baixo em diagonal: a frente fica só a parte horizontal.
            var frame = new TableFrame(Vector3.zero, Vector3.up, new Vector3(0f, -2f, 1f));
            AssertVec(Vector3.forward, frame.Forward);
        }

        [Test]
        public void ForwardHint_ParallelToNormal_StillGivesValidAxis()
        {
            var frame = new TableFrame(Vector3.zero, Vector3.up, Vector3.down);
            Assert.AreEqual(1f, frame.Forward.magnitude, Eps);
            Assert.AreEqual(0f, Vector3.Dot(frame.Forward, frame.Normal), Eps);
        }

        [Test]
        public void WorldToTable_RoundTrips_OnRotatedTable()
        {
            var frame = Flat(new Vector3(0.3f, 0.75f, -1.2f), 37f);
            var table = new Vector2(0.12f, -0.21f);
            var world = frame.TableToWorld(table);
            var back = frame.WorldToTable(world);
            Assert.AreEqual(table.x, back.x, Eps);
            Assert.AreEqual(table.y, back.y, Eps);
            Assert.AreEqual(0f, frame.HeightAbove(world), Eps);
        }

        [Test]
        public void SideOf_UsesForwardAxis_EvenWhenRotated()
        {
            var frame = Flat(new Vector3(1f, 0.7f, 2f), 37f);
            Assert.AreEqual(TableSide.Me, frame.SideOf(frame.TableToWorld(new Vector2(0.05f, -0.2f))));
            Assert.AreEqual(TableSide.Opponent, frame.SideOf(frame.TableToWorld(new Vector2(-0.1f, 0.2f))));
            Assert.AreEqual(TableSide.Outside, frame.SideOf(frame.TableToWorld(new Vector2(0.5f, 0.1f))));
            Assert.AreEqual(TableSide.Outside, frame.SideOf(frame.TableToWorld(new Vector2(0f, 0.36f))));
        }

        [Test]
        public void Flipped_SwapsSides()
        {
            var frame = Flat(Vector3.zero);
            var point = frame.TableToWorld(new Vector2(0f, -0.2f));
            Assert.AreEqual(TableSide.Me, frame.SideOf(point));
            Assert.AreEqual(TableSide.Opponent, frame.Flipped().SideOf(point));
        }

        [Test]
        public void IsOnTable_RejectsCardsHeldInTheAir()
        {
            var frame = Flat(new Vector3(0f, 0.75f, 0f));
            Assert.IsTrue(frame.IsOnTable(new Vector3(0.1f, 0.76f, 0.1f)));
            Assert.IsFalse(frame.IsOnTable(new Vector3(0.1f, 0.85f, 0.1f)));
            Assert.AreEqual(0.1f, frame.HeightAbove(new Vector3(0f, 0.85f, 0f)), Eps);
        }

        [Test]
        public void Yaw_IsPositiveToTheRight_AndDetectsTappedCards()
        {
            var frame = Flat(Vector3.zero, 37f);
            Assert.AreEqual(0f, frame.YawRelativeToForward(frame.Forward), 0.01f);
            Assert.AreEqual(90f, frame.YawRelativeToForward(frame.Right), 0.01f);
            Assert.AreEqual(-90f, frame.YawRelativeToForward(-frame.Right), 0.01f);
            Assert.AreEqual(180f, Mathf.Abs(frame.YawRelativeToForward(-frame.Forward)), 0.01f);
        }

        [Test]
        public void RotatedBy_PositiveTurnsForwardToTheRight()
        {
            var frame = Flat(Vector3.zero).RotatedBy(90f);
            AssertVec(Vector3.right, frame.Forward);
        }

        [Test]
        public void ForSeat_MatchesWhereThePlayerSits()
        {
            var camera = new Vector3(0f, 0.55f, -0.45f);
            var center = new Vector3(0f, 0f, 0.5f);
            AssertVec(Vector3.forward, TableFrame.ForSeat(PlayerSeat.NearCamera, center, Vector3.up, camera).Forward);
            AssertVec(Vector3.back, TableFrame.ForSeat(PlayerSeat.FarFromCamera, center, Vector3.up, camera).Forward);
            // Sentado à esquerda do celular, o jogador olha para a direita da imagem.
            AssertVec(Vector3.right, TableFrame.ForSeat(PlayerSeat.CameraLeft, center, Vector3.up, camera).Forward);
            AssertVec(Vector3.left, TableFrame.ForSeat(PlayerSeat.CameraRight, center, Vector3.up, camera).Forward);
        }

        [Test]
        public void Scaled_KeepsAspect()
        {
            var frame = Flat(Vector3.zero).Scaled(1.2f);
            Assert.AreEqual(TableFrame.DefaultWidth * 1.2f, frame.Width, Eps);
            Assert.AreEqual(TableFrame.DefaultDepth * 1.2f, frame.Depth, Eps);
        }

        [Test]
        public void Corners_AreOnTheTableAtHalfExtents()
        {
            var frame = Flat(new Vector3(0.2f, 0.7f, 0.4f), 20f);
            var corners = frame.Corners();
            Assert.AreEqual(4, corners.Length);
            var first = frame.WorldToTable(corners[0]);
            Assert.AreEqual(-frame.Width / 2f, first.x, Eps);
            Assert.AreEqual(-frame.Depth / 2f, first.y, Eps);
        }

        [Test]
        public void Raycast_FromCameraHitsTablePlane()
        {
            var frame = Flat(new Vector3(0f, 0.75f, 0f));
            var ray = new Ray(new Vector3(0f, 1.3f, -0.45f), new Vector3(0f, -0.55f, 0.45f).normalized);
            Assert.IsTrue(frame.Raycast(ray, out var hit));
            AssertVec(new Vector3(0f, 0.75f, 0f), hit, 1e-3f);

            var upward = new Ray(new Vector3(0f, 1.3f, 0f), Vector3.up);
            Assert.IsFalse(frame.Raycast(upward, out _));
        }
    }
}
