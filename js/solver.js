// Mexican Train solver.
//
// A hand of dominoes is a multigraph: every pip value is a node and every tile
// is an edge between its two values (a double is a self-loop). A train is a
// trail through that graph — a walk that uses each tile at most once. Finding
// the longest one is NP-hard in general, but hands are small, so an exact
// branch-and-bound search finishes instantly for anything a person can hold.

const TILE_WEIGHT = 100000;

/**
 * @typedef {[number, number]} Tile
 * @typedef {{start: number, tiles: Tile[]}} Train  tiles are oriented: tiles[i][1] === tiles[i+1][0]
 * @typedef {{trains: Train[], used: number, pips: number, leftover: Tile[], leftoverPips: number}} Plan
 */

/**
 * Find the best way to lay tiles from `hand` onto trains starting at `starts`.
 *
 * @param {Tile[]} hand
 * @param {number[]} starts      open ends you may build from; starts[0] is your own train
 * @param {object} [opts]
 * @param {'tiles'|'pips'} [opts.objective]  maximise tiles played (default) or pips played
 * @param {number} [opts.maxAlternatives]    how many equally good plans to return
 * @param {number} [opts.timeLimitMs]        search budget; the best plan found so far is returned
 * @returns {{best: Plan, alternatives: Plan[], exact: boolean}}
 */
export function solve(hand, starts, opts = {}) {
  const objective = opts.objective === 'pips' ? 'pips' : 'tiles';
  const maxAlternatives = Math.max(1, opts.maxAlternatives ?? 6);
  const timeLimitMs = opts.timeLimitMs ?? 1500;

  const tiles = hand.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  const n = Math.max(0, ...tiles.flat(), ...starts) + 1;
  const weightOf = (a, b) =>
    objective === 'tiles' ? TILE_WEIGHT + a + b : (a + b) * TILE_WEIGHT + 1;

  // count[a * n + b] = unplayed tiles joining a and b (kept symmetric).
  const count = new Int16Array(n * n);
  for (const [a, b] of tiles) {
    count[a * n + b]++;
    if (a !== b) count[b * n + a]++;
  }

  let deadline = Date.now() + timeLimitMs;
  let ticks = 0;
  let timedOut = false;

  let bestScore = -1;
  /** @type {Map<string, number[][]>} tile-set key -> node paths, one per start */
  let bestPlans = new Map();

  const paths = starts.map((s) => [s]);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const lightest = [];

  // Upper bound on what can still be scored. Only tiles connected to an open
  // end are reachable at all, and a connected group with 2k odd-degree values
  // needs k trails to be used up completely — with j open ends in the group,
  // at least k - j tiles must stay behind.
  function bound(trainIdx, here) {
    seen.fill(0);
    let total = 0;
    for (let t = trainIdx; t < starts.length; t++) {
      const root = t === trainIdx ? here : starts[t];
      if (seen[root]) continue;
      let ends = 0;
      for (let u = trainIdx; u < starts.length; u++) {
        if ((u === trainIdx ? here : starts[u]) === root) ends++;
      }
      let top = 0;
      let odd = 0;
      let sum = 0;
      lightest.length = 0;
      stack[top++] = root;
      seen[root] = 1;
      while (top) {
        const v = stack[--top];
        let degree = 0;
        for (let w = 0; w < n; w++) {
          const c = count[v * n + w];
          if (!c) continue;
          if (w === v) {
            sum += c * weightOf(v, v);
            for (let i = 0; i < c; i++) lightest.push(weightOf(v, v));
            continue;
          }
          degree += c;
          if (w > v) {
            sum += c * weightOf(v, w);
            for (let i = 0; i < c; i++) lightest.push(weightOf(v, w));
          }
          if (!seen[w]) {
            seen[w] = 1;
            stack[top++] = w;
            for (let u = trainIdx + 1; u < starts.length; u++) {
              if (starts[u] === w) ends++;
            }
          }
        }
        if (degree & 1) odd++;
      }
      const mustDrop = odd / 2 - ends;
      if (mustDrop > 0) {
        lightest.sort((x, y) => x - y);
        for (let i = 0; i < mustDrop; i++) sum -= lightest[i];
      }
      total += sum;
    }
    return total;
  }

  function record(score) {
    if (score < bestScore) return;
    if (score > bestScore) {
      bestScore = score;
      bestPlans = new Map();
    }
    if (bestPlans.size >= wanted) return;
    const key = planKey(paths);
    if (!bestPlans.has(key)) bestPlans.set(key, paths.map((p) => p.slice()));
  }

  function play(trainIdx, here, next, score) {
    const w = weightOf(here, next);
    count[here * n + next]--;
    if (here !== next) count[next * n + here]--;
    paths[trainIdx].push(next);
    search(trainIdx, next, score + w);
    paths[trainIdx].pop();
    count[here * n + next]++;
    if (here !== next) count[next * n + here]++;
  }

  function search(trainIdx, here, score) {
    if ((++ticks & 1023) === 0 && Date.now() > deadline) timedOut = true;
    if (timedOut) return;

    const reachable = score + bound(trainIdx, here);
    if (reachable < bestScore) return;
    if (reachable === bestScore && bestPlans.size >= wanted) return;

    // A double never changes where the train is, so playing it the moment its
    // value comes up is always at least as good as holding it.
    if (count[here * n + here]) {
      play(trainIdx, here, here, score);
      return;
    }

    for (let next = n - 1; next >= 0; next--) {
      if (next !== here && count[here * n + next]) play(trainIdx, here, next, score);
    }

    if (trainIdx + 1 < starts.length) {
      // Stop this train here and build the next one from what is left.
      search(trainIdx + 1, starts[trainIdx + 1], score);
    } else {
      record(score);
    }
  }

  // Pass 1 proves the optimum, keeping a single plan so ties are pruned hard.
  // Pass 2 re-walks only the branches that can tie it to collect alternatives;
  // running out of time there costs variety, not correctness.
  let wanted = 1;
  let exact = true;
  if (starts.length) {
    search(0, starts[0], 0);
    exact = !timedOut;
    if (exact && maxAlternatives > 1) {
      wanted = maxAlternatives;
      deadline = Date.now() + Math.min(400, timeLimitMs);
      search(0, starts[0], 0);
    }
  }

  const plans = [...bestPlans.values()].map((p) => toPlan(p, starts, tiles));
  if (!plans.length) plans.push(toPlan(starts.map((s) => [s]), starts, tiles));
  plans.sort(comparePlans);
  return { best: plans[0], alternatives: plans.slice(1), exact };
}

