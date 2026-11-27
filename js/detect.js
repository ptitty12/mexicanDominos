// Find dominoes in a photo and count their pips. Pure functions over RGBA
// pixels, no DOM and no dependencies, so it runs the same in a browser and in
// node tests.
//
// The approach is classical computer vision and assumes light tiles on a
// darker surface:
//   1. "whiteness" (the smallest of R, G, B) separates tile faces from the
//      table and from pips of any colour;
//   2. connected bright regions become blobs, each fitted with a rotated
//      rectangle;
//   3. a blob is one tile, or several touching tiles that are split by their
//      2:1 geometry, pip size and divider lines;
//   4. every tile is straightened into a patch and the pips in each half are
//      counted.

const ANALYSIS_SIDE = 1000;

/**
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} image RGBA pixels
 * @param {{maxPips?: number}} [opts]
 * @returns {{tiles: Array<{a: number, b: number, sure: boolean, corners: number[][]}>}}
 *   `a`/`b` are the pip counts of the two halves, `corners` the tile outline in image pixels.
 */
export function detectDominoes(image, opts = {}) {
  const maxPips = opts.maxPips ?? 18;
  const { width, height } = image;
  const white = whiteness(image);
  const scale = Math.max(1, Math.max(width, height) / ANALYSIS_SIDE);
  const small = shrink(white, width, height, scale);
  const full = { px: white, w: width, h: height };

  // No single way of separating tiles from table suits every photo: a pale
  // table needs a higher cut than a dark one, and a shadow across the table
  // needs the lighting evened out first. The plain cut is right most of the
  // time, so another one only replaces it by covering clearly more tile area
  // (counting tiles would reward a reading that chops tiles into pieces).
  let frames = [];
  let covered = 0;
  for (const px of [small.px, evenLighting(small)]) {
    const low = otsu(px, 0);
    for (const cut of [low, otsu(px, low + 1)]) {
      const found = findTiles(px, cut, small.w, small.h, full, scale);
      const area = found.reduce((sum, f) => sum + f.width * f.length, 0);
      if (area > 1.15 * covered) {
        frames = found;
        covered = area;
      }
    }
  }

  const patches = frames.map((f) => readPatch(f, full));
  const unit = median(patches.flatMap((p) => p.halves.flatMap((h) => h.compact)));

  const tiles = frames.map((f, i) => {
    const [a, b] = patches[i].halves.map((h) => countPips(h, unit));
    return {
      a: Math.min(a.count, maxPips),
      b: Math.min(b.count, maxPips),
      sure: a.sure && b.sure && a.count <= maxPips && b.count <= maxPips,
      corners: cornersOf(f),
      cx: f.cx,
      cy: f.cy,
      length: f.length,
    };
  });

  return { tiles: readingOrder(tiles).map(({ a, b, sure, corners }) => ({ a, b, sure, corners })) };
}

