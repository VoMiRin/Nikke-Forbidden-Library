import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, ROOT_DIR, parseChapterTextBlocks } from './lib.mjs';
import { buildTitleMatchers, matchTitles } from './gate-run.mjs';

const __filename = fileURLToPath(import.meta.url);

// 측정 게이트(명세 5절) 질문지 도구. GRAPH_RAG_PASS1_GATE.md 참고.
// 질문지를 만드는 쪽은 Pass 1 결과(샤드·인덱스·by_title)를 보지 않고 원문만 본다. 이 도구도 원문과 매니페스트만 읽는다.
//   show <scene_id> [from] [to]      장면 본문을 줄 번호(1.2 기준)와 함께 출력
//   grep <정규식> [--title <title_id 일부>] [--limit N]   원문에서 찾아 장면 ID·줄 번호와 함께 출력
//   check <questions.jsonl> [answers.jsonl] [--no-title]   질문·정답 파일 형식 검사
//         --no-title: 질문 문장에 이야기 제목·장 번호(검색 스크립트가 제목으로 알아보는 것)가 있으면 오류 (보충 질문용)

export const GATE_QUESTION_TYPES = new Set([
  'unknown_speaker_identity', // ???·묘사형 화자의 정체
  'foreshadowing_link', // 떡밥과 회수
  'alias_mentions', // 별칭·다른 이름으로만 나오는 인물
  'past_title_speaker', // 과거 이야기에서 직함으로만 나오는 화자
  'pov_text_adventure', // 시점 인물 텍스트 어드벤처
  'group_or_device_label', // 집단·장치·역할 라벨
  'location', // 장소
  'document_author', // 기록물 작성자
  'relationship', // 인물 관계가 드러나는 장면
  'other',
]);

const loadManifest = (graphDir = GRAPH_DATA_DIR) => JSON.parse(fs.readFileSync(path.join(graphDir, 'manifest.json'), 'utf8'));

export const makeSceneReader = (manifest, rootDir = ROOT_DIR) => {
  const cache = new Map();
  return (sceneId) => {
    const m = manifest.scenes[sceneId];
    if (!m) return null;
    if (!cache.has(m.source_file)) {
      const blocks = parseChapterTextBlocks(fs.readFileSync(path.join(rootDir, m.source_file), 'utf8'));
      cache.set(m.source_file, new Map(blocks.map((b) => [b.scene_id, b.body_lines])));
    }
    return cache.get(m.source_file).get(sceneId) ?? null;
  };
};

const squash = (s) => String(s ?? '').replace(/\s+/g, '');

const readJsonl = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').map((l, i) => [l.trim(), i + 1]).filter(([l]) => l)
    .map(([l, n]) => {
      try {
        return { row: JSON.parse(l), line: n };
      } catch (err) {
        return { error: `${path.basename(file)}:${n} JSON 아님 (${err.message})`, line: n };
      }
    });

