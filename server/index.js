import sharp from 'sharp';
import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const config = loadConfig();
const app = createApp({ ...config, schedule: true });
const { server } = app;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${config.port} 已被占用。本应用默认使用 8787，请换一个端口，避免影响这台机器上已有的服务。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const heif = Boolean(sharp.format.heif?.input);
  console.log(`两个人已启动： http://${config.host}:${config.port}`);
  console.log(`照片支持 JPG、PNG、WEBP${heif ? '、HEIC' : ''}，HEIC 还有内置备用解码`);
  if (config.host === '127.0.0.1' || config.host === 'localhost') {
    console.log('只监听本机。给手机访问时请用反向代理提供 HTTPS，不要把这个端口直接暴露到公网。');
  }
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`正在关闭（${signal}）`);
  const timer = setTimeout(() => process.exit(1), 8000);
  if (typeof timer.unref === 'function') timer.unref();
  app.close().then(() => process.exit(0), () => process.exit(1));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
