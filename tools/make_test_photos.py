#!/usr/bin/env python3
"""Render synthetic "photos" of domino hands with known contents.

Real sample photos are the better test, but these give the detector a
repeatable regression set: tiles are drawn with rounded corners, coloured
pips, a divider and spinner, then laid out, shadowed, blurred, unevenly lit,
noised and JPEG-compressed.

    python3 tools/make_test_photos.py OUT_DIR [COUNT_PER_LAYOUT] [FIRST_SEED]

Each case writes NAME.png (to look at), NAME.rgba (width, height as uint32 LE
followed by RGBA bytes, for the node test) and NAME.json (the tiles in it).
"""
import io
import json
import math
import random
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PIP_COLORS = {
    1: (40, 160, 225), 2: (20, 150, 75), 3: (215, 35, 45), 4: (130, 80, 45),
    5: (25, 60, 165), 6: (245, 200, 10), 7: (205, 70, 150), 8: (0, 125, 115),
    9: (105, 45, 145), 10: (240, 120, 25), 11: (25, 25, 25), 12: (120, 120, 125),
    13: (150, 30, 60), 14: (90, 140, 40), 15: (60, 60, 90),
    16: (180, 100, 100), 17: (40, 90, 90), 18: (90, 60, 30),
}
LIGHT_BACKGROUNDS = [(205, 175, 135), (190, 190, 185), (215, 200, 170)]
BACKGROUNDS = [
    (150, 105, 60), (96, 62, 38), (35, 95, 60), (40, 44, 52), (30, 55, 110),
    (120, 30, 35), (95, 95, 100), (176, 140, 98),
]


