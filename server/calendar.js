import { randomBytes } from 'node:crypto';
import { getSetting } from './db.js';
import { clientIp, httpError, readJson, sendJson } from './http.js';
import { buildCalendar } from './ics.js';
import { occurrenceInMonth, zonedParts } from './time.js';
import { asDate, asId, asMonth, asScope, asText, asTime } from './validate.js';

const HOST = /^(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::\d{1,5})?$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function clock(ctx) {
  const timeZone = getSetting(ctx.db, 'timezone', ctx.config.defaultTimezone);
  const parts = zonedParts(ctx.config.now(), timeZone);
  return {
    ...parts,
    reminderHour: Number(getSetting(ctx.db, 'reminder_hour', String(ctx.config.reminderHour))),
  };
}

function partnerOf(db, userId) {
  return db.prepare('SELECT id, display_name FROM users WHERE id != ?').get(userId) || null;
}

function visibleSql() {
  return `(audience = 'shared' OR audience = 'assigned' OR (audience = 'private' AND owner_id = ?))`;
}

function presentTodo(row, viewerId) {
  let scope = 'ours';
  let scopeLabel = '我们的';
  if (row.audience === 'private') {
    scope = 'mine';
    scopeLabel = '我的';
  } else if (row.audience === 'assigned') {
    if (row.owner_id === viewerId) {
      scope = 'received';
      scopeLabel = '给我的';
    } else {
      scope = 'theirs';
      scopeLabel = '对方的';
    }
  }
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueDate: row.due_date,
    dueTime: row.due_time,
    scope,
    scopeLabel,
    createdBy: row.created_by,
    createdByName: row.author_name || '',
    completedAt: row.completed_at,
    completedByName: row.completed_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadTodo(ctx, rawId, viewerId) {
  const id = asId(rawId);
  const row = ctx.db.prepare(`
    SELECT t.*, author.display_name AS author_name, done.display_name AS completed_name
    FROM todos t
    JOIN users author ON author.id = t.created_by
    LEFT JOIN users done ON done.id = t.completed_by
    WHERE t.id = ? AND ${visibleSql()}
  `).get(id, viewerId);
  return row || null;
}

function readTodoInput(body, viewerId, partnerId, { allowReceived }) {
  const title = asText(body.title, 1, 40, '待办');
  const note = body.note == null || body.note === '' ? '' : asText(String(body.note), 0, 500, '备注');
  const dueDate = body.dueDate == null || body.dueDate === '' ? null : asDate(body.dueDate, '日期');
  const dueTime = asTime(body.dueTime);
  if (dueTime && !dueDate) throw httpError(400, '选了时间就要选日期');
  const scope = asScope(body.scope);
  if (scope === 'received' && !allowReceived) throw httpError(400, '请选择这是谁的待办');
  if ((scope === 'theirs' || scope === 'ours' || scope === 'received') && !partnerId && scope !== 'received') {
    throw httpError(400, '还没有对方');
  }
  let audience = 'shared';
  let ownerId = viewerId;
  if (scope === 'mine') audience = 'private';
  else if (scope === 'theirs') {
    audience = 'assigned';
    ownerId = partnerId;
  } else if (scope === 'received') audience = 'assigned';
  return { title, note, dueDate, dueTime: dueTime || null, audience, ownerId };
}

function ensureToken(db, userId) {
  const existing = db.prepare('SELECT token, created_at FROM calendar_tokens WHERE user_id = ?').get(userId);
  if (existing) return existing;
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO calendar_tokens (user_id, token, created_at) VALUES (?, ?, ?)').run(userId, token, createdAt);
  return { token, created_at: createdAt };
}

function replaceToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_tokens (user_id, token, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at
  `).run(userId, token, createdAt);
  return { token, created_at: createdAt };
}

function requestOrigin(req, config) {
  let proto = 'http';
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (forwarded === 'https' || forwarded === 'http') proto = forwarded;
  }
  const rawHost = config.trustProxy && req.headers['x-forwarded-host']
    ? String(req.headers['x-forwarded-host']).split(',')[0].trim()
    : String(req.headers.host || '');
  if (!HOST.test(rawHost) || rawHost.length > 253) throw httpError(400, '无法生成订阅链接');
  return { proto, host: rawHost };
}

function feedLinks(origin, token) {
  const path = `/api/cal/${token}.ics`;
  return {
    httpsUrl: `${origin.proto}://${origin.host}${path}`,
    webcalUrl: `webcal://${origin.host}${path}`,
  };
}

