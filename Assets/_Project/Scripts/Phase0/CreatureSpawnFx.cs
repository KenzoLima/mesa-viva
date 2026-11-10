using UnityEngine;

namespace MtgAr.Phase0
{
    /// <summary>
    /// Animação procedural para modelos sem animação própria (comum em assets grátis):
    /// "pop" de entrada com leve exagero e uma flutuação de idle.
    /// Toca de novo sempre que o objeto é reativado (a carta voltou a ser vista).
    /// </summary>
    public class CreatureSpawnFx : MonoBehaviour
    {
        public float popDuration = 0.45f;
        public bool idleBob = true;
        public float bobHeightMeters = 0.004f;
        public float bobCyclesPerSecond = 0.5f;

        Vector3 baseScale;
        Vector3 basePosition;
        float elapsed;

        void Awake()
        {
            baseScale = transform.localScale;
            basePosition = transform.localPosition;
        }

        void OnEnable()
        {
            elapsed = 0f;
            transform.localScale = Vector3.zero;
        }

        void OnDisable()
        {
            transform.localScale = baseScale;
            transform.localPosition = basePosition;
        }

        void Update()
        {
            elapsed += Time.deltaTime;

            var t = Mathf.Clamp01(elapsed / popDuration);
            transform.localScale = baseScale * EaseOutBack(t);

            if (idleBob)
            {
                var wave = Mathf.Sin(elapsed * bobCyclesPerSecond * 2f * Mathf.PI) * 0.5f + 0.5f;
                transform.localPosition = basePosition + Vector3.up * (wave * bobHeightMeters);
            }
        }

        static float EaseOutBack(float x)
        {
            const float c1 = 1.70158f;
            const float c3 = c1 + 1f;
            var p = x - 1f;
            return 1f + c3 * p * p * p + c1 * p * p;
        }
    }
}
