'use strict';

/* UI: shell, screens, sheets, router, sync and updates.
   Logic lives in engine.js (no DOM) and the motion toolkit in kit.js. */

const $stage = document.getElementById('stage');
const $nav = document.getElementById('nav');
const $view = document.getElementById('view');
const $tb = document.getElementById('tb');
const $dock = document.getElementById('dock');
const $layer = document.getElementById('layer');
const $toast = document.getElementById('toast');
const root = document.documentElement;
const onSaveFail = () => toast('저장하지 못했어요. 브라우저 저장소를 확인해 주세요.', { icon: 'info' });

/* =====================================================================
   toast
   ===================================================================== */
let toastTimer;
function hideToast() { $toast.classList.remove('show'); }
function toast(msg, { icon: ic = null, action = null, ms = 2600 } = {}) {
  $toast.replaceChildren(
    ic ? icon(ic) : null,
    h('span', { class: 't', text: msg }),
    action ? h('button', { type: 'button', text: action.label, onclick: () => { hideToast(); action.onClick(); } }) : null);
  $toast.classList.remove('show');
  void $toast.offsetWidth;                         // replay the entrance when a new message arrives
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(ms, 6000) : ms);
}

/* =====================================================================
   Claude connection: the phone's Claude app makes the questions, this app receives them.
   data/library.json is written by tools/quiz.mjs from a Claude Code session and pulled in here.
   ===================================================================== */
const REPO = (() => {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname), seg = location.pathname.split('/')[1];
  return m && seg ? `${m[1]}/${seg}` : 'DevToolXD/study';
})();
const KIND_LABEL = { auto: '자동', vocab: '단어', math: '수학', quiz: '퀴즈' };
const KIND_ASK = { vocab: '단어 외우기 (뜻 고르기, 단어 고르기, 쓰기)', math: '수학 풀이 (같거나 비슷한 유형)', quiz: '퀴즈 (OX, 객관식, 주관식)' };
const makeForm = { subject: '', exam: '', kind: null, count: null, refresh: false };

function makeMessage(f) {
  const lines = [f.refresh ? `이 시험의 새 문제 ${f.count}개를 만들어줘. 이미 있는 문제와 겹치지 않게, 같은 범위에서.` : `책 사진으로 문제 ${f.count}개 만들어줘.`];
  lines.push(`과목: ${f.subject || '(사진 보고 정해줘)'}`);
  lines.push(`시험·단원: ${f.exam || '(사진 보고 정해줘)'}`);
  if (f.kind && f.kind !== 'auto') lines.push(`종류: ${KIND_ASK[f.kind]}`);
  lines.push(f.refresh ? '다 만들면 앱에 들어가게 data/library.json 에 넣고 push 해줘.' : '사진은 이 메시지에 첨부했어요. 다 만들면 앱에 들어가게 data/library.json 에 넣고 push 해줘.');
  return lines.join('\n');
}
const claudeQuery = msg => `repo=${encodeURIComponent(REPO)}&branch=master&q=${encodeURIComponent(msg)}`;
const claudeUrl = msg => `https://claude.ai/code/new?${claudeQuery(msg)}`;
const claudeScheme = msg => `claude://code/new?${claudeQuery(msg)}`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const t = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;opacity:0', text });
    document.body.append(t); t.focus(); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

const sync = { busy: false, ok: null };
async function syncLibrary(manual) {
  if (sync.busy) return;
  sync.busy = true;
  refreshSyncUI();
  try {
    const res = await fetch('data/library.json', { cache: 'no-store' });
    if (res.status === 404) { sync.ok = true; db.sync.at = Date.now(); save(); if (manual) toast('아직 Claude가 보낸 문제가 없어요', { icon: 'info' }); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error('library.json 형식 오류'); }
    const { added, changed, arrived } = mergeLibrary(cleanLibrary(raw));
    db.sync = { ...db.sync, rev: fnv(text), at: Date.now(), count: libCount() };
    if (added) db.sync.last = { at: Date.now(), n: added, subject: arrived[0].subject, exam: arrived[0].exam, examId: arrived[0].examId, many: arrived.length };
    save();
    sync.ok = true;
    if (changed) requestRender();
    if (added) onArrival(arrived, added);
    else if (manual) toast('이미 최신이에요', { icon: 'checkcircle' });
  } catch {
    sync.ok = false;
    if (manual) toast('가져오지 못했어요. 연결을 확인해 주세요.', { icon: 'info' });
  } finally {
    sync.busy = false;
    refreshSyncUI();
  }
}
function onArrival(arrived, added) {
  if (db.wait) stopWaiting(true);
  const one = arrived.length === 1 ? arrived[0] : null;
  toast(one ? `${one.subject} · ${one.exam}에 새 문제 ${one.n}개가 들어왔어요` : `새 문제 ${added}개가 들어왔어요`, {
    icon: 'sparkle', action: one ? { label: '열기', onClick: () => { location.hash = '#/e/' + one.examId; } } : null
  });
}
const syncText = () =>
  sync.ok === false ? '연결할 수 없어요. 다음에 다시 시도해요'
    : db.sync.at ? `${ago(db.sync.at)} 확인 · Claude 문제 ${db.sync.count}개` : '아직 확인하지 않았어요';
function refreshSyncUI() {
  document.querySelectorAll('.js-sync').forEach(b => b.classList.toggle('spin', sync.busy));
  document.querySelectorAll('.js-sync-text').forEach(t => { t.textContent = syncText(); });
}

/* after you send the request to Claude, check for the answer more often for a while */
let waitTimer = null, waitTick = null;
function startWaiting(info) {
  db.wait = { since: Date.now(), subject: info.subject || '', exam: info.exam || '' };
  save();
  armWait();
}
function stopWaiting(arrived) {
  db.wait = null; save();
  clearInterval(waitTimer); waitTimer = null;
  if (arrived && /^#\/make/.test(location.hash)) requestRender();
}
function armWait() {
  clearInterval(waitTimer);
  waitTimer = null;
  if (!db.wait) return;
  waitTimer = setInterval(() => {
    if (!db.wait) { clearInterval(waitTimer); return; }
    if (Date.now() - db.wait.since > 30 * 60 * 1000) { stopWaiting(); if (/^#\/make/.test(location.hash)) requestRender(); return; }
    if (document.visibilityState === 'visible') syncLibrary();
  }, 12000);
}
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* =====================================================================
   Home Screen app: service worker + automatic updates
   ===================================================================== */
let swReg = null, baseFp = null, appVersion = '', pendingReload = false, renderPending = false;

async function fingerprint() {
  const files = ['index.html', 'styles.css', 'icons.js', 'engine.js', 'kit.js', 'app.js'];
  const texts = await Promise.all(files.map(f => fetch(f, { cache: 'no-store' }).then(r => (r.ok ? r.text() : Promise.reject(new Error(f))))));
  return fnv(texts.join('\u0000'));
}
const busyForReload = () => (play && !play.done) || sheets.length > 0 || isTyping();
async function checkUpdate(manual) {
  try {
    const fp = await fingerprint();
    if (baseFp === null) { baseFp = fp; appVersion = fp.slice(0, 6); refreshVersionUI(); if (manual) toast('최신 버전이에요', { icon: 'checkcircle' }); return; }
    if (fp === baseFp) { if (manual) toast('최신 버전이에요', { icon: 'checkcircle' }); return; }
    if (busyForReload()) { pendingReload = true; toast('새 버전이 준비됐어요. 끝나면 적용돼요', { icon: 'refresh' }); return; }
    reloadForUpdate();
  } catch { if (manual) toast('업데이트를 확인하지 못했어요', { icon: 'info' }); }
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
  armWait();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onWake(); });
window.addEventListener('online', onWake);
window.addEventListener('pageshow', e => { if (e.persisted) onWake(); });
setInterval(() => { if (document.visibilityState === 'visible') { checkUpdate(); syncLibrary(); } }, 5 * 60 * 1000);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { swReg = r; }).catch(() => {});
}

/* work that arrives while a sheet, a quiz or the keyboard is open waits until it's over */
function requestRender() {
  if (busyForReload()) { renderPending = true; return; }
  route(true);
}
document.addEventListener('focusout', () => setTimeout(() => flushPending(), 80));
function flushPending() {
  if (busyForReload()) return;
  if (pendingReload) { pendingReload = false; reloadForUpdate(); return; }
  if (renderPending) { renderPending = false; route(true); }
}

/* =====================================================================
   no pinch zoom, no long-press selection (inputs keep normal editing),
   and a viewport that follows the keyboard instead of letting iOS pan it
   ===================================================================== */
