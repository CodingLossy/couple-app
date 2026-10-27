import assert from 'node:assert/strict';
import test from 'node:test';
import { daysTogether, nextOccurrence, zonedParts } from '../server/time.js';

test('在一起的天数从第 1 天算起', () => {
  assert.equal(daysTogether('2026-10-27', '2026-10-27'), 1);
  assert.equal(daysTogether('2026-10-26', '2026-10-27'), 2);
  assert.equal(daysTogether('2026-10-30', '2026-10-27'), -3);
});

test('纪念日下一次出现，含闰日', () => {
  assert.equal(nextOccurrence('2026-12-01', false, '2026-10-27'), '2026-12-01');
  assert.equal(nextOccurrence('2020-01-01', false, '2026-10-27'), null);
  assert.equal(nextOccurrence('2020-12-20', true, '2026-10-27'), '2026-12-20');
  assert.equal(nextOccurrence('2020-01-02', true, '2026-10-27'), '2027-01-02');
  assert.equal(nextOccurrence('2024-02-29', true, '2026-03-01'), '2027-02-28');
  assert.equal(nextOccurrence('2024-02-29', true, '2024-02-29'), '2024-02-29');
  assert.equal(nextOccurrence('2024-02-29', true, '2025-02-28'), '2025-02-28');
});

test('按时区取今天', () => {
  const losAngeles = zonedParts(new Date('2026-10-27T06:30:00Z'), 'America/Los_Angeles');
  assert.equal(losAngeles.date, '2026-10-26');
  assert.equal(losAngeles.hour, 23);
  const shanghai = zonedParts(new Date('2026-10-27T16:05:00Z'), 'Asia/Shanghai');
  assert.equal(shanghai.date, '2026-10-28');
  assert.equal(shanghai.hour, 0);
});
