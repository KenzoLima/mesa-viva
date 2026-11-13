import { CardCatalog } from './data/catalog.js';
import { ModelResolver } from './data/modelResolver.js';
import { isTableModeSupported } from './modes/table.js';
import version from '../version.json';

const $ = (id) => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;

// Versão do app: sobe 0.01 a cada commit ou merge na main (tools/hooks/bump-version.sh).
const appVersion = document.createElement('div');
appVersion.className = 'app-version';
appVersion.textContent = `v${(version.build / 100).toFixed(2)}`;
document.body.append(appVersion);

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
function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem('mesaviva.overrides') ?? '{}');
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
function renderResults(list) {
  $('results').replaceChildren(...list.map((card) => {
    const c = resolver.resolve(card);
    const li = document.createElement('li');
    li.innerHTML = `<strong></strong><span class="type"></span><span class="model"></span>`;
    li.children[0].textContent = card.displayName;
    li.children[1].textContent = card.typeLine;
    li.children[2].textContent = `${resolver.label(c.modelId)} · ${c.reason}${c.scale !== 1 ? ` · tamanho ${c.scale}×` : ''}`;
    return li;
  }));
}
$('search').addEventListener('input', (e) => renderResults(catalog.search(e.target.value)));
renderResults(['Shivan Dragon', 'Llanowar Elves', 'Serra Angel', 'Lightning Bolt', 'Breeding Pool', 'Sol Ring']
  .map((n) => catalog.lookup(n)[0]).filter(Boolean));
$('catalog-count').textContent = `${catalog.size.toLocaleString('pt-BR')} cartas no catálogo`;

// ---------- Campo de batalha (câmera em tela cheia, reconhece qualquer carta) ----------
let leaveBattlefield = null;
function closeBattlefield() {
  leaveBattlefield?.();
  leaveBattlefield = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  $('battlefield').hidden = true;
  $('menu').hidden = false;
}
$('bf-exit').addEventListener('click', closeBattlefield);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && leaveBattlefield) closeBattlefield();
});

$('btn-battlefield').addEventListener('click', async () => {
  const view = $('battlefield');
  view.hidden = false;
  $('menu').hidden = true;
  // Tela cheia precisa ser pedida já no toque. No iPhone (sem a API) a tela já ocupa tudo pelo CSS.
  view.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  screen.orientation?.lock?.('landscape').catch(() => {});
  const status = (t) => { $('bf-status').textContent = t; };
  try {
    const { startBattlefield } = await import('./modes/battlefield.js');
    leaveBattlefield = await startBattlefield(view, { catalog, resolver, onStatus: status });
  } catch (err) {
    console.error(err);
    status(`Não consegui abrir a câmera: ${err.message ?? err}`);
  }
});

// ---------- Modo Mesa (WebXR, Android) ----------
if (await isTableModeSupported()) {
  $('btn-table').disabled = false;
  $('table-info').textContent = 'Detecta a mesa e invoca criaturas onde você tocar.';
} else {
  $('table-info').textContent = 'Precisa do Chrome no Android com ARCore. No iPhone, use o campo de batalha.';
}

// Com o catálogo inteiro (~30 mil cartas) não dá para listar tudo: busca e mostra as melhores.
const select = $('xr-card-select');
function fillCardOptions(list) {
  select.replaceChildren(...list.map((card) => {
    const opt = document.createElement('option');
    opt.value = card.oracleId;
    opt.textContent = `${card.displayName} — ${resolver.label(resolver.resolve(card).modelId)}`;
    return opt;
  }));
}
const STARTERS = ['Shivan Dragon', 'Llanowar Elves', 'Serra Angel', 'Goblin Guide', 'Grizzly Bears', 'Lightning Bolt', 'Forest'];
fillCardOptions(STARTERS.map((n) => catalog.lookup(n)[0]).filter(Boolean));
$('xr-search').addEventListener('input', (e) => {
  if (e.target.value.trim().length >= 2) fillCardOptions(catalog.search(e.target.value, 30));
});

$('btn-table').addEventListener('click', async () => {
  const { startTableMode } = await import('./modes/table.js');
  const overlay = $('xr-overlay');
  overlay.hidden = false;
  $('menu').hidden = true;
  try {
    await startTableMode({
      ui: {
        overlay,
        status: $('xr-status'),
        sizeRow: $('xr-size-row'),
        size: $('xr-size'),
        confirm: $('xr-confirm'),
        recalibrate: $('xr-recalibrate'),
        cardSelect: $('xr-card'),
        exit: $('xr-exit'),
      },
      resolver,
      pickCard: () => catalog.get(select.value),
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
});