// Tile outlines (centre, long-axis direction, width, length) in full-size pixels.
function findTiles(px, cut, w, h, full, scale) {
  const small = { w, h };
  const mask = new Uint8Array(px.length);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i] > cut ? 1 : 0;

  const minArea = Math.max(60, 0.0006 * small.w * small.h);
  const { labels, blobs } = labelBlobs(mask, small.w, small.h);
  const pipSizes = fillHoles(mask, labels, blobs, small.w, small.h);
  const globalPip = median(pipSizes);

  // A blob running off the edge of the photo is the table or a tile that is
  // cut off; either way it cannot be read.
  const inFrame = (b) =>
    b.top > 0 && b.top + b.rows.length < small.h && b.rows.every((r) => !r || (r[0] > 0 && r[1] < small.w - 1));
  const big = blobs.filter((b) => b.area >= minArea && inFrame(b));
  for (const blob of big) {
    blob.rect = minAreaRect(hullOf(blob));
    blob.pip = blob.pips.length >= 3 ? median(blob.pips) : globalPip;
  }

  // Pass 1: rectangles that parse cleanly as one tile or an aligned group.
  const parsed = [];
  const odd = [];
  for (const blob of big) {
    const filled = blob.area / (blob.rect.long * blob.rect.short);
    const reading = filled >= 0.8 ? readRect(blob.rect, blob.pip, full, scale, 0) : null;
    if (reading) parsed.push({ blob, reading });
    else odd.push(blob);
  }

  // Tiles in one photo are all about the same size; use that to overrule
  // readings that came out at half or double the common width.
  let tileWidth = median(parsed.flatMap((p) => new Array(p.reading.count).fill(p.reading.width)));
  if (tileWidth) {
    for (const p of parsed) {
      if (ratio(p.reading.width, tileWidth) > 1.5) {
        const again = readRect(p.blob.rect, p.blob.pip, full, scale, tileWidth);
        if (again) p.reading = again;
      }
    }
    tileWidth = median(parsed.flatMap((p) => new Array(p.reading.count).fill(p.reading.width)));
  }

  // Pass 2: irregular clumps — tiles touching at an angle. First cut the clump
  // along the dark seams between tiles; then, for whatever is still stuck
  // together, shrink it by a fraction of a tile width, which pulls tiles that
  // only touch at a corner apart into separate cores.
  if (odd.length) {
    const dist = distanceTransform(mask, small.w, small.h);
    for (const blob of odd) {
      const guess = tileWidth || 6.5 * blob.pip;
      const rects = guess ? seamRects(blob, labels, px, small.w, small.h, guess) : [];
      for (const rect of coreRects(blob, labels, dist, small.w, tileWidth)) {
        if (!rects.some((r) => Math.hypot(r.cx - rect.cx, r.cy - rect.cy) < 0.5 * r.short)) rects.push(rect);
      }
      for (const rect of rects) {
        const reading = readRect(rect, blob.pip, full, scale, guess);
        if (reading && reading.count === 1) parsed.push({ blob, reading });
      }
    }
    if (!tileWidth) {
      tileWidth = median(parsed.flatMap((p) => new Array(p.reading.count).fill(p.reading.width)));
    }
  }

  return parsed
    .flatMap((p) => p.reading.tiles)
    .filter((t) => !tileWidth || ratio(t.width, tileWidth) < 1.6)
    .map((t) => ({
      cx: t.cx * scale,
      cy: t.cy * scale,
      ux: t.ux,
      uy: t.uy,
      width: t.width * scale,
      length: t.length * scale,
    }));
}

// ---------------------------------------------------------------- pixels

function whiteness({ data, width, height }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    out[i] = r < g ? (r < b ? r : b) : g < b ? g : b;
  }
  return out;
}

function shrink(px, width, height, scale) {
  if (scale === 1) return { px, w: width, h: height };
  const w = Math.floor(width / scale);
  const h = Math.floor(height / scale);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) sum += px[yy * width + xx];
      }
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { px: out, w, h };
}

// Best cut between two brightness classes, looking only at pixels >= `from`.
function otsu(px, from) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i++) {
    if (px[i] >= from) {
      hist[px[i]]++;
      n++;
    }
  }
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let below = 0;
  let sumBelow = 0;
  let best = 0;
  let cut = from;
  for (let t = from; t < 256; t++) {
    below += hist[t];
    if (!below) continue;
    const above = n - below;
    if (!above) break;
    sumBelow += t * hist[t];
    const gap = sumBelow / below - (total - sumBelow) / above;
    const spread = below * above * gap * gap;
    if (spread > best) {
      best = spread;
      cut = t;
    }
  }
  return cut;
}

// Divide out slow changes in brightness (shadows, a lamp to one side) by
// comparing every pixel with the average of its wide neighbourhood, which is
// mostly table. The table lands near 128 everywhere and tiles above it.
function evenLighting({ px, w, h }) {
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += px[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.round(Math.max(w, h) / 6);
  const out = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      out[y * w + x] = Math.min(255, (128 * (px[y * w + x] + 16)) / (mean + 16));
    }
  }
  return out;
}

function sample(img, x, y) {
  const xi = x < 0 ? 0 : x > img.w - 1 ? img.w - 1 : Math.round(x);
  const yi = y < 0 ? 0 : y > img.h - 1 ? img.h - 1 : Math.round(y);
  return img.px[yi * img.w + xi];
}

// ----------------------------------------------------------------- blobs

