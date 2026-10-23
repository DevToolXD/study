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

const $view = document.getElementById('view');
const $bar = document.getElementById('bar');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2200);
}

/* ---------- model ---------- */
const HUES = [215, 150, 35, 340, 270, 180];
const EMOJIS = ['📘', '📕', '📗', '📙', '📖', '🔤', '📐', '🧮', '🔬', '🧪', '🌍', '📜', '💻', '🎵', '🎨', '✏️'];
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

/* ---------- top bar: separate glass capsules (no glass on glass) ---------- */
function setBar({ title, back, actions = [] }) {
  $bar.replaceChildren(
    back ? h('a', { class: 'glass icon-btn', href: back, 'aria-label': '뒤로' }, '‹') : h('span', { class: 'icon-spacer' }),
    h('h1', { class: 'glass bar-title' }, h('span', { text: title })),
    h('div', { class: 'bar-actions' },
      actions.map(a => h('button', { class: 'glass pill', type: 'button', onclick: a.onClick, text: a.label })))
  );
  document.title = title === '공부방' ? '공부방' : `${title} · 공부방`;
}
const fab = (label, onClick) =>
  h('div', { class: 'fab-wrap' }, h('button', { class: 'glass fab', type: 'button', onclick: onClick, text: label }));

/* ---------- sheet ---------- */
function closeSheet() { if ($sheet.open) $sheet.close(); }
$sheet.addEventListener('click', e => { if (e.target === $sheet) closeSheet(); });

function openSheet({ title, body, submit = '저장', danger = false, onSubmit }) {
  const form = h('form', { class: 'sheet-form', method: 'dialog' },
    h('h2', { id: 'sheet-title', text: title }),
    body,
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet, text: '취소' }),
      submit && h('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'prominent'), text: submit })));
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

/* a group of buttons acting as a single choice; returns { el, get } */
function choice(items, initial, cls) {
  let cur = initial;
  const el = h('div', { class: cls });
  const paint = () => [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === cur)));
  items.forEach(it => {
    const b = h('button', { type: 'button', class: 'btn ' + (it.cls || ''), 'aria-label': it.aria, style: it.style, onclick: () => { cur = it.value; paint(); } }, it.label);
    el.append(b);
  });
  paint();
  return { el, get: () => cur };
}

/* ---------- subject / exam / question forms ---------- */
function subjectSheet(subject) {
  const name = h('input', { class: 'input', type: 'text', maxlength: 20, required: true, value: subject ? subject.name : '', placeholder: '예: 수학' });
  const emoji = choice(EMOJIS.map(e => ({ value: e, label: e, aria: e })), subject ? subject.emoji : EMOJIS[0], 'picker');
  const hue = choice(HUES.map((v, i) => ({ value: v, label: '', cls: 'swatch', style: `--sw:${v}`, aria: `색상 ${i + 1}` })), subject ? subject.hue : HUES[0], 'picker');
  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'f-name', text: '과목 이름' }), name),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: '아이콘' }), emoji.el),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: '색상' }), hue.el),
    subject && h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => confirmSheet('과목 삭제', `"${subject.name}"과 안의 시험·문제가 모두 지워져요.`, '삭제', () => {
        db.subjects = db.subjects.filter(s => s !== subject); save(); location.hash = '#/';
      }),
      text: '이 과목 삭제'
    }));
  name.id = 'f-name';
  openSheet({
    title: subject ? '과목 편집' : '과목 추가', body,
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return false; }
      if (subject) Object.assign(subject, { name: n, emoji: emoji.get(), hue: hue.get() });
      else db.subjects.push({ id: uid(), name: n, emoji: emoji.get(), hue: hue.get(), exams: [] });
      save(); route(true);
    }
  });
}

function examSheet(subject, exam) {
  const name = h('input', { class: 'input', type: 'text', id: 'f-exam', maxlength: 30, required: true, value: exam ? exam.name : '', placeholder: '예: 중간고사, 3단원' });
  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'f-exam', text: '시험·단원 이름' }), name),
    exam && h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => confirmSheet('시험 삭제', `"${exam.name}"과 문제 ${exam.questions.length}개가 지워져요.`, '삭제', () => {
        subject.exams = subject.exams.filter(x => x !== exam); save(); location.hash = '#/s/' + subject.id;
      }),
      text: '이 시험 삭제'
    }));
  openSheet({
    title: exam ? '시험 편집' : '시험·단원 추가', body,
    onSubmit: () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return false; }
      if (exam) exam.name = n;
      else subject.exams.push({ id: uid(), name: n, questions: [], attempts: [] });
      save(); route(true);
    }
  });
}

