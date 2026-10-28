import { CUISINES, MODES, decide, recentCuisineIds, rerollAllowed } from './eat-decide.js';

const KEY = 'couple-eat-guest';
const PLATFORMS = [
  ['', '不填'],
  ['doordash', 'DoorDash'],
  ['ubereats', 'Uber Eats'],
  ['fantuan', '饭团'],
  ['other', '其他'],
];
const root = document.getElementById('eat');
const S = {
  tab: 'pick',
  authed: false,
  step: 'who',
  solo: true,
  seat: 'a',
  covered: false,
  draft: blank(),
  votes: { a: null, b: null },
  result: null,
  rerolls: 0,
  places: [],
  logs: [],
  recent: [],
  round: null,
  partnerActive: false,
  filter: '',
};
let pollTimer = 0;
let celebratedKey = '';

function blank() {
  return { energy: '', mood: 'any', budget: '', mode: '', cuisines: {} };
}

function applyTheme() {
  const theme = localStorage.getItem('couple-theme') || 'system';
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1C1517' : '#FFF8F4';
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

function loadGuest() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function saveGuest() {
  if (S.authed) return;
  const saved = loadGuest();
  saved.places = S.places;
  saved.logs = S.logs;
  localStorage.setItem(KEY, JSON.stringify(saved));
}

async function api(path, options = {}) {
  const headers = { 'X-Requested-With': 'couple', ...(options.headers || {}) };
  const init = { method: options.method || 'GET', credentials: 'same-origin', headers };
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.json);
  } else if (options.body) init.body = options.body;
  const response = await fetch(path, init);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || '请求失败');
  return data;
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function nameOf(list, id) {
  return list.find((item) => item.id === id)?.name || id;
}

function guestResult() {
  const votes = S.solo ? [S.votes.a] : [S.votes.a, S.votes.b];
  return decide({
    votes: votes.filter(Boolean),
    recentCuisines: recentCuisineIds(S.logs, localDay()),
    places: S.places,
    previous: S.result ? { cuisine: S.result.cuisine.id, mode: S.result.mode.id } : null,
    reroll: false,
  });
}

