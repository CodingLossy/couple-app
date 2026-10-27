import {
  api,
  clientInfo,
  countdownLabel,
  dayKey,
  el,
  formatDay,
  formatWhen,
  icon,
  mediaUrl,
  monthLabel,
  setUnauthorized,
  shiftDay,
  toast,
  urlBase64ToUint8Array,
} from './util.js';

const S = {
  booting: true,
  initialized: false,
  me: null,
  moods: [],
  timezones: [],
  maxUploadMb: 12,
  route: 'home',
  ready: null,
};
const app = document.getElementById('app');
const routes = new Set(['home', 'album', 'diary', 'list', 'ask', 'settings', 'guide']);
let generation = 0;
let booting = true;

setUnauthorized(() => {
  if (!S.me) return;
  S.me = null;
  go('login');
});

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

function navButton(route, name, label) {
  return el('button', {
    class: 'nav-btn',
    type: 'button',
    'aria-label': label,
    'aria-current': S.route === route ? 'page' : null,
    onclick: () => go(route),
  }, [icon(name), el('span', { text: label })]);
}

function shell() {
  const titles = { settings: '设置', guide: '开启通知' };
  return el('div', { class: 'shell' }, [
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand', text: titles[S.route] || '两个人' }),
      S.route === 'settings'
        ? el('button', { class: 'text-btn', type: 'button', text: '首页', onclick: () => go('home') })
        : el('button', { class: 'text-btn', type: 'button', text: '设置', onclick: () => go('settings') }),
    ]),
    el('main', { id: 'main', class: 'main' }),
    el('nav', { class: 'nav', 'aria-label': '主要功能' }, [
      navButton('home', 'home', '首页'),
      navButton('album', 'album', '相册'),
      navButton('diary', 'diary', '日记'),
      navButton('list', 'list', '清单'),
      navButton('ask', 'ask', '问答'),
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
          const result = await api('/api/login', {
            method: 'POST',
            json: { username: data.get('username'), password: data.get('password') },
          });
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

async function loadHome(main, ctx) {
  const data = await api('/api/home');
  if (ctx.expired()) return;
  const days = data.daysTogether;
  const hero = el('section', { class: 'hero', 'aria-label': days >= 1 ? `在一起第${days}天` : '在一起' }, [
    el('p', { class: 'kicker', text: data.partnerName ? `和 ${data.partnerName}` : '我们' }),
  ]);
  if (days >= 1) {
    hero.append(
      el('p', { class: 'hero-line', text: '在一起第' }),
      el('p', { class: 'hero-num', text: String(days) }),
      el('p', { class: 'hero-line', text: '天' }),
      el('hr', { class: 'rule' }),
      el('p', { class: 'since', text: data.togetherSince ? `从 ${formatDay(data.togetherSince)} 开始` : '' }),
    );
  } else if (days < 0) {
    hero.append(el('p', { class: 'hero-line', text: `还有 ${Math.abs(days)} 天，到那天就是第 1 天` }));
  } else {
    hero.append(el('p', { class: 'hero-line', text: '还没有记下开始的日期' }));
  }
  const list = el('div');
  if (!data.anniversaries.length) {
    list.append(el('p', { class: 'empty', text: '还没有纪念日。把生日、第一次见面记下来吧。' }));
  }
  for (const item of data.anniversaries) {
    const card = el('article', { class: item.daysUntil === 0 ? 'card today' : 'card' }, [
      el('div', { class: 'split' }, [
        el('div', {}, [
          el('h3', { class: 'card-title', text: item.title }),
          el('p', { class: 'card-meta', text: `${formatDay(item.date)} · ${item.yearly ? '每年' : '只有一次'}` }),
        ]),
        el('strong', { text: countdownLabel(item.daysUntil) }),
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost small', type: 'button', text: '编辑', onclick: () => anniversaryForm(item, () => mount()) }),
        el('button', { class: 'btn ghost small', type: 'button', text: '删除', onclick: async () => {
          if (!await askConfirm('删除纪念日', `确定删除「${item.title}」？`)) return;
          await api(`/api/anniversaries/${item.id}`, { method: 'DELETE' });
          mount();
        } }),
      ]),
    ]);
    list.append(card);
  }
  const banner = S.me.pushDevices === 0 && sessionStorage.getItem('hidePushBanner') !== '1'
    ? el('div', { class: 'banner' }, [
      el('p', { text: '想收到纪念日和对方的新动态？先按引导开启通知。' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small', type: 'button', text: '去开启', onclick: () => go('guide') }),
        el('button', { class: 'text-btn', type: 'button', text: '稍后', onclick: (event) => {
          sessionStorage.setItem('hidePushBanner', '1');
          event.currentTarget.closest('.banner').remove();
        } }),
      ]),
    ])
    : null;
  main.replaceChildren(
    banner,
    hero,
    el('div', { class: 'section-head' }, [
      el('h2', { text: '纪念日' }),
      el('button', { class: 'text-btn', type: 'button', text: '添加', onclick: () => anniversaryForm(null, () => mount()) }),
    ]),
    list,
  );
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
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif' });
  input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    let index = 0;
    for (const file of files) {
      index += 1;
      if (file.size > S.maxUploadMb * 1024 * 1024) {
        toast(`有照片超过 ${S.maxUploadMb}MB，已跳过`);
        continue;
      }
      toast(`正在上传 ${index}/${files.length}`);
      const body = new FormData();
      body.append('file', file);
      try {
        await api('/api/photos', { method: 'POST', body });
      } catch (error) {
        toast(error.message);
      }
    }
    mount();
  });
  const cells = [];
  let month = '';
  let current = null;
  for (const photo of data.photos) {
    const label = monthLabel(photo.createdAt, S.me.timezone);
    if (label !== month) {
      month = label;
      current = el('div', { class: 'grid' });
      cells.push(el('p', { class: 'month', text: label }), current);
    }
    current.append(el('button', { class: 'tile', type: 'button', 'aria-label': photo.caption || '查看照片', onclick: () => openPhoto(photo) }, [
      el('img', { src: mediaUrl(photo.id, 'thumb'), alt: photo.caption || '照片', loading: 'lazy' }),
    ]));
  }
  main.replaceChildren(
    el('div', { class: 'toolbar' }, [
      el('h2', { text: '相册' }),
      el('button', { class: 'btn small', type: 'button', text: '上传', onclick: () => input.click() }),
    ]),
    input,
    ...(data.photos.length ? cells : [el('p', { class: 'empty', text: '把今天拍下来，只给你们两个人看。' })]),
  );
}

function openPhoto(photo) {
  const root = el('div', { class: 'lightbox' }, [
    el('div', { class: 'row' }, [
      el('button', { class: 'text-btn', type: 'button', text: '关闭', onclick: () => root.remove() }),
      photo.mine ? el('button', { class: 'text-btn', type: 'button', text: '删除', onclick: async () => {
        if (!await askConfirm('删除照片', '这张照片会从相册里消失。')) return;
        await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
        root.remove();
        mount();
      } }) : null,
    ]),
    el('img', { src: mediaUrl(photo.id, 'full'), alt: photo.caption || '照片' }),
    el('p', { text: `${photo.authorName} · ${formatWhen(photo.createdAt, S.me.timezone)}` }),
    photo.caption ? el('p', { text: photo.caption }) : null,
  ]);
  document.body.append(root);
}

async function loadDiary(main, ctx) {
  const data = await api('/api/diary?limit=40');
  if (ctx.expired()) return;
  const blocks = [el('div', { class: 'toolbar' }, [
    el('h2', { text: '日记' }),
    el('button', { class: 'btn small', type: 'button', text: '写一篇', onclick: () => diaryForm(null, () => mount()) }),
  ])];
  if (!data.entries.length) blocks.push(el('p', { class: 'empty', text: '写给自己，或者写给你们两个。' }));
  let last = '';
  for (const entry of data.entries) {
    const key = dayKey(entry.createdAt, data.timezone);
    const heading = key === data.today ? '今天' : key === shiftDay(data.today, -1) ? '昨天' : formatDay(key);
    if (heading !== last) {
      last = heading;
      blocks.push(el('p', { class: 'group-label', text: heading }));
    }
    blocks.push(diaryCard(entry, data.timezone));
  }
  main.replaceChildren(...blocks);
}

function diaryCard(entry, timeZone) {
  return el('article', { class: 'entry' }, [
    el('div', { class: 'split' }, [
      el('strong', { text: entry.authorName }),
      el('span', { class: entry.visibility === 'private' ? 'badge lock' : 'badge', text: entry.visibility === 'private' ? '仅自己可见' : '双方可见' }),
    ]),
    el('p', { class: 'card-meta', text: `${entry.moodEmoji ? `${entry.moodEmoji} ${entry.moodLabel} · ` : ''}${formatWhen(entry.createdAt, timeZone)}` }),
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
      text: `${item.emoji} ${item.label}`,
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
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif' });
  input.hidden = true;
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
    el('textarea', { class: 'textarea', name: 'content', required: true, maxlength: '5000', placeholder: '今天想记下什么', value: entry?.content || '' }),
    moodBox,
    vis,
    input,
    el('button', { class: 'btn ghost', type: 'button', text: '添加照片', onclick: () => input.click() }),
    fileName,
    el('button', { class: 'btn full', type: 'submit', text: '保存' }),
  ]));
}

