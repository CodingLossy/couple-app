import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import yazl from 'yazl';
import yauzl from 'yauzl';

const ENTRY = /^(app\.sqlite|vapid\.json|photos\/[A-Za-z0-9][\w.-]*|thumbs\/[A-Za-z0-9][\w.-]*)$/;

function zipLib() {
  return yazl.ZipFile ? yazl : yazl.default;
}

function unzipLib() {
  return typeof yauzl.open === 'function' ? yauzl : yauzl.default;
}

function assertOutside(dataDir, outDir) {
  const data = path.resolve(dataDir);
  const out = path.resolve(outDir);
  if (out === data || out.startsWith(data + path.sep)) {
    throw new Error('备份目录不能放在数据目录里面');
  }
}

export async function createBackup(dataDir, outDir, { keepDays = 14 } = {}) {
  assertOutside(dataDir, outDir);
  const sqlitePath = path.join(dataDir, 'app.sqlite');
  if (!fs.existsSync(sqlitePath)) throw new Error('还没有数据库，先启动一次应用');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dest = path.join(outDir, `couple-${stamp}.zip`);
  const tempSqlite = path.join(os.tmpdir(), `couple-${randomBytes(6).toString('hex')}.sqlite`);
  const db = new Database(sqlitePath, { fileMustExist: true });
  try {
    await db.backup(tempSqlite);
  } finally {
    db.close();
  }
  try {
    const ZipFile = zipLib().ZipFile;
    const zip = new ZipFile();
    zip.addFile(tempSqlite, 'app.sqlite');
    const vapid = path.join(dataDir, 'vapid.json');
    if (fs.existsSync(vapid)) zip.addFile(vapid, 'vapid.json');
    for (const folder of ['photos', 'thumbs']) {
      const dir = path.join(dataDir, folder);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/^[\w.-]+$/.test(name)) continue;
        const full = path.join(dir, name);
        if (!fs.statSync(full).isFile()) continue;
        zip.addFile(full, `${folder}/${name}`);
      }
    }
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(dest, { mode: 0o600 });
      output.on('close', resolve);
      output.on('error', reject);
      zip.outputStream.on('error', reject);
      zip.outputStream.pipe(output);
      zip.end();
    });
    fs.chmodSync(dest, 0o600);
  } finally {
    fs.rmSync(tempSqlite, { force: true });
  }
  pruneOld(outDir, keepDays);
  return dest;
}

function pruneOld(outDir, keepDays) {
  const cutoff = Date.now() - keepDays * 86400000;
  for (const name of fs.readdirSync(outDir)) {
    if (!/^couple-.*\.(zip|tar\.gz)$/.test(name)) continue;
    const full = path.join(outDir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.rmSync(full, { force: true });
    } catch {
      // 清理旧备份失败时保留文件。
    }
  }
}

function openZip(file) {
  const lib = unzipLib();
  return new Promise((resolve, reject) => {
    lib.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) reject(error);
      else resolve(zip);
    });
  });
}

async function extractZip(zipPath, destDir) {
  const zip = await openZip(zipPath);
  await new Promise((resolve, reject) => {
    const fail = (error) => {
      try { zip.close(); } catch { /* 已经关闭 */ }
      reject(error);
    };
    zip.on('error', fail);
    zip.on('entry', (entry) => {
      const name = entry.fileName.replaceAll('\\', '/');
      if (name.endsWith('/')) {
        zip.readEntry();
        return;
      }
      const parts = name.split('/');
      const out = path.resolve(destDir, name);
      const root = path.resolve(destDir);
      if (!ENTRY.test(name) || parts.some((part) => !part || part === '.' || part === '..') || (out !== root && !out.startsWith(root + path.sep))) {
        fail(new Error(`备份里有不认识的文件：${name}`));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const writer = fs.createWriteStream(out, { mode: 0o600 });
        stream.on('error', fail);
        writer.on('error', fail);
        writer.on('finish', () => zip.readEntry());
        stream.pipe(writer);
      });
    });
    zip.on('end', resolve);
    zip.readEntry();
  });
  zip.close();
}

function replaceFolder(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dest)) {
    if (/^[A-Za-z0-9][\w.-]*$/.test(name)) fs.rmSync(path.join(dest, name), { force: true });
  }
  if (!fs.existsSync(source)) return;
  for (const name of fs.readdirSync(source)) {
    if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) continue;
    fs.copyFileSync(path.join(source, name), path.join(dest, name));
  }
}

export async function restoreBackup(zipPath, dataDir) {
  if (!fs.existsSync(zipPath)) throw new Error('找不到备份文件');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'couple-restore-'));
  try {
    await extractZip(zipPath, temp);
    const sqlite = path.join(temp, 'app.sqlite');
    if (!fs.existsSync(sqlite)) throw new Error('备份里没有数据库');
    const db = new Database(sqlite, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    db.close();
    if (!table) throw new Error('这个压缩包不是本应用的备份');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const junk of ['app.sqlite-wal', 'app.sqlite-shm']) fs.rmSync(path.join(dataDir, junk), { force: true });
    fs.copyFileSync(sqlite, path.join(dataDir, 'app.sqlite'));
    fs.chmodSync(path.join(dataDir, 'app.sqlite'), 0o600);
    const vapid = path.join(temp, 'vapid.json');
    if (fs.existsSync(vapid)) {
      fs.copyFileSync(vapid, path.join(dataDir, 'vapid.json'));
      fs.chmodSync(path.join(dataDir, 'vapid.json'), 0o600);
    }
    replaceFolder(path.join(temp, 'photos'), path.join(dataDir, 'photos'));
    replaceFolder(path.join(temp, 'thumbs'), path.join(dataDir, 'thumbs'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
