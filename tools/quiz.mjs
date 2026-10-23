#!/usr/bin/env node
/* Adds quiz questions to data/library.json, the file the app syncs from.
   Zero dependencies. Run from anywhere inside the repo:

     node tools/quiz.mjs add --subject "수학" --exam "3단원 함수" [--icon calc] [--color purple] [--source "교과서 p.52"] < questions.json
     node tools/quiz.mjs list
     node tools/quiz.mjs remove --subject "수학" [--exam "3단원 함수"] [--question <id>]
     node tools/quiz.mjs validate

   questions.json: an array, or { "questions": [...] }. Each item:
     { "type": "ox", "question": "문장", "answer": true, "explanation": "해설", "page": 52 }
   The app plays OX only for now, so other types are rejected, not silently dropped. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_PATH = process.env.QUIZ_LIBRARY ? resolve(process.env.QUIZ_LIBRARY) : resolve(ROOT, 'data', 'library.json');

const ICONS = ['book', 'type', 'calc', 'flask', 'atom', 'leaf', 'globe', 'columns', 'hourglass', 'code', 'music', 'palette', 'pencil', 'bulb', 'ball', 'chart', 'star', 'compass'];
const COLORS = { blue: 215, green: 150, orange: 35, pink: 340, purple: 270, teal: 180 };
const HUES = Object.values(COLORS);
const LIMITS = { subject: 24, exam: 40, question: 400, explanation: 300, minQuestion: 4 };

/* a subject name suggests a glyph; anything else gets a book */
const ICON_GUESS = [
  [/국어|문학|독서|언어|한문/, 'book'], [/영어|english|토익|토플|단어/i, 'type'], [/수학|math|대수|기하|미적|확통|통계/i, 'calc'],
  [/물리|physics/i, 'atom'], [/화학|과학|chem|science/i, 'flask'], [/생물|생명|biology|지구과학/i, 'leaf'],
  [/사회|지리|geo|윤리|정치|경제/i, 'globe'], [/역사|한국사|history|세계사/i, 'hourglass'],
  [/컴퓨터|정보|코딩|프로그래|computer|cs/i, 'code'], [/음악|music/i, 'music'], [/미술|디자인|art/i, 'palette'], [/체육|pe/i, 'ball']
];

/* ---------- helpers ---------- */
const fail = (msg, code = 1) => { console.error('오류: ' + msg); process.exit(code); };
const sha = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
const norm = s => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/[\s.,!?"'“”‘’()·…~\-:;]/g, '');
const subjectId = name => 's_' + sha(norm(name), 8);
const examId = (subject, exam) => 'e_' + sha(norm(subject) + '|' + norm(exam), 10);
const questionId = text => 'q_' + sha(norm(text), 10);

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

function normAnswer(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['o', 'true', 't', 'y', 'yes', '참', '맞다', '맞음', '○'].includes(s)) return true;
  if (['x', 'false', 'f', 'n', 'no', '거짓', '틀리다', '틀림', '×'].includes(s)) return false;
  return null;
}

/* returns { q } or { reason } */
function checkQuestion(item) {
  if (!item || typeof item !== 'object') return { reason: '객체가 아니에요' };
  const type = String(item.type ?? 'ox').toLowerCase().replace(/[^a-z]/g, '');
  if (!['ox', 'tf', 'truefalse'].includes(type)) return { reason: `type "${item.type}" 은 아직 앱이 지원하지 않아요 (ox만 가능)` };
  const text = String(item.question ?? item.q ?? item.text ?? '').trim();
  if (text.length < LIMITS.minQuestion) return { reason: `문장이 너무 짧아요 (${LIMITS.minQuestion}자 이상)` };
  if (text.length > LIMITS.question) return { reason: `문장이 너무 길어요 (${LIMITS.question}자 이하)` };
  const answer = normAnswer(item.answer ?? item.a);
  if (answer === null) return { reason: `answer 를 true/false 로 읽지 못했어요 (${JSON.stringify(item.answer ?? item.a)})` };
  let exp = String(item.explanation ?? item.exp ?? '').trim();
  let trimmed = false;
  if (exp.length > LIMITS.explanation) { exp = exp.slice(0, LIMITS.explanation); trimmed = true; }
  const q = { id: questionId(text), type: 'ox', q: text, a: answer, exp };
  if (item.page != null && String(item.page).trim()) q.page = String(item.page).trim().slice(0, 20);
  return { q, trimmed };
}

