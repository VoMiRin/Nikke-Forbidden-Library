import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_DATA_DIR, ROOT_DIR, normalizeWhitespaceOnly } from './lib.mjs';
import {
  extractRawLinesFromNumberedScript,
  extractUtteranceTextFromRawLine,
  normalizeQuoteUtterance,
} from './validate-output.mjs';

// Pass 2 공용 도구(명세 5절 Pass 2). 묶음 도구·검증기·병합기가 함께 쓴다.
// 입력은 병합 결과 by_title과 배치 입력의 numbered_script뿐이다. pass1/shards/는 읽지 않는다(명세 5절, 초안 4절).

export const PASS2_SCHEMA_VERSION = 'pass2-0.1.0';
export const PASS2_BUNDLE_SCHEMA_VERSION = 'pass2-bundle-0.1.0';
export const PASS2_DIR = path.join(GRAPH_DATA_DIR, 'pass2');

export const CONFIDENCE_ENUM = new Set(['유력한 해석', '가능성', '판단 보류']);
export const ENTITY_TYPE_ENUM = new Set([
  'character',
  'squad',
  'organization',
  'location',
  'item',
  'concept',
  'event',
]);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export const readJsonIfExists = (p) => {
  try {
    return readJson(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

export const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
export const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
export const relPath = (p) => path.relative(ROOT_DIR, p).split(path.sep).join('/');

/** 병합 결과 by_title 전체. title_id → 문서 */
export const loadByTitle = (graphDir = GRAPH_DATA_DIR) => {
  const dir = path.join(graphDir, 'pass1', 'by_title');
  const out = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    const doc = readJson(path.join(dir, f));
    out.set(doc.title_id, doc);
  }
  return out;
};

/**
 * 등록 장면 원문. 매니페스트에서 장면 순서·배치를 읽고, 원문은 배치 입력의 numbered_script에서 필요할 때 읽는다.
 * 매니페스트에 없는 장면은 등록되지 않은 것이다(명세 1.1).
 */
export class SceneStore {
  constructor(graphDir = GRAPH_DATA_DIR) {
    this.graphDir = graphDir;
    const manifest = readJson(path.join(graphDir, 'manifest.json'));
    this.titles = manifest.titles;
    this.titleIndex = new Map(manifest.titles.map((t, i) => [t.title_id, i]));
    this.scenes = new Map();
    this.sceneOrder = new Map();
    let n = 0;
    for (const t of manifest.titles) {
      t.scene_ids.forEach((sid, idx) => {
        const s = manifest.scenes[sid];
        this.scenes.set(sid, {
          scene_id: sid,
          title_id: s.title_id,
          category: s.category,
          sub_title: s.sub_title ?? null,
          batch_id: s.batch_id,
          index_in_title: idx,
          mgt: s.mechanical_ground_truth,
        });
        this.sceneOrder.set(sid, n++);
      });
    }
    this.batchCache = new Map();
  }

  has(sceneId) {
    return this.scenes.has(sceneId);
  }

  meta(sceneId) {
    return this.scenes.get(sceneId) ?? null;
  }

  numberedScript(sceneId) {
    const meta = this.scenes.get(sceneId);
    if (!meta) return null;
    let batch = this.batchCache.get(meta.batch_id);
    if (!batch) {
      const doc = readJson(path.join(this.graphDir, 'pass1', 'batches', `${meta.batch_id}.json`));
      batch = new Map(doc.scenes.map((s) => [s.scene_id, s.numbered_script]));
      this.batchCache.set(meta.batch_id, batch);
    }
    return batch.get(sceneId) ?? null;
  }

  /** 1부터 세는 원문 줄 배열(앞에 빈 칸 하나). lines[1]이 L0001이다. */
  lines(sceneId) {
    const ns = this.numberedScript(sceneId);
    if (ns === null) return null;
    return ['', ...extractRawLinesFromNumberedScript(ns)];
  }

  *allSceneIds() {
    yield* this.scenes.keys();
  }
}

/** 레지스트리(인물). entity_id → 엔티티 */
export const loadRegistry = (graphDir = GRAPH_DATA_DIR) => {
  const doc = readJson(path.join(graphDir, 'entity_registry.json'));
  return new Map(doc.entities.map((e) => [e.entity_id, e]));
};

/** Pass 2 엔티티 표(스쿼드·조직, 초안 9절 3번). 아직 없으면 빈 표다. */
export const loadPass2Entities = (graphDir = GRAPH_DATA_DIR) => {
  const doc = readJsonIfExists(path.join(graphDir, 'pass2', 'entities.json'));
  return new Map((doc?.entities ?? []).map((e) => [e.entity_id, e]));
};

// ---------------------------------------------------------------------------
// 인용 검사: Pass 1 검증기 2.3의 6항과 같은 방식(validate-output.mjs verifyQuoteInRange)

const isShortQuoteAllowed = (q, slice, utt) =>
  q.length >= 4 ||
  (slice.length > 0 && slice.length < 4 && q === slice) ||
  (utt.length > 0 && utt.length < 4 && q === utt);

/** lines는 SceneStore.lines()의 값. 통과하면 null, 아니면 이유 문자열 */
export const checkQuote = (lines, lineStart, lineEnd, quote) => {
  if (!isPositiveInt(lineStart) || !isPositiveInt(lineEnd)) return 'line_start·line_end는 1 이상의 정수여야 한다';
  const total = lines.length - 1;
  if (lineStart > lineEnd || lineEnd > total) return `줄 범위 ${lineStart}~${lineEnd}가 장면 밖이다(장면은 ${total}줄)`;
  if (!isNonEmptyString(quote)) return 'quote가 비어 있다';
  const slice = lines.slice(lineStart, lineEnd + 1);
  const q = normalizeWhitespaceOnly(quote);
  const normSlice = normalizeWhitespaceOnly(slice.join(' '));
  const normUtt = normalizeWhitespaceOnly(slice.map(extractUtteranceTextFromRawLine).filter(Boolean).join(' '));
  const qUtt = normalizeQuoteUtterance(quote, slice);
  const ok = normSlice.includes(q) || normUtt.includes(q) || (qUtt.length > 0 && normUtt.includes(qUtt));
  if (!ok) return `인용 "${q.slice(0, 60)}"이 L${lineStart}~L${lineEnd}에 없다`;
  const eff = qUtt.length > 0 && qUtt.length < q.length ? qUtt : q;
  if (!isShortQuoteAllowed(eff, normSlice, normUtt)) return `인용이 4글자보다 짧다("${q}")`;
  return null;
};

// ---------------------------------------------------------------------------
// 공개 시점(명세 5절 공개 시점 규칙)

export const loadReleaseDates = (graphDir = GRAPH_DATA_DIR) => {
  const text = fs.readFileSync(path.join(graphDir, 'release_dates.csv'), 'utf8').replace(/^﻿/, '');
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = header.split(',');
  const out = new Map();
  for (const row of rows) {
    const cells = row.split(',');
    const rec = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    // 제목에 쉼표가 들어가면 칸이 밀리므로 날짜는 마지막 칸에서 읽는다
    out.set(rec.title_id, {
      category: rec.category,
      order: Number(rec.order),
      release_date: cells[cells.length - 1].trim(),
    });
  }
  return out;
};

/**
 * 단서 쪽 타이틀과 공개 쪽 타이틀의 공개 순서.
 * 날짜 비교 → 같은 날이면 같은 분류 안에서만 order 비교 → 월만 아는 날짜는 같은 달과 앞뒤를 정하지 않는다.
 * 결과: 단서 먼저 | 공개 먼저 | 같은 이야기 | 앞뒤 미정 | 공개 시점 없음
 */
export const compareRelease = (releaseDates, clueTitleId, revealTitleId) => {
  if (clueTitleId === revealTitleId) return { result: '같은 이야기', basis: 'same_title' };
  const a = releaseDates.get(clueTitleId);
  const b = releaseDates.get(revealTitleId);
  if (!a || !b) {
    const missing = [!a && clueTitleId, !b && revealTitleId].filter(Boolean);
    return { result: '공개 시점 없음', basis: `release_dates.csv에 없음: ${missing.join(', ')}` };
  }
  const da = a.release_date;
  const db = b.release_date;
  const monthOnly = (d) => /^\d{4}-\d{2}$/.test(d);
  if (monthOnly(da) || monthOnly(db)) {
    const ma = da.slice(0, 7);
    const mb = db.slice(0, 7);
    if (ma === mb) return { result: '앞뒤 미정', basis: `같은 달(${ma}), 한쪽은 월만 앎` };
    return { result: ma < mb ? '단서 먼저' : '공개 먼저', basis: `date ${da} / ${db}` };
  }
  if (da !== db) return { result: da < db ? '단서 먼저' : '공개 먼저', basis: `date ${da} / ${db}` };
  if (a.category !== b.category) return { result: '앞뒤 미정', basis: `같은 날(${da}), 다른 분류` };
  if (a.order === b.order) return { result: '앞뒤 미정', basis: `같은 날(${da}), 같은 order` };
  return { result: a.order < b.order ? '단서 먼저' : '공개 먼저', basis: `같은 날(${da}), ${a.category} order ${a.order} / ${b.order}` };
};

// ---------------------------------------------------------------------------
// 역방향 원문 스캔(초안 5절 C-0, B-1). 등록 장면 원문 전체에서 검색어가 든 줄을 찾는다.

const LATIN_CODE_RE = /^[A-Za-z0-9#\-_.]+$/;

export const makeTermMatcher = (term) => {
  if (LATIN_CODE_RE.test(term)) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${esc}(?=$|[^A-Za-z0-9])`);
    return (line) => re.test(line);
  }
  return (line) => line.includes(term);
};

/**
 * 검색어마다 장면 수와 줄을 센다. store 전체를 한 번 훑는다.
 * 반환: term → { scene_count, hits: [{scene_id, line, in_utterance}] }
 */
export const scanTerms = (store, terms) => {
  const matchers = terms.map((t) => [t, makeTermMatcher(t)]);
  const out = new Map(terms.map((t) => [t, { scene_count: 0, hits: [] }]));
  for (const sid of store.allSceneIds()) {
    const lines = store.lines(sid);
    for (const [term, match] of matchers) {
      let found = false;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] && match(lines[i])) {
          // in_utterance: 화자 라벨이 아니라 대사·본문에 나왔는지
          out.get(term).hits.push({ scene_id: sid, line: i, in_utterance: match(extractUtteranceTextFromRawLine(lines[i])) });
          found = true;
        }
      }
      if (found) out.get(term).scene_count += 1;
    }
  }
  return out;
};

/** 줄 ±radius 발췌. "[L0012] 원문" 형식 */
export const excerpt = (lines, line, radius = 2) => {
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length - 1, line + radius);
  const out = [];
  for (let i = from; i <= to; i++) out.push(`[L${String(i).padStart(4, '0')}] ${lines[i]}`);
  return { line_start: from, line_end: to, text: out.join('\n') };
};

/** 감독관이 쓰는 경로가 저장소 밖인지(정답 파일 보관 규칙, 초안 8절 평가) */
export const isOutsideRepo = (p) => {
  const rel = path.relative(ROOT_DIR, path.resolve(p));
  return rel.startsWith('..') || path.isAbsolute(rel);
};