async function loadList(main, ctx) {
  const data = await api('/api/checklist');
  if (ctx.expired()) return;
  const done = data.items.filter((item) => item.completedAt).length;
  const blocks = [
    el('div', { class: 'toolbar' }, [el('h2', { text: '恋爱清单' })]),
    el('p', { class: 'muted', text: `完成了 ${done} / ${data.items.length}` }),
    el('div', { class: 'progress' }, [el('span', { style: `width:${data.items.length ? (done / data.items.length) * 100 : 0}%` })]),
  ];
  for (const item of data.items) blocks.push(checklistCard(item));
  const form = el('form', {
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
  ]);
  blocks.push(form);
  main.replaceChildren(...blocks);
}

function checklistCard(item) {
  return el('article', { class: item.completedAt ? 'check done' : 'check' }, [
    el('button', {
      class: 'box',
      type: 'button',
      'aria-label': item.completedAt ? '取消完成' : '标记完成',
      text: item.completedAt ? '✓' : '',
      onclick: () => (item.completedAt ? uncompleteItem(item) : completeItem(item)),
    }),
    el('div', { class: 'stack' }, [
      el('h3', { text: item.title }),
      item.completedAt ? el('p', { class: 'card-meta', text: `${item.completedByName} 完成${item.note ? ` · ${item.note}` : ''}` }) : null,
      item.photoId ? el('img', { class: 'thumb', src: mediaUrl(item.photoId, 'thumb'), alt: '完成时的照片', loading: 'lazy' }) : null,
      el('button', { class: 'text-btn', type: 'button', text: '删除', onclick: async () => {
        if (!await askConfirm('删除这一项', `确定删除「${item.title}」？`)) return;
        await api(`/api/checklist/${item.id}`, { method: 'DELETE' });
        mount();
      } }),
    ]),
  ]);
}

