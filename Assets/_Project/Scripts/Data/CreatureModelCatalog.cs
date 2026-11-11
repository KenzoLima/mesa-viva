using System.Collections.Generic;
using UnityEngine;

namespace MtgAr.Data
{
    /// <summary>
    /// Carrega o modelo 3D de cada id do model_map.json ("demon", "vampire"...) a partir de
    /// Resources/Models/Creatures/&lt;id&gt;.glb (importados pelo glTFast). Todos CC0 — ver docs/CREDITS.md.
    /// </summary>
    public static class CreatureModelCatalog
    {
        public const string Folder = "Models/Creatures/";

        static readonly Dictionary<string, GameObject> cache = new();

        /// <summary>Prefab do modelo, ou null se não houver arquivo para esse id.</summary>
        public static GameObject Get(string modelId)
        {
            if (string.IsNullOrEmpty(modelId))
                return null;
            if (cache.TryGetValue(modelId, out var prefab))
                return prefab;

            prefab = Resources.Load<GameObject>(Folder + modelId);
            if (prefab == null)
                Debug.LogWarning($"[CreatureModelCatalog] Sem modelo para '{modelId}' em Resources/{Folder}.");
            cache[modelId] = prefab;
            return prefab;
        }

        public static bool Has(string modelId) => Get(modelId) != null;

        /// <summary>Instancia o modelo sob <paramref name="parent"/>; null se não existir.</summary>
        public static GameObject Spawn(string modelId, Transform parent)
        {
            var prefab = Get(modelId);
            return prefab == null ? null : Object.Instantiate(prefab, parent);
        }
    }
}
