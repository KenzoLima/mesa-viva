using System.Collections.Generic;
using System.IO;
using MtgAr.Phase0;
using MtgAr.Table;
using MtgAr.Table.UI;
using MtgAr.UI;
using TMPro;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace MtgAr.EditorTools
{
    /// <summary>
    /// Monta as cenas do COMECE_AQUI §7, do MESA_GUIA §2–5 e do FASE0_GUIA §2, com os materiais,
    /// prefabs e Panel Settings que elas usam, e deixa App + Mesa na lista de cenas do build.
    /// Menu <b>Mesa Viva → Criar cenas</b> ou em batchmode:
    /// <c>-executeMethod MtgAr.EditorTools.SceneBuilder.RunBatch</c>.
    ///
    /// Assets que já existem ficam como estão (os GUIDs não mudam). As CENAS são recriadas do zero:
    /// o que foi montado nelas à mão se perde. A cena Fase0 só é criada se ainda não existir, porque
    /// é nela que você liga a biblioteca de imagens e os prefabs das criaturas.
    /// </summary>
    public static class SceneBuilder
    {
        const string Root = "Assets/_Project";
        const string ScenesFolder = Root + "/Scenes";
        const string MaterialsFolder = Root + "/Materials";
        const string PrefabsFolder = Root + "/Prefabs";

        public const string AppScene = ScenesFolder + "/App.unity";
        public const string TableScene = ScenesFolder + "/Mesa.unity";
        public const string Phase0Scene = ScenesFolder + "/Fase0.unity";

        const string ThemePath = Root + "/UI/MesaViva.tss";
        const string MenuPanelPath = Root + "/UI/PainelMenu.asset";
        const string ArPanelPath = Root + "/UI/PainelRA.asset";
        const string GridMaterialPath = MaterialsFolder + "/RunicGrid.mat";
        const string LineMaterialPath = MaterialsFolder + "/LinhaDourada.mat";
        const string HandleMaterialPath = MaterialsFolder + "/AlcaDourada.mat";
        const string PlanePrefabPath = PrefabsFolder + "/PlanoDaMesa.prefab";
        const string HandlePrefabPath = PrefabsFolder + "/AlcaDeRotacao.prefab";

        static readonly Color Gold = new Color(0.902f, 0.761f, 0.478f);
        static readonly Color MenuBackground = new Color32(0x0F, 0x0D, 0x0B, 0xFF);

        [MenuItem("Mesa Viva/Criar cenas")]
        public static void Run()
        {
            var report = new List<string>();
            foreach (var folder in new[] { "Scenes", "Materials", "Prefabs" })
                if (!AssetDatabase.IsValidFolder($"{Root}/{folder}"))
                    AssetDatabase.CreateFolder(Root, folder);

            var theme = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
            if (theme == null)
                throw new FileNotFoundException("Tema do UI Toolkit não encontrado", ThemePath);

            // Só garante que os assets existem: cada cena carrega o seu depois do NewScene (ver BuildAppScene).
            MakePanel(MenuPanelPath, new Vector2Int(390, 844), theme, report);
            MakePanel(ArPanelPath, new Vector2Int(844, 390), theme, report);
            var gridMaterial = MakeMaterial(GridMaterialPath, "MtgAr/RunicGrid", Color.white, report);
            var lineMaterial = MakeMaterial(LineMaterialPath, "MtgAr/VertexColor", Color.white, report);
            var handleMaterial = MakeMaterial(HandleMaterialPath, "MtgAr/VertexColor", Gold, report);
            var planePrefab = PlanePrefab(gridMaterial, report);
            var handlePrefab = HandlePrefab(handleMaterial, report);

            BuildAppScene(report);
            BuildTableScene(planePrefab, handlePrefab, lineMaterial, report);
            if (File.Exists(Phase0Scene))
                report.Add("mantida " + Phase0Scene);
            else
                BuildPhase0Scene(report);

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(AppScene, true),
                new EditorBuildSettingsScene(TableScene, true),
            };
            report.Add("Scene List: App, Mesa");

            AssetDatabase.SaveAssets();
            Debug.Log("[SceneBuilder]\n" + string.Join("\n", report));
        }

        public static void RunBatch()
        {
            try
            {
                Run();
                EditorApplication.Exit(0);
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                EditorApplication.Exit(1);
            }
        }

        /// <summary>
        /// Fontes e shaders do TextMeshPro (Window → TextMeshPro → Import TMP Essential Resources),
        /// usados nos rótulos VOCÊ / OPONENTE. Rode antes de RunBatch.
        /// </summary>
        public static void ImportTmpBatch()
        {
            if (Resources.Load<TMP_Settings>("TMP Settings") != null)
            {
                EditorApplication.Exit(0);
                return;
            }

            var package = UnityEditor.PackageManager.PackageInfo.FindForAssetPath("Packages/com.unity.ugui");
            var path = Path.Combine(package.resolvedPath, "Package Resources", "TMP Essential Resources.unitypackage");
            AssetDatabase.importPackageCompleted += _ => EditorApplication.Exit(0);
            AssetDatabase.importPackageFailed += (_, error) =>
            {
                Debug.LogError("[SceneBuilder] TMP Essential Resources: " + error);
                EditorApplication.Exit(1);
            };
            AssetDatabase.ImportPackage(path, false);
        }

        // ---------- cenas ----------

        /// <summary>
        /// O PanelSettings é carregado DEPOIS do NewScene: no Unity 6.6 o NewScene destrói um
        /// PanelSettings já carregado, e a cena seria salva com o UIDocument sem painel (a UI não aparece).
        /// </summary>
        static void BuildAppScene(List<string> report)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var panel = Load<PanelSettings>(MenuPanelPath);

            var cameraGo = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener)) { tag = "MainCamera" };
            var camera = cameraGo.GetComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = MenuBackground;
            cameraGo.transform.position = new Vector3(0f, 1f, -10f);

            var ui = new GameObject("Menu", typeof(UIDocument));
            var document = ui.GetComponent<UIDocument>();
            document.panelSettings = panel;
            document.visualTreeAsset = Load<VisualTreeAsset>(Root + "/UI/AppShell.uxml");
            ui.AddComponent<AppRouter>();
            ui.AddComponent<AppBootstrap>();
            ui.AddComponent<SafeAreaPadding>();

            Orientation(SceneOrientation.Mode.Portrait);
            Save(scene, AppScene, report);
        }

        static void BuildTableScene(GameObject planePrefab, GameObject handlePrefab,
            Material lineMaterial, List<string> report)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var panel = Load<PanelSettings>(ArPanelPath); // depois do NewScene, como na cena App
            var origin = ArRig(out var arCamera);
            var cameraManager = arCamera.GetComponent<ARCameraManager>();
            cameraManager.requestedLightEstimation = LightEstimation.AmbientIntensity;

            var planes = origin.gameObject.AddComponent<ARPlaneManager>();
            planes.planePrefab = planePrefab;
            planes.requestedDetectionMode = PlaneDetectionMode.Horizontal;
            var raycasts = origin.gameObject.AddComponent<ARRaycastManager>();
            var anchors = origin.gameObject.AddComponent<ARAnchorManager>();

            var monitor = origin.gameObject.AddComponent<TrackingStatusMonitor>();
            Set(monitor, ("cameraManager", cameraManager));

            var controller = origin.gameObject.AddComponent<TableCalibrationController>();
            Set(controller, ("planeManager", planes), ("raycastManager", raycasts), ("anchorManager", anchors),
                ("trackingMonitor", monitor), ("arCamera", arCamera));

            var area = new GameObject("Área da mesa");
            var visualizer = area.AddComponent<TableAreaVisualizer>();
            Set(visualizer, ("controller", controller), ("lineMaterial", lineMaterial), ("handlePrefab", handlePrefab),
                ("meLabel", MakeLabel(area.transform, "VOCÊ", report)),
                ("opponentLabel", MakeLabel(area.transform, "OPONENTE", report)));

            var ui = new GameObject("Tela de calibração", typeof(UIDocument));
            var document = ui.GetComponent<UIDocument>();
            document.panelSettings = panel;
            document.visualTreeAsset = Load<VisualTreeAsset>(Root + "/UI/CalibrationScreen.uxml");
            var view = ui.AddComponent<CalibrationScreenView>();
            Set(view, ("controller", controller), ("trackingMonitor", monitor));

            Orientation(SceneOrientation.Mode.Landscape);
            Save(scene, TableScene, report);
        }

        /// <summary>
        /// Só o esqueleto: a Reference Image Library (fotos das SUAS cartas) e o CardPrefabLibrary
        /// (modelos baixados) são ligados à mão, como no FASE0_GUIA §3 a §5.
        /// </summary>
        static void BuildPhase0Scene(List<string> report)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var origin = ArRig(out _);
            var images = origin.gameObject.AddComponent<ARTrackedImageManager>();
            images.requestedMaxNumberOfMovingImages = 5;
            origin.gameObject.AddComponent<CardCreatureSpawner>();
            Orientation(SceneOrientation.Mode.Landscape);
            Save(scene, Phase0Scene, report);
        }

        /// <summary>
        /// AR Session + XR Origin (Mobile AR), iguais aos dos menus GameObject → XR do AR Foundation 6.
        /// </summary>
        static XROrigin ArRig(out Camera arCamera)
        {
            new GameObject("AR Session", typeof(ARSession), typeof(ARInputManager));

            var originGo = new GameObject("XR Origin", typeof(XROrigin));
            var offset = new GameObject("Camera Offset");
            offset.transform.SetParent(originGo.transform, false);

            var cameraGo = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener),
                typeof(ARCameraManager), typeof(ARCameraBackground), typeof(TrackedPoseDriver)) { tag = "MainCamera" };
            cameraGo.transform.SetParent(offset.transform, false);

            arCamera = cameraGo.GetComponent<Camera>();
            arCamera.clearFlags = CameraClearFlags.SolidColor;
            arCamera.backgroundColor = Color.black;
            arCamera.nearClipPlane = 0.1f;
            arCamera.farClipPlane = 20f;

            var driver = cameraGo.GetComponent<TrackedPoseDriver>();
            var position = new InputAction("Position", binding: "<XRHMD>/centerEyePosition", expectedControlType: "Vector3");
            position.AddBinding("<HandheldARInputDevice>/devicePosition");
            var rotation = new InputAction("Rotation", binding: "<XRHMD>/centerEyeRotation", expectedControlType: "Quaternion");
            rotation.AddBinding("<HandheldARInputDevice>/deviceRotation");
            driver.positionInput = new InputActionProperty(position);
            driver.rotationInput = new InputActionProperty(rotation);

            var origin = originGo.GetComponent<XROrigin>();
            origin.CameraFloorOffsetObject = offset;
            origin.Camera = arCamera;
            return origin;
        }

        static void Orientation(SceneOrientation.Mode mode)
        {
            var orientation = new GameObject("Cena").AddComponent<SceneOrientation>();
            var so = new SerializedObject(orientation);
            so.FindProperty("mode").enumValueIndex = (int)mode;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        /// <summary>Rótulo deitado na mesa. Sem os TMP Essential Resources não há fonte: fica sem rótulo.</summary>
        static TextMeshPro MakeLabel(Transform parent, string text, List<string> report)
        {
            if (Resources.Load<TMP_Settings>("TMP Settings") == null)
            {
                report.Add($"rótulo '{text}' não criado: importe Window → TextMeshPro → Import TMP Essential Resources e rode de novo");
                return null;
            }

            var go = new GameObject(text);
            go.transform.SetParent(parent, false);
            var label = go.AddComponent<TextMeshPro>();
            label.text = text;
            label.fontSize = 0.25f;
            label.alignment = TextAlignmentOptions.Center;
            label.color = Gold;
            label.rectTransform.sizeDelta = new Vector2(0.4f, 0.06f);
            return label;
        }

        // ---------- assets ----------

        static PanelSettings MakePanel(string path, Vector2Int reference, ThemeStyleSheet theme, List<string> report)
        {
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(path);
            if (panel != null)
                return panel;

            panel = ScriptableObject.CreateInstance<PanelSettings>();
            panel.themeStyleSheet = theme;
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.referenceResolution = reference;
            panel.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panel.match = 0.5f;
            panel.clearColor = false; // o fundo é a câmera (cor do menu ou vídeo do AR)
            AssetDatabase.CreateAsset(panel, path);
            report.Add("criado " + path);
            return panel;
        }

        static Material MakeMaterial(string path, string shaderName, Color color, List<string> report)
        {
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null)
                return material;

            var shader = Shader.Find(shaderName);
            if (shader == null)
                throw new FileNotFoundException($"Shader '{shaderName}' não encontrado (não compilou?)");
            material = new Material(shader);
            if (material.HasProperty("_Color") && color != Color.white)
                material.SetColor("_Color", color);
            AssetDatabase.CreateAsset(material, path);
            report.Add("criado " + path);
            return material;
        }

        /// <summary>O "AR Default Plane" do MESA_GUIA §3: grade dourada, sem a borda branca.</summary>
        static GameObject PlanePrefab(Material material, List<string> report)
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(PlanePrefabPath);
            if (existing != null)
                return existing;

            var go = new GameObject("PlanoDaMesa", typeof(ARPlane), typeof(ARPlaneMeshVisualizer),
                typeof(MeshCollider), typeof(MeshFilter), typeof(MeshRenderer));
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            go.AddComponent<PlaneScanVisualizer>();
            return SavePrefab(go, PlanePrefabPath, report);
        }

        /// <summary>Disco dourado na ponta da seta (MESA_GUIA §4.3), sem collider.</summary>
        static GameObject HandlePrefab(Material material, List<string> report)
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(HandlePrefabPath);
            if (existing != null)
                return existing;

            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "AlcaDeRotacao";
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.localScale = new Vector3(0.03f, 0.002f, 0.03f);
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return SavePrefab(go, HandlePrefabPath, report);
        }

        static GameObject SavePrefab(GameObject go, string path, List<string> report)
        {
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            report.Add("criado " + path);
            return prefab;
        }

        // ---------- utilidades ----------

        static void Save(Scene scene, string path, List<string> report)
        {
            if (!EditorSceneManager.SaveScene(scene, path))
                throw new IOException("não consegui salvar " + path);
            report.Add("cena " + path);
        }

        static T Load<T>(string path) where T : Object
        {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset == null)
                throw new FileNotFoundException("asset não encontrado", path);
            return asset;
        }

        /// <summary>Preenche campos [SerializeField] privados, como o Inspector faria.</summary>
        static void Set(Object target, params (string field, Object value)[] values)
        {
            var so = new SerializedObject(target);
            foreach (var (field, value) in values)
            {
                var property = so.FindProperty(field);
                if (property == null)
                    throw new System.MissingFieldException(target.GetType().Name, field);
                property.objectReferenceValue = value;
            }
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
