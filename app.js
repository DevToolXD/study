'use strict';

/* ---------- storage ---------- */
const KEY = 'study.v1';
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.subjects)) return d;
  } catch { /* fall through to empty */ }
  return { subjects: [], shuffle: true };
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { toast('저장하지 못했어요. 브라우저 저장소를 확인해 주세요.'); }
}

/* ---------- dom helpers (user text only ever goes in as text nodes) ---------- */
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

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  book: '<path d="M5 6a2 2 0 012-2h12v13H7a2 2 0 00-2 2V6z"/><path d="M5 19a2 2 0 002 2h12v-4"/>',
  bookmark: '<path d="M7 4h10a1 1 0 011 1v15l-6-4-6 4V5a1 1 0 011-1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  doc: '<path d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v4h4M9.5 12h5M9.5 16h5"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 012.8 0l.2.2a2 2 0 010 2.8L8 19z"/><path d="M14 7l3 3"/>',
  import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7M10 11v5M14 11v5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  retry: '<path d="M19 12a7 7 0 11-2.1-5"/><path d="M19 4v4.5h-4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  shuffle: '<path d="M4 7h3c4 0 5 10 9 10h4M4 17h3c1.6 0 2.7-1.6 3.8-3.2M16 7h4M20 7l-2.2-2.2M20 7l-2.2 2.2M20 17l-2.2-2.2M20 17l-2.2 2.2"/>'
};
function icon(name) {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}

const $view = document.getElementById('view');
const $tb = document.getElementById('tb');
const $dock = document.getElementById('dock');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2200);
}

/* ---------- model ---------- */
/* hue key -> [light end, dark end]. Dark ends keep white icons at 3:1 or better. */
const PALETTE = {
  215: ['#4C9DFF', '#1F5FD6'], 150: ['#43C77B', '#17884A'], 35: ['#FFA24A', '#E2631B'],
  340: ['#FF6FA0', '#D7336F'], 270: ['#9C7BFF', '#6A3FD4'], 180: ['#3CCFD0', '#0E8D9B']
};
const HUES = [215, 150, 35, 340, 270, 180];
const pal = hue => PALETTE[hue] || PALETTE[215];
const palStyle = hue => `--ca:${pal(hue)[0]};--cb:${pal(hue)[1]}`;
const EMOJIS = ['📘', '📕', '📗', '📙', '📖', '🔤', '📐', '🧮', '🔬', '🧪', '🌍', '📜', '💻', '🎵', '🎨', '✏️', '🧠', '⚽'];
const PRESETS = [['국어', '📖', 340], ['영어', '🔤', 215], ['수학', '📐', 270], ['과학', '🔬', 150], ['사회', '🌍', 35], ['역사', '📜', 180]];

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

/* ---------- screen shell: toolbar, large title, content, dock ---------- */
let largeTitle = true;
function onScroll() {
  const y = window.scrollY;
  document.body.classList.toggle('scrolled', y > 2);
  document.body.classList.toggle('title-in', !largeTitle || y > 34);
}
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });

function toolbar(o) {
  const lead = o.back ? h('a', { class: 'glass tb-round', href: o.back, 'aria-label': '뒤로' }, icon('back'))
    : o.close ? h('a', { class: 'glass tb-round', href: o.close, 'aria-label': '닫기' }, icon('close'))
    : h('span');
  const trail = o.trail && o.trail.length
    ? h('div', { class: 'glass ' + (o.trail.length > 1 ? 'tb-group' : 'tb-round') },
      o.trail.map(t => h('button', { class: 'tb-btn', type: 'button', 'aria-label': t.label, onclick: t.onClick }, icon(t.icon))))
    : h('span');
  $tb.replaceChildren(lead, h('div', { class: 'tb-title' }, h('span', { text: o.inline || o.title })), trail);
}