function localDay() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function render() {
  const screen = S.tab === 'places' ? placesView() : S.tab === 'history' ? historyView() : pickView();
  const parts = [
    h('header', { class: 'top' }, [
      h('a', { href: '/', text: '返回' }),
      h('h1', { text: '今天吃啥' }),
      h('button', { class: 'text-btn', type: 'button', text: document.documentElement.dataset.theme === 'dark' ? '浅色' : '深色', onclick: () => {
        localStorage.setItem('couple-theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        applyTheme();
        render();
      } }),
    ]),
    h('main', { class: 'stage' }, [screen]),
  ];
  if (!S.covered) {
    parts.push(h('nav', { class: 'tabs', 'aria-label': '今天吃啥' }, [
      tab('pick', '选一选'),
      tab('places', '想去清单'),
      tab('history', '历史'),
    ]));
  }
  root.replaceChildren(...parts);
  schedulePoll();
}

function tab(id, label) {
  return h('button', { type: 'button', text: label, 'aria-current': S.tab === id ? 'page' : null, onclick: () => { S.tab = id; S.covered = false; render(); } });
}

function pickView() {
  if (S.covered) return coverView();
  if (S.authed && S.round?.result) return revealView(serverResult(S.round.result), true);
  if (!S.authed && S.result && S.step === 'reveal') return revealView(S.result, false);
  if (S.authed && S.round?.mineSubmitted && !S.round.result) return waitView();
  if (S.step === 'who') return whoView();
  if (S.step === 'state') return stateView();
  if (S.step === 'mode') return modeView();
  if (S.step === 'cuisine') return cuisineView();
  return whoView();
}

function whoView() {
  return h('section', { class: 'stack' }, [
    h('p', { class: 'kicker', text: S.authed ? '已登录' : '无需登录' }),
    h('h2', { text: '今天几个人拿主意？' }),
    h('p', { class: 'muted', text: S.authed ? '你们各自在自己的手机上选，都提交后才看得到结果。' : '一个人直接选。两个人就把这台手机递过去，中间会先遮住。' }),
    h('button', { class: 'big', type: 'button', text: '就我一个', onclick: () => { S.solo = true; S.seat = 'a'; S.step = 'state'; render(); } }),
    S.authed ? null : h('button', { class: 'big', type: 'button', text: '两个人，传手机', onclick: () => { S.solo = false; S.seat = 'a'; S.step = 'state'; render(); } }),
  ]);
}

function progress(step) {
  const order = ['state', 'mode', 'cuisine'];
  const index = order.indexOf(step);
  if (index < 0) return null;
  return h('div', { class: 'dots', 'aria-label': `第 ${index + 1} 步，共 3 步` }, [
    h('span', { text: `${index + 1} / 3` }),
    ...order.map((_, dot) => h('i', { class: dot <= index ? 'on' : '' })),
  ]);
}

function partnerStatus() {
  if (!S.authed) return null;
  const ready = S.round?.partnerSubmitted;
  const text = ready ? '对方已选好' : (S.partnerActive || S.round?.partnerActive ? '对方也在选' : '等对方打开');
  return h('p', { class: ready ? 'partner ready' : 'partner', text });
}

function stateView() {
  const who = S.authed ? '你' : (S.seat === 'b' ? 'TA' : '你');
  return h('section', { class: 'stack' }, [
    progress('state'),
    partnerStatus(),
    h('p', { class: 'kicker', text: `${who}来选` }),
    h('h2', { text: '现在什么状态？' }),
    group('累不累', [['tired', '很累'], ['ok', '还好'], ['fresh', '有精神']], 'energy'),
    group('心情', [['any', '随便'], ['light', '想清淡'], ['treat', '想犒劳'], ['lively', '想热闹']], 'mood'),
    group('预算', [['low', '$'], ['mid', '$$'], ['high', '$$$']], 'budget'),
    h('div', { class: 'sticky' }, [h('button', { class: 'btn', type: 'button', text: '下一步', onclick: () => {
      if (!S.draft.energy || !S.draft.budget) { toast('先选累不累和预算'); return; }
      S.step = 'mode';
      render();
    } })]),
  ]);
}

function group(title, options, key) {
  return h('div', {}, [
    h('p', { class: 'muted', text: title }),
    h('div', { class: 'chips' }, options.map(([id, label]) => h('button', {
      type: 'button',
      class: S.draft[key] === id ? 'active' : '',
      text: label,
      onclick: () => { S.draft[key] = id; render(); },
    }))),
  ]);
}

function modeView() {
  return h('section', { class: 'stack' }, [
    progress('mode'),
    partnerStatus(),
    h('p', { class: 'kicker', text: '第 2 步' }),
    h('h2', { text: '怎么吃？' }),
    ...MODES.map((mode) => h('button', {
      class: S.draft.mode === mode.id ? 'big active' : 'big',
      type: 'button',
      text: mode.name,
      onclick: () => { S.draft.mode = mode.id; S.step = 'cuisine'; render(); },
    })),
  ]);
}

function cuisineView() {
  const stamp = { love: 'LIKE', crave: '超想吃', skip: '跳过' };
  return h('section', {}, [
    progress('cuisine'),
    partnerStatus(),
    h('p', { class: 'kicker', text: '第 3 步' }),
    h('h2', { text: '想吃哪一类？' }),
    h('p', { class: 'muted', text: '不点就是都可以。跳过的不会出现在结果里。' }),
    ...CUISINES.map((cuisine) => {
      const level = S.draft.cuisines[cuisine.id];
      return h('div', { class: level && level !== 'ok' ? `cuisine stamped ${level}` : 'cuisine' }, [
        h('div', { class: 'cuisine-name' }, [
          h('strong', { text: `${cuisine.emoji} ${cuisine.name}` }),
          stamp[level] ? h('span', { class: `stamp ${level}`, text: stamp[level] }) : null,
        ]),
        h('div', { class: 'level' }, [['skip', '跳过'], ['love', 'LIKE'], ['crave', '超想吃']].map(([id, label]) => h('button', {
          type: 'button',
          class: level === id ? 'active' : '',
          text: label,
          onclick: () => {
            S.draft.cuisines[cuisine.id] = level === id ? 'ok' : id;
            render();
          },
        }))),
      ]);
    }),
    h('div', { class: 'sticky' }, [h('button', { class: 'btn', type: 'button', text: S.authed ? '提交' : (S.solo || S.seat === 'b' ? '揭晓' : '藏起来'), onclick: finishPick })]),
  ]);
}

async function finishPick() {
  const vote = { ...S.draft, cuisines: { ...S.draft.cuisines } };
  if (S.authed) {
    try {
      const data = await api('/api/eat/vote', { method: 'POST', json: vote });
      S.round = data.round;
      S.step = data.round.result ? 'reveal' : 'wait';
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  S.votes[S.seat] = vote;
  S.draft = blank();
  if (!S.solo && S.seat === 'a') {
    S.covered = true;
    S.tab = 'pick';
    render();
    return;
  }
  S.result = guestResult();
  S.rerolls = 0;
  S.step = 'reveal';
  render();
}

function coverView() {
  return h('section', { class: 'cover' }, [
    h('p', { class: 'kicker', text: '已经藏好了' }),
    h('h2', { text: '把手机递给 TA' }),
    h('p', { text: 'TA 选完之前，看不到你的选择。' }),
    h('button', { class: 'btn', type: 'button', text: '我是 TA，开始选', onclick: () => {
      S.covered = false;
      S.seat = 'b';
      S.step = 'state';
      S.draft = blank();
      render();
    } }),
  ]);
}

function waitView() {
  return h('section', { class: 'cover' }, [
    progress('cuisine'),
    partnerStatus(),
    h('p', { class: 'kicker', text: '你已经选好了' }),
    h('h2', { text: S.round?.partnerSubmitted ? '对方已选好' : '等 TA' }),
    h('p', { text: '对方提交之后，这里才会揭晓。' }),
    h('button', { class: 'btn', type: 'button', text: '看看好了没', onclick: async () => { await refreshToday(); render(); } }),
  ]);
}

function serverResult(result) {
  return {
    ok: true,
    mode: { id: result.mode, name: result.modeName },
    cuisine: { id: result.cuisine, name: result.cuisineName, emoji: result.emoji },
    quip: result.quip,
    usedFallback: result.usedFallback,
    wheel: result.wheel || [],
    places: result.places || [],
  };
}

function revealView(result, remote) {
  if (!result?.ok && result?.ok !== undefined) {
    return h('section', { class: 'stack' }, [h('h2', { text: '这轮没选出结果' }), h('button', { class: 'btn', type: 'button', text: '重新选', onclick: resetPick })]);
  }
  const place = result.places?.[0];
  const duo = S.authed || !S.solo;
  maybeCelebrate(`${result.mode.id}-${result.cuisine.id}`);
  return h('section', { class: 'stack' }, [
    h('article', { class: 'result-card' }, [
      duo ? faces() : null,
      h('p', { class: 'kicker', text: duo ? '你们俩今晚都想吃这个' : '今晚就吃这个' }),
      h('h2', { text: `${result.cuisine.emoji || ''} ${result.cuisine.name}`.trim() }),
      h('p', { text: result.mode.name }),
      h('p', { class: 'muted', text: result.quip }),
      result.usedFallback && result.wheel?.length ? wheelView(result.wheel, result.cuisine.id) : null,
      place ? h('a', { class: 'place', href: place.url || '#places', text: `${place.name}${place.url ? ' · 打开链接' : ''}` }) : null,
    ]),
    rerollAllowed(remote ? S.round.rerolls : S.rerolls) ? h('button', { class: 'btn ghost', type: 'button', text: '换一个（仅一次）', onclick: () => reroll(remote) }) : null,
    h('button', { class: 'btn ghost', type: 'button', text: '去清单里找店', onclick: () => { S.filter = result.cuisine.id; S.tab = 'places'; render(); } }),
    h('button', { class: 'btn', type: 'button', text: '就吃这个并记录', onclick: () => recordForm(result, remote) }),
  ]);
}

async function reroll(remote) {
  if (remote) {
    try {
      const data = await api(`/api/eat/rounds/${S.round.id}/reroll`, { method: 'POST' });
      S.round = data.round;
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (!rerollAllowed(S.rerolls)) return;
  const next = decide({
    votes: (S.solo ? [S.votes.a] : [S.votes.a, S.votes.b]).filter(Boolean),
    recentCuisines: recentCuisineIds(S.logs, localDay()),
    places: S.places,
    previous: { cuisine: S.result.cuisine.id },
    reroll: true,
  });
  if (!next.ok) { toast('没有别的选择了'); return; }
  S.rerolls = 1;
  S.result = next;
  render();
}

function faces() {
  const mine = S.authed ? [...(S.me?.displayName || '我')].slice(-1)[0] : '我';
  const theirs = S.authed ? [...(S.me?.partner?.displayName || 'TA')].slice(-1)[0] : 'TA';
  return h('div', { class: 'faces' }, [
    h('span', { class: 'avatar', text: mine }),
    h('span', { class: 'avatar overlap', text: theirs }),
  ]);
}

function wheelView(items, activeId) {
  return h('div', { class: 'wheel', style: `--n:${items.length}` }, items.map((item, index) => h('span', {
    class: item.id === activeId ? 'on' : '',
    style: `--i:${index}`,
    text: item.emoji,
  })));
}

function maybeCelebrate(key) {
  if (celebratedKey === key) return;
  celebratedKey = key;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'fall';
  for (let index = 0; index < 18; index += 1) {
    const bit = document.createElement('i');
    bit.textContent = index % 2 ? '♥' : '♡';
    bit.style.left = `${4 + Math.random() * 92}%`;
    bit.style.animationDelay = `${Math.random() * 0.25}s`;
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1600);
}

function recordForm(result, remote) {
  const card = h('form', { class: 'stack card', onsubmit: async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get('note') || '');
    const rating = String(form.get('rating') || '');
    const placeId = String(form.get('placeId') || '');
    if (remote) {
      try {
        const body = new FormData();
        body.append('mode', result.mode.id);
        body.append('cuisine', result.cuisine.id);
        body.append('note', note);
        body.append('rating', rating);
        if (placeId) body.append('placeId', placeId);
        if (S.round?.id) body.append('roundId', String(S.round.id));
        const file = form.get('file');
        if (file && file.size) body.append('file', file);
        await api('/api/eat/logs', { method: 'POST', body });
        toast('记下来了');
        await refreshToday();
        S.tab = 'history';
        render();
      } catch (error) {
        toast(error.message);
      }
      return;
    }
    S.logs.unshift({
      id: Date.now(),
      mode: result.mode.id,
      cuisine: result.cuisine.id,
      placeName: '',
      rating: rating ? Number(rating) : null,
      note,
      date: localDay(),
    });
    saveGuest();
    toast('记在这台手机上了');
    S.tab = 'history';
    render();
  } }, [
    h('h2', { text: '记下这顿' }),
    h('p', { text: `${result.mode.name} · ${result.cuisine.name}` }),
    h('label', {}, ['打分', h('select', { class: 'select', name: 'rating' }, ['', '1', '2', '3', '4', '5'].map((value) => h('option', { value, text: value ? `${value} 分` : '先不打' })))]),
    result.places?.length ? h('label', {}, ['清单里的店', h('select', { class: 'select', name: 'placeId' }, [
      h('option', { value: '', text: '不指定' }),
      ...result.places.map((place) => h('option', { value: String(place.id), text: place.name })),
    ])]) : null,
    h('label', {}, ['备注', h('textarea', { class: 'input', name: 'note', maxlength: '200', placeholder: '好吃吗' })]),
    remote ? h('label', {}, ['配一张照片，会放进相册', h('input', { class: 'input', name: 'file', type: 'file', accept: 'image/*' })]) : h('p', { class: 'muted', text: '未登录不上传照片。' }),
    h('button', { class: 'btn', type: 'submit', text: '保存' }),
  ]);
  root.querySelector('.stage').replaceChildren(card);
}

function placesView() {
  const list = S.places.filter((place) => !S.filter || place.cuisine === S.filter);
  return h('section', { class: 'stack' }, [
    h('div', { class: 'row' }, [
      h('h2', { text: '想去清单' }),
      h('button', { class: 'text-btn', type: 'button', text: '添加', onclick: () => placeForm() }),
    ]),
    S.filter ? h('button', { class: 'text-btn', type: 'button', text: '看全部', onclick: () => { S.filter = ''; render(); } }) : null,
    list.length ? null : h('p', { class: 'muted', text: '还没有店。把想去的记下，下次直接打开链接。' }),
    ...list.map((place) => h('article', { class: 'card' }, [
      h('strong', { text: place.name }),
      h('p', { class: 'muted', text: `${nameOf(CUISINES, place.cuisine)} · ${place.mode === 'out' ? '出去吃' : '点外卖'}${place.visited ? ' · 去过' : ''}` }),
      place.note ? h('p', { text: place.note }) : null,
      place.url ? h('a', { href: place.url, text: platformName(place.platform) || '打开链接' }) : null,
      h('button', { class: 'text-btn', type: 'button', text: '删除', onclick: () => removePlace(place.id) }),
    ])),
  ]);
}

function platformName(id) {
  return PLATFORMS.find((item) => item[0] === id)?.[1] || '';
}

function placeForm(existing) {
  const card = h('form', { class: 'stack card', onsubmit: (event) => savePlace(event, existing) }, [
    h('h2', { text: existing ? '编辑店' : '添加一家' }),
    h('label', {}, ['店名', h('input', { class: 'input', name: 'name', required: true, maxlength: '40', value: existing?.name || '' })]),
    h('label', {}, ['菜系', h('select', { class: 'select', name: 'cuisine' }, CUISINES.map((item) => h('option', { value: item.id, text: item.name, selected: item.id === existing?.cuisine })))]),
    h('label', {}, ['方式', h('select', { class: 'select', name: 'mode' }, [
      h('option', { value: 'out', text: '出去吃', selected: existing?.mode !== 'delivery' }),
      h('option', { value: 'delivery', text: '点外卖', selected: existing?.mode === 'delivery' }),
    ])]),
    h('label', {}, ['平台', h('select', { class: 'select', name: 'platform' }, PLATFORMS.map(([id, label]) => h('option', { value: id, text: label, selected: id === (existing?.platform || '') })))]),
    h('label', {}, ['链接', h('input', { class: 'input', name: 'url', placeholder: 'https://', value: existing?.url || '' })]),
    h('label', {}, ['备注', h('input', { class: 'input', name: 'note', maxlength: '200', value: existing?.note || '' })]),
    h('button', { class: 'btn', type: 'submit', text: '保存' }),
  ]);
  root.querySelector('.stage').replaceChildren(card);
}

async function savePlace(event, existing) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    name: form.get('name'),
    cuisine: form.get('cuisine'),
    mode: form.get('mode'),
    platform: form.get('platform'),
    url: form.get('url'),
    note: form.get('note'),
    visited: existing?.visited || false,
  };
  if (S.authed) {
    try {
      if (existing) await api(`/api/eat/places/${existing.id}`, { method: 'PATCH', json: body });
      else await api('/api/eat/places', { method: 'POST', json: body });
      await refreshToday();
    } catch (error) {
      toast(error.message);
      return;
    }
  } else {
    if (existing) Object.assign(existing, body);
    else S.places.unshift({ ...body, id: Date.now(), visited: false });
    saveGuest();
  }
  render();
}

async function removePlace(id) {
  if (S.authed) {
    try { await api(`/api/eat/places/${id}`, { method: 'DELETE' }); await refreshToday(); }
    catch (error) { toast(error.message); return; }
  } else {
    S.places = S.places.filter((place) => place.id !== id);
    saveGuest();
  }
  render();
}

function historyView() {
  return h('section', { class: 'stack' }, [
    h('h2', { text: '最近吃过' }),
    S.logs.length ? null : h('p', { class: 'muted', text: '吃完记一笔，最近三天吃过的菜系会被先拿掉。' }),
    ...S.logs.map((log) => h('article', { class: 'card' }, [
      h('strong', { text: `${nameOf(MODES, log.mode)} · ${nameOf(CUISINES, log.cuisine)}` }),
      h('p', { class: 'muted', text: [log.placeName || log.place_name, log.rating ? `${log.rating} 分` : '', log.date || String(log.created_at || '').slice(0, 10)].filter(Boolean).join(' · ') }),
      log.note ? h('p', { text: log.note }) : null,
    ])),
  ]);
}

function resetPick() {
  S.step = S.authed ? 'state' : 'who';
  S.draft = blank();
  S.votes = { a: null, b: null };
  S.result = null;
  S.covered = false;
  S.seat = 'a';
  render();
}

async function refreshToday() {
  const data = await api('/api/eat/today');
  S.round = data.round;
  S.partnerActive = Boolean(data.partnerActive || data.round?.partnerActive);
  S.places = data.places || [];
  S.logs = (data.logs || []).map((log) => ({ ...log, date: String(log.created_at).slice(0, 10) }));
  S.recent = data.recentCuisines || [];
  if (S.round?.result) S.step = 'reveal';
  else if (S.round?.mineSubmitted) S.step = 'wait';
}

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('couple-theme') || 'system') === 'system') { applyTheme(); render(); }
  });
  try {
    const me = await api('/api/me');
    S.authed = true;
    S.me = me.me;
    S.step = 'state';
    await refreshToday();
  } catch {
    S.authed = false;
    const saved = loadGuest();
    S.places = saved.places || [];
    S.logs = saved.logs || [];
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!S.authed || S.tab !== 'pick' || S.round?.result) return;
  pollTimer = setTimeout(async () => {
    try {
      if (['state', 'mode', 'cuisine'].includes(S.step)) await api('/api/eat/presence', { method: 'POST', json: {} });
      const before = `${S.round?.partnerSubmitted}-${S.partnerActive}-${S.round?.status}`;
      await refreshToday();
      const after = `${S.round?.partnerSubmitted}-${S.partnerActive}-${S.round?.status}`;
      if (before !== after) render();
    } catch { /* 轮询失败时保持当前画面 */ }
    schedulePoll();
  }, 4000);
}

boot();
