'use strict';

/* =====================================================================
   storage and migration
   ===================================================================== */
const KEY = 'study.v1';
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/* older saves used emoji as subject icons; map them to the drawn glyphs once */
const EMOJI_ICON = {
  '\u{1F4D0}': 'calc', '\u{1F524}': 'type', '\u{1F4D6}': 'book', '\u{1F52C}': 'flask', '\u{1F30D}': 'globe',
  '\u{1F4DC}': 'hourglass', '\u{1F4D8}': 'book', '\u{1F4D5}': 'book', '\u{1F4D7}': 'book', '\u{1F4D9}': 'book',
  '\u{1F9EE}': 'calc', '\u{1F9EA}': 'flask', '\u{1F4BB}': 'code', '\u{1F3B5}': 'music', '\u{1F3A8}': 'palette',
  '✏': 'pencil', '\u{1F9E0}': 'bulb', '⚽': 'ball'
};

const freshDb = () => ({ subjects: [], shuffle: true, hiddenLib: { exams: {} }, sync: { rev: '', at: 0, count: 0 } });
function migrate(d) {
  const out = Object.assign(freshDb(), d);
  if (!out.hiddenLib || !out.hiddenLib.exams) out.hiddenLib = { exams: {} };
  for (const s of out.subjects) {
    if (!s.icon) s.icon = EMOJI_ICON[String(s.emoji || '').replace(/️/g, '')] || 'book';
    delete s.emoji;
    s.exams = Array.isArray(s.exams) ? s.exams : [];
    for (const e of s.exams) {
      e.questions = Array.isArray(e.questions) ? e.questions : [];
      e.attempts = Array.isArray(e.attempts) ? e.attempts : [];
    }
  }
  return out;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.subjects)) return migrate(d);
  } catch { /* fall through to empty */ }
  return freshDb();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { toast('저장하지 못했어요. 브라우저 저장소를 확인해 주세요.'); }
}

/* =====================================================================
   dom helpers (user text only ever goes in as text nodes)
   ===================================================================== */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
function icon(name, cls) {
  const s = h('span', { class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
  s.innerHTML = iconSvg(name);   // static markup from icons.js, never user text
  return s;
}
const $nav = document.getElementById('nav');
const $view = document.getElementById('view');
const $tb = document.getElementById('tb');
const $dock = document.getElementById('dock');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2400);
}
function fnv(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); }
  return (x >>> 0).toString(16).padStart(8, '0');
}
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return Math.round(s / 60) + '분 전';
  if (s < 86400) return Math.round(s / 3600) + '시간 전';
  return Math.round(s / 86400) + '일 전';
}

/* =====================================================================
   model
   ===================================================================== */
/* hue key -> [light end, dark end]. Dark ends keep white glyphs at 3:1 or better. */
const PALETTE = {
  215: ['#4C9DFF', '#1F5FD6'], 150: ['#43C77B', '#17884A'], 35: ['#FFA24A', '#E2631B'],
  340: ['#FF6FA0', '#D7336F'], 270: ['#9C7BFF', '#6A3FD4'], 180: ['#3CCFD0', '#0E8D9B']
};
const HUES = [215, 150, 35, 340, 270, 180];
const pal = hue => PALETTE[hue] || PALETTE[215];
const palStyle = hue => `--ca:${pal(hue)[0]};--cb:${pal(hue)[1]}`;
const sicon = s => (SUBJECT_ICONS.includes(s.icon) ? s.icon : 'book');
const PRESETS = [['국어', 'book', 340], ['영어', 'type', 215], ['수학', 'calc', 270], ['과학', 'flask', 150], ['사회', 'globe', 35], ['역사', 'hourglass', 180]];

const findSubject = id => db.subjects.find(s => s.id === id);
function findExam(id) {
  for (const s of db.subjects) {
    const e = s.exams.find(x => x.id === id);
    if (e) return { s, e };
  }
  return null;
}
const lastScore = e => {
  const a = e.attempts[e.attempts.length - 1];
  return a ? Math.round((a.score / a.total) * 100) : null;
};
const wrongCount = e => e.questions.filter(q => q.last === false).length;
const subjQ = s => s.exams.reduce((n, e) => n + e.questions.length, 0);
function subjAcc(s) {
  const sc = s.exams.map(lastScore).filter(x => x !== null);
  return sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
}
function allWrong() {
  const out = [];
  for (const s of db.subjects) for (const e of s.exams) for (const q of e.questions) if (q.last === false) out.push({ s, e, q });
  return out;
}
function allAttempts() {
  const out = [];
  for (const s of db.subjects) for (const e of s.exams) for (const a of e.attempts) out.push({ s, e, a });
  return out.sort((x, y) => y.a.at - x.a.at);
}
const libCount = () => db.subjects.reduce((n, s) => n + s.exams.reduce((m, e) => m + e.questions.filter(q => q.lib).length, 0), 0);

/* deleting something that came from the CLI hides it on this device, so a sync doesn't bring it back */
function removeExam(s, e) {
  if (e.lib) db.hiddenLib.exams[e.id] = 1;
  s.exams = s.exams.filter(x => x !== e);
  save();
}
function removeSubject(s) {
  s.exams.forEach(e => { if (e.lib) db.hiddenLib.exams[e.id] = 1; });
  db.subjects = db.subjects.filter(x => x !== s);
  save();
}

/* =====================================================================
   Claude CLI connection: data/library.json is written by tools/quiz.mjs
   and pulled in here whenever the app opens or resumes
   ===================================================================== */
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const normName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '');

function cleanLibrary(raw) {
  const out = [];
  const subs = raw && Array.isArray(raw.subjects) ? raw.subjects : [];
  for (const s of subs) {
    if (!s || !ID_RE.test(s.id) || !clip(s.name, 24)) continue;
    const exams = [];
    for (const e of Array.isArray(s.exams) ? s.exams : []) {
      if (!e || !ID_RE.test(e.id) || !clip(e.name, 40)) continue;
      const qs = [], seen = new Set();
      for (const q of Array.isArray(e.questions) ? e.questions : []) {
        if (!q || !ID_RE.test(q.id) || seen.has(q.id)) continue;
        if ((q.type || 'ox') !== 'ox') continue;          // the app plays OX for now
        const text = clip(q.q, 400);
        if (!text || typeof q.a !== 'boolean') continue;
        seen.add(q.id);
        qs.push({ id: q.id, q: text, a: q.a, exp: clip(q.exp, 300) });
      }
      exams.push({ id: e.id, name: clip(e.name, 40), questions: qs });
    }
    out.push({ id: s.id, name: clip(s.name, 24), icon: SUBJECT_ICONS.includes(s.icon) ? s.icon : 'book', hue: HUES.includes(s.color) ? s.color : 215, exams });
  }
  return out;
}

