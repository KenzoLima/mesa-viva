import { CardCatalog } from './data/catalog.js';
import { ModelResolver } from './data/modelResolver.js';
import { isTableModeSupported } from './modes/table.js';
import { cameraErrorMessage, xrErrorMessage } from './cameraErrors.js';
import version from '../version.json';

const $ = (id) => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;

// Versão do app: sobe 0.01 a cada commit ou merge na main (tools/hooks/bump-version.sh).
// Fica só no menu: nas telas de câmera ela encostava no status do alto.
const appVersion = document.createElement('div');
appVersion.className = 'app-version';
appVersion.textContent = `v${(version.build / 100).toFixed(2)}`;
$('menu').append(appVersion);

/** Lê/grava no aparelho sem quebrar quando o armazenamento está bloqueado (aba anônima etc.). */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } },
};

// ---------- Navegação entre as telas do menu (antes do catálogo, para já responder ao toque) ----------
function showScreen(name) {
  for (const s of document.querySelectorAll('#menu [data-screen]')) s.hidden = s.dataset.screen !== name;
  for (const b of document.querySelectorAll('#menu .tabs [data-go]')) {
    if (b.dataset.go === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}
for (const b of document.querySelectorAll('#menu [data-go]')) {
  b.addEventListener('click', () => showScreen(b.dataset.go));
}

// Escolhas do usuário (carta -> modelo), como o AppSettings do Unity. Fica só neste aparelho.
const OVERRIDES_KEY = 'mesaviva.overrides';
function loadOverrides() {
  try {
    return JSON.parse(store.get(OVERRIDES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// O leitor de cartas (OCR) demora para baixar e iniciar: começa já, enquanto o menu está na tela.
import('./recognition/ocr.js').then((m) => m.warmOcr()).catch((err) => console.warn('OCR não pré-carregou', err));

const [catalog, resolver] = await Promise.all([
  CardCatalog.load(`${BASE}data/`),
  ModelResolver.load(`${BASE}data/model_map.json`, loadOverrides()),
]);

// ---------- Bestiário ----------
/** Tamanho da criatura em palavras (o modelo cresce com o poder da carta). */
function sizeWord(choice) {
  if (choice.kind !== 'creature') return '';
  if (choice.scale >= 1.45) return 'enorme';
  if (choice.scale >= 1.25) return 'grande';
  if (choice.scale <= 0.9) return 'pequena';
  return '';
}

/** O que aparece na mesa para a carta, em linguagem de jogador ("Dragão Vermelho · grande"). */
function describeChoice(choice) {
  return [resolver.label(choice.modelId), sizeWord(choice)].filter(Boolean).join(' · ');
}

const EXAMPLES = ['Shivan Dragon', 'Llanowar Elves', 'Serra Angel', 'Lightning Bolt', 'Breeding Pool', 'Sol Ring']
  .map((n) => catalog.lookup(n)[0]).filter(Boolean);

function renderResults(list, query = '') {
  const results = $('results');
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `Nenhuma carta com “${query.trim()}”. Confira a grafia: vale o nome em inglês ou em português.`;
    results.replaceChildren(li);
    return;
  }
  results.replaceChildren(...list.map((card) => {
    const c = resolver.resolve(card);
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'card-row';
    row.innerHTML = '<strong></strong><span class="alt"></span><span class="type"></span><span class="model"></span>';
    row.children[0].textContent = card.displayName;
    // Nome oficial em inglês quando o app mostra o português: quem buscou "bolt" reconhece o "Raio".
    row.children[1].textContent = card.displayName !== card.name ? card.name : '';
    row.children[2].textContent = card.typeLine;
    row.children[3].textContent = describeChoice(c);
    row.title = `Por quê: ${c.reason}`;
    row.addEventListener('click', () => openCardDetail(card));
    li.append(row);
    return li;
  }));
}

let searchTimer = 0;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  // Campo vazio: volta aos exemplos. Com texto, espera a pessoa parar de digitar um instante.
  if (!q.trim()) {
    $('results-title').textContent = 'Exemplos';
    renderResults(EXAMPLES);
    return;
  }
  searchTimer = setTimeout(() => {
    $('results-title').textContent = 'Resultados';
    renderResults(catalog.search(q), q);
  }, 120);
});
renderResults(EXAMPLES);
$('catalog-count').textContent = `${catalog.size.toLocaleString('pt-BR')} cartas no catálogo`;

// Detalhe da carta (criatura em 3D, troca de modelo): preenchido mais abaixo.
let openCardDetail = () => {};

// ---------- Campo de batalha (câmera em tela cheia, reconhece qualquer carta) ----------
let leaveBattlefield = null;
// Abertura em andamento (câmera pedindo permissão, OCR baixando): sair nessa hora cancela por aqui.
let openingBattlefield = null;
function closeBattlefield() {
  openingBattlefield?.abort();
  openingBattlefield = null;
  leaveBattlefield?.();
  leaveBattlefield = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  $('battlefield').hidden = true;
  $('menu').hidden = false;
}
$('bf-exit').addEventListener('click', closeBattlefield);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && (leaveBattlefield || openingBattlefield)) closeBattlefield();
});