def pip_layout(n):
    """Pip centres in a unit square, three columns like a real double-12 set."""
    if n == 0:
        return []
    if n == 1:
        return [(0.5, 0.5)]
    if n == 2:
        return [(0.25, 0.25), (0.75, 0.75)]
    if n == 3:
        return [(0.25, 0.25), (0.5, 0.5), (0.75, 0.75)]
    rows = 3 if n <= 9 else 4 if n <= 12 else 5 if n <= 15 else 6
    side = min(rows, n // 2)
    mid = n - 2 * side
    lo, hi = (0.22, 0.78) if rows <= 3 else (0.16, 0.84)

    def column(k):
        if k == 1:
            return [0.5]
        return [lo + (hi - lo) * i / (k - 1) for i in range(k)]

    pts = [(x, y) for x in (0.22, 0.78) for y in column(side)]
    pts += [(0.5, y) for y in column(mid)] if mid else []
    return pts


def draw_tile(a, b, w, rng, spinner=True, faint=False):
    """An upright tile sprite (w x 2w) with `a` on top; RGBA, supersampled."""
    ss = 4
    W, H = w * ss, 2 * w * ss
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    base = tuple(int(c + rng.uniform(-6, 4)) for c in (247, 243, 230))
    radius = int(0.09 * W)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius, fill=(205, 200, 185, 255))
    rim = int(0.018 * W)
    d.rounded_rectangle((rim, rim, W - 1 - rim, H - 1 - rim), radius - rim, fill=base + (255,))
    line = max(2, int(0.022 * W))
    d.rectangle((int(0.08 * W), H // 2 - line // 2, int(0.92 * W), H // 2 + line // 2),
                fill=(190, 185, 172, 255) if faint else (70, 66, 60, 255))
    max_pips = max(a, b)
    pip_r = (0.075 if max_pips <= 9 else 0.066 if max_pips <= 12 else 0.055) * W
    for value, top in ((a, 0), (b, H // 2)):
        for (x, y) in pip_layout(value):
            cx, cy = x * W, top + (0.06 + 0.88 * y) * W
            col = PIP_COLORS[value]
            d.ellipse((cx - pip_r, cy - pip_r, cx + pip_r, cy + pip_r), fill=col + (255,))
            # glossy highlight, as on real painted pips
            hr = pip_r * 0.28
            hx, hy = cx - pip_r * 0.3, cy - pip_r * 0.3
            light = tuple(min(255, c + 90) for c in col)
            d.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=light + (255,))
    if spinner:
        r = 0.05 * W
        d.ellipse((W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r), fill=(165, 140, 80, 255))
    return img.resize((w, 2 * w), Image.LANCZOS)


def background(size, rng):
    W, H = size
    col = np.array(rng.choice(BACKGROUNDS), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.ones((H, W, 3), np.float32) * col
    if rng.random() < 0.5:  # wood-ish grain
        grain = np.sin(yy / rng.uniform(3, 9) + np.sin(xx / 130.0) * 3) * rng.uniform(4, 12)
        img += grain[..., None]
    return img


def paste(canvas, shadow, sprite, cx, cy, angle):
    rot = sprite.rotate(angle, expand=True, resample=Image.BICUBIC)
    x, y = int(cx - rot.width / 2), int(cy - rot.height / 2)
    alpha = rot.split()[3]
    shadow.paste(255, (x + 5, y + 7), alpha)
    canvas.append((rot, x, y))


def tile_corners(cx, cy, w, angle):
    t = math.radians(-angle)
    out = []
    for dx, dy in ((-w / 2, -w), (w / 2, -w), (w / 2, w), (-w / 2, w)):
        out.append((cx + dx * math.cos(t) - dy * math.sin(t), cy + dx * math.sin(t) + dy * math.cos(t)))
    return out


def perspective(img, rng, strength):
    """Tilt the camera: squeeze one edge of the frame."""
    W, H = img.size
    k = strength * rng.uniform(0.5, 1.0)
    dx, dy = k * W, k * H * rng.uniform(0, 0.6)
    quads = [
        (dx, dy, 0, H, W, H, W - dx, dy),          # far edge at the top
        (0, 0, dx, H - dy, W - dx, H - dy, W, 0),  # far edge at the bottom
    ]
    dst = rng.choice(quads)
    src = (0, 0, 0, H, W, H, W, 0)
    # solve the 8 coefficients mapping output -> input
    A, B = [], []
    for (x, y), (u, v) in zip(zip(dst[0::2], dst[1::2]), zip(src[0::2], src[1::2])):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    coeffs = np.linalg.solve(np.array(A, float), np.array(B, float))
    fwd = np.linalg.inv(np.append(coeffs, 1).reshape(3, 3))

    def move(pt):
        x, y, z = fwd @ np.array([pt[0], pt[1], 1.0])
        return (x / z, y / z)

    edge = img.resize((1, 1), Image.BOX).getpixel((0, 0))
    return img.transform((W, H), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC, fillcolor=edge), move


def make_case(seed, layout, max_pips=12, count=None, size=(1600, 1200), hard=False, tiles=None):
    rng = random.Random(seed)
    W, H = size
    tiles = list(tiles or [])
    count = len(tiles) or count or rng.randint(6, 15)
    while len(tiles) < count:
        a, b = rng.randint(0, max_pips), rng.randint(0, max_pips)
        if (min(a, b), max(a, b)) not in [(min(x), max(x)) for x in tiles]:
            tiles.append((a, b))
    spinner = rng.random() < 0.6
    faint = hard and rng.random() < 0.5
    placements = []  # (a, b, cx, cy, w, angle)

    if layout == 'scatter':
        w = rng.randint(100, 130)
        tries = 0
        while len(placements) < count and tries < 5000:
            tries += 1
            cx, cy = rng.uniform(1.3 * w, W - 1.3 * w), rng.uniform(1.3 * w, H - 1.3 * w)
            if all(math.hypot(cx - p[2], cy - p[3]) > 2.4 * w for p in placements):
                a, b = tiles[len(placements)]
                placements.append((a, b, cx, cy, w, rng.uniform(0, 360)))
    elif layout == 'clump':
        # loose pile: tiles roughly upright, some touching their neighbours
        w = rng.randint(95, 120)
        cols = math.ceil(count / 2)
        for i, (a, b) in enumerate(tiles):
            r, c = divmod(i, cols)
            cx = W / 2 + (c - (cols - 1) / 2) * (w + rng.uniform(-1, 14))
            cy = H / 2 + (r - 0.5) * (2 * w + rng.uniform(0, 30)) + rng.uniform(-25, 25)
            placements.append((a, b, cx, cy, w, rng.uniform(-9, 9) + rng.choice([0, 180])))
    elif layout in ('row', 'spaced-row', 'two-rows'):
        rows = 2 if layout == 'two-rows' else 1
        per_row = math.ceil(count / rows)
        gap = rng.randint(8, 22) if layout == 'spaced-row' else rng.choice([0, 0, 1])
        w = min(150, int((W - 120) / per_row) - gap)
        tilt = rng.uniform(-6, 6)
        t = math.radians(-tilt)
        for i, (a, b) in enumerate(tiles):
            r, c = divmod(i, per_row)
            n_here = min(per_row, count - r * per_row)
            dx = (c - (n_here - 1) / 2) * (w + gap)
            dy = (r - (rows - 1) / 2) * (2 * w + 60)
            cx = W / 2 + dx * math.cos(t) - dy * math.sin(t)
            cy = H / 2 + dx * math.sin(t) + dy * math.cos(t)
            placements.append((a, b, cx, cy, w, tilt + rng.choice([0, 180])))
    elif layout == 'line':
        count = min(count, 7)
        tiles = tiles[:count]
        gap = rng.choice([0, 1, 12])
        w = min(120, int((W - 120) / count / 2) - gap)
        tilt = rng.uniform(-5, 5)
        t = math.radians(-tilt)
        for i, (a, b) in enumerate(tiles):
            dx = (i - (count - 1) / 2) * (2 * w + gap)
            placements.append((a, b, W / 2 + dx * math.cos(t), H / 2 + dx * math.sin(t), w,
                               tilt + rng.choice([90, 270])))
    else:
        raise ValueError(layout)

    bg = background(size, rng)
    if hard and rng.random() < 0.35:
        bg = bg * 0 + np.array(rng.choice(LIGHT_BACKGROUNDS), np.float32)
    canvas, shadow = [], Image.new('L', size, 0)
    for (a, b, cx, cy, w, angle) in placements:
        paste(canvas, shadow, draw_tile(a, b, w, rng, spinner, faint), cx, cy, angle)
    shadow = np.asarray(shadow.filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    bg *= (1 - 0.45 * shadow)[..., None]
    img = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).convert('RGBA')
    for rot, x, y in canvas:
        img.alpha_composite(rot, (x, y))
    arr = np.asarray(img.convert('RGB'), np.float32)

    # uneven lighting, warm or cool cast
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ang = rng.uniform(0, 2 * math.pi)
    ramp = (xx / W - 0.5) * math.cos(ang) + (yy / H - 0.5) * math.sin(ang)
    arr *= (1 + rng.uniform(0.1, 0.35) * ramp)[..., None] * rng.uniform(0.8, 1.0)
    arr *= np.array([rng.uniform(0.92, 1.0), rng.uniform(0.9, 1.0), rng.uniform(0.78, 1.0)], np.float32)
    if hard and rng.random() < 0.5:  # a soft shadow falling across part of the table
        edge = rng.uniform(0.25, 0.75) * W
        arr *= (1 - 0.3 / (1 + np.exp(-(xx - edge) / 40.0)))[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    move = lambda pt: pt
    if hard:
        img, move = perspective(img, rng, 0.1)
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 1.8 if hard else 1.3)))
    arr = np.asarray(img, np.float32) + np.random.default_rng(seed).normal(0, rng.uniform(2, 6), (H, W, 3))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=rng.randint(70, 90))
    img = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')

    truth = [{'a': a, 'b': b, 'corners': [move(c) for c in tile_corners(cx, cy, w, angle)]}
             for (a, b, cx, cy, w, angle) in placements]
    return img, truth


def main():
    out = Path(sys.argv[1])
    per_layout = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    out.mkdir(parents=True, exist_ok=True)
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    for layout in ('scatter', 'spaced-row', 'row', 'two-rows', 'line', 'clump'):
        for i in range(per_layout):
            seed += 1
            max_pips = [12, 12, 9, 6][i % 4]
            hard = i % 2 == 1 or layout == 'clump'
            img, truth = make_case(seed, layout, max_pips, hard=hard)
            name = f"{layout}-{i}-d{max_pips}{'-hard' if hard else ''}"
            img.save(out / f'{name}.png')
            rgba = img.convert('RGBA')
            (out / f'{name}.rgba').write_bytes(struct.pack('<II', *rgba.size) + rgba.tobytes())
            (out / f'{name}.json').write_text(json.dumps({'layout': layout, 'maxPips': max_pips, 'tiles': truth}))
            print(name, len(truth))


if __name__ == '__main__':
    main()