function visibleTodos(db, userId) {
  return db.prepare(`
    SELECT t.*, author.display_name AS author_name, done.display_name AS completed_name
    FROM todos t
    JOIN users author ON author.id = t.created_by
    LEFT JOIN users done ON done.id = t.completed_by
    WHERE ${visibleSql()}
    ORDER BY t.due_date IS NULL, t.due_date, t.due_time, t.id
  `).all(userId);
}

function notifyTodo(ctx, notifyPartner, userId, body, kind) {
  notifyPartner(ctx, userId, {
    title: '两个人',
    body,
    url: '/#cal',
    tag: 'todo',
  }, kind);
}

export function registerCalendar(router, ctx, { requireUser, notifyPartner }) {
  router.get('/api/todos', async (req, res) => {
    const user = requireUser(ctx, req);
    const todos = visibleTodos(ctx.db, user.id).map((row) => presentTodo(row, user.id));
    sendJson(res, 200, { todos });
  });

  router.get('/api/todos/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const row = loadTodo(ctx, req.params.id, user.id);
    if (!row) throw httpError(404, '找不到这条待办');
    sendJson(res, 200, { todo: presentTodo(row, user.id) });
  });

  router.post('/api/todos', async (req, res) => {
    const user = requireUser(ctx, req);
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM todos').get().count;
    if (count >= 500) throw httpError(400, '待办太多了，先删掉一些');
    const partner = partnerOf(ctx.db, user.id);
    const input = readTodoInput(await readJson(req), user.id, partner?.id, { allowReceived: false });
    const now = new Date().toISOString();
    const info = ctx.db.prepare(`
      INSERT INTO todos (title, note, due_date, due_time, audience, owner_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.title, input.note, input.dueDate, input.dueTime, input.audience, input.ownerId, user.id, now, now);
    if (input.audience !== 'private') notifyTodo(ctx, notifyPartner, user.id, `对方加了待办「${input.title}」`, 'todo-new');
    const row = loadTodo(ctx, Number(info.lastInsertRowid), user.id);
    sendJson(res, 201, { todo: presentTodo(row, user.id) });
  });

  router.patch('/api/todos/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const current = loadTodo(ctx, req.params.id, user.id);
    if (!current) throw httpError(404, '找不到这条待办');
    const partner = partnerOf(ctx.db, user.id);
    const body = await readJson(req);
    const allowReceived = current.audience === 'assigned' && current.owner_id === user.id;
    const input = readTodoInput(body, user.id, partner?.id, { allowReceived });
    const wasPrivate = current.audience === 'private';
    const now = new Date().toISOString();
    ctx.db.prepare(`
      UPDATE todos
      SET title = ?, note = ?, due_date = ?, due_time = ?, audience = ?, owner_id = ?, updated_at = ?
      WHERE id = ?
    `).run(input.title, input.note, input.dueDate, input.dueTime, input.audience, input.ownerId, now, current.id);
    if (wasPrivate && input.audience !== 'private') notifyTodo(ctx, notifyPartner, user.id, `对方加了待办「${input.title}」`, 'todo-new');
    sendJson(res, 200, { todo: presentTodo(loadTodo(ctx, current.id, user.id), user.id) });
  });

  router.post('/api/todos/:id/complete', async (req, res) => {
    const user = requireUser(ctx, req);
    const current = loadTodo(ctx, req.params.id, user.id);
    if (!current) throw httpError(404, '找不到这条待办');
    if (!current.completed_at) {
      const now = new Date().toISOString();
      ctx.db.prepare(`
        UPDATE todos SET completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?
      `).run(now, user.id, now, current.id);
      if (current.audience !== 'private') notifyTodo(ctx, notifyPartner, user.id, `对方完成了待办「${current.title}」`, 'todo-done');
    }
    sendJson(res, 200, { todo: presentTodo(loadTodo(ctx, current.id, user.id), user.id) });
  });

  router.post('/api/todos/:id/uncomplete', async (req, res) => {
    const user = requireUser(ctx, req);
    const current = loadTodo(ctx, req.params.id, user.id);
    if (!current) throw httpError(404, '找不到这条待办');
    const now = new Date().toISOString();
    ctx.db.prepare(`
      UPDATE todos SET completed_at = NULL, completed_by = NULL, updated_at = ? WHERE id = ?
    `).run(now, current.id);
    sendJson(res, 200, { todo: presentTodo(loadTodo(ctx, current.id, user.id), user.id) });
  });

  router.delete('/api/todos/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const current = loadTodo(ctx, req.params.id, user.id);
    if (!current) throw httpError(404, '找不到这条待办');
    ctx.db.prepare('DELETE FROM todos WHERE id = ?').run(current.id);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/calendar/month', async (req, res) => {
    const user = requireUser(ctx, req);
    const now = clock(ctx);
    const month = req.query.month ? asMonth(req.query.month) : now.date.slice(0, 7);
    const events = [];
    const anniversaries = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries ORDER BY id').all();
    for (const row of anniversaries) {
      const date = occurrenceInMonth(row.date, row.yearly === 1, month);
      if (!date) continue;
      events.push({ kind: 'anniversary', date, id: row.id, title: row.title, yearly: row.yearly === 1, sourceDate: row.date });
    }
    const todos = visibleTodos(ctx.db, user.id);
    const undated = [];
    for (const row of todos) {
      if (!row.due_date) {
        if (!row.completed_at) undated.push(presentTodo(row, user.id));
        continue;
      }
      if (!row.due_date.startsWith(`${month}-`)) continue;
      events.push({ kind: 'todo', date: row.due_date, todo: presentTodo(row, user.id) });
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || (a.id || a.todo.id) - (b.id || b.todo.id));
    sendJson(res, 200, { month, today: now.date, timezone: now.timeZone, events, undated });
  });

  router.get('/api/calendar/feed', async (req, res) => {
    const user = requireUser(ctx, req);
    const saved = ensureToken(ctx.db, user.id);
    const origin = requestOrigin(req, ctx.config);
    sendJson(res, 200, { ...feedLinks(origin, saved.token), createdAt: saved.created_at });
  });

  router.post('/api/calendar/feed/reset', async (req, res) => {
    const user = requireUser(ctx, req);
    const saved = replaceToken(ctx.db, user.id);
    const origin = requestOrigin(req, ctx.config);
    sendJson(res, 200, { ...feedLinks(origin, saved.token), createdAt: saved.created_at });
  });

  router.get('/api/cal/:token.ics', async (req, res) => {
    const key = `ics:${clientIp(req, ctx.config.trustProxy)}`;
    if (ctx.icsLimiter.isLimited(key)) throw httpError(429, '请求太多，请稍后再试', { 'retry-after': '900' });
    ctx.icsLimiter.hit(key);
    const token = String(req.params.token || '');
    if (!TOKEN.test(token)) throw httpError(404, '找不到日历');
    const row = ctx.db.prepare('SELECT user_id, token FROM calendar_tokens WHERE token = ?').get(token);
    if (!row || row.token !== token) throw httpError(404, '找不到日历');
    const time = clock(ctx);
    const todos = visibleTodos(ctx.db, row.user_id).filter((item) => item.due_date && !item.completed_at);
    const anniversaries = ctx.db.prepare('SELECT id, title, date, yearly, updated_at FROM anniversaries ORDER BY id').all();
    const body = buildCalendar({
      timezone: time.timeZone,
      reminderHour: time.reminderHour,
      todos,
      anniversaries,
      now: ctx.config.now(),
    });
    const bytes = Buffer.from(body);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', 'inline; filename="couple.ics"');
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('content-length', bytes.length);
    res.end(bytes);
  });
}

