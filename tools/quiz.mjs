#!/usr/bin/env node
/* Adds study questions to data/library.json, the file the app syncs from.
   Zero dependencies, no network, no API key: Claude Code (logged in with a Claude plan)
   writes the questions, this script only validates and merges them.

     node tools/quiz.mjs add --subject "수학" --exam "3단원" --kind math --target 150 < questions.json
     node tools/quiz.mjs list [--topics]
     node tools/quiz.mjs remove --subject "수학" [--exam "3단원"] [--question <id 또는 문장 일부>]
     node tools/quiz.mjs validate

   Question types (JSON array, or { "questions": [...] }):
     ox    { "type":"ox",    "question":"문장", "answer":true }
     mc    { "type":"mc",    "question":"문제", "choices":["a","b","c","d"], "answer":"정답 보기 글자 그대로" }
     short { "type":"short", "question":"문제", "answer":"12", "alts":["12cm"] }
     word  { "type":"word",  "term":"abandon", "meaning":"버리다", "pos":"동사", "example":"He abandoned the plan." }
   Every item may also carry "topic" (유형 이름), "explanation" and "page".
   The app mixes the questions itself: topics the learner misses more often come up more often. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_PATH = process.env.QUIZ_LIBRARY ? resolve(process.env.QUIZ_LIBRARY) : resolve(ROOT, 'data', 'library.json');

const ICONS = ['book', 'type', 'calc', 'flask', 'atom', 'leaf', 'globe', 'columns', 'hourglass', 'code', 'music', 'palette', 'pencil', 'bulb', 'ball', 'chart', 'star', 'compass'];
const COLORS = { blue: 215, green: 150, orange: 35, pink: 340, purple: 270, teal: 180 };
const HUES = Object.values(COLORS);
const KINDS = ['vocab', 'math', 'quiz'];
const TYPES = ['ox', 'mc', 'short', 'word'];
const DEFAULT_TARGET = 150;
const LIM = { subject: 24, exam: 40, q: 400, choice: 160, answer: 120, alt: 120, term: 80, meaning: 160, pos: 12, ex: 200, topic: 24, exp: 300, minQ: 4 };

/* a subject name suggests a glyph and how it is studied */
const GUESS = [
  [/영어|english|토익|토플|단어|어휘|voca|일본어|중국어|한자|독일어|프랑스어|스페인어/i, 'type', 'vocab'],
  [/수학|math|대수|기하|미적|확통|통계|계산|물리|physics/i, null, 'math'],
  [/국어|문학|독서|언어/, 'book', 'quiz'], [/화학|과학|chem|science/i, 'flask', 'quiz'], [/생물|생명|biology|지구과학/i, 'leaf', 'quiz'],
  [/사회|지리|geo|윤리|정치|경제/i, 'globe', 'quiz'], [/역사|한국사|history|세계사/i, 'hourglass', 'quiz'],
  [/컴퓨터|정보|코딩|프로그래|computer|cs/i, 'code', 'quiz'], [/음악|music/i, 'music', 'quiz'], [/미술|디자인|art/i, 'palette', 'quiz']
];
const ICON_BY_NAME = [[/물리|physics/i, 'atom'], [/수학|math|대수|기하|미적|확통|통계|계산/i, 'calc']];

