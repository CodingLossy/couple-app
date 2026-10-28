import { zonedDateTimeToUtc } from './time.js';

function icsText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks = [];
  let index = 0;
  let width = 75;
  while (index < bytes.length) {
    let end = Math.min(index + width, bytes.length);
    if (end < bytes.length) {
      while (end > index && (bytes[end] & 0xc0) === 0x80) end -= 1;
      if (end === index) end = Math.min(index + width, bytes.length);
    }
    chunks.push(bytes.subarray(index, end).toString('utf8'));
    index = end;
    width = 74;
  }
  return chunks.map((chunk, position) => (position === 0 ? chunk : ` ${chunk}`)).join('\r\n');
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function dateStamp(dateStr) {
  return dateStr.replaceAll('-', '');
}

function nextDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function alarm(trigger, description) {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(description)}`,
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ];
}

function sameDayTrigger(hour) {
  return hour === 0 ? 'PT0S' : `PT${hour}H`;
}

function previousDayTrigger(hour) {
  return `-PT${24 - hour}H`;
}

function eventLines(lines) {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

function anniversaryEvent(row, { reminderHour, now }) {
  const date = dateStamp(row.date);
  const yearly = row.yearly === true || row.yearly === 1;
  const month = Number(row.date.slice(5, 7));
  const day = Number(row.date.slice(8, 10));
  const lines = [
    `UID:anniv-${row.id}@couple-app`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${icsText(row.title)}`,
    `DTSTART;VALUE=DATE:${date}`,
    `DTEND;VALUE=DATE:${nextDate(row.date)}`,
    'TRANSP:TRANSPARENT',
  ];
  if (yearly && month === 2 && day === 29) lines.push('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1');
  else if (yearly) lines.push('RRULE:FREQ=YEARLY');
  const updated = Date.parse(row.updatedAt || row.updated_at || now.toISOString());
  if (Number.isFinite(updated)) lines.push(`SEQUENCE:${Math.max(0, Math.floor(updated / 1000))}`);
  lines.push(...alarm(previousDayTrigger(reminderHour), `明天是「${row.title}」`));
  lines.push(...alarm(sameDayTrigger(reminderHour), `今天是「${row.title}」`));
  return eventLines(lines);
}

function todoEvent(row, { timezone, reminderHour, now }) {
  const title = row.title;
  const note = row.note || '';
  const lines = [
    `UID:todo-${row.id}@couple-app`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${icsText(title)}`,
    'STATUS:CONFIRMED',
  ];
  if (note) lines.push(`DESCRIPTION:${icsText(note)}`);
  const updated = Date.parse(row.updatedAt || row.updated_at || now.toISOString());
  if (Number.isFinite(updated)) lines.push(`SEQUENCE:${Math.max(0, Math.floor(updated / 1000))}`);
  if (row.dueTime || row.due_time) {
    const dueTime = row.dueTime || row.due_time;
    const dueDate = row.dueDate || row.due_date;
    const start = zonedDateTimeToUtc(dueDate, dueTime, timezone);
    if (!start) return [];
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'TRANSP:OPAQUE');
    lines.push(...alarm('-PT30M', title));
    lines.push(...alarm('PT0S', title));
  } else {
    const dueDate = row.dueDate || row.due_date;
    lines.push(
      `DTSTART;VALUE=DATE:${dateStamp(dueDate)}`,
      `DTEND;VALUE=DATE:${nextDate(dueDate)}`,
      'TRANSP:TRANSPARENT',
    );
    lines.push(...alarm(sameDayTrigger(reminderHour), title));
  }
  return eventLines(lines);
}

export function buildCalendar({ timezone, reminderHour, todos = [], anniversaries = [], now = new Date() }) {
  const hour = Number.isInteger(reminderHour) ? reminderHour : 9;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//couple-app//calendar//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('两个人')}`,
    `X-WR-TIMEZONE:${icsText(timezone || 'Asia/Shanghai')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const row of anniversaries) {
    if (!row?.date || !row?.title) continue;
    lines.push(...anniversaryEvent(row, { reminderHour: hour, now }));
  }
  for (const row of todos) {
    const due = row?.dueDate || row?.due_date;
    if (!due || row.completedAt || row.completed_at) continue;
    lines.push(...todoEvent(row, { timezone: timezone || 'Asia/Shanghai', reminderHour: hour, now }));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
