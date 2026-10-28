export const MODES = [
  { id: 'out', name: '出去吃' },
  { id: 'delivery', name: '点外卖' },
  { id: 'cook', name: '自己做' },
];

export const CUISINES = [
  { id: 'hotpot', name: '火锅', price: 2, emoji: '🍲' },
  { id: 'chuan', name: '川湘', price: 1, emoji: '🌶️' },
  { id: 'yue', name: '粤式', price: 3, emoji: '🥟' },
  { id: 'japanese', name: '日料', price: 3, emoji: '🍣' },
  { id: 'korean', name: '韩餐', price: 2, emoji: '🍜' },
  { id: 'noodles', name: '面', price: 1, emoji: '🍝' },
  { id: 'light', name: '轻食', price: 2, emoji: '🥗' },
  { id: 'bbq', name: '烧烤', price: 2, emoji: '🍢' },
  { id: 'western', name: '西餐', price: 3, emoji: '🥩' },
  { id: 'sea', name: '东南亚', price: 2, emoji: '🍛' },
  { id: 'brunch', name: '早午餐', price: 2, emoji: '🥞' },
];

const MOOD_BOOST = {
  light: ['light', 'noodles'],
  treat: ['hotpot', 'japanese', 'western'],
  lively: ['hotpot', 'bbq', 'korean'],
};

const QUIPS = {
  out: ['出门吧，今晚的路灯都站你们这边。', '就这家方向，走两步就到了。', '把选择困难留在门口。'],
  delivery: ['外卖小哥会替你们跑这一趟。', '拖鞋不用脱，好吃的会自己过来。', '手机点一点，锅先热着。'],
  cook: ['围裙一系，你们就是今晚的主厨。', '自己做的，连洗碗都算在一起。', '冰箱里的东西，今天正好有用。'],
};

export function daysAgo(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function recentCuisineIds(logs, today, within = 3) {
  const ids = [];
  for (const log of logs || []) {
    const diff = daysAgo(log.date, today);
    if (diff == null || diff < 0 || diff >= within) continue;
    if (log.cuisine) ids.push(log.cuisine);
  }
  return ids;
}

export function rerollAllowed(count) {
  return Number(count) < 1;
}

function preferenceWeight(level) {
  if (level === 'crave') return 4;
  if (level === 'love') return 2;
  if (level === 'skip') return 0;
  return 1;
}

export function scoreModes(votes) {
  const weights = { out: 1, delivery: 1, cook: 1 };
  for (const vote of votes || []) {
    if (vote.energy === 'tired') {
      weights.out *= 0.35;
      weights.cook *= 0.4;
    }
    if (weights[vote.mode] != null) weights[vote.mode] *= 3;
  }
  return MODES.map((mode) => ({ ...mode, weight: weights[mode.id] }));
}

export function scoreCuisines(votes, recent) {
  const blocked = new Set(recent || []);
  const loved = [];
  const open = [];
  for (const cuisine of CUISINES) {
    if (blocked.has(cuisine.id)) continue;
    let skipped = false;
    let weight = 1;
    let positive = false;
    for (const vote of votes || []) {
      const level = vote.cuisines?.[cuisine.id] || 'ok';
      if (level === 'skip') {
        skipped = true;
        break;
      }
      if (level === 'love' || level === 'crave') positive = true;
      weight *= preferenceWeight(level);
      if (vote.budget === 'low' && cuisine.price >= 3) weight *= 0.3;
      const boost = MOOD_BOOST[vote.mood];
      if (boost?.includes(cuisine.id)) weight *= 1.4;
    }
    if (skipped || weight <= 0) continue;
    const item = { id: cuisine.id, name: cuisine.name, price: cuisine.price, weight };
    if (positive) loved.push(item);
    else open.push(item);
  }
  return { pool: loved, fallback: [...loved, ...open] };
}

function pick(items, random, excludeId) {
  const usable = items.filter((item) => item.weight > 0 && item.id !== excludeId);
  if (!usable.length) return null;
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of usable) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return usable[usable.length - 1];
}

export function suggestPlaces(places, mode, cuisineId) {
  return (places || [])
    .filter((place) => place.cuisine === cuisineId && (mode === 'cook' || place.mode === mode))
    .sort((a, b) => Number(a.visited) - Number(b.visited))
    .slice(0, 3);
}

export function decide({ votes = [], recentCuisines = [], places = [], previous = null, reroll = false, random = Math.random } = {}) {
  const mode = pick(scoreModes(votes), random, reroll && previous ? null : null);
  if (!mode) return { ok: false, reason: 'no-mode' };
  const scored = scoreCuisines(votes, recentCuisines);
  let usedFallback = false;
  let pool = scored.pool;
  if (!pool.length) {
    usedFallback = true;
    pool = scored.fallback;
  }
  const exclude = reroll && previous?.cuisine ? previous.cuisine : null;
  let cuisine = pick(pool, random, exclude);
  if (!cuisine && exclude) {
    usedFallback = true;
    cuisine = pick(scored.fallback, random, exclude);
  }
  if (!cuisine) return { ok: false, reason: 'no-alternative', previous };
  const list = QUIPS[mode.id] || QUIPS.delivery;
  const quip = list[Math.floor(random() * list.length) % list.length];
  const wheel = usedFallback ? pool.map((item) => ({
    id: item.id,
    name: item.name,
    emoji: CUISINES.find((row) => row.id === item.id)?.emoji || '🍽️',
  })) : [];
  return {
    ok: true,
    mode: { id: mode.id, name: mode.name },
    cuisine: { id: cuisine.id, name: cuisine.name, emoji: CUISINES.find((row) => row.id === cuisine.id)?.emoji || '🍽️' },
    usedFallback,
    wheel,
    quip,
    places: suggestPlaces(places, mode.id, cuisine.id),
  };
}