// 4-connected so that tiles meeting only at a corner stay separate.
function labelBlobs(mask, w, h) {
  const labels = new Int32Array(w * h);
  const blobs = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = blobs.length + 1;
    const blob = { id, area: 0, top: Math.floor(start / w), rows: [], pips: [] };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      blob.area++;
      const row = (blob.rows[y - blob.top] ??= [x, x]);
      if (x < row[0]) row[0] = x;
      if (x > row[1]) row[1] = x;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) (labels[i - 1] = id), (stack[top++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) (labels[i + 1] = id), (stack[top++] = i + 1);
      if (y > 0 && mask[i - w] && !labels[i - w]) (labels[i - w] = id), (stack[top++] = i - w);
      if (y < h - 1 && mask[i + w] && !labels[i + w]) (labels[i + w] = id), (stack[top++] = i + w);
    }
    blobs.push(blob);
  }
  return { labels, blobs };
}

// Pips, dividers and spinners are dark islands inside a tile. Paint them into
// the blob so its shape is the tile outline, and return the diameters of the
// round ones — pip size is the most reliable clue to how big a tile is.
function fillHoles(mask, labels, blobs, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const diameters = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    const members = [];
    let top = 0;
    let open = false;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      members.push(i);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (x < w - 1 && !mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1);
      if (y > 0 && !mask[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[top++] = i - w);
      if (y < h - 1 && !mask[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[top++] = i + w);
    }
    if (open) continue;
    // In raster order the pixel left of an enclosed island's first pixel
    // always belongs to the blob around it.
    const blob = blobs[labels[start - 1] - 1];
    if (!blob || members.length > 0.08 * blob.area) continue;
    for (const i of members) {
      mask[i] = 1;
      labels[i] = blob.id;
    }
    blob.area += members.length;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const round = Math.max(bw, bh) <= 1.6 * Math.min(bw, bh) && members.length >= 0.6 * bw * bh;
    if (round && members.length >= 6) {
      const d = Math.sqrt((4 * members.length) / Math.PI);
      blob.pips.push(d);
      diameters.push(d);
    }
  }
  return diameters;
}

function hullOf(blob) {
  const pts = [];
  blob.rows.forEach((row, i) => {
    if (!row) return;
    pts.push([row[0], blob.top + i], [row[1] + 1, blob.top + i]);
    pts.push([row[0], blob.top + i + 1], [row[1] + 1, blob.top + i + 1]);
  });
  return convexHull(pts);
}

function convexHull(points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return build(pts).concat(build(pts.reverse()));
}

/** Smallest rotated rectangle around a convex hull: one side always lies on a hull edge. */
function minAreaRect(hull) {
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!len) continue;
    const ex = (q[0] - p[0]) / len;
    const ey = (q[1] - p[1]) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ex + y * ey;
      const v = -x * ey + y * ex;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ex, ey, u0, u1, v0, v1 };
  }
  const { ex, ey, u0, u1, v0, v1 } = best;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const cx = uc * ex - vc * ey;
  const cy = uc * ey + vc * ex;
  const alongU = u1 - u0 >= v1 - v0;
  return {
    cx,
    cy,
    // (ux, uy) points along the long side.
    ux: alongU ? ex : -ey,
    uy: alongU ? ey : ex,
    long: Math.max(u1 - u0, v1 - v0),
    short: Math.min(u1 - u0, v1 - v0),
  };
}

// --------------------------------------------------- rectangles to tiles

