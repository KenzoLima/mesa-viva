using UnityEngine;

namespace MtgAr.Data
{
    /// <summary>Configurações do jogador, guardadas no PlayerPrefs.</summary>
    public static class AppSettings
    {
        const string Prefix = "mv.";

        public static bool OnboardingDone
        {
            get => GetBool("onboardingDone", false);
            set => SetBool("onboardingDone", value);
        }

        public static Quality Quality
        {
            get => (Quality)PlayerPrefs.GetInt(Prefix + "quality", (int)Quality.High);
            set => PlayerPrefs.SetInt(Prefix + "quality", (int)value);
        }

        public static bool Sounds
        {
            get => GetBool("sounds", true);
            set => SetBool("sounds", value);
        }

        public static bool Haptics
        {
            get => GetBool("haptics", true);
            set => SetBool("haptics", value);
        }

        public static bool PowerToughnessPlates
        {
            get => GetBool("ptPlates", true);
            set => SetBool("ptPlates", value);
        }

        public static bool DebugOverlay
        {
            get => GetBool("debugOverlay", false);
            set => SetBool("debugOverlay", value);
        }

        /// <summary>Multiplicador do tamanho das criaturas (1,0 a 2,5).</summary>
        public static float EpicScale
        {
            get => PlayerPrefs.GetFloat(Prefix + "epicScale", 1.2f);
            set => PlayerPrefs.SetFloat(Prefix + "epicScale", Mathf.Clamp(value, 1f, 2.5f));
        }

        public static void Save() => PlayerPrefs.Save();

        static bool GetBool(string key, bool fallback) => PlayerPrefs.GetInt(Prefix + key, fallback ? 1 : 0) == 1;

        static void SetBool(string key, bool value) => PlayerPrefs.SetInt(Prefix + key, value ? 1 : 0);
    }
}
