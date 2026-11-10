using TMPro;
using UnityEngine;

namespace MtgAr.Table
{
    /// <summary>
    /// Desenha a área de jogo sobre a mesa durante o ajuste: borda dourada, linha divisória,
    /// seta de frente com a alça de rotação e os rótulos VOCÊ / OPONENTE.
    /// Ao confirmar, pisca e some aos poucos.
    /// </summary>
    public class TableAreaVisualizer : MonoBehaviour
    {
        [SerializeField] TableCalibrationController controller;

        [Tooltip("Material unlit transparente (ex.: URP/Unlit, Surface Type = Transparent).")]
        [SerializeField] Material lineMaterial;

        [SerializeField] Color gold = new Color(0.902f, 0.761f, 0.478f);
        [SerializeField] float lineWidth = 0.004f;

        [Tooltip("Altura acima da mesa para não brigar com o plano (z-fighting).")]
        [SerializeField] float lift = 0.002f;

        [Tooltip("Prefab opcional para a alça de rotação (ex.: um disco).")]
        [SerializeField] GameObject handlePrefab;

        [SerializeField] TextMeshPro meLabel;
        [SerializeField] TextMeshPro opponentLabel;

        [SerializeField] float fadeSeconds = 2.5f;

        LineRenderer border, midline, arrow;
        GameObject handle;
        float fadeStart = -1f;

        void Awake()
        {
            border = CreateLine("Borda", true);
            midline = CreateLine("Linha divisória", false);
            arrow = CreateLine("Seta", false);
            if (handlePrefab != null)
                handle = Instantiate(handlePrefab, transform);
            SetVisible(false);
        }

        void OnEnable()
        {
            controller.FrameChanged += Redraw;
            controller.StateChanged += OnStateChanged;
        }

        void OnDisable()
        {
            controller.FrameChanged -= Redraw;
            controller.StateChanged -= OnStateChanged;
        }

        void OnStateChanged(CalibrationState state)
        {
            if (state == CalibrationState.Adjusting)
            {
                fadeStart = -1f;
                SetAlpha(1f);
                SetVisible(true);
                SetHandleVisible(true);
            }
            else if (state == CalibrationState.Confirmed)
            {
                SetHandleVisible(false);
                fadeStart = Time.time;
            }
            else
            {
                SetVisible(false);
            }
        }

        void Update()
        {
            if (fadeStart < 0f)
                return;
            var t = (Time.time - fadeStart) / fadeSeconds;
            // Dois piscões rápidos e depois some.
            var blink = t < 0.3f ? (Mathf.Sin(t / 0.3f * Mathf.PI * 4f) * 0.5f + 0.5f) : 1f;
            SetAlpha(Mathf.Clamp01(1f - Mathf.Max(0f, t - 0.3f) / 0.7f) * blink);
            if (t >= 1f)
            {
                fadeStart = -1f;
                SetVisible(false);
            }
        }

        void Redraw(TableFrame frame)
        {
            float hw = frame.Width / 2f, hd = frame.Depth / 2f;

            // TransformZ = a face visível da linha aponta para o Z do objeto: alinhamos com a normal da mesa.
            var facing = Quaternion.LookRotation(frame.Normal, frame.Forward);
            border.transform.rotation = midline.transform.rotation = arrow.transform.rotation = facing;

            var corners = frame.Corners(lift);
            border.positionCount = corners.Length;
            border.SetPositions(corners);

            midline.positionCount = 2;
            midline.SetPosition(0, frame.TableToWorld(new Vector2(-hw, 0f), lift));
            midline.SetPosition(1, frame.TableToWorld(new Vector2(hw, 0f), lift));

            var handlePosition = controller.HandleWorldPosition + frame.Normal * lift;
            arrow.positionCount = 2;
            arrow.SetPosition(0, frame.TableToWorld(Vector2.zero, lift));
            arrow.SetPosition(1, handlePosition);

            if (handle != null)
                handle.transform.SetPositionAndRotation(handlePosition, frame.Rotation);

            PlaceLabel(meLabel, frame, new Vector2(0f, -hd + 0.06f), 0f);
            // O rótulo do oponente fica de frente para ele.
            PlaceLabel(opponentLabel, frame, new Vector2(0f, hd - 0.06f), 180f);
        }

        void PlaceLabel(TextMeshPro label, TableFrame frame, Vector2 at, float yaw)
        {
            if (label == null)
                return;
            // Deitado sobre a mesa, legível para quem está daquele lado.
            label.transform.SetPositionAndRotation(
                frame.TableToWorld(at, lift),
                frame.Rotation * Quaternion.Euler(90f, yaw, 0f));
        }

        LineRenderer CreateLine(string lineName, bool loop)
        {
            var go = new GameObject(lineName);
            go.transform.SetParent(transform, false);
            var line = go.AddComponent<LineRenderer>();
            line.sharedMaterial = lineMaterial;
            line.useWorldSpace = true;
            line.loop = loop;
            line.widthMultiplier = lineWidth;
            line.numCapVertices = 2;
            line.alignment = LineAlignment.TransformZ;
            line.startColor = line.endColor = gold;
            return line;
        }

        void SetAlpha(float alpha)
        {
            var c = gold;
            c.a = alpha;
            foreach (var line in new[] { border, midline, arrow })
                line.startColor = line.endColor = c;
            if (meLabel != null)
                meLabel.alpha = alpha;
            if (opponentLabel != null)
                opponentLabel.alpha = alpha;
        }

        void SetVisible(bool visible)
        {
            border.enabled = midline.enabled = arrow.enabled = visible;
            if (meLabel != null)
                meLabel.gameObject.SetActive(visible);
            if (opponentLabel != null)
                opponentLabel.gameObject.SetActive(visible);
            if (!visible)
                SetHandleVisible(false);
        }

        void SetHandleVisible(bool visible)
        {
            if (handle != null)
                handle.SetActive(visible);
        }
    }
}
