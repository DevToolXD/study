'use strict';

/* =====================================================================
   storage and migration
   ===================================================================== */
const KEY = 'study.v1';
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const RETIRE_AT = 6;                       // a question solved this many times (and answered right last) is mastered
const SIZES = [10, 20, 30, 50];
const TYPE_LABEL = { ox: 'OX', mc: '객관식', short: '주관식', word: '단어' };

/* older saves used emoji as subject icons; map them to the drawn glyphs once */
const EMOJI_ICON = {
  '\u{1F4D0}': 'calc', '\u{1F524}': 'type', '\u{1F4D6}': 'book', '\u{1F52C}': 'flask', '\u{1F30D}': 'globe',
  '\u{1F4DC}': 'hourglass', '\u{1F4D8}': 'book', '\u{1F4D5}': 'book', '\u{1F4D7}': 'book', '\u{1F4D9}': 'book',
  '\u{1F9EE}': 'calc', '\u{1F9EA}': 'flask', '\u{1F4BB}': 'code', '\u{1F3B5}': 'music', '\u{1F3A8}': 'palette',
  '✏': 'pencil', '\u{1F9E0}': 'bulb', '⚽': 'ball'
};

const freshDb = () => ({ subjects: [], size: 20, hiddenLib: { exams: {} }, sync: { rev: '', at: 0, count: 0 } });
function migrate(d) {
  const out = Object.assign(freshDb(), d);
  if (!out.hiddenLib || !out.hiddenLib.exams) out.hiddenLib = { exams: {} };
  if (!SIZES.includes(out.size)) out.size = 20;
  for (const s of out.subjects) {
    if (!s.icon) s.icon = EMOJI_ICON[String(s.emoji || '').replace(/️/g, '')] || 'book';
    delete s.emoji;
    s.exams = Array.isArray(s.exams) ? s.exams : [];
    for (const e of s.exams) {
      e.questions = Array.isArray(e.questions) ? e.questions : [];
      e.attempts = Array.isArray(e.attempts) ? e.attempts : [];
      for (const q of e.questions) {
        if (!q.type) q.type = 'ox';
        if (q.seen === undefined) q.seen = q.last === undefined ? 0 : Math.max(1, (q.miss || 0) + (q.last ? 1 : 0));
      }
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
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

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
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
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
const topicOf = q => q.topic || (q.type === 'word' ? '단어' : '일반');
const seenOf = q => q.seen || 0;
const activeQs = e => e.questions.filter(q => !q.done);
const doneCount = e => e.questions.length - activeQs(e).length;
const unitOf = e => (e.kind === 'vocab' ? '단어' : '문제');
const wrongCount = e => activeQs(e).filter(q => q.last === false).length;
const lastScore = e => {
  const a = e.attempts[e.attempts.length - 1];
  return a ? Math.round((a.score / a.total) * 100) : null;
};
const subjQ = s => s.exams.reduce((n, e) => n + activeQs(e).length, 0);
function subjAcc(s) {
  const sc = s.exams.map(lastScore).filter(x => x !== null);
  return sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
}
function examAcc(e) {
  let seen = 0, miss = 0;
  for (const q of e.questions) { seen += seenOf(q); miss += q.miss || 0; }
  return seen ? Math.round(((seen - miss) / seen) * 100) : null;
}
function allWrong() {
  const out = [];
  for (const s of db.subjects) for (const e of s.exams) for (const q of e.questions) if (!q.done && q.last === false) out.push({ s, e, q });
  return out;
}
function allAttempts() {
  const out = [];
  for (const s of db.subjects) for (const e of s.exams) for (const a of e.attempts) out.push({ s, e, a });
  return out.sort((x, y) => y.a.at - x.a.at);
}
const libCount = () => db.subjects.reduce((n, s) => n + s.exams.reduce((m, e) => m + e.questions.filter(q => q.lib).length, 0), 0);

/* what a question looks like in lists */
const rowTitle = q => (q.type === 'word' ? q.term : q.q);
function rowSub(q) {
  const parts = [];
  if (q.type === 'word') parts.push(q.meaning);
  else parts.push(TYPE_LABEL[q.type] || 'OX');
  parts.push(topicOf(q));
  if (q.miss) parts.push(`틀림 ${q.miss}`);
  return parts.join(' · ');
}
function answerText(q) {
  if (q.type === 'ox') return q.a ? 'O' : 'X';
  if (q.type === 'mc') return q.choices[q.a];
  if (q.type === 'short') return q.a;
  return `${q.term} = ${q.meaning}`;
}

/* deleting something that came from the CLI hides it on this device, so a sync doesn't bring it back */
const libKey = e => e.libId || e.id;
function removeExam(s, e) {
  if (e.lib) db.hiddenLib.exams[libKey(e)] = 1;
  s.exams = s.exams.filter(x => x !== e);
  save();
}
function removeSubject(s) {
  s.exams.forEach(e => { if (e.lib) db.hiddenLib.exams[libKey(e)] = 1; });
  db.subjects = db.subjects.filter(x => x !== s);
  save();
}

/* =====================================================================
   what to ask next: topics the learner misses more often come up more often,
   fresh questions get a turn, mastered ones drop out
   ===================================================================== */
function topicStats(qs) {
  const t = {};
  for (const q of qs) {
    const s = t[topicOf(q)] || (t[topicOf(q)] = { a: 0, w: 0, n: 0, done: 0 });
    s.a += seenOf(q); s.w += q.miss || 0;
    if (q.done) s.done++; else s.n++;
  }
  return t;
}
function weightOf(q, ts) {
  const t = ts[topicOf(q)] || { a: 0, w: 0 };
  const et = (t.w + 1) / (t.a + 2.5);                              // topic error rate, smoothed toward ~0.4
  const seen = seenOf(q), miss = q.miss || 0;
  const eq = seen ? (miss + 0.5) / (seen + 1.5) : 0.45;            // this question's own error rate
  let w = (0.2 + 1.8 * et) * (0.5 + eq);
  if (!seen) w *= 1.25;                                            // fresh questions enter the rotation
  if (q.last === false) w *= 1.8;                                  // missed last time
  if (seen >= 4 && q.last === true) w *= 0.6;                      // nearly mastered
  if (q.at && Date.now() - q.at < 120000) w *= 0.2;                // just seen
  return w;
}
function pickSession(pool, n) {
  const cache = new Map();
  const tsOf = e => { if (!cache.has(e)) cache.set(e, topicStats(e.questions)); return cache.get(e); };
  return pool
    .map(it => ({ it, k: Math.pow(Math.random(), 1 / Math.max(0.02, weightOf(it.q, tsOf(it.e)))) }))
    .sort((a, b) => b.k - a.k).slice(0, n).map(x => x.it);
}
function recordAnswer(q, ok) {
  q.seen = seenOf(q) + 1;
  if (!ok) q.miss = (q.miss || 0) + 1;
  q.last = ok;
  q.at = Date.now();
  if (q.seen >= RETIRE_AT && ok) q.done = true;
}

/* ---------- answer matching for typed answers ---------- */
function normAns(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/−/g, '-').replace(/\s+/g, '').replace(/[.,;。]+$/, '');
}
function numVal(s) {
  const t = s.replace(/,/g, '');
  let m = /^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = /^([+-]?(?:\d+\.?\d*|\.\d+))%?$/.exec(t);
  return m ? Number(m[1]) : null;
}
function answerForms(s) {
  const n = normAns(s), set = new Set([n]);
  const eq = /^[a-z]{1,2}=(.+)$/.exec(n);                         // "x=3" also counts as "3"
  if (eq) set.add(eq[1]);
  const u = /^([+-]?[\d.,/]+)(cm|mm|km|m|kg|g|ml|l|개|명|원|도|°|℃|점|번|살|초|분|시간|%)$/.exec(n);   // "12cm" also counts as "12"
  if (u) set.add(u[1]);
  return set;
}
function sameAnswer(a, b) {
  for (const x of answerForms(a)) for (const y of answerForms(b)) {
    if (x === y) return true;
    const nx = numVal(x), ny = numVal(y);
    if (nx !== null && ny !== null && Math.abs(nx - ny) <= 1e-9 * Math.max(1, Math.abs(nx))) return true;
  }
  return false;
}
const matchesAny = (val, answers) => String(val ?? '').trim() !== '' && answers.some(a => sameAnswer(val, a));

/* ---------- a question becomes a drill: what is shown and how it is answered ---------- */
function blankHint(term) { return [...term].map((c, i) => (i === 0 || /[\s\-']/.test(c) ? c : '_')).join(' '); }
function cloze(ex, term) {
  if (!ex) return '';
  return ex.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '____');
}
function makeWordDrill(q, e) {
  const seen = seenOf(q), others = e.questions.filter(x => x.type === 'word' && x !== q);
  const distractors = field => {
    const sameKind = others.filter(w => w.pos && w.pos === q.pos);
    const uniq = [], seenVals = new Set([normAns(q[field])]);
    for (const w of [...shuffle(sameKind), ...shuffle(others)]) {
      const k = normAns(w[field]);
      if (!seenVals.has(k)) { seenVals.add(k); uniq.push(w[field]); }
    }
    return uniq.slice(0, 3);
  };
  const stage = seen < 2 ? 0 : seen < 4 ? 1 : 2;     // 2 + 2 + 2 = the six solves that retire a word
  if (stage === 0) {
    const d = distractors('meaning');
    if (d.length >= 2) { const choices = shuffle([q.meaning, ...d]); return { kind: 'mc', label: '단어', prompt: q.term, sub: q.pos || '뜻을 골라요', choices, correct: choices.indexOf(q.meaning), big: true }; }
  } else if (stage === 1) {
    const d = distractors('term');
    if (d.length >= 2) { const choices = shuffle([q.term, ...d]); return { kind: 'mc', label: '단어', prompt: q.meaning, sub: '알맞은 단어를 골라요', choices, correct: choices.indexOf(q.term) }; }
  }
  return { kind: 'short', label: '단어', prompt: q.meaning, sub: [q.pos, blankHint(q.term)].filter(Boolean).join('  '), extra: cloze(q.ex, q.term), answers: [q.term] };
}
function makeDrill(it) {
  const { q, e } = it;
  if (q.type === 'ox') return { kind: 'ox', label: 'OX', prompt: q.q, correct: q.a };
  if (q.type === 'mc') {
    const order = shuffle(q.choices.map((_, i) => i));
    return { kind: 'mc', label: '객관식', prompt: q.q, choices: order.map(i => q.choices[i]), correct: order.indexOf(q.a) };
  }
  if (q.type === 'short') return { kind: 'short', label: '주관식', prompt: q.q, answers: [q.a, ...(q.alts || [])] };
  return makeWordDrill(q, e);
}
function checkDrill(d, val) {
  if (d.kind === 'ox' || d.kind === 'mc') return val === d.correct;
  return matchesAny(val, d.answers);
}
const drillAnswer = d => (d.kind === 'ox' ? (d.correct ? 'O' : 'X') : d.kind === 'mc' ? d.choices[d.correct] : d.answers[0]);

/* =====================================================================
   Claude CLI connection: data/library.json is written by tools/quiz.mjs
   and pulled in here whenever the app opens or resumes
   ===================================================================== */
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const normName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
const KINDS = ['vocab', 'math', 'quiz'];
const QKEYS = ['type', 'q', 'a', 'choices', 'alts', 'term', 'meaning', 'pos', 'ex', 'topic', 'exp'];

function cleanQuestion(q) {
  if (!q || !ID_RE.test(q.id)) return null;
  const type = String(q.type || 'ox');
  const base = { id: q.id, type, topic: clip(q.topic, 24), exp: clip(q.exp, 300) };
  if (type === 'word') {
    const term = clip(q.term, 80), meaning = clip(q.meaning, 160);
    if (!term || !meaning) return null;
    const out = { ...base, term, meaning };
    if (clip(q.pos, 12)) out.pos = clip(q.pos, 12);
    if (clip(q.ex, 200)) out.ex = clip(q.ex, 200);
    return out;
  }
  const text = clip(q.q, 400);
  if (!text) return null;
  if (type === 'ox') return typeof q.a === 'boolean' ? { ...base, q: text, a: q.a } : null;
  if (type === 'mc') {
    const ch = Array.isArray(q.choices) ? q.choices.map(c => clip(c, 160)) : [];
    if (ch.length < 2 || ch.length > 5 || ch.some(c => !c) || new Set(ch).size !== ch.length) return null;
    if (!Number.isInteger(q.a) || q.a < 0 || q.a >= ch.length) return null;
    return { ...base, q: text, choices: ch, a: q.a };
  }
  if (type === 'short') {
    const a = clip(q.a, 120);
    if (!a) return null;
    const out = { ...base, q: text, a };
    const alts = (Array.isArray(q.alts) ? q.alts : []).map(x => clip(x, 120)).filter(Boolean).slice(0, 6);
    if (alts.length) out.alts = alts;
    return out;
  }
  return null;
}

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
        const c = cleanQuestion(q);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        qs.push(c);
      }
      exams.push({ id: e.id, name: clip(e.name, 40), kind: KINDS.includes(e.kind) ? e.kind : 'quiz', questions: qs });
    }
    out.push({ id: s.id, name: clip(s.name, 24), icon: SUBJECT_ICONS.includes(s.icon) ? s.icon : 'book', hue: HUES.includes(s.color) ? s.color : 215, exams });
  }
  return out;
}

const sameContent = (a, b) => QKEYS.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
function applyContent(q, lq) { for (const k of QKEYS) { if (lq[k] === undefined) delete q[k]; else q[k] = lq[k]; } }

function mergeLibrary(lib) {
  let added = 0, changed = false;
  const live = new Set();
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
      live.add(le.id);
      /* an exam the learner made by hand with the same name is filled in rather than duplicated */
      let exam = subj.exams.find(e => e.id === le.id || e.libId === le.id) || subj.exams.find(e => !e.lib && normName(e.name) === normName(le.name));
      if (!exam) {
        exam = { id: le.id, name: le.name, kind: le.kind, questions: [], attempts: [], lib: true };
        subj.exams.push(exam);
        changed = true;
      } else {
        if (!exam.lib) { exam.lib = true; if (exam.id !== le.id) exam.libId = le.id; changed = true; }
        if (exam.name !== le.name) { exam.name = le.name; changed = true; }
        if (exam.kind !== le.kind) { exam.kind = le.kind; changed = true; }
      }
      const ids = new Set(le.questions.map(q => q.id));
      for (const lq of le.questions) {
        const q = exam.questions.find(x => x.id === lq.id);
        if (!q) { exam.questions.push({ ...lq, lib: true, seen: 0 }); added++; changed = true; }
        else if (q.lib && !sameContent(q, lq)) { applyContent(q, lq); changed = true; }
      }
      const before = exam.questions.length;
      exam.questions = exam.questions.filter(q => !q.lib || ids.has(q.id));
      if (exam.questions.length !== before) changed = true;
    }
  }
  /* exams the CLI removed from the library disappear here too */
  for (const s of db.subjects) {
    const keep = s.exams.filter(e => !e.lib || live.has(libKey(e)));
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
let zoomResetAt = 0;
function resetZoom() {                                    // if iOS zoomed in anyway, snap back to 1x
  const now = Date.now();
  if (now - zoomResetAt < 800) return;
  zoomResetAt = now;
  const m = document.querySelector('meta[name=viewport]');
  if (!m) return;
  const orig = m.getAttribute('content');
  m.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  setTimeout(() => m.setAttribute('content', orig), 150);
}
function syncViewport() {
  if (!vv) return;
  const root = document.documentElement.style;
  if (vv.scale > 1.02) {
    root.setProperty('--kb', '0px');
    document.body.classList.remove('kb-open');
    if (!isTyping()) resetZoom();
    return;
  }
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const open = kb > 80;                                   // smaller changes are just the browser bar
  root.setProperty('--kb', (open ? kb : 0) + 'px');
  root.setProperty('--vvh', Math.round(vv.height) + 'px');
  document.body.classList.toggle('kb-open', open);
}
if (vv) { vv.addEventListener('resize', syncViewport); vv.addEventListener('scroll', syncViewport); }
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 350));

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
function qAvatar(q, size) {
  if (q.type === 'ox') return oxAv(q, size);
  const ic = q.type === 'word' ? 'type' : q.type === 'mc' ? 'list' : 'pencil';
  return h('span', { class: 'av ghost', style: size ? `--av:${size}px` : null, 'aria-label': TYPE_LABEL[q.type] }, icon(ic));
}
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
  /* on touch screens an automatic focus pops the keyboard mid-animation, which is what made iOS zoom and shove the sheet */
  const first = form.querySelector('input[type=text], textarea');
  if (first && finePointer()) first.focus();
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
const textField = (label, value, placeholder, max) => h('input', {
  class: 'field', type: 'text', maxlength: max, 'aria-label': label, value: value || '', placeholder,
  autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done'
});

