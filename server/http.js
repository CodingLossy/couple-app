import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import BusboyImport from 'busboy';

export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.expose = true;
    this.headers = headers;
  }
}

export function httpError(status, message, headers) {
  return new HttpError(status, message, headers);
}

function busboy(options) {
  const fn = typeof BusboyImport === 'function' ? BusboyImport : BusboyImport.default;
  return fn(options);
}

export function createRouter() {
  const routes = [];
  function add(method, pathname, handler) {
    const keys = [];
    const pattern = pathname.split(/:([A-Za-z0-9_]+)/).map((part, index) => {
      if (index % 2 === 1) {
        keys.push(part);
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    routes.push({ method, regex: new RegExp(`^${pattern}$`), keys, handler });
  }
  return {
    get: (pathname, handler) => add('GET', pathname, handler),
    post: (pathname, handler) => add('POST', pathname, handler),
    patch: (pathname, handler) => add('PATCH', pathname, handler),
    delete: (pathname, handler) => add('DELETE', pathname, handler),
    async handle(req, res) {
      const url = new URL(req.url, 'http://127.0.0.1');
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = url.pathname.match(route.regex);
        if (!match) continue;
        const params = {};
        route.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(match[index + 1]);
        });
        req.params = params;
        req.query = Object.fromEntries(url.searchParams.entries());
        await route.handler(req, res);
        return true;
      }
      return false;
    },
  };
}

export function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', body.length);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

export function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

export function cookieIsSecure(req, config) {
  if (config.cookieSecure === true) return true;
  if (config.cookieSecure === false) return false;
  return Boolean(config.trustProxy && req.headers['x-forwarded-proto'] === 'https');
}

export function setSessionCookie(res, req, config, token, maxAge) {
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (cookieIsSecure(req, config)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, req, config) {
  const parts = ['sid=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieIsSecure(req, config)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 80);
  }
  return req.socket.remoteAddress || 'local';
}

export function readJson(req, { limit = 128 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json')) {
      reject(httpError(400, '请使用 JSON'));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(httpError(413, '请求太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          reject(httpError(400, '请求格式不正确'));
          return;
        }
        resolve(data);
      } catch {
        reject(httpError(400, '请求格式不正确'));
      }
    });
    req.on('error', fail);
  });
}

export function readMultipart(req, { tmpDir, maxFileBytes, maxFiles = 1 }) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: maxFiles,
          fileSize: maxFileBytes,
          fields: 12,
          fieldSize: 32 * 1024,
          parts: 16,
        },
      });
    } catch {
      reject(httpError(400, '上传格式不正确'));
      return;
    }
    const fields = {};
    const files = [];
    let pending = 0;
    let ended = false;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      for (const file of files) fs.rm(file.tmp, { force: true }, () => {});
      reject(err.status ? err : httpError(400, '上传格式不正确'));
    };
    const finish = () => {
      if (failed || !ended || pending > 0) return;
      resolve({ fields, files });
    };
    parser.on('field', (name, value, info) => {
      if (info?.valueTruncated) {
        fail(httpError(400, '文字太长了'));
        return;
      }
      if (Object.keys(fields).length < 12) fields[name] = value;
    });
    parser.on('file', (_name, stream, info) => {
      if (files.length >= maxFiles) {
        stream.resume();
        return;
      }
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmp = path.join(tmpDir, `up-${randomBytes(8).toString('hex')}`);
      const output = fs.createWriteStream(tmp);
      let truncated = false;
      pending += 1;
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('error', fail);
      output.on('error', fail);
      stream.pipe(output);
      output.on('finish', () => {
        files.push({
          tmp,
          truncated,
          filename: path.basename(String(info.filename || 'photo')),
          mime: String(info.mimeType || ''),
        });
        pending -= 1;
        finish();
      });
    });
    parser.on('error', () => fail(httpError(400, '上传格式不正确')));
    parser.on('finish', () => {
      ended = true;
      finish();
    });
    req.on('error', fail);
    req.pipe(parser);
  });
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function resolvePublic(publicRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  if (relative.split('/').some((part) => part.startsWith('.'))) return null;
  const full = path.resolve(publicRoot, relative);
  const root = path.resolve(publicRoot);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export async function sendStatic(req, res, publicRoot, pathname) {
  const full = pathname === '/' ? path.join(publicRoot, 'index.html') : resolvePublic(publicRoot, pathname);
  if (!full) throw httpError(404, '没有这个页面');
  let stat = null;
  try {
    const found = await fs.promises.stat(full);
    if (found.isFile()) stat = found;
  } catch {
    stat = null;
  }
  const base = path.posix.basename(pathname);
  const looksLikeFile = base.includes('.');
  if (!stat) {
    if (pathname !== '/' && !looksLikeFile) return sendStatic(req, res, publicRoot, '/');
    throw httpError(404, '没有这个页面');
  }
  const ext = path.extname(full).toLowerCase();
  res.statusCode = 200;
  res.setHeader('content-type', STATIC_TYPES[ext] || 'application/octet-stream');
  res.setHeader('content-length', stat.size);
  if (base === 'sw.js' || base === 'index.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest') {
    res.setHeader('cache-control', 'no-cache');
  } else {
    res.setHeader('cache-control', 'public, max-age=86400');
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    fs.createReadStream(full).on('error', reject).pipe(res).on('finish', resolve).on('error', reject);
  });
}
