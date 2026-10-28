import {
  api,
  clientInfo,
  countdownLabel,
  dayKey,
  el,
  formatDay,
  icon,
  mediaUrl,
  monthLabel,
  setUnauthorized,
  shiftDay,
  toast,
  urlBase64ToUint8Array,
} from './util.js';

const THEME_KEY = 'couple-theme';
const ACCENT_KEY = 'couple-accent';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const S = {
  booting: true,
  initialized: false,
  me: null,
  moods: [],
  timezones: [],
  maxUploadMb: 12,
  route: 'home',
  ready: null,
  calMonth: '',
  calDay: '',
  heroMode: 'span',
  uploading: 0,
};
const app = document.getElementById('app');
const routes = new Set(['home', 'album', 'diary', 'list', 'ask', 'cal', 'settings', 'guide']);
let generation = 0;
let booting = true;
let clockTimer = 0;

setUnauthorized(() => {
  if (!S.me) return;
  S.me = null;
  go('login');
});

function applyTheme() {
  const theme = localStorage.getItem(THEME_KEY) || 'system';
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = localStorage.getItem(ACCENT_KEY) || 'rose';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1C1517' : '#FFF8F4';
}

function parseRoute() {
  return (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home');
}

function ensureRoute() {
  const requested = parseRoute();
  if (!S.initialized) {
    S.route = 'setup';
    if (location.hash !== '#/setup') location.replace('#/setup');
    return;
  }
  if (!S.me) {
    S.route = 'login';
    if (location.hash !== '#/login') location.replace('#/login');
    return;
  }
  if (requested === 'login' || requested === 'setup') {
    S.route = 'home';
    if (location.hash !== '#/home') location.replace('#/home');
    return;
  }
  S.route = routes.has(requested) ? requested : 'missing';
}

function go(route) {
  const next = `#/${route}`;
  if (location.hash === next) {
    S.route = route;
    mount();
    return;
  }
  location.hash = next;
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ns(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function heartIcon() {
  const svg = ns('svg', { viewBox: '0 0 24 24', class: 'heart', 'aria-hidden': 'true' });
  svg.append(ns('path', { fill: 'currentColor', d: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z' }));
  return svg;
}

function lockIcon() {
  const svg = ns('svg', { viewBox: '0 0 24 24', class: 'lock', 'aria-hidden': 'true' });
  svg.append(ns('rect', { x: '6', y: '11', width: '12', height: '9', rx: '2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8' }));
  svg.append(ns('path', { d: 'M8 11V8a4 4 0 0 1 8 0v3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8' }));
  return svg;
}

function sketch(kind) {
  const svg = ns('svg', { viewBox: '0 0 72 72', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' });
  const paths = {
    album: ['M14 22h44v30H14z', 'M22 42l8-8 6 6 4-4 10 10', 'M46 16c4 4 4 10 0 12'],
    diary: ['M22 16h26v40H24a6 6 0 0 1-6-6V20a4 4 0 0 1 4-4z', 'M28 28h16', 'M28 36h12'],
    list: ['M20 22h32', 'M20 36h32', 'M20 50h20', 'M16 22h.1', 'M16 36h.1'],
    cal: ['M18 16h36v38H18z', 'M18 26h36', 'M28 12v8', 'M44 12v8'],
    ask: ['M16 20h40v24H28L16 52V20z'],
    home: ['M36 48s-14-9-14-18a8 8 0 0 1 14-4 8 8 0 0 1 14 4c0 9-14 18-14 18z'],
  };
  for (const d of paths[kind] || paths.home) svg.append(ns('path', { d }));
  return svg;
}

function emptyState(kind, text) {
  return el('div', { class: 'empty' }, [sketch(kind), el('p', { text })]);
}

function avatar(name) {
  const letter = [...(name || '我')].slice(-1)[0];
  return el('span', { class: 'avatar', text: letter });
}

function burst(node) {
  if (!node || reducedMotion()) return;
  node.classList.remove('pop');
  void node.offsetWidth;
  node.classList.add('pop');
}

function confetti() {
  if (reducedMotion()) return;
  const layer = el('div', { class: 'confetti' });
  const colors = ['#E8687F', '#FFB38A', '#8FD3C1', '#B9A6F2', '#FCE4E8'];
  for (let index = 0; index < 18; index += 1) {
    const bit = document.createElement('i');
    bit.style.left = `${8 + Math.random() * 84}%`;
    bit.style.background = colors[index % colors.length];
    bit.style.animationDelay = `${Math.random() * .15}s`;
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1000);
}

function zoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour, minute: Number(map.minute), second: Number(map.second) };
}

function zonedMidnight(dateStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const want = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = want;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const gotParts = zoneParts(new Date(utc), timeZone);
    const got = Date.UTC(gotParts.year, gotParts.month - 1, gotParts.day, gotParts.hour, gotParts.minute, gotParts.second);
    if (got === want) return utc;
    utc += want - got;
  }
  return utc;
}

function calendarSpan(since, today) {
  let years = Number(today.slice(0, 4)) - Number(since.slice(0, 4));
  let months = Number(today.slice(5, 7)) - Number(since.slice(5, 7));
  let days = Number(today.slice(8, 10)) - Number(since.slice(8, 10));
  if (days < 0) {
    months -= 1;
    const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).getUTCDate();
    days += previous;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

function clockParts(since, timeZone) {
  const elapsed = Math.max(0, Date.now() - zonedMidnight(since, timeZone));
  const total = Math.floor(elapsed / 1000);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function milestone(days, since, today) {
  if (days === 100 || days === 520 || days === 1314) return `${days} 天`;
  if (since && today && since.slice(5) === today.slice(5) && days > 300) {
    const years = Math.max(1, Math.round(days / 365));
    return `${years} 周年`;
  }
  return '';
}

function navButton(route, name, label) {
  const current = S.route === route || (route === 'list' && S.route === 'ask');
  return el('button', {
    class: 'nav-btn',
    type: 'button',
    'aria-label': label,
    'aria-current': current ? 'page' : null,
    onclick: () => go(route),
  }, [icon(name, current), el('span', { text: label })]);
}

function shell() {
  const titles = { settings: '设置', guide: '开启通知' };
  return el('div', { class: 'shell', 'data-route': S.route }, [
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand', text: titles[S.route] || '' }),
      S.route === 'settings'
        ? el('button', { class: 'text-btn', type: 'button', text: '首页', onclick: () => go('home') })
        : el('button', { class: 'text-btn', type: 'button', text: '设置', onclick: () => go('settings') }),
    ]),
    el('main', { id: 'main', class: 'main rise' }),
    el('nav', { class: 'nav', 'aria-label': '主要功能' }, [
      navButton('home', 'home', '首页'),
      navButton('album', 'album', '相册'),
      navButton('diary', 'diary', '日记'),
      navButton('list', 'list', '清单'),
      navButton('cal', 'cal', '日历'),
    ]),
  ]);
}

function field(label, control) {
  return el('label', { class: 'field' }, [el('span', { class: 'label', text: label }), control]);
}

function personFields(title, prefix) {
  return el('fieldset', {}, [
    el('legend', { text: title }),
    field('怎么称呼', el('input', { class: 'input', name: `${prefix}Name`, required: true, maxlength: '20', autocomplete: 'nickname', placeholder: '例如 小满' })),
    field('用户名', el('input', { class: 'input', name: `${prefix}User`, required: true, maxlength: '20', autocapitalize: 'off', autocomplete: 'username', placeholder: '登录时用' })),
    field('密码', el('input', { class: 'input', name: `${prefix}Pass`, type: 'password', required: true, minlength: '8', maxlength: '72', autocomplete: 'new-password' })),
    field('再输入一次密码', el('input', { class: 'input', name: `${prefix}Pass2`, type: 'password', required: true, minlength: '8', maxlength: '72', autocomplete: 'new-password' })),
  ]);
}

function setupView() {
  if (S.ready) {
    return el('div', { class: 'auth' }, [
      el('section', { class: 'auth-card stack' }, [
        el('p', { class: 'kicker', text: '准备好了' }),
        el('h1', { text: '两个人' }),
        el('p', { text: '请各自在自己的 iPhone 上登录。密码不会再显示。' }),
        el('p', { text: `${S.ready[0].displayName}，用户名 ${S.ready[0].username}` }),
        el('p', { text: `${S.ready[1].displayName}，用户名 ${S.ready[1].username}` }),
        el('button', { class: 'btn full', type: 'button', text: '去登录', onclick: () => { S.ready = null; go('login'); } }),
      ]),
    ]);
  }
  const hours = Array.from({ length: 18 }, (_, index) => index + 6);
  return el('div', { class: 'auth' }, [
    el('form', {
      class: 'auth-card stack',
      onsubmit: async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const button = form.querySelector('button[type="submit"]');
        const users = ['a', 'b'].map((prefix) => ({
          displayName: String(data.get(`${prefix}Name`) || ''),
          username: String(data.get(`${prefix}User`) || ''),
          password: String(data.get(`${prefix}Pass`) || ''),
          confirm: String(data.get(`${prefix}Pass2`) || ''),
        }));
        if (users.some((user) => user.password !== user.confirm)) {
          toast('两次密码不一致');
          return;
        }
        button.disabled = true;
        try {
          await api('/api/setup', {
            method: 'POST',
            json: {
              togetherSince: data.get('togetherSince'),
              timezone: data.get('timezone'),
              reminderHour: Number(data.get('reminderHour')),
              users: users.map(({ displayName, username, password }) => ({ displayName, username, password })),
            },
          });
          S.initialized = true;
          S.ready = users;
          mount();
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      },
    }, [
      el('p', { class: 'kicker', text: '只属于你们' }),
      el('h1', { text: '两个人' }),
      el('p', { class: 'lead', text: '第一次打开时，一起把两个账号建好。之后就不能再注册了。' }),
      field('在一起的日期', el('input', { class: 'input', name: 'togetherSince', type: 'date', required: true })),
      field('时区', el('select', { class: 'select', name: 'timezone' }, S.timezones.map((zone) => (
        el('option', { value: zone.id, text: zone.label, selected: zone.id === 'Asia/Shanghai' })
      )))),
      field('纪念日提醒', el('select', { class: 'select', name: 'reminderHour' }, hours.map((hour) => (
        el('option', { value: String(hour), text: `${hour} 点`, selected: hour === 9 })
      )))),
      personFields('第一个人', 'a'),
      personFields('第二个人', 'b'),
      el('button', { class: 'btn full', type: 'submit', text: '创建我们的账号' }),
    ]),
  ]);
}

function loginView() {
  return el('div', { class: 'auth' }, [
    el('form', {
      class: 'auth-card stack',
      onsubmit: async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const result = await api('/api/login', { method: 'POST', json: { username: data.get('username'), password: data.get('password') } });
          S.me = result.me;
          go('home');
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      },
    }, [
      el('p', { class: 'kicker', text: '欢迎回来' }),
      el('h1', { text: '两个人' }),
      el('p', { class: 'lead', text: '只有你们两个账号可以进来。通知要先添加到主屏幕，登录后可以按引导开启。' }),
      field('用户名', el('input', { class: 'input', name: 'username', autocomplete: 'username', autocapitalize: 'off', required: true })),
      field('密码', el('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      el('button', { class: 'btn full', type: 'submit', text: '进入' }),
    ]),
  ]);
}

function openModal(content, onClose) {
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    root.remove();
    if (onClose) onClose();
  };
  const root = el('div', { class: 'modal' }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [content]),
  ]);
  root.addEventListener('click', (event) => {
    if (event.target === root) finish();
  });
  document.body.append(root);
  return { root, close: finish };
}

function askConfirm(title, body) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    const { close } = openModal(el('div', { class: 'stack' }, [
      el('h3', { text: title }),
      el('p', { text: body }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => finish(false) }),
        el('button', { class: 'btn danger', type: 'button', text: '确定', onclick: () => finish(true) }),
      ]),
    ]), () => finish(false));
  });
}

