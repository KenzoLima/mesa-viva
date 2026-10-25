using System.IO;
using MtgAr.Data;
using UnityEngine;

namespace MtgAr.Tests
{
    /// <summary>Acesso aos arquivos reais do repositório (catálogo de exemplo, model_map, fixtures do Python).</summary>
    static class DataTestUtil
    {
        static CardCatalog catalog;
        static ModelResolver resolver;

        public static string AssetsPath => Application.dataPath;

        public static CardCatalog Catalog => catalog ??= CardCatalog.Load(
            File.ReadAllText(Path.Combine(AssetsPath, "StreamingAssets", "Catalog", "cards.tsv")),
            File.ReadAllText(Path.Combine(AssetsPath, "StreamingAssets", "Catalog", "names.tsv")));

        public static string ModelMapJson => File.ReadAllText(Path.Combine(AssetsPath, "_Project", "Resources", "Config", "model_map.json"));

        public static ModelResolver Resolver => resolver ??= ModelResolver.FromJson(ModelMapJson);

        /// <summary>Arquivo das fixtures do Python (ml/tests/fixtures), que fica fora do projeto Unity.</summary>
        public static string PythonFixture(string name) =>
            Path.GetFullPath(Path.Combine(AssetsPath, "..", "..", "ml", "tests", "fixtures", name));
    }
}