// A clean rectangle of tiles is either `n` tiles standing side by side
// (short side = one tile length) or `m` tiles laid end to end (short side =
// one tile width). Both often fit the proportions — a single tile has the
// same outline as four standing side by side — so the tie is broken by, in
// order: the tile width seen elsewhere in the photo, pip size relative to the
// rectangle, and whether a divider line runs along the middle of the long axis.
function readRect(rect, pip, full, scale, knownWidth) {
  const aspect = rect.long / rect.short;
  const n = Math.max(2, Math.round(2 * aspect));
  const m = Math.max(1, Math.round(aspect / 2));
  const fitsSide = Math.abs(2 * aspect - n) / n < 0.2;
  const fitsEnd = Math.abs(aspect / 2 - m) / m < 0.22;
  if (!fitsSide && !fitsEnd) return null;

  let sideBySide;
  if (fitsSide !== fitsEnd) {
    sideBySide = fitsSide;
  } else if (knownWidth) {
    sideBySide = ratio(rect.short / 2, knownWidth) < ratio(rect.short, knownWidth);
  } else {
    const perPip = pip ? rect.short / pip : 0;
    const line = strokeAlong(rect, full, scale).cover;
    if (perPip > 11 || (perPip && perPip < 7.5)) sideBySide = perPip > 11;
    else if (line > 0.7 || line < 0.5) sideBySide = line > 0.7;
    else if (perPip) sideBySide = perPip > 8.8;
    else sideBySide = false;
  }

  // Two tiles side by side make a square, which reads the same turned a
  // quarter: the cross through its middle is one seam and one line of
  // dividers. Dividers are painted, so the darker stroke is taken to be them.
  if (sideBySide && n === 2 && aspect < 1.25) {
    const turned = { ...rect, ux: -rect.uy, uy: rect.ux, long: rect.short, short: rect.long };
    if (strokeAlong(turned, full, scale).depth > strokeAlong(rect, full, scale).depth) rect = turned;
  }

  const count = sideBySide ? n : m;
  const edges = tileEdges(rect, count, sideBySide ? 1 : 2, full, scale);
  const tiles = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const pitch = edges[i + 1] - edges[i];
    const along = (edges[i] + edges[i + 1]) / 2 - rect.long / 2;
    const cx = rect.cx + along * rect.ux;
    const cy = rect.cy + along * rect.uy;
    tiles.push(
      sideBySide
        ? { cx, cy, ux: -rect.uy, uy: rect.ux, width: pitch, length: rect.short }
        : { cx, cy, ux: rect.ux, uy: rect.uy, width: rect.short, length: pitch },
    );
  }
  return { tiles, count: tiles.length, width: median(tiles.map((t) => t.width)) };
}

// Where along the long side does each tile start and end? Dividing the
// rectangle evenly is only right for a camera held square above the table;
// seen at an angle the far tiles are narrower. So walk from one end, one
// expected step at a time, and snap to a seam (or divider) when one is
// visible nearby — each snap also corrects the size of the next step.
// `linesPerTile` is 1 for tiles standing side by side (seams only) and 2 for
// tiles end to end (divider, seam, divider, ...).
function tileEdges(rect, count, linesPerTile, full, scale) {
  const even = Array.from({ length: count + 1 }, (_, i) => (i * rect.long) / count);
  const strokes = crossStrokes(rect, rect.long / count / (linesPerTile === 1 ? 1 : 2), full, scale);
  let step = rect.long / (count * linesPerTile);
  let at = 0;
  const lines = [0];
  while (at + step < rect.long - 0.5 * step) {
    const want = at + step;
    let next = want;
    let nearest = 0.22 * step;
    for (const stroke of strokes) {
      if (Math.abs(stroke - want) <= nearest) {
        nearest = Math.abs(stroke - want);
        next = stroke;
      }
    }
    if (next !== want) step = 0.5 * step + 0.5 * (next - at);
    lines.push(next);
    at = next;
  }
  lines.push(rect.long);
  const edges = lines.filter((_, i) => i % linesPerTile === 0);
  const whole = (lines.length - 1) % linesPerTile === 0;
  const pitches = edges.slice(1).map((e, i) => e - edges[i]);
  const steady = Math.max(...pitches) < 1.7 * Math.min(...pitches);
  return whole && steady && Math.abs(edges.length - 1 - count) <= 1 ? edges : even;
}

