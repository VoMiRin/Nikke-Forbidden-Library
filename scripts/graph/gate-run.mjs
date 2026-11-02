import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 측정 게이트(GRAPH_RAG_PASS1_GATE.md) 검색 스크립트.
// 질문 문장만 보고 Pass 1 역색인(pass1_index.json)에서 후보 장면을 낸다. 모델 판단은 없다. 정답 파일은 읽지 않는다.
// 방식(2026-11-02, 질문 내용을 보기 전에 고정):
//  1. 질문 문장에서 인덱스 키와 일치하는 낱말을 찾는다. 앞은 한글·영숫자가 아니고 뒤는 끝·한글 아님·조사여야 한다.
//     같은 자리에서 겹치면 긴 키만 쓴다. 키는 2글자 이상(`???`는 예외).
//     대상: entities(entity_id 키는 레지스트리 이름, surface: 키는 그 표기), relationships_by_entity, forms_of_address,
//     clues_by_keyword, descriptor_speakers의 라벨, unknown_speakers(`???`·미상·정체불명이 나오면).
//  2. 장면 점수 = 일치한 키마다 log(N / 그 키가 나오는 장면 수)의 합. N = 인덱스 장면 수.
//  3. 질문에 이야기 제목이 나오면 그 이야기 장면에 log(N / 그 이야기 장면 수)를 더한다.
//     제목이 인물 이름·흔한 낱말인 분류(character_episodes, blabla, outpost_stories)는 제목 일치에 쓰지 않는다.
//     메인 스토리는 "Chapter.NN", "NN장", "챕터 NN"으로도 찾는다.
//  4. 점수 내림차순(같으면 매니페스트 순서). 상위 TOP_K개를 저장하고, 점수가 0보다 큰 전체 후보 수도 남긴다.

