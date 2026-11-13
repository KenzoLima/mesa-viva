// Leitores de OCR (tesseract.js) compartilhados pelo app.
//
// Por que aqui e não dentro do campo de batalha: baixar e iniciar o Tesseract (inglês + português)
// leva vários segundos. O menu chama warmOcr() ao abrir, então quando você entra no campo de batalha
// o leitor já está pronto, e ele continua pronto se você sair e entrar de novo.
//
// Dois leitores rodando em paralelo (cada um num núcleo), um em cada modo de página:
// o automático (3) lê melhor o nome em versalete dos tokens; o de texto esparso (11) lê melhor o
// nome das cartas normais e não junta texto de cartas vizinhas. Antes era um leitor só, alternando
// os modos, então cada modo só rodava a cada 2 leituras.

import { createWorker } from 'tesseract.js';

const MODES = ['11', '3'];
let readers = null;

// Só o modelo de português: ele lê também os nomes em inglês (mesmo alfabeto, e o NameMatcher tira os
// acentos e aceita erros), e cada leitura sai ~20% mais rápida que com inglês + português juntos, que
// rodam os dois modelos nas palavras duvidosas. Também baixa e inicia um modelo só.
// Medido num quadro de 1600 px com 4 cartas: 2,7 s contra 3,4 s, os mesmos 4 nomes lidos, e o inglês
// sozinho inventava cartas ("When" virava "Who // What // When // Where // Why").
const LANGS = ['por'];

async function makeReader(psm) {
  const worker = await createWorker(LANGS, 1);
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  return { worker, psm };
}

/** Começa a preparar os leitores (pode chamar várias vezes). */
export function warmOcr() {
  if (!readers) {
    // Aparelho fraco (2 núcleos ou menos): um leitor só, para não disputar a CPU com a câmera.
    const count = (navigator.hardwareConcurrency ?? 4) > 2 ? MODES.length : 1;
    const first = makeReader(MODES[0]);
    const rest = MODES.slice(1, count).map((psm) => first.then(() => makeReader(psm)).catch(() => null));
    readers = { first, rest };
    first.catch(() => { readers = null; }); // deixa tentar de novo na próxima vez
  }
  return readers.first;
}

/**
 * Os leitores prontos. O primeiro é sempre esperado; os extras entram quando terminarem de iniciar
 * (onExtra é chamado com cada um).
 */
export async function getOcrReaders(onExtra) {
  warmOcr();
  const { first, rest } = readers;
  const main = await first;
  for (const r of rest) r.then((x) => x && onExtra?.(x));
  return main;
}