// Thin dark strokes running straight across the rectangle (seams between
// tiles, dividers): positions along the long side, in analysis pixels. Each of
// a few dozen scan lines along the rectangle marks where it crosses something
// dark and narrow; a stroke is a position where most scan lines agree. A
// column of pips also darkens a cross-section, but only where the pips are.
function crossStrokes(rect, tileWidth, full, scale) {
  const length = Math.round(rect.long * scale);
  const rows = 40;
  const r = Math.max(2, Math.round(0.045 * tileWidth * scale));
  const slack = Math.max(1, Math.round(0.03 * tileWidth * scale));
  const line = new Float64Array(length);
  const raised = new Float64Array(length);
  const votes = new Float64Array(length + 1);
  for (let row = 0; row < rows; row++) {
    const across = ((row + 0.5) / rows - 0.5) * 0.8 * rect.short * scale;
    const x0 = rect.cx * scale - across * rect.uy;
    const y0 = rect.cy * scale + across * rect.ux;
    for (let i = 0; i < length; i++) {
      const along = i + 0.5 - length / 2;
      line[i] = sample(full, x0 + along * rect.ux, y0 + along * rect.uy);
    }
    for (let i = 0; i < length; i++) {
      let m = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(length - 1, i + r); j++) m = Math.max(m, line[j]);
      raised[i] = m;
    }
    let markedUntil = -1;
    for (let i = 0; i < length; i++) {
      let closed = Infinity;
      for (let j = Math.max(0, i - r); j <= Math.min(length - 1, i + r); j++) closed = Math.min(closed, raised[j]);
      if (closed - line[i] > 0.05 * closed) {
        // one vote per scan line for every position within `slack` of the dip
        const from = Math.max(markedUntil + 1, i - slack);
        const to = Math.min(length - 1, i + slack);
        if (from <= to) {
          votes[from]++;
          votes[to + 1]--;
          markedUntil = to;
        }
      }
    }
  }
  const strokes = [];
  let running = 0;
  let runStart = -1;
  for (let i = 0; i <= length; i++) {
    running += votes[i];
    const agreed = i < length && running >= 0.7 * rows;
    if (agreed && runStart < 0) runStart = i;
    if (!agreed && runStart >= 0) {
      strokes.push((runStart + i) / 2 / scale);
      runStart = -1;
    }
  }
  return strokes;
}

// How much of the long centre line is a thin dark stroke (`cover`, 0..1), and
// how dark is it (`depth`, 0..1)? Standing tiles put their dividers end to end
// along it; a single tile only crosses a few pips.
function strokeAlong(rect, full, scale) {
  const band = Math.max(1, 0.04 * rect.short * scale);
  const reach = Math.max(band + 2, 0.15 * rect.short * scale);
  const steps = 80;
  let dark = 0;
  let depth = 0;
  for (let s = 0; s < steps; s++) {
    const along = ((s + 0.5) / steps - 0.5) * 0.9 * rect.long * scale;
    const x = rect.cx * scale + along * rect.ux;
    const y = rect.cy * scale + along * rect.uy;
    let lowest = 255;
    let brightest = 1;
    for (let t = -reach; t <= reach; t++) {
      const v = sample(full, x - t * rect.uy, y + t * rect.ux);
      if (v > brightest) brightest = v;
      if (Math.abs(t) <= band && v < lowest) lowest = v;
    }
    if (lowest < 0.88 * brightest) dark++;
    depth += 1 - lowest / brightest;
  }
  return { cover: dark / steps, depth: depth / steps };
}

// Two-pass 3-4 chamfer distance to the nearest non-tile pixel (in thirds of a pixel).
function distanceTransform(mask, w, h) {
  const d = new Int32Array(w * h);
  const far = 1 << 20;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        d[i] = mask[i] ? 3 : 0;
        continue;
      }
      d[i] = Math.min(far, d[i - 1] + 3, d[i - w] + 3, d[i - w - 1] + 4, d[i - w + 1] + 4);
    }
  }
  for (let y = h - 2; y > 0; y--) {
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      d[i] = Math.min(d[i], d[i + 1] + 3, d[i + w] + 3, d[i + w + 1] + 4, d[i + w - 1] + 4);
    }
  }
  return d;
}

function coreRects(blob, labels, dist, w, tileWidth) {
  let deepest = 0;
  forEachPixel(blob, labels, w, (i) => {
    if (dist[i] > deepest) deepest = dist[i];
  });
  // Without a known tile size, the deepest point of the clump is about half a
  // tile width from the edge.
  const depth = Math.round(tileWidth ? 0.3 * tileWidth * 3 : 0.6 * deepest);
  if (depth < 6) return [];

  const core = new Map();
  forEachPixel(blob, labels, w, (i) => {
    if (dist[i] > depth) core.set(i, 0);
  });
  const rects = [];
  for (const start of core.keys()) {
    if (core.get(start)) continue;
    const piece = { top: Math.floor(start / w), rows: [], area: 0 };
    const stack = [start];
    core.set(start, 1);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      if (y < piece.top) {
        piece.rows = new Array(piece.top - y).concat(piece.rows);
        piece.top = y;
      }
      piece.area++;
      const row = (piece.rows[y - piece.top] ??= [x, x]);
      if (x < row[0]) row[0] = x;
      if (x > row[1]) row[1] = x;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (core.get(j) === 0) {
          core.set(j, 1);
          stack.push(j);
        }
      }
    }
    if (piece.area < 12) continue;
    const rect = minAreaRect(hullOf(piece));
    if (piece.area < 0.75 * rect.long * rect.short) continue;
    const grow = (2 * depth) / 3;
    rects.push({ ...rect, long: rect.long + grow, short: rect.short + grow });
  }
  return rects;
}