function fileInput() {
  const input = el('input', { type: 'file', accept: ACCEPT });
  input.hidden = true;
  return input;
}

async function loadHome(main, ctx) {
  const [data, daily, photos] = await Promise.all([
    api('/api/home'),
    api('/api/daily/today').catch(() => null),
    api('/api/photos?limit=12').catch(() => ({ photos: [] })),
  ]);
  if (ctx.expired()) return;
  clearInterval(clockTimer);
  const days = data.daysTogether;
  const hero = el('section', { class: 'hero', role: 'button', tabindex: '0', 'aria-label': days >= 1 ? `在一起第${days}天，点按切换计时` : '在一起' });
  if (data.coverPhotoId) {
    const image = el('img', { class: 'cover', alt: '', src: mediaUrl(data.coverPhotoId, 'full') });
    image.addEventListener('error', () => image.remove());
    hero.append(image);
  }
  hero.append(el('div', { class: 'shade' }));
  const body = el('div', { class: 'hero-body' });
  const faces = el('div', { class: 'faces' }, [avatar(data.myName), heartIcon(), avatar(data.partnerName || 'TA')]);
  const figure = el('p', { class: 'hero-num', text: '—' });
  const unit = el('p', { class: 'hero-unit', text: '' });
  const sub = el('p', { class: 'hero-sub', text: '' });
  body.append(faces, el('p', { class: 'hero-kicker', text: '我们在一起' }), figure, unit, sub);
  hero.append(body);
  const paint = () => {
    if (!(days >= 1) || !data.togetherSince) return;
    if (S.heroMode === 'clock') {
      const clock = clockParts(data.togetherSince, data.timezone);
      figure.textContent = String(clock.hours);
      unit.textContent = '小时';
      sub.textContent = `${String(clock.minutes).padStart(2, '0')} 分 ${String(clock.seconds).padStart(2, '0')} 秒`;
    } else {
      const span = calendarSpan(data.togetherSince, data.today);
      figure.textContent = String(days);
      unit.textContent = `第 ${days} 天`;
      sub.textContent = `${span.years} 年 ${span.months} 个月 ${span.days} 天`;
    }
  };
  if (days >= 1) {
    paint();
    hero.addEventListener('click', () => {
      S.heroMode = S.heroMode === 'span' ? 'clock' : 'span';
      paint();
    });
    if (S.heroMode === 'clock') clockTimer = setInterval(paint, 1000);
  } else if (days < 0) {
    figure.textContent = String(Math.abs(days));
    unit.textContent = '天后是第 1 天';
  } else {
    unit.textContent = '还没有记下开始的日期';
  }
  const blocks = [hero];
  const party = milestone(days, data.togetherSince, data.today);
  if (party) {
    const seen = localStorage.getItem(`couple-celeb-${data.today}-${party}`);
    blocks.push(el('section', { class: 'celeb' }, [
      el('p', { class: 'kicker', text: '值得记一笔' }),
      el('h2', { text: party }),
      el('p', { text: '这一天，只属于你们。' }),
    ]));
    if (!seen) {
      localStorage.setItem(`couple-celeb-${data.today}-${party}`, '1');
      setTimeout(confetti, 240);
    }
  }
  const upcoming = data.anniversaries.filter((item) => item.daysUntil != null).slice(0, 8);
  if (upcoming.length) {
    blocks.push(el('div', { class: 'scroller' }, upcoming.map((item) => el('article', { class: 'count-card' }, [
      el('p', { class: 'muted', text: item.title }),
      el('strong', { class: 'peach', text: countdownLabel(item.daysUntil) }),
      el('p', { text: `${item.yearly ? '每年都有' : '只有一次'} · ${formatDay(item.date)}` }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost small', type: 'button', text: '编辑', onclick: () => anniversaryForm(item, () => mount()) }),
        el('button', { class: 'btn ghost small', type: 'button', text: '删除', onclick: async () => {
          if (!await askConfirm('删除纪念日', `确定删除「${item.title}」？`)) return;
          await api(`/api/anniversaries/${item.id}`, { method: 'DELETE' });
          mount();
        } }),
      ]),
    ]))));
  } else {
    blocks.push(emptyState('home', '还没有纪念日。把第一次见面记下来吧。'));
  }
  blocks.push(el('div', { class: 'section-head' }, [
    el('h2', { text: '纪念日' }),
    el('button', { class: 'text-btn', type: 'button', text: '添加', onclick: () => anniversaryForm(null, () => mount()) }),
  ]));
  if (daily?.daily) {
    blocks.push(el('button', { class: 'entry-card ask-link', type: 'button', onclick: () => go('ask') }, [
      el('p', { class: 'kicker', text: '今日一问' }),
      el('p', { text: daily.daily.question }),
    ]));
  }
  const recent = photos.photos || [];
  blocks.push(el('button', { class: 'entry-card memory', type: 'button', onclick: () => go('album') }, [
    el('p', { class: 'kicker', text: '最近的回忆' }),
    recent.length
      ? el('div', { class: 'memory-row' }, recent.slice(0, 3).map((photo) => el('img', { src: mediaUrl(photo.id, 'thumb'), alt: '' })))
      : el('p', { text: '相册还空着，拍一张只给你们看的照片。' }),
  ]));
  if (S.me.pushDevices === 0 && sessionStorage.getItem('hidePushBanner') !== '1') {
    blocks.push(el('div', { class: 'banner', style: 'padding:14px 16px' }, [
      el('p', { text: '想收到纪念日和对方的新动态？先按引导开启通知。' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small', type: 'button', text: '去开启', onclick: () => go('guide') }),
        el('button', { class: 'text-btn', type: 'button', text: '稍后', onclick: (event) => {
          sessionStorage.setItem('hidePushBanner', '1');
          event.currentTarget.closest('.banner').remove();
        } }),
      ]),
    ]));
  }
  main.replaceChildren(...blocks);
}

