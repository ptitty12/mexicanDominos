import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, isValidPlan } from '../js/solver.js';

// Exhaustive reference: try every trail, no pruning.
function bruteForce(hand, starts, objective) {
  const used = new Array(hand.length).fill(false);
  const value = (t) => (objective === 'pips' ? (t[0] + t[1]) * 100000 + 1 : 100000 + t[0] + t[1]);
  let best = 0;
  function go(trainIdx, end, score) {
    if (score > best) best = score;
    for (let i = 0; i < hand.length; i++) {
      if (used[i]) continue;
      const [a, b] = hand[i];
      if (a !== end && b !== end) continue;
      used[i] = true;
      go(trainIdx, a === end ? b : a, score + value(hand[i]));
      used[i] = false;
    }
    if (trainIdx + 1 < starts.length) go(trainIdx + 1, starts[trainIdx + 1], score);
  }
  if (starts.length) go(0, starts[0], 0);
  return best;
}

const score = (plan, objective) =>
  objective === 'pips' ? plan.pips * 100000 + plan.used : plan.used * 100000 + plan.pips;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('plays a simple chain in order', () => {
  const { best } = solve([[12, 5], [5, 3], [3, 3], [9, 1]], [12]);
  assert.deepEqual(best.trains[0].tiles, [[12, 5], [5, 3], [3, 3]]);
  assert.equal(best.used, 3);
  assert.deepEqual(best.leftover, [[1, 9]]);
  assert.equal(best.leftoverPips, 10);
});

test('nothing playable leaves the whole hand', () => {
  const { best, exact } = solve([[1, 2], [3, 4]], [12]);
  assert.equal(best.used, 0);
  assert.equal(best.leftover.length, 2);
  assert.equal(exact, true);
});

test('empty hand', () => {
  const { best } = solve([], [12]);
  assert.equal(best.used, 0);
  assert.deepEqual(best.trains[0].tiles, []);
});

test('objective changes the answer', () => {
  // Three small tiles one way, two heavy tiles the other.
  const hand = [[6, 0], [0, 1], [1, 2], [6, 12], [12, 11]];
  assert.equal(solve(hand, [6], { objective: 'tiles' }).best.used, 3);
  const pips = solve(hand, [6], { objective: 'pips' }).best;
  assert.equal(pips.used, 2);
  assert.equal(pips.pips, 41);
});

test('spreads tiles over several open ends', () => {
  const hand = [[12, 4], [4, 6], [9, 2], [2, 2], [7, 8]];
  const { best } = solve(hand, [12, 9]);
  assert.equal(best.used, 4);
  assert.deepEqual(best.trains[1].tiles, [[9, 2], [2, 2]]);
  assert.deepEqual(best.leftover, [[7, 8]]);
});

test('alternatives are distinct, valid and equally good', () => {
  // After 12-6 the 6-1,1-5 and 6-2,2-3 branches are worth exactly the same.
  const hand = [[12, 6], [6, 1], [1, 5], [6, 2], [2, 3]];
  const { best, alternatives } = solve(hand, [12]);
  assert.equal(alternatives.length, 1);
  assert.notDeepEqual(alternatives[0].leftover, best.leftover);
  for (const alt of alternatives) {
    assert.ok(isValidPlan(alt, hand));
    assert.equal(alt.used, best.used);
    assert.equal(alt.pips, best.pips);
  }
});

test('matches brute force on random hands', () => {
  const rand = rng(7);
  for (let round = 0; round < 400; round++) {
    const max = 4 + Math.floor(rand() * 9);
    const size = 1 + Math.floor(rand() * 9);
    const hand = Array.from({ length: size }, () => [
      Math.floor(rand() * (max + 1)),
      Math.floor(rand() * (max + 1)),
    ]);
    const starts = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
      Math.floor(rand() * (max + 1)),
    );
    for (const objective of ['tiles', 'pips']) {
      const { best, alternatives, exact } = solve(hand, starts, { objective });
      assert.ok(exact);
      for (const plan of [best, ...alternatives]) {
        assert.ok(isValidPlan(plan, hand), JSON.stringify({ hand, starts, plan }));
        assert.equal(plan.used + plan.leftover.length, hand.length);
        assert.equal(
          score(plan, objective),
          bruteForce(hand, starts, objective),
          JSON.stringify({ hand, starts, objective }),
        );
      }
    }
  }
});

test('a full double-12 set is solved exactly and fast', () => {
  const hand = [];
  for (let a = 0; a <= 12; a++) for (let b = a; b <= 12; b++) hand.push([a, b]);
  const started = Date.now();
  const { best, exact } = solve(hand, [12]);
  assert.ok(exact);
  assert.equal(best.used, 91);
  assert.ok(Date.now() - started < 1000);
});

test('big random hands finish within the time limit', () => {
  const rand = rng(99);
  for (let round = 0; round < 5; round++) {
    const hand = Array.from({ length: 30 }, () => [
      Math.floor(rand() * 13),
      Math.floor(rand() * 13),
    ]);
    const started = Date.now();
    const { best } = solve(hand, [12, 3], { timeLimitMs: 100 });
    assert.ok(isValidPlan(best, hand));
    assert.ok(Date.now() - started < 1000);
  }
});