/* ---------- helpers ---------- */
const fail = (msg, code = 1) => { console.error('오류: ' + msg); process.exit(code); };
const sha = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
const norm = s => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/[\s.,!?"'“”‘’()·…~\-:;]/g, '');
/* question text and choices keep their minus signs, decimals and colons: "-3" and "3" are different answers */
const normText = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '').replace(/["'“”‘’]/g, '').replace(/[.?!。…]+$/, '');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const subjectId = name => 's_' + sha(norm(name), 8);
const examId = (subject, exam) => 'e_' + sha(norm(subject) + '|' + norm(exam), 10);
const questionId = key => 'q_' + sha(normText(key), 10);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const strArg = v => (v === undefined || v === true ? '' : String(v).trim());

function loadLibrary() {
  if (!existsSync(LIB_PATH)) return { version: 1, updatedAt: null, subjects: [] };
  let lib;
  try { lib = JSON.parse(readFileSync(LIB_PATH, 'utf8')); }
  catch (e) { fail(`${LIB_PATH} 의 JSON 형식이 올바르지 않아요 (${e.message}). 고친 뒤 다시 실행해 주세요.`); }
  if (!lib || !Array.isArray(lib.subjects)) fail(`${LIB_PATH} 에 "subjects" 배열이 없어요.`);
  return lib;
}
function saveLibrary(lib) {
  lib.version = 1;
  lib.updatedAt = new Date().toISOString();
  mkdirSync(dirname(LIB_PATH), { recursive: true });
  const tmp = LIB_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(lib, null, 2) + '\n');
  renameSync(tmp, LIB_PATH);
}

function readInput(args) {
  let text;
  if (args.file && args.file !== true) {
    if (!existsSync(args.file)) fail(`파일을 찾을 수 없어요: ${args.file}`);
    text = readFileSync(args.file, 'utf8');
  } else if (!process.stdin.isTTY) {
    text = readFileSync(0, 'utf8');
  } else fail('문제 JSON을 표준입력(stdin)이나 --file 로 넘겨 주세요.');
  text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text) fail('입력이 비어 있어요.');
  let data;
  try { data = JSON.parse(text); } catch (e) { fail(`입력 JSON을 읽지 못했어요 (${e.message}).`); }
  const items = Array.isArray(data) ? data : data && Array.isArray(data.questions) ? data.questions : null;
  if (!items) fail('입력은 배열이거나 { "questions": [...] } 이어야 해요.');
  return items;
}

function normBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['o', 'true', 't', 'y', 'yes', '참', '맞다', '맞음', '○'].includes(s)) return true;
  if (['x', 'false', 'f', 'n', 'no', '거짓', '틀리다', '틀림', '×'].includes(s)) return false;
  return null;
}
function normType(t) {
  const s = String(t ?? 'ox').toLowerCase().replace(/[^a-z가-힣]/g, '');
  if (['ox', 'tf', 'truefalse', 'ox퀴즈'].includes(s)) return 'ox';
  if (['mc', 'choice', 'multiple', 'multiplechoice', 'mcq', '객관식'].includes(s)) return 'mc';
  if (['short', 'shortanswer', 'blank', 'fill', 'fillblank', '주관식', '단답형'].includes(s)) return 'short';
  if (['word', 'vocab', 'vocabulary', 'term', '단어'].includes(s)) return 'word';
  return null;
}

/* an item without "type" is read from its shape, so a forgotten field doesn't sink a whole batch */
function inferType(item) {
  if ((item.term ?? item.word) != null && (item.meaning ?? item.definition) != null) return 'word';
  if (Array.isArray(item.choices ?? item.options)) return 'mc';
  const a = item.answer ?? item.a;
  if (typeof a === 'boolean' || normBool(a) !== null && /^(o|x|true|false|참|거짓|맞다|틀리다)$/i.test(String(a).trim())) return 'ox';
  return a != null && String(a).trim() ? 'short' : 'ox';
}