function subjectSheet(subject) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = textField('과목 이름', subject && subject.name, '예: 수학', 20);
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
  const name = textField('시험·단원 이름', exam && exam.name, '예: 중간고사, 3단원', 30);
  openSheet({
    title: exam ? '시험 편집' : '새 시험·단원',
    body: [
      group('이름', name),
      h('p', { class: 'hint', text: '문제는 직접 쓰지 않아요. 터미널에서 같은 이름으로 사진을 넘기면 채워져요.' }),
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

/* questions from the CLI are read-only here; only an old hand-written OX question can still be edited */
function questionSheet(exam, q) {
  if (!(q && !q.lib && q.type === 'ox')) return questionView(q);
  const text = h('textarea', { class: 'field', rows: 4, maxlength: 400, 'aria-label': '문장', text: q.q });
  const ans = picker([{ value: true, label: 'O  맞다', aria: 'O 맞다' }, { value: false, label: 'X  틀리다', aria: 'X 틀리다' }], q.a, 'seg sheet-seg');
  const exp = h('textarea', { class: 'field', rows: 2, maxlength: 300, 'aria-label': '해설', placeholder: '해설 (선택)', text: q.exp });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({
    title: '문제 편집',
    body: [
      group('문장', text),
      h('div', null, h('div', { class: 'glabel', text: '정답' }), h('div', { class: 'sg' }, ans.el)),
      group('해설', exp),
      err,
      h('div', { class: 'sg' }, h('button', {
        type: 'button', class: 'arow danger',
        onclick: () => { exam.questions = exam.questions.filter(x => x !== q); save(); closeSheet(); route(true); }
      }, icon('trash'), '문제 삭제'))
    ],
    onSubmit: () => {
      const t = text.value.trim();
      if (!t) { err.textContent = '문장을 입력해 주세요.'; text.focus(); return false; }
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
      h('p', { class: 'hint', text: q.lib ? 'CLI에서 가져온 문제예요. 고치려면 터미널에서 수정해 주세요.' : '' })
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
  { icon: 'pencil', label: '시험 편집', onClick: () => examSheet(s, e) },
  { icon: 'retry', label: '처음부터 다시', onClick: () => confirmSheet('처음부터 다시', '이 시험의 점수, 오답, 정복 표시를 모두 지우고 처음부터 시작해요. 문제는 그대로 남아요.', '다시 시작', () => { resetExam(e); route(true); toast('처음부터 시작해요'); }) },
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
  return thread(rows);
}

function viewHome() {
  const subs = db.subjects;
  const body = h('div', { class: 'feed' });
  if (!subs.length) {
    body.append(emptyState('stack', '첫 과목을 만들어 보세요', '과목을 만들고 시험·단원을 추가한 뒤, 터미널에서 사진을 넘기면 문제가 채워져요.',
      h('div', { class: 'pills' }, PRESETS.map(([n, ic, hue]) => h('button', {
        type: 'button', class: 'btn outline',
        onclick: () => { db.subjects.push({ id: uid(), name: n, icon: ic, hue, exams: [] }); save(); route(true); }
      }, icon(ic), n)))));
  } else subs.forEach(s => body.append(subjectThread(s)));
  const line = subs.length
    ? [h('span', { text: `과목 ${subs.length}개` }), h('span', { text: `남은 문제 ${subs.reduce((n, s) => n + subjQ(s), 0)}개` })]
    : [h('span', { text: '공부할 과목을 만들어 보세요' })];
  screen({
    title: '과목', hue: 215, tab: 'home', body, head: pageHead({ title: '과목', lines: [line] }),
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
        sm: true, clamp: true, avatar: qAvatar(q), title: rowTitle(q), style: palStyle(s.hue), onClick: () => questionSheet(e, q),
        meta: [h('span', { text: e.name }), h('span', { text: topicOf(q) }), q.miss ? h('span', { text: `틀림 ${q.miss}` }) : null]
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
    body.append(h('div', { class: 'facts' },
      h('div', null, h('b', { text: String(all.length) }), h('span', { text: '연습 횟수' })),
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
    head: pageHead({ title: '기록', lines: [[h('span', { text: all.length ? `최근 ${all.length}번 연습했어요` : '아직 연습한 기록이 없어요' })]] })
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
  const size = picker(SIZES.map(n => ({ value: n, label: String(n), aria: `${n}문제` })), db.size, 'seg', v => { db.size = v; save(); });
  const body = h('div', { class: 'stack' },
    h('div', null, h('div', { class: 'sec', text: 'Claude CLI 연결' }), h('div', { class: 'group' },
      srow({
        ic: 'terminal', title: '동기화', sub: syncText(), subCls: 'js-sync-text',
        trailing: h('button', { type: 'button', class: 'btn sm outline js-sync', onclick: () => syncLibrary(true) }, icon('refresh'), '지금')
      }),
      h('div', { class: 'note' }, '앱을 열 때마다 자동으로 가져와요. 터미널에서 ', code('/quiz'), ' 로 사진을 넘기면 ', code('data/library.json'), ' 에 저장되고 push 돼요. 이 버튼은 바로 확인하고 싶을 때만 써요.'))),
    h('div', null, h('div', { class: 'sec', text: '연습' }), h('div', { class: 'group' },
      srow({ ic: 'list', title: '한 번에 푸는 문제', sub: '연습을 시작할 때 고르는 개수예요', trailing: size.el }),
      h('div', { class: 'note' }, '많이 틀린 유형은 더 자주, 잘 맞히는 유형은 덜 나와요. 같은 문제를 ', code(`${RETIRE_AT}번`), ' 풀고 마지막에 맞히면 정복으로 빠져요. 정복한 문제가 늘면 새 문제를 받을 때라고 알려줘요.'))),
    h('div', null, h('div', { class: 'sec', text: '앱' }), h('div', { class: 'group' },
      srow({ ic: 'share', title: '홈 화면에 추가', sub: standalone() ? '홈 화면 앱으로 실행 중이에요' : 'Safari 공유 버튼, 홈 화면에 추가' }),
      srow({
        ic: 'refresh', title: '업데이트', sub: `버전 ${appVersion || '확인 중'} · 열 때마다 자동 업데이트`, subCls: 'js-version',
        trailing: h('button', { type: 'button', class: 'btn sm outline', onclick: () => checkUpdate(true) }, '확인')
      }))),
    h('div', null, h('div', { class: 'sec', text: '데이터' }), h('div', { class: 'group' },
      srow({
        ic: 'retry', title: '학습 기록 지우기', sub: '점수, 오답, 정복 표시만 지워요', danger: true,
        onClick: () => confirmSheet('학습 기록 지우기', '푼 기록, 오답, 정복 표시가 모두 지워져요. 문제는 그대로 남아요.', '지우기', () => {
          db.subjects.forEach(s => s.exams.forEach(resetExam));
          route(true); toast('학습 기록을 지웠어요');
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
    body.append(emptyState('doc', '시험·단원을 만들어요', '예: 중간고사, 3단원, Day 12. 같은 이름으로 터미널에서 사진을 넘기면 문제가 채워져요.'));
  } else {
    body.append(h('div', { class: 'rows', style: palStyle(s.hue) }, s.exams.map(e => {
      const sc = lastScore(e), wr = wrongCount(e), act = activeQs(e).length, dn = doneCount(e);
      const sub = !e.questions.length ? '사진으로 채워요' : `${unitOf(e)} ${act}개${dn ? ` · 정복 ${dn}` : ''}${sc !== null ? ` · 최근 ${sc}%` : ''}`;
      return h('a', { class: 'row', href: '#/e/' + e.id },
        av(s.hue, 'doc', 'soft'),
        h('span', { class: 'row-body' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: e.name }), h('span', { class: 'row-sub', text: sub })),
          e.lib ? h('span', { class: 'badge plain' }, icon('terminal'), 'CLI') : null,
          wr ? h('span', { class: 'badge' }, icon('xcircle'), String(wr)) : null, dim('chev')));
    })));
  }
  screen({
    title: s.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/', body,
    head: pageHead({
      title: s.name, avatar: av(s.hue, sicon(s)),
      lines: [[h('span', { text: `시험 ${s.exams.length}개` }), h('span', { text: `남은 문제 ${subjQ(s)}개` }), acc !== null ? st('checkcircle', `정답률 ${acc}%`) : null]]
    }),
    trail: [{ icon: 'more', label: '과목 메뉴', onClick: btn => openMenu(btn, subjectMenu(s)) }],
    dock: [h('button', { type: 'button', class: 'pbtn', onclick: () => examSheet(s) }, icon('plus'), '시험·단원 추가')],
    fab: { icon: 'plus', label: '시험·단원 추가', onClick: () => examSheet(s) }
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
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${t.n ? Math.max(3, pct) : 0}%` }))),
        weak ? h('span', { class: 'badge' }, '약해요') : null,
        h('span', { class: 'score', 'aria-label': `출제 비중 ${pct}%`, text: t.n ? `${pct}%` : '-' })));
  });
}

function viewExam({ s, e }) {
  if (ui.examFor !== e.id) { ui.examFor = e.id; ui.examTab = 'q'; ui.showDone = false; }
  const total = e.questions.length, act = activeQs(e), dn = total - act.length, wr = wrongCount(e), acc = examAcc(e), unit = unitOf(e);
  const facts = h('div', { class: 'facts' },
    h('div', null, h('b', { text: String(act.length) }), h('span', { text: `남은 ${unit}` })),
    h('div', null, h('b', { text: String(dn) }), h('span', { text: '정복' })),
    h('div', null, h('b', { text: acc === null ? '-' : acc + '%' }), h('span', { text: '정답률' })));
  const topicsN = Object.keys(topicStats(e.questions)).length;
  const tabs = [['q', `${unit} ${act.length}`], ['t', `유형 ${topicsN}`], ['h', `기록 ${e.attempts.length}`]];
  const body = h('div', null);
  body.append(h('div', { class: 'utabs', role: 'tablist' }, tabs.map(([k, label]) => h('button', {
    type: 'button', class: 'utab', role: 'tab', 'aria-selected': String(ui.examTab === k),
    onclick: () => { if (ui.examTab !== k) { ui.examTab = k; route(true); } }
  }, label))));

  const cmd = h('div', { class: 'cmd' }, code(`/quiz ${s.name} ${e.name} 사진경로`));
  if (ui.examTab === 'q') {
    if (!total) {
      body.append(emptyState('doc', `${unit}가 아직 없어요`, '문제는 직접 쓰지 않아요. 책 사진을 터미널의 Claude CLI에 넘기면 150개가 만들어져요.', cmd));
    } else {
      const need = total >= 20 && act.length <= Math.max(10, Math.round(total * 0.25));
      if (!act.length) {
        body.append(emptyState('checkcircle', `전부 정복했어요`, `${total}개를 모두 6번씩 풀었어요. 새 ${unit}를 받으려면 터미널에서 /quiz 리프레시를 하거나, 처음부터 다시 풀 수 있어요.`,
          h('div', { class: 'pills' }, h('button', { type: 'button', class: 'btn outline', onclick: () => { resetExam(e); route(true); } }, icon('retry'), '처음부터 다시'))));
      } else if (need) {
        body.append(h('section', { class: 'callout col' },
          h('div', null, h('b', { text: `정복 ${dn}/${total}` }), h('span', { text: `남은 ${unit}가 적어요. 새 ${unit}로 바꿀 때예요.` })),
          h('p', { class: 'muted' }, '터미널에서 ', code('/quiz'), ' 로 같은 사진의 새 문제를 받아 오면 자동으로 이어져요.')));
      }
      if (act.length) body.append(h('div', { class: 'rows', style: palStyle(s.hue) }, act.map(q => qRow(e, q))));
      if (dn) {
        body.append(h('button', { type: 'button', class: 'btn outline togg', onclick: () => { ui.showDone = !ui.showDone; route(true); } }, icon(ui.showDone ? 'close' : 'check'), ui.showDone ? '정복한 것 숨기기' : `정복한 ${unit} ${dn}개 보기`));
        if (ui.showDone) body.append(h('div', { class: 'rows done', style: palStyle(s.hue) }, e.questions.filter(q => q.done).map(q => qRow(e, q))));
      }
    }
  } else if (ui.examTab === 't') {
    if (!total) body.append(emptyState('chart', '유형이 아직 없어요', '문제가 들어오면 유형별로 모아 보여줘요.', cmd));
    else body.append(h('p', { class: 'note flat' }, '많이 틀린 유형이 더 자주 나와요. 오른쪽 숫자는 다음 연습에서 그 유형이 나올 비중이에요.'), h('div', { class: 'rows' }, topicRows(s, e)));
  } else if (!e.attempts.length) {
    body.append(emptyState('clock', '아직 연습한 기록이 없어요', '시작하기를 눌러 풀어 보세요.'));
  } else {
    body.append(h('div', { class: 'rows' }, e.attempts.slice().reverse().map(a => attemptRow({ s, e, a }))));
  }

  const n = Math.min(db.size, act.length);
  const dock = act.length ? [
    h('a', wr ? { class: 'glass gbtn', href: `#/p/${e.id}/wrong` } : { class: 'glass gbtn', 'aria-disabled': 'true' }, icon('bookmark'), `오답 ${wr}`),
    h('a', { class: 'pbtn', href: `#/p/${e.id}/all` }, icon('play'), `${n}${unit === '단어' ? '개' : '문제'} 연습`)
  ] : [];
  screen({
    title: e.name, hue: s.hue, tab: 'home', detail: true, subjectId: s.id, back: '#/s/' + s.id, dock,
    head: [pageHead({
      title: e.name, avatar: av(s.hue, 'doc'),
      lines: [[h('a', { href: '#/s/' + s.id, class: 'st' }, icon(sicon(s)), s.name), e.lib ? st('terminal', 'CLI 연동') : null]]
    }), facts],
    body,
    trail: [{ icon: 'more', label: '시험 메뉴', onClick: btn => openMenu(btn, examMenu(s, e)) }]
  });
}
function qRow(e, q) {
  return h('button', { type: 'button', class: 'row' + (q.done ? ' dn' : ''), onclick: () => questionSheet(e, q) },
    qAvatar(q, 36),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title clamp2', text: rowTitle(q) }), h('span', { class: 'row-sub', text: rowSub(q) })),
      q.done ? dim('check') : null, dim('chev')));
}

/* =====================================================================
   play: the question is a post, the answer is a reply under it
   ===================================================================== */
let play = null;

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
  if (!pool.length) { toast('풀 문제가 없어요'); location.replace(eid === '_' ? '#/wrong' : '#/e/' + eid); return false; }
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
function answer(val) {
  if (!play || play.answered || play.done) return;
  const it = play.items[play.i], d = play.drills[play.i];
  const ok = checkDrill(d, val), was = !!it.q.done;
  play.answered = true; play.picked = val; play.ok = ok;
  recordAnswer(it.q, ok);
  if (!was && it.q.done) play.retired++;
  play.res.push({ it, d, ok, val });
  save();
  renderPlay();
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
  renderPlay();
}
function next() {
  if (play.i + 1 >= play.items.length) {
    if (play.eid !== '_') {
      const f = findExam(play.eid);
      f.e.attempts.push({ at: Date.now(), mode: play.mode, score: play.res.filter(r => r.ok).length, total: play.items.length, retired: play.retired });
      f.e.attempts = f.e.attempts.slice(-30);
      save();
    }
    play.done = true;
  } else {
    play.i++;
    play.answered = false; play.picked = null; play.ok = null;
  }
  renderPlay();
  window.scrollTo(0, 0);
}

const oxBtn = val => h('button', { type: 'button', class: 'glass oxbtn', 'aria-label': val ? 'O 맞다' : 'X 틀리다', onclick: () => answer(val) },
  h('span', { class: 'g', 'aria-hidden': 'true', text: val ? 'O' : 'X' }), h('span', { 'aria-hidden': 'true', text: val ? '맞다' : '틀리다' }));

function renderPlay() {
  const p = play;
  if (p.done) return renderResult();
  const it = p.items[p.i], d = p.drills[p.i], q = it.q, total = p.items.length, answered = p.answered, ok = p.ok;
  const done = p.i + (answered ? 1 : 0);
  const where = p.eid === '_' ? `${it.s.name} · ${it.e.name}` : p.name;

  /* what the learner interacts with, inside the question post */
  let control = null, input = null;
  if (d.kind === 'mc') {
    control = h('div', { class: 'choices', role: 'group', 'aria-label': '보기' }, d.choices.map((c, i) => {
      const state = answered ? (i === d.correct ? ' ok' : i === p.picked ? ' no' : ' off') : '';
      return h('button', { type: 'button', class: 'choice' + state, 'aria-disabled': String(answered), onclick: () => answer(i) },
        h('span', { class: 'cn', text: String(i + 1) }), h('span', { class: 'ct', text: c }),
        answered && i === d.correct ? icon('check') : answered && i === p.picked ? icon('close') : null);
    }));
  } else if (d.kind === 'short') {
    input = h('input', {
      class: 'ans-input', type: 'text', 'aria-label': '정답 입력', placeholder: '정답을 입력해요', value: answered ? String(p.picked || '') : '',
      disabled: answered ? true : null, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done'
    });
    control = h('div', { class: 'ans-wrap' + (answered ? (ok ? ' ok' : ' no') : '') }, input);
  }

  const rows = [h('div', { class: 'post' + (answered ? ' next' : ''), style: palStyle(p.hue) },
    h('div', { class: 'post-av' }, av(p.hue, p.ic)),
    h('div', { class: 'post-body' },
      h('div', { class: 'qhead' }, h('span', { text: where }), h('span', { class: 'tag', text: d.label }), h('span', { class: 'tag soft', text: topicOf(q) })),
      h('p', { class: 'q-text' + (d.big ? ' term' : ''), text: d.prompt }),
      d.sub ? h('p', { class: 'q-sub', text: d.sub }) : null,
      d.extra ? h('p', { class: 'q-sub ex', text: d.extra }) : null,
      control))];

  if (answered) {
    const lines = [];
    if (d.kind === 'ox') lines.push(h('div', { class: 'tags' }, h('span', { class: 'tag', text: `내 답 ${p.picked ? 'O' : 'X'}` }), h('span', { class: 'tag', text: `정답 ${d.correct ? 'O' : 'X'}` })));
    else if (!ok) lines.push(h('p', { class: 'ansline' }, h('b', { text: '정답' }), h('span', { text: drillAnswer(d) })));
    if (d.kind === 'short' && !ok) lines.unshift(h('p', { class: 'ansline' }, h('b', { text: '내 답' }), h('span', { text: String(p.picked || '(비움)') })));
    if (q.type === 'word') lines.push(h('p', { class: 'ansline' }, h('b', { text: '뜻' }), h('span', { text: `${q.term} = ${q.meaning}` })));
    if (q.type === 'word' && q.ex) lines.push(h('p', { class: 'muted' }, q.ex));
    if (q.exp) lines.push(h('p', { text: q.exp }));
    const wasRetired = q.done && seenOf(q) >= RETIRE_AT;
    rows.push(h('div', { class: 'post sm reply prev ' + (ok ? 'ok' : 'no'), style: palStyle(p.hue), 'aria-live': 'polite' },
      h('div', { class: 'post-av' }, h('span', { class: 'av ' + (ok ? 'good' : 'bad') }, icon(ok ? 'check' : 'close'))),
      h('div', { class: 'post-body' },
        h('div', { class: 'post-head' }, h('span', { class: 'post-title', text: ok ? (wasRetired ? '정답이에요 · 정복!' : '정답이에요') : '오답이에요' })),
        ...lines,
        !ok && d.kind === 'short' ? h('button', { type: 'button', class: 'btn sm outline fix', onclick: markCorrect }, icon('check'), '맞게 처리') : null)));
  }

  const body = h('div', null,
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': '진행도', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('span', { style: `width:${(done / total) * 100}%` })),
    h('section', { class: 'qpost' }, rows));

  let dock;
  if (answered) dock = [h('button', { id: 'next', type: 'button', class: 'pbtn', onclick: next }, p.i + 1 >= total ? '결과 보기' : '다음', icon('chev'))];
  else if (d.kind === 'ox') dock = [oxBtn(true), oxBtn(false)];
  else if (d.kind === 'short') {
    const go = h('button', { type: 'button', class: 'pbtn', 'aria-disabled': 'true', onclick: () => submit() }, '확인');
    const submit = () => { const v = input.value.trim(); if (v) answer(v); };
    input.addEventListener('input', () => go.setAttribute('aria-disabled', String(!input.value.trim())));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    dock = [h('button', { type: 'button', class: 'glass gbtn narrow', onclick: () => answer('') }, '모르겠어요'), go];
  } else dock = [];

  screen({ title: p.title, inline: `${p.i + 1} / ${total}`, close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body, dock });
  if (answered) requestAnimationFrame(() => { const n = document.getElementById('next'); if (n) n.focus({ preventScroll: true }); });
  else if (input) input.focus({ preventScroll: true });   // synchronous, so it is still inside the tap that opened it
}

function renderResult() {
  const p = play;
  const total = p.items.length, score = p.res.filter(r => r.ok).length;
  const pct = Math.round((score / total) * 100), wrong = p.res.filter(r => !r.ok);
  const msg = pct >= 90 ? '훌륭해요' : pct >= 70 ? '좋아요, 조금만 더' : '한 번 더 복습해 봐요';
  const body = h('div', null,
    h('section', { class: 'scorebox' }, ring(pct, true, `${pct}%`), h('p', { class: 'big', text: `${score} / ${total} 정답` }),
      h('p', { class: 'sub' }, msg), p.retired ? h('p', { class: 'sub' }, st('check', `정복한 문제 ${p.retired}개`)) : null),
    wrong.length ? h('div', { class: 'sec', text: `틀린 문제 ${wrong.length}개` }) : null,
    wrong.length ? h('div', { class: 'rows' }, wrong.map(({ it, d }) => h('div', { class: 'row' }, qAvatar(it.q, 36),
      h('span', { class: 'row-body' }, h('span', { class: 'row-main' },
        h('span', { class: 'row-title', text: d.prompt }),
        h('span', { class: 'row-sub', text: `정답  ${drillAnswer(d)}` }),
        it.q.exp ? h('span', { class: 'row-sub', text: it.q.exp }) : null))))) : null);
  screen({
    title: '결과', inline: '결과', close: p.back, plain: true, detail: true, hue: p.hue, tab: 'home', body,
    dock: wrong.length
      ? [h('a', { class: 'glass gbtn narrow', href: p.back }, '나가기'), h('button', { type: 'button', class: 'pbtn', onclick: () => restart('wrong') }, icon('retry'), '틀린 것만')]
      : [h('button', { type: 'button', class: 'glass gbtn narrow', onclick: () => restart(p.mode) }, icon('retry'), '다시'), h('a', { class: 'pbtn', href: p.back }, '완료')]
  });
}

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') closeMenu();
  if (!play || play.done || $sheet.open || ev.ctrlKey || ev.metaKey || ev.altKey || isTyping()) return;
  const d = play.drills[play.i];
  if (d.kind === 'ox') { if (ev.code === 'KeyO') answer(true); else if (ev.code === 'KeyX') answer(false); }
  else if (d.kind === 'mc' && /^[1-5]$/.test(ev.key) && +ev.key <= d.choices.length) answer(+ev.key - 1);
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
syncViewport();
route();
syncLibrary();
checkUpdate();
try {
  if (sessionStorage.getItem('study.updated')) { sessionStorage.removeItem('study.updated'); toast('새 버전으로 업데이트했어요'); }
} catch { /* private mode */ }