$('btn-battlefield').addEventListener('click', async () => {
  closeBattlefield(); // nunca duas sessões ao mesmo tempo
  const view = $('battlefield');
  view.hidden = false;
  $('menu').hidden = true;
  // Tela cheia precisa ser pedida já no toque. No iPhone (sem a API) a tela já ocupa tudo pelo CSS.
  view.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  screen.orientation?.lock?.('landscape').catch(() => {});
  const opening = new AbortController();
  openingBattlefield = opening;
  // Mensagens de uma abertura já cancelada não aparecem na sessão seguinte.
  const status = (t) => { if (!opening.signal.aborted) $('bf-status').textContent = t; };
  try {
    const { startBattlefield } = await import('./modes/battlefield.js');
    const leave = await startBattlefield(view, { catalog, resolver, onStatus: status, signal: opening.signal });
    if (opening.signal.aborted) {
      leave(); // saiu bem na hora em que terminou de abrir
      return;
    }
    openingBattlefield = null;
    leaveBattlefield = leave;
  } catch (err) {
    if (opening.signal.aborted) return; // saiu antes de abrir: a própria abertura já desfez tudo
    if (openingBattlefield === opening) openingBattlefield = null;
    console.error(err);
    status(`Não consegui abrir a câmera: ${err.message ?? err}`);
  }
});

// ---------- Modo Mesa ----------
// Android com ARCore: WebXR (o app acha a mesa sozinho e o celular pode se mexer).
// PC, iPhone e Androids sem ARCore: câmera parada num suporte, calibrada por uma folha A4 (tableCamera.js).
const { isCameraTableSupported } = await import('./modes/tableCamera.js');
const hasXr = await isTableModeSupported();
const hasCamera = isCameraTableSupported();
if (hasXr) {
  $('btn-table').disabled = false;
  $('btn-table').textContent = 'Mesa (RA)';
  $('btn-table-cam').hidden = !hasCamera;
  $('table-info').textContent = 'RA: detecta a mesa e cada carta posta nela vira a criatura dela. Câmera parada: celular num suporte, com uma folha A4.';
} else if (hasCamera) {
  $('btn-table').disabled = false;
  $('table-info').textContent = 'Câmera parada (webcam ou celular num suporte): marque uma folha A4 na mesa; cada carta posta nela vira a criatura dela.';
} else {
  $('table-info').textContent = 'Este navegador não dá acesso à câmera.';
}

function tableUi(overlay) {
  return {
    overlay,
    status: $('xr-status'),
    progress: $('xr-progress'),
    adjust: $('xr-adjust'),
    rotate: $('xr-rotate'),
    flip: $('xr-flip'),
    seats: [...overlay.querySelectorAll('[data-seat]')],
    sizeRow: $('xr-size-row'),
    size: $('xr-size'),
    confirm: $('xr-confirm'),
    retry: $('xr-retry'),
    recalibrate: $('xr-recalibrate'),
    exit: $('xr-exit'),
    referenceRow: $('xr-reference-row'),
    reference: $('xr-reference'),
    corners: $('xr-corners'),
    recognizeRow: $('xr-recognize-row'),
    recognize: $('xr-recognize'),
    scanInfo: $('xr-scan'),
  };
}

// table.js já foi importado lá em cima (isTableModeSupported): o import abaixo resolve na hora,
// e o pedido da sessão de RA ainda conta como resposta ao toque.
async function startXrTable() {
  const { startTableMode } = await import('./modes/table.js');
  const overlay = $('xr-overlay');
  overlay.hidden = false;
  $('menu').hidden = true;
  try {
    await startTableMode({
      ui: tableUi(overlay),
      catalog,
      resolver,
      onEnd: () => {
        overlay.hidden = true;
        $('menu').hidden = false;
      },
    });
  } catch (err) {
    console.error(err);
    overlay.hidden = true;
    $('menu').hidden = false;
    $('table-info').textContent = `Não consegui iniciar a RA: ${err.message ?? err}`;
  }
}

let leaveCameraTable = null;
async function startCameraTable() {
  const view = $('table-cam');
  const overlay = $('xr-overlay');
  view.hidden = false;
  overlay.hidden = false;
  $('menu').hidden = true;
  // Tela cheia precisa ser pedida já no toque (no iPhone, sem a API, o CSS já ocupa a tela).
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  screen.orientation?.lock?.('landscape').catch(() => {});
  const close = () => {
    leaveCameraTable = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    view.hidden = true;
    overlay.hidden = true;
    $('menu').hidden = false;
  };
  try {
    const { startCameraTableMode } = await import('./modes/tableCamera.js');
    leaveCameraTable = await startCameraTableMode({
      view,
      ui: tableUi(overlay),
      catalog,
      resolver,
      onEnd: close,
    });
  } catch (err) {
    console.error(err);
    close();
    $('table-info').textContent = `Não consegui abrir a câmera: ${err.message ?? err}`;
  }
}

$('btn-table').addEventListener('click', () => (hasXr ? startXrTable() : startCameraTable()));
$('btn-table-cam').addEventListener('click', () => startCameraTable());