/* o: { title, sub, back, close, trail, body, dock, large, inline, hue } */
function screen(o) {
  const [a, b] = pal(o.hue);
  document.body.style.setProperty('--ca', a);
  document.body.style.setProperty('--cb', b);
  largeTitle = o.large !== false;
  toolbar(o);
  $view.replaceChildren(...[
    largeTitle ? h('header', { class: 'large' }, h('h1', { text: o.title }), o.sub ? h('p', { class: 'sub', text: o.sub }) : null) : null,
    o.body].filter(Boolean));
  $dock.replaceChildren(...(o.dock || []).filter(Boolean));
  document.body.classList.toggle('no-dock', !(o.dock && o.dock.length));
  onScroll();
}

function tabDock(active, fab) {
  const tabs = [['home', '과목', 'book', '#/'], ['wrong', '오답노트', 'bookmark', '#/wrong'], ['history', '기록', 'clock', '#/history']];
  return [
    h('nav', { class: 'glass tabbar', 'aria-label': '메인 메뉴' },
      tabs.map(([k, label, ic, href]) => h('a', { class: 'tab', href, 'aria-current': k === active ? 'page' : null }, icon(ic), h('span', { text: label })))),
    fab ? h('button', { class: 'glass fab-round', type: 'button', 'aria-label': fab.label, onclick: fab.onClick }, icon(fab.icon)) : null
  ];
}

/* ---------- sheets ---------- */
function closeSheet() { if ($sheet.open) $sheet.close(); }
$sheet.addEventListener('click', e => { if (e.target === $sheet) closeSheet(); });

function openSheet({ title, body, submit = '저장', danger = false, cancel = '취소', onSubmit }) {
  const form = h('form', { class: 'sheet-form', method: 'dialog' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn small', onclick: closeSheet, text: cancel }),
      h('h2', { id: 'sheet-title', text: title }),
      submit ? h('button', { type: 'submit', class: 'btn small ' + (danger ? 'danger' : 'prominent'), text: submit }) : h('span')),
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
function actionSheet(title, actions) {
  openSheet({
    title, submit: null, cancel: '닫기',
    body: h('div', { class: 'group' }, actions.map(a => h('button', {
      type: 'button', class: 'arow' + (a.danger ? ' danger' : ''),
      onclick: () => { closeSheet(); a.onClick(); }
    }, icon(a.icon), a.label)))
  });
}

/* a row of buttons acting as one choice */
function picker(items, initial, cls) {
  let cur = initial;
  const el = h('div', { class: cls, role: 'group' });
  const paint = () => [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === cur)));
  items.forEach(it => el.append(h('button', { type: 'button', 'aria-label': it.aria, style: it.style, onclick: () => { cur = it.value; paint(); } }, it.label)));
  paint();
  return { el, get: () => cur };
}
const group = (label, content) => h('div', null, label ? h('div', { class: 'glabel', text: label }) : null, h('div', { class: 'group' }, content));

