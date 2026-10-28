import fs from 'node:fs';
import path from 'node:path';
import { nowIso, getSetting } from './db.js';
import { httpError, readJson, readMultipart, sendJson } from './http.js';
import { processImage, removeStored } from './images.js';
import { CUISINES, MODES, decide, recentCuisineIds } from '../public/js/eat-decide.js';
import { zonedParts } from './time.js';
import { asId, asText } from './validate.js';

const ENERGIES = new Set(['tired', 'ok', 'fresh']);
const MOODS = new Set(['any', 'light', 'treat', 'lively']);
const BUDGETS = new Set(['low', 'mid', 'high']);
const LEVELS = new Set(['skip', 'ok', 'love', 'crave']);
const MODE_IDS = new Set(MODES.map((mode) => mode.id));
const CUISINE_IDS = new Set(CUISINES.map((cuisine) => cuisine.id));
const PLATFORMS = new Set(['doordash', 'ubereats', 'fantuan', 'other', '']);

function today(ctx) {
  const zone = getSetting(ctx.db, 'timezone', ctx.config.defaultTimezone);
  return zonedParts(ctx.config.now(), zone).date;
}

function partnerOf(db, userId) {
  return db.prepare('SELECT id FROM users WHERE id != ?').get(userId) || null;
}

function parseVote(body) {
  if (!ENERGIES.has(body.energy)) throw httpError(400, '请选择累不累');
  if (!MOODS.has(body.mood)) throw httpError(400, '请选择心情');
  if (!BUDGETS.has(body.budget)) throw httpError(400, '请选择预算');
  if (!MODE_IDS.has(body.mode)) throw httpError(400, '请选择怎么吃');
  const source = body.cuisines && typeof body.cuisines === 'object' ? body.cuisines : {};
  const cuisines = {};
  for (const id of CUISINE_IDS) {
    const level = source[id] || 'ok';
    if (!LEVELS.has(level)) throw httpError(400, '菜系选择不正确');
    cuisines[id] = level;
  }
  return { energy: body.energy, mood: body.mood, budget: body.budget, mode: body.mode, cuisines };
}

function asHttps(value) {
  if (value == null || value === '') return '';
  const text = asText(String(value), 1, 300, '链接');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw httpError(400, '链接需要以 https:// 开头');
  }
  if (url.protocol !== 'https:') throw httpError(400, '链接需要以 https:// 开头');
  return url.toString();
}

function readPlace(body) {
  const name = asText(body.name, 1, 40, '店名');
  if (!CUISINE_IDS.has(body.cuisine)) throw httpError(400, '请选择菜系');
  if (body.mode !== 'out' && body.mode !== 'delivery') throw httpError(400, '请选择出去吃或点外卖');
  const platform = body.platform == null || body.platform === '' ? '' : String(body.platform);
  if (!PLATFORMS.has(platform)) throw httpError(400, '平台不正确');
  const note = body.note == null || body.note === '' ? '' : asText(String(body.note), 0, 200, '备注');
  return {
    name,
    cuisine: body.cuisine,
    mode: body.mode,
    platform,
    url: asHttps(body.url),
    note,
    visited: body.visited ? 1 : 0,
  };
}

function recentFromLogs(ctx, day) {
  const zone = getSetting(ctx.db, 'timezone', ctx.config.defaultTimezone);
  const rows = ctx.db.prepare('SELECT cuisine, created_at FROM meal_logs').all();
  return recentCuisineIds(rows.map((row) => ({
    cuisine: row.cuisine,
    date: zonedParts(new Date(row.created_at), zone).date,
  })), day);
}

function listPlaces(db) {
  return db.prepare('SELECT id, name, cuisine, mode, platform, url, note, visited, created_at FROM places ORDER BY id DESC').all()
    .map((row) => ({ ...row, visited: row.visited === 1 }));
}

