import path from 'node:path';
import { createBackup } from '../server/backup.js';
import { loadConfig, loadEnvFile, rootDir } from '../server/config.js';

loadEnvFile();
const config = loadConfig();
const outDir = path.resolve(process.argv[2] || path.join(rootDir, 'backups'));
const dest = await createBackup(config.dataDir, outDir);
console.log(`已备份 ${dest}`);
