export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function daysTogether(start, today) {
  const diff = daysBetween(start, today);
  if (diff == null) return null;
  if (diff >= 0) return diff + 1;
  return diff;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDate(year, month, day) {
  const last = daysInMonth(year, month);
  const d = Math.min(day, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function nextOccurrence(dateStr, yearly, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null;
  if (!yearly) return dateStr >= today ? dateStr : null;
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  let candidate = clampDate(year, month, day);
  if (candidate < today) candidate = clampDate(year + 1, month, day);
  return candidate;
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    timeZone,
  };
}