function mergeLibrary(lib) {
  let added = 0, changed = false;
  const liveExamIds = new Set();
  for (const ls of lib) {
    const visible = ls.exams.filter(e => !db.hiddenLib.exams[e.id]);
    if (!visible.length) continue;
    let subj = db.subjects.find(s => s.id === ls.id) || db.subjects.find(s => normName(s.name) === normName(ls.name));
    if (!subj) {
      subj = { id: ls.id, name: ls.name, icon: ls.icon, hue: ls.hue, exams: [], lib: true };
      db.subjects.push(subj);
      changed = true;
    }
    for (const le of visible) {
      liveExamIds.add(le.id);
      let exam = subj.exams.find(e => e.id === le.id);
      if (!exam) {
        exam = { id: le.id, name: le.name, questions: [], attempts: [], lib: true };
        subj.exams.push(exam);
        changed = true;
      } else if (exam.lib && exam.name !== le.name) { exam.name = le.name; changed = true; }
      const ids = new Set(le.questions.map(q => q.id));
      for (const lq of le.questions) {
        const q = exam.questions.find(x => x.id === lq.id);
        if (!q) { exam.questions.push({ id: lq.id, q: lq.q, a: lq.a, exp: lq.exp, lib: true }); added++; changed = true; }
        else if (q.lib && (q.q !== lq.q || q.a !== lq.a || q.exp !== lq.exp)) { Object.assign(q, { q: lq.q, a: lq.a, exp: lq.exp }); changed = true; }
      }
      const before = exam.questions.length;
      exam.questions = exam.questions.filter(q => !q.lib || ids.has(q.id));
      if (exam.questions.length !== before) changed = true;
    }
  }
  /* exams the CLI removed from the library disappear here too */
  for (const s of db.subjects) {
    const keep = s.exams.filter(e => !e.lib || liveExamIds.has(e.id));
    if (keep.length !== s.exams.length) { s.exams = keep; changed = true; }
  }
  const emptyLib = db.subjects.filter(s => s.lib && !s.exams.length);
  if (emptyLib.length) { db.subjects = db.subjects.filter(s => !emptyLib.includes(s)); changed = true; }
  return { added, changed };
}

const sync = { busy: false, ok: null };
async function syncLibrary(manual) {
  if (sync.busy) return;
  sync.busy = true;
  refreshSyncUI();
  try {
    const res = await fetch('data/library.json', { cache: 'no-store' });
    if (res.status === 404) { sync.ok = true; db.sync.at = Date.now(); save(); if (manual) toast('아직 CLI에서 보낸 문제가 없어요'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error('library.json 형식 오류'); }
    const { added, changed } = mergeLibrary(cleanLibrary(raw));
    db.sync = { rev: fnv(text), at: Date.now(), count: libCount() };
    save();
    sync.ok = true;
    if (changed) requestRender();
    if (added) toast(`새 문제 ${added}개가 들어왔어요`);
    else if (manual) toast('이미 최신이에요');
  } catch {
    sync.ok = false;
    if (manual) toast('동기화하지 못했어요. 연결을 확인해 주세요.');
  } finally {
    sync.busy = false;
    refreshSyncUI();
  }
}
const syncText = () =>
  sync.ok === false ? '연결할 수 없어요. 다음에 다시 시도해요'
    : db.sync.at ? `${ago(db.sync.at)} 동기화 · CLI 문제 ${db.sync.count}개` : '아직 동기화하지 않았어요';
function refreshSyncUI() {
  document.querySelectorAll('.js-sync').forEach(b => b.classList.toggle('spin', sync.busy));
  document.querySelectorAll('.js-sync-text').forEach(t => { t.textContent = syncText(); });
}

/* =====================================================================
   Home Screen app: service worker + automatic updates
   ===================================================================== */
let swReg = null, baseFp = null, appVersion = '', pendingReload = false, renderPending = false;

async function fingerprint() {
  const files = ['index.html', 'styles.css', 'icons.js', 'app.js'];
  const texts = await Promise.all(files.map(f => fetch(f, { cache: 'no-store' }).then(r => (r.ok ? r.text() : Promise.reject(new Error(f))))));
  return fnv(texts.join('\u0000'));
}
const busyForReload = () => (play && !play.done) || $sheet.open;
async function checkUpdate(manual) {
  try {
    const fp = await fingerprint();
    if (baseFp === null) { baseFp = fp; appVersion = fp.slice(0, 6); refreshVersionUI(); if (manual) toast('최신 버전이에요'); return; }
    if (fp === baseFp) { if (manual) toast('최신 버전이에요'); return; }
    if (busyForReload()) { pendingReload = true; toast('새 버전이 준비됐어요. 끝나면 적용돼요'); return; }
    reloadForUpdate();
  } catch { if (manual) toast('업데이트를 확인하지 못했어요'); }
}
function reloadForUpdate() {
  try { sessionStorage.setItem('study.updated', '1'); } catch { /* private mode */ }
  location.reload();
}
function refreshVersionUI() { document.querySelectorAll('.js-version').forEach(t => { t.textContent = `버전 ${appVersion || '확인 중'} · 열 때마다 자동 업데이트`; }); }

let lastWake = 0;
function onWake() {
  const now = Date.now();
  if (now - lastWake < 20000) return;
  lastWake = now;
  if (swReg) swReg.update().catch(() => {});
  checkUpdate();
  syncLibrary();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onWake(); });
window.addEventListener('online', onWake);
window.addEventListener('pageshow', e => { if (e.persisted) onWake(); });
setInterval(() => { if (document.visibilityState === 'visible') { checkUpdate(); syncLibrary(); } }, 5 * 60 * 1000);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { swReg = r; }).catch(() => {});
}

/* work that arrives while a sheet or a quiz is open waits until it's over */
function requestRender() {
  if (busyForReload()) { renderPending = true; return; }
  route(true);
}
function flushPending() {
  if (busyForReload()) return;
  if (pendingReload) { pendingReload = false; reloadForUpdate(); return; }
  if (renderPending) { renderPending = false; route(true); }
}

/* =====================================================================
   no pinch zoom, no long-press selection (inputs keep normal editing)
   ===================================================================== */
