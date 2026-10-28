import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { TIMEZONES } from './content.js';
import { publicDir } from './config.js';
import { openDatabase } from './db.js';
import { cookieIsSecure, createRouter, httpError, sendJson, sendStatic } from './http.js';
import { sweepTmp } from './images.js';
import { createLimiter } from './limiter.js';
import { initVapid, sendPush } from './push.js';
import { registerRoutes } from './routes.js';
import { startScheduler } from './scheduler.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8787,
  dataDir: path.join(publicDir, '..', 'data'),
  sessionDays: 30,
  maxUploadBytes: 12 * 1024 * 1024,
  maxPhotos: 2000,
  reminderHour: 9,
  trustProxy: false,
  cookieSecure: null,
  vapidSubject: 'mailto:couple@localhost',
  defaultTimezone: 'Asia/Shanghai',
  passwordN: 16384,
  loginLimit: 8,
  icsLimit: 60,
  schedule: false,
  quiet: false,
  now: () => new Date(),
  onNotify: null,
};

function applyHeaders(req, res, config) {
  res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; connect-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('x-permitted-cross-domain-policies', 'none');
  if (cookieIsSecure(req, config)) res.setHeader('strict-transport-security', 'max-age=15552000');
}

export function createApp(overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  config.dataDir = path.resolve(config.dataDir);
  config.port = Number(config.port);
  config.sessionDays = Number(config.sessionDays);
  config.maxUploadBytes = Number(config.maxUploadBytes);
  config.maxPhotos = Number(config.maxPhotos);
  config.reminderHour = Number(config.reminderHour);
  config.passwordN = Number(config.passwordN);
  config.loginLimit = Number(config.loginLimit);
  config.icsLimit = Number(config.icsLimit);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('PORT 不正确');
  if (!(config.sessionDays >= 1 && config.sessionDays <= 180)) throw new Error('SESSION_DAYS 需要在 1 到 180 之间');
  const uploadMb = config.maxUploadBytes / 1024 / 1024;
  if (uploadMb < 1 || uploadMb > 30) throw new Error('MAX_UPLOAD_MB 需要在 1 到 30 之间');
  if (!Number.isInteger(config.reminderHour) || config.reminderHour < 0 || config.reminderHour > 23) {
    throw new Error('REMINDER_HOUR 需要在 0 到 23 之间');
  }
  if (!TIMEZONES.some(([id]) => id === config.defaultTimezone)) {
    throw new Error(`不支持的 DEFAULT_TIMEZONE：${config.defaultTimezone}`);
  }
  if (!Number.isInteger(config.icsLimit) || config.icsLimit < 1 || config.icsLimit > 1000) {
    throw new Error('日历订阅的速率限制不正确');
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const folder of ['photos', 'thumbs', 'tmp']) fs.mkdirSync(path.join(config.dataDir, folder), { recursive: true });
  sweepTmp(config.dataDir);
  const db = openDatabase(config.dataDir);
  const vapidPublicKey = initVapid(config.dataDir, config.vapidSubject);
  const limiter = createLimiter(config.loginLimit);
  const icsLimiter = createLimiter(config.icsLimit);

  async function notify(userId, payload) {
    if (typeof config.onNotify === 'function') config.onNotify(userId, payload);
    await sendPush(db, userId, payload);
  }

  const ctx = { db, config, vapidPublicKey, limiter, icsLimiter, notify };
  const router = createRouter();
  registerRoutes(router, ctx);
  const stopSchedule = config.schedule ? startScheduler(db, config, notify) : () => {};

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      if (config.quiet) return;
      let pathname = req.url || '';
      try {
        pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      } catch {
        pathname = req.url || '';
      }
      if (pathname === '/api/health') return;
      if (pathname.startsWith('/api/cal/')) pathname = '/api/cal/[redacted]';
      console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });
    try {
      applyHeaders(req, res, config);
      if (!req.url || req.url.length > 2048) throw httpError(414, '地址太长');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'couple') {
          throw httpError(403, '缺少安全校验');
        }
        const handled = await router.handle(req, res);
        if (!handled && !res.headersSent) throw httpError(404, '没有这个接口');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, '不支持的方法');
      await sendStatic(req, res, publicDir, url.pathname);
    } catch (error) {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        if (!error.expose) console.error(error);
        return;
      }
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      if (error.headers) {
        for (const [key, value] of Object.entries(error.headers)) res.setHeader(key, value);
      }
      sendJson(res, status, { error: error.expose ? error.message : '服务器开小差了' });
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 20000;
  server.timeout = 300000;

  let closed = false;
  return {
    server,
    db,
    config,
    vapidPublicKey,
    async close() {
      if (closed) return;
      closed = true;
      stopSchedule();
      if (server.listening) {
        await new Promise((resolve) => {
          server.close(() => resolve());
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        });
      }
      try { db.close(); } catch { /* 重复关闭时忽略 */ }
    },
  };
}
