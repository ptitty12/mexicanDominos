# Mexican Train Solver

A small website: photograph your dominoes, and it works out the longest train
you can lay.

Everything runs in the browser. The photo is never uploaded, there is no
server and nothing to install.

## Using it

1. **Your dominoes** — take or choose a photo. Each tile it finds is outlined
   on the photo with the pips it read, and listed underneath. Tap any tile to
   correct it, or `+` to add one it missed.
2. **The table** — pick the set (double-six to double-eighteen), the number
   your train starts at (the round's engine, or your train's open end), and
   optionally any other ends you may play on: the Mexican train, or another
   player's open train.
3. **Best play** — the best plan, tile by tile, what is left in your hand,
   and any other plans that are exactly as good.

"Best" is either the most tiles played or the most points played; when two
plans tie on one they are ranked by the other.

### Getting a good photo

The reader is plain image processing, not a trained model, so it wants a clear
picture:

- tiles **face up** on a **plain surface darker than the tiles**, all fully
  inside the frame
- a small gap between tiles is best; a neat row of touching tiles, or tiles
  end to end, also works
- shoot from roughly overhead, without glare or hard shadows

It expects light tiles with dark or coloured pips. Tiles in a loose pile
touching at odd angles, dark tiles with white pips, and busy tablecloths are
unreliable — which is why every reading can be fixed by hand.

## Running it

It is a static site with no build step:

```sh
npm start        # serves the folder at http://localhost:8000
npm test         # solver and detector tests (Node 20+, no dependencies)
```

To host it on a VPS with Dokploy (how `dominos.ptaylor.dev` is set up), follow
[`docs/DEPLOY_DOKPLOY.md`](docs/DEPLOY_DOKPLOY.md). Any other static host
works too: serve the repository root.

## How it works

| File | What it does |
| --- | --- |
| `js/solver.js` | A hand is a multigraph (pip values are nodes, tiles are edges), a train is a trail through it. An exact branch-and-bound search finds the best trail from each open end; it is checked against brute force in the tests. Hands past ~25 tiles can hit the one-second budget, and the page says so when they do. |
| `js/detect.js` | Finds tiles and counts pips: brightness segmentation, rotated-rectangle fitting, splitting of touching tiles along seams, then pip counting in each straightened half. |
| `js/domino.js` | Draws tiles as SVG. |
| `js/app.js` | The page: photo handling, the editable hand, settings, results. |

### Tuning the detector

`tools/make_test_photos.py` (needs Pillow and NumPy) renders synthetic photos
with known contents — different layouts, tables, lighting, blur and camera
tilt — and `tools/eval_detect.mjs` scores the detector against them:

```sh
python3 tools/make_test_photos.py /tmp/photos 10
node tools/eval_detect.mjs /tmp/photos
```

These are renders, not real photographs, so treat the scores as a regression
check rather than a promise about any particular camera and table.
