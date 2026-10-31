using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Unity.XR.CoreUtils.Editor;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.XR.ARKit;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.Management;

namespace MtgAr.EditorTools
{
    /// <summary>
    /// Faz os passos 5 e 6 do COMECE_AQUI: URP com fundo de câmera do AR, plataforma iOS,
    /// ARKit / XR Simulation e os ajustes do Player do IPHONE_GUIA §4.
    /// Pode rodar quantas vezes quiser: o que já está certo fica como está.
    /// Pelo menu <b>Mesa Viva → Configurar projeto</b> ou em batchmode:
    /// <c>-buildTarget iOS -executeMethod MtgAr.EditorTools.ProjectSetup.RunBatch</c>.
    /// </summary>
    public static class ProjectSetup
    {
        const string SettingsFolder = "Assets/_Project/Settings";
        const string UrpAssetPath = SettingsFolder + "/URP.asset";
        const string RendererPath = SettingsFolder + "/URP_Renderer.asset";
        const string XrSettingsPath = "Assets/XR/XRGeneralSettingsPerBuildTarget.asset";

        const string ArKitLoader = "UnityEngine.XR.ARKit.ARKitLoader";
        const string SimulationLoader = "UnityEngine.XR.Simulation.SimulationLoader";

        const string CameraUsage =
            "A câmera é usada para ver a mesa e reconhecer as cartas. O vídeo não sai do seu iPhone.";

        [MenuItem("Mesa Viva/Configurar projeto")]
        public static void Run()
        {
            var report = new List<string>();
            ConfigureUrp(report);
            ConfigurePlatform(report);
            ConfigureXr(report);
            ConfigurePlayer(report);
            AssetDatabase.SaveAssets();
            FixValidationIssues(report);
            AssetDatabase.SaveAssets();
            Debug.Log("[ProjectSetup]\n" + string.Join("\n", report));
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

        // ---------- Passo 5: URP ----------

        static void ConfigureUrp(List<string> report)
        {
            if (!AssetDatabase.IsValidFolder(SettingsFolder))
                AssetDatabase.CreateFolder("Assets/_Project", "Settings");

            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (renderer == null)
            {
                // Internal no URP 17; é o que o menu "URP Asset (with Universal Renderer)" chama.
                var create = typeof(UniversalRenderPipelineAsset).GetMethod("CreateRendererAsset",
                    BindingFlags.Static | BindingFlags.NonPublic);
                renderer = (UniversalRendererData)create.Invoke(null,
                    new object[] { RendererPath, RendererType.UniversalRenderer, false, "Renderer" });
                report.Add("criado " + RendererPath);
            }

            var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(UrpAssetPath);
            if (urp == null)
            {
                urp = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(urp, UrpAssetPath);
                report.Add("criado " + UrpAssetPath);
            }

            AddArBackgroundFeature(renderer, report);

            if (GraphicsSettings.defaultRenderPipeline != urp)
            {
                GraphicsSettings.defaultRenderPipeline = urp;
                report.Add("Graphics → Default Render Pipeline = URP");
            }

            var current = QualitySettings.GetQualityLevel();
            for (var i = 0; i < QualitySettings.names.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                if (QualitySettings.renderPipeline == urp) continue;
                QualitySettings.renderPipeline = urp;
                report.Add($"Quality '{QualitySettings.names[i]}' → URP");
            }
            QualitySettings.SetQualityLevel(current, false);
        }

        /// <summary>Mesmo caminho do botão "Add Renderer Feature" do URP (sub-asset + mapa de IDs).</summary>
        static void AddArBackgroundFeature(UniversalRendererData renderer, List<string> report)
        {
            if (renderer.rendererFeatures.Any(f => f is ARBackgroundRendererFeature)) return;

            var feature = ScriptableObject.CreateInstance<ARBackgroundRendererFeature>();
            feature.name = nameof(ARBackgroundRendererFeature);
            AssetDatabase.AddObjectToAsset(feature, renderer);
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(feature, out _, out long localId);

            var so = new SerializedObject(renderer);
            var features = so.FindProperty("m_RendererFeatures");
            var map = so.FindProperty("m_RendererFeatureMap");
            features.arraySize++;
            features.GetArrayElementAtIndex(features.arraySize - 1).objectReferenceValue = feature;
            map.arraySize++;
            map.GetArrayElementAtIndex(map.arraySize - 1).longValue = localId;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(renderer);
            report.Add("URP_Renderer + AR Background Renderer Feature");
        }

        // ---------- Passo 6: iOS e XR ----------

        static void ConfigurePlatform(List<string> report)
        {
            if (EditorUserBuildSettings.activeBuildTarget == BuildTarget.iOS) return;
            // Em batchmode prefira -buildTarget iOS na linha de comando: a troca aqui recompila tudo.
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.iOS, BuildTarget.iOS);
            report.Add("plataforma → iOS");
        }