/* returns { q, trimmed } or { reason } */
function checkQuestion(item) {
  if (!item || typeof item !== 'object') return { reason: '객체가 아니에요' };
  const type = item.type == null || item.type === '' ? inferType(item) : normType(item.type);
  if (!type) return { reason: `type "${item.type}" 을 알 수 없어요 (${TYPES.join(', ')})` };
  const out = { type };
  let trimmed = false;
  const topic = clip(item.topic ?? item.category ?? item['유형'], LIM.topic);
  let exp = String(item.explanation ?? item.exp ?? '').trim();
  if (exp.length > LIM.exp) { exp = exp.slice(0, LIM.exp); trimmed = true; }

  if (type === 'word') {
    const term = clip(item.term ?? item.word, LIM.term), meaning = clip(item.meaning ?? item.definition, LIM.meaning);
    if (!term) return { reason: 'term(단어)이 비었어요' };
    if (!meaning) return { reason: `"${term}" 의 meaning(뜻)이 비었어요` };
    out.id = questionId('w:' + term);
    Object.assign(out, { term, meaning });
    const pos = clip(item.pos, LIM.pos), ex = clip(item.example ?? item.ex, LIM.ex);
    if (pos) out.pos = pos;
    if (ex) out.ex = ex;
  } else {
    const text = String(item.question ?? item.q ?? item.text ?? '').trim();
    if (text.length < LIM.minQ) return { reason: `문장이 너무 짧아요 (${LIM.minQ}자 이상)` };
    if (text.length > LIM.q) return { reason: `문장이 너무 길어요 (${LIM.q}자 이하)` };
    out.id = questionId(text);
    out.q = text;
    if (type === 'ox') {
      const a = normBool(item.answer ?? item.a);
      if (a === null) return { reason: `answer 를 true/false 로 읽지 못했어요 (${JSON.stringify(item.answer ?? item.a)})` };
      out.a = a;
    } else if (type === 'mc') {
      const raw = item.choices ?? item.options;
      if (!Array.isArray(raw)) return { reason: 'choices(보기) 배열이 없어요' };
      const choices = raw.map(c => clip(c, LIM.choice));
      if (choices.some(c => !c)) return { reason: '빈 보기가 있어요' };
      if (choices.length < 2 || choices.length > 5) return { reason: `보기는 2~5개여야 해요 (${choices.length}개)` };
      if (new Set(choices.map(normText)).size !== choices.length) return { reason: '같은 보기가 있어요' };
      let idx = -1;
      if (item.answerIndex !== undefined) idx = Number(item.answerIndex);
      else {
        const ans = item.answer ?? item.a;
        const hit = choices.findIndex(c => normText(c) === normText(ans));
        if (hit >= 0) idx = hit;
        else if (/^[1-9]$/.test(String(ans).trim())) idx = Number(ans) - 1;        // "3" with no matching text: 1-based
        else if (/^[①-⑤]$/.test(String(ans).trim())) idx = '①②③④⑤'.indexOf(String(ans).trim());
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) return { reason: `정답이 보기와 맞지 않아요 (${JSON.stringify(item.answer ?? item.a)}). 정답 보기의 글자를 그대로 쓰세요` };
      out.choices = choices;
      out.a = idx;
    } else {
      const a = clip(item.answer ?? item.a, LIM.answer);
      if (!a) return { reason: 'answer(정답)가 비었어요' };
      out.a = a;
      const alts = (Array.isArray(item.alts ?? item.accept) ? (item.alts ?? item.accept) : []).map(x => clip(x, LIM.alt)).filter(Boolean);
      if (alts.length) out.alts = [...new Set(alts)].slice(0, 6);
    }
  }
  out.topic = topic || (type === 'word' ? '단어' : '일반');
  out.exp = exp;
  if (item.page != null && String(item.page).trim()) out.page = String(item.page).trim().slice(0, 20);
  return { q: out, trimmed };
}

function guess(name) {
  let icon = 'book', kind = 'quiz';
  for (const [re, ic, kd] of GUESS) if (re.test(name)) { icon = ic || icon; kind = kd; break; }
  for (const [re, ic] of ICON_BY_NAME) if (re.test(name)) { icon = ic; break; }
  if (kind === 'math' && icon === 'book') icon = 'calc';
  return { icon, kind };
}
function pickColor(v, name) {
  if (v === undefined) return HUES[parseInt(sha(norm(name), 4), 16) % HUES.length];
  if (COLORS[String(v).toLowerCase()]) return COLORS[String(v).toLowerCase()];
  if (HUES.includes(Number(v))) return Number(v);
  fail(`--color 는 ${Object.keys(COLORS).join(', ')} 중 하나여야 해요.`);
}
const canon = o => JSON.stringify(o, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1))) : v));
const same = (a, b) => canon(a) === canon(b);   // key order doesn't matter
const countBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const fmtCounts = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');

