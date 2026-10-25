using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace MtgAr.Data
{
    /// <summary>
    /// Chave de busca de nomes de carta. Porte de ml/mtgar_data/text_norm.py — as duas versões
    /// precisam dar o mesmo resultado (o catálogo é gerado pelo Python e lido pelo app).
    /// "Æther Vial", "Aether Vial" e "aether  vial" viram a mesma chave; "Fire/Ice" vira "fire // ice".
    /// </summary>
    public static class TextNormalizer
    {
        static readonly (string from, string to)[] Replacements =
        {
            ("æ", "ae"), ("Æ", "ae"), ("œ", "oe"), ("Œ", "oe"), ("ß", "ss"),
            ("‘", "'"), ("’", "'"), ("ʼ", "'"), ("`", "'"), ("´", "'"),
            ("–", "-"), ("—", "-"), ("−", "-"),
        };

        static readonly Regex FaceSeparator = new Regex(@"\s*/{1,2}\s*", RegexOptions.Compiled);
        static readonly Regex Spaces = new Regex(@"\s+", RegexOptions.Compiled);

        public static string Normalize(string name)
        {
            if (string.IsNullOrEmpty(name))
                return "";

            foreach (var (from, to) in Replacements)
                name = name.Replace(from, to);

            var decomposed = name.Normalize(NormalizationForm.FormKD);
            var builder = new StringBuilder(decomposed.Length);
            foreach (var c in decomposed)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                    builder.Append(c);
            }

            var result = FaceSeparator.Replace(builder.ToString(), " // ");
            return Spaces.Replace(result, " ").Trim().ToLowerInvariant();
        }
    }
}