const editable = el => !!(el && el.closest && el.closest('input, textarea'));
const isTyping = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName)); };
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('selectstart', e => { const el = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (!editable(el)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

const vv = window.visualViewport;
function syncViewport() {
  if (!vv) return;
  const zoomed = vv.scale > 1.02;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const open = !zoomed && kb > 80;                        // smaller changes are just the browser bar
  root.style.setProperty('--kb', (open ? kb : 0) + 'px');
  if (zoomed) root.style.removeProperty('--vvh'); else root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
  document.body.classList.toggle('kb-open', open);
}
if (vv) { vv.addEventListener('resize', syncViewport); vv.addEventListener('scroll', syncViewport); }
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 350));

/* =====================================================================
   shell: hue, navigation, toolbar, dock, screen layers
   ===================================================================== */
function setHue(hue) {
  const p = pal(hue);
  root.style.setProperty('--ca', p[0]); root.style.setProperty('--cb', p[1]);
  root.style.setProperty('--cx', p[2]); root.style.setProperty('--cc', p[3]);
}

const TABS = [['home', '과목', 'stack', '#/'], ['wrong', '오답노트', 'bookmark', '#/wrong'], ['history', '기록', 'clock', '#/history'], ['settings', '설정', 'sliders', '#/settings']];
let fabEl = null, sideEl = null, tabbarEl = null, fabLabel = '';

function logoMark() {
  const s = h('span', { class: 'logo', 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0a0a0c"/><circle cx="172" cy="256" r="84" fill="none" stroke="#fff" stroke-width="40"/><path d="M304 186l120 140M424 186L304 326" fill="none" stroke="#5aaeff" stroke-width="40" stroke-linecap="round"/></svg>';
  return s;
}
function buildNav() {
  tabbarEl = h('div', { class: 'glass tabbar', role: 'group', 'aria-label': '탭', style: `--n:${TABS.length};--i:0` },
    h('i', { class: 'tab-thumb', 'aria-hidden': 'true' }),
    TABS.map(([k, label, ic, href]) => h('a', { class: 'tab', 'data-tab': k, href }, icon(ic), h('span', { class: 'tab-label', text: label }))));
  fabEl = h('button', { class: 'fab off', type: 'button', 'aria-hidden': 'true', tabindex: '-1' });
  sideEl = h('div', { class: 'side' });
  $nav.replaceChildren(h('div', { class: 'brand' }, logoMark(), h('span', { text: '공부방' })), tabbarEl, fabEl, sideEl);
}
function updateNav(o) {
  document.body.classList.toggle('detail', !!o.detail);
  const idx = TABS.findIndex(t => t[0] === o.tab);
  if (idx >= 0) tabbarEl.style.setProperty('--i', idx);
  for (const a of $nav.querySelectorAll('.tab')) {
    if (a.dataset.tab === o.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (o.fab) {
    const changed = fabLabel !== o.fab.label;
    fabLabel = o.fab.label;
    fabEl.replaceChildren(icon(o.fab.icon), h('span', { class: 'fab-label', text: o.fab.label }));
    fabEl.setAttribute('aria-label', o.fab.label);
    fabEl.removeAttribute('aria-hidden'); fabEl.removeAttribute('tabindex');
    fabEl.onclick = o.fab.onClick;
    if (fabEl.classList.contains('off') || changed) { fabEl.classList.remove('off'); pop(fabEl.firstElementChild, { from: 0.5, delay: 120 }); }
  } else {
    fabLabel = '';
    fabEl.classList.add('off'); fabEl.setAttribute('aria-hidden', 'true'); fabEl.setAttribute('tabindex', '-1'); fabEl.onclick = null;
  }
  sideEl.replaceChildren(
    h('div', { class: 'side-title', text: '과목' }),
    ...db.subjects.map(s => h('a', { class: 'side-row', href: '#/s/' + s.id, 'aria-current': s.id === o.subjectId ? 'true' : null, style: palStyle(s.hue) },
      av(s.hue, sicon(s)), h('span', { class: 'nm', text: s.name }), h('small', { text: String(subjQ(s)) }))));
}

function toolbar(o, dir) {
  const lead = o.back ? h('a', { class: 'glass tb-round lit', href: o.back, 'aria-label': '뒤로' }, icon('back'))
    : o.close ? h('a', { class: 'glass tb-round lit', href: o.close, 'aria-label': '닫기' }, icon('close'))
    : h('span');
  const trail = o.trail && o.trail.length
    ? h('div', { class: 'glass ' + (o.trail.length > 1 ? 'tb-group' : 'tb-round') },
      o.trail.map(t => h('button', { class: 'tb-btn ' + (t.cls || ''), type: 'button', 'aria-label': t.label, onclick: ev => t.onClick(ev.currentTarget) }, icon(t.icon))))
    : h('span');
  const title = h('div', { class: 'tb-title' }, h('span', { text: o.inline || o.title }));
  $tb.replaceChildren(lead, title, trail);
  if (dir !== 'replace') { [lead, trail].forEach(el => { if (el.classList.contains('glass')) pop(el, { from: 0.6, dur: 560, delay: dir === 'init' ? 200 : 60 }); }); }
}
function setToolbarTitle(text) {
  const span = $tb.querySelector('.tb-title span');
  if (!span || span.textContent === text) return;
  span.textContent = text;
  anim(span, [{ opacity: 0, transform: 'translateY(6px) scale(.96)' }, { opacity: 1, transform: 'none' }], { dur: 420 });
}

let largeTitle = true;
function onScroll() {
  const y = window.scrollY;
  document.body.classList.toggle('scrolled', y > 2);
  document.body.style.setProperty('--p', (largeTitle ? clamp((y - 14) / 30, 0, 1) : 1).toFixed(3));
}
let ticking = false;
window.addEventListener('scroll', () => {
  if (routeKey && !transitioning) scrollMem[routeKey] = window.scrollY;
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });

/* the bottom action bar: the old buttons drift out as a ghost while the new ones spring in */
function setDock(nodes) {
  const old = [...$dock.children];
  if (old.length && !reduceMotion()) {
    const ghost = h('div', { class: 'dock dock-ghost', 'aria-hidden': 'true' }, old.map(n => n.cloneNode(true)));
    ghost.style.bottom = getComputedStyle($dock).bottom;
    document.body.append(ghost);
    anim(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(16px) scale(.96)' }], { dur: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(() => ghost.remove(), () => ghost.remove());
    setTimeout(() => ghost.remove(), 600);
  }
  $dock.replaceChildren(...nodes);
  document.body.classList.toggle('has-dock', nodes.length > 0);
  nodes.forEach((n, i) => rise(n, { y: 34, scale: 0.94, delay: 60 + i * 55, dur: 640 }));
}

/* screens are layers: the new one springs in while the old one slides back as a fixed ghost */
let navCtx = { dir: 'init', y: 0 };
let curLayer = null, transitioning = false, transTimer = 0;
const scrollMem = {};
let routeKey = '';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function mountScreen(layer, dir, targetY) {
  const old = curLayer;
  curLayer = layer;
  $view.querySelectorAll('.screen.leaving').forEach(n => n.remove());
  if (!old || dir === 'init' || dir === 'replace' || !old.isConnected) {
    $view.replaceChildren(layer);
    return;
  }
  const y = window.scrollY;
  old.classList.add('leaving');
  old.style.top = -y + 'px';
  old.setAttribute('aria-hidden', 'true');
  old.inert = true;
  $view.append(layer);
  window.scrollTo(0, targetY);
  transitioning = true;
  clearTimeout(transTimer);
  transTimer = setTimeout(() => { transitioning = false; }, 700);

  /* the old layer is gone by about half way, the new one starts a beat later, so the two never read as overlapping text */
  const out = (to, dur, easing) => anim(old, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to, offset: 0.55 }, { opacity: 0, transform: to }], { dur, easing, fill: 'forwards' });
  let outA, inA;
  if (dir === 'push') {
    outA = out('translate3d(-14%, 0, 0) scale(.96)', 440, 'cubic-bezier(.4, 0, .2, 1)');
    inA = anim(layer, [{ opacity: 0, transform: 'translate3d(32%, 0, 0)' }, { opacity: 1, transform: 'none' }], { dur: 660, easing: 'spring-soft', delay: 70 });
  } else if (dir === 'pop') {
    outA = out('translate3d(30%, 0, 0)', 400, 'cubic-bezier(.4, 0, 1, 1)');
    inA = anim(layer, [{ opacity: 0, transform: 'translate3d(-14%, 0, 0) scale(.96)' }, { opacity: 1, transform: 'none' }], { dur: 660, easing: 'spring-soft', delay: 70 });
  } else {
    const s = dir === 'tab-l' ? -1 : dir === 'tab-r' ? 1 : 0;
    outA = out(`translate3d(${-s * 7}%, 0, 0) scale(.985)`, 320, 'ease-in');
    inA = anim(layer, [{ opacity: 0, transform: `translate3d(${s * 7}%, ${s ? 0 : 14}px, 0) scale(.985)` }, { opacity: 1, transform: 'none' }], { dur: 620, easing: 'spring-soft', delay: 60 });
  }
  const drop = () => old.remove();
  outA.finished.then(drop, drop);
  setTimeout(drop, 900);
  inA.finished.then(() => { transitioning = false; }, () => { transitioning = false; });
}

/* o: { title, head, body, back, close, trail, dock, inline, hue, tab, detail, fab, subjectId, plain } */
function screen(o) {
  const dir = navCtx.dir;
  setHue(o.hue);
  largeTitle = !o.plain;
  toolbar(o, dir);
  updateNav(o);
  const layer = h('div', { class: 'screen' }, [].concat(o.head || [], o.body || []).filter(Boolean));
  const prevKeys = dir === 'replace' && curLayer ? new Set([...curLayer.querySelectorAll('[data-key]')].map(n => n.dataset.key)) : null;
  mountScreen(layer, dir, navCtx.y || 0);
  setDock((o.dock || []).filter(Boolean));
  document.title = o.title === '공부방' ? '공부방' : `${o.inline || o.title} · 공부방`;
  refreshSyncUI();
  refreshVersionUI();
  onScroll();
  if (dir === 'init') rise($nav, { y: 70, scale: 0.96, delay: 260, dur: 760 });
  if (dir === 'init' || dir === 'tab-l' || dir === 'tab-r' || dir === 'swap') enterContent(layer, dir === 'init' ? 70 : 42);
  if (prevKeys) layer.querySelectorAll('[data-key]').forEach(n => { if (!prevKeys.has(n.dataset.key)) rise(n, { y: 18, dur: 640 }); });
  navCtx = { dir: 'replace', y: window.scrollY };
  return layer;
}
/* the first things on a screen arrive one after another */
function enterContent(layer, step) {
  const targets = [];
  for (const k of layer.children) {
    if (k.classList.contains('feed') || k.classList.contains('stack')) targets.push(...k.children);
    else targets.push(k);
  }
  targets.slice(0, 9).forEach((t, i) => rise(t, { y: 22, delay: 60 + i * step, dur: 700 }));
}

/* =====================================================================
   components
   ===================================================================== */
const av = (hue, name, cls) => h('span', { class: 'av ' + (cls || ''), style: palStyle(hue), 'aria-hidden': 'true' }, icon(name));
const oxAv = (q, size) => h('span', { class: 'av ' + (q.a ? 'o' : 'x'), style: size ? `--av:${size}px` : null, 'aria-label': q.a ? '정답 O' : '정답 X', text: q.a ? 'O' : 'X' });
function qAvatar(q, size) {
  if (q.type === 'ox') return oxAv(q, size);
  const ic = q.type === 'word' ? 'type' : q.type === 'mc' ? 'list' : 'pencil';
  return h('span', { class: 'av ghost', style: size ? `--av:${size}px` : null, 'aria-label': TYPE_LABEL[q.type] }, icon(ic));
}
const st = (ic, text) => h('span', { class: 'st' }, icon(ic), text);
const dim = name => icon(name, 'chev');
const code = t => h('code', { text: t });
const chip = (ic, text) => h('span', { class: 'chip' }, ic ? icon(ic) : null, text);

function pageHead({ title, lines, avatar }) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'ph-text' }, h('h1', { text: title }), ...(lines || []).filter(Boolean).map(l => h('div', { class: 'sub' }, l))),
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
  return h('section', { class: 'empty' }, h('div', { class: 'glass empty-ico' }, icon(ic)), h('h2', { text: title }), text ? h('p', { text }) : null, extra || null);
}
function ringEl(pct, { size = 120, w = 12, label = '', sm = false, text = null, count = false } = {}) {
  const r = (100 - w) / 2, c = 2 * Math.PI * r;
  const box = h('div', { class: 'ring' + (sm ? ' sm' : ''), role: 'img', 'aria-label': label || `${pct}%`, style: `--rs:${size}px` });
  box.innerHTML = `<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${r}" fill="none" stroke-width="${w}"/>` +
    `<circle class="val" cx="50" cy="50" r="${r}" fill="none" stroke-width="${w}" stroke-linecap="round" style="stroke-dasharray:0 ${c};opacity:${pct ? 1 : 0}"/></svg>`;
  const val = box.querySelector('.val');
  const b = h('b', { 'aria-hidden': 'true', text: text != null ? text : sm ? String(pct) : pct + '%' });
  box.append(b);
  fillLater(() => { val.style.strokeDasharray = `${(c * pct) / 100} ${c}`; });
  if (count && !sm) countUp(b, pct, { suffix: '%', dur: 1100 });
  return box;
}
function barEl(pct) {
  const fill = h('span', { style: '--w:0%' });
  fillLater(() => fill.style.setProperty('--w', Math.max(0, Math.min(100, pct)) + '%'));
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, fill);
}
function statBox(value, label, { count = false, suffix = '' } = {}) {
  const b = h('b', { text: String(value) + suffix });
  if (count && typeof value === 'number') countUp(b, value, { suffix, dur: 900 });
  return h('div', null, b, h('span', { text: label }));
}

