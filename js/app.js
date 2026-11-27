import { solve, isDouble } from './solver.js';
import { detectDominoes } from './detect.js';
import { tileSvg, pipColor } from './domino.js';

const STORAGE_KEY = 'mexican-train-solver';
const PHOTO_SIDE = 1600;

const $ = (id) => document.getElementById(id);

const saved = loadSaved();

/** @type {{hand: {a: number, b: number, unsure?: boolean}[], setMax: number, start: number, others: number[], goal: 'tiles'|'pips', example?: boolean}} */
const state = Object.assign({ hand: [], setMax: 12, start: 12, others: [], goal: 'tiles' }, saved);

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.hand) ? saved : null;
  } catch {
    return null; // private mode, blocked storage or a corrupt entry: start fresh
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Nothing to do: the page works the same, it just won't remember the hand.
  }
}

// The example that loads by itself on a first visit is only wanted while the
// visitor has not started on a hand of their own.
let wantAutoExample = !saved;

function update() {
  save();
  renderHand();
  renderTable();
  renderResult();
}

// ------------------------------------------------------------------- hand

function renderHand() {
  const hand = $('hand');
  hand.replaceChildren(
    ...state.hand.map((tile, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `hand-tile${tile.unsure ? ' unsure' : ''}`;
      button.innerHTML = `${tileSvg(tile.a, tile.b)}<span>${tile.a} | ${tile.b}</span>`;
      button.setAttribute(
        'aria-label',
        `${tile.a} and ${tile.b}${tile.unsure ? ', hard to read, please check' : ''}. Edit`,
      );
      button.addEventListener('click', () => openEditor(i));
      return button;
    }),
    addButton(),
  );
  const n = state.hand.length;
  const points = state.hand.reduce((sum, t) => sum + t.a + t.b, 0);
  $('hand-count').textContent = n
    ? `${state.example ? 'Example hand · ' : ''}${n} ${n === 1 ? 'tile' : 'tiles'} · ${points} points`
    : 'No tiles yet. Use a photo, or add them with +';
  $('hand-clear').hidden = n === 0;
}

function addButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hand-tile hand-add';
  button.textContent = '+';
  button.setAttribute('aria-label', 'Add a tile');
  button.addEventListener('click', () => openEditor(null));
  return button;
}

$('hand-clear').addEventListener('click', () => {
  wantAutoExample = false;
  state.hand = [];
  state.example = false;
  $('photo').hidden = true;
  $('photo-add').hidden = true;
  setStatus('');
  update();
});

// ----------------------------------------------------------------- editor

const editor = { index: null, a: 0, b: 0 };

function openEditor(index) {
  const tile = index === null ? { a: state.start, b: state.start } : state.hand[index];
  Object.assign(editor, { index, a: tile.a, b: tile.b });
  $('editor-title').textContent = index === null ? 'Add a tile' : 'Edit tile';
  $('editor-delete').hidden = index === null;
  $('editor-done').textContent = index === null ? 'Add' : 'Done';
  renderEditor();
  $('editor').showModal();
}

function renderEditor() {
  $('editor-preview').innerHTML = tileSvg(editor.a, editor.b);
  for (const side of ['a', 'b']) {
    numberButtons($(`editor-${side}`), Math.max(state.setMax, editor[side]), {
      checked: (n) => n === editor[side],
      onPick: (n) => {
        editor[side] = n;
        renderEditor();
      },
    });
  }
}

$('editor').querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  wantAutoExample = false;
  const tile = { a: editor.a, b: editor.b };
  if (editor.index === null) state.hand.push(tile);
  else state.hand[editor.index] = tile;
  state.example = false;
  $('editor').close();
  update();
});

$('editor-delete').addEventListener('click', () => {
  wantAutoExample = false;
  state.hand.splice(editor.index, 1);
  state.example = false;
  $('editor').close();
  update();
});

// A light dismiss: clicking the backdrop closes without saving.
$('editor').addEventListener('click', (event) => {
  if (event.target === $('editor')) $('editor').close();
});

// ------------------------------------------------------------------ table

function numberButtons(container, max, { checked, onPick, toggle = false, times = () => 1 }) {
  const focused = container.contains(document.activeElement)
    ? Number(document.activeElement.dataset.n)
    : null;
  container.replaceChildren(
    ...Array.from({ length: max + 1 }, (_, n) => {
      const button = document.createElement('button');
      button.type = 'button';
      // "3 ×2": two other trains both end on a 3.
      button.textContent = times(n) > 1 ? `${n} ×${times(n)}` : n;
      if (times(n) > 1) button.setAttribute('aria-label', `${n}, ${times(n)} trains`);
      button.dataset.n = n;
      button.style.setProperty('--pip', n ? pipColor(n) : 'transparent');
      if (toggle) button.setAttribute('aria-pressed', checked(n));
      else {
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', checked(n));
      }
      button.addEventListener('click', () => onPick(n));
      return button;
    }),
  );
  if (focused !== null) container.querySelector(`[data-n="${focused}"]`)?.focus();
}

