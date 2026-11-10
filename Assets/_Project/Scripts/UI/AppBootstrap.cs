using System.Collections;
using UnityEngine;

namespace MtgAr.UI
{
    /// <summary>Carrega catálogo, decks e mapa de modelos assim que a cena do menu abre.</summary>
    public class AppBootstrap : MonoBehaviour
    {
        IEnumerator Start()
        {
            yield return AppServices.Load();
            if (AppServices.LoadError != null)
                Debug.LogError("[AppBootstrap] " + AppServices.LoadError);
            else
                Debug.Log($"[AppBootstrap] {AppServices.Catalog.CardCount} cartas, {AppServices.Decks.Decks.Count} decks");
        }
    }
}
