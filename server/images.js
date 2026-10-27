import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { httpError } from './http.js';

sharp.cache(false);
sharp.concurrency(1);

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1', 'heim', 'heis', 'avif']);

let queue = Promise.resolve();

function withImageSlot(work) {
  const run = queue.then(work, work);
  queue = run.then(() => {}, () => {});
  return run;
}

export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return brand === 'avif' ? null : 'heic';
  }
  return null;
}

export function sweepTmp(dataDir) {
  const dir = path.join(dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > 6 * 60 * 60 * 1000) fs.rmSync(full, { force: true });
    } catch {
      // 临时文件被同时删掉时忽略。
    }
  }
}

export function removeStored(dataDir, storedName) {
  if (!/^[\w.-]+$/.test(storedName || '')) return;
  for (const folder of ['photos', 'thumbs']) {
    fs.rmSync(path.join(dataDir, folder, storedName), { force: true });
  }
}

export function emptyMedia(dataDir) {
  for (const folder of ['photos', 'thumbs']) {
    const dir = path.join(dataDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
      if (/^[\w.-]+$/.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

async function readHead(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(32);
    await handle.read(buffer, 0, 32, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function render(source, fullPath, thumbPath) {
  await sharp(source, { limitInputPixels: 40_000_000, failOn: 'error', animated: false })
    .rotate()
    .flatten({ background: '#fffaf6' })
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(fullPath);
  await sharp(fullPath)
    .resize(480, 480, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 74, mozjpeg: true })
    .toFile(thumbPath);
}

async function heicToJpegFile(filePath) {
  const input = await fs.promises.readFile(filePath);
  const mod = await import('heic-convert');
  const convert = mod.default || mod;
  const output = await convert({ buffer: input, format: 'JPEG', quality: 0.92 });
  const decoded = `${filePath}.decoded.jpg`;
  await fs.promises.writeFile(decoded, Buffer.from(output));
  return decoded;
}

export function processImage(tmpPath, dataDir) {
  return withImageSlot(async () => {
    const kind = sniffImage(await readHead(tmpPath));
    if (!kind) throw httpError(400, '只支持 JPG、PNG、WEBP 和 iPhone 的 HEIC 照片');
    const storedName = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.jpg`;
    const fullPath = path.join(dataDir, 'photos', storedName);
    const thumbPath = path.join(dataDir, 'thumbs', storedName);
    const cleanup = [];
    try {
      try {
        await render(tmpPath, fullPath, thumbPath);
      } catch (error) {
        await fs.promises.rm(fullPath, { force: true });
        await fs.promises.rm(thumbPath, { force: true });
        if (kind !== 'heic') throw error;
        const decoded = await heicToJpegFile(tmpPath);
        cleanup.push(decoded);
        await render(decoded, fullPath, thumbPath);
      }
      const meta = await sharp(fullPath).metadata();
      const stat = await fs.promises.stat(fullPath);
      return {
        storedName,
        width: meta.width || null,
        height: meta.height || null,
        bytes: stat.size,
      };
    } catch (error) {
      await fs.promises.rm(fullPath, { force: true });
      await fs.promises.rm(thumbPath, { force: true });
      if (error.status) throw error;
      console.error('照片处理失败', error.message);
      if (/pixel limit|exceeds/i.test(error.message || '')) throw httpError(400, '照片尺寸太大');
      throw httpError(400, '这张照片无法读取，请换一张试试');
    } finally {
      await Promise.all(cleanup.map((file) => fs.promises.rm(file, { force: true })));
    }
  });
}

export function mediaPath(dataDir, folder, storedName) {
  if (folder !== 'photos' && folder !== 'thumbs') throw httpError(400, '文件不存在');
  if (!/^[\w.-]+$/.test(storedName || '')) throw httpError(404, '照片不存在');
  const root = path.resolve(dataDir, folder);
  const full = path.resolve(root, storedName);
  if (!full.startsWith(root + path.sep)) throw httpError(404, '照片不存在');
  return full;
}
