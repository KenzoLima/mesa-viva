import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeTypeLine, nameBarFromTypeLine, heightFraction, splitByGaps, typeSimilarity, typeGuidedMatch, RES,
  activityMask, whitenOutside, typeAgrees, typeWordsBox, findCardRects, hideKnownCards, maskBounds, cardMapper,
  topDownView,
} from '../src/table/cardScanner.js';
import { NameMatcher } from '../src/recognition/nameMatcher.js';
import { CardCatalog } from '../src/data/catalog.js';
import { CARD_H } from '../src/table/tableCards.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Catálogo pequeno com as cartas da foto real e algumas parecidas.
const COLS = ['oracle_id', 'name', 'layout', 'is_token', 'type_line', 'card_types', 'subtypes', 'colors', 'power', 'toughness', 'keywords', 'produced_mana'];
const rows = [
  ['a', 'Aurelia, the Warleader', 'normal', '0', 'Legendary Creature — Angel', 'Creature', 'Angel', 'R|W', '3', '4', 'Flying', ''],
  ['l', 'Lathliss, Dragon Queen', 'normal', '0', 'Legendary Creature — Dragon', 'Creature', 'Dragon', 'R', '6', '6', 'Flying', ''],
  ['c', 'Cremate', 'normal', '0', 'Instant', 'Instant', '', 'B', '', '', '', ''],
  ['d', 'Dragon', 'token', '1', 'Token Creature — Dragon', 'Creature', 'Dragon', 'R', '5', '5', 'Flying', ''],
  ['s', 'Lathliss Kin', 'normal', '0', 'Creature — Elf', 'Creature', 'Elf', 'G', '1', '1', '', ''],
];
const tsv = [COLS.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
const matcher = new NameMatcher(new CardCatalog(tsv));

/** Linha do OCR com palavras em x crescente (largura proporcional ao texto). */
function ocrLine(parts, y = 100, h = 14) {
  let x = 10;
  const words = [];
  for (const p of parts) {
    if (p === '  ') { x += 80; continue; }
    const w = p.length * 8;
    words.push({ text: p, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 80 });
    x += w + 6;
  }
  return { text: parts.join(' '), words, confidence: 80, bbox: { x0: 10, y0: y, x1: x, y1: y + h } };
}

test('linha de tipo, mesmo mal lida; texto de regras não', () => {
  assert.ok(looksLikeTypeLine('Legecodacy Croature — Angel'));
  assert.ok(looksLikeTypeLine('Legendary Creacure — Dragon'));
  assert.ok(looksLikeTypeLine('Instant'));
  assert.ok(looksLikeTypeLine('Criatura Lendária — Anjo'));
  assert.ok(!looksLikeTypeLine('fiel control entes, create à 5/5 red')); // "create" sem travessão
  assert.ok(!looksLikeTypeLine('Lathliss, Dragon Queen'));
});

test('a faixa do nome fica ~50% da carta acima da linha de tipo', () => {
  const type = { x0: 100, y0: 300, x1: 260, y1: 314 };
  const r = nameBarFromTypeLine(type, RES);
  const cy = (r.y0 + r.y1) / 2;
  assert.ok(near(307 - cy, 0.505 * CARD_H * RES, 1e-6));
  assert.ok(r.x0 < 100 && r.x1 > 100 + 0.05 * RES);
});

test('onde o texto fica na carta (fração da altura a partir do topo)', () => {
  const card = { center: { x: 0, y: 0 }, up: { x: 0, y: 1 } };
  assert.ok(near(heightFraction({ x: 0, y: CARD_H / 2 }, card), 0));
  assert.ok(near(heightFraction({ x: 0, y: 0 }, card), 0.5));
  assert.ok(near(heightFraction({ x: 0, y: -0.2 * CARD_H }, card), 0.7)); // texto de regras
  const turned = { center: { x: 0, y: 0 }, up: { x: 1, y: 0 } };
  assert.ok(near(heightFraction({ x: CARD_H / 2, y: 0 }, turned), 0));
});

test('separa duas linhas de tipo vizinhas que o OCR juntou', () => {
  const merged = ocrLine(['Legecodacy', 'Croature', '—', 'Angel', '  ', 'Legendary', 'Creacure', '—', 'Dragon']);
  const parts = splitByGaps(merged);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'Legecodacy Croature — Angel');
  assert.equal(parts[1].text, 'Legendary Creacure — Dragon');
  assert.ok(parts[1].bbox.x0 > parts[0].bbox.x1);
});