// Two plans that put the same tiles on the same trains in a different order
// are the same answer as far as the player is concerned.
function planKey(paths) {
  return paths
    .map((p) => {
      const edges = [];
      for (let i = 1; i < p.length; i++) {
        edges.push(Math.min(p[i - 1], p[i]) * 100 + Math.max(p[i - 1], p[i]));
      }
      return edges.sort((a, b) => a - b).join(',');
    })
    .join('|');
}

function toPlan(nodePaths, starts, tiles) {
  const remaining = new Map();
  for (const [a, b] of tiles) {
    const k = a * 100 + b;
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  let used = 0;
  let pips = 0;
  const trains = nodePaths.map((p, i) => {
    const out = [];
    for (let j = 1; j < p.length; j++) {
      out.push([p[j - 1], p[j]]);
      const k = Math.min(p[j - 1], p[j]) * 100 + Math.max(p[j - 1], p[j]);
      remaining.set(k, remaining.get(k) - 1);
      used++;
      pips += p[j - 1] + p[j];
    }
    return { start: starts[i], tiles: out };
  });
  const leftover = [];
  let leftoverPips = 0;
  for (const [k, c] of remaining) {
    for (let i = 0; i < c; i++) {
      const a = Math.floor(k / 100);
      const b = k % 100;
      leftover.push([a, b]);
      leftoverPips += a + b;
    }
  }
  leftover.sort((x, y) => y[0] + y[1] - (x[0] + x[1]));
  return { trains, used, pips, leftover, leftoverPips };
}

// Among equally scored plans prefer the one that does not strand an open
// double at the end of a train, then the one that puts more on your own train.
function comparePlans(a, b) {
  const openDoubles = (p) =>
    p.trains.filter((t) => t.tiles.length && isDouble(t.tiles[t.tiles.length - 1])).length;
  return (
    openDoubles(a) - openDoubles(b) ||
    b.trains[0].tiles.length - a.trains[0].tiles.length
  );
}

export function isDouble(tile) {
  return tile[0] === tile[1];
}

/** True when `train` is a legal chain from its start using only tiles in `hand`. */
export function isValidPlan(plan, hand) {
  const remaining = new Map();
  for (const [a, b] of hand) {
    const k = Math.min(a, b) * 100 + Math.max(a, b);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  for (const train of plan.trains) {
    let end = train.start;
    for (const [a, b] of train.tiles) {
      if (a !== end) return false;
      const k = Math.min(a, b) * 100 + Math.max(a, b);
      if (!remaining.get(k)) return false;
      remaining.set(k, remaining.get(k) - 1);
      end = b;
    }
  }
  return true;
}