function anniversaryForm(item, onDone) {
  const yearly = el('input', { type: 'checkbox', checked: item ? item.yearly : true });
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const body = { title: data.get('title'), date: data.get('date'), yearly: yearly.checked };
      try {
        if (item) await api(`/api/anniversaries/${item.id}`, { method: 'PATCH', json: body });
        else await api('/api/anniversaries', { method: 'POST', json: body });
        modal.close();
        onDone();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('div', { class: 'sheet-bar' }, [
      el('h3', { text: item ? '编辑纪念日' : '添加纪念日' }),
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => modal.close() }),
    ]),
    field('名称', el('input', { class: 'input', name: 'title', required: true, maxlength: '40', value: item?.title || '' })),
    field('日期', el('input', { class: 'input', name: 'date', type: 'date', required: true, value: item?.date || '' })),
    el('label', { class: 'row' }, [yearly, el('span', { text: '每年重复' })]),
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

async function loadAlbum(main, ctx) {
  const data = await api('/api/photos?limit=60');
  if (ctx.expired()) return;
  const input = fileInput();
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    S.uploading = files.length;
    mount();
    let index = 0;
    for (const file of files) {
      index += 1;
      S.uploading = files.length - index + 1;
      if (file.size > S.maxUploadMb * 1024 * 1024) {
        toast(`有照片超过 ${S.maxUploadMb}MB，已跳过`);
        continue;
      }
      const body = new FormData();
      body.append('file', file);
      try {
        await api('/api/photos', { method: 'POST', body });
      } catch (error) {
        toast(error.message);
      }
    }
    S.uploading = 0;
    mount();
  });
  const blocks = [el('div', { class: 'toolbar' }, [
    el('h2', { text: '相册' }),
    el('button', { class: 'btn small', type: 'button', text: '上传', onclick: () => input.click() }),
  ]), input];
  const todayKey = data.today || '';
  const sameDay = (data.photos || []).filter((photo) => {
    const key = dayKey(photo.createdAt, S.me.timezone);
    return key && todayKey && key.slice(5) === todayKey.slice(5) && key.slice(0, 4) !== todayKey.slice(0, 4);
  });
  if (sameDay[0]) {
    blocks.push(el('button', { class: 'onthis', type: 'button', onclick: () => openPhotos(data.photos, data.photos.indexOf(sameDay[0])) }, [
      el('img', { src: mediaUrl(sameDay[0].id, 'thumb'), alt: '' }),
      el('div', {}, [el('p', { class: 'kicker', text: '那年今日' }), el('p', { text: formatDay(dayKey(sameDay[0].createdAt, S.me.timezone)) })]),
    ]));
  }
  if (data.photos[0]) {
    blocks.push(el('button', { class: 'cover-wide', type: 'button', onclick: () => openPhotos(data.photos, 0) }, [
      el('img', { src: mediaUrl(data.photos[0].id, 'full'), alt: data.photos[0].caption || '封面' }),
    ]));
  }
  if (S.uploading) blocks.push(el('div', { class: 'grid' }, [el('div', { class: 'tile pending', text: `上传中 ${S.uploading}` })]));
  if (!data.photos.length && !S.uploading) blocks.push(emptyState('album', '把今天拍下来，只给你们两个人看。'));
  let month = '';
  let grid = null;
  data.photos.forEach((photo, index) => {
    const label = monthLabel(photo.createdAt, S.me.timezone);
    if (label !== month) {
      month = label;
      blocks.push(el('p', { class: 'month', text: label }));
      grid = el('div', { class: 'grid' });
      blocks.push(grid);
    }
    grid.append(el('button', { class: 'tile', type: 'button', 'aria-label': photo.caption || '查看照片', onclick: () => openPhotos(data.photos, index) }, [
      el('img', { src: mediaUrl(photo.id, 'thumb'), alt: photo.caption || '照片', loading: 'lazy' }),
    ]));
  });
  main.replaceChildren(...blocks);
}