/* segmented control with a thumb that slides to the chosen item */
function seg(items, value, onChange, { cls = '', label, role = 'group', attr = 'aria-pressed', itemRole = null } = {}) {
  const el = h('div', { class: ['seg', cls], role, 'aria-label': label, style: `--n:${items.length};--i:${Math.max(0, items.findIndex(it => it.value === value))}` });
  let cur = value;
  const btns = items.map((it, i) => h('button', { type: 'button', role: itemRole, 'aria-label': it.aria, [attr]: String(it.value === value), onclick: () => pick(i, false) }, it.label));
  el.append(h('i', { class: 'seg-thumb', 'aria-hidden': 'true' }), ...btns);
  function pick(i, silent) {
    if (i < 0) return;
    const changed = items[i].value !== cur;
    cur = items[i].value;
    el.style.setProperty('--i', i);
    btns.forEach((b, k) => b.setAttribute(attr, String(k === i)));
    if (!silent && onChange && changed) onChange(cur);
  }
  return { el, get: () => cur, set: v => pick(items.findIndex(it => it.value === v), true) };
}

/* popover menu: a glass sheet that grows out of its button */
let menuEl = null, scrimEl = null;
function closeMenu(instant) {
  if (!menuEl) return;
  const m = menuEl, s = scrimEl;
  menuEl = scrimEl = null;
  s.remove();
  if (instant || reduceMotion()) { m.remove(); return; }
  anim(m, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.88)' }], { dur: 170, easing: 'ease-in', fill: 'forwards' }).finished.then(() => m.remove(), () => m.remove());
  setTimeout(() => m.remove(), 400);
}
function openMenu(anchor, items) {
  closeMenu(true);
  const m = h('div', { class: 'glass menu', role: 'menu' },
    items.map(it => (it === '-' ? h('hr') : h('button', {
      type: 'button', role: 'menuitem', class: 'mitem' + (it.danger ? ' danger' : ''),
      onclick: () => { closeMenu(); it.onClick(); }
    }, icon(it.icon), h('span', { class: 'grow', text: it.label }), it.check ? icon('check') : null))));
  scrimEl = h('div', { class: 'menu-scrim', onclick: () => closeMenu() });
  document.body.append(scrimEl, m);
  menuEl = m;
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, hh = m.offsetHeight;
  const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
  let top = r.bottom + 8;
  const flip = top + hh > innerHeight - 12;
  if (flip) top = Math.max(12, r.top - hh - 8);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  m.style.transformOrigin = `${clamp(r.left + r.width / 2 - left, 0, w)}px ${flip ? hh : 0}px`;
  anim(m, [{ opacity: 0, transform: 'scale(.62) translateY(-6px)' }, { opacity: 1, transform: 'none' }], { dur: 560, easing: 'spring-bounce' });
  [...m.querySelectorAll('.mitem')].forEach((b, i) => anim(b, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { dur: 380, delay: 60 + i * 38, easing: 'spring-soft' }));
}

/* ---------- sheets: a stack of glass panels with a pull-to-dismiss grabber ---------- */
const sheets = [];
const wide = () => matchMedia('(min-width: 640px)').matches;
const setInert = on => { for (const el of [$stage, $nav, $dock]) el.inert = on; };

function openSheet({ title, body, submit = '저장', danger = false, cancel = '취소', onSubmit, onClose }) {
  closeMenu(true);
  const opener = document.activeElement;
  const id = 'sheet-title-' + (sheets.length + 1);
  const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
  const pull = h('div', { class: 'sheet-pull' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn sm lit', onclick: () => closeSheet(), text: cancel }),
      h('h2', { id, text: title }),
      submit ? h('button', { type: 'submit', class: 'btn sm lit ' + (danger ? 'danger' : 'prim'), text: submit }) : h('span')));
  const content = h('div', { class: 'sheet-body' }, body);
  const form = h('form', { class: 'sheet-form', novalidate: '' }, pull, content);
  const el = h('div', { class: 'glass sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1' }, form);
  const entry = { el, scrim, opener, onClose, closing: false, form };
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!onSubmit || onSubmit(form) !== false) closeSheet(entry);
  });

  const below = sheets[sheets.length - 1];
  if (below) { below.el.classList.add('under'); below.el.inert = true; }
  sheets.push(entry);
  setInert(true);
  $layer.append(scrim, el);
  el.focus({ preventScroll: true });

  /* enter */
  anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { dur: 320, easing: 'ease-out' });
  if (wide()) anim(el, [{ opacity: 0, transform: 'scale(.94) translateY(12px)' }, { opacity: 1, transform: 'none' }], { dur: 560, easing: 'spring' });
  else anim(el, [{ transform: `translateY(${innerHeight}px)` }, { transform: 'none' }], { dur: 720, easing: 'spring' });
  [...content.children].forEach((c, i) => rise(c, { y: 18, delay: 130 + i * 48, dur: 640 }));
  if (!wide()) dragToDismiss(entry, pull);

  /* on touch screens an automatic focus pops the keyboard mid-animation, which is what made iOS zoom and shove the sheet */
  const first = form.querySelector('input[type=text], textarea');
  if (first && finePointer()) first.focus({ preventScroll: true });
  return entry;
}

