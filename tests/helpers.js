import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

export async function startApp(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couple-app-'));
  const notes = [];
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    passwordN: 1024,
    schedule: false,
    cookieSecure: false,
    quiet: true,
    loginLimit: 3,
    sessionDays: 30,
    maxUploadBytes: 1024 * 1024,
    onNotify(userId, payload) {
      notes.push({ userId, payload });
    },
    ...overrides,
    dataDir,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    app,
    notes,
    dataDir,
    port,
    base: `http://127.0.0.1:${port}`,
    async close() {
      try {
        await app.close();
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

export function jar() {
  const cookies = new Map();
  return {
    store(response) {
      const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const line of list) {
        const pair = line.split(';')[0];
        const index = pair.indexOf('=');
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value || /max-age=0/i.test(line)) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
  };
}

export async function request(base, cookies, pathname, options = {}) {
  const headers = { 'X-Requested-With': 'couple', ...(options.headers || {}) };
  if (cookies?.header()) headers.Cookie = cookies.header();
  let body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form) {
    headers['Content-Type'] = options.form.contentType;
    body = options.form.body;
  } else if (options.body) {
    body = options.body;
  }
  if (options.skipCsrf) delete headers['X-Requested-With'];
  const response = await fetch(base + pathname, { method: options.method || 'GET', headers, body, redirect: 'manual' });
  cookies?.store(response);
  const type = response.headers.get('content-type') || '';
  let data = null;
  if (options.raw) data = Buffer.from(await response.arrayBuffer());
  else if (type.includes('application/json')) data = await response.json();
  else data = await response.text();
  return { response, status: response.status, data };
}

export function formData({ fields = {}, file } = {}) {
  const boundary = `----couple${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    ));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function rawGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method: 'GET' }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
