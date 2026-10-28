import { getSetting } from './db.js';
import { daysBetween, nextOccurrence, zonedParts } from './time.js';

export function runReminderPass(db, { today, hour, reminderHour, notify }) {
  const sent = [];
  if (hour < reminderHour) return sent;
  const rows = db.prepare('SELECT id, title, date, yearly FROM anniversaries').all();
  const users = db.prepare('SELECT id FROM users').all();
  const hasSub = db.prepare('SELECT 1 AS ok FROM push_subscriptions WHERE user_id = ? LIMIT 1');
  const insertLog = db.prepare('INSERT OR IGNORE INTO push_log (kind, dedupe_key, sent_at) VALUES (?, ?, ?)');
  for (const row of rows) {
    const next = nextOccurrence(row.date, row.yearly === 1, today);
    if (!next) continue;
    const days = daysBetween(today, next);
    if (days !== 0 && days !== 1) continue;
    for (const user of users) {
      if (!hasSub.get(user.id)) continue;
      const key = `anniv:${row.id}:${next}:${days}:${user.id}:${today}`;
      const info = insertLog.run('anniv', key, new Date().toISOString());
      if (info.changes !== 1) continue;
      const payload = {
        title: '两个人',
        body: days === 0 ? `今天是「${row.title}」` : `明天是「${row.title}」`,
        url: '/#home',
        tag: 'anniv',
      };
      sent.push({ userId: user.id, payload });
      try {
        const result = notify(user.id, payload);
        if (result && typeof result.then === 'function') result.catch(() => {});
      } catch (error) {
        console.error('纪念日提醒失败', error.message);
      }
    }
  }
  return sent;
}

export function startScheduler(db, config, notify) {
  const tick = () => {
    try {
      const timeZone = getSetting(db, 'timezone', config.defaultTimezone);
      if (!timeZone) return;
      const parts = zonedParts(config.now(), timeZone);
      const reminderHour = Number(getSetting(db, 'reminder_hour', String(config.reminderHour)));
      runReminderPass(db, {
        today: parts.date,
        hour: parts.hour,
        reminderHour,
        notify,
      });
    } catch (error) {
      console.error('提醒检查失败', error.message);
    }
  };
  const timer = setInterval(tick, 15 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  const starter = setTimeout(tick, 5000);
  if (typeof starter.unref === 'function') starter.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(starter);
  };
}
