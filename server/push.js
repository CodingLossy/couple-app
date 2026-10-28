import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const PUSH_URLS = new Set(['/', '/eat', '/#home', '/#album', '/#diary', '/#list', '/#ask', '/#cal', '/#settings', '/#guide']);

export function initVapid(dataDir, subject) {
  const file = path.join(dataDir, 'vapid.json');
  let keys;
  if (fs.existsSync(file)) {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!keys.publicKey || !keys.privateKey) {
      throw new Error('data/vapid.json 无法读取。不要手改这个文件；如果确认要重做通知密钥，先备份再删除它。');
    }
  } else {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return keys.publicKey;
}

export function safePushUrl(url) {
  return PUSH_URLS.has(url) ? url : '/#home';
}

export async function sendPush(db, userId, payload) {
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify({
    title: String(payload.title || '两个人').slice(0, 40),
    body: String(payload.body || '有新的动态').slice(0, 140),
    url: safePushUrl(payload.url),
    tag: String(payload.tag || 'couple').slice(0, 40),
  });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 * 12, urgency: 'normal' },
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else if (error.statusCode) {
        console.error('推送没有送达', error.statusCode);
      } else {
        console.error('推送没有送达', error.message);
      }
    }
  }));
}