test('nome só parecido vale quando a linha de tipo também bate', () => {
  assert.ok(typeSimilarity('Legendary Creature — Dragon', 'Legendary Creacure — Dragon') > 0.9);
  assert.ok(typeSimilarity('Legendary Creature — Dragon', 'Legecodacy Croature — Angel') < 0.85);
  // "Clarhiis. Dragon Quena" (5 px/mm) + tipo de dragão → Lathliss.
  const m = typeGuidedMatch(matcher, [ocrLine(['Clarhiis.', 'Dragon', 'Quena'])], 'Legendary Creacure — Dragon');
  assert.equal(m?.card.name, 'Lathliss, Dragon Queen');
  assert.equal(m.anchor, 'title');
  // O mesmo nome com a linha de tipo de outra carta (anjo): não aceita.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Clarhiis.', 'Dragon', 'Quena'])], 'Legendary Creature — Angel'), null);
  // "Aurcelia, e Warleador" + tipo de anjo → Aurelia.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Aurcelia,', 'e', 'Warleador', '229248'])], 'Legecodacy Croature — Angel')?.card.name, 'Aurelia, the Warleader');
  // Lixo não vira carta.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Fem', 'q', 'por', '"o', 'A'])], 'Legendary Creacure — Dragon'), null);
});

test('mesa maior vira mais blocos; bloco com só um canto à vista entra', async () => {
  const { planScans } = await import('../src/table/tableCards.js');
  const { TableFrame } = await import('../src/table/tableFrame.js');
  const small = new TableFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }).scaled(1);
  const big = small.scaled(1.6); // 96 × 112 cm
  const up = (jobs) => jobs.filter((j) => !j.tapped);
  assert.equal(up(planScans(small)).length, 8);
  assert.ok(up(planScans(big)).length > 8);
  for (const j of up(planScans(big))) {
    assert.ok(j.region.x1 - j.region.x0 <= 0.32 + 1e-9 && j.region.y1 - j.region.y0 <= 0.2 + 1e-9);
  }
  // Só a borda de baixo (seu lado) aparece: os blocos de baixo entram mesmo com o centro fora.
  const visibleBottomEdge = (p) => p.y <= -0.34;
  const jobs = up(planScans(small, visibleBottomEdge));
  assert.ok(jobs.length > 0 && jobs.every((j) => j.owner === 'you'));
});

test('bloco parado é pulado; carta nova ou tempo demais faz ler de novo', async () => {
  const { signatureChange } = await import('../src/table/cardScanner.js');
  const { BlockMemory } = await import('../src/table/tableCards.js');
  let seed = 9;
  const table = new Float32Array(200 * 150).map(() => { seed = (seed * 16807) % 2147483647; return 60 + (seed % 40); });
  const noisy = table.map((v, i) => v + ((i * 13) % 3) - 1); // ruído do sensor
  const brighter = table.map((v) => v + 20); // acenderam a luz
  const withCard = table.map((v, i) => ((i % 200) > 90 && (i % 200) < 122 && i / 200 > 50 && i / 200 < 94 ? 220 : v)); // carta de 63 × 88 mm
  assert.ok(signatureChange(table, noisy) < 1.5);
  assert.ok(signatureChange(table, brighter) < 1.5);
  assert.ok(signatureChange(table, withCard) > 1.5, `${signatureChange(table, withCard)}`);

  const mem = new BlockMemory({ maxAge: 60, retry: 8 });
  const job = { region: { x0: -0.3, x1: 0, y0: -0.2, y1: 0 }, up: 0 };
  assert.ok(mem.needsRead(job, table, 0, signatureChange)); // nunca lido
  mem.remember(job, table, 0);
  assert.ok(!mem.needsRead(job, noisy, 10, signatureChange)); // parado: pula
  assert.ok(mem.needsRead(job, withCard, 11, signatureChange)); // carta nova: lê
  assert.ok(mem.needsRead(job, noisy, 61, signatureChange)); // muito tempo: lê de novo
  assert.ok(mem.needsRead({ ...job, up: 90 }, noisy, 12, signatureChange)); // outro giro é outro bloco
  mem.clear();
  assert.ok(mem.needsRead(job, noisy, 13, signatureChange));
});

