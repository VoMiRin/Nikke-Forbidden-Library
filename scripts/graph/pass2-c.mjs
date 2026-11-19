import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, writeJsonAtomic } from './lib.mjs';
import { selectWave } from './pass2-b-plan.mjs';
import { checkAudit, computeStamp, staleReason } from './pass2-b.mjs';
import { nfkc, officialResolutions, variantKey } from './pass2-a2.mjs';
import {
  CONFIDENCE_ENUM,
  PASS2_BUNDLE_SCHEMA_VERSION,
  PASS2_SCHEMA_VERSION,
  SceneStore,
  checkQuote,
  compareRelease,
  isNonEmptyString,
  isPositiveInt,
  loadByTitle,
  loadPass2Entities,
  loadRegistry,
  loadReleaseDates,
  readJsonIfExists,
  relPath,
} from './pass2-lib.mjs';
import { extractUtteranceTextFromRawLine } from './validate-output.mjs';

const __filename = fileURLToPath(import.meta.url);

// Pass 2 C. 단서·떡밥 연결(초안 5절 C, 설계 GRAPH_RAG_PASS2_C_DESIGN.md 3차 수정판).
//   node scripts/graph/pass2-c.mjs build --all --run=main                          (전수 패킹. 묶음 ID 확인용)
//   node scripts/graph/pass2-c.mjs build --run=pilot --select="C1__004,C1__010;C1__009,…"   (전수 패킹에서 묶음을 골라 회차별로. ;가 회차 경계)
//   node scripts/graph/pass2-c.mjs status [--wave=N] [--run=...]
//   node scripts/graph/pass2-c.mjs validate <bundle_id> [--run=...]
//   node scripts/graph/pass2-c.mjs cand <bundle_id> [<item_id>] [--offset=0] [--limit=50] [--run=...]
//   node scripts/graph/pass2-c.mjs show <scene_id> [시작줄 끝줄]
//   node scripts/graph/pass2-c.mjs grep <낱말> --bundle=<bundle_id> --unit=<item_id> [--title=a,b] [--limit=30(최대 100)] [--offset=0] [--run=...]
//   node scripts/graph/pass2-c.mjs entity <이름>
//   node scripts/graph/pass2-c.mjs finish [--run=...]
//   node scripts/graph/pass2-c.mjs audit-input --wave=N [--rate=0.1] [--judge-family=gemini] [--run=...]
//   node scripts/graph/pass2-c.mjs audit-check --wave=N [--run=...]
//   node scripts/graph/pass2-c.mjs copy-bundles --from=pilot --bundles=C1__004,… --run=retest
// build는 기계 작업이다. 단서가 무엇과 이어지는지는 판정하지 않는다.
// 충돌 재판정(rejudge-build)과 공식 산출물 승격(promote)은 파일럿에서 충돌·본 실행이 생긴 뒤 만든다.

// ---------------------------------------------------------------------------
// 상수

export const C_VERDICTS = new Set(['같은 대상', '다른 대상', '판단 보류']);
export const UNLINKED_REASONS = new Set(['짝 없음', '단서 아님']);
export const FINAL_STATUSES = ['해결됨', '보류', '짝 없음', '공개 전용', '단서 아님'];
export const MAX_UNITS = 35;
export const MAX_GROUP_UNITS = 40; // 한 키 무리가 상한을 넘으면 이만큼까지는 한 묶음에 둔다
export const MAX_CHARS = 30000; // 발췌 상한. 묶음 전체 입력(색인 포함)은 plan.json에 따로 적는다
export const EXCERPT_RADIUS = 2; // 단서 발췌 앞뒤 줄, 근거 범위 허용 폭(설계 R3)
export const MAX_LINES_REF = 15; // ref: lines 한 끝의 최대 줄 수(넓은 범위로 근거 검사를 피하지 않게)
export const PAIRS_PER_UNIT = 3;
export const PAIRS_PER_BUNDLE = 40;
export const SCAN_MAX_SCENES = 40; // 일반어
export const SCAN_MAX_SCENES_CODE = 60; // 영문·숫자 코드, 공식 표기 묶음 이름
export const SCAN_LINES_OTHER_TITLE = 15;
export const SCAN_LINES_SAME_TITLE = 20;
export const SCAN_LINES_IN_EXCERPT = 6; // 발췌 파일에 넣는 C-0 줄(나머지는 cand로 본다)
export const AUDIT_PROBES = 3;
export const AUDIT_RATE_FACTOR = { '단서 아님': 3, 해결됨: 2 };
export const SEARCH_BUDGET_TAG = '[검색 예산 소진]';
/** 검색어에서 뺄 흔한 말(설계 2.5절 불용어). 대명사·감탄사·접속어 */
export const SCAN_STOPWORDS = new Set([
  '아니', '아니야', '그래', '정말', '진짜', '우리', '너희', '이거', '그거', '저거', '여기', '거기', '저기', '지금', '그럼', '그냥', '이제', '다시',
  '하지만', '그리고', '그런데', '근데', '뭐야', '어떻게', '왜', '어?', '응', '네', '음', '아', '어', '그', '이', '저', '그것', '이것', '무슨', '누구',
]);
export const C_REVIEW_PROBLEMS = new Set([
  'wrong_target', // 단서와 다른 대상의 공개를 이음
  'not_a_reveal', // 단서↔단서 병렬 언급을 이음
  'roles_wrong', // 단서·공개 방향이 뒤집힘
  'missed_link', // 이어야 할 짝을 놓침
  'should_be_hook', // 단서 아님으로 둔 진짜 떡밥
  'should_not_be_hook', // 설정 메모·말버릇을 짝 없음으로 둠
  'should_be_unresolved', // 근거가 모자란데 단정함
  'evidence_not_support',
  'confidence_too_high',
  'prior_knowledge_as_evidence',
  'merge_suggestion_wrong',
  'other',
]);

// wf: 실행 방식(agy run_workflow) 시험. 파일럿 묶음을 copy-bundles로 옮겨 와 같은 규칙으로 다시 판정한다
const RUNS = new Set(['pilot', 'retest', 'wf', 'main']);
const RUN_DIRS = { pilot: 'c-pilot', retest: 'c-retest', wf: 'c-wf', main: 'c' };
const runRoot = (run) => path.join(GRAPH_DATA_DIR, 'pass2', RUN_DIRS[run]);
const RULES_PATH = path.resolve(GRAPH_DATA_DIR, '..', '..', 'docs', 'graphrag', 'GRAPH_RAG_PASS2_C_RULES.md');
const A2_MAIN_ROOT = path.join(GRAPH_DATA_DIR, 'pass2', 'a2');
const OFFICIAL_ENTITIES_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'entities.json');
const OFFICIAL_TERMS_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'terms.json');
const B_A2_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'merged', 'B_candidates_a2.json');
const pathsOf = (run) => {
  const root = runRoot(run);
  return {
    root,
    bundles: path.join(root, 'bundles'),
    plan: path.join(root, 'bundles', 'plan.json'),
    shards: path.join(root, 'shards'),
    stamps: path.join(root, 'stamps'),
    merged: path.join(root, 'merged'),
    progress: path.join(root, 'progress.json'),
    log: path.join(root, 'validation_log.jsonl'),
    searchLog: path.join(root, 'search_log.jsonl'),
    audit: path.join(root, 'audit'),
  };
};

const pad = (n, w = 3) => String(n).padStart(w, '0');
const lineTag = (n) => `L${String(n).padStart(4, '0')}`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const hashRank = (seed, key) => sha256(`${seed}|${key}`);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // UTF-16 코드 유닛 순서(설계 R6)
const overlaps = (a1, a2, b1, b2) => a1 <= b2 && a2 >= b1;
const CLH_RE = /__clh_\d+$/;

// ---------------------------------------------------------------------------
// 모집단(설계 2.1절): by_title의 clues_and_hooks 전부

/** 판정 단위. store가 있으면 장면 순서를 붙인다 */
export const collectClues = (titleDocs, store = null) => {
  const units = [];
  for (const doc of titleDocs) {
    for (const scene of doc.scenes ?? []) {
      for (const c of scene.clues_and_hooks ?? []) {
        units.push({
          item_id: c.item_id,
          scene_id: scene.scene_id,
          title_id: doc.title_id,
          category: doc.category,
          clue_category: c.category,
          keyword: c.keyword ?? '',
          subject: c.subject ?? null,
          detail: c.detail ?? '',
          quote: c.quote ?? '',
          line_start: c.line_start,
          line_end: c.line_end ?? c.line_start,
          scene_index: store?.meta(scene.scene_id)?.index_in_title ?? 0,
          scene_order: store?.sceneOrder?.get(scene.scene_id) ?? 0,
        });
      }
    }
  }
  return units;
};

/** 장면 → 그 장면의 단서(줄 순서) */
export const clhIndexByScene = (units) => {
  const out = new Map();
  for (const u of units) {
    if (!out.has(u.scene_id)) out.set(u.scene_id, []);
    out.get(u.scene_id).push(u);
  }
  for (const list of out.values()) list.sort((a, b) => a.line_start - b.line_start || cmpStr(a.item_id, b.item_id));
  return out;
};

/** cross_scene_hints 쌍(양방향). 장면 → 이어진 장면 집합 */
export const hintSceneLinks = (titleDocs) => {
  const out = new Map();
  const hints = [];
  const add = (a, b) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  };
  for (const doc of titleDocs) {
    for (const scene of doc.scenes ?? []) {
      for (const h of scene.cross_scene_hints ?? []) {
        hints.push({ item_id: h.item_id, scene_id: scene.scene_id, text: h.text, related_scene_ids: h.related_scene_ids ?? [] });
        for (const r of h.related_scene_ids ?? []) {
          if (r === scene.scene_id) continue;
          add(scene.scene_id, r);
          add(r, scene.scene_id);
        }
      }
    }
  }
  return { links: out, hints };
};

// ---------------------------------------------------------------------------
// A-2 공식 키(설계 2.3절 R6)

/** A-2 해소 항목 하나의 공식 키. 별칭·새 엔티티만, 나머지는 null */
export const officialKeyOf = (r, groupMap) => {
  if (r.link_type === 'alias' && r.target?.entity_id) return `ent:${r.target.entity_id}`;
  if (r.link_type !== 'new_entity') return null;
  const g = r.group_key ? groupMap[r.group_key] : null;
  if (g?.entity_id) return `ent:${g.entity_id}`;
  if (g?.term_key) return `term:${g.term_key}`;
  if (r.assigned_entity_id) return `ent:${r.assigned_entity_id}`;
  return null;
};

/**
 * A-2 출현 색인: 장면 → [{vk, line_start, line_end, key}]. 출현 범위는 A-2 출현(occ)의 병합 줄 범위다.
 * resolutions는 officialResolutions를 거친 것, occRange(bundle_id, unit_id, occ_id) → {line_start, line_end}
 */
export const a2OccIndex = ({ resolutions, groupMap, occRange }) => {
  const byOcc = new Map();
  for (const r of resolutions) {
    const k = `${r.bundle_id}|${r.unit_id}|${r.occ_id}`;
    if (!byOcc.has(k)) {
      const range = occRange(r.bundle_id, r.unit_id, r.occ_id);
      byOcc.set(k, { scene_id: r.scene_id, vk: variantKey(r.surface), line_start: range?.line_start ?? null, line_end: range?.line_end ?? null, keys: new Set() });
    }
    const key = officialKeyOf(r, groupMap);
    if (key) byOcc.get(k).keys.add(key);
  }
  const out = new Map();
  for (const o of byOcc.values()) {
    if (!out.has(o.scene_id)) out.set(o.scene_id, []);
    out.get(o.scene_id).push(o);
  }
  return out;
};

/** 전역 사전: 변형 열쇠 → 공식 키 집합(레지스트리 이름·별칭, 공식 엔티티, 공식 표기 묶음) */
export const officialDictionary = ({ registry, officialEntities, terms }) => {
  const out = new Map();
  const add = (name, key) => {
    const vk = variantKey(name);
    if (!vk) return;
    if (!out.has(vk)) out.set(vk, new Set());
    out.get(vk).add(key);
  };
  for (const e of registry.values()) for (const n of [e.canonical_name, ...(e.surface_labels ?? [])]) add(n, `ent:${e.entity_id}`);
  for (const e of officialEntities) for (const n of [e.canonical_name, ...(e.surface_labels ?? [])]) add(n, `ent:${e.entity_id}`);
  for (const t of terms) for (const n of [t.canonical_name, ...(t.surfaces ?? [])]) add(n, `term:${t.term_key}`);
  return out;
};

/**
 * 단서 키워드의 무리 키(설계 2.3절 1·2). ① 같은 장면·같은 열쇠·줄(±1) 겹침 출현의 공식 키가 하나
 * → ② 같은 장면·같은 열쇠 출현 전체의 공식 키가 하나 → ③ 전역 사전에서 하나 → ④ "vk:" + 열쇠.
 */
export const resolveClueKey = (u, { occIndex, dictionary }) => {
  const vk = variantKey(u.keyword);
  if (!vk) return { key: `item:${u.item_id}`, via: 'empty' };
  const occs = (occIndex.get(u.scene_id) ?? []).filter((o) => o.vk === vk);
  const keysOf = (list) => new Set(list.flatMap((o) => [...o.keys]));
  const near = keysOf(occs.filter((o) => isPositiveInt(o.line_start) && overlaps(o.line_start, o.line_end, u.line_start - 1, u.line_end + 1)));
  if (near.size === 1) return { key: [...near][0], via: 'a2_line' };
  const scene = keysOf(occs);
  if (near.size === 0 && scene.size === 1) return { key: [...scene][0], via: 'a2_scene' };
  const dict = dictionary.get(vk);
  if (near.size === 0 && scene.size === 0 && dict?.size === 1) return { key: [...dict][0], via: 'dictionary' };
  return { key: `vk:${vk}`, via: 'variant' };
};

// ---------------------------------------------------------------------------
// C-0 역방향 스캔(설계 2.5절)

