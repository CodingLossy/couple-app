import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { MOODS, TIMEZONES } from './content.js';
import { emptyContent, emptyEverything, getSetting, nowIso, seedPresets, setSetting, userCount } from './db.js';
import {
  clearSessionCookie,
  clientIp,
  httpError,
  readCookie,
  readJson,
  readMultipart,
  sendJson,
  setSessionCookie,
} from './http.js';
import { createSession, hashPassword, readSession, revokeToken, revokeUserSessions, verifyPassword } from './auth.js';
import { emptyMedia, mediaPath, processImage, removeStored } from './images.js';
import { registerCalendar } from './calendar.js';
import { daysBetween, daysTogether, nextOccurrence, zonedParts } from './time.js';
import {
  asDate,
  asHour,
  asId,
  asLimit,
  asMood,
  asPassword,
  asText,
  asUsername,
  asVisibility,
  asZone,
} from './validate.js';

const recentNotifications = new Map();

function flag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function clock(ctx) {
  const timeZone = getSetting(ctx.db, 'timezone', ctx.config.defaultTimezone);
  const parts = zonedParts(ctx.config.now(), timeZone);
  return {
    ...parts,
    reminderHour: Number(getSetting(ctx.db, 'reminder_hour', String(ctx.config.reminderHour))),
  };
}

function requireUser(ctx, req) {
  const session = readSession(ctx.db, readCookie(req, 'sid'));
  if (!session) throw httpError(401, '请先登录');
  return session;
}

function presentMe(db, userId) {
  const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const partner = db.prepare('SELECT id, display_name FROM users WHERE id != ?').get(userId);
  const pushDevices = db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(userId).count;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    partner: partner ? { id: partner.id, displayName: partner.display_name } : null,
    togetherSince: getSetting(db, 'together_since'),
    timezone: getSetting(db, 'timezone'),
    reminderHour: Number(getSetting(db, 'reminder_hour', '9')),
    pushDevices,
  };
}

function presentAnniversary(row, today) {
  const yearly = row.yearly === 1;
  const nextDate = nextOccurrence(row.date, yearly, today);
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    yearly,
    nextDate,
    daysUntil: nextDate ? daysBetween(today, nextDate) : null,
  };
}

function sortAnniversaries(a, b) {
  if (a.daysUntil == null && b.daysUntil == null) return a.id - b.id;
  if (a.daysUntil == null) return 1;
  if (b.daysUntil == null) return -1;
  return a.daysUntil - b.daysUntil || a.id - b.id;
}

