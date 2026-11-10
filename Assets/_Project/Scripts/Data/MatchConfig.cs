namespace MtgAr.Data
{
    public enum DeviceMode
    {
        /// <summary>Celular fixo num suporte na lateral da mesa (recomendado).</summary>
        Stand,
        /// <summary>Celular na mão, apontado quando o jogador quer ver.</summary>
        Handheld,
        /// <summary>Cada jogador com o seu celular.</summary>
        TwoPhones,
    }

    public enum Quality
    {
        High,
        Medium,
        Eco,
    }

    /// <summary>O que foi escolhido em "Nova partida"; passa do menu para a cena da mesa.</summary>
    public sealed class MatchConfig
    {
        public string MyDeckId;
        /// <summary>null = deck do oponente desconhecido (reconhecimento entre todas as cartas).</summary>
        public string OpponentDeckId;
        public DeviceMode Mode = DeviceMode.Stand;
        public int StartingLife = 20;

        /// <summary>No suporte, o celular fica na lateral: a calibração pergunta de que lado o jogador está.</summary>
        public bool AskSeat => Mode == DeviceMode.Stand;

        /// <summary>A partida atual (null até o jogador sair do menu "Nova partida").</summary>
        public static MatchConfig Current;
    }
}