const editable = el => !!(el && el.closest && el.closest('input, textarea'));
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('selectstart', e => { const el = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (!editable(el)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

/* =====================================================================
   shell: navigation, toolbar, screen
   ===================================================================== */
const TABS = [['home', '과목', 'stack', '#/'], ['wrong', '오답노트', 'bookmark', '#/wrong'], ['history', '기록', 'clock', '#/history'], ['settings', '설정', 'sliders', '#/settings']];
let fabEl = null, sideEl = null;

function logoMark() {
  const s = h('span', { class: 'logo', 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0a0a0c"/><circle cx="172" cy="256" r="84" fill="none" stroke="#fff" stroke-width="40"/><path d="M304 186l120 140M424 186L304 326" fill="none" stroke="#5aaeff" stroke-width="40" stroke-linecap="round"/></svg>';
  return s;
}
function buildNav() {
  fabEl = h('button', { class: 'glass fab', type: 'button' });
  sideEl = h('div', { class: 'side' });
  $nav.replaceChildren(
    h('div', { class: 'brand' }, logoMark(), h('span', { text: '공부방' })),
    h('div', { class: 'glass tabbar', role: 'group', 'aria-label': '탭' },
      TABS.map(([k, label, ic, href]) => h('a', { class: 'tab', 'data-tab': k, href }, icon(ic), h('span', { class: 'tab-label', text: label })))),
    fabEl, sideEl);
}
function updateNav(o) {
  document.body.classList.toggle('detail', !!o.detail);
  for (const a of $nav.querySelectorAll('.tab')) {
    if (a.dataset.tab === o.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (o.fab) {
    fabEl.hidden = false;
    fabEl.replaceChildren(icon(o.fab.icon), h('span', { class: 'fab-label', text: o.fab.label }));
    fabEl.setAttribute('aria-label', o.fab.label);
    fabEl.onclick = o.fab.onClick;
  } else fabEl.hidden = true;
  sideEl.replaceChildren(
    h('div', { class: 'side-title', text: '과목' }),
    ...db.subjects.map(s => h('a', { class: 'side-row', href: '#/s/' + s.id, 'aria-current': s.id === o.subjectId ? 'true' : null, style: palStyle(s.hue) },
      av(s.hue, sicon(s)), h('span', { class: 'nm', text: s.name }), h('small', { text: String(subjQ(s)) }))));
}

function toolbar(o) {
  const lead = o.back ? h('a', { class: 'glass tb-round', href: o.back, 'aria-label': '뒤로' }, icon('back'))
    : o.close ? h('a', { class: 'glass tb-round', href: o.close, 'aria-label': '닫기' }, icon('close'))
    : h('span');
  const trail = o.trail && o.trail.length
    ? h('div', { class: 'glass ' + (o.trail.length > 1 ? 'tb-group' : 'tb-round') },
      o.trail.map(t => h('button', { class: 'tb-btn ' + (t.cls || ''), type: 'button', 'aria-label': t.label, onclick: ev => t.onClick(ev.currentTarget) }, icon(t.icon))))
    : h('span');
  $tb.replaceChildren(lead, h('div', { class: 'tb-title' }, h('span', { text: o.inline || o.title })), trail);
}

let largeTitle = true;
function onScroll() {
  const y = window.scrollY;
  document.body.classList.toggle('scrolled', y > 2);
  document.body.classList.toggle('title-in', !largeTitle || y > 36);
}
let ticking = false;
window.addEventListener('scroll', () => {
  if (routeKey) scrollMem[routeKey] = window.scrollY;
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });

/* o: { title, head, body, back, close, trail, dock, inline, hue, tab, detail, fab, subjectId, plain } */
function screen(o) {
  const [a, b] = pal(o.hue);
  document.body.style.setProperty('--ca', a);
  document.body.style.setProperty('--cb', b);
  largeTitle = !o.plain;
  toolbar(o);
  updateNav(o);
  $view.replaceChildren(...[].concat(o.head || [], o.body || []).filter(Boolean));
  const dock = (o.dock || []).filter(Boolean);
  $dock.replaceChildren(...dock);
  document.body.classList.toggle('has-dock', dock.length > 0);
  document.title = o.title === '공부방' ? '공부방' : `${o.inline || o.title} · 공부방`;
  refreshSyncUI();
  refreshVersionUI();
  onScroll();
}

/* =====================================================================
   components
   ===================================================================== */
const av = (hue, name, cls) => h('span', { class: 'av ' + (cls || ''), style: palStyle(hue), 'aria-hidden': 'true' }, icon(name));
const oxAv = (q, size) => h('span', { class: 'av ' + (q.a ? 'o' : 'x'), style: size ? `--av:${size}px` : null, 'aria-label': q.a ? '정답 O' : '정답 X', text: q.a ? 'O' : 'X' });
const st = (ic, text) => h('span', { class: 'st' }, icon(ic), text);
const dim = name => icon(name, 'chev');
const code = t => h('code', { text: t });

function pageHead({ title, lines, avatar }) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'ph-text' }, h('h1', { text: title }), ...(lines || []).filter(Boolean).map(l => h('p', { class: 'sub' }, l))),
    avatar ? h('div', { class: 'ph-av' }, avatar) : null);
}

/* a Threads post: avatar column, title, meta; replies hang off it by a line */
function post(o) {
  const title = h('span', { class: 'post-title' + (o.clamp ? ' clamp2' : ''), text: o.title });
  const stretch = o.href ? h('a', { class: 'stretch', href: o.href }, title) : h('button', { type: 'button', class: 'stretch', onclick: o.onClick }, title);
  const head = h('div', { class: 'post-head' }, stretch,
    o.more ? h('button', { type: 'button', class: 'more', 'aria-label': o.moreLabel || '더 보기', onclick: ev => o.more(ev.currentTarget) }, icon('more')) : null);
  const meta = (o.meta || []).filter(Boolean);
  return h('div', { class: ['post', o.sm ? 'sm' : '', o.muted ? 'muted' : ''].filter(Boolean).join(' '), style: o.style },
    h('div', { class: 'post-av' }, o.avatar),
    h('div', { class: 'post-body' }, head, meta.length ? h('div', { class: 'post-meta' }, meta) : null));
}
function thread(rows) {
  rows.forEach((r, i) => { if (i > 0) r.classList.add('prev'); if (i < rows.length - 1) r.classList.add('next'); });
  return h('section', { class: 'thread' }, rows);
}
function emptyState(ic, title, text, extra) {
  return h('section', { class: 'empty' }, h('div', { class: 'empty-ico' }, icon(ic)), h('h2', { text: title }), text ? h('p', { text }) : null, extra || null);
}
function ring(pct, big, label) {
  const size = big ? 156 : 40, r = big ? 66 : 17, w = big ? 14 : 5, c = 2 * Math.PI * r;
  const box = h('div', { class: big ? 'ring' : 'mini-ring', role: 'img', 'aria-label': label });
  box.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill2)" stroke-width="${w}"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--text)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}"/></svg>`;
  box.append(h('b', { 'aria-hidden': 'true', text: big ? pct + '%' : String(pct) }));
  return box;
}

/* popover menu: macOS context menu as glass, anchored to its button */
let menuEl = null, scrimEl = null;
function closeMenu() {
  if (menuEl) { menuEl.remove(); scrimEl.remove(); menuEl = scrimEl = null; }
}
function openMenu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'glass menu', role: 'menu' },
    items.map(it => (it === '-' ? h('hr') : h('button', {
      type: 'button', role: 'menuitem', class: 'mitem' + (it.danger ? ' danger' : ''),
      onclick: () => { closeMenu(); it.onClick(); }
    }, icon(it.icon), h('span', { class: 'grow', text: it.label }), it.check ? icon('check') : null))));
  scrimEl = h('div', { class: 'menu-scrim', onclick: closeMenu });
  document.body.append(scrimEl, m);
  menuEl = m;
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, hh = m.offsetHeight;
  const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
  let top = r.bottom + 8;
  const flip = top + hh > innerHeight - 12;
  if (flip) top = Math.max(12, r.top - hh - 8);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  m.style.transformOrigin = `${r.right - left}px ${flip ? hh : 0}px`;
}

/* ---------- sheets ---------- */
function closeSheet() { if ($sheet.open) $sheet.close(); }
$sheet.addEventListener('click', e => { if (e.target === $sheet) closeSheet(); });
$sheet.addEventListener('close', () => flushPending());

function openSheet({ title, body, submit = '저장', danger = false, cancel = '취소', onSubmit }) {
  closeMenu();
  const form = h('form', { class: 'sheet-form', method: 'dialog' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn sm', onclick: closeSheet, text: cancel }),
      h('h2', { id: 'sheet-title', text: title }),
      submit ? h('button', { type: 'submit', class: 'btn sm ' + (danger ? 'danger' : 'prim'), text: submit }) : h('span')),
    h('div', { class: 'sheet-body' }, body));
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!onSubmit || onSubmit(form) !== false) closeSheet();
  });
  $sheet.replaceChildren(form);
  $sheet.setAttribute('aria-labelledby', 'sheet-title');
  if (!$sheet.open) $sheet.showModal();
  const first = form.querySelector('input[type=text], textarea');
  if (first) first.focus();
}
function confirmSheet(title, message, label, onYes) {
  openSheet({ title, body: h('p', { class: 'hint', text: message }), submit: label, danger: true, onSubmit: () => { onYes(); } });
}
const group = (label, content) => h('div', null, label ? h('div', { class: 'glabel', text: label }) : null, h('div', { class: 'sg' }, content));
function picker(items, initial, cls, onChange) {
  let cur = initial;
  const el = h('div', { class: cls, role: 'group' });
  const paint = () => [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === cur)));
  items.forEach(it => el.append(h('button', { type: 'button', 'aria-label': it.aria, style: it.style, onclick: () => { cur = it.value; paint(); if (onChange) onChange(cur); } }, it.label)));
  paint();
  return { el, get: () => cur };
}

function subjectSheet(subject) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = h('input', { class: 'field', type: 'text', maxlength: 20, 'aria-label': '과목 이름', value: subject ? subject.name : '', placeholder: '예: 수학' });
  let curIcon = subject ? sicon(subject) : SUBJECT_ICONS[0], curHue = subject ? subject.hue : HUES[0];
  const preview = h('div', { class: 'preview' });
  const paintPreview = () => preview.replaceChildren(av(curHue, curIcon));
  paintPreview();
  const iconPick = picker(SUBJECT_ICONS.map(k => ({ value: k, label: icon(k), aria: k })), curIcon, 'picker', v => { curIcon = v; paintPreview(); });
  const huePick = picker(HUES.map((v, i) => ({ value: v, label: icon('check'), aria: `색상 ${i + 1}`, style: `--s1:${pal(v)[0]};--s2:${pal(v)[1]}` })), curHue, 'swatches', v => { curHue = v; paintPreview(); });
  openSheet({
    title: subject ? '과목 편집' : '새 과목',
    body: [
      preview,
      group('이름', name),
      group('아이콘', iconPick.el),
      group('색상', huePick.el),
      err,
      subject ? h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => confirmSheet('과목 삭제', `"${subject.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => { removeSubject(subject); location.hash = '#/'; route(true); })
      }, icon('trash'), '과목 삭제')) : null
    ],
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { err.textContent = '과목 이름을 입력해 주세요.'; name.focus(); return false; }
      if (subject) Object.assign(subject, { name: n, icon: iconPick.get(), hue: huePick.get() });
      else db.subjects.push({ id: uid(), name: n, icon: iconPick.get(), hue: huePick.get(), exams: [] });
      save(); route(true);
    }
  });
}