function questionSheet(exam, q) {
  const text = h('textarea', { class: 'input', id: 'f-q', rows: 4, maxlength: 400, required: true, placeholder: '예: 광합성은 엽록체에서 일어난다.', text: q ? q.q : '' });
  const ans = choice([
    { value: true, label: 'O 맞다' },
    { value: false, label: 'X 틀리다' }
  ], q ? q.a : true, 'seg');
  const exp = h('textarea', { class: 'input', id: 'f-exp', rows: 2, maxlength: 300, placeholder: '틀렸을 때 보여줄 설명 (선택)', text: q ? q.exp : '' });
  const err = h('div', { class: 'err', role: 'alert' });
  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'f-q', text: '문장' }), text),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: '정답' }), ans.el),
    h('div', { class: 'field' }, h('label', { for: 'f-exp', text: '해설' }), exp),
    err,
    q && h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => { exam.questions = exam.questions.filter(x => x !== q); save(); closeSheet(); route(true); },
      text: '이 문제 삭제'
    }));
  openSheet({
    title: q ? '문제 편집' : 'OX 문제 추가', body,
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
  const area = h('textarea', { class: 'input', id: 'f-json', rows: 8, placeholder: '{"questions":[{"type":"ox","question":"...","answer":true,"explanation":"..."}]}' });
  const err = h('div', { class: 'err', role: 'alert' });
  const body = h('div', { class: 'stack' },
    h('p', { class: 'hint', text: 'Claude에게 책 사진과 함께 아래 프롬프트를 주고, 나온 JSON을 붙여 넣으세요. OX 문제만 가져와요.' }),
    h('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        try { await navigator.clipboard.writeText(CLAUDE_PROMPT); toast('프롬프트를 복사했어요'); }
        catch { area.value = CLAUDE_PROMPT; area.select(); toast('복사가 막혀서 입력창에 넣었어요'); }
      },
      text: 'Claude 프롬프트 복사'
    }),
    h('div', { class: 'field' }, h('label', { for: 'f-json', text: 'JSON' }), area),
    err);
  openSheet({
    title: 'JSON 가져오기', submit: '가져오기', body,
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

/* ---------- views ---------- */
function viewHome() {
  setBar({ title: '공부방' });
  const wrap = h('div', { class: 'stack' });
  if (!db.subjects.length) {
    wrap.append(h('section', { class: 'card empty' },
      h('h2', { text: '과목을 만들어 시작해요' }),
      h('p', { class: 'muted', text: '자주 쓰는 과목은 한 번에 추가할 수 있어요.' }),
      h('div', { class: 'chips' }, PRESETS.map(([n, e, hue]) => h('button', {
        type: 'button', class: 'btn chip', text: `${e} ${n}`,
        onclick: () => { db.subjects.push({ id: uid(), name: n, emoji: e, hue, exams: [] }); save(); route(true); }
      })))));
  } else {
    wrap.append(h('div', { class: 'grid' }, db.subjects.map(s => {
      const qn = s.exams.reduce((n, e) => n + e.questions.length, 0);
      return h('a', { class: 'card subj', href: '#/s/' + s.id, style: `--h:${s.hue}` },
        h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, s.emoji),
        h('h2', { text: s.name }),
        h('span', { class: 'meta muted', text: `시험 ${s.exams.length}개 · 문제 ${qn}개` }));
    })));
  }
  $view.replaceChildren(wrap, fab('＋ 과목 추가', () => subjectSheet()));
}

function viewSubject(s) {
  setBar({ title: `${s.emoji} ${s.name}`, back: '#/', actions: [{ label: '편집', onClick: () => subjectSheet(s) }] });
  const wrap = h('div', { class: 'stack' });
  if (!s.exams.length) {
    wrap.append(h('section', { class: 'card empty' },
      h('h2', { text: '시험·단원을 만들어요' }),
      h('p', { class: 'muted', text: '예: 중간고사, 기말고사, 3단원. 안에 문제를 모아 시험처럼 풀 수 있어요.' })));
  } else {
    wrap.append(h('div', { class: 'stack' }, s.exams.map(e => {
      const sc = lastScore(e), wr = wrongCount(e);
      return h('a', { class: 'card exam', href: '#/e/' + e.id, style: `--h:${s.hue}` },
        h('h2', { text: e.name }),
        h('div', { class: 'meta muted' },
          `OX ${e.questions.length}문제`,
          sc !== null ? ` · 최근 ${sc}%` : ' · 아직 안 풀었어요',
          wr ? h('span', { class: 'badge', text: ` 오답 ${wr}` }) : null));
    })));
  }
  $view.replaceChildren(wrap, fab('＋ 시험·단원 추가', () => examSheet(s)));
}

function viewExam({ s, e }) {
  setBar({
    title: e.name, back: '#/s/' + s.id,
    actions: [{ label: '가져오기', onClick: () => importSheet(e) }, { label: '편집', onClick: () => examSheet(s, e) }]
  });
  const sc = lastScore(e), wr = wrongCount(e), n = e.questions.length;
  const summary = h('section', { class: 'card' },
    h('div', { class: 'stats' },
      h('div', null, h('b', { text: n }), h('span', { class: 'muted', text: '문제' })),
      h('div', null, h('b', { text: sc === null ? '-' : sc + '%' }), h('span', { class: 'muted', text: '최근 점수' })),
      h('div', null, h('b', { text: wr }), h('span', { class: 'muted', text: '오답' }))),
    h('div', { class: 'actions' },
      h('a', n ? { class: 'btn prominent', href: `#/p/${e.id}/all`, text: `전체 풀기 (${n})` } : { class: 'btn prominent', 'aria-disabled': 'true', text: '문제를 먼저 추가해 주세요' }),
      h('a', wr ? { class: 'btn', href: `#/p/${e.id}/wrong`, text: `오답만 풀기 (${wr})` } : { class: 'btn', 'aria-disabled': 'true', style: 'opacity:.45', text: '오답만 풀기 (0)' }),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: db.shuffle !== false, onchange: ev => { db.shuffle = ev.target.checked; save(); } }),
        '문제 섞기')));
  const list = e.questions.map(q => h('button', { type: 'button', class: 'card row', onclick: () => questionSheet(e, q) },
    h('span', { class: 'ox-tag ' + (q.a ? 'o' : 'x'), 'aria-label': q.a ? '정답 O' : '정답 X', text: q.a ? 'O' : 'X' }),
    h('span', { class: 'row-text' },
      h('span', { text: q.q }),
      q.miss ? h('span', { class: 'badge', text: `오답 ${q.miss}회` }) : null)));
  $view.replaceChildren(h('div', { class: 'stack' },
    summary,
    n ? h('h2', { class: 'section-title', text: `문제 ${n}개` }) : null,
    ...list), fab('＋ OX 문제 추가', () => questionSheet(e)));
}

