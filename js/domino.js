// Drawing dominoes as inline SVG.

// One colour per pip count, roughly matching the colour-coded double-12 sets
// Mexican Train is usually played with.
const PIP_COLORS = [
  '#000000', '#2aa3de', '#1f9a52', '#d7263d', '#8a5a2b', '#1f47a8', '#e3a900',
  '#c9489a', '#0b7d74', '#6b2d91', '#ea7317', '#222222', '#7b7f86',
  '#a51c4b', '#5e8f2a', '#3d4466', '#b76a6a', '#2b6a6a', '#6b4a22',
];

export const pipColor = (n) => PIP_COLORS[n] ?? '#222222';

/** Pip centres in a unit square: three columns, as on a real double-12 tile. */
export function pipLayout(n) {
  if (n <= 0) return [];
  if (n === 1) return [[0.5, 0.5]];
  if (n === 2) return [[0.25, 0.25], [0.75, 0.75]];
  if (n === 3) return [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]];
  const rows = n <= 9 ? 3 : n <= 12 ? 4 : n <= 15 ? 5 : 6;
  const side = Math.min(rows, Math.floor(n / 2));
  const middle = n - 2 * side;
  const [lo, hi] = rows <= 3 ? [0.22, 0.78] : [0.15, 0.85];
  const column = (k) =>
    k === 1 ? [0.5] : Array.from({ length: k }, (_, i) => lo + ((hi - lo) * i) / (k - 1));
  return [
    ...column(side).flatMap((y) => [[0.22, y], [0.78, y]]),
    ...(middle ? column(middle).map((y) => [0.5, y]) : []),
  ];
}

function half(n, dx, dy) {
  const r = n <= 9 ? 4.6 : n <= 12 ? 4 : n <= 15 ? 3.3 : 2.8;
  return pipLayout(n)
    .map(([x, y]) => `<circle cx="${(dx + 4 + 42 * x).toFixed(1)}" cy="${(dy + 4 + 42 * y).toFixed(1)}" r="${r}"/>`)
    .join('');
}

/**
 * A tile as an SVG string. Upright tiles put `a` on top; horizontal ones put
 * `a` on the left, which is how a train reads.
 */
export function tileSvg(a, b, { horizontal = false } = {}) {
  const [w, h] = horizontal ? [100, 50] : [50, 100];
  const [bx, by] = horizontal ? [50, 0] : [0, 50];
  const divider = horizontal
    ? '<line x1="50" y1="6" x2="50" y2="44"/>'
    : '<line x1="6" y1="50" x2="44" y2="50"/>';
  return (
    `<svg class="domino" viewBox="0 0 ${w} ${h}" role="img" aria-label="${a} and ${b}">` +
    `<rect class="domino-face" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="7"/>` +
    `<g class="domino-divider">${divider}</g>` +
    `<g fill="${pipColor(a)}">${half(a, 0, 0)}</g>` +
    `<g fill="${pipColor(b)}">${half(b, bx, by)}</g>` +
    '</svg>'
  );
}