/** 질문·정답 파일을 검사한다. 오류가 있으면 errors에, 고칠지 판단할 것은 warnings에 넣는다. */
export const checkGateFiles = ({ questionsPath, answersPath = null, manifest, readScene, noTitle = false }) => {
  const errors = [];
  const warnings = [];
  const questions = new Map();
  const titleMatchers = noTitle ? buildTitleMatchers(manifest) : null;
  for (const r of readJsonl(questionsPath)) {
    if (r.error) { errors.push(r.error); continue; }
    const q = r.row;
    const at = `questions:${r.line}`;
    if (!/^G\d{3}$/.test(q.question_id ?? '')) errors.push(`${at} question_id는 G001 형식이어야 한다`);
    else if (questions.has(q.question_id)) errors.push(`${at} question_id 중복: ${q.question_id}`);
    if (!GATE_QUESTION_TYPES.has(q.type)) errors.push(`${at} type이 목록에 없다: ${q.type}`);
    if (typeof q.question !== 'string' || !q.question.trim()) errors.push(`${at} question이 비었다`);
    else if (noTitle) {
      const titles = matchTitles(q.question, titleMatchers);
      if (titles.length) errors.push(`${at} 질문에 이야기 제목·장 번호가 있다(--no-title): ${titles.join(', ')}`);
    }
    const extra = Object.keys(q).filter((k) => !['question_id', 'type', 'question'].includes(k));
    if (extra.length) errors.push(`${at} 질문 파일에는 question_id·type·question만 둔다(정답 단서가 새지 않게): ${extra.join(', ')}`);
    if (q.question_id) questions.set(q.question_id, q);
  }
  if (!answersPath) return { errors, warnings, questions: questions.size, answers: 0 };

  const answered = new Set();
  let answers = 0;
  for (const r of readJsonl(answersPath)) {
    if (r.error) { errors.push(r.error); continue; }
    const a = r.row;
    const at = `answers:${r.line} ${a.question_id ?? ''}`;
    answers += 1;
    const q = questions.get(a.question_id);
    if (!q) { errors.push(`${at} 질문 파일에 없는 question_id`); continue; }
    if (answered.has(a.question_id)) errors.push(`${at} 정답 중복`);
    answered.add(a.question_id);
    if (typeof a.answer !== 'string' || !a.answer.trim()) errors.push(`${at} answer가 비었다`);
    if (!Array.isArray(a.evidence) || !a.evidence.length) { errors.push(`${at} evidence가 비었다`); continue; }
    if (!a.evidence.some((e) => e.required === true)) errors.push(`${at} required: true인 근거가 하나 이상 있어야 한다`);
    for (const [i, e] of a.evidence.entries()) {
      const eat = `${at} evidence[${i}]`;
      const body = readScene(e.scene_id);
      if (!body) { errors.push(`${eat} 매니페스트에 없는 scene_id: ${e.scene_id}`); continue; }
      if (!Number.isInteger(e.line_start) || !Number.isInteger(e.line_end) || e.line_start < 1 || e.line_end < e.line_start || e.line_end > body.length) {
        errors.push(`${eat} 줄 범위가 틀렸다(본문 ${body.length}줄): ${e.line_start}~${e.line_end}`);
        continue;
      }
      if (typeof e.required !== 'boolean') errors.push(`${eat} required는 true/false`);
      if (typeof e.quote !== 'string' || !e.quote.trim()) errors.push(`${eat} quote가 비었다`);
      else if (!squash(body.slice(e.line_start - 1, e.line_end).join('\n')).includes(squash(e.quote))) {
        errors.push(`${eat} quote가 ${e.scene_id} L${e.line_start}~${e.line_end} 원문에 없다`);
      }
    }
    const ans = a.answer.trim();
    if (ans.length >= 2 && q.question.includes(ans)) warnings.push(`${at} 질문 문장에 정답(${ans})이 들어 있다`);
  }
  for (const id of questions.keys()) if (!answered.has(id)) errors.push(`questions ${id}: 정답이 없다`);
  return { errors, warnings, questions: questions.size, answers };
};

const runCli = (argv) => {
  const [cmd, ...rest] = argv;
  const manifest = loadManifest();
  const readScene = makeSceneReader(manifest);
  if (cmd === 'show') {
    const [sceneId, from, to] = rest;
    const body = readScene(sceneId);
    if (!body) throw new Error(`매니페스트에 없는 장면: ${sceneId}`);
    const a = Math.max(1, Number(from ?? 1));
    const b = Math.min(body.length, Number(to ?? body.length));
    console.log(`# ${sceneId} (${manifest.scenes[sceneId].title_id}, 본문 ${body.length}줄)`);
    for (let i = a; i <= b; i += 1) console.log(`[L${String(i).padStart(4, '0')}] ${body[i - 1]}`);
    return 0;
  }
  if (cmd === 'grep') {
    const pattern = rest[0];
    if (!pattern) throw new Error('grep <정규식> [--title <title_id 일부>] [--limit N]');
    const titleIdx = rest.indexOf('--title');
    const limitIdx = rest.indexOf('--limit');
    const title = titleIdx >= 0 ? rest[titleIdx + 1] : null;
    const limit = limitIdx >= 0 ? Number(rest[limitIdx + 1]) : 200;
    const re = new RegExp(pattern);
    let n = 0;
    for (const [sid, m] of Object.entries(manifest.scenes)) {
      if (title && !m.title_id.includes(title)) continue;
      const body = readScene(sid) ?? [];
      for (let i = 0; i < body.length; i += 1) {
        if (!re.test(body[i])) continue;
        console.log(`${sid} [L${String(i + 1).padStart(4, '0')}] ${body[i].trim()}`);
        n += 1;
        if (n >= limit) { console.log(`… ${limit}건에서 멈춤(--limit로 늘림)`); return 0; }
      }
    }
    console.log(`${n}건`);
    return 0;
  }
  if (cmd === 'check') {
    const noTitle = rest.includes('--no-title');
    const [questionsPath, answersPath] = rest.filter((x) => x !== '--no-title');
    if (!questionsPath) throw new Error('check <questions.jsonl> [answers.jsonl] [--no-title]');
    const r = checkGateFiles({ questionsPath, answersPath, manifest, readScene, noTitle });
    for (const e of r.errors) console.log(`[ERROR] ${e}`);
    for (const w of r.warnings) console.log(`[WARN] ${w}`);
    console.log(`질문 ${r.questions}개, 정답 ${r.answers}개, 오류 ${r.errors.length}, 경고 ${r.warnings.length}`);
    return r.errors.length ? 1 : 0;
  }
  throw new Error('사용법: node scripts/graph/gate-tools.mjs show|grep|check …');
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
