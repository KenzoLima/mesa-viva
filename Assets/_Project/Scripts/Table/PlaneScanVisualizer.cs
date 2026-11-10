using UnityEngine;

namespace MtgAr.Table
{
    /// <summary>
    /// Vai no prefab de plano do ARPlaneManager (junto do ARPlaneMeshVisualizer e de um MeshRenderer
    /// com o material RunicGrid). Faz a grade dourada "acender" aos poucos quando o plano aparece.
    /// Quem esconde os planos depois do ajuste é o TableCalibrationController.
    /// </summary>
    [RequireComponent(typeof(MeshRenderer))]
    public class PlaneScanVisualizer : MonoBehaviour
    {
        static readonly int RevealId = Shader.PropertyToID("_Reveal");

        [SerializeField] float revealSeconds = 0.8f;

        MeshRenderer meshRenderer;
        MaterialPropertyBlock block;
        float shownAt;

        void Awake()
        {
            meshRenderer = GetComponent<MeshRenderer>();
            block = new MaterialPropertyBlock();
        }

        void OnEnable()
        {
            shownAt = Time.time;
            Apply(0f);
        }

        void Update()
        {
            var t = Mathf.Clamp01((Time.time - shownAt) / revealSeconds);
            Apply(t * t * (3f - 2f * t));
        }

        void Apply(float reveal)
        {
            meshRenderer.GetPropertyBlock(block);
            block.SetFloat(RevealId, reveal);
            meshRenderer.SetPropertyBlock(block);
        }
    }
}
