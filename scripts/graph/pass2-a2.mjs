import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, normalizeWhitespaceOnly, writeJsonAtomic } from './lib.mjs';
import { selectWave } from './pass2-b-plan.mjs';
import { checkAudit, classifyAuthor, computeStamp, staleReason } from './pass2-b.mjs';
import {
  CONFIDENCE_ENUM,
  ENTITY_TYPE_ENUM,
  PASS2_BUNDLE_SCHEMA_VERSION,
  PASS2_SCHEMA_VERSION,
  SceneStore,
  checkQuote,
  isNonEmptyString,
  isPositiveInt,
  loadByTitle,
  loadPass2Entities,
  loadRegistry,
  readJsonIfExists,
  relPath,
  scanTerms,
} from './pass2-lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// Pass 2 A-2. 미등록 표기 해소(초안 5절 A-2, 12절).
//   node scripts/graph/pass2-a2.mjs build [--pilot | --all] [--max-units=40] [--max-chars=30000] [--wave-size=20] [--run=pilot|main]
//   node scripts/graph/pass2-a2.mjs status [--wave=N] [--run=...]
//   node scripts/graph/pass2-a2.mjs validate <bundle_id> [--run=...]
//   node scripts/graph/pass2-a2.mjs occ <bundle_id> <unit_id> [--title=<title_id>] [--offset=0] [--limit=50] [--run=...]   (단위의 출현 전부)
//   node scripts/graph/pass2-a2.mjs show <scene_id> [시작줄 끝줄]
//   node scripts/graph/pass2-a2.mjs grep <낱말> --bundle=<bundle_id> --unit=<unit_id> [--title=<title_id>] [--limit=30] [--offset=0] [--run=...]
//   node scripts/graph/pass2-a2.mjs entity <이름>
//   node scripts/graph/pass2-a2.mjs finish [--run=...]
//   node scripts/graph/pass2-a2.mjs compare-check [--run=...]          (골라 보여 준 판정 ↔ 전부 보여 준 판정)
//   node scripts/graph/pass2-a2.mjs b-update-preview [--run=...]       (A-2 뒤 B 갱신 미리 보기. B 결과는 고치지 않는다)
//   node scripts/graph/pass2-a2.mjs audit-input --wave=N [--rate=0.1] [--judge-family=gemini] [--run=...]
//   node scripts/graph/pass2-a2.mjs audit-check --wave=N [--run=...]
// build는 기계 작업이다. 표기가 무엇인지는 판정하지 않는다.

// ---------------------------------------------------------------------------
// 상수

export const A2_ENTITY_TYPES = new Set([...ENTITY_TYPE_ENUM, 'faction_or_species']);
/** 엔티티 ID를 주는 유형(초안 9절 3번·8번). 나머지 유형은 표기 묶음(terms)으로만 남긴다 */
export const ID_PREFIX = { character: 'char2_', squad: 'squad_', organization: 'org_' };
export const A2_LINK_TYPES = { alias: '별칭', new_entity: '새 엔티티', generic_term: '일반 낱말', unresolved: '판단 보류' };
export const A2_VERDICTS = new Set(Object.values(A2_LINK_TYPES));

export const SAMPLE_MAX = 40; // 이보다 많이 나온 표기는 골라 보여 준다(초안 9절 8번)
export const EXCERPT_RADIUS = 2;
export const AUTHOR_EXCERPT_LINES = 3;

/** 사용자가 A-2에서 다시 판정하지 않기로 한 표기(GRAPH_RAG_PASS2_A1.md 5절) */
export const USER_EXCLUDED_SURFACES = new Map([
  ['제인', '사용자 제외 2026-11-04(A-1 5절): 등록 제인과 다른 사람'],
  ['사라', '사용자 제외 2026-11-04(A-1 5절): 등록 사라와 다른 사람'],
  ['에이미', '사용자 제외 2026-11-04(A-1 5절): 등록 에이미와 다른 사람'],
]);

/** 사용자 확인 결과. 판정자에게는 알리지 않고, 병합할 때 이 값으로 덮어쓴다(초안 9절 7번) */
export const USER_DECISIONS = new Map([
  ['7호', {
    link_type: 'alias',
    target: { ref: 'entity', entity_id: 'char_지휘관', name: '지휘관', entity_type: 'character' },
    note: '사용자 확인 2026-11-11·12: "7호"는 모든 이야기에서 주인공 지휘관(초안 9절 7번)',
  }],
]);

// A-2 파일럿 표기(초안 12.5절). 같은 기계 변형 무리(공백·기호·대소문자만 다른 표기)는 build가 함께 넣는다.
export const PILOT_SURFACES = [
  // 반드시 넣을 표기(초안 8절 5번, 9절 7번, A-1 5절)
  '소피아', '7호', '■휘■', '마리아', '조나단 크로스', '잉크', '미친개', '잭 로우', '테디', '애니힐리오', '랩칠리언',
  // A-2 뒤 B 갱신 경로(같은 이야기에 같은 표기가 있는 B 미등록 대상)
  '마르셀 버몬트', '도이스', '루아', '고아원 원장', '어드마이어 호', '근접 전투 스쿼드', '괴도단', '포비스트', '길드원들', 'XX 중학교',
  // 출현이 많은 표기, 여러 유형으로 적힌 표기, 기계 변형 무리
  '방주', '랩쳐', '중앙 정부', '지휘관실', '전초기지', '퀸', '카운터스', '미실리스', '에덴', '메티스', '침식', 'NIMPH',
  '언체인드', 'A.C.P.U.', '세이렌', 'T.T. STAR', '퍼펙트', '블랙스미스', '사장님', '사고 전환', '3차 지상 탈환전', '파르마의 성', '신',
  '지상',
];
/** 골라 보여 준 판정과 비교하려고 전부 보여 주는 표기(초안 12.5절). 출현 72~508곳 */
export const PILOT_CHECK_SURFACES = ['7호', '퀸', '전초기지', '에덴', '포비스트', '지상'];
/** 감사 때 골라 보여 준 단위마다 따로 뽑아 주는 못 본 출현 수(초안 12.6절) */
export const AUDIT_UNSEEN_PROBES = 3;
export const ENTITY_KEY_RE = /^E\d{1,3}$/;
export const PILOT_SINGLETONS_PER_TYPE = 2;

