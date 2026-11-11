using System;
using System.Collections.Generic;
using UnityEngine;

namespace MtgAr.Phase0
{
    /// <summary>
    /// Fase 0: liga o nome de cada imagem da Reference Image Library ao prefab da criatura.
    /// Crie em Assets > Create > MTG AR > Card Prefab Library.
    /// </summary>
    [CreateAssetMenu(menuName = "MTG AR/Card Prefab Library", fileName = "CardPrefabLibrary")]
    public class CardPrefabLibrary : ScriptableObject
    {
        [Serializable]
        public class Entry
        {
            [Tooltip("Exatamente o mesmo nome da imagem na Reference Image Library.")]
            public string referenceImageName;
            public GameObject prefab;
            [Tooltip("Opcional: id do model_map.json (ex.: demon, vampire). Usado quando 'prefab' está vazio.")]
            public string modelId;
            [Tooltip("Altura da criatura em metros (a carta tem 0,088 m de altura).")]
            public float heightMeters = 0.07f;
            [Tooltip("Giro extra em Y para modelos que vêm de costas ou de lado.")]
            public float yRotationOffset;
        }

        [SerializeField] List<Entry> entries = new();

        [Tooltip("Usado quando a carta não está na lista (ex.: um cubo), para ver que a detecção funcionou.")]
        [SerializeField] GameObject fallbackPrefab;
        [SerializeField] float fallbackHeightMeters = 0.03f;

        public bool TryGet(string referenceImageName, out Entry entry)
        {
            foreach (var candidate in entries)
            {
                if (!string.Equals(candidate.referenceImageName, referenceImageName, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (candidate.prefab == null && !string.IsNullOrEmpty(candidate.modelId))
                    candidate.prefab = MtgAr.Data.CreatureModelCatalog.Get(candidate.modelId);
                if (candidate.prefab != null)
                {
                    entry = candidate;
                    return true;
                }
            }

            if (fallbackPrefab != null)
            {
                entry = new Entry
                {
                    referenceImageName = referenceImageName,
                    prefab = fallbackPrefab,
                    heightMeters = fallbackHeightMeters,
                };
                return true;
            }

            entry = null;
            return false;
        }
    }
}