function openPhotos(photos, start) {
  let index = start;
  const image = el('img', { alt: '照片' });
  const show = () => {
    const photo = photos[index];
    image.src = mediaUrl(photo.id, 'full');
    image.alt = photo.caption || '照片';
  };
  show();
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  const root = el('div', { class: 'lightbox' }, [
    el('div', { class: 'row' }, [
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => root.remove() }),
      el('button', { class: 'text-btn', type: 'button', text: '删除', onclick: async () => {
        const photo = photos[index];
        if (!photo.mine) {
          toast('只能删除自己上传的照片');
          return;
        }
        if (!await askConfirm('删除照片', '这张照片会从相册里消失。')) return;
        await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
        root.remove();
        mount();
      } }),
    ]),
    image,
  ]);
  root.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dy = 0;
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', (event) => {
    if (!startX) return;
    dx = event.clientX - startX;
    dy = event.clientY - startY;
    image.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  root.addEventListener('pointerup', () => {
    image.style.transform = '';
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) root.remove();
    else if (dx < -50 && index < photos.length - 1) {
      index += 1;
      show();
    } else if (dx > 50 && index > 0) {
      index -= 1;
      show();
    }
    startX = 0;
  });
  document.body.append(root);
}

async function loadDiary(main, ctx) {
  const data = await api('/api/diary?limit=40');
  if (ctx.expired()) return;
  const blocks = [el('div', { class: 'toolbar' }, [
    el('h2', { text: '日记' }),
    el('button', { class: 'btn small', type: 'button', text: '写一篇', onclick: () => diaryForm(null, () => mount()) }),
  ])];
  if (!data.entries.length) blocks.push(emptyState('diary', '写给自己，或者写给你们两个。'));
  for (const entry of data.entries) {
    const key = dayKey(entry.createdAt, data.timezone);
    const [, month, day] = (key || '----').split('-');
    blocks.push(el('div', { class: 'tl' }, [
      el('div', { class: 'tl-date' }, [el('small', { text: month ? `${Number(month)}月` : '' }), el('strong', { text: day ? String(Number(day)) : '' })]),
      diaryCard(entry, data.timezone),
    ]));
  }
  main.replaceChildren(...blocks);
}

function diaryCard(entry) {
  return el('article', { class: entry.visibility === 'private' ? 'entry private' : 'entry' }, [
    el('div', { class: 'who' }, [
      avatar(entry.authorName),
      el('strong', { text: entry.authorName }),
      entry.moodLabel ? el('span', { class: 'tag', text: entry.moodLabel }) : null,
      entry.visibility === 'private' ? lockIcon() : null,
    ]),
    el('p', { text: entry.content }),
    entry.photoId ? el('img', { class: 'thumb', src: mediaUrl(entry.photoId, 'full'), alt: '日记里的照片', loading: 'lazy' }) : null,
    entry.mine ? el('div', { class: 'row' }, [
      el('button', { class: 'btn ghost small', type: 'button', text: '编辑', onclick: () => diaryForm(entry, () => mount()) }),
      el('button', { class: 'btn ghost small', type: 'button', text: '删除', onclick: async () => {
        if (!await askConfirm('删除日记', '删掉之后，这篇日记和附带的照片都会消失。')) return;
        await api(`/api/diary/${entry.id}`, { method: 'DELETE' });
        mount();
      } }),
    ]) : null,
  ]);
}

function diaryForm(entry, onDone) {
  let mood = entry?.mood || '';
  let visibility = entry?.visibility || 'shared';
  let file = null;
  const moodBox = el('div', { class: 'chips' });
  const redrawMoods = () => {
    moodBox.replaceChildren(...S.moods.map((item) => el('button', {
      class: item.id === mood ? 'chip active' : 'chip',
      type: 'button',
      text: item.label,
      onclick: () => { mood = mood === item.id ? '' : item.id; redrawMoods(); },
    })));
  };
  redrawMoods();
  const vis = el('div', { class: 'seg' }, [
    ['shared', '双方可见'],
    ['private', '仅自己可见'],
  ].map(([id, label]) => el('button', {
    class: visibility === id ? 'active' : '',
    type: 'button',
    text: label,
    onclick: (event) => {
      visibility = id;
      [...event.currentTarget.parentElement.children].forEach((button) => button.classList.toggle('active', button === event.currentTarget));
    },
  })));
  const fileName = el('p', { class: 'muted', text: entry?.photoId ? '已有一张照片，重新选择会换掉它' : '可以不附照片' });
  const input = fileInput();
  input.addEventListener('change', () => {
    file = input.files[0] || null;
    fileName.textContent = file ? file.name : '可以不附照片';
  });
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const content = new FormData(event.currentTarget).get('content');
      try {
        if (file) {
          const body = new FormData();
          body.append('content', content);
          body.append('mood', mood);
          body.append('visibility', visibility);
          body.append('file', file);
          if (entry) await api(`/api/diary/${entry.id}`, { method: 'PATCH', body });
          else await api('/api/diary', { method: 'POST', body });
        } else {
          const json = { content, mood, visibility };
          if (entry) await api(`/api/diary/${entry.id}`, { method: 'PATCH', json });
          else await api('/api/diary', { method: 'POST', json });
        }
        modal.close();
        onDone();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('div', { class: 'sheet-bar' }, [
      el('h3', { text: entry ? '编辑日记' : '写一篇' }),
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => modal.close() }),
    ]),
    el('textarea', { class: 'textarea letter', name: 'content', required: true, maxlength: '5000', placeholder: '今天想记下什么', value: entry?.content || '' }),
    moodBox,
    vis,
    input,
    el('button', { class: 'btn ghost', type: 'button', text: '添加照片', onclick: () => input.click() }),
    fileName,
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

