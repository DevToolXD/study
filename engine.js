'use strict';

/* Pure logic: saved data, which question comes next, answer matching, and merging
   the question library that Claude writes. No DOM here, so it can be tested alone. */

/* =====================================================================
   storage and migration
   ===================================================================== */
const KEY = 'study.v1';
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const RETIRE_AT = 6;                       // a question solved this many times (and answered right last) is mastered
const SIZES = [10, 20, 30, 50, 100, 150];
const TYPE_LABEL = { ox: 'OX', mc: '객관식', short: '주관식', word: '단어' };

/* older saves used emoji as subject icons; map them to the drawn glyphs once */
const EMOJI_ICON = {
  '\u{1F4D0}': 'calc', '\u{1F524}': 'type', '\u{1F4D6}': 'book', '\u{1F52C}': 'flask', '\u{1F30D}': 'globe',
  '\u{1F4DC}': 'hourglass', '\u{1F4D8}': 'book', '\u{1F4D5}': 'book', '\u{1F4D7}': 'book', '\u{1F4D9}': 'book',
  '\u{1F9EE}': 'calc', '\u{1F9EA}': 'flask', '\u{1F4BB}': 'code', '\u{1F3B5}': 'music', '\u{1F3A8}': 'palette',
  '✏': 'pencil', '\u{1F9E0}': 'bulb', '⚽': 'ball'
};

const MAKE_COUNTS = [50, 100, 150];
const freshDb = () => ({ subjects: [], size: 20, hiddenLib: { exams: {} }, sync: { rev: '', at: 0, count: 0, last: null }, make: { kind: 'auto', count: 150 }, wait: null });
function migrate(d) {
  const out = Object.assign(freshDb(), d);
  if (!out.hiddenLib || !out.hiddenLib.exams) out.hiddenLib = { exams: {} };
  if (!SIZES.includes(out.size)) out.size = 20;
  out.make = Object.assign({ kind: 'auto', count: 150 }, out.make);
  if (!MAKE_COUNTS.includes(out.make.count)) out.make.count = 150;
  if (!['auto', 'vocab', 'math', 'quiz'].includes(out.make.kind)) out.make.kind = 'auto';
  out.sync = Object.assign({ rev: '', at: 0, count: 0, last: null }, out.sync);
  if (!out.wait || typeof out.wait.since !== 'number') out.wait = null;
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
  catch { if (typeof onSaveFail === 'function') onSaveFail(); }
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
/* hue key -> [bright, deep, ink, glow].
   bright: orbs, icons, rings. deep: avatar gradients. ink: fills that carry white text (>= 4.5:1). glow: the neighbouring hue behind the glass. */
const PALETTE = {
  215: ['#4C9DFF', '#1F5FD6', '#1858C4', '#8B7BFF'], 150: ['#43C77B', '#17884A', '#12733C', '#3CCFD0'], 35: ['#FFA24A', '#E2631B', '#B04508', '#FF6FA0'],
  340: ['#FF6FA0', '#D7336F', '#C02A60', '#FFA24A'], 270: ['#9C7BFF', '#6A3FD4', '#6A3FD4', '#4C9DFF'], 180: ['#3CCFD0', '#0E8D9B', '#0A6F7C', '#43C77B']
};
const HUES = [215, 150, 35, 340, 270, 180];
const pal = hue => PALETTE[hue] || PALETTE[215];
const palStyle = hue => { const p = pal(hue); return `--ca:${p[0]};--cb:${p[1]};--cx:${p[2]};--cc:${p[3]}`; };
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
  const live = new Set(), arrived = [];
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
      let here = 0;
      for (const lq of le.questions) {
        const q = exam.questions.find(x => x.id === lq.id);
        if (!q) { exam.questions.push({ ...lq, lib: true, seen: 0 }); added++; here++; changed = true; }
        else if (q.lib && !sameContent(q, lq)) { applyContent(q, lq); changed = true; }
      }
      if (here) arrived.push({ subject: subj.name, subjectId: subj.id, exam: exam.name, examId: exam.id, n: here });
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
  return { added, changed, arrived };
}
