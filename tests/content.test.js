import assert from 'node:assert/strict';
import test from 'node:test';
import { sniffImage } from '../server/images.js';
import { QUESTIONS, PRESETS } from '../server/content.js';

test('题库和预置清单', () => {
  assert.ok(QUESTIONS.length >= 60);
  assert.equal(new Set(QUESTIONS).size, QUESTIONS.length);
  assert.ok(QUESTIONS.every((question) => /\p{Script=Han}/u.test(question)));
  assert.ok(PRESETS.includes('一起看日出'));
  assert.ok(PRESETS.length >= 20);
});

test('只认照片文件头', () => {
  const jpeg = Buffer.alloc(16);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  assert.equal(sniffImage(jpeg), 'jpeg');

  const png = Buffer.alloc(16);
  png.writeUInt32BE(0x89504e47, 0);
  assert.equal(sniffImage(png), 'png');

  const heic = Buffer.alloc(16);
  heic.write('ftyp', 4, 'ascii');
  heic.write('heic', 8, 'ascii');
  assert.equal(sniffImage(heic), 'heic');

  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal(sniffImage(html), null);
});