function guessIcon(name) {
  for (const [re, icon] of ICON_GUESS) if (re.test(name)) return icon;
  return 'book';
}
function pickColor(v, name) {
  if (v === undefined) return HUES[parseInt(sha(norm(name), 4), 16) % HUES.length];
  if (COLORS[String(v).toLowerCase()]) return COLORS[String(v).toLowerCase()];
  if (HUES.includes(Number(v))) return Number(v);
  fail(`--color 는 ${Object.keys(COLORS).join(', ')} 중 하나여야 해요.`);
}

/* ---------- commands ---------- */
function add(args) {
  const subjectName = String(args.subject === true ? '' : args.subject ?? '').trim();
  const examName = String(args.exam === true ? '' : args.exam ?? '').trim();
  if (!subjectName || !examName) fail('--subject 와 --exam 이 필요해요. 예: --subject "수학" --exam "3단원 함수"');
  if (subjectName.length > LIMITS.subject) fail(`과목 이름은 ${LIMITS.subject}자 이하여야 해요.`);
  if (examName.length > LIMITS.exam) fail(`시험·단원 이름은 ${LIMITS.exam}자 이하여야 해요.`);
  if (args.icon !== undefined && !ICONS.includes(args.icon)) fail(`--icon 은 ${ICONS.join(', ')} 중 하나여야 해요.`);

  const items = readInput(args);
  const lib = loadLibrary();
  let subject = lib.subjects.find(s => norm(s.name) === norm(subjectName));
  const createdSubject = !subject;
  if (!subject) {
    subject = { id: subjectId(subjectName), name: subjectName, icon: args.icon || guessIcon(subjectName), color: pickColor(args.color, subjectName), exams: [] };
    lib.subjects.push(subject);
  } else {
    if (args.icon) subject.icon = args.icon;
    if (args.color !== undefined) subject.color = pickColor(args.color, subjectName);
  }
  let exam = subject.exams.find(e => norm(e.name) === norm(examName));
  const createdExam = !exam;
  if (!exam) {
    exam = { id: examId(subject.name, examName), name: examName, questions: [] };
    subject.exams.push(exam);
  }
  if (args.source && args.source !== true) exam.source = String(args.source).slice(0, 80);

  let added = 0, updated = 0, duplicate = 0, trimmed = 0;
  const skipped = [];
  const seenInBatch = new Set();
  items.forEach((item, i) => {
    const r = checkQuestion(item);
    if (r.reason) { skipped.push({ n: i + 1, reason: r.reason }); return; }
    if (seenInBatch.has(r.q.id)) { duplicate++; return; }
    seenInBatch.add(r.q.id);
    if (r.trimmed) trimmed++;
    const old = exam.questions.find(q => q.id === r.q.id);
    if (!old) { exam.questions.push(r.q); added++; return; }
    /* re-sending a question without a note must not erase the one it already has */
    const exp = r.q.exp || old.exp || '';
    const page = r.q.page || old.page;
    if (old.a !== r.q.a || old.exp !== exp || old.page !== page) {
      old.a = r.q.a; old.exp = exp;
      if (page) old.page = page;
      updated++;
    } else duplicate++;
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
  const o = exam.questions.filter(q => q.a).length;
  console.log(`${createdSubject ? '새 과목' : '과목'} "${subject.name}" / ${createdExam ? '새 시험' : '시험'} "${exam.name}"`);
  console.log(`추가 ${added}개, 수정 ${updated}개, 중복 ${duplicate}개, 건너뜀 ${skipped.length}개${trimmed ? `, 해설 잘림 ${trimmed}개` : ''}`);
  console.log(`이 시험의 문제는 모두 ${exam.questions.length}개 (O ${o} / X ${exam.questions.length - o})`);
  skipped.forEach(s => console.log(`  - ${s.n}번 건너뜀: ${s.reason}`));
  console.log(`저장: ${LIB_PATH}`);
}

function list() {
  const lib = loadLibrary();
  if (!lib.subjects.length) { console.log('아직 CLI로 보낸 문제가 없어요.'); return; }
  let total = 0;
  for (const s of lib.subjects) {
    console.log(`${s.name}  [${s.icon}, ${s.color}]`);
    for (const e of s.exams) {
      const o = e.questions.filter(q => q.a).length;
      total += e.questions.length;
      console.log(`  - ${e.name}: ${e.questions.length}문제 (O ${o} / X ${e.questions.length - o})${e.source ? `  · ${e.source}` : ''}`);
    }
  }
  console.log(`합계 ${total}문제`);
}

function remove(args) {
  const lib = loadLibrary();
  const sName = args.subject === true || args.subject === undefined ? '' : String(args.subject);
  if (!sName) fail('--subject 가 필요해요.');
  const subject = lib.subjects.find(s => norm(s.name) === norm(sName));
  if (!subject) fail(`과목을 찾을 수 없어요: ${sName}`);
  const eName = args.exam === true || args.exam === undefined ? '' : String(args.exam);
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
    const hit = exam.questions.filter(q => q.id === key || q.q.includes(key));
    if (hit.length !== 1) fail(hit.length ? `"${key}" 와 맞는 문제가 ${hit.length}개예요. id 로 지정해 주세요.` : `문제를 찾을 수 없어요: ${key}`);
    exam.questions = exam.questions.filter(q => q !== hit[0]);
    saveLibrary(lib);
    console.log(`문제 1개를 지웠어요: ${hit[0].q}`);
    return;
  }
  subject.exams = subject.exams.filter(e => e !== exam);
  if (!subject.exams.length) lib.subjects = lib.subjects.filter(s => s !== subject);
  saveLibrary(lib);
  console.log(`시험 "${exam.name}" (${exam.questions.length}문제)을 지웠어요.`);
}

function validate() {
  const lib = loadLibrary();
  const errors = [];
  const ids = new Set();
  const idRe = /^[A-Za-z0-9_-]{1,48}$/;
  const once = (id, where) => { if (ids.has(where + id)) errors.push(`${where}: id 중복 ${id}`); ids.add(where + id); };
  for (const s of lib.subjects) {
    if (!s.name || s.name.length > LIMITS.subject) errors.push(`과목 이름이 비었거나 너무 길어요: ${JSON.stringify(s.name)}`);
    if (!idRe.test(s.id || '')) errors.push(`과목 id 형식 오류: ${s.name}`);
    if (!ICONS.includes(s.icon)) errors.push(`과목 "${s.name}" icon 이 올바르지 않아요: ${s.icon}`);
    if (!HUES.includes(s.color)) errors.push(`과목 "${s.name}" color 가 올바르지 않아요: ${s.color}`);
    once(s.id, 'subject');
    for (const e of s.exams || []) {
      if (!e.name || e.name.length > LIMITS.exam) errors.push(`시험 이름이 비었거나 너무 길어요: ${JSON.stringify(e.name)}`);
      if (!idRe.test(e.id || '')) errors.push(`시험 id 형식 오류: ${e.name}`);
      once(e.id, 'exam');
      const seen = new Set();
      for (const q of e.questions || []) {
        const where = `${s.name}/${e.name}`;
        if (!idRe.test(q.id || '')) errors.push(`${where}: 문제 id 형식 오류`);
        if (seen.has(q.id)) errors.push(`${where}: 문제 id 중복 ${q.id}`);
        seen.add(q.id);
        if (q.type && q.type !== 'ox') errors.push(`${where}: 지원하지 않는 type ${q.type}`);
        if (typeof q.a !== 'boolean') errors.push(`${where}: answer(a) 가 true/false 가 아니에요 (${q.id})`);
        if (!q.q || q.q.length < LIMITS.minQuestion || q.q.length > LIMITS.question) errors.push(`${where}: 문장 길이 오류 (${q.id})`);
        if ((q.exp || '').length > LIMITS.explanation) errors.push(`${where}: 해설이 너무 길어요 (${q.id})`);
      }
    }
  }
  if (errors.length) { errors.forEach(e => console.error('  - ' + e)); fail(`${errors.length}개 문제가 있어요.`); }
  const n = lib.subjects.reduce((a, s) => a + s.exams.reduce((b, e) => b + e.questions.length, 0), 0);
  console.log(`정상 · 과목 ${lib.subjects.length}개, 문제 ${n}개`);
}

const HELP = `사용법:
  node tools/quiz.mjs add --subject "수학" --exam "3단원" [--icon calc] [--color purple] [--source "교과서 p.52"] [--dry-run] [--file q.json]
  node tools/quiz.mjs list
  node tools/quiz.mjs remove --subject "수학" [--exam "3단원"] [--question <id 또는 문장 일부>]
  node tools/quiz.mjs validate

icon : ${ICONS.join(' ')}
color: ${Object.keys(COLORS).join(' ')}
문제 JSON(표준입력 또는 --file): [{"type":"ox","question":"문장","answer":true,"explanation":"해설","page":52}]`;

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
switch (cmd) {
  case 'add': add(args); break;
  case 'list': list(); break;
  case 'remove': remove(args); break;
  case 'validate': validate(); break;
  case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
  default: fail(`알 수 없는 명령이에요: ${cmd}\n\n${HELP}`);
}