function examSheet(subject, exam) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = h('input', { class: 'field', type: 'text', maxlength: 30, 'aria-label': '시험·단원 이름', value: exam ? exam.name : '', placeholder: '예: 중간고사, 3단원' });
  openSheet({
    title: exam ? '시험 편집' : '새 시험·단원',
    body: [
      group('이름', name),
      err,
      exam ? h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => confirmSheet('시험 삭제', `"${exam.name}"과 문제 ${exam.questions.length}개가 지워져요.`, '삭제', () => { removeExam(subject, exam); location.hash = '#/s/' + subject.id; route(true); })
      }, icon('trash'), '시험 삭제')) : null
    ],
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { err.textContent = '이름을 입력해 주세요.'; name.focus(); return false; }
      if (exam) exam.name = n;
      else subject.exams.push({ id: uid(), name: n, questions: [], attempts: [] });
      save(); route(true);
    }
  });
}

function questionSheet(exam, q) {
  if (q && q.lib) return questionView(q);
  const text = h('textarea', { class: 'field', rows: 4, maxlength: 400, 'aria-label': '문장', placeholder: '예: 광합성은 엽록체에서 일어난다.', text: q ? q.q : '' });
  const ans = picker([{ value: true, label: 'O  맞다', aria: 'O 맞다' }, { value: false, label: 'X  틀리다', aria: 'X 틀리다' }], q ? q.a : true, 'seg sheet-seg');
  const exp = h('textarea', { class: 'field', rows: 2, maxlength: 300, 'aria-label': '해설', placeholder: '틀렸을 때 보여줄 설명 (선택)', text: q ? q.exp : '' });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({
    title: q ? '문제 편집' : '새 OX 문제',
    body: [
      group('문장', text),
      h('div', null, h('div', { class: 'glabel', text: '정답' }), h('div', { class: 'sg' }, ans.el)),
      group('해설', exp),
      err,
      q ? h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => { exam.questions = exam.questions.filter(x => x !== q); save(); closeSheet(); route(true); }
      }, icon('trash'), '문제 삭제')) : null
    ],
    onSubmit: () => {
      const t = text.value.trim();
      if (!t) { err.textContent = '문장을 입력해 주세요.'; text.focus(); return false; }
      if (q) Object.assign(q, { q: t, a: ans.get(), exp: exp.value.trim() });
      else exam.questions.push({ id: uid(), q: t, a: ans.get(), exp: exp.value.trim() });
      save(); route(true);
    }
  });
}
/* questions that came from the CLI are read-only here; the CLI is where they're edited */
function questionView(q) {
  openSheet({
    title: '문제', submit: null, cancel: '닫기',
    body: [
      h('div', { class: 'sg qview' },
        h('p', { class: 'q', text: q.q }),
        h('div', { class: 'a' }, oxAv(q, 28), h('span', { text: q.a ? '맞는 문장이에요' : '틀린 문장이에요' })),
        q.exp ? h('p', { text: q.exp }) : null),
      h('p', { class: 'hint', text: 'CLI에서 가져온 문제예요. 고치려면 터미널에서 수정해 주세요.' })
    ]
  });
}