test('bloco com linha de tipo sem nome volta logo para a fila', async () => {
  const { BlockMemory } = await import('../src/table/tableCards.js');
  const mem = new BlockMemory({ maxAge: 30, retry: 8 });
  const job = { region: { x0: 0, x1: 0.3, y0: -0.2, y1: 0 }, up: 0 };
  const sig = new Float32Array(10).fill(80);
  const same = () => 0;
  mem.remember(job, sig, 0, true);
  assert.ok(!mem.needsRead(job, sig, 5, same));
  assert.ok(mem.needsRead(job, sig, 8.5, same)); // incompleto: relê em 8 s
  mem.remember(job, sig, 10, false);
  assert.ok(!mem.needsRead(job, sig, 30, same));
  assert.ok(mem.needsRead(job, sig, 40.5, same)); // parado e completo: 30 s
});

// ---------------------------------------------------------------- mesa vazia fora do OCR

/** Vista de cima pequena (1 px/mm) de um playmat com grão; cards: [{ x, y }] (canto, em px). */
function matView(w, h, cards = [], grain = 18) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 70 + (rnd() - 0.5) * 2 * grain;
  for (const c of cards) {
    for (let y = 0; y < 88; y++) {
      for (let x = 0; x < 63; x++) {
        const border = x < 3 || y < 3 || x >= 60 || y >= 85;
        const box = y >= 54 && y < 81 && x >= 5 && x < 58; // caixa de texto, lisa
        g[(c.y + y) * w + c.x + x] = border ? 15 : box ? 235 : 120 + ((x >> 3) + (y >> 3)) % 2 * 60;
      }
    }
  }
  return g;
}

test('playmat com grão e sem carta: nada para o OCR ler', () => {
  const act = activityMask(matView(320, 200), 320, 200);
  assert.equal(act.count, 0);
});

test('carta no playmat: só a área dela (com folga) vai para o OCR, com o meio da caixa de texto', () => {
  const w = 320;
  const h = 200;
  const act = activityMask(matView(w, h, [{ x: 120, y: 60 }]), w, h);
  const on = (x, y) => act.mask[Math.floor(y / act.cell) * act.gw + Math.floor(x / act.cell)] === 1;
  assert.ok(on(151, 104), 'centro da carta');
  assert.ok(on(151, 127), 'meio da caixa de texto (liso)');
  assert.ok(on(125, 64) && on(178, 144), 'cantos da carta');
  assert.ok(!on(20, 20) && !on(300, 180) && !on(40, 150), 'longe da carta fica de fora');
  assert.ok(act.count / (act.gw * act.gh) < 0.35, 'a maior parte do bloco fica de fora');
});

test('fora da câmera (NaN) não conta como contraste', () => {
  const w = 320;
  const h = 200;
  const g = matView(w, h);
  for (let y = 0; y < h; y++) for (let x = 200; x < w; x++) g[y * w + x] = NaN;
  assert.equal(activityMask(g, w, h).count, 0);
});

test('a imagem do OCR fica branca fora da área com carta', () => {
  const act = { mask: new Uint8Array([1, 0, 0, 0]), gw: 2, gh: 2, cell: 2, count: 1 };
  const rgba = new Uint8ClampedArray(8 * 8 * 4); // tudo preto; a vista do OCR tem 2× a escala da pequena
  whitenOutside(rgba, 8, 8, act, 2);
  const at = (x, y) => rgba[(y * 8 + x) * 4];
  assert.equal(at(1, 1), 0);
  assert.equal(at(3, 3), 0);
  assert.equal(at(4, 1), 255);
  assert.equal(at(1, 4), 255);
  assert.equal(at(7, 7), 255);
});

