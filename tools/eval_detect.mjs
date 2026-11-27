#!/usr/bin/env node
// Score the detector against photos made by make_test_photos.py.
//   node tools/eval_detect.mjs PHOTO_DIR [name-filter]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectDominoes } from '../js/detect.js';

export function loadRgba(path) {
  const buf = readFileSync(path);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + 8, width * height * 4) };
}

const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

export function score(found, truth) {
  const centre = (c) => [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
  const left = truth.map((t) => ({ ...t, c: centre(t.corners) }));
  let located = 0;
  let correct = 0;
  const wrong = [];
  for (const f of found) {
    const c = centre(f.corners);
    const width = Math.hypot(f.corners[1][0] - f.corners[0][0], f.corners[1][1] - f.corners[0][1]);
    const i = left.findIndex((t) => Math.hypot(t.c[0] - c[0], t.c[1] - c[1]) < 0.5 * width);
    if (i < 0) continue;
    const [t] = left.splice(i, 1);
    located++;
    if (key(t.a, t.b) === key(f.a, f.b)) correct++;
    else wrong.push(`${t.a}|${t.b} read as ${f.a}|${f.b}`);
  }
  return { located, correct, extra: found.length - located, wrong };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const filter = process.argv[3] ?? '';
  let tiles = 0;
  let right = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.det.') && f.includes(filter)).sort()) {
    const truth = JSON.parse(readFileSync(join(dir, file), 'utf8')).tiles;
    const started = Date.now();
    const { tiles: found } = detectDominoes(loadRgba(join(dir, file.replace('.json', '.rgba'))));
    const s = score(found, truth);
    tiles += truth.length;
    right += s.correct;
    console.log(
      `${file.replace('.json', '').padEnd(22)} ${String(truth.length).padStart(2)} tiles | found ${s.located} | correct ${s.correct} | extra ${s.extra} | ${Date.now() - started}ms`,
      s.wrong.length ? `\n    ${s.wrong.join(', ')}` : '',
    );
  }
  console.log(`\n${right}/${tiles} tiles read correctly`);
}
