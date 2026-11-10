using System;
using Unity.Services.Authentication;
using Unity.Services.Core;
using UnityEngine;

namespace MesaVivaAR.Bootstrap
{
    // Inicializa o Unity Gaming Services e entra com uma conta anônima de jogador.
    // Roda sozinho antes da primeira cena e nunca bloqueia o jogo: se estiver
    // offline, o jogo segue e a conta é criada numa próxima execução.
    public static class ServicesBootstrap
    {
        public static bool SignedIn { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static async void Init()
        {
            try
            {
                await UnityServices.InitializeAsync();
                if (!AuthenticationService.Instance.IsSignedIn)
                    await AuthenticationService.Instance.SignInAnonymouslyAsync();
                SignedIn = true;
                Debug.Log($"[ServicesBootstrap] Jogador anônimo: {AuthenticationService.Instance.PlayerId}");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ServicesBootstrap] Serviços indisponíveis, seguindo offline: {e.Message}");
            }
        }
    }
}