/* =====================================================================
   menus
   ===================================================================== */
const subjectMenu = s => [
  { icon: 'plus', label: '시험·단원 추가', onClick: () => examSheet(s) },
  { icon: 'pencil', label: '과목 편집', onClick: () => subjectSheet(s) },
  '-',
  { icon: 'trash', label: '과목 삭제', danger: true, onClick: () => confirmSheet('과목 삭제', `"${s.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => { removeSubject(s); route(true); }) }
];
const examMenu = (s, e) => [
  { icon: 'plus', label: 'OX 문제 추가', onClick: () => questionSheet(e) },
  { icon: 'shuffle', label: '문제 섞기', check: db.shuffle !== false, onClick: () => { db.shuffle = db.shuffle === false; save(); toast(db.shuffle ? '문제를 섞어서 풀어요' : '순서대로 풀어요'); } },
  { icon: 'pencil', label: '시험 편집', onClick: () => examSheet(s, e) },
  '-',
  { icon: 'trash', label: '시험 삭제', danger: true, onClick: () => confirmSheet('시험 삭제', `"${e.name}"과 문제 ${e.questions.length}개가 지워져요.`, '삭제', () => { removeExam(s, e); location.hash = '#/s/' + s.id; route(true); }) }
];

/* =====================================================================
   tab screens
   ===================================================================== */
function examReply(s, e) {
  const sc = lastScore(e), wr = wrongCount(e);
  return post({
    sm: true, avatar: av(s.hue, 'doc', 'soft'), title: e.name, href: '#/e/' + e.id, style: palStyle(s.hue),
    meta: [h('span', { text: `OX ${e.questions.length}문제` }), sc !== null ? h('span', { text: `최근 ${sc}%` }) : null, wr ? st('xcircle', `오답 ${wr}`) : null]
  });
}

function subjectThread(s) {
  const acc = subjAcc(s);
  const rows = [post({
    avatar: av(s.hue, sicon(s)), title: s.name, href: '#/s/' + s.id, style: palStyle(s.hue),
    more: btn => openMenu(btn, subjectMenu(s)), moreLabel: `${s.name} 메뉴`,
    meta: [h('span', { text: `시험 ${s.exams.length}개 · 문제 ${subjQ(s)}개` }), acc !== null ? st('checkcircle', `정답률 ${acc}%`) : null]
  })];
  s.exams.slice(0, 2).forEach(e => rows.push(examReply(s, e)));
  if (s.exams.length > 2) rows.push(post({ sm: true, muted: true, avatar: h('span', { class: 'av ghost' }, icon('more')), title: `시험 ${s.exams.length - 2}개 더 보기`, href: '#/s/' + s.id }));
  if (!s.exams.length) rows.push(post({ sm: true, muted: true, avatar: h('span', { class: 'av ghost' }, icon('plus')), title: '첫 시험·단원 만들기', onClick: () => examSheet(s) }));
  return thread(rows);
}

function viewHome() {
  const subs = db.subjects;
  const body = h('div', { class: 'feed' });
  if (!subs.length) {
    body.append(emptyState('stack', '첫 과목을 만들어 보세요', '자주 쓰는 과목은 한 번에 추가할 수 있어요.',
      h('div', { class: 'pills' }, PRESETS.map(([n, ic, hue]) => h('button', {
        type: 'button', class: 'btn outline',
        onclick: () => { db.subjects.push({ id: uid(), name: n, icon: ic, hue, exams: [] }); save(); route(true); }
      }, icon(ic), n)))));
  } else subs.forEach(s => body.append(subjectThread(s)));
  const line = subs.length
    ? [h('span', { text: `과목 ${subs.length}개` }), h('span', { text: `문제 ${subs.reduce((n, s) => n + subjQ(s), 0)}개` })]
    : [h('span', { text: '공부할 과목을 만들어 보세요' })];
  screen({
    title: '과목', hue: 215, tab: 'home', body, head: pageHead({ title: '과목', lines: [line] }),
    trail: [{ icon: 'refresh', label: '동기화', cls: 'js-sync', onClick: () => syncLibrary(true) }],
    fab: { icon: 'plus', label: '과목 추가', onClick: () => subjectSheet() }
  });
}

function viewWrong() {
  const list = allWrong();
  const body = h('div', { class: 'stack' });
  if (!list.length) {
    body.append(emptyState('checkcircle', '오답이 없어요', '문제를 풀다 틀리면 여기에 모여요.'));
  } else {
    body.append(h('section', { class: 'callout' },
      h('div', null, h('b', { text: String(list.length) }), h('span', { text: '복습할 오답' })),
      h('a', { class: 'btn prim', href: '#/p/_/wrong' }, icon('play'), '복습 시작')));
    const feed = h('div', { class: 'feed' });
    for (const s of db.subjects) {
      const mine = list.filter(x => x.s === s);
      if (!mine.length) continue;
      const rows = [post({ avatar: av(s.hue, sicon(s)), title: s.name, href: '#/s/' + s.id, style: palStyle(s.hue), meta: [h('span', { text: `오답 ${mine.length}개` })] })];
      mine.forEach(({ e, q }) => rows.push(post({
        sm: true, clamp: true, avatar: oxAv(q), title: q.q, style: palStyle(s.hue), onClick: () => questionSheet(e, q),
        meta: [h('span', { text: e.name }), q.miss ? h('span', { text: `오답 ${q.miss}회` }) : null]
      })));
      feed.append(thread(rows));
    }
    body.append(feed);
  }
  screen({
    title: '오답노트', hue: 340, tab: 'wrong', body,
    head: pageHead({ title: '오답노트', lines: [[h('span', { text: list.length ? `틀린 문제 ${list.length}개` : '모두 맞혔어요' })]] })
  });
}

function dayLabel(t) {
  const d = new Date(t), today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff === 0 ? '오늘' : diff === 1 ? '어제' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const timeLabel = t => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
function attemptRow({ s, e, a }) {
  const pct = Math.round((a.score / a.total) * 100);
  return h('a', { class: 'row', href: '#/e/' + e.id },
    ring(pct, false, `${pct}%`),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: e.name }), h('span', { class: 'row-sub', text: `${s.name} · ${a.mode === 'wrong' ? '오답만' : '전체'} · ${timeLabel(a.at)}` })),
      h('span', { class: 'score', text: `${a.score}/${a.total}` }), dim('chev')));
}

function viewHistory() {
  const all = allAttempts();
  const body = h('div', { class: 'stack' });
  if (!all.length) {
    body.append(emptyState('clock', '아직 기록이 없어요', '시험을 풀면 점수가 여기에 쌓여요.'));
  } else {
    const avg = Math.round(all.reduce((n, x) => n + (x.a.score / x.a.total) * 100, 0) / all.length);
    body.append(h('div', { class: 'facts' },
      h('div', null, h('b', { text: String(all.length) }), h('span', { text: '풀이 횟수' })),
      h('div', null, h('b', { text: avg + '%' }), h('span', { text: '평균 점수' })),
      h('div', null, h('b', { text: String(allWrong().length) }), h('span', { text: '남은 오답' }))));
    const days = [];
    for (const x of all) {
      const l = dayLabel(x.a.at);
      if (!days.length || days[days.length - 1].l !== l) days.push({ l, items: [] });
      days[days.length - 1].items.push(x);
    }
    for (const d of days) body.append(h('div', null, h('div', { class: 'sec', text: d.l }), h('div', { class: 'rows' }, d.items.map(attemptRow))));
  }
  screen({
    title: '기록', hue: 180, tab: 'history', body,
    head: pageHead({ title: '기록', lines: [[h('span', { text: all.length ? `최근 ${all.length}번 풀었어요` : '아직 푼 시험이 없어요' })]] })
  });
}

function srow({ ic, title, sub, subCls, trailing, danger, onClick }) {
  const inner = [
    h('span', { class: 'tile' }, icon(ic)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: title }), sub != null ? h('span', { class: 'row-sub ' + (subCls || ''), text: sub }) : null),
    trailing || null
  ];
  const cls = 'srow' + (danger ? ' danger' : '');
  return onClick ? h('button', { type: 'button', class: cls, onclick: onClick }, inner) : h('div', { class: cls }, inner);
}

function viewSettings() {
  const sw = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-label': '문제 섞기', 'aria-checked': String(db.shuffle !== false),
    onclick: ev => { db.shuffle = db.shuffle === false; save(); ev.currentTarget.setAttribute('aria-checked', String(db.shuffle)); }
  });
  const body = h('div', { class: 'stack' },
    h('div', null, h('div', { class: 'sec', text: 'Claude CLI 연결' }), h('div', { class: 'group' },
      srow({
        ic: 'terminal', title: '자동 동기화', sub: syncText(), subCls: 'js-sync-text',
        trailing: h('button', { type: 'button', class: 'btn sm outline js-sync', onclick: () => syncLibrary(true) }, icon('refresh'), '지금')
      }),
      h('div', { class: 'note' }, '터미널에서 ', code('/quiz'), ' 로 사진을 넘기면 문제가 ', code('data/library.json'), ' 에 저장되고 push 돼요. 앱은 열릴 때마다 그 파일을 읽어 자동으로 가져와요. 복사나 붙여넣기는 필요 없어요.'))),
    h('div', null, h('div', { class: 'sec', text: '학습' }), h('div', { class: 'group' },
      srow({ ic: 'shuffle', title: '문제 섞기', sub: '풀 때마다 순서를 바꿔요', trailing: sw }))),
    h('div', null, h('div', { class: 'sec', text: '앱' }), h('div', { class: 'group' },
      srow({ ic: 'share', title: '홈 화면에 추가', sub: standalone() ? '홈 화면 앱으로 실행 중이에요' : 'Safari 공유 버튼, 홈 화면에 추가' }),
      srow({
        ic: 'refresh', title: '업데이트', sub: `버전 ${appVersion || '확인 중'} · 열 때마다 자동 업데이트`, subCls: 'js-version',
        trailing: h('button', { type: 'button', class: 'btn sm outline', onclick: () => checkUpdate(true) }, '확인')
      }))),
    h('div', null, h('div', { class: 'sec', text: '데이터' }), h('div', { class: 'group' },
      srow({
        ic: 'retry', title: '학습 기록 지우기', sub: '점수와 오답 표시만 지워요', danger: true,
        onClick: () => confirmSheet('학습 기록 지우기', '푼 기록과 오답 표시가 모두 지워져요. 문제는 그대로 남아요.', '지우기', () => {
          db.subjects.forEach(s => s.exams.forEach(e => { e.attempts = []; e.questions.forEach(q => { delete q.last; delete q.miss; }); }));
          save(); route(true); toast('학습 기록을 지웠어요');
        })
      }),
      srow({
        ic: 'trash', title: '이 기기의 모든 데이터 삭제', sub: '과목, 문제, 기록이 모두 지워져요', danger: true,
        onClick: () => confirmSheet('모든 데이터 삭제', '이 기기에 저장된 과목, 문제, 기록이 모두 지워져요. CLI로 보낸 문제는 다음 동기화 때 다시 들어와요.', '삭제', () => {
          db = freshDb(); save(); location.hash = '#/'; route(true); syncLibrary();
        })
      }))));
  screen({
    title: '설정', hue: 215, tab: 'settings', body,
    head: pageHead({ title: '설정', lines: [[h('span', { text: standalone() ? '홈 화면 앱' : '브라우저' })]] })
  });
}

/* =====================================================================
   subject / exam
   ===================================================================== */
function viewSubject(s) {
  const acc = subjAcc(s);
  const body = h('div', null);
  if (!s.exams.length) {
    body.append(emptyState('doc', '시험·단원을 만들어요', '예: 중간고사, 기말고사, 3단원. 안에 문제를 모아 시험처럼 풀 수 있어요.'));
  } else {
    body.append(h('div', { class: 'rows', style: palStyle(s.hue) }, s.exams.map(e => {
      const sc = lastScore(e), wr = wrongCount(e);
      return h('a', { class: 'row', href: '#/e/' + e.id },
        av(s.hue, 'doc', 'soft'),
        h('span', { class: 'row-body' },
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title', text: e.name }),
            h('span', { class: 'row-sub', text: `OX ${e.questions.length}문제 · ${sc !== null ? `최근 ${sc}%` : '아직 안 풀었어요'}` })),
          e.lib ? h('span', { class: 'badge plain' }, icon('terminal'), 'CLI') : null,
          wr ? h('span', { class: 'badge' }, icon('xcircle'), String(wr)) : null, dim('chev')));
    })));
  }
  screen({
    title: s.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/', body,
    head: pageHead({
      title: s.name, avatar: av(s.hue, sicon(s)),
      lines: [[h('span', { text: `시험 ${s.exams.length}개` }), h('span', { text: `문제 ${subjQ(s)}개` }), acc !== null ? st('checkcircle', `정답률 ${acc}%`) : null]]
    }),
    trail: [{ icon: 'more', label: '과목 메뉴', onClick: btn => openMenu(btn, subjectMenu(s)) }],
    dock: [h('button', { type: 'button', class: 'pbtn', onclick: () => examSheet(s) }, icon('plus'), '시험·단원 추가')],
    fab: { icon: 'plus', label: '시험·단원 추가', onClick: () => examSheet(s) }
  });
}

const ui = { examTab: 'q', examFor: null };
function viewExam({ s, e }) {
  if (ui.examFor !== e.id) { ui.examFor = e.id; ui.examTab = 'q'; }
  const n = e.questions.length, wr = wrongCount(e), sc = lastScore(e);
  const facts = h('div', { class: 'facts' },
    h('div', null, h('b', { text: String(n) }), h('span', { text: '문제' })),
    h('div', null, h('b', { text: sc === null ? '-' : sc + '%' }), h('span', { text: '최근 점수' })),
    h('div', null, h('b', { text: String(wr) }), h('span', { text: '오답' })));
  const body = h('div', null);
  body.append(h('div', { class: 'utabs', role: 'tablist' },
    ['q', 'h'].map(k => h('button', {
      type: 'button', class: 'utab', role: 'tab', 'aria-selected': String(ui.examTab === k),
      onclick: () => { if (ui.examTab !== k) { ui.examTab = k; route(true); } }
    }, k === 'q' ? `문제 ${n}` : `기록 ${e.attempts.length}`))));
  if (ui.examTab === 'q') {
    body.append(h('button', { type: 'button', class: 'composer', style: palStyle(s.hue), onclick: () => questionSheet(e) },
      av(s.hue, 'plus', 'soft'), h('span', { class: 'ph', text: '새 OX 문제 추가…' }), h('span', { class: 'go', text: '추가' })));
    if (!n) body.append(emptyState('doc', '문제가 아직 없어요', '위에서 직접 추가하거나, 터미널에서 /quiz 로 사진을 넘겨 보세요.'));
    else body.append(h('div', { class: 'rows', style: palStyle(s.hue) }, e.questions.map(q => h('button', { type: 'button', class: 'row', onclick: () => questionSheet(e, q) },
      oxAv(q, 36),
      h('span', { class: 'row-body' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title clamp2', text: q.q }), q.miss ? h('span', { class: 'row-sub', text: `오답 ${q.miss}회` }) : null),
        q.lib ? dim('terminal') : null, dim('chev'))))));
  } else if (!e.attempts.length) {
    body.append(emptyState('clock', '아직 푼 기록이 없어요', '시작하기를 눌러 풀어 보세요.'));
  } else {
    body.append(h('div', { class: 'rows' }, e.attempts.slice().reverse().map(a => attemptRow({ s, e, a }))));
  }
  const dock = n ? [
    h('a', wr ? { class: 'glass gbtn', href: `#/p/${e.id}/wrong` } : { class: 'glass gbtn', 'aria-disabled': 'true' }, icon('bookmark'), `오답 ${wr}`),
    h('a', { class: 'pbtn', href: `#/p/${e.id}/all` }, icon('play'), '시작하기')
  ] : [h('button', { type: 'button', class: 'pbtn', onclick: () => questionSheet(e) }, icon('plus'), '문제 추가')];
  screen({
    title: e.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/s/' + s.id, dock,
    head: [pageHead({
      title: e.name, avatar: av(s.hue, 'doc'),
      lines: [[h('a', { href: '#/s/' + s.id, class: 'st' }, icon(sicon(s)), s.name), e.lib ? st('terminal', 'CLI 연동') : null]]
    }), facts],
    body,
    trail: [{ icon: 'more', label: '시험 메뉴', onClick: btn => openMenu(btn, examMenu(s, e)) }],
    fab: { icon: 'plus', label: 'OX 문제 추가', onClick: () => questionSheet(e) }
  });
}

/* =====================================================================
   play: the question is a post, the answer is a reply under it
   ===================================================================== */
let play = null;

function startPlay(eid, mode) {
  let qs, title, back, hue = 215, name = '', ic = 'book';
  if (eid === '_') {
    qs = allWrong().map(x => x.q); title = '오답 복습'; back = '#/wrong'; hue = 340; name = '오답노트'; ic = 'bookmark';
  } else {
    const f = findExam(eid);
    if (!f) return false;
    qs = f.e.questions.slice();
    if (mode === 'wrong') qs = qs.filter(q => q.last === false);
    title = f.e.name; back = '#/e/' + eid; hue = f.s.hue; name = f.s.name; ic = sicon(f.s);
  }
  if (!qs.length) { toast('풀 문제가 없어요'); location.replace(eid === '_' ? '#/wrong' : '#/e/' + eid); return false; }
  if (db.shuffle !== false) {
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }
  }
  play = { eid, mode, qs, title, back, hue, name, ic, i: 0, res: [], picked: null, done: false };
  return true;
}
function restart(mode) {
  const eid = play.eid;
  play = null;
  const t = `#/p/${eid}/${mode}`;
  if (location.hash === t) route(); else location.hash = t;
}
function answer(val) {
  if (!play || play.picked !== null || play.done) return;
  const q = play.qs[play.i], ok = val === q.a;
  play.picked = val;
  play.res.push({ q, ok });
  q.last = ok;
  if (!ok) q.miss = (q.miss || 0) + 1;
  save();
  renderPlay();
}
function next() {
  if (play.i + 1 >= play.qs.length) {
    if (play.eid !== '_') {
      const f = findExam(play.eid);
      f.e.attempts.push({ at: Date.now(), mode: play.mode, score: play.res.filter(r => r.ok).length, total: play.qs.length });
      f.e.attempts = f.e.attempts.slice(-30);
      save();
    }
    play.done = true;
  } else {
    play.i++;
    play.picked = null;
  }
  renderPlay();
  window.scrollTo(0, 0);
}

