import assert from 'node:assert/strict';
import test from 'node:test';
import { CUISINES } from '../public/js/eat-decide.js';
import { jar, request, startApp } from './helpers.js';

const USERS = [
  { username: 'xiaoman', password: 'secret-pass-1', displayName: '小满' },
  { username: 'xiaoqiu', password: 'secret-pass-2', displayName: '小秋' },
];

function vote(mode, crave) {
  const cuisines = Object.fromEntries(CUISINES.map((item) => [item.id, item.id === crave ? 'crave' : 'ok']));
  return { energy: 'ok', mood: 'any', budget: 'mid', mode, cuisines };
}

test('今天吃啥免登录可打开，私密接口仍然要登录', async () => {
  const ctx = await startApp();
  try {
    const page = await request(ctx.base, null, '/eat');
    assert.equal(page.status, 200);
    assert.match(page.response.headers.get('content-type'), /text\/html/);
    assert.match(page.data, /今天吃啥/);
    assert.match(page.data, /\/js\/eat\.js/);
    assert.equal((await request(ctx.base, null, '/api/home')).status, 401);
    assert.equal((await request(ctx.base, null, '/api/diary')).status, 401);
    assert.equal((await request(ctx.base, null, '/api/eat/today')).status, 401);
    assert.equal((await request(ctx.base, null, '/api/eat/places', { method: 'POST', json: { name: 'x' } })).status, 401);
    assert.equal((await request(ctx.base, null, '/api/eat/vote', { method: 'POST', json: {} })).status, 401);
    const css = await request(ctx.base, null, '/css/eat.css');
    const script = await request(ctx.base, null, '/js/eat-decide.js');
    assert.equal(css.status, 200);
    assert.equal(script.status, 200);
  } finally {
    await ctx.close();
  }
});

test('登录后两人都提交才揭晓，并且只能再换一次', async () => {
  const ctx = await startApp();
  try {
    const personA = jar();
    const personB = jar();
    assert.equal((await request(ctx.base, jar(), '/api/setup', {
      method: 'POST',
      json: { togetherSince: '2024-02-14', timezone: 'Asia/Shanghai', reminderHour: 9, users: USERS },
    })).status, 201);
    assert.equal((await request(ctx.base, personA, '/api/login', { method: 'POST', json: USERS[0] })).status, 200);
    assert.equal((await request(ctx.base, personB, '/api/login', { method: 'POST', json: USERS[1] })).status, 200);

    const first = await request(ctx.base, personA, '/api/eat/vote', { method: 'POST', json: vote('delivery', 'hotpot') });
    assert.equal(first.status, 200);
    assert.equal(first.data.round.result, null);
    assert.equal(first.data.round.mineSubmitted, true);
    assert.equal(JSON.stringify(first.data.round).includes('crave'), false);
    const waiting = await request(ctx.base, personB, '/api/eat/today');
    assert.equal(waiting.data.round.partnerSubmitted, true);
    assert.equal(waiting.data.round.result, null);
    assert.match(ctx.notes.at(-1).payload.body, /TA 已经选好了/);
    assert.equal(ctx.notes.at(-1).payload.url, '/eat');

    const second = await request(ctx.base, personB, '/api/eat/vote', { method: 'POST', json: vote('delivery', 'hotpot') });
    assert.equal(second.status, 200);
    assert.equal(typeof second.data.round.result.cuisine, 'string');
    assert.equal(typeof second.data.round.result.mode, 'string');
    const seen = await request(ctx.base, personA, '/api/eat/today');
    assert.equal(seen.data.round.result.cuisine, second.data.round.result.cuisine);
    assert.equal(seen.data.round.result.mode, second.data.round.result.mode);

    const once = await request(ctx.base, personA, `/api/eat/rounds/${second.data.round.id}/reroll`, { method: 'POST' });
    assert.equal(once.status, 200);
    assert.equal(once.data.round.rerolls, 1);
    const again = await request(ctx.base, personA, `/api/eat/rounds/${second.data.round.id}/reroll`, { method: 'POST' });
    assert.equal(again.status, 409);

    const place = await request(ctx.base, personA, '/api/eat/places', {
      method: 'POST',
      json: { name: '小满火锅', cuisine: 'noodles', mode: 'delivery', platform: 'fantuan', url: 'https://example.com/noodles', note: '微辣' },
    });
    assert.equal(place.status, 201);
    const hidden = await request(ctx.base, null, '/api/eat/places');
    assert.equal(hidden.status, 401);
  } finally {
    await ctx.close();
  }
});
