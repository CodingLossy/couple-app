import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalendar } from '../server/ics.js';

const now = new Date('2026-10-28T00:00:00Z');

function unfold(ics) {
  return ics.replaceAll('\r\n ', '').replaceAll('\r\n\t', '');
}

function events(ics) {
  return unfold(ics).split('BEGIN:VEVENT').slice(1).map((part) => part.split('END:VEVENT')[0]);
}

test('日历格式、重复纪念日、提醒和时区', () => {
  const ics = buildCalendar({
    timezone: 'Asia/Shanghai',
    reminderHour: 9,
    now,
    anniversaries: [
      { id: 3, title: '见面', date: '2024-02-14', yearly: 1, updated_at: '2026-10-01T00:00:00.000Z' },
      { id: 4, title: '闰日', date: '2024-02-29', yearly: true, updated_at: '2026-10-01T00:00:00.000Z' },
      { id: 5, title: '只有一次的旅行', date: '2026-11-02', yearly: 0, updated_at: '2026-10-01T00:00:00.000Z' },
    ],
    todos: [
      { id: 8, title: '买蛋糕', note: '草莓味', due_date: '2026-10-28', due_time: null, updated_at: '2026-10-02T00:00:00.000Z' },
      { id: 9, title: '视频', note: '', due_date: '2026-10-28', due_time: '15:30', updated_at: '2026-10-02T00:00:00.000Z' },
      { id: 10, title: '已经完成', due_date: '2026-10-28', due_time: '09:00', completed_at: '2026-10-28T01:00:00.000Z' },
      { id: 11, title: '没有日期', due_date: null },
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.equal(/(^|[^\r])\n/.test(ics), false);
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line) <= 75, line);
  }
  const text = unfold(ics);
  assert.match(text, /VERSION:2\.0/);
  assert.match(text, /PRODID:-\/\/couple-app\/\/calendar\/\/ZH/);
  assert.match(text, /X-WR-TIMEZONE:Asia\/Shanghai/);
  const blocks = events(ics);
  assert.equal(blocks.length, 5);
  const yearly = blocks.find((block) => block.includes('见面'));
  assert.match(yearly, /DTSTART;VALUE=DATE:20240214/);
  assert.match(yearly, /RRULE:FREQ=YEARLY/);
  assert.match(yearly, /TRIGGER:-PT15H/);
  assert.match(yearly, /TRIGGER:PT9H/);
  assert.match(yearly, /UID:anniv-3@couple-app/);
  const leap = blocks.find((block) => block.includes('闰日'));
  assert.match(leap, /DTSTART;VALUE=DATE:20240229/);
  assert.match(leap, /RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1/);
  const once = blocks.find((block) => block.includes('只有一次的旅行'));
  assert.equal(once.includes('RRULE'), false);
  const allday = blocks.find((block) => block.includes('买蛋糕'));
  assert.match(allday, /DTSTART;VALUE=DATE:20261028/);
  assert.match(allday, /DESCRIPTION:草莓味/);
  assert.match(allday, /TRIGGER:PT9H/);
  assert.equal(allday.includes('TRIGGER:-PT15H'), false);
  const timed = blocks.find((block) => block.includes('视频'));
  assert.match(timed, /DTSTART:20261028T073000Z/);
  assert.match(timed, /DTEND:20261028T083000Z/);
  assert.match(timed, /TRIGGER:-PT30M/);
  assert.match(timed, /TRIGGER:PT0S/);
  assert.equal(text.includes('已经完成'), false);
  assert.equal(text.includes('没有日期'), false);
});

test('夏令时和特殊字符', () => {
  const summer = buildCalendar({
    timezone: 'America/Los_Angeles',
    reminderHour: 9,
    now,
    todos: [{ id: 1, title: '下午', due_date: '2026-07-15', due_time: '15:30', updated_at: now.toISOString() }],
  });
  assert.match(unfold(summer), /DTSTART:20260715T223000Z/);
  const winter = buildCalendar({
    timezone: 'America/Los_Angeles',
    reminderHour: 0,
    now,
    anniversaries: [{ id: 2, title: '元旦', date: '2020-01-01', yearly: 1, updated_at: now.toISOString() }],
  });
  const newYear = events(winter)[0];
  assert.match(newYear, /TRIGGER:-PT24H/);
  assert.match(newYear, /TRIGGER:PT0S/);
  const messy = buildCalendar({
    timezone: 'Asia/Shanghai',
    reminderHour: 9,
    now,
    todos: [{
      id: 12,
      title: `买,蛋糕;一起\\看\n${'日'.repeat(40)}`,
      due_date: '2026-12-01',
      updated_at: now.toISOString(),
    }],
  });
  assert.match(unfold(messy), /SUMMARY:买\\,蛋糕\\;一起\\\\看\\n/);
  assert.ok(messy.split('\r\n').some((line) => line.startsWith(' ')));
});
