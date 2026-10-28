import assert from 'node:assert/strict';
import test from 'node:test';
import { jar, request, startApp } from './helpers.js';

const USERS = [
  { username: 'xiaoman', password: 'secret-pass-1', displayName: '小满' },
  { username: 'xiaoqiu', password: 'secret-pass-2', displayName: '小秋' },
];

function unfold(ics) {
  return ics.replaceAll('\r\n ', '');
}

async function login(base) {
  const personA = jar();
  const personB = jar();
  const setup = await request(base, jar(), '/api/setup', {
    method: 'POST',
    json: { togetherSince: '2024-02-14', timezone: 'Asia/Shanghai', reminderHour: 9, users: USERS },
  });
  assert.equal(setup.status, 201);
  assert.equal((await request(base, personA, '/api/login', { method: 'POST', json: USERS[0] })).status, 200);
  assert.equal((await request(base, personB, '/api/login', { method: 'POST', json: USERS[1] })).status, 200);
  return { personA, personB };
}

test('待办、日历订阅和私人事项不会泄露', async () => {
  const ctx = await startApp();
  try {
    const { personA, personB } = await login(ctx.base);
    const before = ctx.notes.length;
    const secret = await request(ctx.base, personA, '/api/todos', {
      method: 'POST',
      json: { title: 'PRIV-9f3a-只给我', note: '私密备注', dueDate: '2026-10-28', dueTime: '15:30', scope: 'mine' },
    });
    assert.equal(secret.status, 201);
    assert.equal(secret.data.todo.scope, 'mine');
    assert.equal(ctx.notes.length, before);
    const hidden = await request(ctx.base, personB, `/api/todos/${secret.data.todo.id}`);
    assert.equal(hidden.status, 404);

    const shared = await request(ctx.base, personA, '/api/todos', {
      method: 'POST',
      json: { title: 'OURS-一起买菜', dueDate: '2026-11-02', scope: 'ours' },
    });
    assert.equal(shared.status, 201);
    assert.equal(ctx.notes.at(-1).payload.url, '/#cal');
    assert.match(ctx.notes.at(-1).payload.body, /OURS-一起买菜/);
    const assigned = await request(ctx.base, personA, '/api/todos', {
      method: 'POST',
      json: { title: 'THEIRS-交给对方', dueDate: '2026-11-03', scope: 'theirs' },
    });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.data.todo.scope, 'theirs');
    const seenByB = await request(ctx.base, personB, `/api/todos/${assigned.data.todo.id}`);
    assert.equal(seenByB.status, 200);
    assert.equal(seenByB.data.todo.scope, 'received');

    const anniversary = await request(ctx.base, personA, '/api/anniversaries', {
      method: 'POST',
      json: { title: '闰日纪念', date: '2024-02-29', yearly: true },
    });
    assert.equal(anniversary.status, 201);
    const month = await request(ctx.base, personB, '/api/calendar/month?month=2026-02');
    assert.equal(month.status, 200);
    assert.equal(month.data.events.some((event) => event.kind === 'anniversary' && event.date === '2026-02-28' && event.title === '闰日纪念'), true);
    assert.equal(JSON.stringify(month.data).includes('PRIV-9f3a-只给我'), false);
    const ownMonth = await request(ctx.base, personA, '/api/calendar/month?month=2026-10');
    assert.equal(ownMonth.data.events.some((event) => event.todo?.title === 'PRIV-9f3a-只给我'), true);

    const feedA = await request(ctx.base, personA, '/api/calendar/feed');
    const feedB = await request(ctx.base, personB, '/api/calendar/feed');
    assert.equal(feedA.status, 200);
    assert.match(feedA.data.httpsUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
    assert.equal(feedA.data.webcalUrl, feedA.data.httpsUrl.replace(/^http:\/\//, 'webcal://'));
    assert.notEqual(feedA.data.httpsUrl, feedB.data.httpsUrl);
    const again = await request(ctx.base, personA, '/api/calendar/feed');
    assert.equal(again.data.httpsUrl, feedA.data.httpsUrl);

    const icsA = await request(ctx.base, null, new URL(feedA.data.httpsUrl).pathname);
    const icsB = await request(ctx.base, null, new URL(feedB.data.httpsUrl).pathname);
    assert.equal(icsA.status, 200);
    assert.match(icsA.response.headers.get('content-type'), /text\/calendar/);
    assert.equal(icsA.response.headers.get('set-cookie'), null);
    const textA = unfold(icsA.data);
    const textB = unfold(icsB.data);
    assert.match(textA, /DTSTART:20261028T073000Z/);
    assert.match(textA, /PRIV-9f3a-只给我/);
    assert.match(textA, /私密备注/);
    assert.match(textA, /RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1/);
    assert.match(textA, /TRIGGER:-PT15H/);
    assert.match(textA, /OURS-一起买菜/);
    assert.match(textA, /THEIRS-交给对方/);
    assert.equal(textB.includes('PRIV-9f3a-只给我'), false);
    assert.equal(textB.includes('私密备注'), false);
    assert.match(textB, /OURS-一起买菜/);
    assert.match(textB, /THEIRS-交给对方/);
    assert.match(textB, /闰日纪念/);

    const done = await request(ctx.base, personB, `/api/todos/${shared.data.todo.id}/complete`, { method: 'POST' });
    assert.equal(done.status, 200);
    assert.match(ctx.notes.at(-1).payload.body, /完成了待办/);
    const afterDone = unfold((await request(ctx.base, null, new URL(feedA.data.httpsUrl).pathname)).data);
    assert.equal(afterDone.includes('OURS-一起买菜'), false);

    const reset = await request(ctx.base, personA, '/api/calendar/feed/reset', { method: 'POST' });
    assert.equal(reset.status, 200);
    assert.notEqual(reset.data.httpsUrl, feedA.data.httpsUrl);
    const stale = await request(ctx.base, null, new URL(feedA.data.httpsUrl).pathname);
    assert.equal(stale.status, 404);
    const fresh = await request(ctx.base, null, new URL(reset.data.httpsUrl).pathname);
    assert.equal(fresh.status, 200);
    assert.match(unfold(fresh.data), /PRIV-9f3a-只给我/);
    const missing = await request(ctx.base, null, `/api/cal/${'a'.repeat(43)}.ics`);
    assert.equal(missing.status, 404);
    assert.equal((await request(ctx.base, null, '/api/calendar/feed')).status, 401);
  } finally {
    await ctx.close();
  }
});

test('日历订阅有速率限制，日志不记录令牌', async () => {
  const ctx = await startApp({ icsLimit: 2, quiet: false });
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const { personA } = await login(ctx.base);
    const feed = await request(ctx.base, personA, '/api/calendar/feed');
    const path = new URL(feed.data.httpsUrl).pathname;
    assert.equal((await request(ctx.base, null, path)).status, 200);
    assert.equal((await request(ctx.base, null, path)).status, 200);
    assert.equal((await request(ctx.base, null, path)).status, 429);
    const token = path.split('/').pop().replace('.ics', '');
    assert.equal(lines.some((line) => line.includes(token)), false);
    assert.equal(lines.some((line) => line.includes('/api/cal/[redacted]')), true);
  } finally {
    console.log = original;
    await ctx.close();
  }
});