/* ---------- play ---------- */
let play = null;

function startPlay(eid, mode) {
  const f = findExam(eid);
  if (!f) return false;
  let qs = f.e.questions.slice();
  if (mode === 'wrong') qs = qs.filter(q => q.last === false);
  if (!qs.length) { toast('풀 문제가 없어요'); location.replace('#/e/' + eid); return false; }
  if (db.shuffle !== false) {
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }
  }
  play = { eid, mode, qs, i: 0, res: [], picked: null, done: false };
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
  requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus(); });
}
function next() {
  if (play.i + 1 >= play.qs.length) {
    const f = findExam(play.eid);
    f.e.attempts.push({ at: Date.now(), mode: play.mode, score: play.res.filter(r => r.ok).length, total: play.qs.length });
    f.e.attempts = f.e.attempts.slice(-30);
    save();
    play.done = true;
  } else {
    play.i++;
    play.picked = null;
  }
  renderPlay();
  window.scrollTo(0, 0);
}

function renderPlay() {
  const f = findExam(play.eid);
  setBar({ title: f.e.name, back: '#/e/' + f.e.id });
  $view.replaceChildren(play.done ? resultView() : questionView());
}

function questionView() {
  const q = play.qs[play.i], total = play.qs.length, answered = play.picked !== null;
  const pad = [true, false].map(val => {
    const cls = ['glass', 'gbtn'];
    let mark = null;
    if (answered && val === q.a) { cls.push('is-correct'); mark = '✓ 정답'; }
    else if (answered && val === play.picked) { cls.push('is-wrong'); mark = '✕ 내 답'; }
    return h('button', {
      type: 'button', class: cls.join(' '), 'aria-disabled': String(answered),
      'aria-label': (val ? 'O 맞다' : 'X 틀리다') + (mark ? `, ${mark}` : ''),
      onclick: () => answer(val)
    },
      mark ? h('span', { class: 'mark', 'aria-hidden': 'true', text: mark }) : null,
      h('span', { class: 'big', 'aria-hidden': 'true', text: val ? 'O' : 'X' }),
      h('span', { class: 'sub', 'aria-hidden': 'true', text: val ? '맞다' : '틀리다' }));
  });
  const ok = answered && play.picked === q.a;
  const fb = answered && h('section', { class: 'card feedback ' + (ok ? 'ok' : 'no'), 'aria-live': 'polite' },
    h('div', { class: 'verdict', text: ok ? '✓ 정답이에요' : `✕ 오답이에요 · 정답은 ${q.a ? 'O' : 'X'}` }),
    q.exp ? h('p', { class: 'muted', text: q.exp }) : null);
  const done = play.i + (answered ? 1 : 0);
  return h('div', { class: 'stack' },
    h('div', { class: 'p-head' }, h('span', { text: `${play.i + 1} / ${total}` }), h('span', { text: play.mode === 'wrong' ? '오답 복습' : '전체' })),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
      h('span', { style: `width:${(done / total) * 100}%` })),
    h('section', { class: 'card q-card' },
      h('p', { class: 'q-label muted', text: '맞으면 O, 틀리면 X  (키보드: O / X)' }),
      h('p', { class: 'q-text', text: q.q })),
    h('div', { class: 'ox-pad' }, pad),
    fb || null,
    answered ? h('button', { id: 'next', type: 'button', class: 'btn prominent next', onclick: next, text: play.i + 1 >= total ? '결과 보기' : '다음 문제' }) : null);
}

