using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace MtgAr.Data
{
    /// <summary>
    /// Leitor JSON mínimo (o JsonUtility do Unity não lê dicionários, e o model_map.json é feito deles).
    /// Resultado: Dictionary&lt;string, object&gt; (mantém a ordem do arquivo), List&lt;object&gt;, string,
    /// double, bool ou null.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            var parser = new Parser(json);
            var value = parser.ReadValue();
            parser.SkipWhitespace();
            if (!parser.AtEnd)
                throw parser.Error("conteúdo depois do fim do JSON");
            return value;
        }

        sealed class Parser
        {
            readonly string text;
            int pos;

            public Parser(string text) => this.text = text ?? "";

            public bool AtEnd => pos >= text.Length;

            public FormatException Error(string message) => new FormatException($"JSON inválido na posição {pos}: {message}");

            public void SkipWhitespace()
            {
                while (!AtEnd && char.IsWhiteSpace(text[pos]))
                    pos++;
            }

            public object ReadValue()
            {
                SkipWhitespace();
                if (AtEnd)
                    throw Error("fim inesperado");
                switch (text[pos])
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default: return ReadNumber();
                }
            }

            Dictionary<string, object> ReadObject()
            {
                var result = new Dictionary<string, object>();
                pos++; // {
                SkipWhitespace();
                if (!AtEnd && text[pos] == '}') { pos++; return result; }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || text[pos] != '"')
                        throw Error("esperava o nome de uma chave");
                    var key = ReadString();
                    SkipWhitespace();
                    if (AtEnd || text[pos] != ':')
                        throw Error("esperava ':'");
                    pos++;
                    result[key] = ReadValue();
                    SkipWhitespace();
                    if (AtEnd)
                        throw Error("objeto sem '}'");
                    if (text[pos] == ',') { pos++; continue; }
                    if (text[pos] == '}') { pos++; return result; }
                    throw Error("esperava ',' ou '}'");
                }
            }

            List<object> ReadArray()
            {
                var result = new List<object>();
                pos++; // [
                SkipWhitespace();
                if (!AtEnd && text[pos] == ']') { pos++; return result; }
                while (true)
                {
                    result.Add(ReadValue());
                    SkipWhitespace();
                    if (AtEnd)
                        throw Error("lista sem ']'");
                    if (text[pos] == ',') { pos++; continue; }
                    if (text[pos] == ']') { pos++; return result; }
                    throw Error("esperava ',' ou ']'");
                }
            }

            string ReadString()
            {
                var builder = new StringBuilder();
                pos++; // "
                while (!AtEnd)
                {
                    var c = text[pos++];
                    if (c == '"')
                        return builder.ToString();
                    if (c != '\\')
                    {
                        builder.Append(c);
                        continue;
                    }
                    if (AtEnd)
                        break;
                    var escape = text[pos++];
                    switch (escape)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (pos + 4 > text.Length)
                                throw Error("escape \\u incompleto");
                            builder.Append((char)int.Parse(text.Substring(pos, 4), NumberStyles.HexNumber));
                            pos += 4;
                            break;
                        default: throw Error($"escape inválido \\{escape}");
                    }
                }
                throw Error("texto sem aspas de fechamento");
            }

            double ReadNumber()
            {
                var start = pos;
                while (!AtEnd && "+-0123456789.eE".IndexOf(text[pos]) >= 0)
                    pos++;
                if (start == pos)
                    throw Error($"caractere inesperado '{text[pos]}'");
                return double.Parse(text.Substring(start, pos - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }

            void Expect(string word)
            {
                if (string.CompareOrdinal(text, pos, word, 0, word.Length) != 0)
                    throw Error($"esperava '{word}'");
                pos += word.Length;
            }
        }
    }
}