const RUNS = new Set(['pilot', 'main']);
const runRoot = (run) => path.join(GRAPH_DATA_DIR, 'pass2', run === 'main' ? 'a2' : 'a2-pilot');
const RULES_PATH = path.resolve(GRAPH_DATA_DIR, '..', '..', 'docs', 'graphrag', 'GRAPH_RAG_PASS2_A2_RULES.md');
const B_MERGED_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'merged', 'B_candidates.json');
const pathsOf = (run) => {
  const root = runRoot(run);
  return {
    root,
    bundles: path.join(root, 'bundles'),
    plan: path.join(root, 'bundles', 'plan.json'),
    mechanical: path.join(root, 'bundles', 'mechanical.json'),
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

export const nfkc = (s) => String(s ?? '').normalize('NFKC');
/** 기계 변형 기준(실태 조사 2.3의 1·3번): NFKC, 영문 소문자, 공백·가운뎃점·하이픈·괄호·따옴표 제거 */
export const variantKey = (s) => nfkc(s).toLowerCase().replace(/[\s·・\-‐–—[\]【】「」『』"'“”‘’]/g, '');
export const normName = (s) => normalizeWhitespaceOnly(nfkc(s)).replace(/\s/g, '');

// ---------------------------------------------------------------------------
// 모집단(초안 12.1절)

/** 등록 이름·별칭 → entity_id. NFKC로 맞춘다(레지스트리는 NFKC로 저장됨, 실태 조사 이상 징후 2번) */
export const registryLabelIndex = (registry) => {
  const out = new Map();
  for (const e of registry.values()) for (const l of e.surface_labels ?? []) out.set(nfkc(l), e.entity_id);
  return out;
};

const participantIds = (scene) => {
  const p = scene.participants ?? {};
  return new Set(['present_in_scene', 'present_silent', 'remote_or_voice_only'].flatMap((k) => (p[k] ?? []).map((x) => x.entity_id)).filter(Boolean));
};

/**
 * 판정할 항목과 사용자 제외 항목을 가른다.
 * 항목 출처: 미등록 후보(uec), entity_id가 null인 언급(mention), B가 A-2로 넘긴 작성자(author).
 * 표기가 등록 이름·별칭과 같고 같은 장면 참여자가 그 엔티티이면 participant_match로 표시만 한다(A-1 skip_conflict).
 * 참여자가 있다고 그 언급이 그 인물이라는 보장은 없으므로 판정은 판정자가 한다(초안 3절, 12.1절).
 */
export const collectA2Items = (titleDocs, { registry, genericLabels }) => {
  const labels = registryLabelIndex(registry);
  const items = [];
  const excluded = [];
  for (const doc of titleDocs) {
    for (const scene of doc.scenes ?? []) {
      const base = { scene_id: scene.scene_id, title_id: doc.title_id, category: doc.category };
      const found = [];
      for (const c of scene.unregistered_entity_candidates ?? []) {
        found.push({ ...base, source: 'uec', item_id: c.item_id, surface: c.surface_text, type: c.suggested_type, line_start: c.line_start, line_end: c.line_start });
      }
      for (const m of scene.participants?.mentioned_only ?? []) {
        if (m.entity_id != null) continue;
        found.push({ ...base, source: 'mention', item_id: m.item_id, surface: m.surface_text, type: m.entity_type, line_start: m.line_start, line_end: m.line_end ?? m.line_start });
      }
      const author = scene.participants?.document_author;
      if (author && author.entity_id == null && classifyAuthor(author.name, scene, genericLabels).route === 'A2') {
        found.push({ ...base, source: 'author', item_id: author.item_id, surface: author.name.trim(), type: 'document_author', line_start: null, line_end: null });
      }
      const present = participantIds(scene);
      for (const it of found) {
        if (!isNonEmptyString(it.surface)) continue;
        if (USER_EXCLUDED_SURFACES.has(it.surface)) {
          excluded.push({ ...it, reason: USER_EXCLUDED_SURFACES.get(it.surface) });
          continue;
        }
        const reg = labels.get(nfkc(it.surface));
        items.push(reg && present.has(reg) ? { ...it, participant_match: reg } : it);
      }
    }
  }
  return { items, excluded };
};

/** 같은 장면에서 줄이 겹치는 항목(미등록 후보와 언급)은 한 출현이다. 작성자는 장면마다 따로 한 출현이다 */
export const groupOccurrences = (items, store) => {
  const byScene = new Map();
  for (const it of items) {
    if (!byScene.has(it.scene_id)) byScene.set(it.scene_id, []);
    byScene.get(it.scene_id).push(it);
  }
  const occs = [];
  for (const [sid, list] of byScene) {
    const lined = list.filter((x) => isPositiveInt(x.line_start)).sort((a, b) => a.line_start - b.line_start || a.line_end - b.line_end);
    let cur = null;
    for (const it of lined) {
      if (cur && it.line_start <= cur.line_end) {
        cur.line_end = Math.max(cur.line_end, it.line_end);
        cur.items.push(it);
      } else {
        cur = { scene_id: sid, title_id: it.title_id, category: it.category, line_start: it.line_start, line_end: it.line_end, items: [it] };
        occs.push(cur);
      }
    }
    for (const it of list.filter((x) => !isPositiveInt(x.line_start))) {
      occs.push({ scene_id: sid, title_id: it.title_id, category: it.category, line_start: null, line_end: null, items: [it] });
    }
  }
  const order = (o) => (store.sceneOrder?.get(o.scene_id) ?? 0) * 100000 + (o.line_start ?? 0);
  return occs.sort((a, b) => order(a) - order(b)).map((o) => ({
    scene_id: o.scene_id,
    title_id: o.title_id,
    category: o.category,
    line_start: o.line_start,
    line_end: o.line_end,
    item_ids: o.items.map((x) => x.item_id),
    sources: [...new Set(o.items.map((x) => x.source))].sort(),
    types: [...new Set(o.items.map((x) => x.type))].sort(),
    ...(o.items.some((x) => x.participant_match) ? { participant_match: o.items.find((x) => x.participant_match).participant_match } : {}),
  }));
};

const occKey = (o) => `${o.scene_id}:${o.line_start ?? 'author'}:${o.item_ids[0]}`;

const combosOf = (o) => o.types.map((t) => `${t}/${o.category}`);

/**
 * 골라 보여 주기(초안 9절 8번). max개 이하면 전부. 넘으면 (기록된 유형 × 분류) 조합마다 하나,
 * 남은 유형·분류마다 하나를 먼저 넣고, 나머지는 이야기를 돌아가며 하나씩 넣는다. 같은 입력이면 늘 같은 결과다.
 * Pass 1 유형이 틀렸으면 이 기준도 함께 틀린다. 같은 유형·분류 안의 동명이인은 보장하지 않는다.
 */
export const sampleOccurrences = (surface, occs, max = SAMPLE_MAX) => {
  if (occs.length <= max) return new Set(occs.map(occKey));
  const rank = (o) => hashRank(surface, occKey(o));
  const byRank = (a, b) => rank(a).localeCompare(rank(b));
  const chosen = new Set();
  const cover = (values, has) => {
    for (const v of values) {
      if (chosen.size >= max) return;
      if (occs.some((o) => chosen.has(occKey(o)) && has(o, v))) continue;
      const pick = occs.filter((o) => has(o, v)).sort(byRank)[0];
      if (pick) chosen.add(occKey(pick));
    }
  };
  cover([...new Set(occs.flatMap(combosOf))].sort(), (o, v) => combosOf(o).includes(v));
  cover([...new Set(occs.flatMap((o) => o.types))].sort(), (o, v) => o.types.includes(v));
  cover([...new Set(occs.map((o) => o.category))].sort(), (o, v) => o.category === v);
  const titles = new Map();
  for (const o of occs) {
    if (!titles.has(o.title_id)) titles.set(o.title_id, []);
    titles.get(o.title_id).push(o);
  }
  const titleOrder = [...titles.keys()].sort((a, b) => hashRank(surface, a).localeCompare(hashRank(surface, b)));
  for (const t of titleOrder) titles.get(t).sort(byRank);
  for (let round = 0; chosen.size < max; round++) {
    let progressed = false;
    for (const t of titleOrder) {
      const o = titles.get(t)[round];
      if (!o) continue;
      progressed = true;
      if (!chosen.has(occKey(o))) chosen.add(occKey(o));
      if (chosen.size >= max) break;
    }
    if (!progressed) break;
  }
  return chosen;
};

/** 표기 하나가 판정 단위 하나다. 출현 전부(occurrences)와 보여 줄 출현(shown)을 함께 만든다 */
export const buildUnits = (items, store, { registry, sampleMax = SAMPLE_MAX, fullSurfaces = new Set() }) => {
  const labels = registryLabelIndex(registry);
  const bySurface = new Map();
  for (const it of items) {
    if (!bySurface.has(it.surface)) bySurface.set(it.surface, []);
    bySurface.get(it.surface).push(it);
  }
  const units = [];
  for (const [surface, list] of bySurface) {
    const occs = groupOccurrences(list, store);
    const full = fullSurfaces.has(surface);
    const shown = full ? new Set(occs.map(occKey)) : sampleOccurrences(surface, occs, sampleMax);
    occs.forEach((o, i) => {
      o.occ_id = `O${pad(i + 1, 4)}`;
      o.shown = shown.has(occKey(o));
    });
    const titles = new Map();
    for (const o of occs) {
      const t = titles.get(o.title_id) ?? { title_id: o.title_id, category: o.category, occurrences: 0, shown: 0 };
      t.occurrences += 1;
      if (o.shown) t.shown += 1;
      titles.set(o.title_id, t);
    }
    const typeCounts = {};
    const sourceCounts = {};
    for (const it of list) {
      typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
      sourceCounts[it.source] = (sourceCounts[it.source] ?? 0) + 1;
    }
    const regId = labels.get(nfkc(surface));
    const reg = regId ? registry.get(regId) : null;
    const allCombos = [...new Set(occs.flatMap(combosOf))].sort();
    const shownCombos = new Set(occs.filter((o) => o.shown).flatMap(combosOf));
    units.push({
      surface,
      variant_key: variantKey(surface),
      registry_match: reg ? { entity_id: reg.entity_id, canonical_name: reg.canonical_name, surface_labels: reg.surface_labels, scene_count: reg.scene_count ?? null } : null,
      occurrence_total: occs.length,
      item_total: list.length,
      shown_total: occs.filter((o) => o.shown).length,
      sampled: occs.some((o) => !o.shown),
      coverage: {
        titles: titles.size,
        titles_shown: [...titles.values()].filter((t) => t.shown > 0).length,
        type_category_combos: allCombos.length,
        combos_shown: shownCombos.size,
        combos_not_shown: allCombos.filter((c) => !shownCombos.has(c)),
        participant_match_occurrences: occs.filter((o) => o.participant_match).length,
      },
      pass1_types: typeCounts,
      sources: sourceCounts,
      titles: [...titles.values()],
      occurrences: occs,
    });
  }
  return units.sort((a, b) => a.variant_key.localeCompare(b.variant_key) || a.surface.localeCompare(b.surface));
};

// ---------------------------------------------------------------------------
// 발췌 대본

const mergeRanges = (ranges) => {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
};

/** 단위 하나의 발췌. 보여 줄 출현만 장면별로 앞뒤 2줄을 붙여 합친다 */
export const unitExcerptText = (unit, unitId, store) => {
  const shown = unit.occurrences.filter((o) => o.shown);
  const titleCount = unit.titles.length;
  const head = unit.sampled
    ? `### ${unitId} 「${unit.surface}」 — 출현 ${unit.occurrence_total}곳·이야기 ${titleCount}개 중 ${shown.length}곳을 골라 보여 줌`
    : `### ${unitId} 「${unit.surface}」 — 출현 ${unit.occurrence_total}곳·이야기 ${titleCount}개 전부`;
  const out = [head];
  const byScene = new Map();
  for (const o of shown) {
    if (!byScene.has(o.scene_id)) byScene.set(o.scene_id, []);
    byScene.get(o.scene_id).push(o);
  }
  for (const [sid, list] of byScene) {
    const lines = store.lines(sid) ?? [''];
    const meta = store.meta(sid) ?? {};
    const itemNote = list.map((o) => `${o.occ_id}: ${o.item_ids.join(', ')}(${o.types.join('/')})${o.participant_match ? ` [같은 장면 참여자: ${o.participant_match}]` : ''}`).join('; ');
    out.push(`@@@ ${sid} | ${meta.title_id ?? list[0].title_id} | ${meta.sub_title ?? ''} | ${itemNote}`);
    const ranges = [];
    for (const o of list) {
      if (isPositiveInt(o.line_start)) {
        ranges.push([Math.max(1, o.line_start - EXCERPT_RADIUS), Math.min(lines.length - 1, o.line_end + EXCERPT_RADIUS)]);
      } else {
        // 작성자: 표기가 나온 줄, 없으면 장면 첫 줄들
        const hits = [];
        for (let i = 1; i < lines.length; i++) if (lines[i].includes(unit.surface)) hits.push(i);
        if (hits.length) for (const h of hits.slice(0, 3)) ranges.push([Math.max(1, h - EXCERPT_RADIUS), Math.min(lines.length - 1, h + EXCERPT_RADIUS)]);
        else ranges.push([1, Math.min(lines.length - 1, AUTHOR_EXCERPT_LINES)]);
        out.push(`(작성자 항목: document_author.name = "${unit.surface}")`);
      }
    }
    const merged = mergeRanges(ranges);
    merged.forEach(([a, b], i) => {
      if (i > 0) out.push('[…]');
      for (let n = a; n <= b; n++) out.push(`[${lineTag(n)}] ${lines[n] ?? ''}`);
    });
  }
  return `${out.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// 묶음 나누기

/** 같은 변형 무리는 한 묶음에 둔다. 단위 수·글자 수 상한을 넘으면 새 묶음을 연다 */
export const packUnits = (units, { maxUnits = 40, maxChars = 30000 } = {}) => {
  const bundles = [];
  let cur = null;
  for (const u of units) {
    const sameVariant = cur && cur.units.at(-1)?.variant_key === u.variant_key;
    if (!cur || (!sameVariant && (cur.units.length >= maxUnits || cur.chars + u._chars > maxChars))) {
      cur = { units: [], chars: 0 };
      bundles.push(cur);
    }
    cur.units.push(u);
    cur.chars += u._chars;
  }
  return bundles;
};

/** 파일럿: 지정 표기와 그 변형 무리, 유형마다 출현 1곳인 표기 몇 개(기계 선택) */
export const selectPilotUnits = (units, { surfaces = PILOT_SURFACES, singletonsPerType = PILOT_SINGLETONS_PER_TYPE } = {}) => {
  const bySurface = new Map(units.map((u) => [u.surface, u]));
  const missing = surfaces.filter((s) => !bySurface.has(s));
  const keys = new Set(surfaces.filter((s) => bySurface.has(s)).map((s) => bySurface.get(s).variant_key));
  const picked = new Set(units.filter((u) => keys.has(u.variant_key)).map((u) => u.surface));
  const singles = new Map();
  for (const u of units) {
    if (u.occurrence_total !== 1 || picked.has(u.surface) || u.sources.author) continue;
    const type = Object.keys(u.pass1_types).sort()[0];
    if (!singles.has(type)) singles.set(type, []);
    singles.get(type).push(u);
  }
  for (const [, list] of [...singles].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => hashRank('pilot-singleton', a.surface).localeCompare(hashRank('pilot-singleton', b.surface)));
    for (const u of list.slice(0, singletonsPerType)) picked.add(u.surface);
  }
  return { units: units.filter((u) => picked.has(u.surface)), missing };
};

export const buildA2 = async ({ run, pilot, maxUnits = 40, maxChars = 30000, waveSize = 20 }) => {
  if (![maxUnits, maxChars, waveSize].every(isPositiveInt)) throw new Error('max-units·max-chars·wave-size는 1 이상의 정수다');
  const P = pathsOf(run);
  const store = new SceneStore();
  const registry = loadRegistry();
  const genericLabels = new Set(JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'generic_roles.json'), 'utf8')).role_labels);
  const byTitle = loadByTitle();
  const { items, excluded } = collectA2Items([...byTitle.values()], { registry, genericLabels });
  const allUnits = buildUnits(items, store, { registry });
  let units = allUnits;
  let missing = [];
  let checkSurfaces = [];
  if (pilot) {
    ({ units, missing } = selectPilotUnits(allUnits));
    checkSurfaces = PILOT_CHECK_SURFACES.filter((s) => units.some((u) => u.surface === s));
  }
  const checkUnits = checkSurfaces.length
    ? buildUnits(items.filter((it) => checkSurfaces.includes(it.surface)), store, { registry, fullSurfaces: new Set(checkSurfaces) })
    : [];

  await fsp.rm(P.bundles, { recursive: true, force: true });
  await fsp.mkdir(P.bundles, { recursive: true });
  const planBundles = [];
  const writeBundle = async (bundleId, kind, list) => {
    const bundleUnits = list.map((u, i) => {
      const { occurrences, _chars: _c, ...rest } = u;
      return {
        unit_id: `U${pad(i + 1)}`,
        ...rest,
        shown_occurrences: occurrences.filter((o) => o.shown),
      };
    });
    const text = list.map((u, i) => unitExcerptText(u, `U${pad(i + 1)}`, store)).join('\n');
    const scriptFile = path.join(P.bundles, `${bundleId}.excerpts.txt`);
    const occFile = path.join(P.bundles, `${bundleId}.occurrences.json`);
    const bundle = {
      schema_version: PASS2_BUNDLE_SCHEMA_VERSION,
      bundle_id: bundleId,
      kind: kind === 'check' ? 'A2-check' : 'A2',
      generated_at: new Date().toISOString(),
      script_file: relPath(scriptFile),
      occurrences_file: relPath(occFile),
      sample_max: SAMPLE_MAX,
      units: bundleUnits,
    };
    await fsp.writeFile(scriptFile, text, 'utf8');
    await writeJsonAtomic(occFile, { bundle_id: bundleId, units: list.map((u, i) => ({ unit_id: `U${pad(i + 1)}`, surface: u.surface, occurrences: u.occurrences })) });
    await writeJsonAtomic(path.join(P.bundles, `${bundleId}.json`), bundle);
    planBundles.push({
      bundle_id: bundleId,
      kind: bundle.kind,
      units: bundleUnits.length,
      surfaces: bundleUnits.map((u) => u.surface),
      sampled_units: bundleUnits.filter((u) => u.sampled).length,
      excerpt_chars: text.length,
      input: relPath(path.join(P.bundles, `${bundleId}.json`)),
      script: relPath(scriptFile),
      occurrences: relPath(occFile),
      output: relPath(path.join(P.shards, `${bundleId}.json`)),
      validate: `node scripts/graph/pass2-a2.mjs validate ${bundleId} --run=${run}`,
    });
  };

  for (const u of units) u._chars = unitExcerptText(u, 'U000', store).length;
  const packed = packUnits(units, { maxUnits, maxChars });
  for (const [i, b] of packed.entries()) await writeBundle(`A2__${pad(i + 1)}`, 'main', b.units);
  for (const [i, u] of checkUnits.entries()) await writeBundle(`A2C__${pad(i + 1)}`, 'check', [u]);

  const mainCount = packed.length;
  planBundles.forEach((b, i) => {
    b.wave = b.kind === 'A2' ? Math.floor(i / waveSize) + 1 : Math.max(1, Math.ceil(mainCount / waveSize));
  });
  const mechanical = {
    schema_version: PASS2_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    excluded,
  };
  await writeJsonAtomic(P.mechanical, mechanical);
  const plan = {
    schema_version: PASS2_SCHEMA_VERSION,
    kind: 'A2',
    run,
    generated_at: new Date().toISOString(),
    sample_max: SAMPLE_MAX,
    max_units: maxUnits,
    max_chars: maxChars,
    population: {
      items_judged: items.length,
      items_excluded: excluded.length,
      items_participant_match: items.filter((it) => it.participant_match).length,
      surfaces: allUnits.length,
      surfaces_in_plan: units.length,
      check_surfaces: checkSurfaces,
      missing_pilot_surfaces: missing,
    },
    bundles: planBundles,
  };
  await writeJsonAtomic(P.plan, plan);
  return plan;
};

// ---------------------------------------------------------------------------
// 검증기(초안 12.3절)

const LINK_KEYS = new Set(['link_id', 'link_type', 'subject', 'scope', 'target', 'verdict', 'confidence', 'rationale', 'supporting_evidence', 'contradicting_evidence', 'alternatives', 'search_hints']);
const MERGER_ONLY = new Set(['evidence_scenes', 'release_order', 'assigned_entity_id']);
const OTHER_KIND_ONLY = new Set(['roles', 'unlinked', 'search_requests', 'reveals_identity']);
const SCOPE_KEYS = ['title_ids', 'scene_ids', 'occ_ids'];

/** 단위의 연결을 출현마다 펼친다. 출현 예외 > 장면 예외 > 이야기 예외 > 기본. scope 안의 목록은 합집합이다 */
export const resolveOccurrences = (links, occurrences) => {
  let def = null;
  const byTitle = new Map();
  const byScene = new Map();
  const byOcc = new Map();
  for (const l of links) {
    if (l?.scope?.default === true) def = l;
    for (const t of l?.scope?.title_ids ?? []) byTitle.set(t, l);
    for (const s of l?.scope?.scene_ids ?? []) byScene.set(s, l);
    for (const o of l?.scope?.occ_ids ?? []) byOcc.set(o, l);
  }
  return occurrences.map((o) => {
    if (byOcc.has(o.occ_id)) return { occurrence: o, link: byOcc.get(o.occ_id), applied_scope: 'occurrence' };
    if (byScene.has(o.scene_id)) return { occurrence: o, link: byScene.get(o.scene_id), applied_scope: 'scene' };
    if (byTitle.has(o.title_id)) return { occurrence: o, link: byTitle.get(o.title_id), applied_scope: 'title' };
    return { occurrence: o, link: def, applied_scope: 'default' };
  });
};

/** 근거 줄이 출현을 뒷받침하는 위치인가: 같은 장면이고, 줄이 있는 출현이면 그 줄 앞뒤 2줄과 겹친다 */
const evidenceTouches = (ev, o) => {
  if (!ev || ev.scene_id !== o.scene_id) return false;
  if (!isPositiveInt(o.line_start)) return true;
  if (!isPositiveInt(ev.line_start) || !isPositiveInt(ev.line_end)) return false;
  return ev.line_start <= o.line_end + EXCERPT_RADIUS && ev.line_end >= o.line_start - EXCERPT_RADIUS;
};

/** occurrencesByUnit: unit_id → 출현 전부(묶음의 occurrences 파일) */
export const validateA2Shard = (shard, bundle, ctx, occurrencesByUnit) => {
  const errors = [];
  const warnings = [];
  const err = (code, p, message) => errors.push({ code, path: p, message });
  const warn = (code, p, message) => warnings.push({ code, path: p, message });
  if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
    err('SCHEMA', '$', '출력은 JSON 객체여야 한다');
    return { errors, warnings };
  }
  for (const k of Object.keys(shard)) {
    if (k === 'unlinked' || k === 'search_requests') err('FORBIDDEN_FIELD', k, `${k}는 C 묶음 전용이다`);
    else if (!['schema_version', 'bundle_id', 'candidate_links'].includes(k)) err('SCHEMA', k, `알 수 없는 필드 ${k}`);
  }
  if (shard.schema_version !== PASS2_SCHEMA_VERSION) err('SCHEMA', 'schema_version', `schema_version은 "${PASS2_SCHEMA_VERSION}"이어야 한다`);
  if (shard.bundle_id !== bundle.bundle_id) err('SCHEMA', 'bundle_id', `bundle_id는 "${bundle.bundle_id}"이어야 한다`);
  if (!Array.isArray(shard.candidate_links)) {
    err('SCHEMA', 'candidate_links', 'candidate_links는 배열이어야 한다');
    return { errors, warnings };
  }
  const units = new Map(bundle.units.map((u) => [u.unit_id, u]));
  const scopeInfo = new Map();
  for (const u of bundle.units) {
    const occs = occurrencesByUnit.get(u.unit_id) ?? [];
    scopeInfo.set(u.unit_id, {
      occs,
      titles: new Set(occs.map((o) => o.title_id)),
      scenes: new Set(occs.map((o) => o.scene_id)),
      occById: new Map(occs.map((o) => [o.occ_id, o])),
      defaults: [],
      taken: { title_ids: new Map(), scene_ids: new Map(), occ_ids: new Map() },
      links: [],
    });
  }
  const idRe = new RegExp(`^${bundle.bundle_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}__\\d{3}$`);
  const linkIds = new Set();
  const entityKeys = new Map(); // entity_key → { name, entity_type, qualifier, link_id }

  const checkEvidence = (ev, p) => {
    if (!ev || typeof ev !== 'object') return err('SCHEMA', p, '근거는 객체여야 한다');
    for (const k of Object.keys(ev)) {
      if (k === 'reveals_identity') err('FORBIDDEN_FIELD', `${p}.reveals_identity`, 'reveals_identity는 B 전용이다');
      else if (!['scene_id', 'line_start', 'line_end', 'quote'].includes(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    }
    if (!isNonEmptyString(ev.scene_id) || !ctx.store.has(ev.scene_id)) return err('EVIDENCE_SCENE', `${p}.scene_id`, `등록 장면이 아니다: ${ev.scene_id}`);
    const why = checkQuote(ctx.store.lines(ev.scene_id), ev.line_start, ev.line_end, ev.quote);
    if (why) err('QUOTE_LOCATION', `${p}.quote`, `${ev.scene_id}: ${why}`);
  };
  const checkEntityFields = (t, p, { allowRef, allowKey, linkType }) => {
    const allowed = ['entity_id', 'name', 'entity_type', 'qualifier', ...(allowRef ? ['ref'] : []), ...(allowKey ? ['entity_key'] : []), ...(allowRef ? [] : ['link_type', 'why', 'supporting_evidence'])];
    for (const k of Object.keys(t)) if (!allowed.includes(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    if (!A2_ENTITY_TYPES.has(t.entity_type)) err('ENUM', `${p}.entity_type`, `entity_type은 ${[...A2_ENTITY_TYPES].join(' | ')} 중 하나다`);
    if (t.qualifier !== undefined && t.qualifier !== null && !isNonEmptyString(t.qualifier)) err('SCHEMA', `${p}.qualifier`, 'qualifier는 비어 있지 않은 문자열이거나 쓰지 않는다');
    if (t.entity_id === null || t.entity_id === undefined) {
      if (!isNonEmptyString(t.name)) err('REFERENCE', `${p}.name`, 'entity_id가 null이면 name을 적는다');
      if (linkType === 'alias') err('ALIAS_TARGET', `${p}.entity_id`, '별칭(alias)의 대상은 등록 엔티티 ID다. 미등록 대상이면 new_entity로 적는다');
      return;
    }
    if (typeof t.entity_id !== 'string') return err('REFERENCE', `${p}.entity_id`, 'entity_id는 문자열 또는 null이다');
    const known = ctx.registry.has(t.entity_id) || ctx.pass2Entities.has(t.entity_id);
    if (!known) err('ENTITY_ID_NOT_IN_REGISTRY', `${p}.entity_id`, `${t.entity_id}는 레지스트리에 없다. entity 명령으로 찾거나 new_entity로 적는다`);
    if (linkType === 'new_entity') err('NEW_ENTITY_ID', `${p}.entity_id`, 'new_entity의 대상은 entity_id: null이다. ID는 병합기가 붙인다');
    if (linkType === 'alias' && ctx.registry.has(t.entity_id) && t.entity_type !== 'character') err('ALIAS_TARGET', `${p}.entity_type`, '레지스트리는 인물만 담는다. 등록 ID의 별칭이면 entity_type은 character다');
  };

  shard.candidate_links.forEach((link, i) => {
    const p = `candidate_links[${i}]`;
    if (!link || typeof link !== 'object') return err('SCHEMA', p, '연결은 객체여야 한다');
    for (const k of Object.keys(link)) {
      if (MERGER_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, `${k}는 병합기가 붙인다`);
      else if (OTHER_KIND_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, `${k}는 A-2에서 쓰지 않는다`);
      else if (!LINK_KEYS.has(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    }
    for (const k of LINK_KEYS) if (!(k in link)) err('SCHEMA', `${p}.${k}`, `필수 필드 ${k}가 없다`);
    if (!isNonEmptyString(link.link_id) || !idRe.test(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id는 "${bundle.bundle_id}__001" 형식이다`);
    else if (linkIds.has(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id 중복: ${link.link_id}`);
    else linkIds.add(link.link_id);

    const lt = link.link_type;
    if (!(lt in A2_LINK_TYPES)) err('ENUM', `${p}.link_type`, `link_type은 ${Object.keys(A2_LINK_TYPES).join(' | ')} 중 하나다`);
    else if (link.verdict !== A2_LINK_TYPES[lt]) err('VERDICT', `${p}.verdict`, `${lt}의 verdict는 "${A2_LINK_TYPES[lt]}"다`);
    if (link.confidence === '확인된 사실') err('FORBIDDEN_CONFIDENCE', `${p}.confidence`, 'Pass 2에서는 확인된 사실을 쓰지 않는다');
    else if (!CONFIDENCE_ENUM.has(link.confidence)) err('ENUM', `${p}.confidence`, `confidence는 ${[...CONFIDENCE_ENUM].join(' | ')} 중 하나다`);
    else if ((lt === 'unresolved') !== (link.confidence === '판단 보류')) err('VERDICT', `${p}.confidence`, 'unresolved(판단 보류)일 때만 confidence가 판단 보류다');

    // subject: 단위 하나
    let unitId = null;
    if (!Array.isArray(link.subject) || link.subject.length !== 1) err('SCHEMA', `${p}.subject`, 'subject는 [{"ref": "unit", "unit_id": ...}] 하나다');
    else {
      const r = link.subject[0];
      if (!r || r.ref !== 'unit' || !isNonEmptyString(r.unit_id) || Object.keys(r).some((k) => !['ref', 'unit_id'].includes(k))) err('REFERENCE', `${p}.subject[0]`, 'subject는 {"ref": "unit", "unit_id": "U001"}이다');
      else if (!units.has(r.unit_id)) err('SUBJECT_NOT_IN_BUNDLE', `${p}.subject[0]`, `묶음에 없는 단위: ${r.unit_id}`);
      else unitId = r.unit_id;
    }
    const info = unitId ? scopeInfo.get(unitId) : null;
    if (info) info.links.push(link);

    // scope
    const sc = link.scope;
    const evs = Array.isArray(link.supporting_evidence) ? link.supporting_evidence : [];
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) err('SCOPE', `${p}.scope`, 'scope는 {"default": true} 또는 {"title_ids": [...], "scene_ids": [...], "occ_ids": [...]}이다');
    else if (sc.default === true) {
      if (Object.keys(sc).length !== 1) err('SCOPE', `${p}.scope`, '기본 판정의 scope는 {"default": true}만 적는다');
      if (info) info.defaults.push(link.link_id ?? p);
    } else {
      for (const k of Object.keys(sc)) if (!SCOPE_KEYS.includes(k)) err('SCOPE', `${p}.scope.${k}`, `알 수 없는 필드 ${k}`);
      const lists = Object.fromEntries(SCOPE_KEYS.map((k) => [k, sc[k] ?? []]));
      if (SCOPE_KEYS.some((k) => !Array.isArray(lists[k])) || SCOPE_KEYS.every((k) => !lists[k]?.length)) err('SCOPE', `${p}.scope`, '예외 scope에는 title_ids·scene_ids·occ_ids 중 하나 이상을 적는다');
      else if (info) {
        const has = { title_ids: (t) => info.titles.has(t), scene_ids: (s) => info.scenes.has(s), occ_ids: (o) => info.occById.has(o) };
        const covers = {
          title_ids: (t) => evs.some((ev) => ev && ctx.store.meta(ev.scene_id)?.title_id === t),
          scene_ids: (s) => evs.some((ev) => ev?.scene_id === s),
          occ_ids: (o) => evs.some((ev) => evidenceTouches(ev, info.occById.get(o))),
        };
        const label = { title_ids: '이야기', scene_ids: '장면', occ_ids: '출현' };
        for (const k of SCOPE_KEYS) for (const v of lists[k]) {
          if (!has[k](v)) err('SCOPE', `${p}.scope.${k}`, `${v}: 이 표기가 나오지 않는 ${label[k]}다`);
          else if (info.taken[k].has(v)) err('SCOPE', `${p}.scope.${k}`, `${v}가 ${info.taken[k].get(v)}에도 있다. 한 ${label[k]}은 예외 하나에만 둔다`);
          else {
            info.taken[k].set(v, link.link_id ?? p);
            if (!covers[k](v)) err('EVIDENCE_OUT_OF_SCOPE', `${p}.scope.${k}`, `${v}: 예외로 적은 ${label[k]}마다 그 안의 원문 근거가 하나 이상 있어야 한다`);
          }
        }
      }
    }

    // target
    if (!Array.isArray(link.target)) err('SCHEMA', `${p}.target`, 'target은 배열이다');
    else {
      if ((lt === 'alias' || lt === 'new_entity') && link.target.length !== 1) err('TARGET', `${p}.target`, `${lt}의 target은 정확히 하나다`);
      if (lt === 'generic_term' && link.target.length) err('TARGET', `${p}.target`, 'generic_term은 target: []이다');
      if (lt === 'unresolved' && link.target.length > 1) err('TARGET', `${p}.target`, '판단 보류의 target은 비우거나 하나만 적는다. 나머지는 alternatives에 적는다');
      link.target.forEach((t, j) => {
        const tp = `${p}.target[${j}]`;
        if (!t || t.ref !== 'entity') return err('REFERENCE', tp, 'target은 {"ref": "entity", ...}이다');
        checkEntityFields(t, tp, { allowRef: true, allowKey: true, linkType: lt });
        const needsKey = t.entity_id == null && (lt === 'new_entity' || lt === 'unresolved');
        if (needsKey && lt === 'new_entity' && !ENTITY_KEY_RE.test(t.entity_key ?? '')) err('ENTITY_KEY', `${tp}.entity_key`, 'new_entity의 target에는 묶음 안에서 대상을 구별하는 entity_key("E1", "E2" …)를 적는다');
        if (t.entity_key !== undefined && !needsKey) err('ENTITY_KEY', `${tp}.entity_key`, 'entity_key는 미등록 대상(new_entity, 보류의 미등록 후보)에만 적는다');
        if (t.entity_key !== undefined && needsKey && ENTITY_KEY_RE.test(t.entity_key) && lt === 'new_entity') {
          const prev = entityKeys.get(t.entity_key);
          const sig = `${normName(t.name)}|${t.entity_type}|${normName(t.qualifier ?? '')}`;
          if (prev && prev.sig !== sig) err('ENTITY_KEY', `${tp}.entity_key`, `${t.entity_key}는 ${prev.link_id}에서 다른 이름·유형·qualifier로 쓰였다. 같은 대상이면 셋을 같게, 다른 대상이면 다른 entity_key를 쓴다`);
          if (!prev) entityKeys.set(t.entity_key, { sig, link_id: link.link_id ?? p });
        }
      });
      const t0 = link.target[0];
      if (lt === 'new_entity' && t0 && unitId && isNonEmptyString(t0.name)) {
        const reg = units.get(unitId).registry_match;
        if (reg && normName(t0.name) === normName(reg.canonical_name)) warn('NEW_ENTITY_SAME_AS_REGISTRY', `${p}.target[0]`, `등록 엔티티 ${reg.entity_id}와 이름이 같다. 같은 대상이면 alias, 다른 대상이면 qualifier로 구별하고 rationale에 다른 이유를 적는다`);
      }
    }

    // evidence
    if (!evs.length) err('EVIDENCE', `${p}.supporting_evidence`, 'supporting_evidence는 비울 수 없다(일반 낱말·보류도 판정에 쓴 원문 줄을 적는다)');
    evs.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
    if (!Array.isArray(link.contradicting_evidence)) err('SCHEMA', `${p}.contradicting_evidence`, 'contradicting_evidence는 배열이다(없으면 [])');
    else link.contradicting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.contradicting_evidence[${j}]`));
    if (!Array.isArray(link.alternatives)) err('SCHEMA', `${p}.alternatives`, 'alternatives는 배열이다(없으면 [])');
    else link.alternatives.forEach((a, j) => {
      const ap = `${p}.alternatives[${j}]`;
      if (!a || typeof a !== 'object') return err('SCHEMA', ap, '대안은 객체다');
      if (!['alias', 'new_entity', 'generic_term'].includes(a.link_type)) err('ENUM', `${ap}.link_type`, '대안의 link_type은 alias | new_entity | generic_term이다');
      if (a.link_type === 'generic_term') {
        for (const k of Object.keys(a)) if (!['link_type', 'why', 'supporting_evidence'].includes(k)) err('SCHEMA', `${ap}.${k}`, `generic_term 대안에는 ${k}를 적지 않는다`);
      } else checkEntityFields(a, ap, { allowRef: false, allowKey: false, linkType: a.link_type });
      if (!isNonEmptyString(a.why)) err('SCHEMA', `${ap}.why`, '대안마다 why를 적는다');
      if (!Array.isArray(a.supporting_evidence) || a.supporting_evidence.length === 0) err('EVIDENCE', `${ap}.supporting_evidence`, '대안의 원문 근거를 하나 이상 적는다');
      else a.supporting_evidence.forEach((ev, k) => checkEvidence(ev, `${ap}.supporting_evidence[${k}]`));
    });
    if (!Array.isArray(link.search_hints) || link.search_hints.some((h) => typeof h !== 'string')) err('SCHEMA', `${p}.search_hints`, 'search_hints는 문자열 배열이다(없으면 [])');
    if (!isNonEmptyString(link.rationale)) err('SCHEMA', `${p}.rationale`, 'rationale에 판정 이유를 적는다(예외를 나눴으면 나눈 이유도)');
  });

  for (const [uid, info] of scopeInfo) {
    const surface = units.get(uid).surface;
    if (info.defaults.length === 0) {
      err('UNIT_NOT_COVERED', uid, `단위 ${uid}(${surface})의 기본 판정({"default": true})이 없다`);
      continue;
    }
    if (info.defaults.length > 1) {
      err('SCOPE', uid, `단위 ${uid}의 기본 판정이 ${info.defaults.length}개다. 하나만 둔다`);
      continue;
    }
    // 기본 판정이 실제로 적용되는 출현에 근거가 있는가(예외에 덮인 근거는 세지 않는다)
    const resolved = resolveOccurrences(info.links, info.occs);
    const defApplied = resolved.filter((r) => r.applied_scope === 'default').map((r) => r.occurrence);
    const def = info.links.find((l) => l?.scope?.default === true);
    const defEvs = Array.isArray(def?.supporting_evidence) ? def.supporting_evidence : [];
    if (!defApplied.length) {
      warn('DEFAULT_NOT_APPLIED', uid, `단위 ${uid}(${surface})의 출현이 모두 예외에 들어 기본 판정이 적용되는 곳이 없다. 기본 판정을 가장 넓은 범위의 판정으로 바꾸는 것을 검토한다`);
    } else if (!defEvs.some((ev) => defApplied.some((o) => evidenceTouches(ev, o)))) {
      if (def.link_type === 'unresolved') warn('DEFAULT_EVIDENCE_NOT_APPLIED', `${uid}`, `단위 ${uid}(${surface})의 기본 판정(보류) 근거가 기본 판정이 적용되는 출현 줄에 없다`);
      else err('DEFAULT_EVIDENCE_NOT_APPLIED', `${uid}`, `단위 ${uid}(${surface})의 기본 판정 근거가 기본 판정이 적용되는 출현 줄(예외 밖, 출현 줄 앞뒤 2줄)에 없다. 그런 근거를 못 찾으면 기본 판정은 unresolved로 두고 확인한 범위만 예외로 적는다`);
    }
  }
  // 다른 entity_key인데 이름·유형·qualifier가 같으면 구별할 수 없다
  const bySig = new Map();
  for (const [key, v] of entityKeys) {
    if (!bySig.has(v.sig)) bySig.set(v.sig, []);
    bySig.get(v.sig).push(key);
  }
  for (const [sig, keys] of bySig) {
    if (keys.length > 1) err('ENTITY_KEY', keys.join(','), `${keys.join(', ')}는 이름·유형·qualifier가 같다(${sig}). 같은 대상이면 같은 entity_key를, 다른 대상이면 qualifier로 구별한다`);
  }
  return { errors, warnings };
};

// ---------------------------------------------------------------------------
// 병합(초안 12.4절)

const targetKey = (linkType, t, bundleId) => {
  if (linkType === 'generic_term') return 'generic_term';
  if (!t) return `${linkType}:-`;
  if (t.entity_id) return `${linkType}:${t.entity_id}`;
  if (linkType === 'new_entity' && bundleId && t.entity_key) return `new_entity:${bundleId}#${t.entity_key}`;
  return `${linkType}:${t.entity_type}|${normName(t.name)}|${normName(t.qualifier ?? '')}`;
};

const slugOf = (name) => nfkc(name).trim().replace(/\s+/g, '_');

/**
 * 새 엔티티 무리를 먼저 정한 뒤 ID를 한 번만 만든다. 무리는 (묶음, entity_key)다.
 * 다른 묶음에서 이름·유형이 같은 무리는 합치지 않고 merge_candidates로 남긴다(초안 12.4절).
 */
export const assignEntityIds = (groups) => {
  const byBase = new Map();
  for (const g of groups) {
    const prefix = ID_PREFIX[g.entity_type];
    if (!prefix) continue;
    g.base_id = `${prefix}${slugOf(g.canonical_name)}`;
    if (!byBase.has(g.base_id)) byBase.set(g.base_id, []);
    byBase.get(g.base_id).push(g);
  }
  for (const list of byBase.values()) {
    for (const g of list) g.entity_id = list.length === 1 ? g.base_id : `${g.base_id}__${sha256(g.group_key).slice(0, 6)}`;
  }
  const ids = groups.filter((g) => g.entity_id).map((g) => g.entity_id);
  if (new Set(ids).size !== ids.length) throw new Error('새 엔티티 ID가 겹친다');
  for (const g of groups) delete g.base_id;
  return groups;
};

/**
 * 결과: 항목별 해소(resolutions), ID를 준 새 엔티티(entities), ID 없는 표기 묶음(terms), 묶음을 넘는 병합 후보.
 * mainBundles: [{ bundle, shard, occurrences }]
 */
export const mergeA2 = ({ mainBundles, userDecisions = USER_DECISIONS }) => {
  const resolutions = [];
  const userChecks = [];
  const groups = new Map(); // group_key → group
  for (const { bundle, shard, occurrences } of mainBundles) {
    const occByUnit = new Map(occurrences.units.map((u) => [u.unit_id, u.occurrences]));
    const linksByUnit = new Map();
    for (const l of shard.candidate_links) {
      const uid = l.subject[0].unit_id;
      if (!linksByUnit.has(uid)) linksByUnit.set(uid, []);
      linksByUnit.get(uid).push(l);
    }
    for (const u of bundle.units) {
      const links = linksByUnit.get(u.unit_id) ?? [];
      const decision = userDecisions.get(u.surface);
      for (const { occurrence: o, link, applied_scope } of resolveOccurrences(links, occByUnit.get(u.unit_id) ?? [])) {
        const t = link.target[0] ?? null;
        const judged = { link_id: link.link_id, link_type: link.link_type, verdict: link.verdict, confidence: link.confidence, target: t, applied_scope };
        let final = { ...judged, decided_by: 'judge' };
        if (link.link_type === 'new_entity' && t) {
          const gk = `${bundle.bundle_id}#${t.entity_key}`;
          if (!groups.has(gk)) groups.set(gk, { group_key: gk, bundle_id: bundle.bundle_id, entity_key: t.entity_key, canonical_name: t.name, qualifier: t.qualifier ?? null, entity_type: t.entity_type, surfaces: new Set(), units: new Set(), title_ids: new Set(), item_count: 0 });
          judged.group_key = gk;
        }
        if (decision) {
          const agrees = targetKey(link.link_type, t) === targetKey(decision.link_type, decision.target);
          userChecks.push({ surface: u.surface, bundle_id: bundle.bundle_id, unit_id: u.unit_id, occ_id: o.occ_id, scene_id: o.scene_id, judge_link_id: link.link_id, judge_link_type: link.link_type, judge_target: t, judge_agrees: agrees });
          final = { link_id: null, link_type: decision.link_type, verdict: A2_LINK_TYPES[decision.link_type], confidence: '유력한 해석', target: decision.target, applied_scope: 'user', decided_by: 'user', note: decision.note, judge: judged };
        } else if (judged.group_key) final.group_key = judged.group_key;
        for (const itemId of o.item_ids) {
          resolutions.push({ item_id: itemId, surface: u.surface, scene_id: o.scene_id, title_id: o.title_id, bundle_id: bundle.bundle_id, unit_id: u.unit_id, occ_id: o.occ_id, shown: o.shown, ...final });
          if (final.group_key) {
            const g = groups.get(final.group_key);
            g.surfaces.add(u.surface);
            g.units.add(`${bundle.bundle_id}:${u.unit_id}`);
            g.title_ids.add(o.title_id);
            g.item_count += 1;
          }
        }
      }
    }
  }
  const used = [...groups.values()].filter((g) => g.item_count > 0);
  assignEntityIds(used);
  const byKey = new Map(used.map((g) => [g.group_key, g]));
  for (const r of resolutions) if (r.group_key && byKey.get(r.group_key).entity_id) r.assigned_entity_id = byKey.get(r.group_key).entity_id;
  const out = (g) => ({ ...g, surfaces: [...g.surfaces].sort(), units: [...g.units].sort(), title_ids: [...g.title_ids].sort() });
  const entities = used.filter((g) => g.entity_id).map(out).sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const terms = used.filter((g) => !g.entity_id).map(out).sort((a, b) => a.canonical_name.localeCompare(b.canonical_name) || a.group_key.localeCompare(b.group_key));
  // 묶음을 넘어 이름·유형이 같은 무리: 합치지 않고 후보로만 남긴다
  const bySig = new Map();
  for (const g of used) {
    const sig = `${g.entity_type}|${normName(g.canonical_name)}`;
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(g);
  }
  const mergeCandidates = [...bySig.entries()].filter(([, list]) => new Set(list.map((g) => g.bundle_id)).size > 1).map(([sig, list]) => ({ signature: sig, groups: list.map((g) => ({ group_key: g.group_key, entity_id: g.entity_id ?? null, qualifier: g.qualifier, surfaces: [...g.surfaces].sort() })) }));
  // 완료 조건: 모든 참조 ID가 표에 있다
  const ids = new Set(entities.map((e) => e.entity_id));
  const dangling = resolutions.filter((r) => r.assigned_entity_id && !ids.has(r.assigned_entity_id)).length;
  if (dangling) throw new Error(`표에 없는 ID를 가리키는 항목 ${dangling}건`);
  return { resolutions, entities, terms, userChecks, mergeCandidates };
};

// ---------------------------------------------------------------------------
// 제시·미제시 출현의 판정 불일치(초안 12.5절). 원인(표본·판정자 차이·추가 문맥)은 원문 검토로 따로 가른다

export const compareSampling = ({ main, check }) => {
  // main/check: { surface, links, occurrences, bundle_id }
  const key = (link, bundleId) => (link ? targetKey(link.link_type, link.target[0], bundleId) : 'none');
  const mainRes = new Map(resolveOccurrences(main.links, main.occurrences).map((x) => [x.occurrence.item_ids.join(','), x]));
  const rows = [];
  for (const c of resolveOccurrences(check.links, check.occurrences)) {
    const m = mainRes.get(c.occurrence.item_ids.join(','));
    if (!m) continue;
    // 새 엔티티는 묶음이 달라 entity_key를 비교할 수 없으므로 이름·유형·qualifier로 맞댄다
    const a = key(m.link);
    const b = key(c.link);
    rows.push({
      occ_id: c.occurrence.occ_id,
      scene_id: c.occurrence.scene_id,
      title_id: c.occurrence.title_id,
      shown_in_main: m.occurrence.shown,
      main: a,
      check: b,
      main_scope: m.applied_scope,
      check_scope: c.applied_scope,
      main_confidence: m.link?.confidence ?? null,
      check_confidence: c.link?.confidence ?? null,
      agree: a === b,
    });
  }
  const defMain = main.links.find((l) => l.scope?.default);
  const defCheck = check.links.find((l) => l.scope?.default);
  const count = (f) => rows.filter(f).length;
  return {
    surface: main.surface,
    occurrences: rows.length,
    agree: count((r) => r.agree),
    agree_confidence_differs: count((r) => r.agree && r.main_confidence !== r.check_confidence),
    differ_shown: count((r) => !r.agree && r.shown_in_main),
    differ_not_shown: count((r) => !r.agree && !r.shown_in_main),
    default_main: defMain ? `${key(defMain)}/${defMain.confidence}` : null,
    default_check: defCheck ? `${key(defCheck)}/${defCheck.confidence}` : null,
    exceptions_main: main.links.filter((l) => !l.scope?.default).length,
    exceptions_check: check.links.filter((l) => !l.scope?.default).length,
    differing: rows.filter((r) => !r.agree),
  };
};

// ---------------------------------------------------------------------------
// A-2 뒤 B 갱신 미리 보기(초안 8절 5번, 9절 7번). B 결과는 고치지 않는다

export const previewBUpdate = ({ bLinks, entities, resolutions, store }) => {
  const entityById = new Map(entities.map((e) => [e.entity_id, e]));
  const out = [];
  for (const link of bLinks) {
    (link.target ?? []).forEach((t, j) => {
      if (t.entity_id != null || !isNonEmptyString(t.name)) return;
      const reveals = (link.supporting_evidence ?? []).filter((e) => e.reveals_identity === true);
      const basis = reveals.length ? reveals : (link.supporting_evidence ?? []);
      const evidenceScenes = new Set(basis.map((e) => e.scene_id));
      const evidenceTitles = new Set(basis.map((e) => store.meta(e.scene_id)?.title_id).filter(Boolean));
      const base = { link_id: link.link_id, target_index: j, name: t.name, entity_type: t.entity_type, evidence_scenes: [...evidenceScenes].sort(), evidence_titles: [...evidenceTitles].sort() };
      const ua = USER_DECISIONS.get(t.name);
      if (ua) {
        out.push({ ...base, result: 'fill', entity_id: ua.target.entity_id, basis: ua.note });
        return;
      }
      // 같은 이름의 A-2 항목 중 근거 장면의 것을 먼저, 없으면 근거 이야기의 것을 본다
      const sameName = resolutions.filter((r) => normName(r.surface) === normName(t.name) || (r.target && normName(r.target.name) === normName(t.name)));
      const inScenes = sameName.filter((r) => evidenceScenes.has(r.scene_id));
      const pool = inScenes.length ? inScenes : sameName.filter((r) => evidenceTitles.has(r.title_id));
      const level = inScenes.length ? '근거 장면' : '근거 이야기';
      if (!pool.length) {
        out.push({ ...base, result: 'keep', basis: '근거 장면·이야기에 같은 이름의 A-2 항목이 없음' });
        return;
      }
      const outcomes = [...new Set(pool.map((r) => r.assigned_entity_id ?? (r.target?.entity_id ? `${r.link_type}:${r.target.entity_id}` : r.link_type)))];
      if (outcomes.length !== 1) {
        out.push({ ...base, result: 'rejudge', outcomes, basis: `${level}의 A-2 판정이 하나로 모이지 않음` });
        return;
      }
      const only = outcomes[0];
      const ent = entityById.get(only);
      if (ent && ent.entity_type === t.entity_type) out.push({ ...base, result: 'fill', entity_id: only, basis: `${level}의 같은 이름 A-2 항목 ${pool.length}건이 모두 이 새 엔티티` });
      else if (ent) out.push({ ...base, result: 'rejudge', outcomes, basis: `유형이 다름(B ${t.entity_type} / A-2 ${ent.entity_type})` });
      else if (only.startsWith('alias:')) out.push({ ...base, result: 'alias_candidate', entity_id: only.slice(6), basis: `${level}의 A-2 판정이 등록 인물의 별칭. 8절 기계 보충 조건(new_entity) 밖이라 사용자 확인 대상` });
      else out.push({ ...base, result: 'keep', outcomes, basis: `${level}의 A-2 판정이 ${only}` });
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 감사(초안 12.6절)

export const A2_REVIEW_PROBLEMS = new Set([
  'wrong_target', // alias·new_entity의 대상이 틀림
  'should_be_alias', // 등록 엔티티의 별칭인데 다르게 판정
  'should_be_new_entity',
  'should_be_generic',
  'should_not_be_generic', // 특정 대상을 가리키는데 일반 낱말로 둠
  'should_be_unresolved', // 근거가 모자라거나 섞였는데 단정함
  'wrong_entity_type',
  'scope_wrong', // 동명이인·다른 대상이 기본 판정에 섞였거나 예외 범위가 틀림
  'unseen_wrong', // 감사용으로 따로 뽑은 못 본 출현에 적용된 판정이 틀림
  'evidence_not_support',
  'confidence_too_high',
  'prior_knowledge_as_evidence',
  'other',
]);

/** occurrencesByBundle: bundle_id → (unit_id → 출현 전부) */
export const sampleA2Audit = ({ planBundles, bundles, shards, occurrencesByBundle = new Map(), rate = 0.1, seed = 'A2', includeIds = [], unseenProbes = AUDIT_UNSEEN_PROBES }) => {
  if (!(rate > 0 && rate <= 1)) throw new Error('audit rate는 0 초과 1 이하다');
  const strata = new Map();
  let total = 0;
  for (const b of planBundles) {
    const bundle = bundles.get(b.bundle_id);
    const links = shards.get(b.bundle_id).candidate_links;
    const occMap = occurrencesByBundle.get(b.bundle_id) ?? new Map();
    for (const u of bundle.units) {
      const unitLinks = links.filter((l) => l.subject[0].unit_id === u.unit_id);
      const def = unitLinks.find((l) => l.scope?.default);
      const parts = [def ? `${def.link_type}/${def.confidence}` : 'none', u.sampled ? 'sampled' : 'full', unitLinks.length > 1 ? 'exceptions' : 'single'];
      const stratum = parts.join('/');
      const audit_id = `${b.bundle_id}:${u.unit_id}`;
      // 골라 보여 준 단위: 판정자가 못 본 출현 몇 곳을 따로 뽑아, 거기 적용된 판정을 감사자가 확인한다
      let unseen = [];
      if (u.sampled) {
        const resolved = resolveOccurrences(unitLinks, occMap.get(u.unit_id) ?? []);
        unseen = resolved.filter((r) => !r.occurrence.shown)
          .sort((x, y) => hashRank(`${seed}|unseen`, `${audit_id}|${x.occurrence.occ_id}`).localeCompare(hashRank(`${seed}|unseen`, `${audit_id}|${y.occurrence.occ_id}`)))
          .slice(0, unseenProbes)
          .map((r) => ({ ...r.occurrence, applied_link_id: r.link?.link_id ?? null, applied_scope: r.applied_scope }));
      }
      const item = { audit_id, bundle_id: b.bundle_id, unit_id: u.unit_id, surface: u.surface, stratum, input_file: b.input, script_file: b.script, unit: u, links: unitLinks, unseen_probes: unseen };
      if (!strata.has(stratum)) strata.set(stratum, []);
      strata.get(stratum).push(item);
      total += 1;
    }
  }
  const rank = (x) => hashRank(seed, x.audit_id);
  const required = new Set(includeIds);
  const available = new Set([...strata.values()].flat().map((x) => x.audit_id));
  for (const id of required) if (!available.has(id)) throw new Error(`이전 감사 단위가 회차에서 사라졌다: ${id}`);
  const items = [];
  const counts = [];
  for (const [stratum, list] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const n = Math.ceil(list.length * rate);
    const chosen = [...new Set([...list.toSorted((a, b) => rank(a).localeCompare(rank(b))).slice(0, n), ...list.filter((x) => required.has(x.audit_id))])];
    items.push(...chosen);
    counts.push({ stratum, population: list.length, sampled: chosen.length });
  }
  return { population_units: total, sampled_units: items.length, rate, strata: counts, items };
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
const loadOccurrences = (bundle) => JSON.parse(fs.readFileSync(path.resolve(bundle.occurrences_file), 'utf8'));
const occMapOf = (occ) => new Map(occ.units.map((u) => [u.unit_id, u.occurrences]));
const loadShard = (P, bundleId) => {
  const p = path.join(P.shards, `${bundleId}.json`);
  if (!fs.existsSync(p)) return { missing: true };
  try {
    return { shard: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { parseError: e.message };
  }
};
const makeCtx = () => ({ store: new SceneStore(), registry: loadRegistry(), pass2Entities: loadPass2Entities() });
const validateOne = (P, bundleId, ctx) => {
  const bundle = loadBundle(P, bundleId);
  const occ = loadOccurrences(bundle);
  const s = loadShard(P, bundleId);
  if (s.missing) return { bundle, occ, status: 'missing', errors: [{ code: 'NO_OUTPUT', path: '$', message: '출력 파일이 없다' }], warnings: [] };
  if (s.parseError) return { bundle, occ, status: 'fail', errors: [{ code: 'JSON_PARSE', path: '$', message: s.parseError }], warnings: [] };
  const { errors, warnings } = validateA2Shard(s.shard, bundle, ctx, occMapOf(occ));
  return { bundle, occ, shard: s.shard, status: errors.length ? 'fail' : 'pass', errors, warnings };
};
const countBy = (list) => list.reduce((acc, x) => ((acc[x.code] = (acc[x.code] ?? 0) + 1), acc), {});
const stampPath = (P, bundleId) => path.join(P.stamps, `${bundleId}.json`);
const inputText = (bundle) => `${fs.readFileSync(path.resolve(bundle.script_file), 'utf8')}\n${fs.readFileSync(path.resolve(bundle.occurrences_file), 'utf8')}`;
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
/** 완료(검증 통과, 기록과 해시 일치)한 묶음만 */
const doneBundles = (P, plan, ctx, kind) => {
  const out = [];
  for (const b of plan.bundles.filter((x) => x.kind === kind)) {
    const r = validateOne(P, b.bundle_id, ctx);
    if (r.status !== 'pass' || staleReasonOf(P, b.bundle_id, r.bundle)) continue;
    out.push({ plan: b, bundle: r.bundle, shard: r.shard, occurrences: r.occ });
  }
  return out;
};

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const run = argValue(args, 'run') ?? 'pilot';
  if (!RUNS.has(run)) throw new Error(`--run은 ${[...RUNS].join(' | ')} 중 하나다`);
  const P = pathsOf(run);

  if (cmd === 'build') {
    const pilot = args.includes('--pilot') || (run === 'pilot' && !args.includes('--all'));
    if (!pilot && !args.includes('--all')) throw new Error('main 실행은 --all을 지정한다');
    const plan = await buildA2({
      run,
      pilot,
      maxUnits: Number(argValue(args, 'max-units') ?? 40),
      maxChars: Number(argValue(args, 'max-chars') ?? 30000),
      waveSize: Number(argValue(args, 'wave-size') ?? 20),
    });
    for (const b of plan.bundles) {
      console.log(`${b.bundle_id} [${b.kind}] 회차 ${b.wave}: 단위 ${b.units}(골라 보여 준 단위 ${b.sampled_units}), 발췌 ${b.excerpt_chars.toLocaleString()}자`);
      console.log(`  표기: ${b.surfaces.join(', ')}`);
    }
    const pop = plan.population;
    console.log(`[build] 판정 항목 ${pop.items_judged}(같은 장면 참여자 표시 ${pop.items_participant_match}), 사용자 제외 ${pop.items_excluded}, 표기 ${pop.surfaces}개 중 계획 ${pop.surfaces_in_plan}개`);
    if (pop.missing_pilot_surfaces.length) console.log(`[build] 파일럿 표기 중 모집단에 없는 것: ${pop.missing_pilot_surfaces.join(', ')}`);
    console.log(`[build] 묶음 ${plan.bundles.length}개 → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'status') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    for (const b of selectWave(plan, argValue(args, 'wave') === null ? null : Number(argValue(args, 'wave')))) {
      const r = validateOne(P, b.bundle_id, ctx);
      const stale = r.status === 'pass' ? staleReasonOf(P, b.bundle_id, r.bundle) : null;
      const st = r.status === 'missing' ? '[new]' : r.status === 'pass' && !stale ? '[done]' : '[rerun]';
      console.log(`${st} ${b.bundle_id} [${b.kind}] (단위 ${b.units})${stale ? ` — ${stale}` : ''}`);
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
      const passStatus = b.kind === 'A2' ? 'merged' : 'done_check_only';
      progress[b.bundle_id] = { kind: b.kind, status: stale ? 'stale' : r.status === 'pass' ? passStatus : r.status, stale_reason: stale, validations: attempts.length, first_validation_failed: attempts.length ? attempts[0].status !== 'pass' : null, errors: countBy(r.errors), warnings: countBy(r.warnings) };
      console.log(`${b.bundle_id} [${b.kind}]: ${progress[b.bundle_id].status}${stale ? `(${stale})` : ''} (검증 ${attempts.length}회, 남은 오류 ${r.errors.length}, 경고 ${r.warnings.length})`);
    }
    const done = doneBundles(P, plan, ctx, 'A2');
    const m = mergeA2({ mainBundles: done });
    const missing = plan.bundles.filter((b) => b.kind === 'A2' && progress[b.bundle_id].status !== 'merged').map((b) => b.bundle_id);
    const stamp = { schema_version: PASS2_SCHEMA_VERSION, kind: 'A2', run, generated_at: new Date().toISOString() };
    await writeJsonAtomic(path.join(P.merged, 'A2_resolutions.json'), { ...stamp, missing_bundles: missing, resolutions: m.resolutions, user_decision_checks: m.userChecks });
    await writeJsonAtomic(path.join(P.merged, 'entities.json'), { ...stamp, note: '실행 결과 표. data/graph/pass2/entities.json(공식 표)로 옮기는 것은 사용자 확인 뒤 따로 한다', entities: m.entities, merge_candidates: m.mergeCandidates });
    await writeJsonAtomic(path.join(P.merged, 'terms.json'), { ...stamp, terms: m.terms });
    await writeJsonAtomic(P.progress, { schema_version: PASS2_SCHEMA_VERSION, run, updated_at: new Date().toISOString(), bundles: progress });
    const byType = m.resolutions.reduce((acc, r) => ((acc[r.link_type] = (acc[r.link_type] ?? 0) + 1), acc), {});
    const byDecider = m.resolutions.reduce((acc, r) => ((acc[r.decided_by] = (acc[r.decided_by] ?? 0) + 1), acc), {});
    const byScope = m.resolutions.reduce((acc, r) => { const k = `${r.applied_scope}/${r.shown ? 'shown' : 'not_shown'}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
    console.log(`[finish] 병합 ${done.length}/${plan.bundles.filter((b) => b.kind === 'A2').length}묶음(누락 ${missing.length}), 항목 ${m.resolutions.length}건 ${JSON.stringify(byType)}`);
    console.log(`[finish] 결정 출처 ${JSON.stringify(byDecider)}, 적용 범위/제시 ${JSON.stringify(byScope)}`);
    console.log(`[finish] 새 엔티티 ${m.entities.length}개(여러 표기에서 모인 것 ${m.entities.filter((e) => e.surfaces.length > 1).length}), ID 없는 표기 묶음 ${m.terms.length}개, 묶음을 넘는 병합 후보 ${m.mergeCandidates.length}개(합치지 않음)`);
    const disagree = m.userChecks.filter((x) => !x.judge_agrees);
    if (m.userChecks.length) console.log(`[finish] 사용자 확인 표기: 출현 ${m.userChecks.length}곳, 판정자와 다른 곳 ${disagree.length}`);
    console.log(`[finish] → ${relPath(P.merged)}/`);
    return;
  }

  if (cmd === 'compare-check') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    const mains = doneBundles(P, plan, ctx, 'A2');
    const checks = doneBundles(P, plan, ctx, 'A2-check');
    const pending = plan.bundles.filter((b) => b.kind === 'A2-check').length - checks.length;
    const results = [];
    for (const c of checks) {
      const cu = c.bundle.units[0];
      const found = mains.map((m) => ({ m, u: m.bundle.units.find((u) => u.surface === cu.surface) })).find((x) => x.u);
      if (!found) {
        results.push({ surface: cu.surface, error: '같은 표기의 본 판정 묶음이 완료되지 않았다' });
        continue;
      }
      const occOf = (x, unitId) => occMapOf(x.occurrences).get(unitId);
      const linksOf = (shard, unitId) => shard.candidate_links.filter((l) => l.subject[0].unit_id === unitId);
      results.push(compareSampling({
        main: { surface: cu.surface, links: linksOf(found.m.shard, found.u.unit_id), occurrences: occOf(found.m, found.u.unit_id) },
        check: { surface: cu.surface, links: linksOf(c.shard, cu.unit_id), occurrences: occOf(c, cu.unit_id) },
      }));
    }
    await writeJsonAtomic(path.join(P.merged, 'sampling_check.json'), { schema_version: PASS2_SCHEMA_VERSION, run, generated_at: new Date().toISOString(), pending_check_bundles: pending, results });
    for (const r of results) {
      if (r.error) console.log(`${r.surface}: ${r.error}`);
      else console.log(`${r.surface}: 출현 ${r.occurrences}곳 중 일치 ${r.agree}(확신도만 다름 ${r.agree_confidence_differs}), 불일치 ${r.differ_shown + r.differ_not_shown}(본 판정의 제시 출현 ${r.differ_shown} / 미제시 출현 ${r.differ_not_shown}) · 기본 ${r.default_main} ↔ ${r.default_check} · 예외 ${r.exceptions_main} ↔ ${r.exceptions_check}`);
    }
    if (pending) console.log(`[compare-check] 완료되지 않은 비교 묶음 ${pending}개`);
    console.log(`[compare-check] → ${relPath(path.join(P.merged, 'sampling_check.json'))}`);
    return;
  }

  if (cmd === 'b-update-preview') {
    const res = readJsonIfExists(path.join(P.merged, 'A2_resolutions.json'));
    const ent = readJsonIfExists(path.join(P.merged, 'entities.json'));
    const b = readJsonIfExists(B_MERGED_PATH);
    if (!res || !ent || !b) throw new Error('A-2 병합 결과(finish) 또는 B 병합 결과가 없다');
    const rows = previewBUpdate({ bLinks: b.links, entities: ent.entities, resolutions: res.resolutions, store: new SceneStore() });
    await writeJsonAtomic(path.join(P.merged, 'b_update_preview.json'), { schema_version: PASS2_SCHEMA_VERSION, run, generated_at: new Date().toISOString(), note: '미리 보기다. B 결과는 고치지 않았다', rows });
    const by = rows.reduce((acc, r) => ((acc[r.result] = (acc[r.result] ?? 0) + 1), acc), {});
    for (const r of rows.filter((x) => x.result !== 'keep')) console.log(`${r.result} ${r.link_id} "${r.name}" → ${r.entity_id ?? r.candidates?.join(', ')} (${r.basis})`);
    console.log(`[b-update-preview] B 미등록 대상 ${rows.length}건 ${JSON.stringify(by)} → ${relPath(path.join(P.merged, 'b_update_preview.json'))}`);
    return;
  }

  if (cmd === 'audit-input' || cmd === 'audit-check') {
    const wave = Number(argValue(args, 'wave'));
    const plan = loadPlan(P);
    const selected = selectWave(plan, wave).filter((b) => b.kind === 'A2');
    const ctx = makeCtx();
    const bundleStamps = [];
    const bundles = new Map();
    const shards = new Map();
    const occurrencesByBundle = new Map();
    for (const b of selected) {
      const r = validateOne(P, b.bundle_id, ctx);
      if (r.status !== 'pass') throw new Error(`${b.bundle_id}: 미완료 또는 검증 실패`);
      const stale = staleReasonOf(P, b.bundle_id, r.bundle);
      if (stale) throw new Error(`${b.bundle_id}: ${stale}`);
      bundleStamps.push({ bundle_id: b.bundle_id, ...currentStamp(P, b.bundle_id, r.bundle) });
      bundles.set(b.bundle_id, r.bundle);
      shards.set(b.bundle_id, r.shard);
      occurrencesByBundle.set(b.bundle_id, occMapOf(r.occ));
    }
    const inputPath = path.join(P.audit, `wave_${pad(wave)}_input.json`);
    const outputPath = path.join(P.audit, `wave_${pad(wave)}_output.json`);
    if (cmd === 'audit-input') {
      const judgeFamily = argValue(args, 'judge-family') ?? 'gemini';
      if (!['gemini', 'gpt', 'claude'].includes(judgeFamily)) throw new Error('judge-family는 gemini | gpt | claude 중 하나다');
      const previous = readJsonIfExists(inputPath);
      const sample = sampleA2Audit({ planBundles: selected, bundles, shards, occurrencesByBundle, rate: Number(argValue(args, 'rate') ?? 0.1), seed: `A2/${run}/${wave}`, includeIds: previous?.items.map((x) => x.audit_id) ?? [] });
      const input = { schema_version: 'pass2-audit-input-0.1.0', kind: 'A2', run, wave, judge_family: judgeFamily, bundle_stamps: bundleStamps, ...sample };
      input.source_sha256 = sha256(JSON.stringify(input));
      await writeJsonAtomic(inputPath, input);
      console.log(`[audit-input] 회차 ${wave}: ${sample.sampled_units}/${sample.population_units}단위 (${sample.strata.length}개 층, 각 층 최소 1개) → ${relPath(inputPath)}`);
      console.log(`[audit-input] 다른 모델의 감사 출력 → ${relPath(outputPath)}`);
    } else {
      const input = readJsonIfExists(inputPath);
      const out = readJsonIfExists(outputPath);
      if (!input || !out) throw new Error('감사 입력 또는 출력이 없다');
      const r = checkAudit(input, out, { store: ctx.store, bundleStamps, problems: A2_REVIEW_PROBLEMS });
      for (const e of r.errors) console.log(`  ERROR ${e}`);
      console.log(`${r.errors.length ? '[FAIL]' : '[PASS]'} 감사 ${r.reviewed}/${input.items.length}단위, 판정 ${JSON.stringify(r.judgments)}`);
      if (r.errors.length) process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'occ') {
    // 단위의 출현 전부(보여 주지 않은 출현 포함)의 위치와 줄. 검색 예산에 세지 않는다
    const [bundleId, unitId] = args.filter((a) => !a.startsWith('--'));
    if (!bundleId || !unitId) throw new Error('occ <bundle_id> <unit_id> [--title=<title_id>] [--offset=0] [--limit=50]');
    const bundle = loadBundle(P, bundleId);
    const occs = occMapOf(loadOccurrences(bundle)).get(unitId);
    if (!occs) throw new Error(`묶음에 없는 단위: ${unitId}`);
    const title = argValue(args, 'title');
    const list = title ? occs.filter((o) => o.title_id === title) : occs;
    const limit = Number(argValue(args, 'limit')) || 50;
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const shown = list.slice(offset, offset + limit);
    const store = new SceneStore();
    const surface = bundle.units.find((u) => u.unit_id === unitId)?.surface ?? '';
    console.log(`${bundleId} ${unitId} 「${surface}」 출현 ${list.length}곳${title ? `(${title})` : ''}${offset + shown.length < list.length ? `, 이어 보기: --offset=${offset + shown.length}` : ''}`);
    for (const o of shown) {
      const lines = store.lines(o.scene_id) ?? [''];
      const text = isPositiveInt(o.line_start) ? lines.slice(o.line_start, Math.min(o.line_end, o.line_start + 1) + 1).join(' / ') : `(작성자 항목) ${lines[1] ?? ''}`;
      console.log(`${o.occ_id} ${o.shown ? '[제시]' : '[미제시]'} ${o.scene_id} ${o.line_start ? lineTag(o.line_start) : '-'} (${o.title_id}) ${text.slice(0, 160)}`);
    }
    return;
  }

  if (cmd === 'show') {
    const [sceneId, from, to] = args.filter((a) => !a.startsWith('--'));
    const store = new SceneStore();
    const lines = store.lines(sceneId);
    if (!lines) throw new Error(`등록 장면이 아니다: ${sceneId}`);
    const a = Math.max(1, Number(from) || 1);
    const b = Math.min(lines.length - 1, Number(to) || lines.length - 1);
    const meta = store.meta(sceneId);
    console.log(`@@@ ${sceneId} | ${meta.title_id} | ${meta.sub_title ?? ''} | ${lines.length - 1}줄`);
    for (let i = a; i <= b; i++) console.log(`[${lineTag(i)}] ${lines[i]}`);
    return;
  }

  if (cmd === 'grep') {
    const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    const title = argValue(args, 'title');
    if (term.length < 1 || (term.length < 2 && !title)) throw new Error('검색어는 2글자 이상이다. 한 글자 검색어는 --title=<title_id>로 이야기를 정할 때만 쓴다');
    const bundle = argValue(args, 'bundle');
    const unit = argValue(args, 'unit');
    if (!bundle || !unit) throw new Error('grep <낱말> --bundle=<bundle_id> --unit=<unit_id> [--title=<title_id>]');
    const limit = Number(argValue(args, 'limit')) || 30;
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const store = new SceneStore();
    if (title && !store.titleIndex.has(title)) throw new Error(`등록 이야기가 아니다: ${title}`);
    const scoped = title ? { allSceneIds: () => store.titles[store.titleIndex.get(title)].scene_ids.filter((id) => store.has(id)), lines: (id) => store.lines(id) } : store;
    const r = scanTerms(scoped, [term]).get(term);
    const shown = r.hits.slice(offset, offset + limit);
    const end = offset + shown.length;
    const range = offset > 0 || end < r.hits.length ? ` (${shown.length ? `${offset + 1}~${end}번째 줄 표시` : '표시할 줄 없음'}${end < r.hits.length ? `, 이어 보기: --offset=${end}` : ''})` : '';
    console.log(`"${term}": 장면 ${r.scene_count}개, ${r.hits.length}줄${range}`);
    for (const h of shown) console.log(`${h.scene_id} [${lineTag(h.line)}] (${store.meta(h.scene_id).title_id}) ${store.lines(h.scene_id)[h.line]}`);
    await fsp.mkdir(P.root, { recursive: true });
    await fsp.appendFile(P.searchLog, `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundle, unit_id: unit, term, title: title ?? null, scenes: r.scene_count, lines: r.hits.length, limit, offset, shown: shown.length })}\n`);
    return;
  }

  if (cmd === 'entity') {
    const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!q) throw new Error('entity <이름>');
    const nq = nfkc(q);
    const hits = [...loadRegistry().values()].filter((e) => nfkc(e.canonical_name).includes(nq) || (e.surface_labels ?? []).some((l) => nfkc(l).includes(nq)));
    if (!hits.length) console.log(`"${q}": 레지스트리에 없다. 미등록 대상이면 new_entity(entity_id: null, name)로 적는다`);
    for (const e of hits.slice(0, 20)) console.log(`${e.entity_id}\t${e.canonical_name}\t별칭: ${(e.surface_labels ?? []).join(', ')}\t장면 ${e.scene_count}\t분류 ${(e.categories ?? []).join(', ')}`);
    return;
  }

  console.log('사용법: build [--pilot|--all] | status [--wave=N] | validate <bundle_id> | occ <bundle_id> <unit_id> [--title=] | show <scene_id> [시작 끝] | grep <낱말> --bundle= --unit= [--title=] [--limit= --offset=] | entity <이름> | finish | compare-check | b-update-preview | audit-input --wave=N [--rate=0.1] | audit-check --wave=N  [--run=pilot|main]');
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(`[pass2-a2] ${e.message}`);
    process.exitCode = 1;
  });
}