function completeItem(item) {
  let file = null;
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif' });
  input.hidden = true;
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
  const blocks = [
    el('p', { class: 'kicker', text: formatDay(daily.date) }),
    el('section', { class: 'qa' }, [
      el('p', { class: 'question', text: daily.question }),
      daily.myAnswer ? el('div', { class: 'answer' }, [el('strong', { text: '我' }), el('p', { text: daily.myAnswer })]) : null,
      daily.revealed ? el('div', { class: 'answer' }, [el('strong', { text: daily.partnerName || '对方' }), el('p', { text: daily.partnerAnswer })]) : null,
      !daily.revealed && daily.partnerAnswered ? el('p', { class: 'muted', text: daily.myAnswer ? '对方也回答了，刷新后就能一起看。' : '对方已经回答。你也写下后，才能看到彼此的答案。' }) : null,
      !daily.myAnswer || !daily.locked ? answerForm(daily) : null,
    ]),
    el('h2', { text: '以前的问题' }),
  ];
  if (!history.items.length) blocks.push(el('p', { class: 'empty', text: '过去的问答会出现在这里。' }));
  for (const item of history.items) {
    blocks.push(el('article', { class: 'card' }, [
      el('p', { class: 'card-meta', text: formatDay(item.date) }),
      el('p', { text: item.question }),
      item.myAnswer ? el('p', { class: 'card-meta', text: `我：${item.myAnswer}` }) : el('p', { class: 'card-meta', text: '这一天没有两个人都回答' }),
      item.revealed ? el('p', { class: 'card-meta', text: `${item.partnerName || '对方'}：${item.partnerAnswer}` }) : null,
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
    el('textarea', { class: 'textarea', name: 'answer', required: true, maxlength: '2000', placeholder: daily.myAnswer ? '揭晓前还可以改' : '写下你的回答', value: daily.myAnswer || '' }),
    el('button', { class: 'btn full', type: 'submit', text: daily.myAnswer ? '更新回答' : '提交回答' }),
  ]);
}

async function loadSettings(main, ctx) {
  const data = await api('/api/me');
  if (ctx.expired()) return;
  S.me = data.me;
  const me = data.me;
  main.replaceChildren(el('div', { class: 'stack' }, [
    el('form', {
      class: 'card stack',
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
          toast('已保存');
        } catch (error) {
          toast(error.message);
        }
      },
    }, [
      el('h3', { text: '我们' }),
      field('我的称呼', el('input', { class: 'input', name: 'displayName', required: true, maxlength: '20', value: me.displayName })),
      field('在一起的日期', el('input', { class: 'input', name: 'togetherSince', type: 'date', required: true, value: me.togetherSince || '' })),
      field('时区', el('select', { class: 'select', name: 'timezone' }, S.timezones.map((zone) => (
        el('option', { value: zone.id, text: zone.label, selected: zone.id === me.timezone })
      )))),
      field('提醒时间', el('select', { class: 'select', name: 'reminderHour' }, Array.from({ length: 18 }, (_, index) => index + 6).map((hour) => (
        el('option', { value: String(hour), text: `${hour} 点`, selected: hour === me.reminderHour })
      )))),
      el('p', { class: 'muted', text: me.partner ? `对方是 ${me.partner.displayName}` : '' }),
      el('button', { class: 'btn full', type: 'submit', text: '保存' }),
    ]),
    el('form', {
      class: 'card stack',
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
          event.currentTarget.reset();
          toast('密码已更新，其他设备需要重新登录');
        } catch (error) {
          toast(error.message);
        }
      },
    }, [
      el('h3', { text: '密码' }),
      field('当前密码', el('input', { class: 'input', name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
      field('新密码', el('input', { class: 'input', name: 'next', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      field('再输入一次', el('input', { class: 'input', name: 'next2', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      el('button', { class: 'btn full', type: 'submit', text: '修改密码' }),
    ]),
    el('section', { class: 'card stack' }, [
      el('h3', { text: '通知' }),
      el('p', { class: 'muted', text: me.pushDevices ? `已有 ${me.pushDevices} 台设备开启` : '还没有开启通知' }),
      el('button', { class: 'btn full', type: 'button', text: '查看引导并开启', onclick: () => go('guide') }),
    ]),
    el('section', { class: 'card stack' }, [
      el('h3', { text: '数据' }),
      el('p', { class: 'muted', text: '导出包含双方可见的内容、你自己的私密日记，以及你能看到的照片。' }),
      el('button', { class: 'btn ghost full', type: 'button', text: '打包下载', onclick: exportData }),
      el('button', { class: 'btn danger full', type: 'button', text: '清空内容', onclick: () => danger('清空内容', '/api/danger/wipe', '日记、照片、清单记录和问答会被清空，两个账号还在。') }),
      el('button', { class: 'btn danger full', type: 'button', text: '删除全部并重新开始', onclick: () => danger('删除全部', '/api/danger/reset', '账号和全部内容都会删除，网站回到第一次打开的样子。网页里无法撤销，只能靠服务器上的备份恢复。', true) }),
    ]),
    el('button', { class: 'btn ghost full', type: 'button', text: '退出登录', onclick: async () => {
      await api('/api/logout', { method: 'POST' });
      S.me = null;
      go('login');
    } }),
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
    field(`输入「${phrase}」`, el('input', { class: 'input', name: 'confirm', autocomplete: 'off', required: true })),
    el('button', { class: 'btn danger full', type: 'submit', text: phrase }),
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
  settings: loadSettings,
  guide: async (main) => loadGuide(main),
  missing: async (main) => main.replaceChildren(el('p', { class: 'empty', text: '没有这一页' }), el('button', { class: 'btn', type: 'button', text: '回首页', onclick: () => go('home') })),
};

async function mount() {
  const gen = ++generation;
  const ctx = { expired: () => gen !== generation };
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
