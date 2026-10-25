using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using MtgAr.Data;
using UnityEngine;
using UnityEngine.Networking;

namespace MtgAr.UI
{
    /// <summary>
    /// O que as telas compartilham: catálogo de cartas, decks salvos e o escolhedor de modelos.
    /// Vive entre cenas (menu ↔ mesa). Carregado uma vez pelo AppBootstrap.
    /// </summary>
    public static class AppServices
    {
        const string DecksFile = "decks.json";

        public static CardCatalog Catalog { get; private set; }
        public static DeckStore Decks { get; private set; }
        public static string ModelMapJson { get; private set; }
        public static bool IsReady => Catalog != null && Decks != null && ModelMapJson != null;
        public static string LoadError { get; private set; }

        static ModelResolver baseResolver;

        /// <summary>Escolhedor de modelos sem escolhas do jogador (Bestiário, prévia de importação).</summary>
        public static ModelResolver Resolver => baseResolver ??= ModelResolver.FromJson(ModelMapJson);

        /// <summary>Escolhedor com as trocas de modelo feitas naquele deck.</summary>
        public static ModelResolver ResolverFor(SavedDeck deck) => ModelResolver.FromJson(ModelMapJson, deck.ModelOverrides());

        /// <summary>Carrega tudo. Corrotina porque no Android o StreamingAssets só abre via UnityWebRequest.</summary>
        public static IEnumerator Load()
        {
            if (IsReady)
                yield break;

            var modelMap = Resources.Load<TextAsset>("Config/model_map");
            if (modelMap == null)
            {
                LoadError = "Resources/Config/model_map.json não encontrado";
                yield break;
            }
            ModelMapJson = modelMap.text;

            string cards = null, names = null;
            yield return ReadStreamingAsset("Catalog/cards.tsv", text => cards = text);
            yield return ReadStreamingAsset("Catalog/names.tsv", text => names = text);
            if (cards == null || names == null)
            {
                LoadError = "Catálogo de cartas não encontrado em StreamingAssets/Catalog";
                yield break;
            }

            try
            {
                Catalog = CardCatalog.Load(cards, names);
            }
            catch (FormatException e)
            {
                LoadError = "Catálogo de cartas inválido: " + e.Message;
                yield break;
            }

            Decks = new DeckStore(LoadDecks());
            Decks.Changed += SaveDecks;
        }

        static IEnumerator ReadStreamingAsset(string relativePath, Action<string> done)
        {
            var path = Path.Combine(Application.streamingAssetsPath, relativePath);
            if (!path.Contains("://"))
            {
                // iOS, Editor e desktop: StreamingAssets é uma pasta normal.
                done(File.Exists(path) ? File.ReadAllText(path) : null);
                yield break;
            }

            using var request = UnityWebRequest.Get(path);
            yield return request.SendWebRequest();
            done(request.result == UnityWebRequest.Result.Success ? request.downloadHandler.text : null);
        }

        static string DecksPath => Path.Combine(Application.persistentDataPath, DecksFile);

        static DeckLibrary LoadDecks()
        {
            try
            {
                if (File.Exists(DecksPath))
                    return JsonUtility.FromJson<DeckLibrary>(File.ReadAllText(DecksPath)) ?? new DeckLibrary();
            }
            catch (Exception e)
            {
                // Arquivo corrompido: guarda uma cópia para não perder os decks e começa vazio.
                Debug.LogWarning($"[AppServices] decks.json ilegível ({e.Message}); salvando cópia em decks.bak");
                File.Copy(DecksPath, DecksPath + ".bak", true);
            }
            return new DeckLibrary();
        }

        static void SaveDecks()
        {
            // Escreve num temporário e troca: um app fechado no meio da gravação não corrompe o arquivo.
            var temp = DecksPath + ".tmp";
            File.WriteAllText(temp, JsonUtility.ToJson(Decks.Library, true));
            if (File.Exists(DecksPath))
                File.Delete(DecksPath);
            File.Move(temp, DecksPath);
        }

        /// <summary>Quantas cartas de cada deck usam cada modelo de criatura (para o Bestiário).</summary>
        public static Dictionary<string, int> CreatureModelUsage()
        {
            var usage = new Dictionary<string, int>();
            foreach (var deck in Decks.Decks)
            {
                var resolver = ResolverFor(deck);
                foreach (var saved in deck.cards)
                {
                    var card = Catalog.Get(saved.oracleId);
                    if (card == null || card.Kind != CardKind.Creature)
                        continue;
                    var model = resolver.Resolve(card).ModelId;
                    usage[model] = usage.TryGetValue(model, out var n) ? n + 1 : 1;
                }
            }
            return usage;
        }
    }
}
