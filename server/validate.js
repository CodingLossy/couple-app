import { MOODS, TIMEZONES } from './content.js';
import { httpError } from './http.js';

const ZONE_IDS = new Set(TIMEZONES.map(([id]) => id));
const MOOD_IDS = new Set(MOODS.map((mood) => mood.id));

export function asText(value, min, max, label) {
  if (typeof value !== 'string') throw httpError(400, `${label}不正确`);
  const text = value.trim();
  const length = [...text].length;
  if (length < min || length > max) throw httpError(400, `${label}需要 ${min} 到 ${max} 个字`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw httpError(400, `${label}包含无法使用的字符`);
  return text;
}

export function asUsername(value) {
  const text = asText(value, 2, 20, '用户名').normalize('NFC');
  if (!/^[\p{L}\p{N}_.-]+$/u.test(text)) throw httpError(400, '用户名只能包含字母、数字、下划线、点或短横线');
  return text;
}

export function asPassword(value) {
  if (typeof value !== 'string') throw httpError(400, '密码不正确');
  const length = [...value].length;
  if (length < 8 || length > 72) throw httpError(400, '密码需要 8 到 72 个字符');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw httpError(400, '密码包含无法使用的字符');
  if (!/\S/.test(value)) throw httpError(400, '密码不能全是空格');
  return value;
}

export function asDate(value, label = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw httpError(400, `${label}格式应为 YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw httpError(400, `${label}不存在`);
  }
  if (year < 1900 || year > 2100) throw httpError(400, `${label}超出范围`);
  return value;
}

export function asZone(value) {
  if (typeof value !== 'string' || !ZONE_IDS.has(value)) throw httpError(400, '不支持这个时区');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw httpError(400, '不支持这个时区');
  }
  return value;
}

export function asHour(value) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw httpError(400, '提醒时间不正确');
  return hour;
}

export function asId(value) {
  if (!/^\d+$/.test(String(value ?? ''))) throw httpError(400, '编号不正确');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, '编号不正确');
  return id;
}

export function asMood(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !MOOD_IDS.has(value)) throw httpError(400, '心情不正确');
  return value;
}

export function asVisibility(value) {
  if (value !== 'private' && value !== 'shared') throw httpError(400, '可见范围不正确');
  return value;
}

export function asTime(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw httpError(400, '时间格式应为 HH:MM');
  return value;
}

export function asScope(value) {
  if (value !== 'mine' && value !== 'theirs' && value !== 'ours' && value !== 'received') {
    throw httpError(400, '请选择这是谁的待办');
  }
  return value;
}

export function asMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw httpError(400, '月份不正确');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  if (year < 1900 || year > 2100 || month < 1 || month > 12) throw httpError(400, '月份不正确');
  return value;
}

export function asLimit(value, fallback, max) {
  const number = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, max);
}
