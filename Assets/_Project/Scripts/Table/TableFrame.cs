using System;
using UnityEngine;

namespace MtgAr.Table
{
    public enum TableSide
    {
        Me,
        Opponent,
        Outside,
    }

    /// <summary>De que lado da mesa o jogador está, visto a partir do celular.</summary>
    public enum PlayerSeat
    {
        NearCamera,
        FarFromCamera,
        CameraLeft,
        CameraRight,
    }

    /// <summary>
    /// Sistema de coordenadas da área de jogo, independente do AR Foundation (testável em EditMode).
    ///
    /// Origem no centro da mesa calibrado; Forward aponta do meu lado para o oponente; Right completa
    /// a base sobre o plano. Coordenadas de mesa são em metros: x = direita, y = frente.
    /// Reutilizado pelo CardTracker (Fase 3): SideOf, IsOnTable e YawRelativeToForward.
    /// </summary>
    [Serializable]
    public readonly struct TableFrame
    {
        public const float DefaultWidth = 0.60f;
        public const float DefaultDepth = 0.70f;

        public readonly Vector3 Origin;
        public readonly Vector3 Normal;
        public readonly Vector3 Forward;
        public readonly float Width;
        public readonly float Depth;

        public Vector3 Right => Vector3.Cross(Normal, Forward);
        public Quaternion Rotation => Quaternion.LookRotation(Forward, Normal);

        public TableFrame(Vector3 origin, Vector3 normal, Vector3 forwardHint,
                          float width = DefaultWidth, float depth = DefaultDepth)
        {
            Origin = origin;
            Normal = normal.sqrMagnitude > 1e-8f ? normal.normalized : Vector3.up;

            var forward = Vector3.ProjectOnPlane(forwardHint, Normal);
            if (forward.sqrMagnitude < 1e-8f)
            {
                // Dica paralela à normal (câmera bem em cima do centro): qualquer eixo do plano serve.
                forward = Vector3.ProjectOnPlane(Vector3.forward, Normal);
                if (forward.sqrMagnitude < 1e-8f)
                    forward = Vector3.ProjectOnPlane(Vector3.right, Normal);
            }

            Forward = forward.normalized;
            Width = Mathf.Max(0.05f, width);
            Depth = Mathf.Max(0.05f, depth);
        }

        /// <summary>Frente = direção da câmera até o centro, projetada na mesa (jogador perto do celular).</summary>
        public static TableFrame FromCamera(Vector3 center, Vector3 normal, Vector3 cameraPosition,
                                            float width = DefaultWidth, float depth = DefaultDepth)
        {
            return new TableFrame(center, normal, center - cameraPosition, width, depth);
        }

        /// <summary>Gira a frente conforme o lado em que o jogador está em relação ao celular.</summary>
        public static TableFrame ForSeat(PlayerSeat seat, Vector3 center, Vector3 normal, Vector3 cameraPosition,
                                         float width = DefaultWidth, float depth = DefaultDepth)
        {
            var frame = FromCamera(center, normal, cameraPosition, width, depth);
            switch (seat)
            {
                case PlayerSeat.FarFromCamera: return frame.RotatedBy(180f);
                case PlayerSeat.CameraLeft: return frame.RotatedBy(90f);
                case PlayerSeat.CameraRight: return frame.RotatedBy(-90f);
                default: return frame;
            }
        }

        public Vector2 WorldToTable(Vector3 world)
        {
            var d = world - Origin;
            return new Vector2(Vector3.Dot(d, Right), Vector3.Dot(d, Forward));
        }

        public Vector3 TableToWorld(Vector2 table, float height = 0f)
        {
            return Origin + Right * table.x + Forward * table.y + Normal * height;
        }

        public float HeightAbove(Vector3 world) => Vector3.Dot(world - Origin, Normal);

        /// <summary>Está apoiado na mesa (não na mão de alguém)? Tolerância padrão de 2 cm.</summary>
        public bool IsOnTable(Vector3 world, float tolerance = 0.02f) => Mathf.Abs(HeightAbove(world)) <= tolerance;

        public bool Contains(Vector3 world, float margin = 0f)
        {
            var t = WorldToTable(world);
            return Mathf.Abs(t.x) <= Width / 2f + margin && Mathf.Abs(t.y) <= Depth / 2f + margin;
        }

        public TableSide SideOf(Vector3 world, float margin = 0f)
        {
            if (!Contains(world, margin))
                return TableSide.Outside;
            return WorldToTable(world).y < 0f ? TableSide.Me : TableSide.Opponent;
        }

        /// <summary>
        /// Ângulo (graus, -180..180) entre uma direção sobre a mesa e a frente, positivo para a direita.
        /// Uma carta desvirada tem o eixo longo perto de 0°/180°; virada, perto de ±90°.
        /// </summary>
        public float YawRelativeToForward(Vector3 direction)
        {
            var projected = Vector3.ProjectOnPlane(direction, Normal);
            if (projected.sqrMagnitude < 1e-8f)
                return 0f;
            return Vector3.SignedAngle(Forward, projected, Normal);
        }

        public TableFrame RotatedBy(float degrees)
        {
            return new TableFrame(Origin, Normal, Quaternion.AngleAxis(degrees, Normal) * Forward, Width, Depth);
        }

        public TableFrame Flipped() => RotatedBy(180f);

        public TableFrame WithForward(Vector3 forwardHint) => new TableFrame(Origin, Normal, forwardHint, Width, Depth);

        public TableFrame MovedTo(Vector3 origin) => new TableFrame(origin, Normal, Forward, Width, Depth);

        public TableFrame Resized(float width, float depth) => new TableFrame(Origin, Normal, Forward, width, depth);

        public TableFrame Scaled(float factor) => Resized(DefaultWidth * factor, DefaultDepth * factor);

        /// <summary>Cantos da área em sentido horário visto de cima, começando no canto esquerdo do meu lado.</summary>
        public Vector3[] Corners(float height = 0f)
        {
            float hw = Width / 2f, hd = Depth / 2f;
            return new[]
            {
                TableToWorld(new Vector2(-hw, -hd), height),
                TableToWorld(new Vector2(-hw, hd), height),
                TableToWorld(new Vector2(hw, hd), height),
                TableToWorld(new Vector2(hw, -hd), height),
            };
        }

        /// <summary>Interseção de um raio (ex.: da câmera) com o plano da mesa.</summary>
        public bool Raycast(Ray ray, out Vector3 hit)
        {
            var denom = Vector3.Dot(ray.direction, Normal);
            hit = default;
            if (Mathf.Abs(denom) < 1e-6f)
                return false;
            var t = Vector3.Dot(Origin - ray.origin, Normal) / denom;
            if (t < 0f)
                return false;
            hit = ray.origin + ray.direction * t;
            return true;
        }
    }
}