/* ---------- commands ---------- */
function add(args) {
  const subjectName = strArg(args.subject), examName = strArg(args.exam);
  if (!subjectName || !examName) fail('--subject 와 --exam 이 필요해요. 예: --subject "수학" --exam "3단원"');
  if (subjectName.length > LIM.subject) fail(`과목 이름은 ${LIM.subject}자 이하여야 해요.`);
  if (examName.length > LIM.exam) fail(`시험·단원 이름은 ${LIM.exam}자 이하여야 해요.`);
  if (args.icon !== undefined && !ICONS.includes(args.icon)) fail(`--icon 은 ${ICONS.join(', ')} 중 하나여야 해요.`);
  if (args.kind !== undefined && !KINDS.includes(args.kind)) fail(`--kind 는 ${KINDS.join(', ')} 중 하나여야 해요.`);
  const target = args.target === undefined ? 0 : Number(args.target === true ? DEFAULT_TARGET : args.target);
  if (!Number.isInteger(target) || target < 0) fail('--target 은 0 이상의 정수여야 해요.');

  const items = readInput(args);
  const lib = loadLibrary();
  const g = guess(subjectName);
  let subject = lib.subjects.find(s => norm(s.name) === norm(subjectName));
  const createdSubject = !subject;
  if (!subject) {
    subject = { id: subjectId(subjectName), name: subjectName, icon: args.icon || g.icon, color: pickColor(args.color, subjectName), exams: [] };
    lib.subjects.push(subject);
  } else {
    if (args.icon) subject.icon = args.icon;
    if (args.color !== undefined) subject.color = pickColor(args.color, subjectName);
  }
  let exam = subject.exams.find(e => norm(e.name) === norm(examName));
  const createdExam = !exam;
  if (!exam) {
    exam = { id: examId(subject.name, examName), name: examName, kind: args.kind || g.kind, questions: [] };
    subject.exams.push(exam);
  } else if (args.kind) exam.kind = args.kind;
  if (!exam.kind) exam.kind = g.kind;
  if (args.source && args.source !== true) exam.source = String(args.source).slice(0, 80);

  let added = 0, updated = 0, duplicate = 0, trimmed = 0;
  const addedTypes = {}, skipped = [];
  const seenInBatch = new Set();
  items.forEach((item, i) => {
    const r = checkQuestion(item);
    if (r.reason) { skipped.push({ n: i + 1, reason: r.reason }); return; }
    if (seenInBatch.has(r.q.id)) { duplicate++; return; }
    seenInBatch.add(r.q.id);
    if (r.trimmed) trimmed++;
    const old = exam.questions.find(q => q.id === r.q.id);
    if (!old) { exam.questions.push(r.q); added++; addedTypes[r.q.type] = (addedTypes[r.q.type] || 0) + 1; return; }
    /* re-sending a question without its extras (note, topic, alternatives, page...) must not erase what it already has */
    const merged = { ...r.q };
    for (const k of ['exp', 'alts', 'pos', 'ex', 'page']) if ((merged[k] === undefined || merged[k] === '') && old[k]) merged[k] = old[k];
    if ((r.q.topic === '일반' || r.q.topic === '단어') && old.topic) merged.topic = old.topic;
    if (!same(old, merged)) { for (const k of Object.keys(old)) delete old[k]; Object.assign(old, merged); updated++; }
    else duplicate++;
  });

  if (!added && !updated) {
    console.log(`추가된 문제가 없어요. 중복 ${duplicate}개, 건너뜀 ${skipped.length}개.`);
    skipped.forEach(s => console.log(`  - ${s.n}번: ${s.reason}`));
    process.exit(skipped.length ? 2 : 0);
  }
  if (args['dry-run']) {
    console.log(`(dry-run) 추가 ${added}개, 수정 ${updated}개, 중복 ${duplicate}개, 건너뜀 ${skipped.length}개. 파일은 바꾸지 않았어요.`);
    return;
  }
  saveLibrary(lib);
  const total = exam.questions.length;
  const topics = countBy(exam.questions, q => q.topic);
  console.log(`${createdSubject ? '새 과목' : '과목'} "${subject.name}" / ${createdExam ? '새 시험' : '시험'} "${exam.name}" (${exam.kind})`);
  console.log(`추가 ${added}개 (${fmtCounts(addedTypes) || '-'}), 수정 ${updated}개, 중복 ${duplicate}개, 건너뜀 ${skipped.length}개${trimmed ? `, 해설 잘림 ${trimmed}개` : ''}`);
  console.log(`이 시험의 문제: 모두 ${total}개 · 유형 ${Object.keys(topics).length}개 (${fmtCounts(topics)})`);
  if (target) {
    if (total >= target) console.log(`목표 ${target}개를 채웠어요.`);
    else console.log(`목표 ${target}개까지 ${target - total}개 남았어요. 같은 명령으로 더 추가해 주세요.`);
  }
  skipped.forEach(s => console.log(`  - ${s.n}번 건너뜀: ${s.reason}`));
  console.log(`저장: ${LIB_PATH}`);
}