// ---------------------------------------------------------------- o nome conferido pela linha de tipo

const cat = new CardCatalog([COLS.join('\t'),
  ['g', 'Ghalta the Unstoppable', 'normal', '0', 'Legendary Creature — Elder Dinosaur', 'Creature', 'Elder|Dinosaur', 'G', '8', '8', 'Trample', ''].join('\t'),
  ['t', 'Taniwha', 'normal', '0', 'Legendary Creature — Serpent', 'Creature', 'Serpent', 'U', '7', '7', 'Trample', ''].join('\t'),
  ['n', 'Dinosaur', 'token', '1', 'Token Creature — Dinosaur', 'Creature', 'Dinosaur', 'G', '3', '3', '', ''].join('\t'),
  ['i', 'Island', 'normal', '0', 'Basic Land — Island', 'Land', 'Island', '', '', '', '', 'U'].join('\t'),
  ['c', 'Cremate', 'normal', '0', 'Instant', 'Instant', '', 'B', '', '', '', ''].join('\t'),
  ['s', 'Sword Coast Serpent // Capsizing Wave', 'adventure', '0', 'Creature — Serpent Dragon // Instant — Adventure', 'Creature', 'Serpent|Dragon', 'U', '6', '6', '', ''].join('\t'),
].join('\n'));
const card = (name) => cat.lookup(name)[0];

test('linha de tipo confere com a carta, mesmo mal lida e com lixo em volta', () => {
  const ghalta = card('Ghalta the Unstoppable');
  assert.ok(typeAgrees(ghalta, 'Legendary Creature — Elder Dinosaur'));
  assert.ok(typeAgrees(ghalta, '— ba 3 Creature — Elder Dimosaur | e CC e E ='));
  assert.ok(typeAgrees(ghalta, 'ry Creature Elder Dinosaul E')); // sem o travessão
  assert.ok(typeAgrees(card('Island'), 'Basic Land — Island'));
  assert.ok(typeAgrees(card('Cremate'), 'Instant'));
  assert.ok(typeAgrees(card('Sword Coast Serpent // Capsizing Wave'), 'Creature — Serpent Dragon'));
});

test('dinossauro não vira serpente: a linha de tipo de outra carta não confere', () => {
  assert.ok(!typeAgrees(card('Taniwha'), 'Legendary Creature — Elder Dinosaur'));
  assert.ok(!typeAgrees(card('Ghalta the Unstoppable'), 'Legendary Creature — Serpent'));
  // O subtipo lido como nome ("Elder Dimosaur" → ficha Dinosaur) cai no texto de regras, não na linha de tipo.
  assert.ok(!typeAgrees(card('Dinosaur'), 'This spell costs X less to cast, where X'));
  assert.ok(!typeAgrees(card('Taniwha'), ''));
  assert.ok(!typeAgrees(card('Taniwha'), '| — =='));
});

test('carta em português: confere pelo tipo', () => {
  assert.ok(typeAgrees(card('Ghalta the Unstoppable'), 'Criatura Lendária — Dinossauro Ancião'));
  assert.ok(typeAgrees(card('Island'), 'Terreno Básico — Ilha'));
  assert.ok(!typeAgrees(card('Cremate'), 'Criatura — Elfo Druida'));
});

test('altura da linha de tipo vem das palavras de tipo, não do borrão lido junto', () => {
  const part = {
    text: 'AEB Creasure o',
    bbox: { x0: 10, y0: 40, x1: 200, y1: 120 },
    words: [
      { text: 'AEB', bbox: { x0: 10, y0: 40, x1: 60, y1: 120 } }, // borrão alto da ilustração
      { text: 'Creasure', bbox: { x0: 70, y0: 100, x1: 180, y1: 118 } },
      { text: 'o', bbox: { x0: 185, y0: 104, x1: 200, y1: 118 } },
    ],
  };
  assert.deepEqual(typeWordsBox(part), { x0: 10, x1: 200, y0: 100, y1: 118 });
  const none = { text: 'abc', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, words: [{ text: 'abc', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }] };
  assert.deepEqual(typeWordsBox(none), none.bbox);
});