function openRound(db, day) {
  return db.prepare("SELECT * FROM meal_rounds WHERE day = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(day) || null;
}

function latestRound(db, day) {
  return openRound(db, day) || db.prepare('SELECT * FROM meal_rounds WHERE day = ? ORDER BY id DESC LIMIT 1').get(day) || null;
}

function votesOf(db, roundId) {
  return db.prepare('SELECT * FROM meal_votes WHERE round_id = ? ORDER BY id').all(roundId).map((row) => ({
    userId: row.user_id,
    energy: row.energy,
    mood: row.mood,
    budget: row.budget,
    mode: row.mode,
    cuisines: JSON.parse(row.cuisines),
  }));
}

function presentRound(db, round, userId) {
  if (!round) return null;
  const votes = votesOf(db, round.id);
  const mine = votes.some((vote) => vote.userId === userId);
  const partner = votes.some((vote) => vote.userId !== userId);
  const revealed = round.status === 'revealed';
  return {
    id: round.id,
    day: round.day,
    status: round.status,
    mineSubmitted: mine,
    partnerSubmitted: partner,
    rerolls: round.rerolls,
    partnerActive: partnerBusy(db, userId) && !partner,
    result: revealed ? {
      mode: round.result_mode,
      modeName: MODES.find((mode) => mode.id === round.result_mode)?.name || '',
      cuisine: round.result_cuisine,
      cuisineName: CUISINES.find((cuisine) => cuisine.id === round.result_cuisine)?.name || '',
      emoji: CUISINES.find((cuisine) => cuisine.id === round.result_cuisine)?.emoji || '',
      quip: round.result_quip || '就这么定了。',
      usedFallback: round.result_fallback === 1,
      wheel: round.result_wheel ? JSON.parse(round.result_wheel) : [],
      places: suggestFor(db, round.result_mode, round.result_cuisine),
    } : null,
  };
}

function partnerBusy(db, userId) {
  const partner = partnerOf(db, userId);
  if (!partner) return false;
  const row = db.prepare('SELECT updated_at FROM meal_presence WHERE user_id = ?').get(partner.id);
  if (!row) return false;
  return Date.now() - Date.parse(row.updated_at) < 20000;
}

function suggestFor(db, mode, cuisine) {
  return listPlaces(db).filter((place) => place.cuisine === cuisine && (mode === 'cook' || place.mode === mode)).slice(0, 3);
}

function reveal(ctx, round) {
  const votes = votesOf(ctx.db, round.id).map(({ userId, ...vote }) => vote);
  const result = decide({
    votes,
    recentCuisines: recentFromLogs(ctx, round.day),
    places: listPlaces(ctx.db),
  });
  if (!result.ok) throw httpError(400, '这轮没有能选的菜系，放宽一点再试');
  const now = nowIso();
  ctx.db.prepare(`
    UPDATE meal_rounds
    SET status = 'revealed', result_mode = ?, result_cuisine = ?, result_quip = ?,
        result_fallback = ?, result_wheel = ?, revealed_at = ?
    WHERE id = ?
  `).run(result.mode.id, result.cuisine.id, result.quip, result.usedFallback ? 1 : 0, JSON.stringify(result.wheel || []), now, round.id);
  return result;
}

async function saveAlbumPhoto(ctx, userId, tmp) {
  const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM photos').get().count;
  if (count >= ctx.config.maxPhotos) throw httpError(400, '照片太多了，先删掉一些再上传');
  const image = await processImage(tmp, ctx.config.dataDir);
  try {
    const info = ctx.db.prepare(`
      INSERT INTO photos (user_id, kind, stored_name, width, height, bytes, caption, created_at)
      VALUES (?, 'album', ?, ?, ?, ?, ?, ?)
    `).run(userId, image.storedName, image.width, image.height, image.bytes, '今天吃啥', nowIso());
    return Number(info.lastInsertRowid);
  } catch (error) {
    removeStored(ctx.config.dataDir, image.storedName);
    throw error;
  }
}

export function registerEat(router, ctx, { requireUser, notifyPartner }) {
  router.get('/api/eat/today', async (req, res) => {
    const user = requireUser(ctx, req);
    const day = today(ctx);
    const round = latestRound(ctx.db, day);
    sendJson(res, 200, {
      today: day,
      partnerActive: partnerBusy(ctx.db, user.id),
      round: presentRound(ctx.db, round, user.id),
      places: listPlaces(ctx.db),
      logs: ctx.db.prepare(`
        SELECT id, mode, cuisine, place_name, rating, note, photo_id, created_at
        FROM meal_logs ORDER BY id DESC LIMIT 40
      `).all(),
      recentCuisines: recentFromLogs(ctx, day),
    });
  });

  router.post('/api/eat/presence', async (req, res) => {
    const user = requireUser(ctx, req);
    ctx.db.prepare(`
      INSERT INTO meal_presence (user_id, updated_at) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(user.id, nowIso());
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/eat/vote', async (req, res) => {
    const user = requireUser(ctx, req);
    const vote = parseVote(await readJson(req));
    const day = today(ctx);
    let round = openRound(ctx.db, day);
    if (!round) {
      const info = ctx.db.prepare(`
        INSERT INTO meal_rounds (day, status, rerolls, created_at) VALUES (?, 'open', 0, ?)
      `).run(day, nowIso());
      round = ctx.db.prepare('SELECT * FROM meal_rounds WHERE id = ?').get(Number(info.lastInsertRowid));
    }
    const existing = ctx.db.prepare('SELECT id FROM meal_votes WHERE round_id = ? AND user_id = ?').get(round.id, user.id);
    if (existing) throw httpError(409, '这轮你已经选过了');
    ctx.db.prepare(`
      INSERT INTO meal_votes (round_id, user_id, energy, mood, budget, mode, cuisines, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(round.id, user.id, vote.energy, vote.mood, vote.budget, vote.mode, JSON.stringify(vote.cuisines), nowIso());
    const partner = partnerOf(ctx.db, user.id);
    const votes = votesOf(ctx.db, round.id);
    const partnerVoted = votes.some((item) => item.userId !== user.id);
    if (partner && !partnerVoted) {
      notifyPartner(ctx, user.id, { title: '两个人', body: 'TA 已经选好了', url: '/eat', tag: 'meal' }, 'meal');
    }
    if (votes.length >= 2 || !partner) {
      reveal(ctx, round);
      if (partner) {
        notifyPartner(ctx, user.id, { title: '两个人', body: '今天吃什么可以看了', url: '/eat', tag: 'meal' }, 'meal-ready');
      }
    }
    const fresh = ctx.db.prepare('SELECT * FROM meal_rounds WHERE id = ?').get(round.id);
    sendJson(res, 200, { round: presentRound(ctx.db, fresh, user.id) });
  });

  router.post('/api/eat/rounds/:id/reroll', async (req, res) => {
    const user = requireUser(ctx, req);
    const id = asId(req.params.id);
    const round = ctx.db.prepare('SELECT * FROM meal_rounds WHERE id = ?').get(id);
    if (!round || round.status !== 'revealed') throw httpError(404, '这轮还不能换');
    if (round.rerolls >= 1) throw httpError(409, '这轮只能再换一次');
    const votes = votesOf(ctx.db, round.id).map(({ userId, ...vote }) => vote);
    const result = decide({
      votes,
      recentCuisines: recentFromLogs(ctx, round.day),
      places: listPlaces(ctx.db),
      previous: { cuisine: round.result_cuisine, mode: round.result_mode },
      reroll: true,
    });
    if (!result.ok) throw httpError(409, '没有别的选择了');
    ctx.db.prepare(`
      UPDATE meal_rounds
      SET result_mode = ?, result_cuisine = ?, result_quip = ?, result_fallback = ?, result_wheel = ?, rerolls = rerolls + 1
      WHERE id = ?
    `).run(result.mode.id, result.cuisine.id, result.quip, result.usedFallback ? 1 : 0, JSON.stringify(result.wheel || []), round.id);
    const fresh = ctx.db.prepare('SELECT * FROM meal_rounds WHERE id = ?').get(round.id);
    sendJson(res, 200, { round: presentRound(ctx.db, fresh, user.id) });
  });

  router.get('/api/eat/places', async (req, res) => {
    requireUser(ctx, req);
    sendJson(res, 200, { places: listPlaces(ctx.db) });
  });

  router.post('/api/eat/places', async (req, res) => {
    const user = requireUser(ctx, req);
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM places').get().count;
    if (count >= 200) throw httpError(400, '想去的店太多了，先删掉一些');
    const place = readPlace(await readJson(req));
    const info = ctx.db.prepare(`
      INSERT INTO places (name, cuisine, mode, platform, url, note, visited, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(place.name, place.cuisine, place.mode, place.platform, place.url, place.note, place.visited, user.id, nowIso());
    sendJson(res, 201, { place: listPlaces(ctx.db).find((item) => item.id === Number(info.lastInsertRowid)) });
  });

  router.patch('/api/eat/places/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const current = ctx.db.prepare('SELECT id FROM places WHERE id = ?').get(id);
    if (!current) throw httpError(404, '找不到这家店');
    const place = readPlace(await readJson(req));
    ctx.db.prepare(`
      UPDATE places SET name = ?, cuisine = ?, mode = ?, platform = ?, url = ?, note = ?, visited = ? WHERE id = ?
    `).run(place.name, place.cuisine, place.mode, place.platform, place.url, place.note, place.visited, id);
    sendJson(res, 200, { place: listPlaces(ctx.db).find((item) => item.id === id) });
  });

  router.delete('/api/eat/places/:id', async (req, res) => {
    requireUser(ctx, req);
    const id = asId(req.params.id);
    const info = ctx.db.prepare('DELETE FROM places WHERE id = ?').run(id);
    if (info.changes !== 1) throw httpError(404, '找不到这家店');
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/eat/logs', async (req, res) => {
    const user = requireUser(ctx, req);
    const type = String(req.headers['content-type'] || '');
    let fields = {};
    let file = null;
    if (type.includes('multipart/form-data')) {
      const form = await readMultipart(req, { tmpDir: path.join(ctx.config.dataDir, 'tmp'), maxFileBytes: ctx.config.maxUploadBytes });
      fields = form.fields;
      file = form.files[0] || null;
    } else {
      fields = await readJson(req);
    }
    try {
      if (!MODE_IDS.has(fields.mode) || !CUISINE_IDS.has(fields.cuisine)) throw httpError(400, '请先决定吃什么');
      const note = fields.note == null || fields.note === '' ? '' : asText(String(fields.note), 0, 200, '备注');
      let rating = null;
      if (fields.rating != null && fields.rating !== '') {
        rating = Number(fields.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, '评分是 1 到 5');
      }
      let placeId = null;
      let placeName = fields.placeName == null ? '' : asText(String(fields.placeName), 0, 40, '店名');
      if (fields.placeId) {
        placeId = asId(fields.placeId);
        const place = ctx.db.prepare('SELECT id, name FROM places WHERE id = ?').get(placeId);
        if (!place) throw httpError(400, '找不到这家店');
        placeName = place.name;
        ctx.db.prepare('UPDATE places SET visited = 1 WHERE id = ?').run(placeId);
      }
      let photoId = null;
      if (file && !file.truncated) photoId = await saveAlbumPhoto(ctx, user.id, file.tmp);
      const roundId = fields.roundId ? asId(fields.roundId) : null;
      const info = ctx.db.prepare(`
        INSERT INTO meal_logs (round_id, mode, cuisine, place_id, place_name, rating, note, photo_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(roundId, fields.mode, fields.cuisine, placeId, placeName, rating, note, photoId, user.id, nowIso());
      sendJson(res, 201, { id: Number(info.lastInsertRowid) });
    } finally {
      if (file) fs.rm(file.tmp, { force: true }, () => {});
    }
  });
}
