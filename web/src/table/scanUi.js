// O que a leitura das cartas está fazendo, na linha "Reconhecer as cartas na mesa" dos dois modos Mesa.
// A leitura de um bloco leva segundos: sem isso a pessoa achava que o app tinha travado.

const cardsText = (n) => (n ? `${n} carta${n > 1 ? 's' : ''} na mesa` : 'nenhuma carta lida ainda');

/**
 * ui: { scanInfo, scanBar? }. Retorna:
 *  reading(i, total, n): lendo o bloco i de total (1…total), com n cartas já na mesa;
 *  done(n, extra): terminou um bloco; extra é um aviso a mais (" · aproxime a câmera…");
 *  message(text): outra situação (preparando, falhou, fora da câmera), sem barra.
 */
export function scanReporter(ui) {
  const bar = ui.scanBar;
  const setBar = (p, busy) => {
    if (!bar) return;
    bar.hidden = p === null;
    if (p !== null) bar.style.setProperty('--p', String(p));
    bar.classList.toggle('busy', !!busy);
  };
  return {
    reading(i, total, n) {
      ui.scanInfo.textContent = total > 1
        ? `lendo a área ${i} de ${total}… · ${cardsText(n)}`
        : `lendo a mesa… · ${cardsText(n)}`;
      setBar(i / total, true);
    },
    done(n, extra = '') {
      ui.scanInfo.textContent = cardsText(n) + extra;
      setBar(bar && !bar.hidden ? Number(bar.style.getPropertyValue('--p')) || 0 : null, false);
    },
    message(text) {
      ui.scanInfo.textContent = text;
      setBar(null, false);
    },
  };
}
