import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDominoes } from '../js/detect.js';
import { pipLayout } from '../js/domino.js';

// A crude but honest "photo": ivory tiles with dark pips, a divider and a
// darker rim, on a brown table. tools/make_test_photos.py renders far more
// realistic ones for tuning; this keeps a dependency-free check in the suite.
function paint(width, height, tiles) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let colour = [120 + ((x * 7 + y * 13) % 9), 82, 48];
      for (const t of tiles) {
        const cos = Math.cos(t.angle);
        const sin = Math.sin(t.angle);
        const u = (x - t.x) * cos + (y - t.y) * sin; // across the tile
        const v = -(x - t.x) * sin + (y - t.y) * cos; // along it
        if (Math.abs(u) > t.w / 2 || Math.abs(v) > t.w) continue;
        const rim = Math.min(t.w / 2 - Math.abs(u), t.w - Math.abs(v)) < 0.03 * t.w;
        colour = rim ? [196, 190, 172] : [244, 240, 226];
        if (Math.abs(v) < 0.012 * t.w && Math.abs(u) < 0.42 * t.w) colour = [60, 58, 54];
        const value = v < 0 ? t.a : t.b;
        const top = v < 0 ? -t.w : 0;
        for (const [px, py] of pipLayout(value)) {
          const cx = (px - 0.5) * 0.92 * t.w;
          const cy = top + (0.04 + 0.92 * py) * t.w;
          if (Math.hypot(u - cx, v - cy) < 0.066 * t.w) colour = [30, 60 + value * 10, 150];
        }
        break;
      }
      data.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const pairs = (tiles) => tiles.map((t) => [Math.min(t.a, t.b), Math.max(t.a, t.b)].join('|')).sort();

test('reads separated tiles at any angle', () => {
  const tiles = [
    { a: 12, b: 7, x: 140, y: 170, w: 90, angle: 0.3 },
    { a: 0, b: 5, x: 380, y: 150, w: 90, angle: -1.1 },
    { a: 9, b: 9, x: 640, y: 180, w: 90, angle: 1.6 },
    { a: 3, b: 11, x: 180, y: 430, w: 90, angle: 2.4 },
    { a: 6, b: 1, x: 420, y: 440, w: 90, angle: 0 },
    { a: 10, b: 4, x: 660, y: 430, w: 90, angle: -0.5 },
  ];
  const found = detectDominoes(paint(800, 600, tiles)).tiles;
  assert.deepEqual(pairs(found), pairs(tiles));
  for (const tile of found) assert.equal(tile.corners.length, 4);
});

test('splits a row of touching tiles and keeps left-to-right order', () => {
  const values = [[2, 8], [12, 12], [0, 3], [7, 5], [11, 6], [4, 4], [9, 1]];
  const tiles = values.map(([a, b], i) => ({ a, b, x: 130 + i * 90, y: 300, w: 90, angle: 0 }));
  const found = detectDominoes(paint(800, 600, tiles)).tiles;
  assert.deepEqual(found.map((t) => [t.a, t.b]), values);
});

test('splits tiles laid end to end', () => {
  const values = [[5, 2], [2, 9], [9, 9], [9, 0]];
  const tiles = values.map(([a, b], i) => ({ a, b, x: 130 + i * 180, y: 300, w: 90, angle: -Math.PI / 2 }));
  const found = detectDominoes(paint(800, 600, tiles)).tiles;
  assert.deepEqual(found.map((t) => [t.a, t.b]), values);
});

test('finds nothing on an empty table', () => {
  assert.deepEqual(detectDominoes(paint(400, 300, [])).tiles, []);
});