function presentPhoto(row, viewerId) {
  return {
    id: row.id,
    authorId: row.user_id,
    authorName: row.author_name,
    mine: row.user_id === viewerId,
    caption: row.caption,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

function presentDiary(row, viewerId) {
  const mood = MOODS.find((item) => item.id === row.mood);
  return {
    id: row.id,
    authorId: row.user_id,
    authorName: row.author_name,
    mine: row.user_id === viewerId,
    visibility: row.visibility,
    mood: row.mood,
    moodLabel: mood?.label || '',
    moodEmoji: mood?.emoji || '',
    content: row.content,
    photoId: row.photo_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentChecklist(row) {
  return {
    id: row.id,
    title: row.title,
    preset: row.preset === 1,
    note: row.note,
    photoId: row.photo_id,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    completedByName: row.completed_name || '',
    sortOrder: row.sort_order,
  };
}

function notifyPartner(ctx, userId, payload, coalesceKey) {
  const partner = ctx.db.prepare('SELECT id FROM users WHERE id != ?').get(userId);
  if (!partner) return;
  if (coalesceKey) {
    const key = `${partner.id}:${coalesceKey}`;
    if (recentNotifications.has(key)) return;
    const timer = setTimeout(() => recentNotifications.delete(key), 20000);
    if (typeof timer.unref === 'function') timer.unref();
    recentNotifications.set(key, timer);
  }
  Promise.resolve(ctx.notify(partner.id, payload)).catch((error) => {
    console.error('通知失败', error.message);
  });
}

function deletePhoto(ctx, id) {
  const row = ctx.db.prepare('SELECT stored_name FROM photos WHERE id = ?').get(id);
  if (!row) return;
  ctx.db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  removeStored(ctx.config.dataDir, row.stored_name);
}

async function savePhoto(ctx, userId, tmp, kind, caption) {
  const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM photos').get().count;
  if (count >= ctx.config.maxPhotos) throw httpError(400, '照片太多了，先删掉一些再上传');
  const image = await processImage(tmp, ctx.config.dataDir);
  try {
    const info = ctx.db.prepare(`
      INSERT INTO photos (user_id, kind, stored_name, width, height, bytes, caption, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, kind, image.storedName, image.width, image.height, image.bytes, caption || '', nowIso());
    return Number(info.lastInsertRowid);
  } catch (error) {
    removeStored(ctx.config.dataDir, image.storedName);
    throw error;
  }
}

function loadPhoto(ctx, id) {
  return ctx.db.prepare(`
    SELECT p.*, u.display_name AS author_name
    FROM photos p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(id);
}

function canViewPhoto(db, userId, photo) {
  if (!photo) return false;
  if (photo.kind === 'album' || photo.kind === 'checklist') return true;
  const entry = db.prepare('SELECT user_id, visibility FROM diary_entries WHERE photo_id = ?').get(photo.id);
  if (!entry) return photo.user_id === userId;
  return entry.visibility === 'shared' || entry.user_id === userId;
}

async function readEntryInput(req, ctx) {
  const type = String(req.headers['content-type'] || '');
  if (type.includes('multipart/form-data')) {
    const form = await readMultipart(req, {
      tmpDir: path.join(ctx.config.dataDir, 'tmp'),
      maxFileBytes: ctx.config.maxUploadBytes,
    });
    return { fields: form.fields, file: form.files[0] || null };
  }
  return { fields: await readJson(req), file: null };
}

function assertFile(file, config) {
  if (!file) return null;
  if (file.truncated) throw httpError(413, `照片不能超过 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB`);
  return file;
}

function loadDiary(ctx, id, userId) {
  const row = ctx.db.prepare(`
    SELECT d.*, u.display_name AS author_name
    FROM diary_entries d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = ? AND (d.visibility = 'shared' OR d.user_id = ?)
  `).get(id, userId);
  if (!row) throw httpError(404, '找不到这篇日记');
  return row;
}

function loadOwnDiary(ctx, id, userId) {
  const row = ctx.db.prepare(`
    SELECT d.*, u.display_name AS author_name
    FROM diary_entries d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = ? AND d.user_id = ?
  `).get(id, userId);
  if (!row) throw httpError(404, '找不到这篇日记');
  return row;
}

function loadChecklistItem(ctx, id) {
  const row = ctx.db.prepare(`
    SELECT c.*, u.display_name AS completed_name
    FROM checklist_items c
    LEFT JOIN users u ON u.id = c.completed_by
    WHERE c.id = ?
  `).get(id);
  if (!row) throw httpError(404, '找不到这一项');
  return row;
}

function ensureTodayQuestion(db, day) {
  const found = db.prepare('SELECT question_id FROM daily_questions WHERE day = ?').get(day);
  if (found) return found.question_id;
  return db.transaction(() => {
    const again = db.prepare('SELECT question_id FROM daily_questions WHERE day = ?').get(day);
    if (again) return again.question_id;
    let row = db.prepare(`
      SELECT id FROM question_pool
      WHERE id NOT IN (SELECT question_id FROM daily_questions)
      ORDER BY id
      LIMIT 1
    `).get();
    if (!row) {
      row = db.prepare(`
        SELECT q.id AS id
        FROM question_pool q
        LEFT JOIN daily_questions d ON d.question_id = q.id
        GROUP BY q.id
        ORDER BY COALESCE(MAX(d.day), '') ASC, q.id ASC
        LIMIT 1
      `).get();
    }
    if (!row) throw httpError(500, '题库是空的');
    db.prepare('INSERT INTO daily_questions (day, question_id) VALUES (?, ?)').run(day, row.id);
    return row.id;
  })();
}

function dailyState(db, userId, day) {
  const question = db.prepare(`
    SELECT q.text AS question
    FROM daily_questions d
    JOIN question_pool q ON q.id = d.question_id
    WHERE d.day = ?
  `).get(day);
  if (!question) return null;
  const partner = db.prepare('SELECT id, display_name FROM users WHERE id != ?').get(userId);
  const mine = db.prepare('SELECT answer FROM daily_answers WHERE day = ? AND user_id = ?').get(day, userId);
  const theirs = partner
    ? db.prepare('SELECT answer FROM daily_answers WHERE day = ? AND user_id = ?').get(day, partner.id)
    : null;
  const revealed = Boolean(mine && theirs);
  return {
    date: day,
    question: question.question,
    myAnswer: mine ? mine.answer : null,
    partnerAnswer: revealed ? theirs.answer : null,
    partnerAnswered: Boolean(theirs),
    bothAnswered: revealed,
    revealed,
    locked: revealed,
    partnerName: partner?.display_name || '',
  };
}

function readAnniversary(body) {
  return {
    title: asText(body.title, 1, 40, '纪念日名称'),
    date: asDate(body.date, '日期'),
    yearly: body.yearly == null ? 1 : (flag(body.yearly) ? 1 : 0),
  };
}

async function confirmDanger(ctx, user, body, phrase) {
  if (typeof body.confirm !== 'string' || body.confirm.trim() !== phrase) throw httpError(400, '确认文字不正确');
  const password = typeof body.password === 'string' ? body.password : '';
  const key = `danger:${user.id}`;
  if (ctx.limiter.isLimited(key)) throw httpError(429, '尝试次数过多，请稍后再试', { 'retry-after': '900' });
  if (password.length < 1 || password.length > 72) {
    ctx.limiter.hit(key);
    throw httpError(403, '密码不正确');
  }
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  const ok = await verifyPassword(password, row.password_hash, ctx.config.passwordN);
  if (!ok) {
    ctx.limiter.hit(key);
    throw httpError(403, '密码不正确');
  }
  ctx.limiter.clear(key);
}

function asEndpoint(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 2000) throw httpError(400, '订阅信息不正确');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, '订阅信息不正确');
  }
  if (url.protocol !== 'https:') throw httpError(400, '订阅信息不正确');
  return value;
}

function asPushKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 255 || !/^[\w\-+=/]+$/.test(value)) {
    throw httpError(400, '订阅信息不正确');
  }
  return value;
}

function meta(ctx) {
  return {
    moods: MOODS,
    timezones: TIMEZONES.map(([id, label]) => ({ id, label })),
    maxUploadMb: Math.round(ctx.config.maxUploadBytes / 1024 / 1024),
  };
}

export function registerRoutes(router, ctx) {
  registerCalendar(router, ctx, { requireUser, notifyPartner });

  router.get('/api/health', async (_req, res) => {
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/bootstrap', async (req, res) => {
    const session = readSession(ctx.db, readCookie(req, 'sid'));
    sendJson(res, 200, {
      initialized: userCount(ctx.db) > 0,
      me: session ? presentMe(ctx.db, session.id) : null,
      ...meta(ctx),
    });
  });

  router.post('/api/setup', async (req, res) => {
    const ip = clientIp(req, ctx.config.trustProxy);
    if (ctx.limiter.isLimited(`setup:${ip}`)) throw httpError(429, '尝试次数过多，请稍后再试', { 'retry-after': '900' });
    ctx.limiter.hit(`setup:${ip}`);
    if (userCount(ctx.db) > 0) throw httpError(403, '已经初始化，不能再注册');
    const body = await readJson(req);
    const togetherSince = asDate(body.togetherSince, '在一起的日期');
    const timezone = asZone(body.timezone == null ? ctx.config.defaultTimezone : body.timezone);
    const reminderHour = body.reminderHour == null ? ctx.config.reminderHour : asHour(body.reminderHour);
    if (!Array.isArray(body.users) || body.users.length !== 2) throw httpError(400, '需要正好两个人的账号');
    const users = body.users.map((item) => ({
      username: asUsername(item?.username),
      password: asPassword(item?.password),
      displayName: asText(item?.displayName, 1, 20, '称呼'),
    }));
    if (users[0].username.normalize('NFC').toLowerCase() === users[1].username.normalize('NFC').toLowerCase()) {
      throw httpError(400, '两个用户名不能一样');
    }
    const hashes = [];
    for (const user of users) hashes.push(await hashPassword(user.password, ctx.config.passwordN));
    const tx = ctx.db.transaction(() => {
      if (userCount(ctx.db) > 0) throw httpError(403, '已经初始化，不能再注册');
      const insert = ctx.db.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)');
      const now = nowIso();
      users.forEach((user, index) => insert.run(user.username, user.displayName, hashes[index], now));
      setSetting(ctx.db, 'together_since', togetherSince);
      setSetting(ctx.db, 'timezone', timezone);
      setSetting(ctx.db, 'reminder_hour', String(reminderHour));
      seedPresets(ctx.db);
    });
    tx();
    sendJson(res, 201, { ok: true });
  });

  router.post('/api/login', async (req, res) => {
    const body = await readJson(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(req, ctx.config.trustProxy);
    const key = `login:${ip}:${username.slice(0, 40)}`;
    if (ctx.limiter.isLimited(key)) throw httpError(429, '尝试次数过多，请稍后再试', { 'retry-after': '900' });
    if (password.length < 1 || password.length > 72) {
      ctx.limiter.hit(key);
      throw httpError(401, '用户名或密码不正确');
    }
    const row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    const ok = await verifyPassword(password, row?.password_hash, ctx.config.passwordN);
    if (!row || !ok) {
      ctx.limiter.hit(key);
      throw httpError(401, '用户名或密码不正确');
    }
    ctx.limiter.clear(key);
    const session = createSession(ctx.db, row.id, ctx.config.sessionDays);
    setSessionCookie(res, req, ctx.config, session.token, session.maxAge);
    sendJson(res, 200, { me: presentMe(ctx.db, row.id) });
  });

  router.post('/api/logout', async (req, res) => {
    revokeToken(ctx.db, readCookie(req, 'sid'));
    clearSessionCookie(res, req, ctx.config);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/me', async (req, res) => {
    const user = requireUser(ctx, req);
    sendJson(res, 200, { me: presentMe(ctx.db, user.id) });
  });

  router.patch('/api/settings', async (req, res) => {
    const user = requireUser(ctx, req);
    const body = await readJson(req);
    if (body.displayName != null) {
      ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(asText(body.displayName, 1, 20, '称呼'), user.id);
    }
    if (body.togetherSince != null) setSetting(ctx.db, 'together_since', asDate(body.togetherSince, '在一起的日期'));
    if (body.timezone != null) setSetting(ctx.db, 'timezone', asZone(body.timezone));
    if (body.reminderHour != null) setSetting(ctx.db, 'reminder_hour', String(asHour(body.reminderHour)));
    sendJson(res, 200, { me: presentMe(ctx.db, user.id) });
  });

  router.post('/api/me/password', async (req, res) => {
    const user = requireUser(ctx, req);
    const body = await readJson(req);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = asPassword(body.newPassword);
    const key = `password:${user.id}`;
    if (ctx.limiter.isLimited(key)) throw httpError(429, '尝试次数过多，请稍后再试', { 'retry-after': '900' });
    if (current.length < 1 || current.length > 72) {
      ctx.limiter.hit(key);
      throw httpError(403, '当前密码不正确');
    }
    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    const ok = await verifyPassword(current, row.password_hash, ctx.config.passwordN);
    if (!ok) {
      ctx.limiter.hit(key);
      throw httpError(403, '当前密码不正确');
    }
    const passwordHash = await hashPassword(next, ctx.config.passwordN);
    const tx = ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      revokeUserSessions(ctx.db, user.id);
    });
    tx();
    const session = createSession(ctx.db, user.id, ctx.config.sessionDays);
    setSessionCookie(res, req, ctx.config, session.token, session.maxAge);
    sendJson(res, 200, { me: presentMe(ctx.db, user.id) });
  });

  router.get('/api/home', async (req, res) => {
    const user = requireUser(ctx, req);
    const now = clock(ctx);
    const me = presentMe(ctx.db, user.id);
    const rows = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries ORDER BY id').all();
    sendJson(res, 200, {
      today: now.date,
      timezone: now.timeZone,
      daysTogether: daysTogether(me.togetherSince, now.date),
      togetherSince: me.togetherSince,
      myName: me.displayName,
      partnerName: me.partner?.displayName || '',
      anniversaries: rows.map((row) => presentAnniversary(row, now.date)).sort(sortAnniversaries),
    });
  });

  router.get('/api/anniversaries', async (req, res) => {
    const user = requireUser(ctx, req);
    const today = clock(ctx).date;
    const rows = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries ORDER BY id').all();
    sendJson(res, 200, {
      today,
      anniversaries: rows.map((row) => presentAnniversary(row, today)).sort(sortAnniversaries),
      viewerId: user.id,
    });
  });

  router.post('/api/anniversaries', async (req, res) => {
    const user = requireUser(ctx, req);
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM anniversaries').get().count;
    if (count >= 100) throw httpError(400, '纪念日太多了');
    const item = readAnniversary(await readJson(req));
    const now = nowIso();
    const info = ctx.db.prepare(`
      INSERT INTO anniversaries (title, date, yearly, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.title, item.date, item.yearly, user.id, now, now);
    const row = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries WHERE id = ?').get(Number(info.lastInsertRowid));
    sendJson(res, 201, { anniversary: presentAnniversary(row, clock(ctx).date) });
  });

  router.patch('/api/anniversaries/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const current = ctx.db.prepare('SELECT id FROM anniversaries WHERE id = ?').get(id);
    if (!current) throw httpError(404, '找不到这个纪念日');
    const item = readAnniversary(await readJson(req));
    ctx.db.prepare('UPDATE anniversaries SET title = ?, date = ?, yearly = ?, updated_at = ? WHERE id = ?').run(
      item.title,
      item.date,
      item.yearly,
      nowIso(),
      id,
    );
    const row = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries WHERE id = ?').get(id);
    sendJson(res, 200, { anniversary: presentAnniversary(row, clock(ctx).date) });
  });

  router.delete('/api/anniversaries/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const info = ctx.db.prepare('DELETE FROM anniversaries WHERE id = ?').run(id);
    if (info.changes !== 1) throw httpError(404, '找不到这个纪念日');
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/photos', async (req, res) => {
    const user = requireUser(ctx, req);
    const before = req.query.before ? asId(req.query.before) : null;
    const limit = asLimit(req.query.limit, 30, 60);
    const rows = ctx.db.prepare(`
      SELECT p.*, u.display_name AS author_name
      FROM photos p
      JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'album' AND (? IS NULL OR p.id < ?)
      ORDER BY p.id DESC
      LIMIT ?
    `).all(before, before, limit);
    sendJson(res, 200, {
      today: clock(ctx).date,
      photos: rows.map((row) => presentPhoto(row, user.id)),
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  });

  router.post('/api/photos', async (req, res) => {
    const user = requireUser(ctx, req);
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('multipart/form-data')) throw httpError(400, '请选择照片');
    let file = null;
    try {
      const form = await readMultipart(req, {
        tmpDir: path.join(ctx.config.dataDir, 'tmp'),
        maxFileBytes: ctx.config.maxUploadBytes,
      });
      file = assertFile(form.files[0], ctx.config);
      if (!file) throw httpError(400, '请选择照片');
      const caption = form.fields.caption ? asText(form.fields.caption, 0, 200, '说明') : '';
      const id = await savePhoto(ctx, user.id, file.tmp, 'album', caption);
      notifyPartner(ctx, user.id, { title: '两个人', body: '对方上传了新照片', url: '/#album', tag: 'photo' }, 'photo');
      sendJson(res, 201, { photo: presentPhoto(loadPhoto(ctx, id), user.id) });
    } finally {
      if (file) fs.rm(file.tmp, { force: true }, () => {});
    }
  });

  router.delete('/api/photos/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const photo = ctx.db.prepare("SELECT * FROM photos WHERE id = ? AND kind = 'album'").get(id);
    if (!photo) throw httpError(404, '照片不存在');
    if (photo.user_id !== user.id) throw httpError(403, '只能删除自己上传的照片');
    deletePhoto(ctx, id);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/media/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const photo = ctx.db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    if (!photo || !canViewPhoto(ctx.db, user.id, photo)) throw httpError(404, '照片不存在');
    const folder = req.query.size === 'full' ? 'photos' : 'thumbs';
    const full = mediaPath(ctx.config.dataDir, folder, photo.stored_name);
    let stat;
    try {
      stat = await fs.promises.stat(full);
    } catch {
      throw httpError(404, '照片不存在');
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('content-length', stat.size);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.setHeader('content-disposition', 'inline; filename="photo.jpg"');
    const stream = fs.createReadStream(full);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  router.get('/api/diary', async (req, res) => {
    const user = requireUser(ctx, req);
    const before = req.query.before ? asId(req.query.before) : null;
    const limit = asLimit(req.query.limit, 20, 50);
    const rows = ctx.db.prepare(`
      SELECT d.*, u.display_name AS author_name
      FROM diary_entries d
      JOIN users u ON u.id = d.user_id
      WHERE (d.visibility = 'shared' OR d.user_id = ?)
        AND (? IS NULL OR d.id < ?)
      ORDER BY d.id DESC
      LIMIT ?
    `).all(user.id, before, before, limit);
    sendJson(res, 200, {
      today: clock(ctx).date,
      timezone: clock(ctx).timeZone,
      entries: rows.map((row) => presentDiary(row, user.id)),
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  });

  router.get('/api/diary/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    sendJson(res, 200, { entry: presentDiary(loadDiary(ctx, asId(req.params.id), user.id), user.id) });
  });

  router.post('/api/diary', async (req, res) => {
    const user = requireUser(ctx, req);
    const input = await readEntryInput(req, ctx);
    let file = null;
    try {
      file = assertFile(input.file, ctx.config);
      const content = asText(input.fields.content, 1, 5000, '日记');
      const mood = asMood(input.fields.mood);
      const visibility = asVisibility(input.fields.visibility);
      let photoId = null;
      try {
        if (file) photoId = await savePhoto(ctx, user.id, file.tmp, 'diary', '');
        const now = nowIso();
        const info = ctx.db.prepare(`
          INSERT INTO diary_entries (user_id, visibility, mood, content, photo_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, visibility, mood, content, photoId, now, now);
        const id = Number(info.lastInsertRowid);
        if (visibility === 'shared') {
          notifyPartner(ctx, user.id, { title: '两个人', body: '对方写了一篇日记', url: '/#diary', tag: 'diary' }, 'diary');
        }
        sendJson(res, 201, { entry: presentDiary(loadDiary(ctx, id, user.id), user.id) });
      } catch (error) {
        if (photoId) deletePhoto(ctx, photoId);
        throw error;
      }
    } finally {
      if (file) fs.rm(file.tmp, { force: true }, () => {});
    }
  });

  router.patch('/api/diary/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const input = await readEntryInput(req, ctx);
    let file = null;
    try {
      file = assertFile(input.file, ctx.config);
      const current = loadOwnDiary(ctx, id, user.id);
      const content = input.fields.content == null ? current.content : asText(input.fields.content, 1, 5000, '日记');
      const mood = input.fields.mood == null ? current.mood : asMood(input.fields.mood);
      const visibility = input.fields.visibility == null ? current.visibility : asVisibility(input.fields.visibility);
      let photoId = current.photo_id;
      let createdPhoto = null;
      try {
        if (file) {
          createdPhoto = await savePhoto(ctx, user.id, file.tmp, 'diary', '');
          photoId = createdPhoto;
        } else if (flag(input.fields.removePhoto)) {
          photoId = null;
        }
        ctx.db.prepare(`
          UPDATE diary_entries
          SET content = ?, mood = ?, visibility = ?, photo_id = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(content, mood, visibility, photoId, nowIso(), id, user.id);
        if (createdPhoto && current.photo_id) deletePhoto(ctx, current.photo_id);
        if (!createdPhoto && photoId == null && current.photo_id) deletePhoto(ctx, current.photo_id);
        if (current.visibility === 'private' && visibility === 'shared') {
          notifyPartner(ctx, user.id, { title: '两个人', body: '对方写了一篇日记', url: '/#diary', tag: 'diary' }, 'diary');
        }
        sendJson(res, 200, { entry: presentDiary(loadDiary(ctx, id, user.id), user.id) });
      } catch (error) {
        if (createdPhoto) deletePhoto(ctx, createdPhoto);
        throw error;
      }
    } finally {
      if (file) fs.rm(file.tmp, { force: true }, () => {});
    }
  });

  router.delete('/api/diary/:id', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const row = loadOwnDiary(ctx, id, user.id);
    ctx.db.prepare('DELETE FROM diary_entries WHERE id = ? AND user_id = ?').run(id, user.id);
    if (row.photo_id) deletePhoto(ctx, row.photo_id);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/checklist', async (req, res) => {
    const user = requireUser(ctx, req);
    const rows = ctx.db.prepare(`
      SELECT c.*, u.display_name AS completed_name
      FROM checklist_items c
      LEFT JOIN users u ON u.id = c.completed_by
      ORDER BY c.sort_order ASC, c.id ASC
    `).all();
    sendJson(res, 200, { items: rows.map((row) => presentChecklist(row)), viewerId: user.id });
  });

  router.post('/api/checklist', async (req, res) => {
    const user = requireUser(ctx, req);
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM checklist_items').get().count;
    if (count >= 200) throw httpError(400, '清单已经够长了');
    const title = asText((await readJson(req)).title, 1, 40, '清单');
    const maxOrder = ctx.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM checklist_items').get().max_order;
    const info = ctx.db.prepare(`
      INSERT INTO checklist_items (title, preset, sort_order, created_by, created_at, note)
      VALUES (?, 0, ?, ?, ?, '')
    `).run(title, maxOrder + 1, user.id, nowIso());
    sendJson(res, 201, { item: presentChecklist(loadChecklistItem(ctx, Number(info.lastInsertRowid))) });
  });

  router.patch('/api/checklist/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    loadChecklistItem(ctx, id);
    const title = asText((await readJson(req)).title, 1, 40, '清单');
    ctx.db.prepare('UPDATE checklist_items SET title = ? WHERE id = ?').run(title, id);
    sendJson(res, 200, { item: presentChecklist(loadChecklistItem(ctx, id)) });
  });

  router.delete('/api/checklist/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const item = ctx.db.prepare('SELECT photo_id FROM checklist_items WHERE id = ?').get(id);
    if (!item) throw httpError(404, '找不到这一项');
    ctx.db.prepare('DELETE FROM checklist_items WHERE id = ?').run(id);
    if (item.photo_id) deletePhoto(ctx, item.photo_id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/checklist/:id/complete', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const item = ctx.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id);
    if (!item) throw httpError(404, '找不到这一项');
    const input = await readEntryInput(req, ctx);
    let file = null;
    try {
      file = assertFile(input.file, ctx.config);
      const note = input.fields.note == null || input.fields.note === '' ? '' : asText(String(input.fields.note), 0, 200, '备注');
      let photoId = item.photo_id;
      let created = null;
      const wasDone = Boolean(item.completed_at);
      try {
        if (file) {
          created = await savePhoto(ctx, user.id, file.tmp, 'checklist', '');
          photoId = created;
        }
        const now = nowIso();
        ctx.db.prepare(`
          UPDATE checklist_items
          SET completed_at = COALESCE(completed_at, ?),
              completed_by = COALESCE(completed_by, ?),
              note = ?,
              photo_id = ?
          WHERE id = ?
        `).run(now, user.id, note, photoId, id);
        if (created && item.photo_id) deletePhoto(ctx, item.photo_id);
        if (!wasDone) {
          notifyPartner(ctx, user.id, {
            title: '两个人',
            body: `对方完成了「${item.title}」`,
            url: '/#list',
            tag: 'checklist',
          }, 'checklist');
        }
        sendJson(res, 200, { item: presentChecklist(loadChecklistItem(ctx, id)) });
      } catch (error) {
        if (created) deletePhoto(ctx, created);
        throw error;
      }
    } finally {
      if (file) fs.rm(file.tmp, { force: true }, () => {});
    }
  });

  router.post('/api/checklist/:id/uncomplete', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const item = ctx.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id);
    if (!item) throw httpError(404, '找不到这一项');
    ctx.db.prepare(`
      UPDATE checklist_items
      SET completed_at = NULL, completed_by = NULL, note = '', photo_id = NULL
      WHERE id = ?
    `).run(id);
    if (item.photo_id) deletePhoto(ctx, item.photo_id);
    sendJson(res, 200, { item: presentChecklist(loadChecklistItem(ctx, id)) });
  });

  router.get('/api/daily/today', async (req, res) => {
    const user = requireUser(ctx, req);
    const today = clock(ctx).date;
    ensureTodayQuestion(ctx.db, today);
    sendJson(res, 200, { daily: dailyState(ctx.db, user.id, today) });
  });

  router.post('/api/daily/today', async (req, res) => {
    const user = requireUser(ctx, req);
    const answer = asText((await readJson(req)).answer, 1, 2000, '回答');
    const today = clock(ctx).date;
    ensureTodayQuestion(ctx.db, today);
    const partner = ctx.db.prepare('SELECT id FROM users WHERE id != ?').get(user.id);
    const existing = ctx.db.prepare('SELECT answer FROM daily_answers WHERE day = ? AND user_id = ?').get(today, user.id);
    const theirs = partner
      ? ctx.db.prepare('SELECT answer FROM daily_answers WHERE day = ? AND user_id = ?').get(today, partner.id)
      : null;
    if (existing && theirs) throw httpError(409, '今天的答案已经揭晓，不能再改');
    const now = nowIso();
    if (existing) {
      ctx.db.prepare('UPDATE daily_answers SET answer = ?, updated_at = ? WHERE day = ? AND user_id = ?').run(answer, now, today, user.id);
    } else {
      ctx.db.prepare(`
        INSERT INTO daily_answers (day, user_id, answer, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(today, user.id, answer, now, now);
      const state = dailyState(ctx.db, user.id, today);
      notifyPartner(ctx, user.id, {
        title: '两个人',
        body: state.revealed ? '今天的答案可以看了' : '对方回答了今天的问题',
        url: '/#ask',
        tag: 'daily',
      }, null);
    }
    sendJson(res, 200, { daily: dailyState(ctx.db, user.id, today) });
  });

  router.get('/api/daily/history', async (req, res) => {
    const user = requireUser(ctx, req);
    const today = clock(ctx).date;
    const limit = asLimit(req.query.limit, 30, 100);
    const partner = ctx.db.prepare('SELECT id, display_name FROM users WHERE id != ?').get(user.id);
    const rows = ctx.db.prepare(`
      SELECT d.day, q.text AS question, mine.answer AS my_answer, theirs.answer AS their_answer
      FROM daily_questions d
      JOIN question_pool q ON q.id = d.question_id
      LEFT JOIN daily_answers mine ON mine.day = d.day AND mine.user_id = ?
      LEFT JOIN daily_answers theirs ON theirs.day = d.day AND theirs.user_id = ?
      WHERE d.day < ?
      ORDER BY d.day DESC
      LIMIT ?
    `).all(user.id, partner?.id || 0, today, limit);
    sendJson(res, 200, {
      today,
      items: rows.map((row) => {
        const revealed = Boolean(row.my_answer && row.their_answer);
        return {
          date: row.day,
          question: row.question,
          myAnswer: row.my_answer,
          partnerAnswer: revealed ? row.their_answer : null,
          partnerAnswered: Boolean(row.their_answer),
          revealed,
          partnerName: partner?.display_name || '',
        };
      }),
    });
  });

  router.get('/api/push/public-key', async (req, res) => {
    requireUser(ctx, req);
    sendJson(res, 200, { publicKey: ctx.vapidPublicKey });
  });

  router.post('/api/push/subscribe', async (req, res) => {
    const user = requireUser(ctx, req);
    const body = await readJson(req);
    const endpoint = asEndpoint(body.endpoint);
    const keys = body.keys || {};
    ctx.db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = excluded.created_at
    `).run(user.id, endpoint, asPushKey(keys.p256dh), asPushKey(keys.auth), nowIso());
    const extra = ctx.db.prepare('SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC').all(user.id);
    for (const row of extra.slice(5)) ctx.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
    sendJson(res, 200, { ok: true, pushDevices: presentMe(ctx.db, user.id).pushDevices });
  });

  router.delete('/api/push/subscribe', async (req, res) => {
    const user = requireUser(ctx, req);
    const endpoint = asEndpoint((await readJson(req)).endpoint);
    ctx.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, endpoint);
    sendJson(res, 200, { ok: true, pushDevices: presentMe(ctx.db, user.id).pushDevices });
  });

  router.post('/api/export', async (req, res) => {
    const user = requireUser(ctx, req);
    const me = presentMe(ctx.db, user.id);
    const diary = ctx.db.prepare(`
      SELECT d.id, d.visibility, d.mood, d.content, d.photo_id, d.created_at, d.updated_at, u.display_name AS author_name
      FROM diary_entries d
      JOIN users u ON u.id = d.user_id
      WHERE d.visibility = 'shared' OR d.user_id = ?
      ORDER BY d.id
    `).all(user.id).map((row) => presentDiary(row, user.id));
    const anniversaries = ctx.db.prepare('SELECT id, title, date, yearly FROM anniversaries ORDER BY id').all();
    const checklist = ctx.db.prepare(`
      SELECT c.*, u.display_name AS completed_name
      FROM checklist_items c
      LEFT JOIN users u ON u.id = c.completed_by
      ORDER BY c.sort_order, c.id
    `).all().map((row) => presentChecklist(row));
    const todos = ctx.db.prepare(`
      SELECT t.*, author.display_name AS author_name, done.display_name AS completed_name
      FROM todos t
      JOIN users author ON author.id = t.created_by
      LEFT JOIN users done ON done.id = t.completed_by
      WHERE t.audience = 'shared' OR t.audience = 'assigned' OR (t.audience = 'private' AND t.owner_id = ?)
      ORDER BY t.id
    `).all(user.id);
    const partner = ctx.db.prepare('SELECT id FROM users WHERE id != ?').get(user.id);
    const answers = ctx.db.prepare(`
      SELECT d.day, q.text AS question, mine.answer AS my_answer, theirs.answer AS their_answer
      FROM daily_questions d
      JOIN question_pool q ON q.id = d.question_id
      LEFT JOIN daily_answers mine ON mine.day = d.day AND mine.user_id = ?
      LEFT JOIN daily_answers theirs ON theirs.day = d.day AND theirs.user_id = ?
      ORDER BY d.day
    `).all(user.id, partner?.id || 0).map((row) => {
      const revealed = Boolean(row.my_answer && row.their_answer);
      return {
        date: row.day,
        question: row.question,
        myAnswer: row.my_answer,
        partnerAnswer: revealed ? row.their_answer : null,
      };
    });
    const photos = ctx.db.prepare('SELECT * FROM photos ORDER BY id').all().filter((photo) => canViewPhoto(ctx.db, user.id, photo));
    const ZipFile = yazl.ZipFile ? yazl.ZipFile : yazl.default.ZipFile;
    const zip = new ZipFile();
    const manifest = {
      app: '两个人',
      exportedAt: nowIso(),
      exportedBy: me.displayName,
      note: '包含双方可见的内容、你自己的私密日记和私密待办，以及你能看到的照片。不包含对方仅自己可见的日记和待办。',
    };
    zip.addBuffer(Buffer.from(JSON.stringify({ manifest, togetherSince: me.togetherSince, timezone: me.timezone }, null, 2)), 'manifest.json');
    zip.addBuffer(Buffer.from(JSON.stringify(diary, null, 2)), 'diary.json');
    zip.addBuffer(Buffer.from(JSON.stringify(anniversaries, null, 2)), 'anniversaries.json');
    zip.addBuffer(Buffer.from(JSON.stringify(checklist, null, 2)), 'checklist.json');
    zip.addBuffer(Buffer.from(JSON.stringify(todos, null, 2)), 'todos.json');
    zip.addBuffer(Buffer.from(JSON.stringify(answers, null, 2)), 'daily.json');
    for (const photo of photos) {
      const full = mediaPath(ctx.config.dataDir, 'photos', photo.stored_name);
      if (fs.existsSync(full)) zip.addFile(full, `photos/${photo.id}.jpg`);
    }
    const filename = `couple-export-${clock(ctx).date}.zip`;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    zip.outputStream.on('error', () => res.destroy());
    zip.outputStream.pipe(res);
    zip.end();
  });

  router.post('/api/danger/wipe', async (req, res) => {
    const user = requireUser(ctx, req);
    await confirmDanger(ctx, user, await readJson(req), '清空内容');
    emptyContent(ctx.db);
    emptyMedia(ctx.config.dataDir);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/danger/reset', async (req, res) => {
    const user = requireUser(ctx, req);
    await confirmDanger(ctx, user, await readJson(req), '删除全部');
    emptyEverything(ctx.db);
    emptyMedia(ctx.config.dataDir);
    clearSessionCookie(res, req, ctx.config);
    sendJson(res, 200, { ok: true, redirect: 'setup' });
  });
}
