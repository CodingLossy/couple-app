import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, '..');
export const publicDir = path.join(rootDir, 'public');

export function loadEnvFile(file = path.join(rootDir, '.env')) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

export function loadConfig(env = process.env) {
  const maxMb = Number(env.MAX_UPLOAD_MB || 12);
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    dataDir: env.DATA_DIR || path.join(rootDir, 'data'),
    sessionDays: Number(env.SESSION_DAYS || 30),
    maxUploadBytes: (Number.isFinite(maxMb) ? maxMb : 12) * 1024 * 1024,
    maxPhotos: Number(env.MAX_PHOTOS || 2000),
    reminderHour: Number(env.REMINDER_HOUR || 9),
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: env.COOKIE_SECURE === '1' ? true : env.COOKIE_SECURE === '0' ? false : null,
    vapidSubject: env.VAPID_SUBJECT || 'mailto:couple@localhost',
    defaultTimezone: env.DEFAULT_TIMEZONE || 'Asia/Shanghai',
  };
}