// ---------------------------------------------------------------- carta achada pela forma

/** Como matView, com cartas em pé ou deitadas: cards [{ x, y, lying }] (canto, px = mm). */
function matWith(w, h, cards) {
  const g = matView(w, h);
  for (const c of cards) {
    const cw = c.lying ? 88 : 63;
    const ch = c.lying ? 63 : 88;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const u = c.lying ? y : x; // coordenadas na carta em pé
        const v = c.lying ? x : y;
        const border = u < 3 || v < 3 || u >= 60 || v >= 85;
        const box = v >= 54 && v < 81 && u >= 5 && u < 58;
        g[(c.y + y) * w + c.x + x] = border ? 15 : box ? 235 : 120 + ((u >> 3) + (v >> 3)) % 2 * 60;
      }
    }
  }
  return g;
}

test('carta solta no playmat: achada pela forma, com os 4 cantos na borda', () => {
  const w = 320;
  const h = 200;
  const g = matWith(w, h, [{ x: 120, y: 60 }]);
  const rects = findCardRects(g, w, h, activityMask(g, w, h));
  assert.equal(rects.length, 1);
  const r = rects[0];
  assert.ok(Math.abs(r.long - 0.088) < 0.004 && Math.abs(r.short - 0.063) < 0.004, `${r.long} × ${r.short}`);
  const want = [[120, 60], [183, 60], [183, 148], [120, 148]];
  for (const [x, y] of want) {
    assert.ok(r.quad.some((q) => Math.hypot(q.x - x, q.y - y) < 4), `canto ${x},${y}: ${JSON.stringify(r.quad)}`);
  }
  // O lado comprido vai de quad[0] para quad[3]; a volta é sempre no mesmo sentido (sem espelhar).
  assert.ok(Math.abs(Math.hypot(r.quad[3].x - r.quad[0].x, r.quad[3].y - r.quad[0].y) - 88) < 4);
  const cross = (r.quad[1].x - r.quad[0].x) * (r.quad[3].y - r.quad[0].y) - (r.quad[1].y - r.quad[0].y) * (r.quad[3].x - r.quad[0].x);
  assert.ok(cross > 0, 'cantos na ordem sup.esq → sup.dir → inf.dir → inf.esq');
});

test('carta deitada: o lado comprido sai na horizontal (quem lê é o bloco das viradas)', () => {
  const w = 320;
  const h = 200;
  const g = matWith(w, h, [{ x: 100, y: 70, lying: true }]);
  const [r] = findCardRects(g, w, h, activityMask(g, w, h));
  assert.ok(r);
  assert.ok(Math.abs(r.quad[3].x - r.quad[0].x) > Math.abs(r.quad[3].y - r.quad[0].y));
});

test('cartas encostadas não viram um retângulo só: ficam para o OCR do bloco', () => {
  const w = 320;
  const h = 200;
  const g = matWith(w, h, [{ x: 80, y: 60 }, { x: 143, y: 60 }]);
  const act = activityMask(g, w, h);
  assert.equal(findCardRects(g, w, h, act).length, 0);
  assert.ok(act.count > 0);
});

test('carta já reconhecida sai da conta: o bloco só com ela não vai para o OCR', () => {
  const region = { x0: 0, x1: 0.32, y0: 0, y1: 0.2 };
  const view = topDownView(region, 0, 1000, 0);
  const g = matWith(view.w, view.h, [{ x: 120, y: 60 }]);
  assert.ok(activityMask(g, view.w, view.h).count > 0);
  const center = view.toTable(120 + 31.5, 60 + 44);
  hideKnownCards(g, view, [{ center, yaw: 0 }]);
  assert.equal(activityMask(g, view.w, view.h).count, 0);
  assert.equal(maskBounds(activityMask(g, view.w, view.h)), null);
});