function dragToDismiss(entry, handle) {
  const el = entry.el;
  let sy = 0, sx = 0, last = 0, lastT = 0, vy = 0, dy = 0, dt = 1, drag = false, id = null;
  handle.addEventListener('pointerdown', e => {
    if (entry.closing || e.button > 0) return;
    id = e.pointerId; sy = last = e.clientY; sx = e.clientX; lastT = e.timeStamp; vy = 0; dy = 0; drag = false;
  });
  handle.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const d = e.clientY - sy;
    if (!drag) {
      if (Math.abs(d) < 6 || Math.abs(e.clientX - sx) > Math.abs(d)) return;
      drag = true;
      try { handle.setPointerCapture(id); } catch { /* not capturable */ }
    }
    dt = Math.max(1, e.timeStamp - lastT);
    vy = (e.clientY - last) / dt;
    last = e.clientY; lastT = e.timeStamp;
    dy = d > 0 ? d : -Math.pow(-d, 0.7);                // pulling up resists
    el.style.transform = `translateY(${dy}px)`;
    entry.scrim.style.opacity = String(clamp(1 - Math.max(0, dy) / (innerHeight * 0.7), 0.2, 1));
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null;
    if (!drag) return;
    drag = false;
    /* the drag must not click the button it started on */
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
    if (dy > 110 || vy > 0.7) { closeSheet(entry, { from: dy }); return; }
    anim(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { dur: 560, easing: 'spring', fill: 'none' });
    anim(entry.scrim, [{ opacity: entry.scrim.style.opacity || 1 }, { opacity: 1 }], { dur: 300, fill: 'none' });
    el.style.transform = ''; entry.scrim.style.opacity = '';
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function closeSheet(entry, { instant = false, from = 0 } = {}) {
  entry = entry || sheets[sheets.length - 1];
  if (!entry || entry.closing) return Promise.resolve();
  entry.closing = true;
  sheets.splice(sheets.indexOf(entry), 1);
  const below = sheets[sheets.length - 1];
  if (below) { below.el.classList.remove('under'); below.el.inert = false; } else setInert(false);
  const finish = () => {
    entry.el.remove(); entry.scrim.remove();
    if (!sheets.length && entry.opener && entry.opener.isConnected && finePointer()) entry.opener.focus({ preventScroll: true });
    if (entry.onClose) entry.onClose();
    flushPending();
  };
  if (instant || reduceMotion()) { finish(); return Promise.resolve(); }
  entry.el.style.transform = '';
  anim(entry.scrim, [{ opacity: entry.scrim.style.opacity || 1 }, { opacity: 0 }], { dur: 300, easing: 'ease-out', fill: 'forwards' });
  const a = wide()
    ? anim(entry.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.95) translateY(10px)' }], { dur: 240, easing: 'ease-in', fill: 'forwards' })
    : anim(entry.el, [{ transform: `translateY(${from}px)` }, { transform: `translateY(${innerHeight}px)` }], { dur: 380, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
  const done = () => finish();
  a.finished.then(done, done);
  return a.finished.then(() => {}, () => {});
}
function closeAllSheets() { while (sheets.length) closeSheet(sheets[sheets.length - 1], { instant: true }); }

function confirmSheet(title, message, label, onYes) {
  openSheet({ title, body: h('p', { class: 'hint', text: message }), submit: label, danger: true, onSubmit: () => { onYes(); } });
}
const group = (label, content) => h('div', null, label ? h('div', { class: 'glabel', text: label }) : null, h('div', { class: 'sg' }, content));
function picker(items, initial, cls, onChange) {
  let cur = initial;
  const el = h('div', { class: cls, role: 'group' });
  const paint = () => [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === cur)));
  items.forEach(it => el.append(h('button', { type: 'button', class: 'lit', 'aria-label': it.aria, style: it.style, onclick: () => { cur = it.value; paint(); if (onChange) onChange(cur); } }, it.label)));
  paint();
  return { el, get: () => cur };
}
const textField = (label, value, placeholder, max) => h('input', {
  class: 'field', type: 'text', maxlength: max, 'aria-label': label, value: value || '', placeholder,
  autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done'
});

function subjectSheet(subject) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = textField('과목 이름', subject && subject.name, '예: 수학', 20);
  let curIcon = subject ? sicon(subject) : SUBJECT_ICONS[0], curHue = subject ? subject.hue : HUES[0];
  const preview = h('div', { class: 'preview' });
  const paintPreview = animate => { const a = av(curHue, curIcon); preview.replaceChildren(a); if (animate) pop(a, { from: 0.8 }); };
  paintPreview(false);
  const iconPick = picker(SUBJECT_ICONS.map(k => ({ value: k, label: icon(k), aria: k })), curIcon, 'picker', v => { curIcon = v; paintPreview(true); });
  const huePick = picker(HUES.map((v, i) => ({ value: v, label: icon('check'), aria: `색상 ${i + 1}`, style: `--s1:${pal(v)[0]};--s2:${pal(v)[1]}` })), curHue, 'swatches', v => { curHue = v; paintPreview(true); });
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
        onclick: () => confirmSheet('과목 삭제', `"${subject.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => { removeSubject(subject); closeAllSheets(); location.hash = '#/'; route(true); })
      }, icon('trash'), '과목 삭제')) : null
    ],
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { err.textContent = '과목 이름을 입력해 주세요.'; shake(name); name.focus(); return false; }
      if (subject) Object.assign(subject, { name: n, icon: iconPick.get(), hue: huePick.get() });
      else db.subjects.push({ id: uid(), name: n, icon: iconPick.get(), hue: huePick.get(), exams: [] });
      save(); route(true);
    }
  });
}

function examSheet(subject, exam) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = textField('시험·단원 이름', exam && exam.name, '예: 중간고사, 3단원', 30);
  openSheet({
    title: exam ? '시험 편집' : '새 시험·단원',
    body: [
      group('이름', name),
      h('p', { class: 'hint', text: '문제는 직접 쓰지 않아요. 문제 만들기에서 Claude 앱으로 책 사진을 올리면 채워져요.' }),
      err,
      exam ? h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => confirmSheet('시험 삭제', `"${exam.name}"과 문제 ${exam.questions.length}개가 지워져요.`, '삭제', () => { removeExam(subject, exam); closeAllSheets(); location.hash = '#/s/' + subject.id; route(true); })
      }, icon('trash'), '시험 삭제')) : null
    ],
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { err.textContent = '이름을 입력해 주세요.'; shake(name); name.focus(); return false; }
      if (exam) exam.name = n;
      else subject.exams.push({ id: uid(), name: n, questions: [], attempts: [] });
      save(); route(true);
    }
  });
}

/* questions from Claude are read-only here; only an old hand-written OX question can still be edited */
function questionSheet(exam, q) {
  if (!(q && !q.lib && q.type === 'ox')) return questionView(q);
  const text = h('textarea', { class: 'field', rows: 4, maxlength: 400, 'aria-label': '문장', text: q.q });
  const ans = seg([{ value: true, label: 'O  맞다', aria: 'O 맞다' }, { value: false, label: 'X  틀리다', aria: 'X 틀리다' }], q.a, null, { cls: 'sheet-seg' });
  const exp = h('textarea', { class: 'field', rows: 2, maxlength: 300, 'aria-label': '해설', placeholder: '해설 (선택)', text: q.exp });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({
    title: '문제 편집',
    body: [
      group('문장', text),
      h('div', null, h('div', { class: 'glabel', text: '정답' }), ans.el),
      group('해설', exp),
      err,
      h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => { exam.questions = exam.questions.filter(x => x !== q); save(); closeAllSheets(); route(true); }
      }, icon('trash'), '문제 삭제'))
    ],
    onSubmit: () => {
      const t = text.value.trim();
      if (!t) { err.textContent = '문장을 입력해 주세요.'; shake(text); text.focus(); return false; }
      Object.assign(q, { q: t, a: ans.get(), exp: exp.value.trim() });
      save(); route(true);
    }
  });
}
function questionView(q) {
  const lines = [];
  if (q.type === 'mc') q.choices.forEach((c, i) => lines.push(h('p', { class: 'ch' + (i === q.a ? ' on' : '') }, h('span', { class: 'cn', text: String(i + 1) }), h('span', { text: c }))));
  openSheet({
    title: TYPE_LABEL[q.type] || '문제', submit: null, cancel: '닫기',
    body: [
      h('div', { class: 'sg qview' },
        h('p', { class: 'q', text: q.type === 'word' ? q.term : q.q }),
        ...lines,
        h('div', { class: 'a' }, q.type === 'ox' ? oxAv(q, 28) : null, h('span', { text: q.type === 'mc' ? '' : `정답  ${answerText(q)}` })),
        q.type === 'word' && q.ex ? h('p', { class: 'muted', text: q.ex }) : null,
        q.exp ? h('p', { text: q.exp }) : null,
        h('div', { class: 'tags' }, h('span', { class: 'tag', text: topicOf(q) }), q.seen ? h('span', { class: 'tag', text: `푼 횟수 ${q.seen}` }) : null, q.miss ? h('span', { class: 'tag', text: `틀림 ${q.miss}` }) : null)),
      q.lib ? h('p', { class: 'hint', text: 'Claude가 만든 문제예요. 고치려면 Claude 앱에서 수정을 요청해 주세요.' }) : null
    ]
  });
}

/* =====================================================================
   menus
   ===================================================================== */
const subjectMenu = s => [
  { icon: 'sparkle', label: '문제 만들기', onClick: () => { location.hash = '#/make/' + s.id; } },
  { icon: 'plus', label: '시험·단원 추가', onClick: () => examSheet(s) },
  { icon: 'pencil', label: '과목 편집', onClick: () => subjectSheet(s) },
  '-',
  { icon: 'trash', label: '과목 삭제', danger: true, onClick: () => confirmSheet('과목 삭제', `"${s.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => {
    const card = document.querySelector(`.screen:not(.leaving) [data-key="${s.id}"]`);
    removeSubject(s);
    if (card) collapse(card).then(() => route(true)); else route(true);
  }) }
];
const examMenu = (s, e) => [
  { icon: 'sparkle', label: e.questions.length ? '새 문제 받기' : '문제 만들기', onClick: () => { location.hash = `#/make/${s.id}/${e.id}${e.questions.length ? '/refresh' : ''}`; } },
  { icon: 'pencil', label: '시험 편집', onClick: () => examSheet(s, e) },
  { icon: 'retry', label: '처음부터 다시', onClick: () => confirmSheet('처음부터 다시', '이 시험의 점수, 오답, 정복 표시를 모두 지우고 처음부터 시작해요. 문제는 그대로 남아요.', '다시 시작', () => { resetExam(e); route(true); toast('처음부터 시작해요', { icon: 'retry' }); }) },
  '-',
  { icon: 'trash', label: '시험 삭제', danger: true, onClick: () => confirmSheet('시험 삭제', `"${e.name}"과 문제 ${e.questions.length}개가 지워져요.`, '삭제', () => { removeExam(s, e); location.hash = '#/s/' + s.id; route(true); }) }
];
function resetExam(e) {
  e.attempts = [];
  e.questions.forEach(q => { q.seen = 0; delete q.last; delete q.miss; delete q.done; delete q.at; });
  save();
}

/* =====================================================================
   tab screens
   ===================================================================== */
function examReply(s, e) {
  const sc = lastScore(e), wr = wrongCount(e), done = doneCount(e);
  return post({
    sm: true, avatar: av(s.hue, 'doc', 'soft'), title: e.name, href: '#/e/' + e.id, style: palStyle(s.hue),
    meta: [h('span', { text: `${unitOf(e)} ${activeQs(e).length}개` }), done ? h('span', { text: `정복 ${done}` }) : null, sc !== null ? h('span', { text: `최근 ${sc}%` }) : null, wr ? st('xcircle', `오답 ${wr}`) : null]
  });
}
function subjectThread(s) {
  const acc = subjAcc(s);
  const rows = [post({
    avatar: av(s.hue, sicon(s)), title: s.name, href: '#/s/' + s.id, style: palStyle(s.hue),
    more: btn => openMenu(btn, subjectMenu(s)), moreLabel: `${s.name} 메뉴`,
    meta: [h('span', { text: `시험 ${s.exams.length}개 · 남은 문제 ${subjQ(s)}개` }), acc !== null ? st('checkcircle', `정답률 ${acc}%`) : null]
  })];
  s.exams.slice(0, 2).forEach(e => rows.push(examReply(s, e)));
  if (s.exams.length > 2) rows.push(post({ sm: true, muted: true, avatar: h('span', { class: 'av ghost' }, icon('more')), title: `시험 ${s.exams.length - 2}개 더 보기`, href: '#/s/' + s.id }));
  if (!s.exams.length) rows.push(post({ sm: true, muted: true, avatar: h('span', { class: 'av ghost' }, icon('plus')), title: '첫 시험·단원 만들기', onClick: () => examSheet(s) }));
  return h('section', { class: 'card subj lit', style: palStyle(s.hue), 'data-key': s.id }, thread(rows));
}

/* the most useful next step, as one big card */
function homeHero() {
  const total = db.subjects.reduce((n, s) => n + s.exams.reduce((m, e) => m + e.questions.length, 0), 0);
  if (!total) {
    return h('section', { class: 'card tinted hero', 'data-key': 'hero' },
      h('div', { class: 'hero-top' }, h('span', { class: 'av' }, icon('sparkle')), h('div', null, h('span', { class: 'eyebrow', text: '시작하기' }), h('h2', { text: '책 사진으로 문제를 만들어요' }), h('p', { text: 'Claude 앱에서 사진을 올리면 150개가 들어와요' }))),
      h('a', { class: 'btn prim lit', href: '#/make' }, icon('sparkle'), '문제 만들기'));
  }
  let pick = null;
  for (const x of allAttempts()) if (activeQs(x.e).length) { pick = { s: x.s, e: x.e }; break; }
  if (!pick) for (const s of db.subjects) { const e = s.exams.find(x => activeQs(x).length); if (e) { pick = { s, e }; break; } }
  if (!pick) return null;
  const { s, e } = pick, act = activeQs(e).length, dn = doneCount(e), pct = Math.round((dn / e.questions.length) * 100);
  return h('section', { class: 'card tinted hero', style: palStyle(s.hue), 'data-key': 'hero' },
    h('div', { class: 'hero-top' }, av(s.hue, sicon(s)), h('div', null,
      h('span', { class: 'eyebrow', text: allAttempts().length ? '이어서 공부하기' : '첫 연습을 시작해 봐요' }),
      h('h2', { text: e.name }), h('p', { text: `${s.name} · 남은 ${unitOf(e)} ${act}개 · 정복 ${pct}%` }))),
    barEl(pct),
    h('a', { class: 'btn prim lit', href: `#/p/${e.id}/all` }, icon('play'), `${Math.min(db.size, act)}${unitOf(e) === '단어' ? '개' : '문제'} 연습`));
}

function viewHome() {
  const subs = db.subjects;
  const body = h('div', { class: 'feed' });
  const hero = homeHero();
  if (hero) body.append(hero);
  if (!subs.length) {
    body.append(emptyState('stack', '첫 과목을 만들어 보세요', '과목을 만들고 시험·단원을 추가한 뒤, Claude 앱에서 사진을 올리면 문제가 채워져요.',
      h('div', { class: 'pills' }, PRESETS.map(([n, ic, hue]) => h('button', {
        type: 'button', class: 'btn glass lit',
        onclick: () => { db.subjects.push({ id: uid(), name: n, icon: ic, hue, exams: [] }); save(); route(true); }
      }, icon(ic), n)))));
  } else subs.forEach(s => body.append(subjectThread(s)));
  const line = subs.length
    ? [chip('stack', `과목 ${subs.length}개`), chip('doc', `남은 문제 ${subs.reduce((n, s) => n + subjQ(s), 0)}개`)]
    : [h('span', { text: '공부할 과목을 만들어 보세요' })];
  screen({
    title: '과목', hue: 215, tab: 'home', body,
    head: h('header', { class: 'page-head' }, h('div', { class: 'ph-text' }, h('h1', { text: '과목' }), h('div', { class: 'chips' }, line))),
    trail: [{ icon: 'plus', label: '과목 추가', onClick: () => subjectSheet() }],
    fab: { icon: 'sparkle', label: '문제 만들기', onClick: () => { location.hash = '#/make'; } }
  });
}