        static void ConfigureXr(List<string> report)
        {
            if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey,
                    out XRGeneralSettingsPerBuildTarget perTarget) || perTarget == null)
            {
                perTarget = AssetDatabase.LoadAssetAtPath<XRGeneralSettingsPerBuildTarget>(XrSettingsPath);
                if (perTarget == null)
                {
                    perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                    AssetDatabase.CreateAsset(perTarget, XrSettingsPath);
                    report.Add("criado " + XrSettingsPath);
                }
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perTarget, true);
            }

            EnableLoader(perTarget, BuildTargetGroup.iOS, ArKitLoader, "iOS → Apple ARKit", report);
            EnableLoader(perTarget, BuildTargetGroup.Standalone, SimulationLoader, "PC → XR Simulation", report);

            var arkit = ARKitSettings.GetOrCreateSettings();
            if (arkit.requirement != ARKitSettings.Requirement.Required)
            {
                arkit.requirement = ARKitSettings.Requirement.Required;
                EditorUtility.SetDirty(arkit);
                report.Add("ARKit Requirement = Required");
            }
        }

        static void EnableLoader(XRGeneralSettingsPerBuildTarget perTarget, BuildTargetGroup group,
            string loader, string label, List<string> report)
        {
            if (!perTarget.HasSettingsForBuildTarget(group))
                perTarget.CreateDefaultSettingsForBuildTarget(group);
            if (!perTarget.HasManagerSettingsForBuildTarget(group))
                perTarget.CreateDefaultManagerSettingsForBuildTarget(group);

            var manager = perTarget.ManagerSettingsForBuildTarget(group);
            if (manager.activeLoaders.Any(l => l != null && l.GetType().FullName == loader)) return;

            if (XRPackageMetadataStore.AssignLoader(manager, loader, group))
                report.Add(label);
            else
                report.Add($"FALHOU: {label} ({loader})");
            EditorUtility.SetDirty(perTarget);
        }

        // ---------- IPHONE_GUIA §4 ----------

        static void ConfigurePlayer(List<string> report)
        {
            // Company Name e Bundle Identifier dependem da sua conta Apple: ficam com você.
            PlayerSettings.productName = "Mesa Viva";
            if (string.IsNullOrEmpty(PlayerSettings.bundleVersion) || PlayerSettings.bundleVersion == "1.0")
                PlayerSettings.bundleVersion = "0.1.0";
            if (string.IsNullOrEmpty(PlayerSettings.iOS.buildNumber) || PlayerSettings.iOS.buildNumber == "0")
                PlayerSettings.iOS.buildNumber = "1";
            PlayerSettings.iOS.cameraUsageDescription = CameraUsage;
            PlayerSettings.iOS.appleEnableAutomaticSigning = false;
            PlayerSettings.SetArchitecture(NamedBuildTarget.iOS, 1); // 1 = ARM64
            report.Add("Player: nome, versão, câmera, ARM64, assinatura manual");
        }

        // ---------- Project Validation → "Fix All" ----------

        static void FixValidationIssues(List<string> report)
        {
            // GetCurrentValidationIssues é internal; é o mesmo que a janela Project Validation usa.
            var getIssues = typeof(BuildValidator).GetMethod("GetCurrentValidationIssues",
                BindingFlags.Static | BindingFlags.NonPublic);
            if (getIssues == null)
            {
                report.Add("Project Validation: API não encontrada, rode o Fix All na mão");
                return;
            }

            foreach (var group in new[] { BuildTargetGroup.iOS, BuildTargetGroup.Standalone })
            {
                var issues = new HashSet<BuildValidationRule>();
                for (var pass = 0; pass < 3; pass++)
                {
                    getIssues.Invoke(null, new object[] { issues, group });
                    // Regras de cena (AR Session, XR Origin...) só fazem sentido com a cena Mesa aberta.
                    var fixable = issues.Where(r => !r.SceneOnlyValidation && r.FixIt != null && r.FixItAutomatic)
                        .ToList();
                    if (fixable.Count == 0) break;
                    foreach (var rule in fixable)
                        report.Add($"Fix ({group}): {rule.Message}");
                    BuildValidator.FixIssues(fixable);
                }

                getIssues.Invoke(null, new object[] { issues, group });
                foreach (var rule in issues)
                {
                    var kind = rule.SceneOnlyValidation ? "cena" : rule.Error ? "ERRO" : "aviso";
                    report.Add($"Pendente ({group}, {kind}): {rule.Message}");
                }
            }
        }
    }
}