function list(args) {
  const lib = loadLibrary();
  if (!lib.subjects.length) { console.log('아직 CLI로 보낸 문제가 없어요.'); return; }
  let total = 0;
  for (const s of lib.subjects) {
    console.log(`${s.name}  [${s.icon}, ${s.color}]`);
    for (const e of s.exams) {
      total += e.questions.length;
      console.log(`  - ${e.name} (${e.kind || 'quiz'}): ${e.questions.length}개  ${fmtCounts(countBy(e.questions, q => q.type || 'ox'))}${e.source ? `  · ${e.source}` : ''}`);
      if (args.topics) {
        const t = countBy(e.questions, q => q.topic || '일반');
        Object.entries(t).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`      · ${k}: ${v}`));
      }
    }
  }
  console.log(`합계 ${total}개`);
}

function remove(args) {
  const lib = loadLibrary();
  const sName = strArg(args.subject);
  if (!sName) fail('--subject 가 필요해요.');
  const subject = lib.subjects.find(s => norm(s.name) === norm(sName));
  if (!subject) fail(`과목을 찾을 수 없어요: ${sName}`);
  const eName = strArg(args.exam);
  if (!eName) {
    lib.subjects = lib.subjects.filter(s => s !== subject);
    saveLibrary(lib);
    console.log(`과목 "${subject.name}" 과 안의 시험 ${subject.exams.length}개를 지웠어요.`);
    return;
  }
  const exam = subject.exams.find(e => norm(e.name) === norm(eName));
  if (!exam) fail(`시험을 찾을 수 없어요: ${eName}`);
  if (args.question && args.question !== true) {
    const key = String(args.question);
    const label = q => q.q || `${q.term} ${q.meaning}`;
    const hit = exam.questions.filter(q => q.id === key || label(q).includes(key));
    if (hit.length !== 1) fail(hit.length ? `"${key}" 와 맞는 문제가 ${hit.length}개예요. id 로 지정해 주세요.` : `문제를 찾을 수 없어요: ${key}`);
    exam.questions = exam.questions.filter(q => q !== hit[0]);
    saveLibrary(lib);
    console.log(`문제 1개를 지웠어요: ${label(hit[0])}`);
    return;
  }
  subject.exams = subject.exams.filter(e => e !== exam);
  if (!subject.exams.length) lib.subjects = lib.subjects.filter(s => s !== subject);
  saveLibrary(lib);
  console.log(`시험 "${exam.name}" (${exam.questions.length}개)을 지웠어요.`);
}