/* ---------- subject / exam / question forms ---------- */
function subjectSheet(subject) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = h('input', { class: 'field', type: 'text', maxlength: 20, 'aria-label': '과목 이름', value: subject ? subject.name : '', placeholder: '예: 수학' });
  const emoji = picker(EMOJIS.map(e => ({ value: e, label: e, aria: e })), subject ? subject.emoji : EMOJIS[0], 'picker');
  const hue = picker(HUES.map((v, i) => ({ value: v, label: icon('check'), aria: `색상 ${i + 1}`, style: `--s1:${pal(v)[0]};--s2:${pal(v)[1]}` })), subject ? subject.hue : HUES[0], 'swatches');
  openSheet({
    title: subject ? '과목 편집' : '새 과목',
    body: [
      group('이름', name),
      group('아이콘', emoji.el),
      group('색상', hue.el),
      err,
      subject ? h('div', { class: 'group' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => confirmSheet('과목 삭제', `"${subject.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => {
          db.subjects = db.subjects.filter(s => s !== subject); save(); location.hash = '#/';
        })
      }, icon('trash'), '과목 삭제')) : null
    ],
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { err.textContent = '과목 이름을 입력해 주세요.'; name.focus(); return false; }
      if (subject) Object.assign(subject, { name: n, emoji: emoji.get(), hue: hue.get() });
      else db.subjects.push({ id: uid(), name: n, emoji: emoji.get(), hue: hue.get(), exams: [] });
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
      exam ? h('div', { class: 'group' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => confirmSheet('시험 삭제', `"${exam.name}"과 문제 ${exam.questions.length}개가 지워져요.`, '삭제', () => {
          subject.exams = subject.exams.filter(x => x !== exam); save(); location.hash = '#/s/' + subject.id;
        })
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
  const text = h('textarea', { class: 'field', rows: 4, maxlength: 400, 'aria-label': '문장', placeholder: '예: 광합성은 엽록체에서 일어난다.', text: q ? q.q : '' });
  const ans = picker([{ value: true, label: 'O  맞다', aria: 'O 맞다' }, { value: false, label: 'X  틀리다', aria: 'X 틀리다' }], q ? q.a : true, 'seg sheet-seg');
  const exp = h('textarea', { class: 'field', rows: 2, maxlength: 300, 'aria-label': '해설', placeholder: '틀렸을 때 보여줄 설명 (선택)', text: q ? q.exp : '' });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({
    title: q ? '문제 편집' : '새 OX 문제',
    body: [
      group('문장', text),
      h('div', null, h('div', { class: 'glabel', text: '정답' }), h('div', { class: 'group' }, ans.el)),
      group('해설', exp),
      err,
      q ? h('div', { class: 'group' }, h('button', {
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

/* ---------- JSON import (paste Claude's output) ---------- */
const CLAUDE_PROMPT =
  '첨부한 책 사진의 내용으로 OX 문제를 만들어줘. 사진에 있는 내용만 근거로 하고, 정답이 O인 문제와 X인 문제가 비슷한 비율이 되게 해. ' +
  '설명은 한 문장으로. 아래 JSON 형식으로만 출력해.\n' +
  '{"questions":[{"type":"ox","question":"문장","answer":true,"explanation":"해설"}]}';

function normAnswer(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['o', 'true', 't', 'y', 'yes', '참', '맞다', '맞음', '○'].includes(s)) return true;
  if (['x', 'false', 'f', 'n', 'no', '거짓', '틀리다', '틀림', '×'].includes(s)) return false;
  return null;
}
function parseImport(text) {
  let d;
  try { d = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('JSON 형식이 올바르지 않아요.'); }
  const arr = Array.isArray(d) ? d : d && d.questions;
  if (!Array.isArray(arr)) throw new Error('"questions" 배열을 찾지 못했어요.');
  const out = [];
  let skipped = 0;
  for (const r of arr) {
    const type = String((r && r.type) || 'ox').toLowerCase();
    const q = String((r && (r.question ?? r.q)) ?? '').trim();
    const a = normAnswer(r && (r.answer ?? r.a));
    if (type !== 'ox' || !q || a === null) { skipped++; continue; }
    out.push({ id: uid(), q, a, exp: String((r.explanation ?? r.exp) ?? '').trim() });
  }
  return { out, skipped };
}
function importSheet(exam) {
  const area = h('textarea', { class: 'field', rows: 8, 'aria-label': 'JSON', placeholder: '{"questions":[{"type":"ox","question":"...","answer":true,"explanation":"..."}]}' });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({
    title: 'JSON 가져오기', submit: '가져오기',
    body: [
      h('p', { class: 'hint', text: 'Claude에게 책 사진과 함께 아래 프롬프트를 주고, 나온 JSON을 붙여 넣으세요. OX 문제만 가져와요.' }),
      h('div', { class: 'group' }, h('button', {
        type: 'button', class: 'arow',
        onclick: async () => {
          try { await navigator.clipboard.writeText(CLAUDE_PROMPT); toast('프롬프트를 복사했어요'); }
          catch { area.value = CLAUDE_PROMPT; area.select(); toast('복사가 막혀서 입력창에 넣었어요'); }
        }
      }, icon('copy'), 'Claude 프롬프트 복사')),
      group('JSON', area),
      err
    ],
    onSubmit: () => {
      try {
        const { out, skipped } = parseImport(area.value);
        if (!out.length) { err.textContent = '가져올 OX 문제가 없어요.'; return false; }
        exam.questions.push(...out);
        save();
        toast(`${out.length}문제를 추가했어요` + (skipped ? ` (${skipped}개 건너뜀)` : ''));
        route(true);
      } catch (e) { err.textContent = e.message; return false; }
    }
  });
}

/* ---------- shared bits ---------- */
function ring(pct, cls, label) {
  const r = cls === 'ring' ? 62 : 17, c = 2 * Math.PI * r, w = cls === 'ring' ? 14 : 5, size = cls === 'ring' ? 150 : 40;
  const box = h('div', { class: cls, role: 'img', 'aria-label': label });
  box.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${w}"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent-text)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}"/></svg>`;
  box.append(h('b', { 'aria-hidden': 'true', text: cls === 'ring' ? pct + '%' : String(pct) }));
  return box;
}
const oxTile = q => h('span', { class: 'tile ' + (q.a ? 'o' : 'x'), 'aria-label': q.a ? '정답 O' : '정답 X', text: q.a ? 'O' : 'X' });
function qRow(q, sub, onClick) {
  return h('button', { type: 'button', class: 'row', onclick: onClick },
    oxTile(q),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title clamp2', text: q.q }), sub ? h('span', { class: 'row-sub', text: sub }) : null),
      chev()));
}
function chev() { const c = icon('chev'); c.classList.add('chev'); return c; }
function emptyCard(emoji, title, text, extra) {
  return h('section', { class: 'card empty' }, h('div', { class: 'empty-ico', 'aria-hidden': 'true', text: emoji }), h('h2', { text: title }), h('p', { class: 'muted', text }), extra || null);
}

/* ---------- tab screens ---------- */
function viewHome() {
  const subs = db.subjects;
  const body = h('div', { class: 'stack' });
  if (!subs.length) {
    body.append(emptyCard('📚', '첫 과목을 만들어요', '자주 쓰는 과목은 한 번에 추가할 수 있어요.',
      h('div', { class: 'pills' }, PRESETS.map(([n, e, hue]) => h('button', {
        type: 'button', class: 'btn', text: `${e} ${n}`,
        onclick: () => { db.subjects.push({ id: uid(), name: n, emoji: e, hue, exams: [] }); save(); route(true); }
      })))));
  } else {
    body.append(h('div', { class: 'sgrid' }, subs.map(s => {
      const acc = subjAcc(s);
      return h('a', { class: 'scard', href: '#/s/' + s.id, style: palStyle(s.hue) },
        h('div', { class: 'scard-top' }, h('span', { class: 'scard-emoji', 'aria-hidden': 'true', text: s.emoji }),
          acc !== null ? h('span', { class: 'chip', text: `정답률 ${acc}%` }) : null),
        h('div', null, h('h2', { text: s.name }), h('p', { text: `시험 ${s.exams.length} · 문제 ${subjQ(s)}` })));
    })));
  }
  screen({
    title: '과목', hue: 215, body,
    sub: subs.length ? `과목 ${subs.length}개 · 문제 ${subs.reduce((n, s) => n + subjQ(s), 0)}개` : '공부할 과목을 만들어 보세요',
    dock: tabDock('home', { icon: 'plus', label: '과목 추가', onClick: () => subjectSheet() })
  });
}

function viewWrong() {
  const list = allWrong();
  const body = h('div', { class: 'stack' });
  if (!list.length) {
    body.append(emptyCard('🎯', '오답이 없어요', '문제를 풀다 틀리면 여기에 모여요.'));
  } else {
    body.append(h('section', { class: 'hero' },
      h('div', null, h('span', { class: 'hero-num', text: list.length }), h('p', { text: '복습할 오답' })),
      h('a', { class: 'glass gbtn', href: '#/p/_/wrong' }, icon('play'), '복습 시작')));
    for (const s of db.subjects) {
      const mine = list.filter(x => x.s === s);
      if (!mine.length) continue;
      body.append(h('div', { class: 'sec-title', text: `${s.emoji} ${s.name}` }),
        h('div', { class: 'list', style: palStyle(s.hue) }, mine.map(({ e, q }) => qRow(q, `${e.name}${q.miss ? ` · 오답 ${q.miss}회` : ''}`, () => questionSheet(e, q)))));
    }
  }
  screen({ title: '오답노트', hue: 340, sub: list.length ? `틀린 문제 ${list.length}개` : '모두 맞혔어요', body, dock: tabDock('wrong') });
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
    ring(pct, 'mini-ring', `${pct}%`),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: e.name }), h('span', { class: 'row-sub', text: `${s.emoji} ${s.name} · ${a.mode === 'wrong' ? '오답만' : '전체'} · ${timeLabel(a.at)}` })),
      h('span', { class: 'hist-score', text: `${a.score}/${a.total}` }), chev()));
}
function viewHistory() {
  const all = allAttempts();
  const body = h('div', { class: 'stack' });
  if (!all.length) {
    body.append(emptyCard('🕘', '아직 기록이 없어요', '시험을 풀면 점수가 여기에 쌓여요.'));
  } else {
    const avg = Math.round(all.reduce((n, x) => n + (x.a.score / x.a.total) * 100, 0) / all.length);
    body.append(h('div', { class: 'stats' },
      h('div', null, h('b', { text: all.length }), h('span', { text: '풀이 횟수' })),
      h('div', null, h('b', { text: avg + '%' }), h('span', { text: '평균 점수' })),
      h('div', null, h('b', { text: allWrong().length }), h('span', { text: '남은 오답' }))));
    const days = [];
    for (const x of all) {
      const l = dayLabel(x.a.at);
      if (!days.length || days[days.length - 1].l !== l) days.push({ l, items: [] });
      days[days.length - 1].items.push(x);
    }
    for (const d of days) body.append(h('div', { class: 'sec-title', text: d.l }), h('div', { class: 'list' }, d.items.map(attemptRow)));
  }
  screen({ title: '기록', hue: 180, sub: all.length ? `최근 ${all.length}번 풀었어요` : null, body, dock: tabDock('history') });
}