const oxBtn = val => h('button', { type: 'button', class: 'glass oxbtn', 'aria-label': val ? 'O 맞다' : 'X 틀리다', onclick: () => answer(val) },
  h('span', { class: 'g', 'aria-hidden': 'true', text: val ? 'O' : 'X' }), h('span', { 'aria-hidden': 'true', text: val ? '맞다' : '틀리다' }));

function renderPlay() {
  const p = play;
  if (p.done) return renderResult();
  const q = p.qs[p.i], total = p.qs.length, answered = p.picked !== null, ok = answered && p.picked === q.a;
  const done = p.i + (answered ? 1 : 0);
  const rows = [h('div', { class: 'post' + (answered ? ' next' : ''), style: palStyle(p.hue) },
    h('div', { class: 'post-av' }, av(p.hue, p.ic)),
    h('div', { class: 'post-body' },
      h('div', { class: 'qhead' }, h('span', { text: p.name }), h('span', { class: 'tag', text: 'OX' })),
      h('p', { class: 'q-text', text: q.q })))];
  if (answered) {
    rows.push(h('div', { class: 'post sm reply prev ' + (ok ? 'ok' : 'no'), style: palStyle(p.hue), 'aria-live': 'polite' },
      h('div', { class: 'post-av' }, h('span', { class: 'av ' + (ok ? 'good' : 'bad') }, icon(ok ? 'check' : 'close'))),
      h('div', { class: 'post-body' },
        h('div', { class: 'post-head' }, h('span', { class: 'post-title', text: ok ? '정답이에요' : '오답이에요' })),
        h('div', { class: 'tags' }, h('span', { class: 'tag', text: `내 답 ${p.picked ? 'O' : 'X'}` }), h('span', { class: 'tag', text: `정답 ${q.a ? 'O' : 'X'}` })),
        q.exp ? h('p', { text: q.exp }) : null)));
  }
  const body = h('div', null,
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': '진행도', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('span', { style: `width:${(done / total) * 100}%` })),
    h('section', { class: 'qpost' }, rows));
  screen({
    title: p.title, inline: `${p.i + 1} / ${total}`, close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body,
    dock: answered
      ? [h('button', { id: 'next', type: 'button', class: 'pbtn', onclick: next }, p.i + 1 >= total ? '결과 보기' : '다음 문제', icon('chev'))]
      : [oxBtn(true), oxBtn(false)]
  });
  if (answered) requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus({ preventScroll: true }); });
}

