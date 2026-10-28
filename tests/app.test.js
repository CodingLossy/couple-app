import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { createBackup, restoreBackup } from '../server/backup.js';
import { openDatabase } from '../server/db.js';
import { runReminderPass } from '../server/scheduler.js';
import { formData, jar, rawGet, request, startApp } from './helpers.js';

const USERS = [
  { username: 'xiaoman', password: 'secret-pass-1', displayName: '小满' },
  { username: 'xiaoqiu', password: 'secret-pass-2', displayName: '小秋' },
];

function setupBody() {
  return { togetherSince: '2024-02-14', timezone: 'Asia/Shanghai', reminderHour: 9, users: USERS };
}

async function tinyJpeg() {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 196, g: 84, b: 74 } } }).jpeg().toBuffer();
}

function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const files = {};
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks);
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

test('登录、权限、私密日记和每日一问', { timeout: 120000 }, async () => {
  const ctx = await startApp();
  const guest = jar();
  const personA = jar();
  const personB = jar();
  try {
    const health = await request(ctx.base, guest, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const homePage = await request(ctx.base, null, '/');
    assert.equal(homePage.status, 200);
    assert.match(homePage.data, /两个人/);
    assert.match(homePage.response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(homePage.response.headers.get('permissions-policy'), /geolocation=\(\)/);
    assert.doesNotMatch(homePage.data, /google-analytics|googletagmanager|doubleclick/i);

    const leaked = await rawGet(ctx.port, '/../server/auth.js');
    assert.notEqual(leaked.status, 200);
    assert.equal(leaked.body.includes('hashPassword'), false);
    const leakedEncoded = await rawGet(ctx.port, '/css/..%2f..%2fserver/auth.js');
    assert.equal(leakedEncoded.body.includes('scrypt'), false);

    const missingHeader = await request(ctx.base, guest, '/api/login', {
      method: 'POST',
      json: { username: 'xiaoman', password: 'secret-pass-1' },
      skipCsrf: true,
    });
    assert.equal(missingHeader.status, 403);

    const blocked = await request(ctx.base, guest, '/api/home');
    assert.equal(blocked.status, 401);

    const created = await request(ctx.base, guest, '/api/setup', { method: 'POST', json: setupBody() });
    assert.equal(created.status, 201);
    const again = await request(ctx.base, guest, '/api/setup', { method: 'POST', json: setupBody() });
    assert.equal(again.status, 403);

    const wrong = await request(ctx.base, guest, '/api/login', {
      method: 'POST',
      json: { username: 'xiaoman', password: 'not-the-password' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, '用户名或密码不正确');

    const login = await request(ctx.base, personA, '/api/login', {
      method: 'POST',
      json: { username: 'xiaoman', password: 'secret-pass-1' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.me.displayName, '小满');
    assert.equal(login.data.me.password, undefined);
    const setCookie = login.response.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.equal(login.data.me.partner.displayName, '小秋');

    await request(ctx.base, personB, '/api/login', {
      method: 'POST',
      json: { username: 'xiaoqiu', password: 'secret-pass-2' },
    });

    const checklist = await request(ctx.base, personA, '/api/checklist');
    assert.equal(checklist.status, 200);
    assert.ok(checklist.data.items.some((item) => item.title === '一起看日出'));

    const added = await request(ctx.base, personA, '/api/anniversaries', {
      method: 'POST',
      json: { title: '第一次旅行', date: '2026-10-28', yearly: true },
    });
    assert.equal(added.status, 201);
    const anniversaryId = added.data.anniversary.id;
    const renamed = await request(ctx.base, personB, `/api/anniversaries/${anniversaryId}`, {
      method: 'PATCH',
      json: { title: '第一次旅行', date: '2026-10-28', yearly: true },
    });
    assert.equal(renamed.status, 200);

    const sunrise = checklist.data.items.find((item) => item.title === '一起看日出');
    const completed = await request(ctx.base, personA, `/api/checklist/${sunrise.id}/complete`, {
      method: 'POST',
      json: { note: '明年再看一次' },
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.item.completedByName, '小满');
    assert.ok(ctx.notes.some((note) => note.payload.body.includes('一起看日出')));

    const subs = [];
    for (const userId of [1, 2]) {
      ctx.app.db.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
        VALUES (?, ?, 'test-key-1234', 'test-auth-1234', ?)
      `).run(userId, `https://push.example.test/device/${userId}`, new Date().toISOString());
    }
    const tooEarly = runReminderPass(ctx.app.db, {
      today: '2026-10-27',
      hour: 8,
      reminderHour: 9,
      notify: (userId, payload) => subs.push({ userId, payload }),
    });
    assert.equal(tooEarly.length, 0);
    const reminded = runReminderPass(ctx.app.db, {
      today: '2026-10-27',
      hour: 10,
      reminderHour: 9,
      notify: (userId, payload) => subs.push({ userId, payload }),
    });
    assert.equal(reminded.length, 2);
    assert.match(reminded[0].payload.body, /明天是「第一次旅行」/);
    const repeat = runReminderPass(ctx.app.db, {
      today: '2026-10-27',
      hour: 15,
      reminderHour: 9,
      notify: (userId, payload) => subs.push({ userId, payload }),
    });
    assert.equal(repeat.length, 0);
    ctx.app.db.prepare('DELETE FROM push_subscriptions').run();

    const noteCount = ctx.notes.length;
    const privateText = '这是只有自己能看的日记-9c2e';
    const secretDiary = await request(ctx.base, personA, '/api/diary', {
      method: 'POST',
      json: { content: privateText, mood: 'miss', visibility: 'private' },
    });
    assert.equal(secretDiary.status, 201);
    assert.equal(ctx.notes.length, noteCount);
    const hiddenId = secretDiary.data.entry.id;
    const listB = await request(ctx.base, personB, '/api/diary');
    assert.equal(JSON.stringify(listB.data).includes(privateText), false);
    const readB = await request(ctx.base, personB, `/api/diary/${hiddenId}`);
    assert.equal(readB.status, 404);
    assert.equal(JSON.stringify(readB.data).includes(privateText), false);
    const readA = await request(ctx.base, personA, `/api/diary/${hiddenId}`);
    assert.equal(readA.status, 200);
    assert.equal(readA.data.entry.content, privateText);

    const shared = await request(ctx.base, personA, '/api/diary', {
      method: 'POST',
      json: { content: '今天一起吃了面', mood: 'happy', visibility: 'shared' },
    });
    assert.equal(shared.status, 201);
    const listB2 = await request(ctx.base, personB, '/api/diary');
    assert.ok(listB2.data.entries.some((entry) => entry.content === '今天一起吃了面'));
    assert.ok(ctx.notes.some((note) => note.payload.body === '对方写了一篇日记' && !JSON.stringify(note.payload).includes('今天一起吃了面')));

    const injection = await request(ctx.base, personA, '/api/diary', {
      method: 'POST',
      json: { content: "'); DROP TABLE users;--", mood: '', visibility: 'private' },
    });
    assert.equal(injection.status, 201);
    const stillThere = await request(ctx.base, personA, '/api/me');
    assert.equal(stillThere.status, 200);

    const answerA = '答案甲-只有双方回答后可见-7f3a';
    const answered = await request(ctx.base, personA, '/api/daily/today', { method: 'POST', json: { answer: answerA } });
    assert.equal(answered.status, 200);
    assert.equal(answered.data.daily.myAnswer, answerA);
    assert.equal(answered.data.daily.partnerAnswer, null);
    const waiting = await request(ctx.base, personB, '/api/daily/today');
    assert.equal(waiting.data.daily.partnerAnswered, true);
    assert.equal(waiting.data.daily.partnerAnswer, null);
    assert.equal(JSON.stringify(waiting.data).includes(answerA), false);
    const answerB = '答案乙-揭晓-b91c';
    const both = await request(ctx.base, personB, '/api/daily/today', { method: 'POST', json: { answer: answerB } });
    assert.equal(both.data.daily.revealed, true);
    assert.equal(both.data.daily.partnerAnswer, answerA);
    assert.equal(both.data.daily.myAnswer, answerB);
    const seenByA = await request(ctx.base, personA, '/api/daily/today');
    assert.equal(seenByA.data.daily.partnerAnswer, answerB);
    const locked = await request(ctx.base, personA, '/api/daily/today', { method: 'POST', json: { answer: '想改掉' } });
    assert.equal(locked.status, 409);

    const jpeg = await tinyJpeg();
    const uploaded = await request(ctx.base, personA, '/api/photos', {
      method: 'POST',
      form: formData({ file: { name: 'a.jpg', type: 'image/jpeg', buffer: jpeg } }),
    });
    assert.equal(uploaded.status, 201);
    const photoId = uploaded.data.photo.id;
    const seen = await request(ctx.base, personB, `/api/media/${photoId}?size=full`, { raw: true });
    assert.equal(seen.status, 200);
    assert.match(seen.response.headers.get('content-type'), /image\/jpeg/);
    assert.equal(seen.data[0], 0xff);
    assert.equal(seen.data[1], 0xd8);
    const deniedDelete = await request(ctx.base, personB, `/api/photos/${photoId}`, { method: 'DELETE' });
    assert.equal(deniedDelete.status, 403);
    const outsider = await request(ctx.base, null, `/api/media/${photoId}`);
    assert.equal(outsider.status, 401);

    const fake = await request(ctx.base, personA, '/api/photos', {
      method: 'POST',
      form: formData({ file: { name: 'evil.jpg', type: 'image/jpeg', buffer: Buffer.from('<html><script>alert(1)</script></html>') } }),
    });
    assert.equal(fake.status, 400);

    const heic = fs.readFileSync(new URL('./fixtures/sample.heic', import.meta.url));
    const heicUpload = await request(ctx.base, personB, '/api/photos', {
      method: 'POST',
      form: formData({ file: { name: 'iphone.heic', type: 'image/heic', buffer: heic } }),
    });
    assert.equal(heicUpload.status, 201);
    const heicSeen = await request(ctx.base, personA, `/api/media/${heicUpload.data.photo.id}?size=thumb`, { raw: true });
    assert.equal(heicSeen.status, 200);
    assert.equal(heicSeen.data[0], 0xff);

    const diaryPhoto = await request(ctx.base, personA, '/api/diary', {
      method: 'POST',
      form: formData({
        fields: { content: '私密日记附图', mood: 'calm', visibility: 'private' },
        file: { name: 'note.jpg', type: 'image/jpeg', buffer: jpeg },
      }),
    });
    assert.equal(diaryPhoto.status, 201);
    const secretPhoto = diaryPhoto.data.entry.photoId;
    const hiddenPhoto = await request(ctx.base, personB, `/api/media/${secretPhoto}`, { raw: true });
    assert.equal(hiddenPhoto.status, 404);
    const ownPhoto = await request(ctx.base, personA, `/api/media/${secretPhoto}?size=full`, { raw: true });
    assert.equal(ownPhoto.status, 200);

    const exported = await request(ctx.base, personB, '/api/export', { method: 'POST', raw: true });
    assert.equal(exported.status, 200);
    assert.equal(exported.data[0], 0x50);
    assert.equal(exported.data[1], 0x4b);
    const zip = await readZip(exported.data);
    const diaryJson = JSON.parse(zip['diary.json'].toString('utf8'));
    assert.equal(diaryJson.some((entry) => entry.content === privateText), false);
    assert.ok(diaryJson.some((entry) => entry.content === '今天一起吃了面'));
    const ownExport = await request(ctx.base, personA, '/api/export', { method: 'POST', raw: true });
    const ownZip = await readZip(ownExport.data);
    const ownDiary = JSON.parse(ownZip['diary.json'].toString('utf8'));
    assert.ok(ownDiary.some((entry) => entry.content === privateText));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await request(ctx.base, guest, '/api/login', {
        method: 'POST',
        json: { username: 'ghost', password: 'wrong-password' },
      });
      assert.equal(failed.status, 401);
    }
    const limited = await request(ctx.base, guest, '/api/login', {
      method: 'POST',
      json: { username: 'ghost', password: 'wrong-password' },
    });
    assert.equal(limited.status, 429);

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couple-bak-'));
    const backupFile = await createBackup(ctx.dataDir, backupDir);
    assert.equal(fs.statSync(backupFile).mode & 0o077, 0);
    await ctx.app.close();
    fs.rmSync(path.join(ctx.dataDir, 'photos'), { recursive: true, force: true });
    fs.rmSync(path.join(ctx.dataDir, 'app.sqlite'), { force: true });
    await restoreBackup(backupFile, ctx.dataDir);
    const restored = openDatabase(ctx.dataDir);
    const restoredDiary = restored.prepare('SELECT content FROM diary_entries WHERE content = ?').get(privateText);
    const restoredPhotos = restored.prepare('SELECT COUNT(*) AS count FROM photos').get().count;
    restored.close();
    assert.ok(restoredDiary);
    assert.ok(restoredPhotos >= 1);
    fs.rmSync(backupDir, { recursive: true, force: true });

    const reopened = await startAgain(ctx.dataDir);
    try {
      const relogin = await request(reopened.base, personA, '/api/login', {
        method: 'POST',
        json: { username: 'xiaoman', password: 'secret-pass-1' },
      });
      assert.equal(relogin.status, 200);
      const oldCookie = personA.header();
      const changed = await request(reopened.base, personA, '/api/me/password', {
        method: 'POST',
        json: { currentPassword: 'secret-pass-1', newPassword: 'brand-new-pass' },
      });
      assert.equal(changed.status, 200);
      const stale = jar();
      stale.store = () => {};
      const staleResponse = await fetch(`${reopened.base}/api/me`, { headers: { Cookie: oldCookie, 'X-Requested-With': 'couple' } });
      assert.equal(staleResponse.status, 401);
      const wiped = await request(reopened.base, personA, '/api/danger/wipe', {
        method: 'POST',
        json: { password: 'brand-new-pass', confirm: '清空内容' },
      });
      assert.equal(wiped.status, 200);
      const afterWipe = await request(reopened.base, personA, '/api/diary');
      assert.equal(afterWipe.data.entries.length, 0);
      const stillLogin = await request(reopened.base, personA, '/api/me');
      assert.equal(stillLogin.status, 200);
      const reset = await request(reopened.base, personA, '/api/danger/reset', {
        method: 'POST',
        json: { password: 'brand-new-pass', confirm: '删除全部' },
      });
      assert.equal(reset.status, 200);
      const fresh = await request(reopened.base, null, '/api/bootstrap');
      assert.equal(fresh.data.initialized, false);
    } finally {
      await reopened.close();
    }
  } finally {
    await ctx.close();
  }
});

async function startAgain(dataDir) {
  const { createApp } = await import('../server/app.js');
  const app = createApp({
    dataDir,
    host: '127.0.0.1',
    port: 0,
    passwordN: 1024,
    schedule: false,
    cookieSecure: false,
    quiet: true,
    loginLimit: 8,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() { await app.close(); },
  };
}
