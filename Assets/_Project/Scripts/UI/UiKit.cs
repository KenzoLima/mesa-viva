using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace MtgAr.UI
{
    /// <summary>Cores de mana (as mesmas do Theme.uss / protótipo).</summary>
    public static class Palette
    {
        public static Color ManaBackground(string color)
        {
            switch (color)
            {
                case "W": return Hex(0xefe6cf);
                case "U": return Hex(0x6aa6d9);
                case "B": return Hex(0x9a86ad);
                case "R": return Hex(0xe0704f);
                case "G": return Hex(0x6fae6a);
                default: return Hex(0x8a7c66);
            }
        }

        public static Color ManaText(string color)
        {
            switch (color)
            {
                case "W": return Hex(0x2a2219);
                case "U": return Hex(0x0d1a26);
                case "B": return Hex(0x160f1c);
                case "R": return Hex(0x2a0e05);
                case "G": return Hex(0x0d1f0b);
                default: return Hex(0x16120e);
            }
        }

        public static Color Hex(int rgb) => new Color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f);
    }

    /// <summary>Pequenas fábricas de elementos com as classes do Menus.uss.</summary>
    public static class UiKit
    {
        public static void Show(VisualElement element, bool visible) =>
            element.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;

        public static Label Text(string text, string className = null)
        {
            var label = new Label(text);
            if (className != null)
                label.AddToClassList(className);
            return label;
        }

        /// <summary>Símbolo de mana: círculo colorido com a letra (cor nunca vem sozinha).</summary>
        public static Label Pip(string color, bool small = false)
        {
            var pip = Text(color, "mv-pip");
            if (small)
                pip.AddToClassList("mv-pip--small");
            pip.style.backgroundColor = Palette.ManaBackground(color);
            pip.style.color = Palette.ManaText(color);
            return pip;
        }

        public static Button Chip(string text, bool selected, Action onClick)
        {
            var chip = new Button(onClick) { text = text };
            chip.AddToClassList("mv-chip");
            chip.EnableInClassList("mv-chip--selected", selected);
            return chip;
        }

        /// <summary>Linha clicável com título, subtítulo e seta (lista de decks, modos de uso).</summary>
        public static Button Row(string title, string subtitle, Action onClick, VisualElement leading = null, bool chevron = true)
        {
            var row = new Button(onClick);
            row.AddToClassList("mv-row");
            if (leading != null)
                row.Add(leading);
            var body = new VisualElement { pickingMode = PickingMode.Ignore };
            body.AddToClassList("mv-row__body");
            body.Add(Text(title, "mv-row__title"));
            if (!string.IsNullOrEmpty(subtitle))
                body.Add(Text(subtitle, "mv-row__sub"));
            row.Add(body);
            if (chevron)
            {
                var arrow = new LineArt(LineArtKind.Chevron);
                arrow.style.width = 20;
                arrow.style.height = 20;
                row.Add(arrow);
            }
            return row;
        }

        /// <summary>Interruptor liga/desliga no estilo do protótipo.</summary>
        public static Button Switch(bool on, Action<bool> onChanged, string accessibleName)
        {
            var button = new Button { tooltip = accessibleName };
            button.AddToClassList("mv-switch");
            var knob = new VisualElement { pickingMode = PickingMode.Ignore };
            knob.AddToClassList("mv-switch__knob");
            button.Add(knob);
            button.EnableInClassList("mv-switch--on", on);
            button.clicked += () =>
            {
                on = !on;
                button.EnableInClassList("mv-switch--on", on);
                onChanged(on);
            };
            return button;
        }

        /// <summary>Número com vírgula decimal (pt-BR).</summary>
        public static string Decimal(float value, int digits = 1) =>
            value.ToString("F" + digits, System.Globalization.CultureInfo.InvariantCulture).Replace('.', ',');

        public static string Plural(int count, string singular, string plural) => $"{count} {(count == 1 ? singular : plural)}";
    }
}