/* ---------- subject / exam ---------- */
function viewSubject(s) {
  const body = h('div', { class: 'stack' });
  if (!s.exams.length) {
    body.append(emptyCard('🗂️', '시험·단원을 만들어요', '예: 중간고사, 기말고사, 3단원. 안에 문제를 모아 시험처럼 풀 수 있어요.',
      h('button', { type: 'button', class: 'btn prominent', onclick: () => examSheet(s), text: '시험·단원 추가' })));
  } else {
    body.append(h('div', { class: 'list', style: palStyle(s.hue) }, s.exams.map(e => {
      const sc = lastScore(e), wr = wrongCount(e);
      return h('a', { class: 'row', href: '#/e/' + e.id },
        h('span', { class: 'tile', 'aria-hidden': 'true' }, icon('doc')),
        h('span', { class: 'row-body' },
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title', text: e.name }),
            h('span', { class: 'row-sub', text: `OX ${e.questions.length}문제 · ${sc !== null ? `최근 ${sc}%` : '아직 안 풀었어요'}` })),
          wr ? h('span', { class: 'badge', text: `오답 ${wr}` }) : null, chev()));
    })));
  }
  screen({
    title: `${s.emoji} ${s.name}`, back: '#/', hue: s.hue, body,
    sub: `시험 ${s.exams.length}개 · 문제 ${subjQ(s)}개`,
    trail: [{ icon: 'pencil', label: '과목 편집', onClick: () => subjectSheet(s) }],
    dock: tabDock('home', { icon: 'plus', label: '시험·단원 추가', onClick: () => examSheet(s) })
  });
}