async function loadList(main, ctx) {
  const [data, daily] = await Promise.all([api('/api/checklist'), api('/api/daily/today')]);
  if (ctx.expired()) return;
  const done = data.items.filter((item) => item.completedAt).length;
  const total = data.items.length || 1;
  const ring = ns('svg', { viewBox: '0 0 80 80', 'aria-hidden': 'true' });
  const length = 2 * Math.PI * 32;
  ring.append(ns('circle', { class: 'ring-bg', cx: '40', cy: '40', r: '32' }));
  ring.append(ns('circle', { class: 'ring', cx: '40', cy: '40', r: '32', 'stroke-dasharray': `${length * (done / total)} ${length}` }));
  const blocks = [
    el('div', { class: 'ring-wrap' }, [
      ring,
      el('div', {}, [
        el('p', { class: 'kicker', text: '恋爱清单' }),
        el('h2', { text: `已完成 ${done}/${data.items.length}` }),
      ]),
    ]),
    el('button', { class: 'entry-card ask-link', type: 'button', onclick: () => go('ask') }, [
      el('p', { class: 'kicker', text: '今日一问' }),
      el('p', { text: daily.daily.question }),
    ]),
  ];
  if (!data.items.length) blocks.push(emptyState('list', '列一件想一起完成的小事。'));
  for (const item of data.items) blocks.push(checklistCard(item));
  blocks.push(el('form', {
    class: 'row',
    onsubmit: async (event) => {
      event.preventDefault();
      const title = new FormData(event.currentTarget).get('title');
      try {
        await api('/api/checklist', { method: 'POST', json: { title } });
        mount();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('input', { class: 'input', name: 'title', maxlength: '40', placeholder: '再加一件想一起做的事', required: true }),
    el('button', { class: 'btn small', type: 'submit', text: '添加' }),
  ]));
  main.replaceChildren(...blocks);
}

function checklistCard(item) {
  const body = el('div', { class: 'stack' }, [
    el('h3', { text: item.title }),
    item.completedAt ? el('p', { class: 'muted', text: `${formatDay(dayKey(item.completedAt, S.me?.timezone))} · ${item.completedByName || ''}` }) : null,
    item.note ? el('p', { text: item.note }) : null,
    item.photoId ? el('div', { class: 'polaroid' }, [
      el('img', { src: mediaUrl(item.photoId, 'thumb'), alt: '完成时的照片' }),
      el('p', { text: item.note || formatDay(String(item.completedAt).slice(0, 10)) }),
    ]) : null,
    el('button', { class: 'text-btn', type: 'button', text: '删除', onclick: async () => {
      if (!await askConfirm('删除这一项', `确定删除「${item.title}」？`)) return;
      await api(`/api/checklist/${item.id}`, { method: 'DELETE' });
      mount();
    } }),
  ]);
  const box = el('button', {
    class: 'box',
    type: 'button',
    'aria-label': item.completedAt ? '取消完成' : '标记完成',
    text: item.completedAt ? '✓' : '',
    onclick: (event) => {
      burst(event.currentTarget);
      if (item.completedAt) uncompleteItem(item);
      else completeItem(item);
    },
  });
  return el('article', { class: item.completedAt ? 'check done' : 'check' }, [box, body]);
}

function completeItem(item) {
  let file = null;
  const input = fileInput();
  const name = el('p', { class: 'muted', text: '照片可以不传' });
  input.addEventListener('change', () => {
    file = input.files[0] || null;
    name.textContent = file ? file.name : '照片可以不传';
  });
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const note = new FormData(event.currentTarget).get('note') || '';
      try {
        if (file) {
          const body = new FormData();
          body.append('note', note);
          body.append('file', file);
          await api(`/api/checklist/${item.id}/complete`, { method: 'POST', body });
        } else {
          await api(`/api/checklist/${item.id}/complete`, { method: 'POST', json: { note } });
        }
        modal.close();
        confetti();
        mount();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('h3', { text: item.title }),
    field('想留一句吗', el('input', { class: 'input', name: 'note', maxlength: '200', placeholder: '可选' })),
    input,
    el('button', { class: 'btn ghost', type: 'button', text: '附一张照片', onclick: () => input.click() }),
    name,
    el('button', { class: 'btn full', type: 'submit', text: '标记完成' }),
  ]));
}

async function uncompleteItem(item) {
  if (!await askConfirm('取消完成', `把「${item.title}」改回未完成？`)) return;
  await api(`/api/checklist/${item.id}/uncomplete`, { method: 'POST' });
  mount();
}

async function loadAsk(main, ctx) {
  const [today, history] = await Promise.all([api('/api/daily/today'), api('/api/daily/history?limit=30')]);
  if (ctx.expired()) return;
  const daily = today.daily;
  let streak = 0;
  if (daily.revealed) {
    streak = 1;
    let cursor = shiftDay(daily.date, -1);
    const revealed = new Map(history.items.filter((item) => item.revealed).map((item) => [item.date, true]));
    while (revealed.get(cursor)) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
    }
  }
  const blocks = [
    el('section', { class: 'qa' }, [
      el('p', { class: 'kicker', text: formatDay(daily.date) }),
      el('p', { class: 'question', text: daily.question }),
      daily.myAnswer ? el('div', { class: 'answer' }, [el('strong', { text: '我' }), el('p', { text: daily.myAnswer })]) : null,
      daily.revealed ? el('div', { class: 'answer' }, [el('strong', { text: daily.partnerName || '对方' }), el('p', { text: daily.partnerAnswer })]) : null,
      daily.myAnswer && !daily.revealed ? el('div', { class: 'veil' }, [
        el('p', { class: 'ghost', text: '答案在这里，等两个人都写完。' }),
        el('div', { class: 'lockup' }, [lockIcon(), el('span', { text: '等 TA 回答' })]),
      ]) : null,
      !daily.myAnswer || !daily.locked ? answerForm(daily) : null,
    ]),
    el('p', { class: 'streak', text: streak ? `连续 ${streak} 天都回答了` : '从今天开始，一天一问。' }),
    el('h2', { text: '以前的问题' }),
  ];
  if (!history.items.length) blocks.push(emptyState('ask', '过去的问答会出现在这里。'));
  for (const item of history.items) {
    blocks.push(el('article', { class: 'card' }, [
      el('p', { class: 'muted', text: formatDay(item.date) }),
      el('p', { class: 'letter', text: item.question }),
      item.myAnswer ? el('p', { class: 'muted', text: `我：${item.myAnswer}` }) : el('p', { class: 'muted', text: '这一天没有两个人都回答' }),
      item.revealed ? el('p', { class: 'muted', text: `${item.partnerName || '对方'}：${item.partnerAnswer}` }) : null,
    ]));
  }
  main.replaceChildren(...blocks);
}

function answerForm(daily) {
  return el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const answer = new FormData(event.currentTarget).get('answer');
      try {
        await api('/api/daily/today', { method: 'POST', json: { answer } });
        mount();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('textarea', { class: 'textarea letter', name: 'answer', required: true, maxlength: '2000', placeholder: daily.myAnswer ? '揭晓前还可以改' : '写下你的回答', value: daily.myAnswer || '' }),
    el('button', { class: 'btn full', type: 'submit', text: daily.myAnswer ? '更新回答' : '提交回答' }),
  ]);
}

function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthCells(month) {
  const [year, mon] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(`${month}-${String(day).padStart(2, '0')}`);
  return cells;
}