function resultView() {
  const total = play.qs.length, score = play.res.filter(r => r.ok).length;
  const pct = Math.round((score / total) * 100), wrong = play.res.filter(r => !r.ok);
  const msg = pct >= 90 ? '훌륭해요!' : pct >= 70 ? '좋아요, 조금만 더!' : '한 번 더 복습해 봐요';
  return h('div', { class: 'stack' },
    h('section', { class: 'card score' },
      h('p', { class: 'muted', text: msg }),
      h('p', { class: 'num', text: `${score} / ${total}` }),
      h('p', { class: 'muted', text: `${pct}%` })),
    wrong.length ? h('section', { class: 'card' },
      h('h2', { text: `틀린 문제 ${wrong.length}개` }),
      wrong.map(({ q }) => h('div', { class: 'wrong-item' },
        h('span', { text: q.q }),
        h('b', { text: `정답: ${q.a ? 'O' : 'X'}` }),
        q.exp ? h('span', { class: 'muted', text: q.exp }) : null))) : null,
    h('div', { class: 'actions' },
      wrong.length ? h('button', { type: 'button', class: 'btn prominent', onclick: () => restart('wrong'), text: '틀린 것만 다시' }) : null,
      h('button', { type: 'button', class: 'btn', onclick: () => restart(play.mode), text: '처음부터 다시' }),
      h('a', { class: 'btn', href: '#/e/' + play.eid, text: '시험으로 돌아가기' })));
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
  let hue = 215;
  const bad = () => { location.replace('#/'); };
  if (k === 's') {
    const s = findSubject(a);
    if (!s) return bad();
    hue = s.hue; document.body.style.setProperty('--h', hue); viewSubject(s);
  } else if (k === 'e') {
    const f = findExam(a);
    if (!f) return bad();
    hue = f.s.hue; document.body.style.setProperty('--h', hue); viewExam(f);
  } else if (k === 'p') {
    const f = findExam(a);
    if (!f) return bad();
    const mode = b === 'wrong' ? 'wrong' : 'all';
    if (!play || play.eid !== a || play.mode !== mode) if (!startPlay(a, mode)) return;
    hue = f.s.hue; document.body.style.setProperty('--h', hue); renderPlay();
  } else {
    document.body.style.setProperty('--h', hue); viewHome();
  }
  if (keepScroll !== true) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => route());
route();