// Split a clump along thin dark lines. "Thin and dark" is whatever a
// morphological closing a little wider than a seam paints over; pips and
// dividers qualify too, which is harmless because only the outline of each
// remaining piece is used. Pieces shaped like one tile are returned.
function seamRects(blob, labels, px, w, h, tileWidth) {
  const k = Math.max(2, Math.round(0.1 * tileWidth));
  let left = w;
  let right = 0;
  for (const row of blob.rows) {
    if (!row) continue;
    left = Math.min(left, row[0]);
    right = Math.max(right, row[1]);
  }
  const x0 = Math.max(0, left - k);
  const y0 = Math.max(0, blob.top - k);
  const bw = Math.min(w, right + k + 1) - x0;
  const bh = Math.min(h, blob.top + blob.rows.length + k) - y0;
  const local = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) local[y * bw + x] = px[(y + y0) * w + x + x0];
  }
  const closed = slide(slide(local, bw, bh, k, Math.max), bw, bh, k, Math.min);

  const piece = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const inBlob = labels[(y + y0) * w + x + x0] === blob.id;
      piece[i] = inBlob && closed[i] - local[i] <= 0.06 * closed[i] ? 1 : 0;
    }
  }
  const rects = [];
  for (const part of labelBlobs(piece, bw, bh).blobs) {
    if (part.area < 0.5 * tileWidth * tileWidth) continue;
    const hull = hullOf(part);
    const rect = minAreaRect(hull);
    const tileShaped =
      ratio(rect.short, tileWidth) < 1.35 &&
      rect.long / rect.short > 1.6 &&
      rect.long / rect.short < 2.5 &&
      polygonArea(hull) > 0.88 * rect.long * rect.short;
    if (tileShaped) rects.push({ ...rect, cx: rect.cx + x0, cy: rect.cy + y0, long: rect.long + 1, short: rect.short + 1 });
  }
  return rects;
}

// Running max (or min) over a (2k+1) square window, one axis at a time.
function slide(src, w, h, k, pick) {
  const pass = (from, stride, lines, len) => {
    const to = new Uint8Array(from.length);
    for (let line = 0; line < lines; line++) {
      const base = stride === 1 ? line * len : line;
      for (let i = 0; i < len; i++) {
        let v = from[base + i * stride];
        for (let j = Math.max(0, i - k); j <= Math.min(len - 1, i + k); j++) v = pick(v, from[base + j * stride]);
        to[base + i * stride] = v;
      }
    }
    return to;
  };
  return pass(pass(src, 1, h, w), w, w, h);
}

function polygonArea(pts) {
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2;
}

function forEachPixel(blob, labels, w, fn) {
  blob.rows.forEach((row, r) => {
    if (!row) return;
    const base = (blob.top + r) * w;
    for (let x = row[0]; x <= row[1]; x++) {
      if (labels[base + x] === blob.id) fn(base + x);
    }
  });
}

// ------------------------------------------------------------------ pips

// Straighten a tile into a P x 2P patch and find the dark spots in each half.
function readPatch(frame, full) {
  const P = Math.max(40, Math.min(110, Math.round(frame.width)));
  const patch = new Uint8Array(P * 2 * P);
  const vx = -frame.uy;
  const vy = frame.ux;
  for (let j = 0; j < 2 * P; j++) {
    const along = ((j + 0.5) / (2 * P) - 0.5) * frame.length;
    for (let i = 0; i < P; i++) {
      const across = ((i + 0.5) / P - 0.5) * frame.width;
      patch[j * P + i] = sample(
        full,
        frame.cx + along * frame.ux + across * vx,
        frame.cy + along * frame.uy + across * vy,
      );
    }
  }
  return { halves: [readHalf(patch, P, 0), readHalf(patch, P, 1)] };
}