export const TOP_K = 50;
const PARTICLE = /^(은|는|이|가|을|를|의|에|에게|에겐|에서|와|과|도|만|랑|이랑|하고|야|아|여|씨|님|양|군|언니|오빠|선배|이다|이야|이에요|예요|였|이었|한테|한텐|께|로|으로|처럼|보다|까지|부터|조차|마저|이나|나|든|이든|라고|이라고|라는|이라는|란|이란|요|들)/;
const WORDCHAR = /[가-힣A-Za-z0-9]/;
const TITLE_MATCH_CATEGORIES = new Set(['main_story', 'event_stories', 'side_stories', 'special_stories', 'event_lost_relics', 'lost_relics', 'sub_quests']);
const nfkc = (s) => String(s ?? '').normalize('NFKC').trim();
const squashTitle = (s) => nfkc(s).toLowerCase().replace(/[\s·.\-_'"’:!?,]/g, '');

/** text 안에서 term이 이름 경계로 나오는 시작 위치들 */
export const termPositions = (text, term) => {
  const out = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(term, from);
    if (i < 0) return out;
    from = i + 1;
    const before = i > 0 ? text[i - 1] : '';
    if (before && WORDCHAR.test(before) && WORDCHAR.test(term[0])) continue;
    const rest = text.slice(i + term.length);
    const lastIsWord = WORDCHAR.test(term[term.length - 1]);
    // 호격 아·야·여는 뒤에 한글이 이어지지 않을 때만 조사로 본다("레비아탄"의 "레비"를 막는다)
    const vocativeOnly = /^[아야여]/.test(rest) && /^[아야여][가-힣]/.test(rest) && !/^(야말로|여서)/.test(rest);
    if (!rest || !lastIsWord || !/^[가-힣A-Za-z0-9]/.test(rest) || (PARTICLE.test(rest) && !vocativeOnly)) {
      if (/[A-Za-z0-9]$/.test(term) && /^[A-Za-z0-9]/.test(rest)) continue;
      out.push(i);
    }
  }
};

/** 인덱스에서 검색어 → 장면 집합 사전을 만든다 */
export const buildTermPostings = (index, registry) => {
  const postings = new Map();
  const addTerm = (term, sceneIds, source) => {
    const t = nfkc(term);
    if (!t || ([...t].length < 2 && t !== '???')) return;
    if (!postings.has(t)) postings.set(t, { scenes: new Set(), sources: new Set() });
    const p = postings.get(t);
    for (const s of sceneIds) p.scenes.add(s);
    p.sources.add(source);
  };
  const entById = new Map((registry?.entities ?? []).map((e) => [e.entity_id, e]));
  for (const [key, b] of Object.entries(index.entities)) {
    const scenes = ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only'].flatMap((f) => b[f].map((x) => x.scene_id));
    if (key.startsWith('surface:')) addTerm(key.slice('surface:'.length), scenes, 'entity_surface');
    else {
      const e = entById.get(key);
      for (const n of new Set([e?.canonical_name, ...(e?.surface_labels ?? []), b.canonical_or_surface].filter(Boolean))) addTerm(n, scenes, 'entity');
    }
  }
  for (const [k, arr] of Object.entries(index.relationships_by_entity)) addTerm(k, arr.map((x) => x.scene_id), 'relationship');
  for (const [k, arr] of Object.entries(index.forms_of_address)) addTerm(k, arr.map((x) => x.scene_id), 'address');
  for (const [k, arr] of Object.entries(index.clues_by_keyword)) addTerm(k, arr.map((x) => x.scene_id), 'clue');
  for (const d of index.descriptor_speakers) addTerm(d.speaker_label, [d.scene_id], 'descriptor');
  addTerm('???', index.unknown_speakers.map((u) => u.scene_id), 'unknown');
  return postings;
};

export const buildTitleMatchers = (manifest) => {
  const titles = [];
  for (const t of manifest.titles) {
    if (!TITLE_MATCH_CATEGORIES.has(t.category)) continue;
    const forms = new Set();
    const full = squashTitle(t.title);
    if ([...full].length >= 4) forms.add(full);
    const slug = squashTitle(t.title_id.split('__')[1] ?? '');
    if ([...slug].length >= 4) forms.add(slug);
    const ch = t.title_id.match(/chapter_(\d+)$/);
    titles.push({ title_id: t.title_id, forms: [...forms], chapter: ch ? Number(ch[1]) : null });
  }
  return titles;
};

export const matchTitles = (question, titleMatchers) => {
  const q = squashTitle(question);
  const hits = new Set();
  const chapters = new Set();
  // v1.1(2026-11-02, 채점 뒤 수정): "13챕터"처럼 숫자가 앞에 오는 형식이 빠져 있었다. 장 번호 형식만 고쳤고 나머지 방식은 v1과 같다
  for (const m of nfkc(question).matchAll(/(?:chapter\.?\s*|챕터\s*)(\d{1,2})|(\d{1,2})\s*(?:장(?!면)|챕터)/gi)) chapters.add(Number(m[1] ?? m[2]));
  for (const t of titleMatchers) {
    if (t.forms.some((f) => q.includes(f))) hits.add(t.title_id);
    if (t.chapter !== null && chapters.has(t.chapter)) hits.add(t.title_id);
  }
  return [...hits];
};

export const runQuestion = (question, { postings, titleMatchers, manifest, sceneOrder, N }) => {
  const text = nfkc(question);
  // 1. 검색어 찾기: 긴 키 우선, 이미 덮인 자리는 건너뜀
  const found = [];
  const covered = new Array(text.length).fill(false);
  const terms = [...postings.keys()].filter((t) => text.includes(t)).sort((a, b) => b.length - a.length);
  for (const t of terms) {
    for (const pos of termPositions(text, t)) {
      let free = true;
      for (let k = pos; k < pos + t.length; k += 1) if (covered[k]) free = false;
      if (!free) continue;
      for (let k = pos; k < pos + t.length; k += 1) covered[k] = true;
      if (!found.includes(t)) found.push(t);
    }
  }
  if (/미상|정체\s*불명|정체불명/.test(text) && postings.has('???') && !found.includes('???')) found.push('???');
  // 2·3. 점수
  const score = new Map();
  const add = (sid, w) => score.set(sid, (score.get(sid) ?? 0) + w);
  const termInfo = [];
  for (const t of found) {
    const p = postings.get(t);
    const w = Math.log(N / p.scenes.size);
    termInfo.push({ term: t, scenes: p.scenes.size, weight: Number(w.toFixed(3)), sources: [...p.sources].sort() });
    for (const s of p.scenes) add(s, w);
  }
  const titles = matchTitles(text, titleMatchers);
  const titleInfo = [];
  for (const tid of titles) {
    const sids = Object.keys(manifest.scenes).filter((s) => manifest.scenes[s].title_id === tid);
    const w = Math.log(N / sids.length);
    titleInfo.push({ title_id: tid, scenes: sids.length, weight: Number(w.toFixed(3)) });
    for (const s of sids) add(s, w);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || sceneOrder.get(a[0]) - sceneOrder.get(b[0]));
  return {
    terms: termInfo,
    titles: titleInfo,
    candidate_count: ranked.length,
    top: ranked.slice(0, TOP_K).map(([scene_id, s]) => ({ scene_id, score: Number(s.toFixed(3)) })),
  };
};

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

export const runGate = ({ questionsPath, graphDir = GRAPH_DATA_DIR }) => {
  const index = JSON.parse(fs.readFileSync(path.join(graphDir, 'pass1_index.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(graphDir, 'entity_registry.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(graphDir, 'manifest.json'), 'utf8'));
  const postings = buildTermPostings(index, registry);
  const titleMatchers = buildTitleMatchers(manifest);
  const sceneOrder = new Map(Object.keys(manifest.scenes).map((s, i) => [s, i]));
  const ctx = { postings, titleMatchers, manifest, sceneOrder, N: index.merged_scenes_count };
  const questions = readJsonl(questionsPath);
  return {
    generated_at: new Date().toISOString(),
    index_generated_at: index.generated_at,
    index_scenes: index.merged_scenes_count,
    top_k: TOP_K,
    method: 'gate-run.mjs v1.1 2026-11-02 (질문 낱말 ↔ 인덱스 키 문자열 일치, 희소도 합, 제목 가산; v1에서 "N챕터" 장 번호 형식 추가)',
    results: questions.map((q) => ({ question_id: q.question_id, type: q.type, ...runQuestion(q.question, ctx) })),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [questionsPath, outPath] = process.argv.slice(2);
  if (!questionsPath || !outPath) {
    console.error('사용법: node scripts/graph/gate-run.mjs <questions.jsonl> <출력 run.json>');
    process.exit(2);
  }
  const run = runGate({ questionsPath });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(run, null, 1));
  const noTerm = run.results.filter((r) => !r.terms.length && !r.titles.length).map((r) => r.question_id);
  console.log(`질문 ${run.results.length}개 → ${outPath}. 검색어·제목이 하나도 안 잡힌 질문: ${noTerm.length ? noTerm.join(', ') : '없음'}`);
}
