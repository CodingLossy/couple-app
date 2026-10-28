const CACHE = 'couple-shell-v5';
const SHELL = ['/', '/eat', '/eat.html', '/css/app.css', '/css/eat.css', '/js/app.js', '/js/util.js', '/js/eat.js', '/js/eat-decide.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const PAGES = new Set(['/', '/eat', '/#home', '/#album', '/#diary', '/#list', '/#ask', '/#cal', '/#settings', '/#guide']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(url); } catch { /* 单个资源失败不阻止安装 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      const cacheable = url.pathname === '/' || url.pathname === '/eat' || url.pathname === '/eat.html' || url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest');
      if (fresh.ok && cacheable) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const home = await cache.match('/');
        if (home) return home;
      }
      return new Response('暂时连不上', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 40) : '两个人';
  const body = typeof data.body === 'string' && data.body ? data.body.slice(0, 140) : '有新的动态';
  const url = PAGES.has(data.url) ? data.url : '/#home';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 40) : 'couple',
    renotify: true,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(PAGES.has(event.notification.data?.url) ? event.notification.data.url : '/', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if (typeof client.navigate === 'function') {
        try { await client.navigate(target.href); } catch { /* 旧系统没有 navigate */ }
      }
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