function viewWrong() {
  const list = allWrong();
  const body = h('div', { class: 'stack' });
  if (!list.length) {
    body.append(emptyState('checkcircle', '오답이 없어요', '문제를 풀다 틀리면 여기에 모여요.'));
  } else {
    const n = h('b', { text: '0' });
    countUp(n, list.length);
    body.append(h('section', { class: 'card tinted callout', 'data-key': 'callout' },
      h('div', null, n, h('span', { text: '복습할 오답' })),
      h('a', { class: 'btn prim lit', href: '#/p/_/wrong' }, icon('play'), '복습 시작')));
    const feed = h('div', { class: 'feed' });
    for (const s of db.subjects) {
      const mine = list.filter(x => x.s === s);
      if (!mine.length) continue;
      const rows = [post({ avatar: av(s.hue, sicon(s)), title: s.name, href: '#/s/' + s.id, style: palStyle(s.hue), meta: [h('span', { text: `오답 ${mine.length}개` })] })];
      mine.forEach(({ e, q }) => rows.push(post({
        sm: true, clamp: true, avatar: qAvatar(q), title: rowTitle(q), style: palStyle(s.hue), onClick: () => questionSheet(e, q),
        meta: [h('span', { text: e.name }), h('span', { text: topicOf(q) }), q.miss ? h('span', { text: `틀림 ${q.miss}` }) : null]
      })));
      feed.append(h('section', { class: 'card subj', style: palStyle(s.hue), 'data-key': 'w' + s.id }, thread(rows)));
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
  return h('a', { class: 'row lit', href: '#/e/' + e.id, style: palStyle(s.hue) },
    ringEl(pct, { size: 42, w: 14, sm: true, label: `${pct}%` }),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: e.name }), h('span', { class: 'row-sub', text: `${s.name} · ${a.mode === 'wrong' ? '오답만' : '연습'} · ${timeLabel(a.at)}${a.retired ? ` · 정복 ${a.retired}` : ''}` })),
      h('span', { class: 'score', text: `${a.score}/${a.total}` }), dim('chev')));
}

function viewHistory() {
  const all = allAttempts();
  const body = h('div', { class: 'stack' });
  if (!all.length) {
    body.append(emptyState('clock', '아직 기록이 없어요', '연습을 하면 점수가 여기에 쌓여요.'));
  } else {
    const avg = Math.round(all.reduce((n, x) => n + (x.a.score / x.a.total) * 100, 0) / all.length);
    body.append(h('section', { class: 'card pad', style: 'padding:14px' }, h('div', { class: 'facts' },
      statBox(all.length, '연습 횟수', { count: true }), statBox(avg, '평균 점수', { count: true, suffix: '%' }), statBox(allWrong().length, '남은 오답', { count: true }))));
    const days = [];
    for (const x of all) {
      const l = dayLabel(x.a.at);
      if (!days.length || days[days.length - 1].l !== l) days.push({ l, items: [] });
      days[days.length - 1].items.push(x);
    }
    for (const d of days) body.append(h('div', null, h('div', { class: 'sec', text: d.l }), h('div', { class: 'card rows', style: 'margin-top:0' }, d.items.map(attemptRow))));
  }
  screen({
    title: '기록', hue: 180, tab: 'history', body,
    head: pageHead({ title: '기록', lines: [[h('span', { text: all.length ? `최근 ${all.length}번 연습했어요` : '아직 연습한 기록이 없어요' })]] })
  });
}

function srow({ ic, title, sub, subCls, trailing, danger, onClick, href }) {
  const inner = [
    h('span', { class: 'tile' }, icon(ic)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: title }), sub != null ? h('span', { class: 'row-sub ' + (subCls || ''), text: sub }) : null),
    trailing || null
  ];
  const cls = 'srow lit' + (danger ? ' danger' : '');
  return href ? h('a', { class: cls, href }, inner) : onClick ? h('button', { type: 'button', class: cls, onclick: onClick }, inner) : h('div', { class: 'srow' + (danger ? ' danger' : '') }, inner);
}

function viewSettings() {
  const size = seg(SIZES.map(n => ({ value: n, label: String(n), aria: `${n}문제` })), db.size, v => { db.size = v; save(); }, { label: '한 번에 푸는 문제 수' });
  const body = h('div', { class: 'stack' },
    h('div', null, h('div', { class: 'sec', text: 'Claude 연결' }), h('div', { class: 'card group' },
      srow({ ic: 'sparkle', title: '문제 만들기', sub: '책 사진을 Claude 앱에서 올려요', href: '#/make', trailing: dim('chev') }),
      srow({
        ic: 'refresh', title: '새 문제 확인', sub: syncText(), subCls: 'js-sync-text',
        trailing: h('button', { type: 'button', class: 'btn sm outline js-sync lit', onclick: () => syncLibrary(true) }, icon('refresh'), '지금')
      }),
      h('div', { class: 'note' }, '앱을 열 때마다 자동으로 확인해요. 문제는 폰의 Claude 앱에서 만들어져요. 이 앱은 Claude 계정 정보나 API 키를 받지 않아요.'))),
    h('div', null, h('div', { class: 'sec', text: '연습' }), h('div', { class: 'card group' },
      h('div', { class: 'setting' },
        h('div', { class: 'setting-top' }, h('span', { class: 'tile' }, icon('list')), h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: '한 번에 푸는 문제' }), h('span', { class: 'row-sub', text: '연습을 시작할 때 고르는 개수예요' }))),
        size.el),
      h('div', { class: 'note' }, '많이 틀린 유형은 더 자주, 잘 맞히는 유형은 덜 나와요. 같은 문제를 ', code(`${RETIRE_AT}번`), ' 풀고 마지막에 맞히면 정복으로 빠져요. 정복한 문제가 늘면 새 문제를 받을 때라고 알려줘요.'))),
    h('div', null, h('div', { class: 'sec', text: '앱' }), h('div', { class: 'card group' },
      srow({ ic: 'share', title: '홈 화면에 추가', sub: standalone() ? '홈 화면 앱으로 실행 중이에요' : 'Safari 공유 버튼, 홈 화면에 추가' }),
      srow({
        ic: 'refresh', title: '업데이트', sub: `버전 ${appVersion || '확인 중'} · 열 때마다 자동 업데이트`, subCls: 'js-version',
        trailing: h('button', { type: 'button', class: 'btn sm outline lit', onclick: () => checkUpdate(true) }, '확인')
      }))),
    h('div', null, h('div', { class: 'sec', text: '데이터' }), h('div', { class: 'card group' },
      srow({
        ic: 'retry', title: '학습 기록 지우기', sub: '점수, 오답, 정복 표시만 지워요', danger: true,
        onClick: () => confirmSheet('학습 기록 지우기', '푼 기록, 오답, 정복 표시가 모두 지워져요. 문제는 그대로 남아요.', '지우기', () => {
          db.subjects.forEach(s => s.exams.forEach(resetExam));
          route(true); toast('학습 기록을 지웠어요', { icon: 'retry' });
        })
      }),
      srow({
        ic: 'trash', title: '이 기기의 모든 데이터 삭제', sub: '과목, 문제, 기록이 모두 지워져요', danger: true,
        onClick: () => confirmSheet('모든 데이터 삭제', '이 기기에 저장된 과목, 문제, 기록이 모두 지워져요. Claude가 보낸 문제는 다음 확인 때 다시 들어와요.', '삭제', () => {
          db = freshDb(); save(); location.hash = '#/'; route(true); syncLibrary();
        })
      }))));
  screen({
    title: '설정', hue: 215, tab: 'settings', body,
    head: pageHead({ title: '설정', lines: [[h('span', { text: standalone() ? '홈 화면 앱' : '브라우저' })]] })
  });
}

/* =====================================================================
   make: ask the Claude app for questions from book photos
   ===================================================================== */
