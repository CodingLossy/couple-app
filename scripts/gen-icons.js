import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');

function heartSvg({ size, background, foreground, scale }) {
  const heart = 'M256 430C156 338 72 270 72 182C72 116 122 74 176 74C214 74 244 98 256 136C268 98 298 74 336 74C390 74 440 116 440 182C440 270 356 338 256 430Z';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${background}"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <path d="${heart}" fill="${foreground}"/>
    </g>
  </svg>`);
}

const icons = [
  ['icon-192.png', 192, '#f6ece4', '#c4544a', 0.86],
  ['icon-512.png', 512, '#f6ece4', '#c4544a', 0.86],
  ['apple-touch-icon.png', 180, '#f6ece4', '#c4544a', 0.84],
  ['icon-maskable-512.png', 512, '#c4544a', '#fffaf6', 0.62],
  ['badge-96.png', 96, '#c4544a', '#fffaf6', 0.7],
];

fs.mkdirSync(outDir, { recursive: true });
for (const [name, size, background, foreground, scale] of icons) {
  await sharp(heartSvg({ size, background, foreground, scale })).png().toFile(path.join(outDir, name));
}
console.log(`已生成 ${icons.length} 个图标`);
