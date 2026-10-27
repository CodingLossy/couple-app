import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from './db.js';

const scrypt = promisify(scryptCallback);
let dummyPromise = null;

function scryptOptions(cost) {
  return { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
}

export async function hashPassword(password, cost = 16384) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, scryptOptions(cost));
  return `scrypt$${cost}$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function dummyHash(cost) {
  if (!dummyPromise) dummyPromise = hashPassword('not-a-real-password', cost);
  return dummyPromise;
}

export async function verifyPassword(password, stored, cost = 16384) {
  const target = stored || await dummyHash(cost);
  const parts = String(target).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = await scrypt(password, salt, expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSession(db, userId, sessionDays) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionDays * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    tokenHash,
    expires.toISOString(),
    now.toISOString(),
  );
  return { token, maxAge: sessionDays * 86400 };
}

export function readSession(db, token) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export function revokeUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function revokeToken(db, token) {
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export async function resetPassword(db, username, password, cost, asPassword) {
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) {
    const names = db.prepare('SELECT username FROM users ORDER BY id').all().map((row) => row.username);
    const error = new Error(names.length ? `没有这个用户。现有用户：${names.join('、')}` : '还没有用户');
    error.expose = true;
    throw error;
  }
  const checked = asPassword(password);
  const passwordHash = await hashPassword(checked, cost);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    revokeUserSessions(db, user.id);
  });
  tx();
  return user;
}