function scopeTag(todo) {
  const label = todo.scopeLabel || '我们的';
  const kind = todo.scope === 'mine' ? 'mine' : todo.scope === 'ours' ? 'ours' : 'theirs';
  return el('span', { class: `tag ${kind}`, text: label });
}

function todoForm(todo, presetDate) {
  let scope = todo?.scope || 'ours';
  const choices = [['mine', '我的'], ['theirs', '对方的'], ['ours', '我们的']];
  if (todo?.scope === 'received') choices.unshift(['received', '给我的']);
  const scopeBox = el('div', { class: 'seg' });
  const drawScope = () => {
    scopeBox.replaceChildren(...choices.map(([id, label]) => el('button', {
      class: scope === id ? 'active' : '',
      type: 'button',
      text: label,
      onclick: () => { scope = id; drawScope(); },
    })));
  };
  drawScope();
  const time = el('input', { class: 'input', name: 'dueTime', type: 'time', value: todo?.dueTime || '' });
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const dueDate = String(form.get('dueDate') || '');
      const dueTime = String(form.get('dueTime') || '');
      if (dueTime && !dueDate) {
        toast('选了时间就要选日期');
        return;
      }
      const body = { title: form.get('title'), note: form.get('note') || '', dueDate, dueTime, scope };
      try {
        if (todo?.id) await api(`/api/todos/${todo.id}`, { method: 'PATCH', json: body });
        else await api('/api/todos', { method: 'POST', json: body });
        modal.close();
        mount();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('div', { class: 'sheet-bar' }, [
      el('h3', { text: todo?.id ? '编辑待办' : '新待办' }),
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => modal.close() }),
    ]),
    field('标题', el('input', { class: 'input', name: 'title', required: true, maxlength: '40', value: todo?.title || '' })),
    el('div', { class: 'stack' }, [el('span', { class: 'label', text: '这是谁的' }), scopeBox]),
    el('p', { class: 'muted', text: '「我的」只有自己能看到，也不会通知对方。' }),
    field('日期，可以不选', el('input', { class: 'input', name: 'dueDate', type: 'date', value: todo?.dueDate || presetDate || '' })),
    field('时间，可以不选', time),
    field('备注', el('textarea', { class: 'textarea', name: 'note', maxlength: '500', value: todo?.note || '' })),
    todo?.id ? el('button', { class: 'btn danger full', type: 'button', text: '删除', onclick: async () => {
      if (!await askConfirm('删除待办', `确定删除「${todo.title}」？`)) return;
      await api(`/api/todos/${todo.id}`, { method: 'DELETE' });
      modal.close();
      mount();
    } }) : null,
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

function todoSwipe(todo) {
  const card = el('div', { class: 'swipe-card' }, [
    el('div', { class: 'split' }, [
      el('strong', { text: todo.title }),
      scopeTag(todo),
    ]),
    el('p', { class: 'muted', text: [todo.dueTime || '', todo.note || '', todo.completedAt ? '已完成' : '左滑完成，右滑编辑'].filter(Boolean).join(' · ') }),
    el('button', {
      class: 'text-btn',
      type: 'button',
      text: todo.completedAt ? '取消完成' : '完成',
      onclick: async (event) => {
        burst(event.currentTarget);
        await api(`/api/todos/${todo.id}/${todo.completedAt ? 'uncomplete' : 'complete'}`, { method: 'POST' });
        if (!todo.completedAt) confetti();
        mount();
      },
    }),
  ]);
  let origin = 0;
  let dx = 0;
  let active = false;
  card.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    active = true;
    origin = event.clientX;
    dx = 0;
  });
  card.addEventListener('pointermove', (event) => {
    if (!active) return;
    dx = event.clientX - origin;
    card.style.transform = `translateX(${Math.max(-110, Math.min(110, dx))}px)`;
  });
  card.addEventListener('pointerup', async () => {
    if (!active) return;
    active = false;
    card.style.transform = '';
    if (dx < -70 && !todo.completedAt) {
      await api(`/api/todos/${todo.id}/complete`, { method: 'POST' });
      confetti();
      mount();
    } else if (dx > 70) todoForm(todo);
    dx = 0;
  });
  card.addEventListener('pointercancel', () => {
    active = false;
    card.style.transform = '';
  });
  return el('div', { class: 'swipe' }, [
    el('div', { class: 'swipe-bg' }, [el('span', { text: '编辑' }), el('span', { text: '完成' })]),
    card,
  ]);
}

async function loadCal(main, ctx) {
  const data = await api(`/api/calendar/month${S.calMonth ? `?month=${S.calMonth}` : ''}`);
  if (ctx.expired()) return;
  S.calMonth = data.month;
  if (!S.calDay || !S.calDay.startsWith(data.month)) {
    S.calDay = data.today.startsWith(data.month) ? data.today : `${data.month}-01`;
  }
  const byDay = new Map();
  for (const event of data.events) {
    if (!byDay.has(event.date)) byDay.set(event.date, []);
    byDay.get(event.date).push(event);
  }
  const cells = monthCells(data.month).map((date) => {
    if (!date) return el('span');
    const events = byDay.get(date) || [];
    const dots = [];
    if (events.some((event) => event.kind === 'anniversary')) dots.push(el('span', { class: 'dot heart', text: '♥' }));
    for (const kind of ['mine', 'theirs', 'ours']) {
      if (events.some((event) => event.kind === 'todo' && (event.todo.scope === kind || (kind === 'theirs' && event.todo.scope === 'received')))) {
        dots.push(el('span', { class: `dot ${kind}` }));
      }
    }
    return el('button', {
      class: `day-cell${date === data.today ? ' today' : ''}${date === S.calDay ? ' selected' : ''}`,
      type: 'button',
      onclick: () => { S.calDay = date; mount(); },
    }, [el('span', { text: String(Number(date.slice(8))) }), el('span', { class: 'marks' }, dots)]);
  });
  const dayEvents = byDay.get(S.calDay) || [];
  const blocks = [
    el('div', { class: 'toolbar' }, [
      el('h2', { text: '日历' }),
      el('button', { class: 'btn small', type: 'button', text: '新待办', onclick: () => todoForm(null, S.calDay) }),
    ]),
    el('div', { class: 'cal-head' }, [
      el('button', { class: 'text-btn', type: 'button', text: '上个月', onclick: () => { S.calMonth = shiftMonth(data.month, -1); S.calDay = ''; mount(); } }),
      el('strong', { text: `${Number(data.month.slice(0, 4))}年${Number(data.month.slice(5))}月` }),
      el('button', { class: 'text-btn', type: 'button', text: '下个月', onclick: () => { S.calMonth = shiftMonth(data.month, 1); S.calDay = ''; mount(); } }),
    ]),
    el('div', { class: 'weekdays' }, ['一', '二', '三', '四', '五', '六', '日'].map((label) => el('span', { class: 'weekday', text: label }))),
    el('div', { class: 'month-grid' }, cells),
    el('h2', { text: formatDay(S.calDay) }),
  ];
  if (!dayEvents.length) blocks.push(emptyState('cal', '这一天还空着。记一件小事，或者一个纪念日。'));
  for (const event of dayEvents) {
    if (event.kind === 'anniversary') {
      blocks.push(el('article', { class: 'card' }, [
        el('p', { class: 'kicker', text: '纪念日' }),
        el('h3', { text: event.title }),
        el('p', { class: 'muted', text: event.yearly ? '每年' : '只有一次' }),
        el('button', { class: 'text-btn', type: 'button', text: '编辑', onclick: () => anniversaryForm({ id: event.id, title: event.title, date: event.sourceDate || event.date, yearly: event.yearly }, () => mount()) }),
      ]));
    } else blocks.push(todoSwipe(event.todo));
  }
  if (data.undated.length) {
    blocks.push(el('h2', { text: '没有日期' }));
    for (const todo of data.undated) blocks.push(todoSwipe(todo));
  }
  main.replaceChildren(...blocks);
}