const ui = { examTab: 'q', examFor: null };
function viewExam({ s, e }) {
  if (ui.examFor !== e.id) { ui.examFor = e.id; ui.examTab = 'q'; }
  const n = e.questions.length, wr = wrongCount(e), sc = lastScore(e);
  const body = h('div', { class: 'stack tight' });
  body.append(h('div', { class: 'stats' },
    h('div', null, h('b', { text: n }), h('span', { text: '문제' })),
    h('div', null, h('b', { text: sc === null ? '-' : sc + '%' }), h('span', { text: '최근 점수' })),
    h('div', null, h('b', { text: wr }), h('span', { text: '오답' }))));
  const seg = picker([{ value: 'q', label: '문제' }, { value: 'h', label: '기록' }], ui.examTab, 'seg');
  seg.el.addEventListener('click', () => { if (seg.get() !== ui.examTab) { ui.examTab = seg.get(); route(true); } });
  body.append(seg.el);

  if (ui.examTab === 'q') {
    if (!n) body.append(emptyCard('✍️', '문제가 아직 없어요', '직접 추가하거나 Claude가 만든 JSON을 가져와요.'));
    else body.append(h('div', { class: 'list' }, e.questions.map(q => qRow(q, q.miss ? `오답 ${q.miss}회` : '', () => questionSheet(e, q)))));
  } else if (!e.attempts.length) {
    body.append(emptyCard('🕘', '아직 푼 기록이 없어요', '시작하기를 눌러 풀어 보세요.'));
  } else {
    body.append(h('div', { class: 'list' }, e.attempts.slice().reverse().map(a => attemptRow({ s, e, a }))));
  }

  const dock = n ? [
    h('a', wr ? { class: 'glass gbtn', href: `#/p/${e.id}/wrong` } : { class: 'glass gbtn', 'aria-disabled': 'true' }, icon('bookmark'), `오답 ${wr}`),
    h('a', { class: 'gbtn pbtn', href: `#/p/${e.id}/all` }, icon('play'), '시작하기')
  ] : [h('button', { type: 'button', class: 'gbtn pbtn', onclick: () => questionSheet(e) }, icon('plus'), '문제 추가')];

  screen({
    title: e.name, back: '#/s/' + s.id, hue: s.hue, body, dock,
    sub: `${s.emoji} ${s.name}`,
    trail: [
      { icon: 'plus', label: 'OX 문제 추가', onClick: () => questionSheet(e) },
      {
        icon: 'more', label: '더 보기', onClick: () => actionSheet(e.name, [
          { icon: 'import', label: 'JSON 가져오기', onClick: () => importSheet(e) },
          { icon: 'shuffle', label: db.shuffle !== false ? '문제 섞기 끄기' : '문제 섞기 켜기', onClick: () => { db.shuffle = db.shuffle === false; save(); toast(db.shuffle ? '문제를 섞어서 풀어요' : '순서대로 풀어요'); } },
          { icon: 'pencil', label: '시험 이름 변경·삭제', onClick: () => examSheet(s, e) }
        ])
      }
    ]
  });
}