let makeClock = null;
function viewMake(sid, eid, mode) {
  const s0 = sid ? findSubject(sid) : null, e0 = s0 && eid ? s0.exams.find(x => x.id === eid) : null;
  const f = makeForm;
  if (sid) { f.subject = s0 ? s0.name : f.subject; f.exam = e0 ? e0.name : ''; }
  f.refresh = mode === 'refresh' && !!e0;
  if (!f.kind) f.kind = db.make.kind;
  if (!f.count) f.count = db.make.count;
  const subjectIn = textField('과목', f.subject, '예: 수학, 영어 단어', 24);
  const examIn = textField('시험·단원', f.exam, '예: 3단원 함수, Day 12', 30);
  subjectIn.classList.add('field'); examIn.classList.add('field');
  const msg = h('div', { class: 'msg', 'aria-live': 'polite' });
  const go = h('a', { class: 'pbtn lit', target: '_blank', rel: 'noopener' }, icon('sparkle'), 'Claude 앱에서 사진 올리기');
  const scheme = h('a', { class: 'btn outline lit' }, icon('terminal'), 'claude:// 로 열기');
  const subjectQuick = h('div', { class: 'quick' }), examQuick = h('div', { class: 'quick' });
  const kind = seg(Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })), f.kind, v => { f.kind = v; db.make.kind = v; save(); paint(); }, { label: '문제 종류' });
  const count = seg(MAKE_COUNTS.map(n => ({ value: n, label: String(n), aria: `${n}개` })), f.count, v => { f.count = v; db.make.count = v; save(); paint(); }, { label: '문제 개수' });
  function paint() {
    f.subject = subjectIn.value.trim(); f.exam = examIn.value.trim();
    const m = makeMessage(f);
    msg.textContent = m;
    go.href = claudeUrl(m); scheme.href = claudeScheme(m);
    subjectQuick.replaceChildren(...db.subjects.map(s => h('button', { type: 'button', 'aria-pressed': String(normName(s.name) === normName(f.subject)), onclick: () => { subjectIn.value = s.name; examIn.value = ''; paint(); } }, s.name)));
    const cur = db.subjects.find(s => normName(s.name) === normName(f.subject));
    examQuick.replaceChildren(...(cur ? cur.exams : []).map(e => h('button', { type: 'button', 'aria-pressed': String(normName(e.name) === normName(f.exam)), onclick: () => { examIn.value = e.name; paint(); } }, e.name)));
    examQuick.hidden = !examQuick.children.length; subjectQuick.hidden = !subjectQuick.children.length;
  }
  subjectIn.addEventListener('input', paint); examIn.addEventListener('input', paint);
  const onGo = () => {
    paint();
    copyText(makeMessage(f));
    startWaiting({ subject: f.subject, exam: f.exam });
    toast('메시지를 복사했어요. Claude 앱에서 사진을 붙여 보내요', { icon: 'sparkle' });
    setTimeout(() => { if (/^#\/make/.test(location.hash)) requestRender(); }, 600);
  };
  go.addEventListener('click', onGo); scheme.addEventListener('click', onGo);
  const copyBtn = h('button', { type: 'button', class: 'btn glass lit', onclick: async () => { paint(); toast((await copyText(makeMessage(f))) ? '메시지를 복사했어요' : '복사하지 못했어요', { icon: 'checkcircle' }); } }, icon('doc'), '메시지 복사');

  const wait = db.wait;
  const waitCard = wait ? h('section', { class: 'card tinted waitcard', 'data-key': 'wait' },
    h('span', { class: 'pulse-orb' }, icon('sparkle')),
    h('div', null, h('b', { text: 'Claude가 문제를 만드는 중이에요' }), h('span', null, '보낸 지 ', h('span', { class: 'js-wait-time', text: mmss(Date.now() - wait.since) }), ' · 끝나면 자동으로 들어와요'),
      h('button', { type: 'button', class: 'linkish', onclick: () => { stopWaiting(); route(true); }, text: '그만 기다리기' }))) : null;

  const last = db.sync.last;
  const body = h('div', { class: 'stack' },
    waitCard,
    h('section', { class: 'card formcard', 'data-key': 'form' },
      f.refresh ? h('div', { class: 'chips' }, chip('refresh', '새 문제 받기 · 이미 있는 문제와 겹치지 않게')) : null,
      h('div', { class: 'fl' }, h('label', { text: '과목' }), subjectIn, subjectQuick),
      h('div', { class: 'fl' }, h('label', { text: '시험·단원' }), examIn, examQuick),
      h('div', { class: 'fl' }, h('div', { class: 'lab', text: '문제 종류' }), kind.el),
      h('div', { class: 'fl' }, h('div', { class: 'lab', text: '개수' }), count.el),
      h('div', { class: 'fl' }, h('div', { class: 'lab', text: 'Claude에게 보낼 메시지' }), msg)),
    h('div', { class: 'cta' }, go, h('div', { class: 'alt' }, copyBtn, scheme),
      h('button', { type: 'button', class: 'linkish', onclick: () => { db.wait ? stopWaiting() : null; syncLibrary(true); }, text: '이미 보냈다면 지금 확인하기' })),
    h('div', null, h('div', { class: 'sec', text: '이렇게 해요' }), h('section', { class: 'card steps' },
      h('div', { class: 'step' }, h('span', { class: 'num', text: '1' }), h('div', null, h('b', { text: '처음 한 번만. ' }), 'Claude 앱을 설치하고 Claude Pro 계정으로 로그인해요.')),
      h('div', { class: 'step' }, h('span', { class: 'num', text: '2' }), h('div', null, h('b', { text: '처음 한 번만. ' }), 'Claude 앱의 Code 화면에서 GitHub를 연결하고 저장소 ', code(REPO), ' 를 허용해요.')),
      h('div', { class: 'step' }, h('span', { class: 'num', text: '3' }), h('div', null, h('b', { text: '만들 때마다. ' }), '위 파란 버튼을 누르면 저장소가 골라진 채로 메시지가 채워져서 Claude 앱이 열려요. + 버튼으로 책 사진을 고르고 보내요.')),
      h('div', { class: 'step' }, h('span', { class: 'num', text: '4' }), h('div', null, h('b', { text: '끝나면. ' }), '이 앱으로 돌아와요. 새 문제가 알아서 들어와요.')))),
    h('div', null, h('div', { class: 'sec', text: '도착 현황' }), h('div', { class: 'card group' },
      srow({ ic: 'sparkle', title: '마지막으로 받은 문제', sub: last ? `${ago(last.at)} · ${last.subject} ${last.exam}${last.many > 1 ? ` 외 ${last.many - 1}개` : ''} · ${last.n}개` : '아직 받은 문제가 없어요' }),
      srow({
        ic: 'refresh', title: '새 문제 확인', sub: syncText(), subCls: 'js-sync-text',
        trailing: h('button', { type: 'button', class: 'btn sm outline js-sync lit', onclick: () => syncLibrary(true) }, icon('refresh'), '지금')
      }),
      h('div', { class: 'note' }, '이 앱은 Claude 계정 정보나 API 키를 받지 않아요. 사진은 Claude 앱 안에서만 오가고, 이 앱에는 만들어진 문제만 들어와요.'))));
  paint();
  screen({
    title: '문제 만들기', hue: db.subjects.find(s => s.id === sid) ? db.subjects.find(s => s.id === sid).hue : 215, tab: 'home', detail: true, back: e0 ? '#/e/' + e0.id : s0 ? '#/s/' + s0.id : '#/', body,
    head: pageHead({ title: f.refresh ? '새 문제 받기' : '문제 만들기', lines: [[h('span', { text: '책 사진은 Claude 앱에서 올려요. 만들어진 문제는 여기로 자동으로 들어와요.' })]] })
  });
  clearInterval(makeClock);
  makeClock = setInterval(() => {
    const t = document.querySelector('.js-wait-time');
    if (!t || !db.wait) return;
    t.textContent = mmss(Date.now() - db.wait.since);
  }, 1000);
}

/* =====================================================================
   subject / exam
   ===================================================================== */
function viewSubject(s) {
  const acc = subjAcc(s);
  const body = h('div', null);
  if (!s.exams.length) {
    body.append(emptyState('doc', '시험·단원을 만들어요', '예: 중간고사, 3단원, Day 12. 만든 뒤 문제 만들기에서 Claude 앱으로 사진을 올리면 채워져요.'));
  } else {
    body.append(h('div', { class: 'card rows', style: palStyle(s.hue) }, s.exams.map(e => {
      const sc = lastScore(e), wr = wrongCount(e), act = activeQs(e).length, dn = doneCount(e);
      const sub = !e.questions.length ? 'Claude 앱에서 사진으로 채워요' : `${unitOf(e)} ${act}개${dn ? ` · 정복 ${dn}` : ''}${sc !== null ? ` · 최근 ${sc}%` : ''}`;
      return h('a', { class: 'row lit', href: '#/e/' + e.id, 'data-key': e.id },
        av(s.hue, 'doc', 'soft'),
        h('span', { class: 'row-body' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: e.name }), h('span', { class: 'row-sub', text: sub })),
          e.lib ? h('span', { class: 'badge plain' }, icon('sparkle'), 'Claude') : null,
          wr ? h('span', { class: 'badge' }, icon('xcircle'), String(wr)) : null, dim('chev')));
    })));
  }
  screen({
    title: s.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/', body,
    head: pageHead({
      title: s.name, avatar: av(s.hue, sicon(s)),
      lines: [[chip('doc', `시험 ${s.exams.length}개`), chip('stack', `남은 문제 ${subjQ(s)}개`), acc !== null ? chip('checkcircle', `정답률 ${acc}%`) : null].filter(Boolean)]
    }),
    trail: [{ icon: 'more', label: '과목 메뉴', onClick: btn => openMenu(btn, subjectMenu(s)) }],
    dock: [h('button', { type: 'button', class: 'gbtn glass lit', onclick: () => examSheet(s) }, icon('plus'), '시험·단원'), h('a', { class: 'pbtn lit', href: '#/make/' + s.id }, icon('sparkle'), '문제 만들기')]
  });
}

const ui = { examTab: 'q', examFor: null, showDone: false };

function topicRows(s, e) {
  const ts = topicStats(e.questions), wsum = {};
  let total = 0;
  for (const q of activeQs(e)) { const v = weightOf(q, ts), k = topicOf(q); wsum[k] = (wsum[k] || 0) + v; total += v; }
  const list = Object.entries(ts).map(([k, t]) => ({ k, ...t, err: t.a ? t.w / t.a : null, share: total ? (wsum[k] || 0) / total : 0 }));
  list.sort((x, y) => (y.err === null ? -1 : y.err) - (x.err === null ? -1 : x.err) || y.n - x.n);
  return list.map(t => {
    const weak = t.a >= 3 && t.err >= 0.4;
    const pct = Math.round(t.share * 100);
    return h('div', { class: 'row static' },
      av(s.hue, 'chart', 'soft'),
      h('span', { class: 'row-body' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title', text: t.k }),
          h('span', { class: 'row-sub', text: `${t.n}개 남음${t.done ? ` · 정복 ${t.done}` : ''}${t.a ? ` · 정답률 ${Math.round((1 - t.err) * 100)}%` : ' · 아직 안 풀었어요'}` }),
          barEl(t.n ? Math.max(3, pct) : 0)),
        weak ? h('span', { class: 'badge' }, '약해요') : null,
        h('span', { class: 'score', 'aria-label': `출제 비중 ${pct}%`, text: t.n ? `${pct}%` : '-' })));
  });
}