function renderResult() {
  const p = play;
  const total = p.qs.length, score = p.res.filter(r => r.ok).length;
  const pct = Math.round((score / total) * 100), wrong = p.res.filter(r => !r.ok);
  const msg = pct >= 90 ? '훌륭해요' : pct >= 70 ? '좋아요, 조금만 더' : '한 번 더 복습해 봐요';
  const body = h('div', null,
    h('section', { class: 'scorebox' }, ring(pct, true, `${pct}%`), h('p', { class: 'big', text: `${score} / ${total} 정답` }), h('p', { class: 'sub', text: msg })),
    wrong.length ? h('div', { class: 'sec', text: `틀린 문제 ${wrong.length}개` }) : null,
    wrong.length ? h('div', { class: 'rows' }, wrong.map(({ q }) => h('div', { class: 'row' }, oxAv(q, 36),
      h('span', { class: 'row-body' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: q.q }), q.exp ? h('span', { class: 'row-sub', text: q.exp }) : null))))) : null);
  screen({
    title: '결과', inline: '결과', close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body,
    dock: wrong.length
      ? [h('a', { class: 'glass gbtn narrow', href: p.back }, '나가기'), h('button', { type: 'button', class: 'pbtn', onclick: () => restart('wrong') }, icon('retry'), '틀린 것만')]
      : [h('button', { type: 'button', class: 'glass gbtn narrow', onclick: () => restart(p.mode) }, icon('retry'), '다시'), h('a', { class: 'pbtn', href: p.back }, '완료')]
  });
}

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') closeMenu();
  if (!play || play.done || $sheet.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.code === 'KeyO') answer(true);
  else if (ev.code === 'KeyX') answer(false);
});

