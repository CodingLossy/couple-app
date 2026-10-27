import path from 'node:path';
import { restoreBackup } from '../server/backup.js';
import { loadConfig, loadEnvFile } from '../server/config.js';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('用法: node scripts/restore-backup.js <备份.zip>');
  process.exit(1);
}
loadEnvFile();
const config = loadConfig();
await restoreBackup(path.resolve(zipPath), config.dataDir);
console.log(`已恢复到 ${config.dataDir}`);
console.log('如果应用正在运行，请先停止再恢复，然后重新启动。');