function viewExam({ s, e }) {
  if (ui.examFor !== e.id) { ui.examFor = e.id; ui.examTab = 'q'; ui.showDone = false; }
  const total = e.questions.length, act = activeQs(e), dn = total - act.length, wr = wrongCount(e), acc = examAcc(e), unit = unitOf(e);
  const masteredPct = total ? Math.round((dn / total) * 100) : 0;
  const topicsN = Object.keys(topicStats(e.questions)).length;
  const hero = h('section', { class: 'card exam-hero', style: palStyle(s.hue), 'data-key': 'hero' },
    h('div', { class: 'eh-top' },
      ringEl(masteredPct, { size: 96, w: 13, label: `정복 ${masteredPct}%`, count: true }),
      h('div', null,
        h('span', { class: 'big', text: total ? `정복 ${dn} / ${total}` : '문제를 기다리고 있어요' }),
        h('div', { class: 'chips' }, h('a', { href: '#/s/' + s.id, class: 'chip' }, icon(sicon(s)), s.name), e.lib ? chip('sparkle', 'Claude') : null))),
    h('div', { class: 'facts' }, statBox(act.length, `남은 ${unit}`, { count: true }), statBox(dn, '정복', { count: true }), statBox(acc === null ? '-' : acc, '정답률', { count: acc !== null, suffix: acc === null ? '' : '%' })));

  const tabOrder = ['q', 't', 'h'];
  const cmd = () => h('div', { class: 'pills' }, h('a', { class: 'btn prim lit', href: `#/make/${s.id}/${e.id}` }, icon('sparkle'), '문제 만들기'));
  const pane = () => {
    const out = h('div', { class: 'tabpane' });
    if (ui.examTab === 'q') {
      if (!total) {
        out.append(emptyState('doc', `${unit}가 아직 없어요`, '문제는 직접 쓰지 않아요. Claude 앱에서 책 사진을 올리면 150개가 만들어져요.', cmd()));
      } else {
        const need = total >= 20 && act.length <= Math.max(10, Math.round(total * 0.25));
        if (!act.length) {
          out.append(emptyState('checkcircle', '전부 정복했어요', `${total}개를 모두 6번씩 풀었어요. 새 ${unit}를 받거나, 처음부터 다시 풀 수 있어요.`,
            h('div', { class: 'pills' },
              h('a', { class: 'btn prim lit', href: `#/make/${s.id}/${e.id}/refresh` }, icon('sparkle'), '새 문제 받기'),
              h('button', { type: 'button', class: 'btn glass lit', onclick: () => { resetExam(e); route(true); } }, icon('retry'), '처음부터 다시'))));
        } else if (need) {
          out.append(h('section', { class: 'card tinted callout col', style: 'margin-bottom:16px', 'data-key': 'need' },
            h('div', null, h('b', { text: `정복 ${dn}/${total}` }), h('span', { text: `남은 ${unit}가 적어요. 새 ${unit}로 바꿀 때예요.` })),
            h('a', { class: 'btn prim lit', href: `#/make/${s.id}/${e.id}/refresh` }, icon('sparkle'), '새 문제 받기')));
        }
        const long = act.length > 14;
        if (act.length) out.append(h('div', { class: 'card rows' + (long ? ' lite long' : ''), style: palStyle(s.hue) + ';margin-top:0' }, act.map(q => qRow(e, q))));
        if (dn) {
          out.append(h('button', { type: 'button', class: 'btn glass togg lit', onclick: () => { ui.showDone = !ui.showDone; route(true); } }, icon(ui.showDone ? 'close' : 'check'), ui.showDone ? '정복한 것 숨기기' : `정복한 ${unit} ${dn}개 보기`));
          if (ui.showDone) out.append(h('div', { class: 'card lite rows done long', 'data-key': 'done-rows', style: palStyle(s.hue) }, e.questions.filter(q => q.done).map(q => qRow(e, q))));
        }
      }
    } else if (ui.examTab === 't') {
      if (!total) out.append(emptyState('chart', '유형이 아직 없어요', '문제가 들어오면 유형별로 모아 보여줘요.', cmd()));
      else out.append(h('p', { class: 'note flat' }, '많이 틀린 유형이 더 자주 나와요. 오른쪽 숫자는 다음 연습에서 그 유형이 나올 비중이에요.'), h('div', { class: 'card rows' }, topicRows(s, e)));
    } else if (!e.attempts.length) {
      out.append(emptyState('clock', '아직 연습한 기록이 없어요', '시작하기를 눌러 풀어 보세요.'));
    } else {
      out.append(h('div', { class: 'card rows' }, e.attempts.slice().reverse().map(a => attemptRow({ s, e, a }))));
    }
    return out;
  };
  const host = h('div', { class: 'panehost' }, pane());
  const tabs = seg([['q', `${unit} ${act.length}`], ['t', `유형 ${topicsN}`], ['h', `기록 ${e.attempts.length}`]].map(([value, label]) => ({ value, label })), ui.examTab, v => {
    const dirX = tabOrder.indexOf(v) > tabOrder.indexOf(ui.examTab) ? 1 : -1;
    ui.examTab = v;
    const old = host.querySelector('.tabpane:not(.leaving)'), neu = pane();
    if (old) {
      old.classList.add('leaving'); old.setAttribute('aria-hidden', 'true');
      const drop = () => old.remove();
      anim(old, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dirX * 28}px)` }], { dur: 260, easing: 'ease-in', fill: 'forwards' }).finished.then(drop, drop);
      setTimeout(drop, 600);
    }
    host.append(neu);
    anim(neu, [{ opacity: 0, transform: `translateX(${dirX * 36}px)` }, { opacity: 1, transform: 'none' }], { dur: 600, easing: 'spring-soft' });
  }, { cls: 'glass utabs', role: 'tablist', attr: 'aria-selected', itemRole: 'tab', label: '시험 보기' });

  const n = Math.min(db.size, act.length);
  const dock = act.length ? [
    h('a', wr ? { class: 'gbtn glass lit', href: `#/p/${e.id}/wrong` } : { class: 'gbtn glass', 'aria-disabled': 'true' }, icon('bookmark'), `오답 ${wr}`),
    h('a', { class: 'pbtn lit', href: `#/p/${e.id}/all` }, icon('play'), `${n}${unit === '단어' ? '개' : '문제'} 연습`)
  ] : [];
  screen({
    title: e.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/s/' + s.id, dock,
    head: pageHead({ title: e.name, lines: [] }),
    body: h('div', null, hero, tabs.el, host),
    trail: [{ icon: 'more', label: '시험 메뉴', onClick: btn => openMenu(btn, examMenu(s, e)) }]
  });
}
function qRow(e, q) {
  return h('button', { type: 'button', class: 'row lit' + (q.done ? ' dn' : ''), onclick: () => questionSheet(e, q) },
    qAvatar(q, 36),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title clamp2', text: rowTitle(q) }), h('span', { class: 'row-sub', text: rowSub(q) })),
      q.done ? dim('check') : null, dim('chev')));
}

/* =====================================================================
   play: the question is a glass card, the answer unfolds under it
   ===================================================================== */
let play = null, pv = null;

function startPlay(eid, mode) {
  let pool, title, back, hue = 215, name = '', ic = 'book';
  if (eid === '_') {
    pool = allWrong(); title = '오답 복습'; back = '#/wrong'; hue = 340; name = '오답노트'; ic = 'bookmark';
  } else {
    const f = findExam(eid);
    if (!f) return false;
    pool = activeQs(f.e).map(q => ({ q, e: f.e, s: f.s }));
    if (mode === 'wrong') pool = pool.filter(x => x.q.last === false);
    title = f.e.name; back = '#/e/' + eid; hue = f.s.hue; name = f.s.name; ic = sicon(f.s);
  }
  if (!pool.length) { toast('풀 문제가 없어요', { icon: 'info' }); location.replace(eid === '_' ? '#/wrong' : '#/e/' + eid); return false; }
  const items = pickSession(pool, db.size || 20);
  play = { eid, mode, items, drills: items.map(makeDrill), i: 0, res: [], answered: false, picked: null, ok: null, done: false, retired: 0, title, back, hue, name, ic };
  return true;
}
function restart(mode) {
  const eid = play.eid;
  play = null;
  const t = `#/p/${eid}/${mode}`;
  if (location.hash === t) route(); else location.hash = t;
}

function questionCard(p) {
  const it = p.items[p.i], d = p.drills[p.i], q = it.q;
  const where = p.eid === '_' ? `${it.s.name} · ${it.e.name}` : p.name;
  let choices = null, input = null, wrap = null;
  if (d.kind === 'mc') {
    choices = h('div', { class: 'choices', role: 'group', 'aria-label': '보기' }, d.choices.map((c, i) =>
      h('button', { type: 'button', class: 'choice lit', onclick: () => answer(i) }, h('span', { class: 'cn', text: String(i + 1) }), h('span', { class: 'ct', text: c }))));
  } else if (d.kind === 'short') {
    input = h('input', {
      class: 'ans-input', type: 'text', 'aria-label': '정답 입력', placeholder: '정답을 입력해요',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done'
    });
    wrap = h('div', { class: 'ans-wrap' }, input);
  }
  const card = h('section', { class: 'glass qcard', style: palStyle(p.hue) },
    h('div', { class: 'qhead' }, av(p.hue, p.ic), h('span', { class: 'where', text: where }), h('span', { class: 'tag', text: d.label }), h('span', { class: 'tag soft', text: topicOf(q) })),
    h('p', { class: 'q-text' + (d.big ? ' term' : ''), text: d.prompt }),
    d.sub ? h('p', { class: 'q-sub', text: d.sub }) : null,
    d.extra ? h('p', { class: 'q-sub ex', text: d.extra }) : null,
    choices || wrap);
  return { card, choices, input, wrap, d, q };
}

function feedbackPanel(p, view) {
  const { d, q } = view, ok = p.ok, lines = [];
  if (d.kind === 'ox') lines.push(h('div', { class: 'tags' }, h('span', { class: 'tag', text: `내 답 ${p.picked ? 'O' : 'X'}` }), h('span', { class: 'tag', text: `정답 ${d.correct ? 'O' : 'X'}` })));
  else if (!ok) lines.push(h('p', { class: 'ansline' }, h('b', { text: '정답' }), h('span', { text: drillAnswer(d) })));
  if (d.kind === 'short' && !ok) lines.unshift(h('p', { class: 'ansline' }, h('b', { text: '내 답' }), h('span', { text: String(p.picked || '(비움)') })));
  if (q.type === 'word') lines.push(h('p', { class: 'ansline' }, h('b', { text: '뜻' }), h('span', { text: `${q.term} = ${q.meaning}` })));
  if (q.type === 'word' && q.ex) lines.push(h('p', { class: 'muted' }, q.ex));
  if (q.exp) lines.push(h('p', { text: q.exp }));
  const wasRetired = q.done && seenOf(q) >= RETIRE_AT;
  return h('div', { class: 'glass feedback ' + (ok ? 'ok' : 'no'), 'aria-live': 'polite' },
    h('div', { class: 'fb-head' }, h('span', { class: 'av ' + (ok ? 'good' : 'bad') }, icon(ok ? 'check' : 'close', 'draw')), h('b', { text: ok ? (wasRetired ? '정답이에요 · 정복!' : '정답이에요') : '오답이에요' })),
    ...lines,
    !ok && d.kind === 'short' ? h('button', { type: 'button', class: 'btn sm outline fix lit', onclick: markCorrect }, icon('check'), '맞게 처리') : null);
}

function dockFor(p, view) {
  const total = p.items.length, d = view.d;
  if (p.answered) return [h('button', { id: 'next', type: 'button', class: 'pbtn lit', onclick: next }, p.i + 1 >= total ? '결과 보기' : '다음', icon('chev'))];
  if (d.kind === 'ox') return [oxBtn(true), oxBtn(false)];
  if (d.kind === 'short') {
    const input = view.input;
    const go = h('button', { type: 'button', class: 'pbtn lit', 'aria-disabled': 'true', onclick: () => submit() }, '확인');
    const submit = () => { const v = input.value.trim(); if (v) answer(v); };
    input.addEventListener('input', () => go.setAttribute('aria-disabled', String(!input.value.trim())));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    return [h('button', { type: 'button', class: 'gbtn glass narrow lit', onclick: () => answer('') }, '모르겠어요'), go];
  }
  return [];
}
const oxBtn = val => h('button', { type: 'button', class: 'glass oxbtn lit', 'data-v': String(val), 'aria-label': val ? 'O 맞다' : 'X 틀리다', onclick: () => answer(val) },
  h('span', { class: 'g', 'aria-hidden': 'true', text: val ? 'O' : 'X' }), h('span', { 'aria-hidden': 'true', text: val ? '맞다' : '틀리다' }));

