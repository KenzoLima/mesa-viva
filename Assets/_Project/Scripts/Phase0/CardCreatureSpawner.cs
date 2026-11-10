using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace MtgAr.Phase0
{
    /// <summary>
    /// Fase 0: faz surgir uma criatura em cima de cada carta reconhecida pelo Image Tracking
    /// nativo (ARCore/ARKit). Coloque no mesmo GameObject do ARTrackedImageManager (o XR Origin).
    ///
    /// Limitação conhecida (por isso a Fase 3 troca por visão própria): o ARCore/ARKit rastreia
    /// só UMA instância de cada imagem de referência, então duas cópias da mesma carta geram
    /// uma criatura só. Use 5 cartas diferentes nos testes.
    /// </summary>
    [RequireComponent(typeof(ARTrackedImageManager))]
    public class CardCreatureSpawner : MonoBehaviour
    {
        [SerializeField] CardPrefabLibrary library;

        [Tooltip("Esconde a criatura quando a carta sai de vista (TrackingState.Limited). " +
                 "Desligado = a criatura fica na última posição conhecida.")]
        [SerializeField] bool hideWhenLimited;

        [Tooltip("Ao surgir, a criatura gira para olhar a câmera.")]
        [SerializeField] bool faceCameraOnSpawn = true;

        [SerializeField] bool logEvents = true;

        ARTrackedImageManager manager;
        readonly Dictionary<TrackableId, GameObject> spawned = new();

        void Awake()
        {
            manager = GetComponent<ARTrackedImageManager>();
        }

        void OnEnable()
        {
            manager.trackablesChanged.AddListener(OnTrackablesChanged);
        }

        void OnDisable()
        {
            manager.trackablesChanged.RemoveListener(OnTrackablesChanged);
        }

        void OnTrackablesChanged(ARTrackablesChangedEventArgs<ARTrackedImage> args)
        {
            foreach (var image in args.added)
                Spawn(image);

            foreach (var image in args.updated)
            {
                // Algumas plataformas só entregam o nome da imagem depois do primeiro update.
                if (!spawned.ContainsKey(image.trackableId))
                    Spawn(image);
                UpdateVisibility(image);
            }

            foreach (var pair in args.removed)
                Despawn(pair.Key);
        }

        void Spawn(ARTrackedImage image)
        {
            if (spawned.ContainsKey(image.trackableId))
                return;

            var cardName = image.referenceImage.name;
            if (string.IsNullOrEmpty(cardName))
                return;

            if (library == null || !library.TryGet(cardName, out var entry))
            {
                Debug.LogWarning($"[CardCreatureSpawner] Carta '{cardName}' sem prefab no CardPrefabLibrary.");
                return;
            }

            // Raiz própria: o efeito de entrada anima a raiz, e o modelo fica livre para o Animator.
            var root = new GameObject($"Criatura ({cardName})");
            root.transform.SetParent(image.transform, false);

            var model = Instantiate(entry.prefab, root.transform);
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.Euler(0f, entry.yRotationOffset, 0f);
            FitToHeight(model.transform, root.transform, entry.heightMeters);

            if (faceCameraOnSpawn)
                FaceCamera(root.transform, image.transform);

            var fx = root.AddComponent<CreatureSpawnFx>();
            fx.idleBob = model.GetComponentInChildren<Animator>() == null;

            spawned[image.trackableId] = root;
            if (logEvents)
                Debug.Log($"[CardCreatureSpawner] Surgiu: {cardName} (tamanho medido {image.size.x:F3} x {image.size.y:F3} m)");

            UpdateVisibility(image);
        }

        void UpdateVisibility(ARTrackedImage image)
        {
            if (!spawned.TryGetValue(image.trackableId, out var root) || root == null)
                return;

            var visible = image.trackingState == TrackingState.Tracking ||
                          (image.trackingState == TrackingState.Limited && !hideWhenLimited);
            if (root.activeSelf != visible)
                root.SetActive(visible);
        }

        void Despawn(TrackableId id)
        {
            if (!spawned.TryGetValue(id, out var root))
                return;
            spawned.Remove(id);
            if (root != null)
                Destroy(root);
            if (logEvents)
                Debug.Log("[CardCreatureSpawner] Carta removida.");
        }

        /// <summary>
        /// Assets grátis vêm em escalas absurdas (1 cm ou 50 m). Mede o modelo pelos Renderers,
        /// escala para a altura pedida e apoia os pés sobre a carta.
        /// </summary>
        static void FitToHeight(Transform model, Transform root, float heightMeters)
        {
            if (!TryGetBounds(model, out var bounds) || bounds.size.y < 1e-5f)
                return;

            model.localScale *= heightMeters / bounds.size.y;

            if (TryGetBounds(model, out bounds))
            {
                var bottom = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
                model.position += root.position - bottom;
            }
        }

        static bool TryGetBounds(Transform target, out Bounds bounds)
        {
            var renderers = target.GetComponentsInChildren<Renderer>();
            bounds = default;
            if (renderers.Length == 0)
                return false;

            bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            return true;
        }

        static void FaceCamera(Transform root, Transform card)
        {
            var cam = Camera.main;
            if (cam == null)
                return;

            var toCamera = Vector3.ProjectOnPlane(cam.transform.position - root.position, card.up);
            if (toCamera.sqrMagnitude > 1e-6f)
                root.rotation = Quaternion.LookRotation(toCamera, card.up);
        }
    }
}