const LATIN_CODE_RE = /^[A-Za-z0-9#\-_.]+$/;
const HANGUL_RE = /[가-힣]/;
const QUOTED_RE = /["“”'‘’「」『』[\]]([^"“”'‘’「」『』[\]\n]{2,20})["“”'‘’「」『』[\]]/g;
const CODE_RE = /[A-Za-z0-9][A-Za-z0-9#\-_.]*[A-Za-z0-9]/g;

/** 단서 하나의 검색어: 키워드, 인용·설명 안 따옴표·대괄호 어구, 영문·숫자 코드 */
export const termsOfUnit = (u) => {
  const out = new Map(); // term → kind
  const add = (t, kind) => {
    const term = String(t ?? '').trim();
    if (term.length < 2 || SCAN_STOPWORDS.has(term)) return;
    if (/^\d{1,2}$/.test(term)) return;
    if (!out.has(term)) out.set(term, kind);
  };
  add(u.keyword, LATIN_CODE_RE.test(u.keyword?.trim() ?? '') ? 'code' : 'keyword');
  const quoteText = String(u.quote ?? '').split('\n').map(extractUtteranceTextFromRawLine).filter(Boolean).join('\n');
  for (const src of [quoteText, u.detail]) {
    for (const m of String(src ?? '').matchAll(QUOTED_RE)) add(m[1], 'quoted');
    for (const m of String(src ?? '').matchAll(CODE_RE)) if (/[A-Za-z]/.test(m[0]) || m[0].length >= 3) add(m[0], 'code');
  }
  return out;
};

/** 두 글자 한글 검색어는 어절 앞에서만 맞춘다(`돌아서`의 `아서`를 막음) */
const boundaryOk = (term, text, at) => {
  if (LATIN_CODE_RE.test(term)) {
    const before = at > 0 ? text[at - 1] : '';
    const after = text[at + term.length] ?? '';
    return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
  }
  if (term.length === 2 && HANGUL_RE.test(term[0])) return at === 0 || !HANGUL_RE.test(text[at - 1]);
  return true;
};

/** 여러 검색어를 한 번에 찾는 자동자(Aho–Corasick) */
export const buildMatcher = (terms) => {
  const goto = [new Map()];
  const fail = [0];
  const outs = [[]];
  terms.forEach((t, ti) => {
    let s = 0;
    for (const ch of t) {
      if (!goto[s].has(ch)) {
        goto.push(new Map());
        fail.push(0);
        outs.push([]);
        goto[s].set(ch, goto.length - 1);
      }
      s = goto[s].get(ch);
    }
    outs[s].push(ti);
  });
  const queue = [];
  for (const s of goto[0].values()) queue.push(s);
  while (queue.length) {
    const r = queue.shift();
    for (const [ch, s] of goto[r]) {
      queue.push(s);
      let f = fail[r];
      while (f && !goto[f].has(ch)) f = fail[f];
      fail[s] = goto[f].has(ch) && goto[f].get(ch) !== s ? goto[f].get(ch) : 0;
      outs[s] = outs[s].concat(outs[fail[s]]);
    }
  }
  const lens = terms.map((t) => [...t].length);
  return (text) => {
    const found = []; // [termIndex, startIndex(code points)]
    const chars = [...text];
    let s = 0;
    chars.forEach((ch, i) => {
      while (s && !goto[s].has(ch)) s = fail[s];
      s = goto[s].get(ch) ?? 0;
      for (const ti of outs[s]) found.push([ti, i - lens[ti] + 1]);
    });
    return { found, chars };
  };
};

/**
 * 등록 원문 전체(대사·본문만, 제어 태그 제외)에서 검색어를 찾는다.
 * 반환: term → { scenes: Set, hits: [{scene_id, line}] }
 */
export const scanCorpus = (store, terms) => {
  const list = [...terms];
  const match = buildMatcher(list);
  const out = new Map(list.map((t) => [t, { scenes: new Set(), hits: [] }]));
  for (const sid of store.allSceneIds()) {
    const lines = store.lines(sid);
    for (let i = 1; i < lines.length; i++) {
      const text = extractUtteranceTextFromRawLine(lines[i]);
      if (!text) continue;
      const { found, chars } = match(text);
      const seen = new Set();
      const str = chars.join('');
      for (const [ti, at] of found) {
        if (seen.has(ti)) continue;
        const term = list[ti];
        // 코드 포인트 위치 → 문자열 위치
        const pos = chars.slice(0, at).join('').length;
        if (!boundaryOk(term, str, pos)) continue;
        seen.add(ti);
        const r = out.get(term);
        r.scenes.add(sid);
        r.hits.push({ scene_id: sid, line: i });
      }
    }
  }
  return out;
};

/**
 * 단서마다 C-0 적중 줄을 고른다. 자기 장면은 뺀다(같은 장면 짝은 잇지 않는다).
 * 더 긴 검색어(같은 단서) 안에만 든 적중은 뺀다. 검색어마다 다른 이야기 15줄·같은 이야기 20줄.
 */
export const selectScanHits = (u, terms, scan, { store, termLimit }) => {
  const hits = new Map(); // `${scene}:${line}` → {scene_id, line, terms:Set}
  const dropped = [];
  const kept = [];
  const termList = [...terms.keys()];
  for (const [term, kind] of terms) {
    const r = scan.get(term);
    if (!r) continue;
    const limit = termLimit(term, kind);
    if (r.scenes.size > limit) {
      dropped.push({ term, kind, scene_count: r.scenes.size });
      continue;
    }
    const longer = termList.filter((t) => t !== term && t.includes(term));
    let other = 0;
    let same = 0;
    let used = 0;
    for (const h of r.hits) {
      if (h.scene_id === u.scene_id) continue;
      if (longer.length) {
        const text = extractUtteranceTextFromRawLine(store.lines(h.scene_id)[h.line]);
        if (longer.some((t) => text.includes(t))) continue;
      }
      const sameTitle = store.meta(h.scene_id)?.title_id === u.title_id;
      if (sameTitle ? same >= SCAN_LINES_SAME_TITLE : other >= SCAN_LINES_OTHER_TITLE) continue;
      if (sameTitle) same += 1;
      else other += 1;
      const k = `${h.scene_id}:${h.line}`;
      if (!hits.has(k)) hits.set(k, { scene_id: h.scene_id, line: h.line, terms: new Set() });
      hits.get(k).terms.add(term);
      used += 1;
    }
    if (used) kept.push({ term, kind, scene_count: r.scenes.size, lines: used });
  }
  const list = [...hits.values()].sort((a, b) => (store.sceneOrder?.get(a.scene_id) ?? 0) - (store.sceneOrder?.get(b.scene_id) ?? 0) || a.line - b.line);
  return { hits: list, kept, dropped };
};

// ---------------------------------------------------------------------------
// 발췌

export const unitHeader = (u) => `### ${u.item_id} L${u.line_start}-L${u.line_end} | ${u.clue_category} | ${u.subject ?? '-'} | ${u.keyword}`;

/** 단서 하나의 발췌 블록. scanLines: [{scan_id, scene_id, line, title_id, text}] */
export const unitBlock = (u, store, scanLines = []) => {
  const lines = store.lines(u.scene_id) ?? [''];
  const meta = store.meta(u.scene_id) ?? {};
  const out = [unitHeader(u), `@@@ ${u.scene_id} | ${u.title_id} | ${meta.sub_title ?? ''}`];
  const a = Math.max(1, u.line_start - EXCERPT_RADIUS);
  const b = Math.min(lines.length - 1, u.line_end + EXCERPT_RADIUS);
  for (let n = a; n <= b; n++) out.push(`[${lineTag(n)}] ${lines[n] ?? ''}`);
  for (const h of scanLines.slice(0, SCAN_LINES_IN_EXCERPT)) out.push(`~ C-0 ${h.scan_id} ${h.scene_id} ${lineTag(h.line)} (${h.title_id}) ${String(h.text).slice(0, 160)}`);
  if (scanLines.length > SCAN_LINES_IN_EXCERPT) out.push(`~ C-0 ${scanLines.length - SCAN_LINES_IN_EXCERPT}줄 더: cand로 본다`);
  return `${out.join('\n')}\n`;
};

/** 묶음 밖 단서 색인 한 줄(설계 R5): item_id, scene_id, 줄, 분류, subject, keyword를 탭으로 */
export const clueIndexLine = (u) => [u.item_id, u.scene_id, `L${u.line_start}-L${u.line_end}`, u.clue_category, u.subject ?? '-', u.keyword].map((x) => String(x).replace(/[\t\n]/g, ' ')).join('\t');

// ---------------------------------------------------------------------------
// 묶음 나누기(설계 2.3절)

/**
 * 1단계: 이야기 둘 이상에 걸친 키 무리. 2단계: 남은 단서를 이야기 순서로.
 * units에는 key, chars가 있어야 한다. titleOrder: title_id 배열(매니페스트 순서).
 * 반환: [{ stage, units: [unit], titles: [title_id] }]
 */
export const packBundles = (units, { titleOrder, maxUnits = MAX_UNITS, maxChars = MAX_CHARS, maxGroup = MAX_GROUP_UNITS }) => {
  const byKey = new Map();
  for (const u of units) {
    if (!byKey.has(u.key)) byKey.set(u.key, []);
    byKey.get(u.key).push(u);
  }
  const order = (a, b) => a.scene_order - b.scene_order || a.line_start - b.line_start || cmpStr(a.item_id, b.item_id);
  const groups = [...byKey.entries()]
    .map(([key, list]) => ({ key, units: list.sort(order), titles: new Set(list.map((u) => u.title_id)) }))
    .filter((g) => g.titles.size >= 2)
    .sort((a, b) => b.titles.size - a.titles.size || b.units.length - a.units.length || cmpStr(a.key, b.key));
  const bundles = [];
  const sum = (list) => list.reduce((n, u) => n + u.chars, 0);
  let cur = null;
  const stage1 = new Set();
  for (const g of groups) {
    const gChars = sum(g.units);
    // 한 무리가 상한을 넘으면 maxGroup까지는 혼자 두고, 그래도 넘으면 나눈다
    if (g.units.length > maxUnits || gChars > maxChars) {
      const parts = [];
      for (let i = 0; i < g.units.length; i += maxGroup) parts.push(g.units.slice(i, i + maxGroup));
      for (const p of parts) bundles.push({ stage: 1, units: p, keys: [g.key] });
      cur = null;
    } else {
      if (!cur || cur.units.length + g.units.length > maxUnits || sum(cur.units) + gChars > maxChars) {
        cur = { stage: 1, units: [], keys: [] };
        bundles.push(cur);
      }
      cur.units.push(...g.units);
      cur.keys.push(g.key);
    }
    for (const u of g.units) stage1.add(u.item_id);
  }
  const rest = new Map();
  for (const u of units) {
    if (stage1.has(u.item_id)) continue;
    if (!rest.has(u.title_id)) rest.set(u.title_id, []);
    rest.get(u.title_id).push(u);
  }
  let small = null;
  for (const t of titleOrder) {
    const list = rest.get(t);
    if (!list?.length) continue;
    list.sort(order);
    const chars = sum(list);
    if (list.length > maxUnits || chars > maxChars) {
      small = null; // 큰 이야기를 만나면 열린 작은 이야기 묶음을 닫는다
      // 장면 경계를 지키며 자른다
      const scenes = [];
      for (const u of list) {
        if (!scenes.length || scenes.at(-1)[0].scene_id !== u.scene_id) scenes.push([]);
        scenes.at(-1).push(u);
      }
      let piece = null;
      for (const s of scenes) {
        if (!piece || (piece.units.length && (piece.units.length + s.length > maxUnits || sum(piece.units) + sum(s) > maxChars))) {
          piece = { stage: 2, units: [], big: true };
          bundles.push(piece);
        }
        piece.units.push(...s);
      }
    } else {
      if (!small || small.units.length + list.length > maxUnits || sum(small.units) + chars > maxChars) {
        small = { stage: 2, units: [], big: false };
        bundles.push(small);
      }
      small.units.push(...list);
    }
  }
  const missing = units.length - bundles.reduce((n, b) => n + b.units.length, 0);
  if (missing !== 0) throw new Error(`묶음에 넣지 않은 단서 ${missing}건`);
  for (const b of bundles) b.titles = [...new Set(b.units.map((u) => u.title_id))];
  return bundles;
};

/**
 * 묶음 밖 단서 색인(설계 2.3절). 2단계: 묶음에 든 이야기의 묶음 밖 단서 전부.
 * 1단계: 같은 이야기의 다른 1단계 단서 + 단위와 같은 장면이거나 힌트로 이어진 장면의 2단계 단서.
 * 반환: bundle index → [unit]
 */
export const storyOtherClues = (bundles, units, hintLinks) => {
  const bundleOf = new Map();
  bundles.forEach((b, i) => b.units.forEach((u) => bundleOf.set(u.item_id, i)));
  const byTitle = new Map();
  for (const u of units) {
    if (!byTitle.has(u.title_id)) byTitle.set(u.title_id, []);
    byTitle.get(u.title_id).push(u);
  }
  const order = (a, b) => a.scene_order - b.scene_order || a.line_start - b.line_start || cmpStr(a.item_id, b.item_id);
  return bundles.map((b, i) => {
    const out = new Map();
    if (b.stage === 2) {
      for (const t of b.titles) for (const v of byTitle.get(t) ?? []) if (bundleOf.get(v.item_id) !== i) out.set(v.item_id, v);
    } else {
      for (const u of b.units) {
        const near = new Set([u.scene_id, ...(hintLinks.get(u.scene_id) ?? [])]);
        for (const v of byTitle.get(u.title_id) ?? []) {
          if (bundleOf.get(v.item_id) === i) continue;
          const vStage = bundles[bundleOf.get(v.item_id)].stage;
          if (vStage === 1 || near.has(v.scene_id)) out.set(v.item_id, v);
        }
      }
    }
    return [...out.values()].sort(order);
  });
};

/**
 * 노출 불변식(설계 G8): 같은 이야기의 다른 장면 단서 쌍 (u, v)마다, u의 묶음이 v를 보거나 v의 묶음이 u를 본다.
 * 반환: { pairs: {"1-1", "1-2", "2-2"}, missing: [[u, v]] }
 */
export const checkExposure = (bundles, others) => {
  const bundleOf = new Map();
  const stageOf = new Map();
  const sees = bundles.map((b, i) => new Set([...b.units.map((u) => u.item_id), ...others[i].map((v) => v.item_id)]));
  bundles.forEach((b, i) => b.units.forEach((u) => {
    bundleOf.set(u.item_id, i);
    stageOf.set(u.item_id, b.stage);
  }));
  const byTitle = new Map();
  for (const b of bundles) for (const u of b.units) {
    if (!byTitle.has(u.title_id)) byTitle.set(u.title_id, []);
    byTitle.get(u.title_id).push(u);
  }
  const pairs = { '1-1': 0, '1-2': 0, '2-2': 0 };
  const missing = [];
  for (const list of byTitle.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const u = list[x];
        const v = list[y];
        if (u.scene_id === v.scene_id) continue;
        const k = [stageOf.get(u.item_id), stageOf.get(v.item_id)].sort().join('-');
        pairs[k] += 1;
        if (!sees[bundleOf.get(u.item_id)].has(v.item_id) && !sees[bundleOf.get(v.item_id)].has(u.item_id)) missing.push([u.item_id, v.item_id]);
      }
    }
  }
  return { pairs, missing };
};

// ---------------------------------------------------------------------------
// 제시 쌍(설계 2.4절): 단위당 3개·묶음당 40개, 우선순위 ①~④

/**
 * candidates: [{unit, other: {ref, ...}, priority, source, cross_title}] → 고른 쌍(pair_id 붙임)
 * 같은 두 대상(무방향)은 한 번만.
 */