/* build the play screen from the current state (also used when the route is re-entered) */
function mountPlay() {
  const p = play;
  if (p.done) return mountResult();
  const view = questionCard(p);
  const total = p.items.length;
  const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': '진행도', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': p.i + (p.answered ? 1 : 0) }, h('span', { style: `--w:${((p.i + (p.answered ? 1 : 0)) / total) * 100}%` }));
  const wrap = h('div', { class: 'qwrap' }, view.card);
  pv = { view, wrap, progress };
  if (p.answered) showAnswered(false);
  screen({ title: p.title, inline: `${p.i + 1} / ${total}`, close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body: h('div', null, progress, wrap), dock: dockFor(p, view) });
  if (p.answered) requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus({ preventScroll: true }); });
  else if (view.input) view.input.focus({ preventScroll: true });   // synchronous, so it is still inside the tap that opened it
  if (!p.answered) enterChoices(view);
}
function enterChoices(view) {
  if (view.choices) [...view.choices.children].forEach((c, i) => rise(c, { y: 14, delay: 260 + i * 60, dur: 640 }));
  if (view.wrap) rise(view.wrap, { y: 14, delay: 280, dur: 640 });
}
function setProgress(p) {
  const done = p.i + (p.answered ? 1 : 0);
  pv.progress.setAttribute('aria-valuenow', String(done));
  pv.progress.firstElementChild.style.setProperty('--w', (done / p.items.length) * 100 + '%');
}

/* the answer arrives in place: choices tint, the card reacts, the explanation unfolds, the dock swaps */
function showAnswered(animate) {
  const p = play, { view } = pv, d = view.d, ok = p.ok;
  if (view.choices) [...view.choices.children].forEach((b, i) => {
    const cls = i === d.correct ? 'ok' : i === p.picked ? 'no' : 'off';
    b.classList.add(cls); b.setAttribute('aria-disabled', 'true');
    if (i === d.correct || i === p.picked) b.append(icon(i === d.correct ? 'check' : 'close', animate ? 'draw' : ''));
  });
  if (view.input) { view.input.disabled = true; view.input.value = String(p.picked || ''); view.wrap.classList.add(ok ? 'ok' : 'no'); }
  const fb = feedbackPanel(p, view);
  pv.fb = fb;
  pv.wrap.append(fb);
  if (!animate) return;
  reveal(fb);
  if (ok) {
    const mine = view.choices ? view.choices.children[p.picked] : view.wrap || view.card;
    if (mine) pulse(mine, 1.03);
    if (view.q.done && seenOf(view.q) >= RETIRE_AT) burst(view.card, { n: 22, y: 0.2 });
  } else shake(view.choices ? view.choices.children[p.picked] || view.card : view.wrap || view.card);
  setProgress(p);
  setDock(dockFor(p, view));
  requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus({ preventScroll: true }); });
}

function answer(val) {
  if (!play || play.answered || play.done) return;
  const it = play.items[play.i], d = play.drills[play.i];
  const ok = checkDrill(d, val), was = !!it.q.done;
  play.answered = true; play.picked = val; play.ok = ok;
  recordAnswer(it.q, ok);
  if (!was && it.q.done) play.retired++;
  play.res.push({ it, d, ok, val });
  save();
  showAnswered(true);
}
/* a typed answer that was right but written differently: let the learner say so */
function markCorrect() {
  if (!play || !play.answered || play.ok) return;
  const r = play.res[play.res.length - 1], q = r.it.q;
  q.miss = Math.max(0, (q.miss || 0) - 1);
  q.last = true;
  if (seenOf(q) >= RETIRE_AT && !q.done) { q.done = true; play.retired++; }
  r.ok = true; play.ok = true;
  save();
  const { view } = pv, old = pv.fb;
  view.wrap.classList.remove('no'); view.wrap.classList.add('ok');
  const fb = feedbackPanel(play, view);
  old.replaceWith(fb); pv.fb = fb;
  pop(fb.querySelector('.av'), { from: 0.4 });
  pulse(view.wrap, 1.03);
  if (q.done && seenOf(q) >= RETIRE_AT) burst(view.card, { n: 22, y: 0.2 });
}
function next() {
  if (!play || !play.answered) return;
  if (play.i + 1 >= play.items.length) {
    if (play.eid !== '_') {
      const f = findExam(play.eid);
      f.e.attempts.push({ at: Date.now(), mode: play.mode, score: play.res.filter(r => r.ok).length, total: play.items.length, retired: play.retired });
      f.e.attempts = f.e.attempts.slice(-30);
      save();
    }
    play.done = true;
    navCtx = { dir: 'swap', y: 0 };
    mountResult();
    return;
  }
  play.i++;
  play.answered = false; play.picked = null; play.ok = null;
  const p = play, old = pv, view = questionCard(p);
  /* the old card and its answer slide off together as one ghost */
  const ghost = h('div', { class: 'qghost' }, old.view.card, old.fb || null);
  ghost.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none';
  old.wrap.append(ghost);
  old.wrap.append(view.card);
  pv = { view, wrap: old.wrap, progress: old.progress };
  const drop = () => ghost.remove();
  anim(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(-46px, 0, 0) scale(.97)', offset: 0.6 }, { opacity: 0, transform: 'translate3d(-60px, 0, 0) scale(.96)' }], { dur: 360, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished.then(drop, drop);
  setTimeout(drop, 800);
  anim(view.card, [{ opacity: 0, transform: 'translate3d(70px, 0, 0) scale(.98)' }, { opacity: 1, transform: 'none' }], { dur: 700, easing: 'spring-soft', delay: 110 });
  setProgress(p);
  setToolbarTitle(`${p.i + 1} / ${p.items.length}`);
  setDock(dockFor(p, view));
  if (view.input) view.input.focus({ preventScroll: true });   // inside the tap on "다음", so the keyboard stays up
  enterChoices(view);
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

function mountResult() {
  const p = play;
  const total = p.items.length, score = p.res.filter(r => r.ok).length;
  const pct = Math.round((score / total) * 100), wrong = p.res.filter(r => !r.ok);
  const msg = pct >= 90 ? '훌륭해요' : pct >= 70 ? '좋아요, 조금만 더' : '한 번 더 복습해 봐요';
  const box = h('section', { class: 'card tinted scorebox', style: palStyle(p.hue) },
    ringEl(pct, { size: 168, w: 12, label: `${pct}%`, count: true }), h('p', { class: 'big', text: `${score} / ${total} 정답` }),
    h('p', { class: 'sub' }, msg), p.retired ? h('div', { class: 'chips' }, chip('check', `정복한 문제 ${p.retired}개`)) : null);
  const body = h('div', null, box,
    wrong.length ? h('div', { class: 'sec', text: `틀린 문제 ${wrong.length}개` }) : null,
    wrong.length ? h('div', { class: 'card rows ' + (wrong.length > 14 ? 'lite long' : ''), style: 'margin-top:0' }, wrong.map(({ it, d }) => h('div', { class: 'row' }, qAvatar(it.q, 36),
      h('span', { class: 'row-body' }, h('span', { class: 'row-main' },
        h('span', { class: 'row-title', text: d.prompt }),
        h('span', { class: 'row-sub', text: `정답  ${drillAnswer(d)}` }),
        it.q.exp ? h('span', { class: 'row-sub', text: it.q.exp }) : null))))) : null);
  screen({
    title: '결과', inline: '결과', close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body,
    dock: wrong.length
      ? [h('a', { class: 'gbtn glass narrow lit', href: p.back }, '나가기'), h('button', { type: 'button', class: 'pbtn lit', onclick: () => restart('wrong') }, icon('retry'), '틀린 것만')]
      : [h('button', { type: 'button', class: 'gbtn glass narrow lit', onclick: () => restart(p.mode) }, icon('retry'), '다시'), h('a', { class: 'pbtn lit', href: p.back }, '완료')]
  });
  if (pct >= 90) setTimeout(() => burst(box, { n: 34, y: 0.34 }), 520);
}

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { if (sheets.length) closeSheet(); else closeMenu(); }
  if (!play || play.done || sheets.length || ev.ctrlKey || ev.metaKey || ev.altKey || isTyping()) return;
  const d = play.drills[play.i];
  if (d.kind === 'ox') { if (ev.code === 'KeyO') answer(true); else if (ev.code === 'KeyX') answer(false); }
  else if (d.kind === 'mc' && /^[1-5]$/.test(ev.key) && +ev.key <= d.choices.length) answer(+ev.key - 1);
});

/* =====================================================================
   router
   ===================================================================== */
const DEPTH = { '': 0, wrong: 0, history: 0, settings: 0, s: 1, make: 1, e: 2, p: 3 };
let prevMeta = null;
function metaOf(hash) {
  const [k] = hash.replace(/^#\/?/, '').split('/');
  const depth = DEPTH[k] ?? 0;
  return { hash, depth, tab: depth === 0 ? Math.max(0, TABS.findIndex(t => t[3] === '#/' + (k || ''))) : -1 };
}
function direction(prev, next) {
  if (!prev) return 'init';
  if (next.depth > prev.depth) return 'push';
  if (next.depth < prev.depth) return 'pop';
  if (next.depth === 0 && next.tab !== prev.tab) return next.tab > prev.tab ? 'tab-r' : 'tab-l';
  return 'swap';
}

function route(keepScroll) {
  closeAllSheets();
  closeMenu(true);
  clearInterval(makeClock);
  const hash = location.hash || '#/';
  const [k, a, b, c] = hash.replace(/^#\/?/, '').split('/');
  if (k !== 'p') play = null;
  const meta = metaOf(hash);
  const dir = keepScroll === true ? 'replace' : direction(prevMeta, meta);
  navCtx = { dir, y: dir === 'push' || dir === 'init' ? 0 : (scrollMem[hash] || 0) };
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
    navCtx.y = 0;
    mountPlay();
  } else if (k === 'make') viewMake(a, b, c);
  else if (k === 'wrong') viewWrong();
  else if (k === 'history') viewHistory();
  else if (k === 'settings') viewSettings();
  else viewHome();
  if (keepScroll !== true) { routeKey = hash; prevMeta = meta; }
  flushPending();
}
window.addEventListener('hashchange', () => route());

/* =====================================================================
   start
   ===================================================================== */
buildNav();
initTouchFx();
syncViewport();
route();
syncLibrary();
checkUpdate();
armWait();
try {
  if (sessionStorage.getItem('study.updated')) { sessionStorage.removeItem('study.updated'); toast('새 버전으로 업데이트했어요', { icon: 'sparkle' }); }
} catch { /* private mode */ }