function renderTable() {
  $('set-size').value = String(state.setMax);
  numberButtons($('start'), state.setMax, {
    checked: (n) => n === state.start,
    onPick: (n) => {
      state.start = n;
      update();
    },
  });
  numberButtons($('others'), state.setMax, {
    toggle: true,
    checked: (n) => state.others.includes(n),
    times: (n) => state.others.filter((x) => x === n).length,
    // Tap once for one train ending on this number, again for a second, and
    // a third time to clear it.
    onPick: (n) => {
      const count = state.others.filter((x) => x === n).length;
      const rest = state.others.filter((x) => x !== n);
      state.others = (count >= 2 ? rest : [...rest, ...new Array(count + 1).fill(n)]).sort((x, y) => x - y);
      update();
    },
  });
  for (const button of $('goal').children) {
    button.setAttribute('aria-checked', button.dataset.goal === state.goal);
  }
}

$('set-size').addEventListener('change', (event) => {
  const max = Number(event.target.value);
  // The first round's engine is the set's highest double, so follow it.
  if (state.start === state.setMax || state.start > max) state.start = max;
  state.others = state.others.filter((n) => n <= max);
  state.setMax = max;
  update();
});

for (const button of $('goal').children) {
  button.addEventListener('click', () => {
    state.goal = button.dataset.goal;
    update();
  });
}

// ----------------------------------------------------------------- result

function renderResult() {
  const root = $('result');
  if (!state.hand.length) {
    root.innerHTML = '<p class="placeholder">Add your dominoes and the best train shows up here.</p>';
    return;
  }
  const hand = state.hand.map((t) => [t.a, t.b]);
  const { best, alternatives, exact } = solve(hand, [state.start, ...state.others], {
    objective: state.goal,
    timeLimitMs: 1000,
  });

  const parts = [headline(best, hand.length), ...best.trains.map((t, i) => trainHtml(t, i))];
  if (!exact) {
    parts.push(
      '<p class="note">That is a big hand: this is the best plan found in a second of searching, so a slightly better one may exist.</p>',
    );
  }
  if (best.leftover.length) {
    parts.push(
      `<div class="leftover"><h3>Left in your hand · ${best.leftoverPips} points</h3>${chain(best.leftover, null, false)}</div>`,
    );
  }
  if (alternatives.length) {
    const n = alternatives.length;
    parts.push(
      `<details class="alternatives"><summary>${n} other ${n === 1 ? 'plan' : 'plans'} just as good</summary>` +
        alternatives.map(alternativeHtml).join('') +
        '</details>',
    );
  }
  root.innerHTML = parts.join('');
}

function headline(plan, total) {
  const ends = [state.start, ...state.others];
  if (!plan.used) {
    const where = ends.length === 1 ? `a ${ends[0]}` : `any of ${ends.join(', ')}`;
    return `<p class="headline">Nothing in your hand plays on ${where}.</p><p class="subline">You would have to draw.</p>`;
  }
  const title =
    plan.used === total
      ? `You can play all ${total} ${total === 1 ? 'tile' : 'tiles'}.`
      : `Play ${plan.used} of your ${total} tiles.`;
  const detail = plan.leftover.length
    ? `${plan.pips} points out of your hand, ${plan.leftoverPips} left in it.`
    : `All ${plan.pips} points out of your hand.`;
  return `<p class="headline">${title}</p><p class="subline">${detail}</p>`;
}

function trainHtml(train, i) {
  const title = i === 0 ? 'Your train' : `On the open ${train.start}`;
  const last = train.tiles[train.tiles.length - 1];
  const note =
    last && isDouble(last)
      ? '<p class="note">Ends on a double, which has to be covered — by you next turn, or you draw.</p>'
      : '';
  return `<div class="plan-train"><h3>${title} · ${count(train.tiles.length)}</h3>${chain(train.tiles, train.start, true)}${note}</div>`;
}

function alternativeHtml(plan) {
  const keeps = plan.leftover.length
    ? `<p class="keeps">Leaves ${plan.leftover.map(([a, b]) => `${a}|${b}`).join(', ')}</p>`
    : '';
  return `<div class="alternative">${plan.trains.map((t, i) => trainHtml(t, i)).join('')}${keeps}</div>`;
}

const count = (n) => `${n} ${n === 1 ? 'tile' : 'tiles'}`;