function readHalf(patch, P, which) {
  // Stay clear of the tile rim and of the divider and its spinner.
  const x0 = Math.round(0.05 * P);
  const x1 = Math.round(0.95 * P);
  const outer = Math.round(0.04 * P);
  const inner = Math.round(0.92 * P);
  const y0 = which === 0 ? outer : 2 * P - inner;
  const y1 = which === 0 ? inner : 2 * P - outer;

  const hist = new Int32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[patch[y * P + x]]++;
  const pixels = (y1 - y0) * (x1 - x0);
  let face = 255;
  for (let seen = 0; face > 0; face--) {
    seen += hist[face];
    if (seen >= 0.2 * pixels) break;
  }
  const dark = 0.78 * face;

  const seen = new Uint8Array(patch.length);
  const spots = [];
  const stack = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const start = y * P + x;
      if (seen[start] || patch[start] >= dark) continue;
      let area = 0;
      let bx0 = x;
      let bx1 = x;
      let by0 = y;
      let by1 = y;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        const px = i % P;
        const py = (i - px) / P;
        area++;
        if (px < bx0) bx0 = px;
        if (px > bx1) bx1 = px;
        if (py < by0) by0 = py;
        if (py > by1) by1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
            const j = ny * P + nx;
            if (!seen[j] && patch[j] < dark) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
      const bw = bx1 - bx0 + 1;
      const bh = by1 - by0 + 1;
      const stretch = Math.max(bw, bh) / Math.min(bw, bh);
      const onEdge = bx0 === x0 || bx1 === x1 - 1 || by0 === y0 || by1 === y1 - 1;
      // Long thin marks hugging the border are rim shadow or divider, not pips.
      if (stretch > 2.6 || (onEdge && stretch > 1.8)) continue;
      spots.push({ area: area / (P * P), round: stretch <= 1.5 && area >= 0.55 * bw * bh });
    }
  }
  // Spot sizes as a fraction of the half; well-formed ones calibrate what one
  // pip looks like in this photo.
  const compact = spots.filter((s) => s.round && s.area > 0.0025 && s.area < 0.08).map((s) => s.area);
  return { spots, compact };
}

function countPips(half, unit) {
  if (!unit) return { count: 0, sure: true };
  let count = 0;
  let sure = true;
  for (const spot of half.spots) {
    if (spot.area < 0.45 * unit) continue;
    const pips = Math.round(spot.area / unit);
    if (pips > 3) {
      sure = false; // a shadow or smear, too big to be touching pips
      continue;
    }
    if (pips !== 1 || !spot.round) sure = false;
    count += Math.max(1, pips);
  }
  return { count, sure };
}

// ----------------------------------------------------------------- output

function cornersOf(f) {
  const hx = (f.ux * f.length) / 2;
  const hy = (f.uy * f.length) / 2;
  const wx = (-f.uy * f.width) / 2;
  const wy = (f.ux * f.width) / 2;
  return [
    [f.cx - hx - wx, f.cy - hy - wy],
    [f.cx - hx + wx, f.cy - hy + wy],
    [f.cx + hx + wx, f.cy + hy + wy],
    [f.cx + hx - wx, f.cy + hy - wy],
  ];
}

// Left to right, top to bottom, so the hand lists tiles the way the photo shows them.
function readingOrder(tiles) {
  const byY = tiles.slice().sort((p, q) => p.cy - q.cy);
  const rows = [];
  for (const t of byY) {
    const row = rows[rows.length - 1];
    if (row && t.cy - row.cy < 0.6 * t.length) {
      row.tiles.push(t);
      row.cy = (row.cy * (row.tiles.length - 1) + t.cy) / row.tiles.length;
    } else {
      rows.push({ cy: t.cy, tiles: [t] });
    }
  }
  return rows.flatMap((r) => r.tiles.sort((p, q) => p.cx - q.cx));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function ratio(a, b) {
  return a > b ? a / b : b / a;
}