export const selectPairs = (bundleId, candidates, { perUnit = PAIRS_PER_UNIT, perBundle = PAIRS_PER_BUNDLE } = {}) => {
  const endKey = (o) => (o.ref === 'item' ? `item:${o.item_id}` : `lines:${o.scan_id}`);
  const sorted = candidates.toSorted((a, b) => a.priority - b.priority || (a.rank ?? 0) - (b.rank ?? 0) || cmpStr(a.unit, b.unit) || cmpStr(endKey(a.other), endKey(b.other)));
  const perUnitCount = new Map();
  const seen = new Set();
  const out = [];
  for (const c of sorted) {
    if (out.length >= perBundle) break;
    const pk = [`item:${c.unit}`, endKey(c.other)].sort().join('|');
    if (seen.has(pk)) continue;
    if ((perUnitCount.get(c.unit) ?? 0) >= perUnit) continue;
    seen.add(pk);
    perUnitCount.set(c.unit, (perUnitCount.get(c.unit) ?? 0) + 1);
    out.push({ pair_id: `${bundleId}__P${pad(out.length + 1, 2)}`, unit: c.unit, other: c.other, source: c.source, cross_title: c.cross_title });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 검증기(설계 2.7절, 4.2절)

const LINK_KEYS = new Set(['link_id', 'link_type', 'subject', 'target', 'roles', 'verdict', 'confidence', 'rationale', 'supporting_evidence', 'contradicting_evidence', 'search_hints']);
const MERGER_ONLY = new Set(['evidence_scenes', 'release_order', 'overlapping_items', 'normalized']);
const OTHER_KIND_ONLY = new Set(['scope', 'alternatives', 'reveals_identity']);
const MERGE_KEYS = new Set(['suggestion_id', 'unit_ids', 'link_ids', 'targets', 'confidence', 'rationale', 'supporting_evidence']);

/** 연결 한 끝의 장면·줄 범위. item은 그 단서의 범위 */
export const endRange = (ref, clhById) => {
  if (ref?.ref === 'item') {
    const c = clhById.get(ref.item_id);
    return c ? { scene_id: c.scene_id, line_start: c.line_start, line_end: c.line_end } : null;
  }
  if (ref?.ref === 'lines') return { scene_id: ref.scene_id, line_start: ref.line_start, line_end: ref.line_end };
  return null;
};

export const RATIONALE_PARTS = ['질문:', '답:', '근거:'];

/** 끝 하나를 비교할 열쇠들: item은 그 단서, lines는 scan_id와 정규화 결과(단서 하나 안에 완전히 들면 그 단서) */
export const endKeys = (ref, clhByScene) => {
  if (ref?.ref === 'item') return [`item:${ref.item_id}`];
  if (ref?.ref !== 'lines') return [];
  const keys = [];
  if (ref.scan_id) keys.push(`scan:${ref.scan_id}`);
  if (clhByScene && isPositiveInt(ref.line_start) && isPositiveInt(ref.line_end)) keys.push(normalizeEnd(ref, clhByScene).key);
  return keys;
};

/** 근거 하나가 끝 범위를 뒷받침하는가(설계 R3): 같은 장면, [S,T]와 겹치고, 신고 범위가 [S-2,T+2] 안 */
export const evidenceSupportsEnd = (ev, end) => Boolean(ev && end && ev.scene_id === end.scene_id
  && isPositiveInt(ev.line_start) && isPositiveInt(ev.line_end)
  && overlaps(ev.line_start, ev.line_end, end.line_start, end.line_end)
  && ev.line_start >= end.line_start - EXCERPT_RADIUS && ev.line_end <= end.line_end + EXCERPT_RADIUS);

/** 한 연결에서 단서 쪽에 선 단위(roles.clue, 방향 미정 보류는 양쪽) */
export const clueSideIds = (link) => {
  if (link?.verdict === '다른 대상') return [];
  const ids = (side) => (link?.[side] ?? []).filter((r) => r?.ref === 'item').map((r) => r.item_id);
  if (link?.roles && (link.roles.clue === 'subject' || link.roles.clue === 'target')) return ids(link.roles.clue);
  if (link?.verdict === '판단 보류') return [...ids('subject'), ...ids('target')];
  return [];
};
export const revealSideIds = (link) => {
  if (link?.verdict === '다른 대상' || !link?.roles) return [];
  const side = link.roles.reveal;
  return (link?.[side] ?? []).filter((r) => r?.ref === 'item').map((r) => r.item_id);
};

/**
 * ctx: { store, clhById(item_id → unit), registry, pass2Entities, termKeys:Set, scanById(bundle 후보 scan_id → hit), releaseDates }
 */
export const validateCShard = (shard, bundle, ctx) => {
  const errors = [];
  const warnings = [];
  const err = (code, p, message) => errors.push({ code, path: p, message });
  const warn = (code, p, message) => warnings.push({ code, path: p, message });
  if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
    err('SCHEMA', '$', '출력은 JSON 객체여야 한다');
    return { errors, warnings };
  }
  for (const k of Object.keys(shard)) {
    if (!['schema_version', 'bundle_id', 'candidate_links', 'unlinked', 'merge_suggestions'].includes(k)) err('SCHEMA', k, `알 수 없는 필드 ${k}`);
  }
  if (shard.schema_version !== PASS2_SCHEMA_VERSION) err('SCHEMA', 'schema_version', `schema_version은 "${PASS2_SCHEMA_VERSION}"이어야 한다`);
  if (shard.bundle_id !== bundle.bundle_id) err('SCHEMA', 'bundle_id', `bundle_id는 "${bundle.bundle_id}"이어야 한다`);
  if (!Array.isArray(shard.candidate_links)) err('SCHEMA', 'candidate_links', 'candidate_links는 배열이어야 한다(없으면 [])');
  if (!Array.isArray(shard.unlinked)) err('SCHEMA', 'unlinked', 'unlinked는 배열이어야 한다(없으면 [])');
  if (shard.merge_suggestions !== undefined && !Array.isArray(shard.merge_suggestions)) err('SCHEMA', 'merge_suggestions', 'merge_suggestions는 배열이다(없으면 쓰지 않거나 [])');
  if (errors.length) return { errors, warnings };

  const units = new Set(bundle.units.map((u) => u.item_id));
  // 제시 쌍과 기각 연결은 같은 정규화로 맞춘다(단서 하나 안에 완전히 든 lines = 그 단서, scan_id도 같은 줄)
  const pairKeys = new Set();
  for (const p of bundle.suggested_pairs ?? []) {
    for (const a of endKeys({ ref: 'item', item_id: p.unit }, ctx.clhByScene)) for (const b of endKeys(p.other, ctx.clhByScene)) pairKeys.add([a, b].sort().join('|'));
  }
  const esc = bundle.bundle_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idRe = new RegExp(`^${esc}__(?!000)\\d{3}$`);
  const suggestionRe = new RegExp(`^${esc}__M(?!00)\\d{2}$`);
  const linkIds = new Set();
  const pairSeen = new Map();
  const clueLinked = new Set(); // 단서 쪽으로 긍정 연결된 자기 단위
  const touched = new Set(); // 어떤 연결에든 나온 자기 단위

  const checkEvidence = (ev, p) => {
    if (!ev || typeof ev !== 'object') return err('SCHEMA', p, '근거는 객체여야 한다');
    for (const k of Object.keys(ev)) if (!['scene_id', 'line_start', 'line_end', 'quote'].includes(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    if (!isNonEmptyString(ev.scene_id) || !ctx.store.has(ev.scene_id)) return err('EVIDENCE_SCENE', `${p}.scene_id`, `등록 장면이 아니다: ${ev.scene_id}`);
    const why = checkQuote(ctx.store.lines(ev.scene_id), ev.line_start, ev.line_end, ev.quote);
    if (why) err('QUOTE_LOCATION', `${p}.quote`, `${ev.scene_id}: ${why}`);
  };
  const checkRef = (r, p) => {
    if (!r || typeof r !== 'object') return err('REFERENCE', p, '참조는 객체다');
    if (r.ref === 'item') {
      for (const k of Object.keys(r)) if (!['ref', 'item_id'].includes(k)) err('REFERENCE', `${p}.${k}`, `item 참조에는 ref·item_id만 적는다`);
      if (!isNonEmptyString(r.item_id) || !CLH_RE.test(r.item_id) || !ctx.clhById.has(r.item_id)) return err('REFERENCE', `${p}.item_id`, `by_title에 없는 단서 항목이다: ${r.item_id}. 단서(__clh_)가 아닌 줄은 ref: "lines"로 적는다`);
      return;
    }
    if (r.ref === 'lines') {
      for (const k of Object.keys(r)) if (!['ref', 'scene_id', 'line_start', 'line_end', 'scan_id'].includes(k)) err('REFERENCE', `${p}.${k}`, `lines 참조에는 ref·scene_id·line_start·line_end·scan_id만 적는다`);
      if (!isNonEmptyString(r.scene_id) || !ctx.store.has(r.scene_id)) return err('REFERENCE', `${p}.scene_id`, `등록 장면이 아니다: ${r.scene_id}`);
      const total = ctx.store.lines(r.scene_id).length - 1;
      if (!isPositiveInt(r.line_start) || !isPositiveInt(r.line_end) || r.line_start > r.line_end || r.line_end > total) return err('REFERENCE', p, `줄 범위는 1 ≤ line_start ≤ line_end ≤ ${total}인 정수다`);
      if (r.line_end - r.line_start + 1 > MAX_LINES_REF) err('LINES_TOO_WIDE', p, `lines 범위는 ${MAX_LINES_REF}줄까지다. 공개가 드러나는 줄만 적는다`);
      if (r.scan_id !== null && r.scan_id !== undefined) {
        const hit = ctx.scanById?.get(r.scan_id);
        if (!hit) err('REFERENCE', `${p}.scan_id`, `묶음 후보에 없는 scan_id: ${r.scan_id}. 직접 찾은 줄이면 scan_id: null`);
        else if (hit.scene_id !== r.scene_id || hit.line < r.line_start || hit.line > r.line_end) err('REFERENCE', `${p}.scan_id`, `${r.scan_id}는 ${hit.scene_id} ${lineTag(hit.line)}이다. 범위가 그 줄을 담아야 한다`);
      } else if (!('scan_id' in r)) err('REFERENCE', `${p}.scan_id`, 'scan_id를 적는다(직접 찾은 줄이면 null)');
      return;
    }
    err('REFERENCE', `${p}.ref`, 'ref는 item | lines다');
  };

  shard.candidate_links.forEach((link, i) => {
    const p = `candidate_links[${i}]`;
    if (!link || typeof link !== 'object') return err('SCHEMA', p, '연결은 객체여야 한다');
    for (const k of Object.keys(link)) {
      if (MERGER_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, `${k}는 병합기가 붙인다`);
      else if (OTHER_KIND_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, `${k}는 C에서 쓰지 않는다`);
      else if (!LINK_KEYS.has(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    }
    for (const k of LINK_KEYS) if (!(k in link)) err('SCHEMA', `${p}.${k}`, `필수 필드 ${k}가 없다`);
    if (!isNonEmptyString(link.link_id) || !idRe.test(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id는 "${bundle.bundle_id}__001" 형식이다`);
    else if (linkIds.has(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id 중복: ${link.link_id}`);
    else linkIds.add(link.link_id);
    if (link.link_type !== 'hook') err('ENUM', `${p}.link_type`, 'link_type은 hook이다');
    if (!C_VERDICTS.has(link.verdict)) err('ENUM', `${p}.verdict`, `verdict는 ${[...C_VERDICTS].join(' | ')} 중 하나다`);
    if (link.confidence === '확인된 사실') err('FORBIDDEN_CONFIDENCE', `${p}.confidence`, 'Pass 2에서는 확인된 사실을 쓰지 않는다');
    else if (!CONFIDENCE_ENUM.has(link.confidence)) err('ENUM', `${p}.confidence`, `confidence는 ${[...CONFIDENCE_ENUM].join(' | ')} 중 하나다`);
    else if ((link.verdict === '판단 보류') !== (link.confidence === '판단 보류')) err('VERDICT', `${p}.confidence`, '판단 보류일 때만 confidence가 판단 보류다');

    const ends = {};
    for (const side of ['subject', 'target']) {
      if (!Array.isArray(link[side]) || link[side].length !== 1) {
        err('SCHEMA', `${p}.${side}`, `${side}는 참조 하나의 배열이다`);
        continue;
      }
      checkRef(link[side][0], `${p}.${side}[0]`);
      ends[side] = link[side][0];
    }
    const ownSide = ['subject', 'target'].filter((s) => ends[s]?.ref === 'item' && units.has(ends[s].item_id));
    if (ends.subject && ends.target && !ownSide.length) err('REFERENCE', p, '양쪽 중 하나는 이 묶음의 단위(units)여야 한다');
    const rs = endRange(ends.subject, ctx.clhById);
    const rt = endRange(ends.target, ctx.clhById);
    if (rs && rt) {
      if (rs.scene_id === rt.scene_id) err('SAME_SCENE_LINK', p, `같은 장면(${rs.scene_id})끼리는 잇지 않는다`);
      const kOf = (r) => (r.ref === 'item' ? `item:${r.item_id}` : `lines:${r.scene_id}:${r.line_start}-${r.line_end}`);
      const ka = kOf(ends.subject);
      const kb = kOf(ends.target);
      if (ka === kb) err('SELF_OR_DUPLICATE_PAIR', p, '자기 자신과 잇지 않는다');
      const pk = [ka, kb].sort().join('|');
      if (pairSeen.has(pk)) err('SELF_OR_DUPLICATE_PAIR', p, `${pairSeen.get(pk)}와 같은 쌍이다`);
      else pairSeen.set(pk, link.link_id ?? p);
    }
    // roles
    const roles = link.roles;
    if (link.verdict === '같은 대상') {
      if (!roles || typeof roles !== 'object' || !((roles.clue === 'subject' && roles.reveal === 'target') || (roles.clue === 'target' && roles.reveal === 'subject')) || Object.keys(roles).length !== 2) err('ROLES', `${p}.roles`, '같은 대상은 roles가 {"clue": "subject", "reveal": "target"} 또는 그 반대다');
    } else if (link.verdict === '다른 대상') {
      if (roles !== null) err('ROLES', `${p}.roles`, '다른 대상은 roles: null이다');
    } else if (link.verdict === '판단 보류' && roles !== null) {
      if (!roles || typeof roles !== 'object' || !((roles.clue === 'subject' && roles.reveal === 'target') || (roles.clue === 'target' && roles.reveal === 'subject')) || Object.keys(roles).length !== 2) err('ROLES', `${p}.roles`, '판단 보류의 roles는 방향을 알면 같은 대상과 같은 형식, 모르면 null이다');
    }
    // 다른 대상은 제시 쌍에만
    if (link.verdict === '다른 대상' && ends.subject && ends.target) {
      const ka = endKeys(ends.subject, ctx.clhByScene);
      const kb = endKeys(ends.target, ctx.clhByScene);
      if (!ka.some((a) => kb.some((b) => pairKeys.has([a, b].sort().join('|'))))) err('UNSOLICITED_REJECTION', p, '다른 대상은 묶음의 suggested_pairs를 기각할 때만 적는다');
    }
    for (const s of ownSide) touched.add(ends[s].item_id);
    if (link.verdict !== '다른 대상') for (const id of clueSideIds(link)) if (units.has(id)) clueLinked.add(id);

    // 근거
    const evs = Array.isArray(link.supporting_evidence) ? link.supporting_evidence : [];
    if (!evs.length) err('EVIDENCE', `${p}.supporting_evidence`, 'supporting_evidence는 비울 수 없다');
    evs.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
    if (link.verdict !== '다른 대상') {
      for (const [side, r] of [['subject', rs], ['target', rt]]) {
        if (r && !evs.some((ev) => evidenceSupportsEnd(ev, r))) err('BOTH_SIDES_EVIDENCE', `${p}.supporting_evidence`, `${side} 쪽(${r.scene_id} L${r.line_start}-L${r.line_end})과 겹치고 그 앞뒤 2줄 안에 드는 인용이 하나 이상 있어야 한다`);
      }
    }
    if (!Array.isArray(link.contradicting_evidence)) err('SCHEMA', `${p}.contradicting_evidence`, 'contradicting_evidence는 배열이다(없으면 [])');
    else link.contradicting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.contradicting_evidence[${j}]`));
    if (!Array.isArray(link.search_hints) || link.search_hints.some((h) => typeof h !== 'string')) err('SCHEMA', `${p}.search_hints`, 'search_hints는 문자열 배열이다(없으면 [])');
    if (!isNonEmptyString(link.rationale)) err('SCHEMA', `${p}.rationale`, 'rationale에 판정 이유를 적는다');
    else if (link.verdict !== '다른 대상' && !RATIONALE_PARTS.every((k) => link.rationale.includes(k))) err('RATIONALE_FORM', `${p}.rationale`, `같은 대상·판단 보류의 rationale에는 ${RATIONALE_PARTS.join(' / ')}를 모두 적는다(규칙 3.4절)`);
    // 공개 순서 경고
    if (link.verdict === '같은 대상' && rs && rt && ctx.releaseDates) {
      const clue = roles?.clue === 'subject' ? rs : rt;
      const reveal = roles?.clue === 'subject' ? rt : rs;
      const ct = ctx.store.meta(clue.scene_id)?.title_id;
      const rtt = ctx.store.meta(reveal.scene_id)?.title_id;
      if (ct && rtt && ct !== rtt && compareRelease(ctx.releaseDates, ct, rtt).result === '공개 먼저') warn('CLUE_RELEASED_AFTER_REVEAL', p, `단서 쪽 ${ct}가 공개 쪽 ${rtt}보다 늦게 공개됐다. 방향(roles)을 다시 확인한다(회상·프리퀄이면 그대로 둔다)`);
    }
  });

  // unlinked: 단서 쪽 긍정 연결이 없는 자기 단위의 자기 상태
  const unlinkedIds = new Set();
  shard.unlinked.forEach((x, i) => {
    const p = `unlinked[${i}]`;
    if (!x || typeof x !== 'object') return err('SCHEMA', p, '객체여야 한다');
    for (const k of Object.keys(x)) if (!['item_id', 'reason', 'note'].includes(k)) err('SCHEMA', `${p}.${k}`, `unlinked에는 item_id·reason·note만 적는다`);
    if (!units.has(x.item_id)) return err('REFERENCE', `${p}.item_id`, `이 묶음의 단위가 아니다: ${x.item_id}`);
    if (!UNLINKED_REASONS.has(x.reason)) err('ENUM', `${p}.reason`, `reason은 ${[...UNLINKED_REASONS].join(' | ')} 중 하나다`);
    if (x.reason === '짝 없음' && !isNonEmptyString(x.note)) err('UNLINKED_NOTE', `${p}.note`, '짝 없음에는 note에 남은 의문을 적는다(규칙 3.5절)');
    if (x.note !== undefined && typeof x.note !== 'string') err('SCHEMA', `${p}.note`, 'note는 문자열이다');
    if (unlinkedIds.has(x.item_id)) err('SCHEMA', `${p}.item_id`, `중복: ${x.item_id}`);
    unlinkedIds.add(x.item_id);
    // 단서 쪽으로 이은 단위는 남은 의문(짝 없음)만 따로 적을 수 있다
    if (clueLinked.has(x.item_id) && x.reason !== '짝 없음') err('LINKED_AND_UNLINKED', p, `${x.item_id}는 단서 쪽으로 이었다. unlinked에는 다른 연결로 풀리지 않은 의문이 남을 때만 짝 없음으로 적는다`);
  });
  for (const id of units) if (!clueLinked.has(id) && !unlinkedIds.has(id)) err('UNIT_NOT_COVERED', id, `${id}: 단서 쪽 연결도 unlinked도 없다`);

  // 병합 제안
  const suggestionIds = new Set();
  (shard.merge_suggestions ?? []).forEach((m, i) => {
    const p = `merge_suggestions[${i}]`;
    if (!m || typeof m !== 'object') return err('MERGE_SUGGESTION', p, '객체여야 한다');
    for (const k of Object.keys(m)) if (!MERGE_KEYS.has(k)) err('MERGE_SUGGESTION', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    if (!isNonEmptyString(m.suggestion_id) || !suggestionRe.test(m.suggestion_id)) err('MERGE_SUGGESTION', `${p}.suggestion_id`, `suggestion_id는 "${bundle.bundle_id}__M01" 형식이다`);
    else if (suggestionIds.has(m.suggestion_id)) err('MERGE_SUGGESTION', `${p}.suggestion_id`, `suggestion_id 중복: ${m.suggestion_id}`);
    else suggestionIds.add(m.suggestion_id);
    if (!Array.isArray(m.unit_ids) || !m.unit_ids.length || m.unit_ids.some((id) => !units.has(id))) err('MERGE_SUGGESTION', `${p}.unit_ids`, 'unit_ids는 이 묶음 단위 하나 이상이다');
    if (!Array.isArray(m.link_ids) || m.link_ids.some((id) => !linkIds.has(id))) err('MERGE_SUGGESTION', `${p}.link_ids`, 'link_ids는 이 출력의 link_id 배열이다(없으면 [])');
    if (!Array.isArray(m.targets) || m.targets.length < 2) err('MERGE_SUGGESTION', `${p}.targets`, 'targets는 둘 이상이다');
    else m.targets.forEach((t, j) => {
      const tp = `${p}.targets[${j}]`;
      if (!t || !['entity', 'term', 'surface'].includes(t.kind)) return err('MERGE_SUGGESTION', `${tp}.kind`, 'kind는 entity | term | surface다');
      if (!isNonEmptyString(t.name)) err('MERGE_SUGGESTION', `${tp}.name`, 'name을 적는다');
      if (t.kind === 'entity' && !(ctx.registry.has(t.id) || ctx.pass2Entities.has(t.id))) err('MERGE_SUGGESTION', `${tp}.id`, `레지스트리·공식 표에 없는 ID: ${t.id}`);
      if (t.kind === 'term' && !ctx.termKeys.has(t.id)) err('MERGE_SUGGESTION', `${tp}.id`, `공식 표기 묶음에 없는 term_key: ${t.id}`);
      if (t.kind === 'surface' && t.id !== null) err('MERGE_SUGGESTION', `${tp}.id`, 'surface는 id: null이다');
    });
    if (!['유력한 해석', '가능성'].includes(m.confidence)) err('MERGE_SUGGESTION', `${p}.confidence`, 'confidence는 유력한 해석 | 가능성이다');
    if (!isNonEmptyString(m.rationale)) err('MERGE_SUGGESTION', `${p}.rationale`, 'rationale을 적는다');
    if (!Array.isArray(m.supporting_evidence) || !m.supporting_evidence.length) err('MERGE_SUGGESTION', `${p}.supporting_evidence`, '원문 근거를 하나 이상 적는다');
    else m.supporting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
    const ids = (m.targets ?? []).map((t) => t?.id).filter(Boolean);
    if (ids.length >= 2 && new Set(ids).size === 1) warn('MERGE_SAME_ID', p, '이미 같은 ID인 대상을 올렸다');
  });
  return { errors, warnings };
};

// ---------------------------------------------------------------------------
// 병합(설계 2.2절): 정규화, 최종 상태, 충돌

/** lines 끝이 단서 하나의 범위 안에 완전히 들고 같은 장면의 다른 단서와 겹치지 않으면 그 단서로 본다(설계 G4) */
export const normalizeEnd = (ref, clhByScene) => {
  if (ref.ref === 'item') return { key: `item:${ref.item_id}`, item_id: ref.item_id, partial: [] };
  const list = clhByScene.get(ref.scene_id) ?? [];
  const touching = list.filter((c) => overlaps(c.line_start, c.line_end, ref.line_start, ref.line_end));
  if (touching.length === 1 && touching[0].line_start <= ref.line_start && ref.line_end <= touching[0].line_end) {
    return { key: `item:${touching[0].item_id}`, item_id: touching[0].item_id, from_lines: true, partial: [] };
  }
  return { key: `lines:${ref.scene_id}:${ref.line_start}-${ref.line_end}`, item_id: null, partial: touching.map((c) => c.item_id) };
};

const confRank = { '유력한 해석': 2, 가능성: 1, '판단 보류': 0 };

/**
 * entries: [{ bundle, shard, wave }] 통과한 출력. judged: 이 실행에서 판정한 단위(item_id → {bundle_id, wave, stage, clue_category})
 * 반환: links(정규화·중복 병합), statuses(item_id → {status, conf, ...}), conflicts, mergeSuggestions
 */
export const mergeC = ({ entries, judged, clhByScene }) => {
  const raw = [];
  const unlinked = new Map();
  const mergeSuggestions = [];
  for (const { bundle, shard, wave } of entries) {
    for (const l of shard.candidate_links) {
      const s = normalizeEnd(l.subject[0], clhByScene);
      const t = normalizeEnd(l.target[0], clhByScene);
      raw.push({ ...l, bundle_id: bundle.bundle_id, wave, normalized: { subject: s, target: t } });
    }
    for (const x of shard.unlinked) unlinked.set(x.item_id, { reason: x.reason, note: x.note ?? null, bundle_id: bundle.bundle_id, wave });
    for (const m of shard.merge_suggestions ?? []) mergeSuggestions.push({ ...m, bundle_id: bundle.bundle_id, wave });
  }
  const sideKey = (l, side) => l.normalized[side].key;
  const clueKeyOf = (l) => (l.roles ? sideKey(l, l.roles.clue) : null);
  const pairKey = (l) => [sideKey(l, 'subject'), sideKey(l, 'target')].sort().join('|');

  // 쌍 충돌·중복
  const byPair = new Map();
  for (const l of raw) {
    const k = pairKey(l);
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(l);
  }
  const conflicts = [];
  const links = [];
  for (const [k, list] of byPair) {
    const bundles = new Set(list.map((l) => l.bundle_id));
    const sig = (l) => `${l.verdict}|${l.verdict === '다른 대상' ? '-' : clueKeyOf(l) ?? 'null'}`;
    if (bundles.size > 1 && new Set(list.map(sig)).size > 1) {
      conflicts.push({ kind: 'pair', pair: k, links: list.map((l) => ({ link_id: l.link_id, bundle_id: l.bundle_id, wave: l.wave, verdict: l.verdict, clue: clueKeyOf(l) })) });
      links.push(...list.map((l) => ({ ...l, conflict: true })));
      continue;
    }
    const [first, ...more] = list;
    if (!more.length) {
      links.push(first);
      continue;
    }
    const conf = list.toSorted((a, b) => confRank[a.confidence] - confRank[b.confidence])[0].confidence;
    links.push({ ...first, confidence: conf, merged_from: list.map((l) => l.link_id), supporting_evidence: [...first.supporting_evidence, ...more.flatMap((l) => l.supporting_evidence)] });
  }
  // 일부만 겹치는 lines: 다른 묶음 연결이 겹친 단서와 같은 상대를 이으면 검토 대상
  for (const l of raw) {
    for (const side of ['subject', 'target']) {
      const n = l.normalized[side];
      if (n.item_id || !n.partial.length) continue;
      const other = sideKey(l, side === 'subject' ? 'target' : 'subject');
      const meet = raw.filter((m) => m.bundle_id !== l.bundle_id && n.partial.some((id) => [sideKey(m, 'subject'), sideKey(m, 'target')].includes(`item:${id}`)) && [sideKey(m, 'subject'), sideKey(m, 'target')].includes(other));
      if (meet.length) conflicts.push({ kind: 'partial_line_item_overlap', link_id: l.link_id, bundle_id: l.bundle_id, lines: n.key, overlapped_items: n.partial, meets: meet.map((m) => m.link_id) });
    }
  }

  const conflictItems = new Set(links.filter((l) => l.conflict).flatMap((l) => [l.normalized.subject.item_id, l.normalized.target.item_id]).filter(Boolean));
  // 최종 상태(충돌 연결은 빼고 센다)
  const active = links.filter((l) => !l.conflict && l.verdict !== '다른 대상');
  const asClue = new Map();
  const asReveal = new Set();
  for (const l of active) {
    const clueIds = l.roles ? [l.normalized[l.roles.clue].item_id] : [l.normalized.subject.item_id, l.normalized.target.item_id];
    for (const id of clueIds.filter(Boolean)) {
      if (!asClue.has(id)) asClue.set(id, []);
      asClue.get(id).push(l);
    }
    if (l.roles && l.normalized[l.roles.reveal].item_id) asReveal.add(l.normalized[l.roles.reveal].item_id);
  }
  const statuses = new Map();
  for (const [id, info] of judged) {
    const own = unlinked.get(id) ?? null;
    const clueLinks = asClue.get(id) ?? [];
    const same = clueLinks.filter((l) => l.verdict === '같은 대상');
    let status;
    let conf = '해당 없음';
    if (same.length) {
      status = '해결됨';
      conf = same.some((l) => l.confidence === '유력한 해석') ? '유력한 해석' : '가능성';
    } else if (clueLinks.length) {
      status = '보류';
      conf = '판단 보류';
    } else if (own?.reason === '짝 없음') status = '짝 없음';
    else if (own?.reason === '단서 아님') status = asReveal.has(id) ? '공개 전용' : '단서 아님';
    else status = '미판정';
    // 상태 충돌: 자기 묶음은 단서 아님인데 다른 묶음이 단서 쪽으로 이음
    const otherBundleClue = clueLinks.filter((l) => l.bundle_id !== info.bundle_id);
    if (own?.reason === '단서 아님' && otherBundleClue.length) {
      conflicts.push({ kind: 'status', item_id: id, own: { bundle_id: info.bundle_id, reason: own.reason }, links: otherBundleClue.map((l) => ({ link_id: l.link_id, bundle_id: l.bundle_id, wave: l.wave })) });
      status = '충돌 보류';
      conf = '해당 없음';
    }
    if (conflictItems.has(id)) {
      status = '충돌 보류';
      conf = '해당 없음';
    }
    // 단서 쪽으로 이었는데 짝 없음도 적었으면 남은 의문이다(미해결 목록에 따로 남긴다)
    const residual = clueLinks.length && own?.reason === '짝 없음' ? own.note : null;
    statuses.set(id, { status, conf, own_reason: own?.reason ?? null, note: own?.note ?? null, residual, budget_exhausted: String(own?.note ?? '').startsWith(SEARCH_BUDGET_TAG), own_bundle: info.bundle_id, wave: info.wave, stage: info.stage, clue_category: info.clue_category, clue_links: clueLinks.map((l) => l.link_id), revealed_by: asReveal.has(id) });
  }
  return { links, statuses, conflicts, mergeSuggestions };
};

/** 회차 W의 연결이 앞 회차 단위의 최종 상태를 바꾼 것(설계 2.2절 5) */
export const externalChanges = ({ entries, judged, clhByScene, wave }) => {
  const upto = (w) => mergeC({ entries: entries.filter((e) => e.wave <= w), judged: new Map([...judged].filter(([, v]) => v.wave <= w)), clhByScene }).statuses;
  const before = upto(wave - 1);
  const after = upto(wave);
  const out = [];
  for (const [id, a] of before) {
    const b = after.get(id);
    if (b && (a.status !== b.status || a.conf !== b.conf)) out.push({ item_id: id, wave_of_unit: a.wave, before: a.status, after: b.status, clue_links: b.clue_links });
  }
  return out;
};

/**
 * 앞 회차 감사 뒤에 그 회차까지의 shard가 고쳐져(뒤 회차 감사 수정 등) 상태가 달라진 앞 회차 단위.
 * 회차 v 감사 당시 shard(snapshots: bundle_id → shard 객체, 없으면 지금 것)로 계산한 상태와 지금 상태를 v까지의 출력만으로 비교한다.
 * 뒤 회차 감사에 외부 변경 항목으로 넣어, 앞 회차 감사를 다시 하지 않고 덮는다(설계 G3)
 */
export const auditDrift = ({ entries, judged, clhByScene, wave, snapshots }) => {
  const upto = entries.filter((e) => e.wave <= wave);
  const j = new Map([...judged].filter(([, v]) => v.wave <= wave));
  const now = mergeC({ entries: upto, judged: j, clhByScene }).statuses;
  const then = mergeC({ entries: upto.map((e) => (snapshots.has(e.bundle.bundle_id) ? { ...e, shard: snapshots.get(e.bundle.bundle_id) } : e)), judged: j, clhByScene }).statuses;
  const out = [];
  for (const [id, a] of then) {
    const b = now.get(id);
    if (b && (a.status !== b.status || a.conf !== b.conf)) out.push({ item_id: id, wave_of_unit: a.wave, before: a.status, after: b.status, before_conf: a.conf, after_conf: b.conf, clue_links: b.clue_links, cause: `회차 ${wave} 감사 뒤 shard 수정` });
  }
  return out;
};

/** 병합기 전용 필드: 근거 장면, 공개 순서, lines 끝과 겹치는 Pass 1 항목·B 연결 */
export const annotateLinks = ({ links, store, releaseDates, overlapIndex }) => links.map((l) => {
  const ends = { subject: l.subject[0], target: l.target[0] };
  const sceneOf = (r) => (r.ref === 'item' ? r.item_id.replace(CLH_RE, '') : r.scene_id);
  const scenes = new Set([sceneOf(ends.subject), sceneOf(ends.target), ...l.supporting_evidence.map((e) => e.scene_id)]);
  let release = null;
  if (l.roles && l.verdict !== '다른 대상') {
    const ct = store.meta(sceneOf(ends[l.roles.clue]))?.title_id;
    const rt = store.meta(sceneOf(ends[l.roles.reveal]))?.title_id;
    if (ct && rt) release = compareRelease(releaseDates, ct, rt);
  }
  const overlappingItems = {};
  for (const side of ['subject', 'target']) {
    const r = ends[side];
    if (r.ref !== 'lines') continue;
    overlappingItems[side] = (overlapIndex.get(r.scene_id) ?? []).filter((x) => overlaps(x.line_start, x.line_end, r.line_start, r.line_end)).map((x) => x.id);
  }
  return { ...l, evidence_scenes: [...scenes].sort(), release_order: release, overlapping_items: overlappingItems };
});

/** 충돌에 걸린 묶음 */
export const conflictBundles = (c) => [...new Set([c.bundle_id, c.own?.bundle_id, ...(c.links ?? []).map((l) => l.bundle_id)].filter(Boolean))];

// ---------------------------------------------------------------------------
// 감사(설계 2.10절)

const rateOf = (status, rate) => Math.min(1, rate * (AUDIT_RATE_FACTOR[status] ?? 1));

/** 두 shard의 달라진 요소. 연결은 link_id, 자기 상태는 item_id, 병합 제안은 suggestion_id로 비교한다 */
export const diffCShards = (before, after) => {
  const by = (list, key) => new Map((list ?? []).map((x) => [x[key], JSON.stringify(x)]));
  const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort(cmpStr);
  const lb = by(before.candidate_links, 'link_id');
  const la = by(after.candidate_links, 'link_id');
  const removedLinkUnits = changed(lb, la)
    .filter((id) => !la.has(id))
    .flatMap((id) => {
      const l = before.candidate_links.find((x) => x.link_id === id);
      return [...l.subject, ...l.target].map((s) => s.item_id).filter(Boolean);
    });
  return {
    links: changed(lb, la).filter((id) => la.has(id)),
    removed_links: changed(lb, la).filter((id) => !la.has(id)),
    removed_link_units: [...new Set(removedLinkUnits)].sort(cmpStr),
    unlinked: changed(by(before.unlinked, 'item_id'), by(after.unlinked, 'item_id')),
    merge_suggestions: changed(by(before.merge_suggestions, 'suggestion_id'), by(after.merge_suggestions, 'suggestion_id')),
  };
};

/**
 * 앞 회차 감사를 이어 인정할 수 있는지(설계 G3: 회차 간 전파는 앞 감사를 다시 하지 않고 뒤 회차 감사가 덮는다).
 * 뒤 회차 감사 수정이 앞 회차 shard를 고치면 도장이 바뀌어 앞 감사가 무효가 된다. 다음을 모두 만족하면 이어 인정한다.
 *  1. 묶음 구성·규칙·묶음 입력은 그대로이고 shard 해시만 바뀜
 *  2. 바뀐 묶음의 감사 당시 shard(스냅숏)가 있고 해시가 감사 입력의 도장과 같음
 *  3. 지금 다시 만든 감사 항목이 감사한 항목과 완전히 같음(표본·연결·상태 어느 것도 안 바뀜)
 *  4. 달라진 요소가 모두, 지금 shard를 본(도장 일치) 뒤 회차 PASS 감사의 항목에 들어 있음
 *     연결: 어느 항목의 links에 그 link_id / 지운 연결·자기 상태: 그 단위가 항목 / 병합 제안: merge:ID 항목
 * audited: 감사한 입력, current: 지금 도장 [{bundle_id, ...}], snapshots: bundle_id → 감사 당시 shard 글,
 * shardsNow: bundle_id → 지금 shard 글, regenerated: 지금 다시 만든 items, later: [{wave, input}] (PASS인 뒤 회차만)
 */
export const carryOverAudit = ({ audited, current, snapshots, shardsNow, regenerated, later }) => {
  const errors = [];
  const before = audited.bundle_stamps;
  if (before.length !== current.length || before.some((s, i) => s.bundle_id !== current[i].bundle_id)) return { ok: false, errors: ['회차 구성이 바뀌었다'], changes: [] };
  const changes = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = current[i];
    if (a.rules_sha256 !== b.rules_sha256) errors.push(`${a.bundle_id}: 판정 규칙이 바뀌었다`);
    if (a.input_sha256 !== b.input_sha256) errors.push(`${a.bundle_id}: 묶음이나 대본이 바뀌었다`);
    if (a.shard_sha256 === b.shard_sha256) continue;
    const old = snapshots.get(a.bundle_id);
    if (old == null || sha256(old) !== a.shard_sha256) {
      errors.push(`${a.bundle_id}: 감사 당시 shard 스냅숏이 없거나 도장과 다르다`);
      continue;
    }
    changes.push({ bundle_id: a.bundle_id, stamp: b, ...diffCShards(JSON.parse(old), JSON.parse(shardsNow.get(a.bundle_id))) });
  }
  // 3. 다시 만든 항목 중 달라지거나 새로 생긴 것은 지금 shard를 본 뒤 회차 PASS 감사가 그 단위를 항목으로 가져야 한다
  //    (단위 상태가 바뀌어 층이 옮겨 가면 표본이 하나 늘 수 있다. auditDrift가 그 단위를 뒤 회차 외부 변경 항목으로 넣는다)
  if (!Array.isArray(regenerated)) errors.push(`감사 항목을 다시 만들 수 없다: ${regenerated?.error ?? '?'}`);
  else {
    const now = new Map(regenerated.map((x) => [x.audit_id, x]));
    const gone = audited.items.filter((x) => !now.has(x.audit_id)).map((x) => x.audit_id);
    if (gone.length) errors.push(`다시 만든 감사 항목에서 빠졌다: ${gone.join(', ')}`);
    const was = new Map(audited.items.map((x) => [x.audit_id, JSON.stringify(x)]));
    const moved = regenerated.filter((x) => was.get(x.audit_id) !== JSON.stringify(x));
    const seenAll = later.filter((w) => changes.every((c) => w.input.bundle_stamps.some((s) => s.bundle_id === c.bundle_id && s.shard_sha256 === c.stamp.shard_sha256)));
    const laterItems = seenAll.flatMap((w) => w.input.items);
    const ids = new Set([...laterItems.map((x) => x.item_id).filter(Boolean), ...laterItems.map((x) => x.audit_id)]);
    const uncovered = moved.filter((x) => !ids.has(x.item_id ?? x.audit_id)).map((x) => x.audit_id);
    if (uncovered.length) errors.push(`다시 만든 감사 항목이 달라졌는데 뒤 회차 PASS 감사가 덮지 않았다: ${uncovered.join(', ')}`);
  }
  for (const c of changes) {
    const seen = later.filter((w) => w.input.bundle_stamps.some((s) => s.bundle_id === c.bundle_id && s.shard_sha256 === c.stamp.shard_sha256));
    const items = seen.flatMap((w) => w.input.items);
    const linkIds = new Set(items.flatMap((x) => (x.links ?? []).map((l) => l.link_id)));
    const itemIds = new Set(items.map((x) => x.item_id).filter(Boolean));
    const auditIds = new Set(items.map((x) => x.audit_id));
    const miss = [
      ...c.links.filter((id) => !linkIds.has(id)).map((id) => `연결 ${id}`),
      ...c.removed_links.filter((id) => !c.removed_link_units.some((u) => itemIds.has(u))).map((id) => `지운 연결 ${id}`),
      ...c.unlinked.filter((id) => !itemIds.has(id)).map((id) => `자기 상태 ${id}`),
      ...c.merge_suggestions.filter((id) => !auditIds.has(`merge:${id}`)).map((id) => `병합 제안 ${id}`),
    ];
    if (miss.length) errors.push(`${c.bundle_id}: 뒤 회차 PASS 감사가 덮지 않은 변경 — ${miss.join(', ')}`);
    c.covered_by = seen.map((w) => w.wave);
  }
  return { ok: errors.length === 0, errors, changes: changes.map(({ stamp: _s, ...c }) => c) };
};

/**
 * units: 이 회차 단위 [{item_id, bundle_id, stage, ...}], statuses: mergeC 결과, others: bundle_id → 묶음 밖 색인
 * extra: { externalChanges, conflicts, mergeSuggestions } 전수
 */
export const sampleCAudit = ({ units, statuses, linksByItem, bundlePaths, others, extra = {}, rate = 0.1, seed = 'C', includeIds = [], probes = AUDIT_PROBES }) => {
  if (!(rate > 0 && rate <= 1)) throw new Error('audit rate는 0 초과 1 이하다');
  const strata = new Map();
  for (const u of units) {
    const st = statuses.get(u.item_id);
    const stratum = `${st.status}/${st.conf}/${u.stage}단계`;
    const audit_id = `${u.bundle_id}:${u.item_id}`;
    let otherProbes = [];
    if (['짝 없음', '단서 아님', '공개 전용'].includes(st.status)) {
      const pool = (others.get(u.bundle_id) ?? []).filter((v) => v.title_id === u.title_id && v.scene_id !== u.scene_id);
      const later = pool.filter((v) => v.scene_order > u.scene_order).sort((a, b) => a.scene_order - b.scene_order);
      const picked = later.slice(0, 2);
      const rest = pool.filter((v) => !picked.includes(v)).sort((a, b) => cmpStr(hashRank(`${seed}|probe`, `${audit_id}|${a.item_id}`), hashRank(`${seed}|probe`, `${audit_id}|${b.item_id}`)));
      otherProbes = [...picked, ...rest].slice(0, probes).map((v) => ({ item_id: v.item_id, scene_id: v.scene_id, line_start: v.line_start, line_end: v.line_end, clue_category: v.clue_category, keyword: v.keyword }));
    }
    const item = { audit_id, kind: 'unit', bundle_id: u.bundle_id, item_id: u.item_id, stratum, status: st, ...bundlePaths.get(u.bundle_id), unit: u, links: linksByItem.get(u.item_id) ?? [], other_clue_probes: otherProbes };
    if (!strata.has(stratum)) strata.set(stratum, []);
    strata.get(stratum).push(item);
  }
  const rank = (x) => hashRank(seed, x.audit_id);
  const required = new Set(includeIds);
  const items = [];
  const counts = [];
  for (const [stratum, list] of [...strata].sort(([a], [b]) => cmpStr(a, b))) {
    const r = rateOf(stratum.split('/')[0], rate);
    const n = Math.max(1, Math.ceil(Math.round(list.length * r * 1e9) / 1e9));
    const chosen = [...new Set([...list.toSorted((a, b) => cmpStr(rank(a), rank(b))).slice(0, n), ...list.filter((x) => required.has(x.audit_id))])];
    items.push(...chosen);
    counts.push({ stratum, rate: r, population: list.length, sampled: chosen.length });
  }
  const base = items.length;
  // status: 바뀐 뒤 현재 상태 전부(자기 상태·note·residual). before/after만으로는 부분 해결인지 감사자가 볼 수 없다
  for (const x of extra.externalChanges ?? []) items.push({ audit_id: `ext:${x.item_id}`, kind: 'external_change', ...x, status: statuses.get(x.item_id) ?? null, links: linksByItem.get(x.item_id) ?? [] });
  for (const c of extra.conflicts ?? []) items.push({ audit_id: `conflict:${sha256(JSON.stringify(c)).slice(0, 12)}`, kind: 'conflict', conflict: c });
  for (const m of extra.mergeSuggestions ?? []) items.push({ audit_id: `merge:${m.suggestion_id}`, kind: 'merge_suggestion', suggestion: m, ...bundlePaths.get(m.bundle_id) });
  const known = new Set(items.map((x) => x.audit_id));
  if (known.size !== items.length) throw new Error('감사 항목 ID가 겹친다(병합 제안 ID 중복 등)');
  // 단위 표본만 유지를 강제한다. 외부 변경·충돌·병합 제안은 고친 뒤 없어질 수 있다
  for (const id of required) if (!/^(ext|conflict|merge):/.test(id) && !known.has(id)) throw new Error(`이전 감사 표본이 회차에서 사라졌다: ${id}`);
  return { population_units: units.length, sampled_units: base, extra_items: items.length - base, rate, strata: counts, items };
};

// ---------------------------------------------------------------------------
// build

const loadA2Context = (store) => {
  const res = readJsonIfExists(path.join(A2_MAIN_ROOT, 'merged', 'A2_resolutions.json'));
  const official = readJsonIfExists(OFFICIAL_ENTITIES_PATH);
  const terms = readJsonIfExists(OFFICIAL_TERMS_PATH);
  if (!res || !official || !terms) throw new Error('A-2 해소·공식 표(entities.json·terms.json)가 없다');
  const occCache = new Map();
  const occRange = (bundleId, unitId, occId) => {
    if (!occCache.has(bundleId)) {
      const doc = readJsonIfExists(path.join(A2_MAIN_ROOT, 'bundles', `${bundleId}.occurrences.json`));
      if (!doc) throw new Error(`A-2 출현 파일이 없다: ${bundleId}. pass2-a2.mjs build --all --run=main으로 다시 만든다`);
      occCache.set(bundleId, new Map(doc.units.flatMap((u) => u.occurrences.map((o) => [`${u.unit_id}|${o.occ_id}`, o]))));
    }
    return occCache.get(bundleId).get(`${unitId}|${occId}`) ?? null;
  };
  const resolutions = officialResolutions(res.resolutions, official);
  return {
    occIndex: a2OccIndex({ resolutions, groupMap: official.group_map ?? {}, occRange }),
    dictionary: officialDictionary({ registry: loadRegistry(), officialEntities: official.entities, terms: terms.terms }),
    keyNames: new Map([
      ...official.entities.map((e) => [`ent:${e.entity_id}`, e.canonical_name]),
      ...terms.terms.map((t) => [`term:${t.term_key}`, t.canonical_name]),
      ...[...loadRegistry().values()].map((e) => [`ent:${e.entity_id}`, e.canonical_name]),
    ]),
    termSurfaces: new Set(terms.terms.flatMap((t) => [t.canonical_name, ...(t.surfaces ?? [])])),
    store,
  };
};

/** 공개 신호가 있는 줄(B 공개 근거, 같은 장면 정체 공개, 확정 사건): 장면 → [{line_start, line_end, id}] */
const revealSignals = (titleDocs) => {
  const out = new Map();
  const add = (sid, s, e, id) => {
    if (!isPositiveInt(s)) return;
    if (!out.has(sid)) out.set(sid, []);
    out.get(sid).push({ line_start: s, line_end: e ?? s, id });
  };
  for (const doc of titleDocs) for (const scene of doc.scenes ?? []) {
    for (const x of [...(scene.unknown_speakers ?? []), ...(scene.descriptor_speakers ?? [])]) {
      const r = x.resolved_in_same_scene_to;
      if (r) add(scene.scene_id, r.line_start, r.line_end, x.item_id);
    }
    for (const e of scene.events_and_claims ?? []) if (e.epistemic_type === 'established_event') add(scene.scene_id, e.line_start, e.line_end, e.item_id);
  }
  const b = readJsonIfExists(B_A2_PATH);
  for (const l of b?.links ?? []) for (const ev of l.supporting_evidence ?? []) if (ev.reveals_identity) add(ev.scene_id, ev.line_start, ev.line_end, l.link_id);
  return out;
};

/** lines 끝과 겹치는 항목 색인(병합기 overlapping_items): __eac_, __unk_/__dsp_ 공개, B 공개 근거 */
const overlapIndexOf = (titleDocs) => {
  const out = new Map();
  const add = (sid, s, e, id) => {
    if (!isPositiveInt(s)) return;
    if (!out.has(sid)) out.set(sid, []);
    out.get(sid).push({ line_start: s, line_end: e ?? s, id });
  };
  for (const doc of titleDocs) for (const scene of doc.scenes ?? []) {
    for (const e of scene.events_and_claims ?? []) add(scene.scene_id, e.line_start, e.line_end, e.item_id);
    for (const x of [...(scene.unknown_speakers ?? []), ...(scene.descriptor_speakers ?? [])]) if (x.resolved_in_same_scene_to) add(scene.scene_id, x.resolved_in_same_scene_to.line_start, x.resolved_in_same_scene_to.line_end, x.item_id);
  }
  const b = readJsonIfExists(B_A2_PATH);
  for (const l of b?.links ?? []) for (const ev of l.supporting_evidence ?? []) if (ev.reveals_identity) add(ev.scene_id, ev.line_start, ev.line_end, l.link_id);
  return out;
};

/** 전수 패킹. 묶음 파일은 쓰지 않는다 */
export const planAll = ({ store, byTitle, maxUnits = MAX_UNITS, maxChars = MAX_CHARS, log = () => {} }) => {
  const docs = [...byTitle.values()];
  const units = collectClues(docs, store);
  const clhByScene = clhIndexByScene(units);
  const { links: hintLinks, hints } = hintSceneLinks(docs);
  const a2 = loadA2Context(store);
  const viaCount = {};
  for (const u of units) {
    const r = resolveClueKey(u, a2);
    u.key = r.key;
    u.key_via = r.via;
    u.key_name = a2.keyNames.get(r.key) ?? null;
    viaCount[r.via] = (viaCount[r.via] ?? 0) + 1;
  }
  log(`단서 ${units.length}건, 키 해소 ${JSON.stringify(viaCount)}`);
  // C-0
  const termsByUnit = new Map(units.map((u) => [u.item_id, termsOfUnit(u)]));
  const allTerms = new Set([...termsByUnit.values()].flatMap((m) => [...m.keys()]));
  log(`C-0 검색어 ${allTerms.size}개 스캔`);
  const scan = scanCorpus(store, allTerms);
  const termLimit = (term, kind) => (kind === 'code' || a2.termSurfaces.has(term) ? SCAN_MAX_SCENES_CODE : SCAN_MAX_SCENES);
  for (const u of units) {
    const sel = selectScanHits(u, termsByUnit.get(u.item_id), scan, { store, termLimit });
    u.scan_hits = sel.hits;
    u.scan_terms = sel.kept;
    u.scan_dropped = sel.dropped;
    const preview = sel.hits.map((h) => ({ scan_id: 'S0000', scene_id: h.scene_id, line: h.line, title_id: store.meta(h.scene_id)?.title_id, text: extractUtteranceTextFromRawLine(store.lines(h.scene_id)[h.line]) }));
    u.chars = unitBlock(u, store, preview).length;
  }
  const titleOrder = store.titles.map((t) => t.title_id);
  const packed = packBundles(units, { titleOrder, maxUnits, maxChars });
  packed.forEach((b, i) => {
    b.bundle_id = `C1__${pad(i + 1)}`;
  });
  const others = storyOtherClues(packed, units, hintLinks);
  const exposure = checkExposure(packed, others);
  if (exposure.missing.length) throw new Error(`노출 불변식 위반 ${exposure.missing.length}쌍(예: ${exposure.missing.slice(0, 3).map((x) => x.join('↔')).join(', ')})`);
  return { units, clhByScene, hintLinks, hints, packed, others, exposure, signals: revealSignals(docs), a2 };
};

/** 묶음 하나의 파일 내용(묶음 JSON·발췌·색인·후보) */
export const unitsByKey = (units) => {
  const byKey = new Map();
  for (const u of units) {
    if (u.key.startsWith('item:')) continue;
    if (!byKey.has(u.key)) byKey.set(u.key, []);
    byKey.get(u.key).push(u);
  }
  return byKey;
};

export const bundleFiles = ({ b, others, store, clhByScene, hintLinks, hints, signals, byKey }) => {
  const hitMap = new Map();
  const scanHits = [];
  for (const u of b.units) for (const h of u.scan_hits) {
    const k = `${h.scene_id}:${h.line}`;
    if (!hitMap.has(k)) {
      const rec = { scan_id: `S${pad(scanHits.length + 1, 4)}`, scene_id: h.scene_id, title_id: store.meta(h.scene_id)?.title_id, line: h.line, terms: new Set(), unit_ids: new Set(), text: store.lines(h.scene_id)[h.line], overlaps: (clhByScene.get(h.scene_id) ?? []).filter((c) => c.line_start <= h.line && h.line <= c.line_end).map((c) => c.item_id) };
      hitMap.set(k, rec);
      scanHits.push(rec);
    }
    const rec = hitMap.get(k);
    h.terms.forEach((t) => rec.terms.add(t));
    rec.unit_ids.add(u.item_id);
  }
  const hitsOut = scanHits.map((h) => ({ ...h, terms: [...h.terms].sort(cmpStr), unit_ids: [...h.unit_ids].sort(cmpStr) }));
  const hitsByUnit = new Map();
  for (const h of hitsOut) for (const id of h.unit_ids) {
    if (!hitsByUnit.has(id)) hitsByUnit.set(id, []);
    hitsByUnit.get(id).push(h);
  }
  // 제시 쌍 후보
  const cands = [];
  const own = new Set(b.units.map((u) => u.item_id));
  const signalAt = (sid, line) => (signals.get(sid) ?? []).some((s) => s.line_start <= line && line <= s.line_end);
  for (const u of b.units) {
    // ①·③ 힌트 쌍
    for (const sid of hintLinks.get(u.scene_id) ?? []) {
      for (const v of clhByScene.get(sid) ?? []) {
        const cross = v.title_id !== u.title_id;
        cands.push({ unit: u.item_id, other: { ref: 'item', item_id: v.item_id }, priority: cross ? 1 : 3, rank: Math.abs(v.scene_order - u.scene_order), source: 'cross_scene_hint', cross_title: cross });
      }
    }
    // ① 이표기 공식 키(다른 이야기)·④ 같은 키 무리
    if (!u.key.startsWith('vk:') && !u.key.startsWith('item:')) {
      for (const v of byKey.get(u.key) ?? []) {
        if (v.item_id === u.item_id || v.scene_id === u.scene_id) continue;
        const cross = v.title_id !== u.title_id;
        const alias = variantKey(v.keyword) !== variantKey(u.keyword);
        cands.push({ unit: u.item_id, other: { ref: 'item', item_id: v.item_id }, priority: cross && alias ? 1 : 4, rank: Math.abs(v.scene_order - u.scene_order), source: alias ? 'official_key_alias' : 'same_key', cross_title: cross });
      }
    } else {
      for (const v of byKey.get(u.key) ?? []) {
        if (v.item_id === u.item_id || v.scene_id === u.scene_id) continue;
        cands.push({ unit: u.item_id, other: { ref: 'item', item_id: v.item_id }, priority: 4, rank: Math.abs(v.scene_order - u.scene_order), source: 'same_key', cross_title: v.title_id !== u.title_id });
      }
    }
    // ② C-0(다른 이야기 우선, 공개 신호가 있는 줄 먼저)
    for (const h of hitsByUnit.get(u.item_id) ?? []) {
      const cross = h.title_id !== u.title_id;
      const other = h.overlaps.length === 1 ? { ref: 'item', item_id: h.overlaps[0] } : { ref: 'lines', scan_id: h.scan_id, scene_id: h.scene_id, line_start: h.line, line_end: h.line };
      cands.push({ unit: u.item_id, other, priority: cross ? 2 : 4, rank: signalAt(h.scene_id, h.line) ? 0 : 1, source: 'c0_scan', cross_title: cross });
    }
  }
  const pairs = selectPairs(b.bundle_id, cands.filter((c) => !(c.other.ref === 'item' && c.other.item_id === c.unit)));
  const sceneSet = new Set(b.units.map((u) => u.scene_id));
  const bundleHints = hints.filter((h) => sceneSet.has(h.scene_id) || h.related_scene_ids.some((r) => sceneSet.has(r)));
  const script = b.units.map((u) => unitBlock(u, store, hitsByUnit.get(u.item_id) ?? [])).join('\n');
  const clues = `${['item_id', 'scene_id', 'lines', 'category', 'subject', 'keyword'].join('\t')}\n${others.map(clueIndexLine).join('\n')}${others.length ? '\n' : ''}`;
  const unitsOut = b.units.map((u) => ({
    item_id: u.item_id,
    scene_id: u.scene_id,
    title_id: u.title_id,
    clue_category: u.clue_category,
    keyword: u.keyword,
    subject: u.subject,
    line_start: u.line_start,
    line_end: u.line_end,
    pass1_detail: u.detail,
    official_key: u.key.startsWith('ent:') || u.key.startsWith('term:') ? { key: u.key, name: u.key_name } : null,
  }));
  return {
    script,
    clues,
    candidates: { bundle_id: b.bundle_id, hits: hitsOut, scan_terms: b.units.map((u) => ({ item_id: u.item_id, kept: u.scan_terms, dropped: u.scan_dropped })) },
    bundle: {
      schema_version: PASS2_BUNDLE_SCHEMA_VERSION,
      bundle_id: b.bundle_id,
      kind: 'C',
      stage: b.stage,
      titles: b.titles,
      units: unitsOut,
      suggested_pairs: pairs,
      pass1_hints: bundleHints,
      own_unit_count: own.size,
    },
  };
};

export const buildC = async ({ run, select = null, maxUnits = MAX_UNITS, maxChars = MAX_CHARS, waveSize = 20 }) => {
  if (![maxUnits, maxChars, waveSize].every(isPositiveInt)) throw new Error('max-units·max-chars·wave-size는 1 이상의 정수다');
  const P = pathsOf(run);
  const store = new SceneStore();
  const byTitle = loadByTitle();
  const all = planAll({ store, byTitle, maxUnits, maxChars, log: (m) => console.log(`[build] ${m}`) });
  const byKey = unitsByKey(all.units);
  let chosen = all.packed.map((b, i) => ({ b, i, wave: Math.floor(i / waveSize) + 1 }));
  if (select) {
    const ids = new Map(all.packed.map((b, i) => [b.bundle_id, i]));
    chosen = [];
    select.forEach((group, w) => group.forEach((id) => {
      if (!ids.has(id)) throw new Error(`전수 패킹에 없는 묶음: ${id}`);
      chosen.push({ b: all.packed[ids.get(id)], i: ids.get(id), wave: w + 1 });
    }));
  }
  await fsp.rm(P.bundles, { recursive: true, force: true });
  await fsp.mkdir(P.bundles, { recursive: true });
  const planBundles = [];
  const generatedAt = new Date().toISOString();
  for (const { b, i, wave } of chosen) {
    const f = bundleFiles({ b, others: all.others[i], store, clhByScene: all.clhByScene, hintLinks: all.hintLinks, hints: all.hints, signals: all.signals, byKey });
    const file = (ext) => path.join(P.bundles, `${b.bundle_id}.${ext}`);
    const bundle = { ...f.bundle, generated_at: generatedAt, script_file: relPath(file('excerpts.txt')), clues_file: relPath(file('clues.txt')), candidates_file: relPath(file('candidates.json')) };
    await fsp.writeFile(file('excerpts.txt'), f.script, 'utf8');
    await fsp.writeFile(file('clues.txt'), f.clues, 'utf8');
    await writeJsonAtomic(file('candidates.json'), f.candidates);
    await writeJsonAtomic(file('json'), bundle);
    const bundleJsonChars = JSON.stringify(bundle).length;
    planBundles.push({
      bundle_id: b.bundle_id,
      kind: 'C',
      stage: b.stage,
      wave,
      units: b.units.length,
      titles: b.titles,
      keys: b.keys ?? null,
      big_title_piece: b.big ?? false,
      suggested_pairs: f.bundle.suggested_pairs.length,
      clue_categories: b.units.reduce((acc, u) => ((acc[u.clue_category] = (acc[u.clue_category] ?? 0) + 1), acc), {}),
      excerpt_chars: f.script.length,
      clues_chars: f.clues.length,
      clues_lines: all.others[i].length,
      bundle_json_chars: bundleJsonChars,
      total_input_chars: f.script.length + f.clues.length + bundleJsonChars,
      input: relPath(file('json')),
      script: relPath(file('excerpts.txt')),
      clues: relPath(file('clues.txt')),
      candidates: relPath(file('candidates.json')),
      output: relPath(path.join(P.shards, `${b.bundle_id}.json`)),
      validate: `node scripts/graph/pass2-c.mjs validate ${b.bundle_id} --run=${run}`,
    });
  }
  const stageCount = (s) => all.packed.filter((b) => b.stage === s).length;
  const plan = {
    schema_version: PASS2_SCHEMA_VERSION,
    kind: 'C',
    run,
    generated_at: generatedAt,
    max_units: maxUnits,
    max_chars: maxChars,
    population: {
      clues: all.units.length,
      full_packing: { bundles: all.packed.length, stage1: stageCount(1), stage2: stageCount(2), big_title_pieces: all.packed.filter((b) => b.big).length },
      exposure_pairs: all.exposure.pairs,
      exposure_missing: all.exposure.missing.length,
      key_via: all.units.reduce((acc, u) => ((acc[u.key_via] = (acc[u.key_via] ?? 0) + 1), acc), {}),
      selected: select ? select.map((g) => g.join(',')) : null,
    },
    full_bundles: all.packed.map((b, i) => ({ bundle_id: b.bundle_id, stage: b.stage, units: b.units.length, titles: b.titles.slice(0, 8), title_count: b.titles.length, keys: (b.keys ?? []).slice(0, 8), big: b.big ?? false, clues_lines: all.others[i].length })),
    bundles: planBundles,
  };
  await writeJsonAtomic(P.plan, plan);
  // 판정 단위 → 묶음(실행 전체). finish·audit가 읽는다
  await writeJsonAtomic(path.join(P.bundles, 'units_index.json'), { generated_at: generatedAt, units: Object.fromEntries(all.packed.flatMap((b) => b.units.map((u) => [u.item_id, { bundle_id: b.bundle_id, stage: b.stage }]))) });
  return plan;
};

// ---------------------------------------------------------------------------
// CLI

const loadPlan = (P) => {
  const plan = readJsonIfExists(P.plan);
  if (!plan) throw new Error(`계획 파일이 없다: ${relPath(P.plan)}. 먼저 build를 실행한다`);
  return plan;
};
const loadBundle = (P, bundleId) => {
  const b = readJsonIfExists(path.join(P.bundles, `${bundleId}.json`));
  if (!b) throw new Error(`묶음이 없다: ${bundleId}`);
  return b;
};
const loadCandidates = (bundle) => JSON.parse(fs.readFileSync(path.resolve(bundle.candidates_file), 'utf8'));
const loadShard = (P, bundleId) => {
  const p = path.join(P.shards, `${bundleId}.json`);
  if (!fs.existsSync(p)) return { missing: true };
  try {
    return { shard: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { parseError: e.message };
  }
};
let ctxCache = null;
const makeCtx = () => {
  if (ctxCache) return ctxCache;
  const store = new SceneStore();
  const units = collectClues([...loadByTitle().values()], store);
  const terms = readJsonIfExists(OFFICIAL_TERMS_PATH);
  ctxCache = {
    store,
    units,
    clhById: new Map(units.map((u) => [u.item_id, u])),
    clhByScene: clhIndexByScene(units),
    registry: loadRegistry(),
    pass2Entities: loadPass2Entities(),
    termKeys: new Set((terms?.terms ?? []).map((t) => t.term_key)),
    releaseDates: loadReleaseDates(),
  };
  return ctxCache;
};
const validateOne = (P, bundleId, ctx) => {
  const bundle = loadBundle(P, bundleId);
  const cand = loadCandidates(bundle);
  const s = loadShard(P, bundleId);
  if (s.missing) return { bundle, status: 'missing', errors: [{ code: 'NO_OUTPUT', path: '$', message: '출력 파일이 없다' }], warnings: [] };
  if (s.parseError) return { bundle, status: 'fail', errors: [{ code: 'JSON_PARSE', path: '$', message: s.parseError }], warnings: [] };
  const { errors, warnings } = validateCShard(s.shard, bundle, { ...ctx, scanById: new Map(cand.hits.map((h) => [h.scan_id, h])) });
  return { bundle, shard: s.shard, status: errors.length ? 'fail' : 'pass', errors, warnings };
};
const countBy = (list) => list.reduce((acc, x) => ((acc[x.code] = (acc[x.code] ?? 0) + 1), acc), {});
const stampPath = (P, bundleId) => path.join(P.stamps, `${bundleId}.json`);
const inputText = (bundle) => ['script_file', 'clues_file', 'candidates_file'].map((k) => fs.readFileSync(path.resolve(bundle[k]), 'utf8')).join('\n');
const currentStamp = (P, bundleId, bundle) => computeStamp({
  rulesText: fs.readFileSync(RULES_PATH, 'utf8'),
  bundle,
  scriptText: inputText(bundle),
  shardText: fs.readFileSync(path.join(P.shards, `${bundleId}.json`), 'utf8'),
});
const staleReasonOf = (P, bundleId, bundle) => staleReason(readJsonIfExists(stampPath(P, bundleId)), currentStamp(P, bundleId, bundle));
const printResult = (bundleId, r) => {
  const tag = r.status === 'pass' ? (r.warnings.length ? '[WARN]' : '[PASS]') : '[FAIL]';
  console.log(`${tag} ${bundleId}: 오류 ${r.errors.length}건, 경고 ${r.warnings.length}건`);
  for (const e of r.errors) console.log(`  ERROR ${e.code} ${e.path}: ${e.message}`);
  for (const w of r.warnings) console.log(`  WARN  ${w.code} ${w.path}: ${w.message}`);
};
const argValue = (args, name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
/** 완료(검증 통과·도장 일치)한 묶음. maxWave를 주면 그 회차까지 */
const doneEntries = (P, plan, ctx, maxWave = Infinity) => {
  const out = [];
  for (const b of plan.bundles.filter((x) => x.wave <= maxWave)) {
    const r = validateOne(P, b.bundle_id, ctx);
    if (r.status !== 'pass' || staleReasonOf(P, b.bundle_id, r.bundle)) continue;
    out.push({ plan: b, bundle: r.bundle, shard: r.shard, wave: b.wave });
  }
  return out;
};
/** 이 실행에서 판정한(완료한) 단위 */
const judgedOf = (entries) => new Map(entries.flatMap((e) => e.bundle.units.map((u) => [u.item_id, { bundle_id: e.bundle.bundle_id, wave: e.wave, stage: e.bundle.stage, clue_category: u.clue_category }])));

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const run = argValue(args, 'run') ?? 'pilot';
  if (!RUNS.has(run)) throw new Error(`--run은 ${[...RUNS].join(' | ')} 중 하나다`);
  const P = pathsOf(run);

  if (cmd === 'build') {
    if (run === 'retest' || run === 'wf') throw new Error(`${run}는 build하지 않는다. copy-bundles로 파일럿 묶음을 옮겨 온다`);
    const selectArg = argValue(args, 'select');
    const select = selectArg ? selectArg.split(';').map((g) => g.split(',').map((x) => x.trim()).filter(Boolean)).filter((g) => g.length) : null;
    if (!select && !args.includes('--all')) throw new Error('build --all(전수) 또는 --select="C1__001,…;C1__010,…"(회차별 선택)을 지정한다');
    if (run === 'pilot' && !select) throw new Error('파일럿은 --select로 묶음을 고른다(설계 R2: 전수 패킹에서 골라 쓴다)');
    const plan = await buildC({
      run,
      select,
      maxUnits: Number(argValue(args, 'max-units') ?? MAX_UNITS),
      maxChars: Number(argValue(args, 'max-chars') ?? MAX_CHARS),
      waveSize: Number(argValue(args, 'wave-size') ?? 20),
    });
    for (const b of plan.bundles.slice(0, select ? Infinity : 0)) {
      console.log(`${b.bundle_id} [${b.stage}단계] 회차 ${b.wave}: 단위 ${b.units}, 제시 쌍 ${b.suggested_pairs}, 발췌 ${b.excerpt_chars.toLocaleString()}자 + 색인 ${b.clues_chars.toLocaleString()}자(${b.clues_lines}줄) = 입력 ${b.total_input_chars.toLocaleString()}자`);
      console.log(`  이야기: ${b.titles.slice(0, 6).join(', ')}${b.titles.length > 6 ? ` 외 ${b.titles.length - 6}` : ''}${b.keys ? ` | 키: ${b.keys.slice(0, 6).join(', ')}` : ''}`);
    }
    const pop = plan.population;
    console.log(`[build] 단서 ${pop.clues}, 전수 패킹 ${pop.full_packing.bundles}묶음(1단계 ${pop.full_packing.stage1}, 2단계 ${pop.full_packing.stage2}, 큰 이야기 조각 ${pop.full_packing.big_title_pieces})`);
    console.log(`[build] 노출 쌍 ${JSON.stringify(pop.exposure_pairs)}, 미노출 ${pop.exposure_missing}, 키 ${JSON.stringify(pop.key_via)}`);
    console.log(`[build] 묶음 파일 ${plan.bundles.length}개 → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'copy-bundles') {
    const from = argValue(args, 'from');
    const ids = (argValue(args, 'bundles') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!RUNS.has(from) || from === run || !ids.length) throw new Error('copy-bundles --from=<run> --bundles=C1__001,C1__002 --run=<다른 run>');
    if (fs.existsSync(P.plan)) throw new Error(`이미 계획이 있다: ${relPath(P.plan)}`);
    const S = pathsOf(from);
    const src = loadPlan(S);
    await fsp.mkdir(P.bundles, { recursive: true });
    const bundles = [];
    for (const id of ids) {
      const b = src.bundles.find((x) => x.bundle_id === id);
      if (!b) throw new Error(`${from} 계획에 없는 묶음: ${id}`);
      const rel = (name) => relPath(path.join(P.bundles, name));
      for (const ext of ['excerpts.txt', 'clues.txt', 'candidates.json']) await fsp.copyFile(path.join(S.bundles, `${id}.${ext}`), path.join(P.bundles, `${id}.${ext}`));
      const bundle = loadBundle(S, id);
      await writeJsonAtomic(path.join(P.bundles, `${id}.json`), { ...bundle, script_file: rel(`${id}.excerpts.txt`), clues_file: rel(`${id}.clues.txt`), candidates_file: rel(`${id}.candidates.json`), copied_from: { run: from, input: b.input } });
      bundles.push({ ...b, input: rel(`${id}.json`), script: rel(`${id}.excerpts.txt`), clues: rel(`${id}.clues.txt`), candidates: rel(`${id}.candidates.json`), output: relPath(path.join(P.shards, `${id}.json`)), validate: `node scripts/graph/pass2-c.mjs validate ${id} --run=${run}`, wave: 1 });
    }
    await fsp.copyFile(path.join(S.bundles, 'units_index.json'), path.join(P.bundles, 'units_index.json'));
    await writeJsonAtomic(P.plan, { ...src, run, generated_at: new Date().toISOString(), copied_from: { run: from, plan_sha256: sha256(fs.readFileSync(S.plan, 'utf8')) }, bundles });
    console.log(`[copy-bundles] ${from} → ${run}: 묶음 ${bundles.length}개 → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'status') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    for (const b of selectWave(plan, argValue(args, 'wave') === null ? null : Number(argValue(args, 'wave')))) {
      const r = validateOne(P, b.bundle_id, ctx);
      const stale = r.status === 'pass' ? staleReasonOf(P, b.bundle_id, r.bundle) : null;
      const st = r.status === 'missing' ? '[new]' : r.status === 'pass' && !stale ? '[done]' : r.status === 'fail' ? '[fail]' : '[rerun]';
      console.log(`${st} ${b.bundle_id} [${b.stage}단계] 회차 ${b.wave} (단위 ${b.units})${stale ? ` — ${stale}` : ''}`);
    }
    return;
  }

  if (cmd === 'validate') {
    const bundleId = args.find((a) => !a.startsWith('--'));
    if (!bundleId) throw new Error('validate <bundle_id>');
    const r = validateOne(P, bundleId, makeCtx());
    printResult(bundleId, r);
    await fsp.mkdir(P.stamps, { recursive: true });
    if (r.status === 'pass') await writeJsonAtomic(stampPath(P, bundleId), { ...currentStamp(P, bundleId, r.bundle), validated_at: new Date().toISOString() });
    await fsp.appendFile(P.log, `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundleId, status: r.status, errors: countBy(r.errors), warnings: countBy(r.warnings) })}\n`);
    if (r.status !== 'pass') process.exitCode = 1;
    return;
  }

  if (cmd === 'finish') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    const log = fs.existsSync(P.log) ? fs.readFileSync(P.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const progress = {};
    for (const b of plan.bundles) {
      const r = validateOne(P, b.bundle_id, ctx);
      const attempts = log.filter((x) => x.bundle_id === b.bundle_id);
      const stale = r.status === 'pass' ? staleReasonOf(P, b.bundle_id, r.bundle) : null;
      progress[b.bundle_id] = { wave: b.wave, stage: b.stage, status: stale ? 'stale' : r.status === 'pass' ? 'merged' : r.status, stale_reason: stale, validations: attempts.length, first_validation_failed: attempts.length ? attempts[0].status !== 'pass' : null, errors: countBy(r.errors), warnings: countBy(r.warnings) };
    }
    const entries = doneEntries(P, plan, ctx);
    const judged = judgedOf(entries);
    const m = mergeC({ entries, judged, clhByScene: ctx.clhByScene });
    const byTitle = loadByTitle();
    const links = annotateLinks({ links: m.links, store: ctx.store, releaseDates: ctx.releaseDates, overlapIndex: overlapIndexOf([...byTitle.values()]) });
    const statuses = Object.fromEntries(m.statuses);
    const unresolved = [...m.statuses].filter(([, s]) => s.status === '짝 없음' || s.status === '보류' || s.residual).map(([id, s]) => {
      const u = ctx.clhById.get(id);
      return { item_id: id, scene_id: u.scene_id, title_id: u.title_id, clue_category: u.clue_category, keyword: u.keyword, status: s.residual ? `${s.status}(남은 의문)` : s.status, note: s.residual ?? s.note, budget_exhausted: s.budget_exhausted, bundle_id: s.own_bundle, clue_links: s.clue_links };
    });
    const waves = [...new Set(plan.bundles.map((b) => b.wave))].sort((a, b) => a - b);
    const external = waves.slice(1).flatMap((w) => externalChanges({ entries, judged, clhByScene: ctx.clhByScene, wave: w }).map((x) => ({ ...x, changed_in_wave: w })));
    const stamp = { schema_version: PASS2_SCHEMA_VERSION, kind: 'C', run, generated_at: new Date().toISOString() };
    const missing = plan.bundles.filter((b) => progress[b.bundle_id].status !== 'merged').map((b) => b.bundle_id);
    await writeJsonAtomic(path.join(P.merged, 'C_candidates.json'), { ...stamp, missing_bundles: missing, links });
    await writeJsonAtomic(path.join(P.merged, 'C_unit_status.json'), { ...stamp, statuses, external_changes: external });
    await writeJsonAtomic(path.join(P.merged, 'unresolved_hooks.json'), { ...stamp, note: '짝 없음, 보류, 일부만 풀린 단서의 남은 의문(Pass 3 대상). 충돌 보류는 C_conflicts.json', hooks: unresolved });
    await writeJsonAtomic(path.join(P.merged, 'C_conflicts.json'), { ...stamp, conflicts: m.conflicts });
    await writeJsonAtomic(path.join(P.merged, 'C_merge_suggestions.json'), { ...stamp, note: '감사 PASS 전에는 curation.json에 넣지 않는다', suggestions: m.mergeSuggestions });
    await writeJsonAtomic(P.progress, { schema_version: PASS2_SCHEMA_VERSION, run, updated_at: new Date().toISOString(), bundles: progress });
    for (const [id, pg] of Object.entries(progress)) console.log(`${id} 회차 ${pg.wave}: ${pg.status}${pg.stale_reason ? `(${pg.stale_reason})` : ''} (검증 ${pg.validations}회, 남은 오류 ${Object.values(pg.errors).reduce((a, b) => a + b, 0)})`);
    const dist = {};
    for (const s of m.statuses.values()) {
      const k = `${s.clue_category}/${s.stage}단계`;
      dist[k] ??= {};
      dist[k][s.status] = (dist[k][s.status] ?? 0) + 1;
    }
    const byVerdict = links.reduce((acc, l) => ((acc[l.verdict] = (acc[l.verdict] ?? 0) + 1), acc), {});
    const outside = links.filter((l) => l.verdict !== '다른 대상' && ['subject', 'target'].some((s) => l.normalized[s].item_id && !judged.has(l.normalized[s].item_id))).length;
    console.log(`[finish] 병합 ${entries.length}/${plan.bundles.length}묶음(누락 ${missing.length}), 연결 ${links.length}건 ${JSON.stringify(byVerdict)}, 이 실행에서 판정하지 않은 단서를 가리키는 긍정 연결 ${outside}건`);
    console.log(`[finish] 최종 상태 ${JSON.stringify([...m.statuses.values()].reduce((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {}))}`);
    console.log(`[finish] 분류·단계별 ${JSON.stringify(dist)}`);
    console.log(`[finish] 충돌 ${m.conflicts.length}건 ${JSON.stringify(m.conflicts.reduce((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {}))}, 회차 간 상태 변경 ${external.length}건, 병합 제안 ${m.mergeSuggestions.length}건, 미해결(짝 없음·보류) ${unresolved.length}건`);
    console.log(`[finish] → ${relPath(P.merged)}/`);
    return;
  }

  if (cmd === 'audit-input' || cmd === 'audit-check') {
    const wave = Number(argValue(args, 'wave'));
    const plan = loadPlan(P);
    const ctx = makeCtx();
    const inputPathOf = (w) => path.join(P.audit, `wave_${pad(w)}_input.json`);
    const outputPathOf = (w) => path.join(P.audit, `wave_${pad(w)}_output.json`);
    const shardStore = path.join(P.audit, 'shard_store');
    const shardText = (bundleId) => fs.readFileSync(path.join(P.shards, `${bundleId}.json`), 'utf8');
    // 감사 당시 shard를 해시 이름으로 남긴다. 뒤 회차 수정이 앞 회차 shard를 고쳤을 때 무엇이 바뀌었는지 보려고 쓴다
    const storeShards = (stamps) => {
      fs.mkdirSync(shardStore, { recursive: true });
      for (const s of stamps) {
        const f = path.join(shardStore, `${s.shard_sha256}.json`);
        if (fs.existsSync(f)) continue;
        const text = shardText(s.bundle_id);
        if (sha256(text) !== s.shard_sha256) throw new Error(`${s.bundle_id}: shard가 도장과 다르다`);
        fs.writeFileSync(f, text);
      }
    };
    // 상태는 그 회차까지의 출력 전부에 달려 있으므로 앞 회차 도장도 함께 묶는다
    const stampsUpTo = (w) => plan.bundles.filter((b) => b.wave <= w).map((b) => {
      const r = validateOne(P, b.bundle_id, ctx);
      if (r.status !== 'pass') throw new Error(`${b.bundle_id}: 미완료 또는 검증 실패`);
      const stale = staleReasonOf(P, b.bundle_id, r.bundle);
      if (stale) throw new Error(`${b.bundle_id}: ${stale}`);
      return { bundle_id: b.bundle_id, ...currentStamp(P, b.bundle_id, r.bundle) };
    });
    // 이번 회차 연결이 바꾼 앞 회차 상태 + 앞 회차 감사 뒤 shard 수정으로 바뀐 상태(auditDrift). 단위마다 한 항목
    const externalOf = (w, entries, judged) => {
      if (w <= 1) return [];
      const out = externalChanges({ entries, judged, clhByScene: ctx.clhByScene, wave: w });
      const seen = new Set(out.map((x) => x.item_id));
      for (let v = 1; v < w; v++) {
        const audited = readJsonIfExists(inputPathOf(v));
        if (!audited) continue;
        const snapshots = new Map();
        for (const s of audited.bundle_stamps) {
          if (sha256(shardText(s.bundle_id)) === s.shard_sha256) continue;
          const f = path.join(shardStore, `${s.shard_sha256}.json`);
          if (!fs.existsSync(f)) throw new Error(`회차 ${v} 감사 당시 ${s.bundle_id} shard 스냅숏이 없다(${relPath(f)})`);
          snapshots.set(s.bundle_id, JSON.parse(fs.readFileSync(f, 'utf8')));
        }
        if (!snapshots.size) continue;
        for (const x of auditDrift({ entries, judged, clhByScene: ctx.clhByScene, wave: v, snapshots })) {
          if (seen.has(x.item_id)) continue;
          seen.add(x.item_id);
          out.push(x);
        }
      }
      return out;
    };
    const buildInput = (w, previous, judgeFamily, rate) => {
      const selected = selectWave(plan, w);
      const entries = doneEntries(P, plan, ctx, w);
      const judged = judgedOf(entries);
      const m = mergeC({ entries, judged, clhByScene: ctx.clhByScene });
      const ids = new Set(selected.map((b) => b.bundle_id));
      const linksByItem = new Map();
      for (const l of m.links) for (const s of ['subject', 'target']) {
        const id = l.normalized[s].item_id;
        if (!id) continue;
        if (!linksByItem.has(id)) linksByItem.set(id, []);
        linksByItem.get(id).push(l);
      }
      const units = entries.filter((e) => ids.has(e.bundle.bundle_id)).flatMap((e) => e.bundle.units.map((u) => ({ ...u, bundle_id: e.bundle.bundle_id, stage: e.bundle.stage, scene_order: ctx.store.sceneOrder.get(u.scene_id) ?? 0 })));
      const others = new Map(entries.filter((e) => ids.has(e.bundle.bundle_id)).map((e) => {
        const lines = fs.readFileSync(path.resolve(e.bundle.clues_file), 'utf8').split('\n').slice(1).filter(Boolean);
        return [e.bundle.bundle_id, lines.map((l) => ctx.clhById.get(l.split('\t')[0])).filter(Boolean).map((v) => ({ ...v, scene_order: ctx.store.sceneOrder.get(v.scene_id) }))];
      }));
      const bundlePaths = new Map(entries.map((e) => [e.bundle.bundle_id, { input_file: relPath(path.join(P.bundles, `${e.bundle.bundle_id}.json`)), script_file: e.bundle.script_file, clues_file: e.bundle.clues_file, output_file: relPath(path.join(P.shards, `${e.bundle.bundle_id}.json`)) }]));
      const conflicts = m.conflicts.filter((c) => conflictBundles(c).some((x) => ids.has(x)));
      const sample = sampleCAudit({
        units,
        statuses: m.statuses,
        linksByItem,
        bundlePaths,
        others,
        extra: {
          externalChanges: externalOf(w, entries, judged),
          conflicts,
          mergeSuggestions: m.mergeSuggestions.filter((x) => ids.has(x.bundle_id)),
        },
        rate,
        seed: `C/${run}/${w}`,
        includeIds: previous?.items.map((x) => x.audit_id) ?? [],
      });
      const input = { schema_version: 'pass2-audit-input-0.1.0', kind: 'C', run, wave: w, judge_family: judgeFamily, bundle_stamps: stampsUpTo(w), ...sample };
      input.source_sha256 = sha256(JSON.stringify(input));
      return input;
    };
    // 회차 w 감사 판정. 도장이 그대로면 그대로 검사하고, shard만 바뀌었으면 carryOverAudit로 이어 인정을 따진다
    const checkWave = (w, depth = 0) => {
      const input = readJsonIfExists(inputPathOf(w));
      const out = readJsonIfExists(outputPathOf(w));
      if (!input || !out) return { input, out, errors: ['감사 입력 또는 출력이 없다'], reviewed: 0, judgments: {}, carry: null };
      const current = stampsUpTo(w);
      let stamps = current;
      let carry = null;
      if (JSON.stringify(input.bundle_stamps) !== JSON.stringify(current)) {
        const snapshots = new Map(input.bundle_stamps.map((s) => {
          const f = path.join(shardStore, `${s.shard_sha256}.json`);
          return [s.bundle_id, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null];
        }));
        const later = [];
        for (const lw of [...new Set(plan.bundles.map((b) => b.wave))].filter((x) => x > w).sort((a, b) => a - b)) {
          const r = checkWave(lw, depth + 1);
          if (!r.errors.length) later.push({ wave: lw, input: r.input });
        }
        let regenerated = null;
        try {
          regenerated = buildInput(w, input, input.judge_family, input.rate).items;
        } catch (e) {
          regenerated = { error: e.message };
        }
        carry = carryOverAudit({ audited: input, current, snapshots, shardsNow: new Map(current.map((s) => [s.bundle_id, shardText(s.bundle_id)])), regenerated, later });
        if (carry.ok) stamps = input.bundle_stamps;
      }
      const r = checkAudit(input, out, { store: ctx.store, bundleStamps: stamps, problems: C_REVIEW_PROBLEMS });
      if (carry && !carry.ok) r.errors.push(...carry.errors.map((e) => `이어 인정 불가: ${e}`));
      if (!r.errors.length && !carry) storeShards(current);
      return { ...r, input, out, carry };
    };

    if (cmd === 'audit-input') {
      const judgeFamily = argValue(args, 'judge-family') ?? 'gemini';
      if (!['gemini', 'gpt', 'claude'].includes(judgeFamily)) throw new Error('judge-family는 gemini | gpt | claude 중 하나다');
      const inputPath = inputPathOf(wave);
      const input = buildInput(wave, readJsonIfExists(inputPath), judgeFamily, Number(argValue(args, 'rate') ?? 0.1));
      storeShards(input.bundle_stamps);
      await writeJsonAtomic(inputPath, input);
      console.log(`[audit-input] 회차 ${wave}: 단위 표본 ${input.sampled_units}/${input.population_units}, 전수 항목 ${input.extra_items}(외부 변경·충돌·병합 제안) → ${relPath(inputPath)}`);
      for (const c of input.strata) console.log(`  층 ${c.stratum}: 모집단 ${c.population}, 표본 ${c.sampled} (비율 ${c.rate})`);
      console.log(`[audit-input] 다른 모델의 감사 출력 → ${relPath(outputPathOf(wave))}`);
    } else {
      const r = checkWave(wave);
      const { input, out } = r;
      for (const e of r.errors) console.log(`  ERROR ${e}`);
      if (!input || !out) {
        process.exitCode = 1;
        return;
      }
      if (r.carry?.ok) {
        for (const c of r.carry.changes) console.log(`  [이어 인정] ${c.bundle_id}: 연결 ${c.links.join(',') || '-'} / 지운 연결 ${c.removed_links.join(',') || '-'} / 자기 상태 ${c.unlinked.join(',') || '-'} / 병합 제안 ${c.merge_suggestions.join(',') || '-'} → 회차 ${c.covered_by.join(',')} 감사가 덮음`);
      }
      console.log(`${r.errors.length ? '[FAIL]' : '[PASS]'} 감사 ${r.reviewed}/${input.items.length}항목, 판정 ${JSON.stringify(r.judgments)}${r.carry?.ok ? ' (shard 변경 이어 인정)' : ''}`);
      const reviews = Array.isArray(out.reviews) ? out.reviews : [];
      const problemCounts = reviews.flatMap((x) => x.problems ?? []).reduce((acc, c) => ((acc[c] = (acc[c] ?? 0) + 1), acc), {});
      console.log(`[audit-check] 감사자 ${out.auditor_family ?? '?'} / ${out.auditor_model ?? '?'} / 세션 ${out.auditor_session ?? '?'}, 문제 코드 ${JSON.stringify(problemCounts)}`);
      for (const x of reviews.filter((y) => y.judgment !== '맞음' || (y.problems ?? []).length)) {
        console.log(`  ${x.audit_id} [${x.judgment}] ${(x.problems ?? []).join(', ') || '-'}`);
        console.log(`    이유: ${x.reason ?? ''}`);
        if (x.evidence) console.log(`    근거: ${typeof x.evidence === 'string' ? x.evidence : JSON.stringify(x.evidence)}`);
      }
      if (r.errors.length) process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'cand') {
    const [bundleId, unitId] = args.filter((a) => !a.startsWith('--'));
    if (!bundleId) throw new Error('cand <bundle_id> [<item_id>] [--offset=0] [--limit=50]');
    const bundle = loadBundle(P, bundleId);
    const cand = loadCandidates(bundle);
    const store = new SceneStore();
    const pairs = bundle.suggested_pairs.filter((p) => !unitId || p.unit === unitId);
    console.log(`# 제시 쌍 ${pairs.length}개${unitId ? ` (${unitId})` : ''}`);
    for (const p of pairs) console.log(`${p.pair_id} ${p.unit} ↔ ${p.other.ref === 'item' ? p.other.item_id : `${p.other.scan_id} ${p.other.scene_id} ${lineTag(p.other.line_start)}`} (${p.source}${p.cross_title ? ', 다른 이야기' : ''})`);
    const hits = cand.hits.filter((h) => !unitId || h.unit_ids.includes(unitId));
    const limit = Number(argValue(args, 'limit')) || 50;
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const shown = hits.slice(offset, offset + limit);
    console.log(`# C-0 적중 ${hits.length}줄${offset + shown.length < hits.length ? `, 이어 보기: --offset=${offset + shown.length}` : ''}`);
    for (const h of shown) console.log(`${h.scan_id} ${h.scene_id} ${lineTag(h.line)} (${h.title_id}) [${h.terms.join(', ')}]${h.overlaps.length ? ` 단서 ${h.overlaps.join(',')}` : ''} ${String(store.lines(h.scene_id)[h.line]).slice(0, 160)}`);
    if (unitId) {
      const u = cand.scan_terms.find((x) => x.item_id === unitId);
      if (u) console.log(`# 검색어: 쓴 것 ${u.kept.map((t) => `${t.term}(${t.scene_count}장면)`).join(', ') || '-'} / 흔해서 뺀 것 ${u.dropped.map((t) => `${t.term}(${t.scene_count}장면)`).join(', ') || '-'}`);
    }
    return;
  }

  if (cmd === 'show') {
    const [sceneId, from, to] = args.filter((a) => !a.startsWith('--'));
    const ctx = makeCtx();
    const lines = ctx.store.lines(sceneId);
    if (!lines) throw new Error(`등록 장면이 아니다: ${sceneId}`);
    const a = Math.max(1, Number(from) || 1);
    const b = Math.min(lines.length - 1, Number(to) || lines.length - 1);
    const meta = ctx.store.meta(sceneId);
    console.log(`@@@ ${sceneId} | ${meta.title_id} | ${meta.sub_title ?? ''} | ${lines.length - 1}줄`);
    const clues = (ctx.clhByScene.get(sceneId) ?? []).filter((c) => overlaps(c.line_start, c.line_end, a, b));
    console.log(`# 단서 항목: ${clues.length ? '' : '없음'}`);
    for (const c of clues) console.log(`#   ${c.item_id} L${c.line_start}-L${c.line_end} | ${c.clue_category} | ${c.subject ?? '-'} | ${c.keyword}`);
    for (let i = a; i <= b; i++) console.log(`[${lineTag(i)}] ${lines[i]}`);
    return;
  }

  if (cmd === 'grep') {
    const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    const title = argValue(args, 'title');
    const titles = title ? [...new Set(title.split(',').map((t) => t.trim()).filter(Boolean))] : [];
    if (term.length < 1 || (term.length < 2 && !titles.length)) throw new Error('검색어는 2글자 이상이다. 한 글자 검색어는 --title=<title_id>로 이야기를 정할 때만 쓴다');
    const bundle = argValue(args, 'bundle');
    const unit = argValue(args, 'unit');
    if (!bundle || !unit) throw new Error('grep <낱말> --bundle=<bundle_id> --unit=<item_id> [--title=<title_id>[,…]]');
    const limit = Math.min(100, Math.max(1, Number(argValue(args, 'limit')) || 30));
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const ctx = makeCtx();
    const store = ctx.store;
    for (const t of titles) if (!store.titleIndex.has(t)) throw new Error(`등록 이야기가 아니다: ${t}`);
    const sceneIds = titles.length ? titles.flatMap((t) => store.titles[store.titleIndex.get(t)].scene_ids.filter((id) => store.has(id))) : [...store.allSceneIds()];
    const hits = [];
    const scenes = new Set();
    for (const sid of sceneIds) {
      const lines = store.lines(sid);
      for (let i = 1; i < lines.length; i++) if (lines[i]?.includes(term)) {
        hits.push({ scene_id: sid, line: i });
        scenes.add(sid);
      }
    }
    const shown = hits.slice(offset, offset + limit);
    const end = offset + shown.length;
    console.log(`"${term}": 장면 ${scenes.size}개, ${hits.length}줄${end < hits.length ? ` (이어 보기: --offset=${end})` : ''}`);
    for (const h of shown) {
      const clue = (ctx.clhByScene.get(h.scene_id) ?? []).find((c) => c.line_start <= h.line && h.line <= c.line_end);
      console.log(`${h.scene_id} [${lineTag(h.line)}] (${store.meta(h.scene_id).title_id})${clue ? ` {${clue.item_id}}` : ''} ${store.lines(h.scene_id)[h.line]}`);
    }
    await fsp.mkdir(P.root, { recursive: true });
    await fsp.appendFile(P.searchLog, `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundle, unit_id: unit, term, titles, scenes: scenes.size, lines: hits.length, limit, offset, shown: shown.length })}\n`);
    return;
  }

  if (cmd === 'entity') {
    const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!q) throw new Error('entity <이름>');
    const nq = nfkc(q);
    const has = (names) => names.some((n) => nfkc(n ?? '').includes(nq));
    const reg = [...loadRegistry().values()].filter((e) => has([e.canonical_name, ...(e.surface_labels ?? [])]));
    const off = [...loadPass2Entities().values()].filter((e) => has([e.canonical_name, ...(e.surface_labels ?? [])]));
    const terms = (readJsonIfExists(OFFICIAL_TERMS_PATH)?.terms ?? []).filter((t) => has([t.canonical_name, ...(t.surfaces ?? [])]));
    if (!reg.length && !off.length && !terms.length) console.log(`"${q}": 레지스트리·공식 표·표기 묶음에 없다`);
    for (const e of reg.slice(0, 15)) console.log(`entity\t${e.entity_id}\t${e.canonical_name}\t별칭: ${(e.surface_labels ?? []).join(', ')}`);
    for (const e of off.slice(0, 15)) console.log(`entity\t${e.entity_id}\t${e.canonical_name}\t${e.entity_type}${e.qualifier ? ` (${e.qualifier})` : ''}\t표기: ${(e.surface_labels ?? []).join(', ')}`);
    for (const t of terms.slice(0, 15)) console.log(`term\t${t.term_key}\t${t.canonical_name}\t${t.entity_type}${t.qualifier ? ` (${t.qualifier})` : ''}\t표기: ${(t.surfaces ?? []).join(', ')}`);
    return;
  }

  console.log('사용법: build --all | build --select="C1__001,…;C1__010,…" | status [--wave=N] | validate <bundle_id> | cand <bundle_id> [<item_id>] | show <scene_id> [시작 끝] | grep <낱말> --bundle= --unit= [--title=a,b] | entity <이름> | finish | audit-input --wave=N [--rate=0.1] | audit-check --wave=N | copy-bundles --from=pilot --bundles=… --run=retest  [--run=pilot|retest|wf|main]');
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(`[pass2-c] ${e.message}`);
    process.exitCode = 1;
  });
}