/* =====================================================================
   router
   ===================================================================== */
const scrollMem = {};
let routeKey = '';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function route(keepScroll) {
  closeSheet();
  closeMenu();
  const hash = location.hash || '#/';
  const [k, a, b] = hash.replace(/^#\/?/, '').split('/');
  if (k !== 'p') play = null;
  const bad = () => { location.replace('#/'); };
  if (k === 's') {
    const s = findSubject(a);
    if (!s) return bad();
    viewSubject(s);
  } else if (k === 'e') {
    const f = findExam(a);
    if (!f) return bad();
    viewExam(f);
  } else if (k === 'p') {
    const mode = b === 'wrong' ? 'wrong' : 'all';
    if (!play || play.eid !== a || play.mode !== mode) if (!startPlay(a, mode)) return;
    renderPlay();
  } else if (k === 'wrong') viewWrong();
  else if (k === 'history') viewHistory();
  else if (k === 'settings') viewSettings();
  else viewHome();
  if (keepScroll !== true) {
    routeKey = hash;
    window.scrollTo(0, k === 'p' ? 0 : (scrollMem[hash] || 0));
    if (!reduceMotion()) $view.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  flushPending();
}
window.addEventListener('hashchange', () => route());

/* =====================================================================
   start
   ===================================================================== */
buildNav();
route();
syncLibrary();
checkUpdate();
try {
  if (sessionStorage.getItem('study.updated')) { sessionStorage.removeItem('study.updated'); toast('새 버전으로 업데이트했어요'); }
} catch { /* private mode */ }
