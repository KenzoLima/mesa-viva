import { CardCatalog } from './data/catalog.js';
import { ModelResolver } from './data/modelResolver.js';
import { isTableModeSupported } from './modes/table.js';
import { loadTargets } from './modes/targets.js';

const $ = (id) => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;

// Escolhas do usuário (carta -> modelo), como o AppSettings do Unity. Fica só neste aparelho.
function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem('mesaviva.overrides') ?? '{}');
  } catch {
    return {};
  }
}

const [catalog, resolver] = await Promise.all([
  CardCatalog.load(`${BASE}data/`),
  ModelResolver.load(`${BASE}data/model_map.json`, loadOverrides()),
]);
const cards = [...catalog.byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt'));

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
renderResults(cards.slice(0, 8));

// ---------- Modo Cartas (MindAR, todos os aparelhos) ----------
const targets = await loadTargets(BASE);
if (targets) {
  $('btn-cards').disabled = false;
  $('cards-info').textContent = `Reconhece ${targets.length} carta(s). iPhone e Android.`;
} else {
  $('cards-info').innerHTML = 'Sem alvos ainda. Gere em <a href="compilar.html">compilar.html</a>.';
  $('btn-cards').disabled = false;
  $('btn-cards').classList.add('needs-setup');
}

$('btn-cards').addEventListener('click', async () => {
  if (!targets) {
    location.href = `${BASE}compilar.html`;
    return;
  }
  const { startCardsMode } = await import('./modes/cards.js');
  $('menu').hidden = true;
  $('cards-view').hidden = false;
  try {
    const stop = await startCardsMode($('cards-container'), {
      targets, catalog, resolver, onStatus: (t) => { $('cards-status').textContent = t; },
    });
    $('cards-exit').onclick = () => {
      stop();
      $('cards-view').hidden = true;
      $('menu').hidden = false;
    };
  } catch (err) {
    console.error(err);
    $('cards-status').textContent = `Não consegui abrir a câmera: ${err.message ?? err}`;
    $('cards-exit').onclick = () => location.reload();
  }
});

// ---------- Modo Mesa (WebXR, Android) ----------
if (await isTableModeSupported()) {
  $('btn-table').disabled = false;
  $('table-info').textContent = 'Detecta a mesa e invoca criaturas onde você tocar.';
} else {
  $('table-info').textContent = 'Precisa do Chrome no Android com ARCore. No iPhone, use o modo Cartas.';
}

const select = $('xr-card');
for (const card of cards) {
  const opt = document.createElement('option');
  opt.value = card.oracleId;
  opt.textContent = `${card.displayName} — ${resolver.label(resolver.resolve(card).modelId)}`;
  select.append(opt);
}
const firstCreature = cards.find((c) => c.hasType('Creature'));
if (firstCreature) select.value = firstCreature.oracleId;

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
        cardSelect: select,
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