/* ---------- play ---------- */
let play = null;

function startPlay(eid, mode) {
  let qs, title, back, hue = 215, name = '';
  if (eid === '_') {
    qs = allWrong().map(x => x.q); title = '오답 복습'; back = '#/wrong'; hue = 340; name = '오답노트';
  } else {
    const f = findExam(eid);
    if (!f) return false;
    qs = f.e.questions.slice();
    if (mode === 'wrong') qs = qs.filter(q => q.last === false);
    title = f.e.name; back = '#/e/' + eid; hue = f.s.hue; name = `${f.s.emoji} ${f.s.name}`;
  }
  if (!qs.length) { toast('풀 문제가 없어요'); location.replace(eid === '_' ? '#/wrong' : '#/e/' + eid); return false; }
  if (db.shuffle !== false) {
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }
  }
  play = { eid, mode, qs, title, back, hue, name, i: 0, res: [], picked: null, done: false };
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

function oxBtn(val) {
  return h('button', { type: 'button', class: 'glass oxbtn', 'aria-label': val ? 'O 맞다' : 'X 틀리다', onclick: () => answer(val) },
    h('span', { class: 'g', 'aria-hidden': 'true', text: val ? 'O' : 'X' }), h('span', { 'aria-hidden': 'true', text: val ? '맞다' : '틀리다' }));
}

