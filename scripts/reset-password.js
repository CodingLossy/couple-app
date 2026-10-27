import { resetPassword } from '../server/auth.js';
import { loadConfig, loadEnvFile } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { asPassword } from '../server/validate.js';

const username = process.argv[2];
if (!username) {
  console.error('用法: node scripts/reset-password.js <用户名>');
  console.error('新密码从标准输入读取，避免出现在进程列表里。');
  process.exit(1);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString('utf8').trim();
if (!password) {
  console.error('请从标准输入提供新密码');
  process.exit(1);
}

loadEnvFile();
const config = loadConfig();
const db = openDatabase(config.dataDir);
try {
  const user = await resetPassword(db, username, password, 16384, asPassword);
  console.log(`已重设 ${user.username} 的密码，该账号需要重新登录。`);
} catch (error) {
  console.error(error.expose ? error.message : '重设失败');
  process.exitCode = 1;
} finally {
  db.close();
}
