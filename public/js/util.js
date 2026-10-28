let toastTimer = 0;
let onUnauthorized = () => {};

export function setUnauthorized(handler) {
  onUnauthorized = handler;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'value') node.value = String(value);
    else if (key === 'checked') node.checked = true;
    else if (key === 'selected') node.selected = true;
    else if (key === 'disabled') node.disabled = true;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

export async function api(path, options = {}) {
  const headers = { 'X-Requested-With': 'couple', ...(options.headers || {}) };
  const init = { method: options.method || 'GET', credentials: 'same-origin', headers };
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.json);
  } else if (options.body) {
    init.body = options.body;
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    const error = new Error('网络不通，请稍后再试');
    error.status = 0;
    throw error;
  }
  if (options.raw) {
    if (!response.ok) {
      let message = '请求失败';
      try { message = (await response.json()).error || message; } catch { /* 不是 JSON */ }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/login')) onUnauthorized();
    const error = new Error(data?.error || '请求失败');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const ICONS = {
  home: {
    line: ['M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z'],
    fill: ['M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z'],
  },
  album: {
    line: ['M4 6.5h16v12H4z', 'M8 14.5l2.2-2.6 2 2.2 1.8-1.6L17 14.5'],
    fill: ['M4 5.5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z'],
  },
  diary: {
    line: ['M7 4.5h9a2 2 0 0 1 2 2V19H8.5A2.5 2.5 0 0 1 6 16.5V6.5A2 2 0 0 1 8 4.5z'],
    fill: ['M8 3.5h8.5A2.5 2.5 0 0 1 19 6v14H8.2A3.2 3.2 0 0 1 5 16.8V6.5A3 3 0 0 1 8 3.5z'],
  },
  list: {
    line: ['M9 7h10', 'M9 12h10', 'M9 17h10', 'M5 7h.01', 'M5 12h.01', 'M5 17h.01'],
    fill: ['M4 5h16a1 1 0 0 1 1 1v3H3V6a1 1 0 0 1 1-1z', 'M3 11h18v3H3z', 'M3 16h18v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  },
  cal: {
    line: ['M7 4.5h10a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z', 'M6 9h12', 'M9 3.5v3', 'M15 3.5v3'],
    fill: ['M7 3h2v2h6V3h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M5 9h14v2H5z'],
  },
};

export function icon(name, filled = false) {
  const spec = ICONS[name] || ICONS.home;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', filled ? '2.2' : '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (filled) {
    const plate = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    plate.setAttribute('cx', '12');
    plate.setAttribute('cy', '12');
    plate.setAttribute('r', '11');
    plate.setAttribute('fill', 'currentColor');
    plate.setAttribute('opacity', '0.16');
    plate.setAttribute('stroke', 'none');
    svg.append(plate);
  }
  for (const d of spec.line) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function formatDay(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function formatWhen(iso, timeZone) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timeZone || 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function dayKey(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function shiftDay(iso, days) {
  const time = Date.parse(`${iso}T00:00:00Z`) + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

export function monthLabel(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: 'long' }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function countdownLabel(days) {
  if (days == null) return '已经过去';
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  return `还有 ${days} 天`;
}

export function mediaUrl(id, size = 'thumb') {
  const number = Number(id);
  if (!Number.isInteger(number) || number <= 0) return '';
  return `/api/media/${number}?size=${size === 'full' ? 'full' : 'thumb'}`;
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

export function clientInfo() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const match = ua.match(/OS (\d+)[._](\d+)/);
  const version = match ? [Number(match[1]), Number(match[2])] : null;
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const https = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const push = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iosOk = !ios || !version || version[0] > 16 || (version[0] === 16 && version[1] >= 4);
  return {
    ios,
    version,
    standalone,
    https,
    push,
    iosOk,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}