test('caixa da área ligada e ponto da carta → mesa', () => {
  const act = { mask: new Uint8Array([0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0]), gw: 4, gh: 3 };
  assert.deepEqual(maskBounds(act), { x0: 0, y0: 1, x1: 2, y1: 3 });
  // Carta girada 90° na mesa: topo para +x.
  const map = cardMapper([{ x: 1, y: 2 }, { x: 1, y: 1.937 }, { x: 0.912, y: 1.937 }, { x: 0.912, y: 2 }]);
  const c = map(0.5, 0.5);
  assert.ok(near(c.x, 0.956, 1e-6) && near(c.y, 1.9685, 1e-6));
  const name = map(0.5, 0.072);
  assert.ok(near(name.x, 1 - 0.072 * 0.088, 1e-6) && near(name.y, 1.9685, 1e-6));
});

// ---------------------------------------------------------------- fila de leitura

test('fila: o bloco que mudou passa na frente; o recém-lido vai para o fim; virados depois', async () => {
  const { BlockMemory, pickJob } = await import('../src/table/tableCards.js');
  const mem = new BlockMemory({ maxAge: 30, retry: 8 });
  const jobs = [0, 1, 2].map((i) => ({ region: { x0: i, x1: i + 1, y0: 0, y1: 1 }, up: 0, tapped: false }))
    .concat([{ region: { x0: 0, x1: 1, y0: 0, y1: 1 }, up: 90, tapped: true }]);
  const sigs = new Map(jobs.map((j) => [j, new Float32Array([10])]));
  const change = (a, b) => Math.abs(a[0] - b[0]);
  const pick = (now, start = 0) => pickJob(jobs, mem, (j) => sigs.get(j), now, change, start);
  // Nunca lidos: os em pé primeiro, na ordem; o virado por último.
  assert.equal(pick(0).index, 0);
  for (const j of jobs.slice(0, 3)) mem.remember(j, sigs.get(j), 0);
  assert.equal(pick(1).index, 3);
  mem.remember(jobs[3], sigs.get(jobs[3]), 1);
  assert.equal(pick(2), null); // tudo parado: nada para ler
  // Carta posta no bloco 2: ele passa na frente de tudo.
  sigs.set(jobs[2], new Float32Array([40]));
  const next = pick(3, 0);
  assert.equal(next.index, 2);
  assert.equal(next.why, 'changed');
  // Mão se mexendo no bloco 2 (muda sempre) e o bloco 0 vencido: depois de ler o 2, vem o 0.
  mem.remember(jobs[2], sigs.get(jobs[2]), 3);
  sigs.set(jobs[2], new Float32Array([80]));
  assert.equal(pick(40, 3).index, 0);
  assert.equal(pick(40, 1).index, 2);
});

test('leitura incompleta sem nada mudar: tenta de novo cada vez mais devagar', async () => {
  const { BlockMemory } = await import('../src/table/tableCards.js');
  const mem = new BlockMemory({ maxAge: 30, retry: 8, maxRetry: 60 });
  const job = { region: { x0: 0, x1: 1, y0: 0, y1: 1 }, up: 0 };
  const sig = new Float32Array([1]);
  const same = () => 0;
  mem.remember(job, sig, 0, true, 'new');
  assert.equal(mem.why(job, sig, 7, same), null);
  assert.equal(mem.why(job, sig, 8, same), 'retry');
  mem.remember(job, sig, 8, true, 'retry');
  assert.equal(mem.why(job, sig, 8 + 15, same), null);
  assert.equal(mem.why(job, sig, 8 + 16, same), 'retry');
  mem.remember(job, sig, 24, true, 'retry');
  mem.remember(job, sig, 56, true, 'retry');
  mem.remember(job, sig, 120, true, 'retry'); // 8 × 2⁴ = 128 → no máximo 60 s
  assert.equal(mem.why(job, sig, 120 + 59, same), null);
  assert.equal(mem.why(job, sig, 120 + 60, same), 'retry');
  // A imagem mudou: lê na hora e a espera volta ao começo.
  assert.equal(mem.why(job, sig, 121, () => 99), 'changed');
  mem.remember(job, sig, 121, true, 'changed');
  assert.equal(mem.why(job, sig, 121 + 8, same), 'retry');
});