// A run of tiles. In a train they lie end to end with doubles turned
// crosswise, the way they sit on the table; leftovers just stand in a row.
function chain(tiles, start, asTrain) {
  const hub =
    start === null
      ? ''
      : `<span class="hub" style="--hub:${start ? pipColor(start) : 'currentColor'}" aria-label="starts at ${start}">${start}</span>`;
  const links = tiles
    .map(([a, b]) => {
      const crosswise = !asTrain || a === b;
      return `<span class="link${crosswise ? ' double' : ''}">${tileSvg(a, b, { horizontal: !crosswise })}</span>`;
    })
    .join('');
  return `<div class="chain">${hub}${links || '<span class="none">nothing to play here</span>'}</div>`;
}

// ------------------------------------------------------------------ photo

let appendNextPhoto = false;

$('photo-new').addEventListener('click', () => pickPhoto(false));
$('photo-add').addEventListener('click', () => pickPhoto(true));

function pickPhoto(append) {
  appendNextPhoto = append;
  $('photo-input').value = '';
  $('photo-input').click();
}

$('photo-input').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (!file) return;
  wantAutoExample = false;
  readPhoto(file, appendNextPhoto);
});

$('photo-example').addEventListener('click', () => {
  wantAutoExample = false;
  loadExample();
});

// `auto` is the unprompted first-visit load: it stays quiet, and gives way the
// moment the visitor does anything to the hand themselves.
async function loadExample({ auto = false } = {}) {
  const stale = () => auto && !wantAutoExample;
  if (!auto) setStatus('Loading the example…');
  try {
    const response = await fetch('examples/hand.jpg');
    if (!response.ok) throw new Error(response.statusText);
    const photo = await response.blob();
    if (!stale()) await readPhoto(photo, false, true, stale);
  } catch {
    if (!auto) setStatus('The example photo could not be loaded.', true);
  }
}

function setStatus(text, problem = false) {
  $('photo-status').textContent = text;
  $('photo-status').classList.toggle('problem', problem);
}

async function readPhoto(file, append, example = false, stale = () => false) {
  setStatus('Reading your dominoes…');
  let source;
  try {
    source = await decode(file);
  } catch {
    setStatus('That file could not be opened as a picture.', true);
    return;
  }
  if (stale()) return;
  const canvas = $('photo-canvas');
  const shrink = Math.min(1, PHOTO_SIDE / Math.max(source.width, source.height));
  canvas.width = Math.round(source.width * shrink);
  canvas.height = Math.round(source.height * shrink);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  $('photo').hidden = false;

  // Let the photo and the status line paint before the heavy part.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  if (stale()) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { tiles } = detectDominoes(image, { maxPips: state.setMax });
  drawOutlines(ctx, tiles);

  if (!tiles.length) {
    setStatus(
      'No dominoes found in that photo. It needs light tiles on a darker surface, close enough to see the pips. You can also add tiles by hand with +.',
      true,
    );
    return;
  }
  const found = tiles.map((t) => ({ a: t.a, b: t.b, unsure: !t.sure }));
  state.hand = append ? [...state.hand, ...found] : found;
  state.example = example;
  const unsure = found.filter((t) => t.unsure).length;
  setStatus(
    (example ? 'This is an example photo. ' : '') +
      `Found ${count(tiles.length)}. Check them against the photo and tap any that are wrong.` +
      (unsure ? ` ${unsure === 1 ? 'One was' : `${unsure} were`} hard to read and ${unsure === 1 ? 'is' : 'are'} outlined.` : ''),
  );
  $('photo-add').hidden = false;
  update();
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers reject formats here that <img> can still show.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawOutlines(ctx, tiles) {
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tile of tiles) {
    const c = tile.corners;
    const width = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
    ctx.beginPath();
    ctx.moveTo(c[0][0], c[0][1]);
    for (const [x, y] of c.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.lineWidth = Math.max(3, width * 0.05);
    ctx.strokeStyle = tile.sure ? '#2ee6a8' : '#ffb020';
    ctx.stroke();

    const text = `${tile.a}|${tile.b}`;
    const size = Math.max(14, width * 0.3);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const cx = (c[0][0] + c[2][0]) / 2;
    const cy = (c[0][1] + c[2][1]) / 2;
    const w = ctx.measureText(text).width + size * 0.5;
    ctx.fillStyle = 'rgb(0 0 0 / 0.78)';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - size * 0.65, w, size * 1.3, size * 0.3);
    ctx.fill();
    ctx.fillStyle = tile.sure ? '#ffffff' : '#ffd27a';
    ctx.fillText(text, cx, cy + size * 0.04);
  }
}

update();
// A first visit opens on the example, so the page shows what it does.
if (wantAutoExample) loadExample({ auto: true });