function group(title, ...rows) {
  return el('section', { class: 'group' }, [
    el('p', { class: 'group-title', text: title }),
    el('div', { class: 'group-card' }, rows),
  ]);
}

function rowButton(text, onclick, extra = '') {
  return el('button', { class: `row-link ${extra}`, type: 'button', text, onclick });
}

async function loadSettings(main, ctx) {
  const [data, feed] = await Promise.all([api('/api/me'), api('/api/calendar/feed')]);
  if (ctx.expired()) return;
  S.me = data.me;
  const me = data.me;
  const theme = localStorage.getItem(THEME_KEY) || 'system';
  const accent = localStorage.getItem(ACCENT_KEY) || 'rose';
  const coverInput = fileInput();
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    coverInput.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      const uploaded = await api('/api/photos', { method: 'POST', body });
      const result = await api('/api/settings', { method: 'PATCH', json: { coverPhotoId: uploaded.photo.id } });
      S.me = result.me;
      toast('首页背景已更新');
      mount();
    } catch (error) {
      toast(error.message);
    }
  });
  main.replaceChildren(
    el('section', { class: 'group-card profile' }, [
      avatar(me.displayName),
      heartIcon(),
      avatar(me.partner?.displayName || 'TA'),
      el('div', {}, [
        el('strong', { text: `${me.displayName} 和 ${me.partner?.displayName || '对方'}` }),
        el('p', { class: 'muted', text: me.togetherSince ? `从 ${formatDay(me.togetherSince)} 开始` : '还没记下开始的日子' }),
      ]),
    ]),
    group('我们',
      rowButton('更换首页背景', () => coverInput.click()),
      me.coverPhotoId ? rowButton('去掉背景，用回渐变', async () => {
        const result = await api('/api/settings', { method: 'PATCH', json: { coverPhotoId: null } });
        S.me = result.me;
        mount();
      }) : null,
      rowButton('称呼、日期和时区', () => profileForm(me)),
      coverInput,
    ),
    group('日历订阅',
      el('div', { class: 'pad' }, [
        el('p', { text: '订阅是单向的。待办和纪念日会出现在系统日历里。在 iPhone 日历里修改或删除，不会同步回这里。' }),
      ]),
      el('div', { class: 'pad' }, [el('a', { class: 'btn full', href: feed.webcalUrl, text: '订阅到 iPhone 日历' })]),
      rowButton('复制 https 链接', async () => {
        try {
          await navigator.clipboard.writeText(feed.httpsUrl);
          toast('链接已复制');
        } catch {
          toast('请长按下面的链接手动复制');
        }
      }),
      el('div', { class: 'pad' }, [el('input', { class: 'input', value: feed.httpsUrl, readonly: true })]),
      el('ol', { class: 'steps pad' }, [
        '用 Safari 打开这个网站，地址要是 https。',
        '点「订阅到 iPhone 日历」。如果没有弹出，就复制 https 链接。',
        '打开系统「日历」→「日历」→「添加日历」→「添加订阅日历」。',
        '系统自己刷新，通常不会马上出现。「我的」待办只在你的订阅里。',
      ].map((text) => el('li', { text }))),
      rowButton('重置订阅链接', async () => {
        if (!await askConfirm('重置订阅链接', '旧链接会马上失效。两台手机如果已经订阅，都要重新添加。')) return;
        await api('/api/calendar/feed/reset', { method: 'POST' });
        toast('已换成新链接');
        mount();
      }, 'danger-text'),
    ),
    group('通知',
      rowButton(me.pushDevices ? `已有 ${me.pushDevices} 台设备开启` : '开启通知', () => go('guide')),
    ),
    group('外观',
      ...[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([id, label]) => rowButton(label, () => {
        localStorage.setItem(THEME_KEY, id);
        applyTheme();
        mount();
      }, theme === id ? 'choice active' : 'choice')),
      el('div', { class: 'swatches' }, [
        ['rose', '#E8687F'],
        ['peach', '#E8896A'],
        ['lilac', '#9B86E0'],
        ['mint', '#5EAE9A'],
      ].map(([id, color]) => el('button', {
        class: accent === id ? 'swatch on' : 'swatch',
        type: 'button',
        'aria-label': id,
        style: `background:${color}`,
        onclick: () => {
          localStorage.setItem(ACCENT_KEY, id);
          applyTheme();
          mount();
        },
      }))),
    ),
    group('备份与隐私',
      el('div', { class: 'pad' }, [el('p', { class: 'muted', text: '导出包含双方可见的内容、你自己的私密日记和私密待办，以及你能看到的照片。' })]),
      rowButton('打包下载', exportData),
      rowButton('修改密码', () => passwordForm()),
    ),
    group('危险操作',
      rowButton('清空内容', () => danger('清空内容', '/api/danger/wipe', '日记、照片、待办、清单记录和问答会被清空，两个账号还在。日历订阅链接还在。'), 'danger-text'),
      rowButton('删除全部并重新开始', () => danger('删除全部', '/api/danger/reset', '账号和全部内容都会删除，网站回到第一次打开的样子。网页里无法撤销，只能靠服务器上的备份恢复。', true), 'danger-text'),
      rowButton('退出登录', async () => {
        await api('/api/logout', { method: 'POST' });
        S.me = null;
        go('login');
      }),
    ),
  );
}

function profileForm(me) {
  const hours = Array.from({ length: 18 }, (_, index) => index + 6);
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const result = await api('/api/settings', {
          method: 'PATCH',
          json: {
            displayName: form.get('displayName'),
            togetherSince: form.get('togetherSince'),
            timezone: form.get('timezone'),
            reminderHour: Number(form.get('reminderHour')),
          },
        });
        S.me = result.me;
        modal.close();
        toast('已保存');
        mount();
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('div', { class: 'sheet-bar' }, [
      el('h3', { text: '我们的资料' }),
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => modal.close() }),
    ]),
    field('我的称呼', el('input', { class: 'input', name: 'displayName', required: true, maxlength: '20', value: me.displayName })),
    field('在一起的日期', el('input', { class: 'input', name: 'togetherSince', type: 'date', required: true, value: me.togetherSince || '' })),
    field('时区', el('select', { class: 'select', name: 'timezone' }, S.timezones.map((zone) => (
      el('option', { value: zone.id, text: zone.label, selected: zone.id === me.timezone })
    )))),
    field('提醒时间', el('select', { class: 'select', name: 'reminderHour' }, hours.map((hour) => (
      el('option', { value: String(hour), text: `${hour} 点`, selected: hour === me.reminderHour })
    )))),
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