function renderPlay() {
  const p = play;
  if (p.done) return renderResult();
  const q = p.qs[p.i], total = p.qs.length, answered = p.picked !== null, ok = answered && p.picked === q.a;
  const done = p.i + (answered ? 1 : 0);
  const body = h('div', { class: 'stack tight' },
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': '진행도', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('span', { style: `width:${(done / total) * 100}%` })),
    h('section', { class: 'card q-card' },
      h('div', { class: 'q-meta' }, h('span', { class: 'q-tag', text: 'OX' }), h('span', { text: p.name })),
      h('p', { class: 'q-text', text: q.q })),
    answered ? h('section', { class: 'card fb ' + (ok ? 'ok' : 'no'), 'aria-live': 'polite' },
      h('span', { class: 'fb-ico', 'aria-hidden': 'true' }, icon(ok ? 'check' : 'close')),
      h('div', null,
        h('h3', { text: ok ? '정답이에요' : '오답이에요' }),
        h('div', { class: 'ans' },
          h('span', { class: 'badge', text: `내 답 ${p.picked ? 'O' : 'X'}` }), h('span', { class: 'badge', text: `정답 ${q.a ? 'O' : 'X'}` })),
        q.exp ? h('p', { text: q.exp }) : null)) : null);
  screen({
    title: p.title, inline: `${p.i + 1} / ${total}`, close: p.back, large: false, hue: p.hue, body,
    dock: answered
      ? [h('button', { id: 'next', type: 'button', class: 'gbtn pbtn', onclick: next }, p.i + 1 >= total ? '결과 보기' : '다음 문제', icon('chev'))]
      : [oxBtn(true), oxBtn(false)]
  });
  if (answered) requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus({ preventScroll: true }); });
}

function renderResult() {
  const p = play;
  const total = p.qs.length, score = p.res.filter(r => r.ok).length;
  const pct = Math.round((score / total) * 100), wrong = p.res.filter(r => !r.ok);
  const msg = pct >= 90 ? '훌륭해요!' : pct >= 70 ? '좋아요, 조금만 더!' : '한 번 더 복습해 봐요';
  const body = h('div', { class: 'stack tight' },
    h('section', { class: 'card score' }, ring(pct, 'ring', `${pct}%`), h('p', { class: 'big', text: `${score} / ${total} 정답` }), h('p', { class: 'muted', text: msg })),
    wrong.length ? h('div', { class: 'sec-title', text: `틀린 문제 ${wrong.length}개` }) : null,
    wrong.length ? h('div', { class: 'list' }, wrong.map(({ q }) => h('div', { class: 'row' }, oxTile(q),
      h('span', { class: 'row-body' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: q.q }), q.exp ? h('span', { class: 'row-sub', text: q.exp }) : null))))) : null);
  screen({
    title: '결과', inline: '결과', close: p.back, large: false, hue: p.hue, body,
    dock: wrong.length
      ? [h('a', { class: 'glass gbtn', href: p.back }, '나가기'), h('button', { type: 'button', class: 'gbtn pbtn', onclick: () => restart('wrong') }, icon('retry'), '틀린 것만')]
      : [h('button', { type: 'button', class: 'glass gbtn', onclick: () => restart(p.mode) }, icon('retry'), '다시'), h('a', { class: 'gbtn pbtn', href: p.back }, '완료')]
  });
}

document.addEventListener('keydown', ev => {
  if (!play || play.done || $sheet.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.code === 'KeyO') answer(true);
  else if (ev.code === 'KeyX') answer(false);
});

/* ---------- router ---------- */
function route(keepScroll) {
  closeSheet();
  const [k, a, b] = location.hash.replace(/^#\/?/, '').split('/');
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
  else viewHome();
  if (keepScroll !== true) {
    window.scrollTo(0, 0);
    if (!reduceMotion()) $view.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}
window.addEventListener('hashchange', () => route());
route();