function validate() {
  const lib = loadLibrary();
  const errors = [];
  const ids = new Set();
  const idRe = /^[A-Za-z0-9_-]{1,48}$/;
  const once = (id, where) => { if (ids.has(where + id)) errors.push(`${where}: id 중복 ${id}`); ids.add(where + id); };
  for (const s of lib.subjects) {
    if (!s.name || s.name.length > LIM.subject) errors.push(`과목 이름이 비었거나 너무 길어요: ${JSON.stringify(s.name)}`);
    if (!idRe.test(s.id || '')) errors.push(`과목 id 형식 오류: ${s.name}`);
    if (!ICONS.includes(s.icon)) errors.push(`과목 "${s.name}" icon 이 올바르지 않아요: ${s.icon}`);
    if (!HUES.includes(s.color)) errors.push(`과목 "${s.name}" color 가 올바르지 않아요: ${s.color}`);
    once(s.id, 'subject');
    for (const e of s.exams || []) {
      if (!e.name || e.name.length > LIM.exam) errors.push(`시험 이름이 비었거나 너무 길어요: ${JSON.stringify(e.name)}`);
      if (!idRe.test(e.id || '')) errors.push(`시험 id 형식 오류: ${e.name}`);
      if (e.kind && !KINDS.includes(e.kind)) errors.push(`시험 "${e.name}" kind 가 올바르지 않아요: ${e.kind}`);
      once(e.id, 'exam');
      const seen = new Set();
      for (const q of e.questions || []) {
        const where = `${s.name}/${e.name}`;
        if (!idRe.test(q.id || '')) errors.push(`${where}: 문제 id 형식 오류`);
        if (seen.has(q.id)) errors.push(`${where}: 문제 id 중복 ${q.id}`);
        seen.add(q.id);
        const t = q.type || 'ox';
        if (!TYPES.includes(t)) { errors.push(`${where}: 알 수 없는 type ${t}`); continue; }
        if ((q.exp || '').length > LIM.exp) errors.push(`${where}: 해설이 너무 길어요 (${q.id})`);
        if ((q.topic || '').length > LIM.topic) errors.push(`${where}: topic 이 너무 길어요 (${q.id})`);
        if (t === 'word') {
          if (!q.term || !q.meaning) errors.push(`${where}: 단어에 term/meaning 이 없어요 (${q.id})`);
          continue;
        }
        if (!q.q || q.q.length < LIM.minQ || q.q.length > LIM.q) errors.push(`${where}: 문장 길이 오류 (${q.id})`);
        if (t === 'ox' && typeof q.a !== 'boolean') errors.push(`${where}: OX 의 a 가 true/false 가 아니에요 (${q.id})`);
        if (t === 'mc') {
          if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 5) errors.push(`${where}: 보기는 2~5개 (${q.id})`);
          else if (!Number.isInteger(q.a) || q.a < 0 || q.a >= q.choices.length) errors.push(`${where}: 객관식 a(정답 번호)가 보기 범위를 벗어났어요 (${q.id})`);
        }
        if (t === 'short' && !String(q.a ?? '').trim()) errors.push(`${where}: 주관식 a(정답)가 비었어요 (${q.id})`);
      }
    }
  }
  if (errors.length) { errors.forEach(e => console.error('  - ' + e)); fail(`${errors.length}개 문제가 있어요.`); }
  const n = lib.subjects.reduce((a, s) => a + s.exams.reduce((b, e) => b + e.questions.length, 0), 0);
  console.log(`정상 · 과목 ${lib.subjects.length}개, 문제 ${n}개`);
}

const HELP = `사용법:
  node tools/quiz.mjs add --subject "수학" --exam "3단원" [--kind vocab|math|quiz] [--target 150] [--icon calc] [--color purple] [--source "교과서 p.52"] [--dry-run] [--file q.json]
  node tools/quiz.mjs list [--topics]
  node tools/quiz.mjs remove --subject "수학" [--exam "3단원"] [--question <id 또는 문장 일부>]
  node tools/quiz.mjs validate

kind : vocab(단어 암기) math(수학 문제 풀이) quiz(사회·역사·과학 등 퀴즈)
icon : ${ICONS.join(' ')}
color: ${Object.keys(COLORS).join(' ')}

문제 JSON(표준입력 또는 --file), 모든 항목에 topic(유형)·explanation·page 를 붙일 수 있어요:
  {"type":"ox","question":"문장","answer":true}
  {"type":"mc","question":"문제","choices":["가","나","다","라"],"answer":"정답 보기 글자 그대로"}
  {"type":"short","question":"문제","answer":"12","alts":["12cm"]}
  {"type":"word","term":"abandon","meaning":"버리다","pos":"동사","example":"He abandoned the plan."}`;

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
switch (cmd) {
  case 'add': add(args); break;
  case 'list': list(args); break;
  case 'remove': remove(args); break;
  case 'validate': validate(); break;
  case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
  default: fail(`알 수 없는 명령이에요: ${cmd}\n\n${HELP}`);
}