function passwordForm() {
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (form.get('next') !== form.get('next2')) {
        toast('两次新密码不一致');
        return;
      }
      try {
        const result = await api('/api/me/password', {
          method: 'POST',
          json: { currentPassword: form.get('current'), newPassword: form.get('next') },
        });
        S.me = result.me;
        modal.close();
        toast('密码已更新，其他设备需要重新登录');
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('h3', { text: '修改密码' }),
    field('当前密码', el('input', { class: 'input', name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    field('新密码', el('input', { class: 'input', name: 'next', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
    field('再输入一次', el('input', { class: 'input', name: 'next2', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

async function exportData() {
  try {
    const response = await api('/api/export', { method: 'POST', raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `两个人-${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) {
    toast(error.message);
  }
}

function danger(phrase, path, description, reset) {
  const modal = openModal(el('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (String(form.get('confirm')).trim() !== phrase) {
        toast(`请完整输入「${phrase}」`);
        return;
      }
      try {
        await api(path, { method: 'POST', json: { password: form.get('password'), confirm: phrase } });
        modal.close();
        if (reset) {
          S.me = null;
          S.initialized = false;
          S.ready = null;
          go('setup');
        } else {
          toast('内容已清空');
          go('home');
        }
      } catch (error) {
        toast(error.message);
      }
    },
  }, [
    el('h3', { text: phrase }),
    el('p', { text: description }),
    field('当前密码', el('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    field(`再输入「${phrase}」确认`, el('input', { class: 'input', name: 'confirm', autocomplete: 'off', required: true })),
    el('button', { class: 'btn full', type: 'submit', text: phrase }),
  ]));
}

function loadGuide(main) {
  const info = clientInfo();
  const lines = [
    ['打开方式', info.standalone ? '已从主屏幕打开' : '当前还在浏览器里'],
    ['连接', info.https ? '是安全连接' : '还不是 HTTPS'],
    ['系统', info.ios ? (info.iosOk ? 'iPhone 系统版本可以接收网页通知' : '需要 iOS 16.4 或更高') : '不是 iPhone，仍可在支持的浏览器里开启'],
    ['权限', info.permission === 'granted' ? '已允许通知' : info.permission === 'denied' ? '系统里拒绝了通知' : '还没有询问'],
  ];
  const blocked = info.ios && !info.standalone;
  main.replaceChildren(el('div', { class: 'stack' }, [
    el('section', { class: 'card' }, [
      el('h2', { text: '在两台 iPhone 上开启通知' }),
      el('p', { class: 'muted', text: '每台手机都要单独做一遍，并且用各自的账号登录。' }),
      ...[
        '用 iPhone 自带的 Safari 打开这个网站。从微信里打开，无法添加到主屏幕。',
        '系统需要 iOS 16.4 或更高。可以在「设置 → 通用 → 关于本机」查看。',
        '点 Safari 底部的分享按钮，选择「添加到主屏幕」，再点「添加」。',
        '回到主屏幕，点「两个人」图标打开。一定要从图标进来，留在 Safari 标签里无法开启通知。',
        '主屏幕里的登录和 Safari 不一定共用，打开后如果看到登录页，再用自己的账号登录一次。',
        '进入这一页，点下面的按钮，在系统弹窗里选择允许。',
      ].map((text, index) => el('div', { class: 'guide-step' }, [
        el('span', { class: 'num', text: String(index + 1) }),
        el('p', { text }),
      ])),
    ]),
    el('section', { class: 'card' }, [
      el('h3', { text: '这台设备' }),
      el('ul', { class: 'status' }, lines.map(([name, value]) => el('li', { text: `${name}：${value}` }))),
    ]),
    el('button', {
      class: 'btn full',
      type: 'button',
      text: blocked ? '请先从主屏幕打开' : '开启通知',
      disabled: blocked,
      onclick: enablePush,
    }),
    info.permission === 'denied' ? el('p', { class: 'muted', text: '如果已经拒绝，请到 iPhone 的「设置 → 通知 → 两个人」里重新打开。' }) : null,
  ]));
}

async function enablePush() {
  const info = clientInfo();
  if (!info.https) {
    toast('通知需要用 HTTPS 域名打开');
    return;
  }
  if (!info.push) {
    toast('这台设备不支持网页通知');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('没有获得通知权限');
      mount();
      return;
    }
    const key = await api('/api/push/public-key');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      });
    }
    const result = await api('/api/push/subscribe', { method: 'POST', json: subscription.toJSON() });
    S.me.pushDevices = result.pushDevices;
    toast('这台设备的通知已开启');
    mount();
  } catch (error) {
    toast(error.message || '开启失败');
  }
}

const pages = {
  home: loadHome,
  album: loadAlbum,
  diary: loadDiary,
  list: loadList,
  ask: loadAsk,
  cal: loadCal,
  settings: loadSettings,
  guide: async (main) => loadGuide(main),
  missing: async (main) => main.replaceChildren(emptyState('home', '没有这一页'), el('button', { class: 'btn', type: 'button', text: '回首页', onclick: () => go('home') })),
};

async function mount() {
  const gen = ++generation;
  const ctx = { expired: () => gen !== generation };
  clearInterval(clockTimer);
  if (!S.initialized || (S.ready && !S.me)) {
    app.replaceChildren(setupView());
    return;
  }
  if (!S.me) {
    app.replaceChildren(loginView());
    return;
  }
  app.replaceChildren(shell());
  const main = document.getElementById('main');
  main.append(el('p', { class: 'muted', text: '加载中…' }));
  try {
    await (pages[S.route] || pages.missing)(main, ctx);
  } catch (error) {
    if (ctx.expired() || error.status === 401) return;
    main.replaceChildren(el('p', { class: 'error', text: error.message || '加载失败' }));
  }
}

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'system') === 'system') applyTheme();
  });
  window.addEventListener('hashchange', () => {
    if (booting) return;
    ensureRoute();
    mount();
  });
  try {
    const data = await api('/api/bootstrap');
    S.initialized = data.initialized;
    S.me = data.me;
    S.moods = data.moods || [];
    S.timezones = data.timezones || [];
    S.maxUploadMb = data.maxUploadMb || 12;
  } catch (error) {
    app.replaceChildren(el('p', { class: 'boot', text: error.message || '连不上服务器' }));
    return;
  }
  ensureRoute();
  await mount();
  booting = false;
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message;
    if (message) toast(message);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
