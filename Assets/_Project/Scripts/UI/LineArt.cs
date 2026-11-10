using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    public enum LineArtKind
    {
        Back,
        Chevron,
        Plus,
        Gear,
        Deck,
        Book,
        Sliders,
        Camera,
        Emblem,
        Stand,
        Sleeve,
        Lamp,
        Creature,
    }

    /// <summary>
    /// Ícones e ilustrações em traço dourado, desenhados com Painter2D (os mesmos do protótipo).
    /// Uso no UXML: &lt;MtgAr.UI.LineArt kind="Gear" style="width: 24px; height: 24px;" /&gt;
    /// </summary>
    [UxmlElement]
    public partial class LineArt : VisualElement
    {
        static readonly Color Gold = new Color(0.902f, 0.761f, 0.478f);
        static readonly Color GoldDark = new Color(0.788f, 0.635f, 0.302f);
        static readonly Color Muted = new Color(0.541f, 0.486f, 0.4f);
        static readonly Color Danger = new Color(0.91f, 0.541f, 0.431f);
        static readonly Color Surface = new Color(0.102f, 0.086f, 0.071f);
        static readonly Color Raised = new Color(0.141f, 0.118f, 0.094f);

        LineArtKind kind = LineArtKind.Gear;

        /// <summary>No UXML vira o atributo "kind".</summary>
        [UxmlAttribute]
        public LineArtKind Kind
        {
            get => kind;
            set { kind = value; MarkDirtyRepaint(); }
        }

        Painter2D p;
        float scale;
        Vector2 offset;

        public LineArt()
        {
            pickingMode = PickingMode.Ignore;
            generateVisualContent += Draw;
        }

        public LineArt(LineArtKind kind) : this()
        {
            this.kind = kind;
        }

        void Draw(MeshGenerationContext context)
        {
            var box = DesignSize(kind);
            var rect = contentRect;
            if (rect.width <= 0 || rect.height <= 0)
                return;
            scale = Mathf.Min(rect.width / box, rect.height / box);
            offset = new Vector2((rect.width - box * scale) / 2f, (rect.height - box * scale) / 2f);
            p = context.painter2D;
            p.lineCap = LineCap.Round;
            p.lineJoin = LineJoin.Round;

            switch (kind)
            {
                case LineArtKind.Back: Line(Gold, 2f, (15, 18), (9, 12), (15, 6)); break;
                case LineArtKind.Chevron: Line(Muted, 2f, (9, 6), (15, 12), (9, 18)); break;
                case LineArtKind.Plus: Line(Gold, 2f, (12, 5), (12, 19)); Line(Gold, 2f, (5, 12), (19, 12)); break;
                case LineArtKind.Gear: DrawGear(); break;
                case LineArtKind.Deck:
                    Rect(Gold, 1.6f, 7, 3, 12, 17);
                    Line(Gold, 1.6f, (5, 6), (5, 21), (16, 21));
                    break;
                case LineArtKind.Book:
                    Rect(Gold, 1.6f, 5, 3, 14, 18);
                    Line(Gold, 1.6f, (9, 8), (15, 8));
                    Line(Gold, 1.6f, (9, 12), (13, 12));
                    break;
                case LineArtKind.Sliders:
                    Line(Gold, 1.6f, (4, 7), (14, 7)); Line(Gold, 1.6f, (18, 7), (20, 7));
                    Line(Gold, 1.6f, (4, 17), (8, 17)); Line(Gold, 1.6f, (12, 17), (20, 17));
                    Circle(Gold, 1.6f, 16, 7, 2); Circle(Gold, 1.6f, 10, 17, 2);
                    break;
                case LineArtKind.Camera:
                    Line(Gold, 1.6f, true, (4, 8), (7, 8), (9, 5), (15, 5), (17, 8), (20, 8), (21, 9), (21, 18), (20, 19), (4, 19), (3, 18), (3, 9));
                    Circle(Gold, 1.6f, 12, 13, 3.5f);
                    break;
                case LineArtKind.Emblem: DrawEmblem(); break;
                case LineArtKind.Stand: DrawStand(); break;
                case LineArtKind.Sleeve: DrawSleeve(); break;
                case LineArtKind.Lamp: DrawLamp(); break;
                case LineArtKind.Creature: DrawCreature(); break;
            }
        }

        static float DesignSize(LineArtKind kind)
        {
            switch (kind)
            {
                case LineArtKind.Emblem: return 148f;
                case LineArtKind.Stand:
                case LineArtKind.Sleeve:
                case LineArtKind.Lamp: return 140f;
                case LineArtKind.Creature: return 64f;
                default: return 24f;
            }
        }

        // ---------- desenhos ----------

        void DrawGear()
        {
            Circle(Gold, 1.8f, 12, 12, 3f);
            Circle(Gold, 1.8f, 12, 12, 7.5f);
            for (var i = 0; i < 8; i++)
            {
                var a = i * Mathf.PI / 4f;
                Line(Gold, 2.2f, (12 + Mathf.Cos(a) * 7.5f, 12 + Mathf.Sin(a) * 7.5f), (12 + Mathf.Cos(a) * 10.5f, 12 + Mathf.Sin(a) * 10.5f));
            }
        }

        void DrawEmblem()
        {
            Circle(new Color(GoldDark.r, GoldDark.g, GoldDark.b, 0.5f), 1.5f, 74, 74, 70);
            Circle(GoldDark, 1.5f, 74, 74, 58);
            Line(GoldDark, 1.5f, (74, 4), (74, 16)); Line(GoldDark, 1.5f, (74, 132), (74, 144));
            Line(GoldDark, 1.5f, (4, 74), (16, 74)); Line(GoldDark, 1.5f, (132, 74), (144, 74));
            RotatedRect(GoldDark, Surface, 1.5f, 74, 75, 44, 62, -8f);
            RotatedRect(Gold, null, 1.5f, 74, 69, 32, 24, -8f);
            Fill(Gold, (74, 30), (80, 40), (68, 40));
        }

        void DrawStand()
        {
            Line(Gold, 2f, (14, 118), (126, 118));
            Line(Muted, 2f, (30, 118), (44, 88), (96, 88), (110, 118));
            Line(Gold, 2f, (104, 118), (104, 44));
            Line(Gold, 2f, (104, 44), (86, 30));
            RotatedRect(Gold, null, 2f, 81, 32, 22, 36, -38f);
            Line(GoldDark, 2f, (58, 104), (68, 100));
            Line(GoldDark, 2f, (76, 108), (86, 104));
        }

        void DrawSleeve()
        {
            Rect(Gold, 2f, 40, 22, 60, 88);
            Rect(Muted, 2f, 48, 30, 44, 34);
            Line(Danger, 2f, (30, 30), (48, 48)); Line(Danger, 2f, (94, 94), (112, 112));
            Line(Danger, 2f, (108, 26), (100, 34)); Line(Danger, 2f, (38, 104), (30, 112));
            Line(Muted, 2f, (54, 76), (86, 76)); Line(Muted, 2f, (54, 86), (78, 86));
        }

        void DrawLamp()
        {
            Line(Gold, 2f, (70, 16), (70, 26)); Line(Gold, 2f, (32, 30), (39, 37)); Line(Gold, 2f, (108, 30), (101, 37));
            Line(Gold, 2f, (22, 64), (32, 64)); Line(Gold, 2f, (108, 64), (118, 64));
            p.strokeColor = Gold;
            p.lineWidth = 2f * scale;
            p.BeginPath();
            p.MoveTo(Pt(56, 86));
            p.Arc(Pt(70, 64), 26f * scale, Angle.Degrees(147f), Angle.Degrees(33f), ArcDirection.Clockwise);
            p.LineTo(Pt(84, 96));
            p.LineTo(Pt(56, 96));
            p.ClosePath();
            p.Stroke();
            Line(Muted, 2f, (58, 104), (82, 104)); Line(Muted, 2f, (62, 112), (78, 112));
        }

        void DrawCreature()
        {
            var body = new[] { (32f, 6f), (41f, 17f), (38f, 30f), (46f, 41f), (41f, 60f), (23f, 60f), (18f, 41f), (26f, 30f), (23f, 17f) };
            Fill(Raised, body);
            Line(GoldDark, 1.6f, true, body);
            Fill(Gold, (28, 17), (30, 17), (30, 19), (28, 19));
            Fill(Gold, (34, 17), (36, 17), (36, 19), (34, 19));
        }

        // ---------- primitivas (coordenadas do desenho original) ----------

        Vector2 Pt(float x, float y) => new Vector2(offset.x + x * scale, offset.y + y * scale);

        void Line(Color color, float width, params (float x, float y)[] points) => Line(color, width, false, points);

        void Line(Color color, float width, bool closed, params (float x, float y)[] points)
        {
            p.strokeColor = color;
            p.lineWidth = width * scale;
            p.BeginPath();
            p.MoveTo(Pt(points[0].x, points[0].y));
            for (var i = 1; i < points.Length; i++)
                p.LineTo(Pt(points[i].x, points[i].y));
            if (closed)
                p.ClosePath();
            p.Stroke();
        }

        void Fill(Color color, params (float x, float y)[] points)
        {
            p.fillColor = color;
            p.BeginPath();
            p.MoveTo(Pt(points[0].x, points[0].y));
            for (var i = 1; i < points.Length; i++)
                p.LineTo(Pt(points[i].x, points[i].y));
            p.ClosePath();
            p.Fill();
        }

        void Rect(Color color, float width, float x, float y, float w, float h) =>
            Line(color, width, true, (x, y), (x + w, y), (x + w, y + h), (x, y + h));

        void RotatedRect(Color stroke, Color? fill, float width, float cx, float cy, float w, float h, float degrees)
        {
            var r = degrees * Mathf.Deg2Rad;
            var corners = new (float x, float y)[4];
            var half = new[] { (-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2) };
            for (var i = 0; i < 4; i++)
            {
                var (dx, dy) = half[i];
                corners[i] = (cx + dx * Mathf.Cos(r) - dy * Mathf.Sin(r), cy + dx * Mathf.Sin(r) + dy * Mathf.Cos(r));
            }
            if (fill.HasValue)
                Fill(fill.Value, corners);
            Line(stroke, width, true, corners);
        }

        void Circle(Color color, float width, float cx, float cy, float radius)
        {
            p.strokeColor = color;
            p.lineWidth = width * scale;
            p.BeginPath();
            p.Arc(Pt(cx, cy), radius * scale, Angle.Degrees(0f), Angle.Degrees(360f), ArcDirection.Clockwise);
            p.ClosePath();
            p.Stroke();
        }
    }
}
