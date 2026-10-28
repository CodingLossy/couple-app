import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, recentCuisineIds, rerollAllowed, scoreCuisines, scoreModes } from '../public/js/eat-decide.js';

const base = { energy: 'ok', mood: 'any', budget: 'mid', mode: 'delivery', cuisines: {} };

test('很累时降低出去吃和自己做', () => {
  const weights = Object.fromEntries(scoreModes([{ ...base, mode: undefined, energy: 'tired' }]).map((item) => [item.id, item.weight]));
  assert.ok(weights.delivery > weights.out);
  assert.ok(weights.delivery > weights.cook);
  assert.ok(weights.out < 1);
  assert.ok(weights.cook < 1);
});

test('预算低时降低高价菜系，超想吃比喜欢更重', () => {
  const votes = [{
    ...base,
    budget: 'low',
    cuisines: { japanese: 'love', noodles: 'love', hotpot: 'crave' },
  }];
  const { pool } = scoreCuisines(votes, []);
  const byId = Object.fromEntries(pool.map((item) => [item.id, item.weight]));
  assert.ok(byId.noodles > byId.japanese);
  assert.ok(byId.hotpot > byId.noodles);
});

test('去掉最近三天吃过的菜系', () => {
  const today = '2026-10-28';
  const recent = recentCuisineIds([
    { cuisine: 'hotpot', date: '2026-10-28' },
    { cuisine: 'korean', date: '2026-10-26' },
    { cuisine: 'yue', date: '2026-10-24' },
  ], today);
  assert.deepEqual(recent.sort(), ['hotpot', 'korean']);
  const result = decide({
    votes: [{ ...base, cuisines: { hotpot: 'crave', noodles: 'love' } }],
    recentCuisines: recent,
    random: () => 0,
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.cuisine.id, 'hotpot');
  assert.notEqual(result.cuisine.id, 'korean');
});

test('没有交集时用双方都不排斥的菜系兜底', () => {
  const result = decide({
    votes: [
      { ...base, cuisines: { hotpot: 'crave', noodles: 'skip' } },
      { ...base, mode: 'out', cuisines: { noodles: 'crave', hotpot: 'skip' } },
    ],
    random: () => 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.usedFallback, true);
  assert.notEqual(result.cuisine.id, 'hotpot');
  assert.notEqual(result.cuisine.id, 'noodles');
  assert.ok(result.wheel.length >= 2);
  assert.ok(result.wheel.every((item) => item.emoji));
  const direct = decide({ votes: [{ ...base, cuisines: { noodles: 'crave' } }], random: () => 0 });
  assert.equal(direct.usedFallback, false);
  assert.deepEqual(direct.wheel, []);
});

test('换一个会避开上一次，而且只能换一次', () => {
  assert.equal(rerollAllowed(0), true);
  assert.equal(rerollAllowed(1), false);
  const votes = [{ ...base, cuisines: { noodles: 'crave', light: 'love' } }];
  const first = decide({ votes, random: () => 0 });
  const second = decide({ votes, previous: { cuisine: first.cuisine.id }, reroll: true, random: () => 0 });
  assert.notEqual(second.cuisine.id, first.cuisine.id);
  const stuck = decide({
    votes: [{ ...base, cuisines: { noodles: 'crave', light: 'skip', hotpot: 'skip', chuan: 'skip', yue: 'skip', japanese: 'skip', korean: 'skip', bbq: 'skip', western: 'skip', sea: 'skip', brunch: 'skip' } }],
    previous: { cuisine: 'noodles' },
    reroll: true,
    random: () => 0,
  });
  assert.equal(stuck.ok, false);
});
