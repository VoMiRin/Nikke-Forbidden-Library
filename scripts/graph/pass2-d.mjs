// Pass 2 D(여러 장면 관계 정리) 도구 (설계: docs/graphrag/GRAPH_RAG_PASS2_D_DESIGN.md, 2026-11-25 승인)
// - D-0: 관계 메모(relationship_and_lore_notes) 양 끝 표기를 장면 정보로 엔티티·표기 묶음에 붙인다(2.3절, 6단계)
// - 단위 = 무방향 쌍 {A, B}. 한 쌍은 한 묶음에만 들어간다(1쌍 = 1묶음, 2.5·2.10절). 회차 간 전파가 없다
// - 판정은 Gemini 판정자, 감사는 다른 계열(GPT). 이 파일은 묶음·검증·병합·감사 입력만 만든다
// - 8절 구현 조건: 묶음 base_increment(철회 기준), 장면 간 배타는 경로 도달성(재시작 간선 제외), 같은 연표 단위 anchor는
//   장면 순서, evidence_scenes에 반박 근거·anchor 포함
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, writeJsonAtomic } from './lib.mjs';
import { selectWave } from './pass2-b-plan.mjs';
import { checkAudit, computeStamp, staleReason } from './pass2-b.mjs';
import { A2_ENTITY_TYPES, nfkc, officialResolutions, variantKey } from './pass2-a2.mjs';
import { withUserAliases } from './pass2-c.mjs';
import { loadScopes, makeRetraction } from './increment-scope.mjs';
import {
  PASS2_BUNDLE_SCHEMA_VERSION,
  PASS2_SCHEMA_VERSION,
  SceneStore,
  checkQuote,
  isNonEmptyString,
  isPositiveInt,
  loadByTitle,
  loadPass2Entities,
  loadRegistry,
  loadReleaseDates,
  readJsonIfExists,
  relPath,
} from './pass2-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n, w = 3) => String(n).padStart(w, '0');
const lineTag = (n) => `L${pad(n, 4)}`;

// ---------------------------------------------------------------------------
// 상수·열거형(설계 2.7절 표)

export const MAX_UNITS = 25;
export const MAX_UNITS_SINGLE = 35; // 메모 1건 쌍만 담는 묶음
export const MAX_MEMOS = 70;
export const MAX_CHARS = 30000;
export const WAVE_SIZE = 20;
export const EXCERPT_RADIUS = 2;
export const MAX_EVIDENCE_LINES = 15;
export const PAIR_TERM_BUDGET = 3;
export const BUNDLE_TERM_BUDGET = 40;
export const SEARCH_BUDGET_TAG = '[검색 예산 소진]';
export const ADDRESS_TOP = 5;
export const PRIOR_CONTEXT_MAX = 5;
export const AUDIT_RATE_FACTOR = { all_excluded: 3, has_change: 2, multi_steady: 1.5, single_memo: 1 };

export const RELATION_TYPES = new Set(['affiliation', 'command_or_hierarchy', 'status_or_rank', 'kinship_or_creation', 'origin_or_transformation', 'identity_or_naming', 'affinity_or_trust', 'conflict_or_hostility', 'lore_or_management']);
export const EPISTEMIC = new Set(['established', 'claimed']);
export const CONTEXT_SCOPES = new Set(['canon', 'branch', 'roleplay_or_sim', 'dream_or_hypothetical']);
export const TEMPORAL_ANCHORS = new Set(['scene_present', 'past_before_scene']);
export const ANCHOR_KINDS = new Set(['timeline', 'script']);
export const PROGRESSIONS = new Set(['initial', 'continues', 'changes_from', 'contradicts', 'reinterprets', 'standalone']);
export const CHAINED = new Set(['continues', 'changes_from', 'contradicts', 'reinterprets']);
export const ORDER_BASES = new Set(['script', 'official_timeline', 'unknown', 'not_applicable']);
export const D_CONFIDENCE = new Set(['유력한 해석', '가능성', '판단 보류']);
export const EXCLUDE_REASONS = new Set(['일회성 행동', '관계 아님', '같은 쌍 다른 메모와 중복', '끝점 오추출']);
export const SIDES = new Set(['subject', 'target']);
export const MERGER_ONLY_FIELDS = ['evidence_scenes', 'timeline_info', 'release_dates', 'verdict'];
export const D_REVIEW_PROBLEMS = new Set([
  'wrong_entity', 'wrong_relation_type', 'direction_wrong', 'claim_as_established', 'declaration_as_established', 'wrong_claimant',
  'missed_change', 'false_change', 'order_basis_wrong', 'timeline_conflict_ignored', 'context_scope_wrong', 'should_be_relation',
  'should_exclude_memo', 'evidence_not_support', 'confidence_too_high', 'prior_knowledge_as_evidence', 'merge_suggestion_wrong', 'other',
]);
/** 끝 버튼이 이것이면 그 장면의 다음 경로는 재시작·기록 메뉴로 돌아가는 간선이다(8.3절). 한 번의 진행 경로에서 뺀다 */
export const RESTART_BUTTONS = new Set(['다시 기록하기', '다시 탐색하기', '메모리 목록으로']);
const NODE_TYPES = new Set([...A2_ENTITY_TYPES, 'faction_or_species']);
const COMMANDER_VK = variantKey('지휘관'); // 직책 다의어: 전역 대응(4단계)에서 뺀다

const RUNS = new Set(['pilot', 'retest', 'main']);
const RUN_DIRS = { pilot: 'd-pilot', retest: 'd-retest', main: 'd' };
const runRoot = (run) => path.join(GRAPH_DATA_DIR, 'pass2', RUN_DIRS[run]);
const RULES_PATH = path.resolve(GRAPH_DATA_DIR, '..', '..', 'docs', 'graphrag', 'GRAPH_RAG_PASS2_D_RULES.md');
const OFFICIAL_ENTITIES_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'entities.json');
const OFFICIAL_TERMS_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'terms.json');
const USER_MERGES_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'user_entity_merges.json');
const A2_RESOLUTIONS_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'a2', 'merged', 'A2_resolutions.json');
const B_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'merged', 'B_candidates_a2.json');
const C_CANDIDATES_PATH = path.join(GRAPH_DATA_DIR, 'pass2', 'c', 'merged', 'C_candidates.json');
const WORLD_HISTORY_PATH = path.join(GRAPH_DATA_DIR, 'world_history_order.csv');

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

// ---------------------------------------------------------------------------
// 연표(world_history_order.csv): 장면 → history_order

export const parseCsv = (text) => {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
};

/** scene_id → { history_order, unit } (연표 단위 = 타이틀 또는 파트). 장면 범위가 있으면 그 범위만 */
export const timelineOfScenes = (rows, store) => {
  const out = new Map();
  for (const r of rows) {
    const ho = Number(r.history_order);
    if (!Number.isFinite(ho) || !store.titleIndex.has(r.title_id)) continue;
    const ids = store.titles[store.titleIndex.get(r.title_id)].scene_ids;
    const a = r.scene_start ? ids.indexOf(r.scene_start) : 0;
    const b = r.scene_end ? ids.indexOf(r.scene_end) : ids.length - 1;
    if (a < 0 || b < 0) continue;
    for (let i = a; i <= b; i++) out.set(ids[i], { history_order: ho, unit: `${r.title_id}#${r.part || ''}`, snapshot: r.source_snapshot });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 선택 경로(8.2-3·8.3절): 경로 그래프가 있는 이야기만, 재시작 간선 제외, 도달성으로 배타 판정

export const routeGraphOf = (store) => {
  const titles = new Map(); // title_id → Map(scene → [targets])
  for (const sid of store.allSceneIds()) {
    const m = store.meta(sid);
    const routes = m.mgt?.route?.next_routes ?? [];
    if (!routes.length) continue;
    if (!titles.has(m.title_id)) titles.set(m.title_id, new Map());
    titles.get(m.title_id).set(sid, routes);
  }
  const graph = new Map();
  for (const [tid, scenes] of titles) {
    const adj = new Map();
    for (const [sid, routes] of scenes) {
      const lines = store.lines(sid) ?? [];
      const button = [...lines].reverse().find((l) => /NEXT_SUBCHAPTER_BUTTON/.test(l ?? ''));
      const text = /TEXT="([^"]*)"/.exec(button ?? '')?.[1];
      adj.set(sid, RESTART_BUTTONS.has(text) ? [] : routes.map((r) => r.target));
    }
    graph.set(tid, adj);
  }
  const reach = new Map();
  const reachable = (tid, from) => {
    const k = `${tid}|${from}`;
    if (reach.has(k)) return reach.get(k);
    const adj = graph.get(tid);
    const seen = new Set();
    const stack = [...(adj.get(from) ?? [])];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(adj.get(x) ?? []));
    }
    reach.set(k, seen);
    return seen;
  };
  /** 두 장면이 한 번의 진행 경로에서 함께 나올 수 없는가(경로 그래프 있는 이야기 안에서만) */
  const scenesExclusive = (a, b) => {
    if (a === b) return false;
    const ta = store.meta(a)?.title_id;
    if (!ta || ta !== store.meta(b)?.title_id || !graph.has(ta)) return false;
    const adj = graph.get(ta);
    if (!adj.has(a) && !adj.has(b) && !isInGraph(adj, a) && !isInGraph(adj, b)) return false;
    return !reachable(ta, a).has(b) && !reachable(ta, b).has(a);
  };
  const isInGraph = (adj, sid) => [...adj.values()].some((t) => t.includes(sid));
  return { graph, scenesExclusive };
};

/** 두 메모가 서로 배타적인가: 같은 장면 같은 선택지의 다른 옵션, 또는 한 진행 경로에서 함께 나올 수 없는 장면 */
export const memosExclusive = (m1, m2, routes) => {
  if (m1.scene_id === m2.scene_id) {
    const a = m1.in_branch_option;
    const b = m2.in_branch_option;
    return Boolean(a && b && a.choice_line === b.choice_line && a.option_text !== b.option_text);
  }
  return routes.scenesExclusive(m1.scene_id, m2.scene_id);
};

// ---------------------------------------------------------------------------
// 공식 ID 정규화(4.0절 user_entity_merges: id_merges·kind_redirects 전역, scoped_aliases는 이야기 안에서만)

export const makeCanon = ({ registry, official, terms, userMerges }) => {
  const officialEntities = new Map((official?.entities ?? []).map((e) => [e.entity_id, e]));
  const termByKey = new Map((terms ?? []).map((t) => [t.term_key, t]));
  const groupMap = official?.group_map ?? {};
  const idMap = official?.id_map ?? {};
  const idMerges = new Map((userMerges?.id_merges ?? []).map((m) => [m.from, m.to]));
  const kind = new Map((userMerges?.kind_redirects ?? []).map((m) => [m.from, m.to]));
  const termNode = (key) => {
    const tk = groupMap[key]?.term_key ?? key;
    const t = termByKey.get(tk);
    return t ? { key: `term:${tk}`, ref: { ref: 'term', term_key: tk, name: t.canonical_name, entity_type: t.entity_type } } : null;
  };
  const entityNode = (id0) => {
    let id = idMap[id0] ?? id0;
    for (let i = 0; i < 5 && idMerges.has(id); i++) id = idMap[idMerges.get(id)] ?? idMerges.get(id);
    if (kind.has(id)) {
      const to = kind.get(id);
      return to.ref === 'term' ? termNode(to.term_key) : entityNode(to.entity_id);
    }
    const e = registry.get(id) ?? officialEntities.get(id);
    if (!e) return null;
    return { key: `entity:${id}`, ref: { ref: 'entity', entity_id: id, name: e.canonical_name, entity_type: e.entity_type ?? 'character' } };
  };
  /** 판정자가 적은 참조 → 노드 열쇠(없는 ID면 null) */
  const keyOfRef = (r) => {
    if (!r || typeof r !== 'object') return null;
    if (r.ref === 'entity') return entityNode(r.entity_id)?.key ?? null;
    if (r.ref === 'term') return termNode(r.term_key)?.key ?? null;
    if (r.ref === 'surface') return isNonEmptyString(r.name) ? `surface:${variantKey(r.name)}` : null;
    return null;
  };
  return { entityNode, termNode, keyOfRef };
};

// ---------------------------------------------------------------------------
// D-0: 관계 메모 끝 표기 → 노드(2.3절 6단계). 쌍 열쇠는 노드 열쇠 둘의 정렬

const surfaceNode = (prefix, name, vk) => ({ key: `${prefix}:${vk}`, ref: { ref: 'surface', name, entity_type: null } });

/**
 * inputs: { store, scenesByTitle: Map(title_id → [scene 객체]), canon, a2BySceneSurface, generics, bByScene, scopedAliases, globalDict }
 * 반환: { memos: [...], titleNodes }
 */
export const resolveMemos = (inputs) => {
  const { scenesByTitle, canon, a2BySceneSurface, genericBySceneSurface, bItems, scopedByTitle, globalDict, aliasVks } = inputs;
  const memos = [];
  for (const [titleId, scenes] of scenesByTitle) {
    // 장면마다 1~3단계 사전, 이야기 전체로 1~3단계에 나온 노드
    const local = new Map(); // scene_id → Map(vk → { node, by })
    const titleNodes = new Set();
    const scoped = scopedByTitle.get(titleId) ?? new Map();
    for (const s of scenes) {
      const m = new Map();
      const put = (name, node, by) => {
        if (!name || !node) return;
        const vk = variantKey(name);
        if (!vk || m.has(vk)) return;
        m.set(vk, { node, by });
        titleNodes.add(node.key);
      };
      const p = s.participants ?? {};
      for (const x of p.present_in_scene ?? []) if (x.entity_id) put(x.speaker_label, canon.entityNode(x.entity_id), 'participants');
      for (const x of p.remote_or_voice_only ?? []) if (x.entity_id) put(x.speaker_label, canon.entityNode(x.entity_id), 'participants');
      for (const x of p.present_silent ?? []) if (x.entity_id) put(x.name, canon.entityNode(x.entity_id), 'participants');
      for (const x of p.mentioned_only ?? []) if (x.entity_id) put(x.surface_text, canon.entityNode(x.entity_id), 'participants');
      if (p.document_author?.entity_id) put(p.document_author.name, canon.entityNode(p.document_author.entity_id), 'participants');
      for (const u of [...(s.unknown_speakers ?? []), ...(s.descriptor_speakers ?? [])]) {
        const r = u.resolved_in_same_scene_to;
        if (r?.entity_id) put(r.surface_text, canon.entityNode(r.entity_id), 'same_scene_reveal');
      }
      for (const [vk, node] of a2BySceneSurface.get(s.scene_id) ?? []) if (!m.has(vk)) { m.set(vk, { node, by: 'a2' }); titleNodes.add(node.key); }
      for (const [vk, node] of scoped) if (!m.has(vk)) { m.set(vk, { node, by: 'scoped_alias' }); titleNodes.add(node.key); }
      local.set(s.scene_id, m);
    }
    for (const s of scenes) {
      const m = local.get(s.scene_id);
      const gen = genericBySceneSurface.get(s.scene_id) ?? new Set();
      const resolveSurface = (name, memo, side) => {
        const vk = variantKey(name);
        const hit = m.get(vk);
        if (hit) return { ...hit, ambiguous: [] };
        // 3단계: B 정체 후보(작성자·목소리·묘사형 화자·???)
        const b = bItems(s, name, memo, side);
        if (b) return { node: b.node, by: 'b_candidate', b_confidence: b.confidence, ambiguous: [] };
        const globalKeys = vk === COMMANDER_VK || aliasVks.has(vk) ? [] : [...(globalDict.get(vk) ?? [])];
        const unique = globalKeys.length === 1 ? globalKeys[0] : null;
        if (gen.has(vk)) return { node: surfaceNode('gen', name, vk), by: 'generic_term', ambiguous: unique ? [unique] : [] };
        if (unique && titleNodes.has(unique)) return { node: inputs.nodeOfKey(unique), by: 'title_unique', ambiguous: [] };
        return { node: surfaceNode(`unres:${titleId}`, name, vk), by: 'unresolved', ambiguous: globalKeys.slice(0, 3) };
      };
      for (const r of s.relationship_and_lore_notes ?? []) {
        const a = resolveSurface(r.subject, r, 'subject');
        const b = resolveSurface(r.target, r, 'target');
        memos.push({
          item_id: r.item_id,
          scene_id: s.scene_id,
          title_id: titleId,
          subject: r.subject,
          target: r.target,
          subject_node: a.node.key,
          target_node: b.node.key,
          subject_ref: a.node.ref,
          target_ref: b.node.ref,
          subject_resolved_by: a.by,
          target_resolved_by: b.by,
          ...(a.b_confidence || b.b_confidence ? { b_confidence: { subject: a.b_confidence ?? null, target: b.b_confidence ?? null } } : {}),
          ambiguous_candidates: { subject: a.ambiguous, target: b.ambiguous },
          relation_or_change: r.relation_or_change,
          epistemic_type: r.epistemic_type,
          claimant: r.claimant ?? null,
          claim_line: r.claim_line ?? null,
          line_start: r.line_start,
          line_end: r.line_end,
          refers_to_past: Boolean(r.refers_to_past),
          chronology_type: r.chronology_type ?? 'present',
          in_branch_option: r.in_branch_option ?? null,
        });
      }
    }
  }
  return memos;
};

export const pairKeyOf = (a, b) => [a, b].sort(cmpStr).join(' || ');

/** 입력 파일을 모두 읽어 D-0 재료를 만든다 */
export const loadDInputs = () => {
  const store = new SceneStore();
  const byTitle = loadByTitle();
  const official = readJsonIfExists(OFFICIAL_ENTITIES_PATH) ?? {};
  const terms = readJsonIfExists(OFFICIAL_TERMS_PATH)?.terms ?? [];
  const userMerges = readJsonIfExists(USER_MERGES_PATH) ?? {};
  const a2 = readJsonIfExists(A2_RESOLUTIONS_PATH)?.resolutions ?? [];
  const registry = withUserAliases(loadRegistry(), a2);
  const canon = makeCanon({ registry, official, terms, userMerges });
  const nodeOfKey = (key) => {
    if (key.startsWith('entity:')) return canon.entityNode(key.slice(7));
    if (key.startsWith('term:')) return canon.termNode(key.slice(5));
    return null;
  };
  // 같은 장면 A-2 판정
  const a2BySceneSurface = new Map();
  const genericBySceneSurface = new Map();
  for (const r of officialResolutions(a2, official)) {
    const vk = variantKey(r.surface);
    if (!vk) continue;
    if (r.link_type === 'generic_term') {
      if (!genericBySceneSurface.has(r.scene_id)) genericBySceneSurface.set(r.scene_id, new Set());
      genericBySceneSurface.get(r.scene_id).add(vk);
      continue;
    }
    let node = null;
    const gm = r.group_key ? official.group_map?.[r.group_key] : null;
    if (gm?.entity_id) node = canon.entityNode(gm.entity_id);
    else if (gm?.term_key) node = canon.termNode(gm.term_key);
    else if (r.assigned_entity_id) node = canon.entityNode(r.assigned_entity_id);
    else if (r.target?.ref === 'entity' && r.target.entity_id) node = canon.entityNode(r.target.entity_id);
    if (!node) continue;
    if (!a2BySceneSurface.has(r.scene_id)) a2BySceneSurface.set(r.scene_id, new Map());
    const m = a2BySceneSurface.get(r.scene_id);
    if (!m.has(vk)) m.set(vk, node);
  }
  // 이야기별 표기 별칭
  const scopedByTitle = new Map();
  const aliasVks = new Set();
  for (const a of userMerges.scoped_aliases ?? []) {
    const node = a.to.ref === 'term' ? canon.termNode(a.to.term_key) : canon.entityNode(a.to.entity_id);
    if (!node) throw new Error(`user_entity_merges: 별칭 대상이 없다 ${a.surface}`);
    aliasVks.add(variantKey(a.surface));
    for (const t of a.title_ids) {
      if (!scopedByTitle.has(t)) scopedByTitle.set(t, new Map());
      scopedByTitle.get(t).set(variantKey(a.surface), node);
    }
  }
  // 전역 사전(4단계): 레지스트리·공식 엔티티·표기 묶음의 이름. 이야기별 별칭은 넣지 않는다
  const globalDict = new Map();
  const addG = (name, key) => {
    const vk = variantKey(name);
    if (!vk || !key) return;
    if (!globalDict.has(vk)) globalDict.set(vk, new Set());
    globalDict.get(vk).add(key);
  };
  for (const e of registry.values()) for (const n of [e.canonical_name, ...(e.surface_labels ?? [])]) addG(n, canon.entityNode(e.entity_id)?.key);
  for (const e of official.entities ?? []) for (const n of [e.canonical_name, ...(e.surface_labels ?? [])]) addG(n, canon.entityNode(e.entity_id)?.key);
  for (const t of terms) for (const n of [t.canonical_name, ...(t.surfaces ?? [])]) addG(n, canon.termNode(t.term_key)?.key);
  // B 정체 후보: item_id(+voice_index) → 1순위 대상
  const bLinks = readJsonIfExists(B_PATH)?.links ?? [];
  const bTarget = new Map();
  for (const l of bLinks) {
    if (l.verdict !== '정체 후보 있음') continue;
    const t = l.target?.[0];
    const node = t?.entity_id ? canon.entityNode(t.entity_id) : null;
    if (!node) continue;
    for (const s of l.subject ?? []) bTarget.set(`${s.item_id}#${s.voice_index ?? ''}#${s.unknown_id ?? ''}`, { node, confidence: l.confidence });
  }
  const bItems = (scene, name, memo, side) => {
    const vk = variantKey(name);
    const p = scene.participants ?? {};
    const da = p.document_author;
    if (da && vk === variantKey(da.name)) return bTarget.get(`${scene.scene_id}__dca_001##`) ?? null;
    const vi = (da?.voices ?? []).findIndex((v) => variantKey(v) === vk);
    if (vi >= 0) return bTarget.get(`${scene.scene_id}__dca_001#${vi}#`) ?? null;
    const di = (scene.descriptor_speakers ?? []).findIndex((d) => variantKey(d.speaker_label) === vk);
    if (di >= 0) return bTarget.get(`${scene.scene_id}__dsp_${pad(di + 1)}##`) ?? null;
    if (name === '???') {
      const want = side === 'subject' && memo.claimant_unknown_id ? [memo.claimant_unknown_id] : null;
      const unk = (scene.unknown_speakers ?? []).map((u, i) => ({ u, i })).filter(({ u }) => {
        if (want) return want.includes(u.unknown_id);
        const L = Number(/_L(\d+)$/.exec(u.unknown_id)?.[1]);
        return L >= memo.line_start && L <= memo.line_end;
      });
      const hits = [...new Set(unk.map(({ u, i }) => bTarget.get(`${scene.scene_id}__unk_${pad(i + 1)}##${u.unknown_id}`)).filter(Boolean))];
      const keys = new Set(hits.map((h) => h.node.key));
      return keys.size === 1 ? hits[0] : null;
    }
    return null;
  };
  const scenesByTitle = new Map();
  for (const [tid, doc] of byTitle) scenesByTitle.set(tid, (doc.scenes ?? []).filter((s) => store.has(s.scene_id)));
  const timeline = timelineOfScenes(parseCsv(fs.readFileSync(WORLD_HISTORY_PATH, 'utf8')), store);
  return { store, byTitle, official, terms, userMerges, registry, canon, nodeOfKey, a2BySceneSurface, genericBySceneSurface, scopedByTitle, aliasVks, globalDict, bLinks, bItems, scenesByTitle, timeline };
};

// ---------------------------------------------------------------------------
// 쌍·발췌·패킹(2.5절)

/** 같은 장면 메모 범위를 ±반경으로 넓혀 겹치면 합친다 */
export const mergeRanges = (ranges, radius, maxLine) => {
  const xs = ranges.map(([a, b]) => [Math.max(1, a - radius), Math.min(maxLine, b + radius)]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const r of xs) {
    const last = out.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
};

export const excerptOfUnit = (unit, memos, store) => {
  const byScene = new Map();
  for (const m of memos) {
    if (!byScene.has(m.scene_id)) byScene.set(m.scene_id, []);
    byScene.get(m.scene_id).push(m);
  }
  const scenes = [...byScene.keys()].sort((a, b) => store.sceneOrder.get(a) - store.sceneOrder.get(b));
  const parts = [`## ${unit.unit_id} ${unit.node_a.ref.name} ↔ ${unit.node_b.ref.name} (메모 ${memos.length})`];
  for (const sid of scenes) {
    const lines = store.lines(sid);
    const meta = store.meta(sid);
    parts.push(`@@@ ${sid} | ${meta.title_id} | ${meta.sub_title ?? ''}`);
    const ms = byScene.get(sid);
    for (const [a, b] of mergeRanges(ms.map((m) => [m.line_start, m.line_end]), EXCERPT_RADIUS, lines.length - 1)) {
      for (let i = a; i <= b; i++) parts.push(`[${lineTag(i)}] ${lines[i]}`);
      parts.push('...');
    }
  }
  return parts.join('\n');
};

/**
 * 쌍 → 묶음. 큰 쌍은 단독, 메모 1건 쌍은 따로 모은다. 주 등장 이야기 순(첫 메모 장면 순서)으로 채운다.
 * units: [{ pair_key, memo_count, chars, order }]
 */
export const packUnits = (units, { maxUnits = MAX_UNITS, maxUnitsSingle = MAX_UNITS_SINGLE, maxMemos = MAX_MEMOS, maxChars = MAX_CHARS } = {}) => {
  const sorted = [...units].sort((a, b) => a.order - b.order || cmpStr(a.pair_key, b.pair_key));
  const bundles = [];
  const fill = (list, cap) => {
    let cur = null;
    for (const u of list) {
      const big = u.memo_count > maxMemos || u.chars > maxChars;
      if (big) { bundles.push({ units: [u], solo: true }); continue; }
      if (!cur || cur.units.length >= cap || cur.memos + u.memo_count > maxMemos || cur.chars + u.chars > maxChars) {
        cur = { units: [], memos: 0, chars: 0, solo: false };
        bundles.push(cur);
      }
      cur.units.push(u);
      cur.memos += u.memo_count;
      cur.chars += u.chars;
    }
  };
  fill(sorted.filter((u) => u.memo_count > 1), maxUnits);
  fill(sorted.filter((u) => u.memo_count === 1), maxUnitsSingle);
  return bundles;
};

// ---------------------------------------------------------------------------
// 검증기(4.2절 + 8절)

const refShapeError = (r) => {
  if (!r || typeof r !== 'object') return '참조는 객체다';
  if (r.ref === 'entity') return isNonEmptyString(r.entity_id) && isNonEmptyString(r.name) ? null : 'entity 참조는 entity_id·name을 적는다';
  if (r.ref === 'term') return isNonEmptyString(r.term_key) && isNonEmptyString(r.name) ? null : 'term 참조는 term_key·name을 적는다';
  if (r.ref === 'surface') return isNonEmptyString(r.name) ? null : 'surface 참조는 name을 적는다';
  return 'ref는 entity | term | surface다';
};

/**
 * shard: 판정자 출력, bundle: 묶음, ctx: { store, canon, timeline, routes, termCounts?: Map(unit_id → 고유 검색어 수) }
 * 반환 { errors, warnings }
 */
export const validateDShard = (shard, bundle, ctx) => {
  const errors = [];
  const warnings = [];
  const err = (code, p, message) => errors.push({ code, path: p, message });
  const warn = (code, p, message) => warnings.push({ code, path: p, message });
  if (!shard || typeof shard !== 'object') return { errors: [{ code: 'SCHEMA', path: '$', message: '출력은 객체다' }], warnings };
  for (const k of Object.keys(shard)) if (!['schema_version', 'bundle_id', 'endpoint_overrides', 'candidate_links', 'excluded_memos', 'merge_suggestions'].includes(k)) err('SCHEMA', k, `알 수 없는 필드 ${k}`);
  if (shard.schema_version !== PASS2_SCHEMA_VERSION) err('SCHEMA', 'schema_version', `schema_version은 ${PASS2_SCHEMA_VERSION}이다`);
  if (shard.bundle_id !== bundle.bundle_id) err('SCHEMA', 'bundle_id', `bundle_id는 ${bundle.bundle_id}다`);
  for (const k of ['endpoint_overrides', 'candidate_links', 'excluded_memos', 'merge_suggestions']) if (!Array.isArray(shard[k] ?? [])) err('SCHEMA', k, `${k}는 배열이다`);
  const links = Array.isArray(shard.candidate_links) ? shard.candidate_links : [];
  const excluded = Array.isArray(shard.excluded_memos) ? shard.excluded_memos : [];
  const overrides = Array.isArray(shard.endpoint_overrides) ? shard.endpoint_overrides : [];
  const units = new Map(bundle.units.map((u) => [u.unit_id, u]));
  const memoById = new Map(bundle.memos.map((m) => [m.item_id, m]));
  const { store, canon } = ctx;

  const checkEvidence = (ev, p) => {
    if (!ev || typeof ev !== 'object') return err('SCHEMA', p, '근거는 객체다');
    if (!store.has(ev.scene_id)) return err('QUOTE_LOCATION', p, `등록 장면이 아니다: ${ev.scene_id}`);
    if (!isPositiveInt(ev.line_start) || !isPositiveInt(ev.line_end) || ev.line_end < ev.line_start) return err('QUOTE_LOCATION', p, '줄 범위가 잘못됐다');
    if (ev.line_end - ev.line_start + 1 > MAX_EVIDENCE_LINES) err('EVIDENCE_TOO_WIDE', p, `인용 하나는 ${MAX_EVIDENCE_LINES}줄까지다`);
    const bad = checkQuote(store.lines(ev.scene_id), ev.line_start, ev.line_end, ev.quote);
    if (bad) err('QUOTE_LOCATION', p, bad);
  };
  const checkConfidence = (v, p) => {
    if (v === '확인된 사실') err('FORBIDDEN_CONFIDENCE', p, '확인된 사실은 쓰지 않는다');
    else if (!D_CONFIDENCE.has(v)) err('ENUM', p, 'confidence는 유력한 해석 | 가능성 | 판단 보류다');
  };
  const checkRef = (r, p) => {
    const e = refShapeError(r);
    if (e) return err('REFERENCE', p, e);
    if (r.ref !== 'surface' && !canon.keyOfRef(r)) err('REFERENCE', p, `레지스트리·공식 표에 없는 ${r.ref === 'entity' ? `ID ${r.entity_id}` : `term_key ${r.term_key}`}`);
    if (r.entity_type != null && !NODE_TYPES.has(r.entity_type)) err('ENUM', `${p}.entity_type`, 'entity_type이 허용 값이 아니다');
  };

  // 끝점 보정(메모 단위, G1)
  const effective = new Map(bundle.memos.map((m) => [m.item_id, { subject: m.subject_node, target: m.target_node }]));
  const seenSide = new Set();
  overrides.forEach((o, i) => {
    const p = `endpoint_overrides[${i}]`;
    if (!units.has(o?.unit_id)) return err('UNKNOWN_UNIT', `${p}.unit_id`, `묶음에 없는 단위 ${o?.unit_id}`);
    if (!SIDES.has(o.side)) err('ENUM', `${p}.side`, 'side는 subject | target이다(메모 원래 칸 기준)');
    if (!Array.isArray(o.memo_ids) || !o.memo_ids.length) return err('ENDPOINT_OVERRIDE_INVALID', `${p}.memo_ids`, 'memo_ids를 하나 이상 적는다');
    checkRef(o.from, `${p}.from`);
    checkRef(o.to, `${p}.to`);
    checkConfidence(o.confidence, `${p}.confidence`);
    if (!isNonEmptyString(o.rationale)) err('SCHEMA', `${p}.rationale`, 'rationale을 적는다');
    if (!Array.isArray(o.supporting_evidence) || !o.supporting_evidence.length) err('QUOTE_LOCATION', `${p}.supporting_evidence`, '원문 근거를 하나 이상 적는다');
    else o.supporting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
    const toKey = canon.keyOfRef(o.to);
    for (const id of o.memo_ids) {
      const m = memoById.get(id);
      if (!m || m.unit_id !== o.unit_id) { err('ENDPOINT_OVERRIDE_INVALID', `${p}.memo_ids`, `${id}는 단위 ${o.unit_id}의 메모가 아니다`); continue; }
      if (!SIDES.has(o.side)) continue;
      const orig = o.side === 'subject' ? m.subject_node : m.target_node;
      const fromKey = o.from?.ref === 'surface' ? (o.from.name && orig.endsWith(`:${variantKey(o.from.name)}`) ? orig : null) : canon.keyOfRef(o.from);
      if (fromKey !== orig) err('ENDPOINT_OVERRIDE_INVALID', `${p}.from`, `${id}의 ${o.side} 원래 끝점(${orig})과 다르다`);
      const k = `${id}#${o.side}`;
      if (seenSide.has(k)) err('ENDPOINT_OVERRIDE_INVALID', `${p}.memo_ids`, `${id} ${o.side}를 두 번 보정했다`);
      seenSide.add(k);
      if (toKey) effective.get(id)[o.side] = toKey;
    }
  });
  const effPair = (id) => {
    const e = effective.get(id);
    return pairKeyOf(e.subject, e.target);
  };
  // 같은 묶음 안 다른 단위와 쌍이 겹침(경고)
  const unitPair = new Map(bundle.units.map((u) => [u.unit_id, u.pair_key]));
  for (const [id] of effective) {
    const m = memoById.get(id);
    const pk = effPair(id);
    if (pk === unitPair.get(m.unit_id)) continue;
    const other = [...unitPair].find(([uid, k]) => k === pk && uid !== m.unit_id);
    if (other) warn('SAME_BUNDLE_PAIR_OVERLAP', id, `보정 뒤 쌍이 같은 묶음의 ${other[0]}와 같다. 두 단위 기록을 맞춘다`);
  }

  // 관계 기록
  const linkIds = new Set();
  const linkById = new Map();
  const idRe = new RegExp(`^${bundle.bundle_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}__(\\d{3})$`);
  const covered = new Map(); // memo → 'link' | 'excluded'
  links.forEach((l, i) => {
    const p = `candidate_links[${i}]`;
    if (!l || typeof l !== 'object') return err('SCHEMA', p, '객체여야 한다');
    for (const f of MERGER_ONLY_FIELDS) if (f in l) err('FORBIDDEN_FIELD', `${p}.${f}`, `${f}는 쓰지 않는다(병합기 전용 또는 미사용)`);
    if (!isNonEmptyString(l.link_id) || !idRe.test(l.link_id) || l.link_id.endsWith('__000')) err('SCHEMA', `${p}.link_id`, `link_id는 "${bundle.bundle_id}__001" 형식이다`);
    else if (linkIds.has(l.link_id)) err('SCHEMA', `${p}.link_id`, `link_id 중복: ${l.link_id}`);
    linkIds.add(l.link_id);
    linkById.set(l.link_id, { ...l, _i: i });
    if (!units.has(l.unit_id)) err('UNKNOWN_UNIT', `${p}.unit_id`, `묶음에 없는 단위 ${l.unit_id}`);
    if (l.link_type !== 'relation') err('SCHEMA', `${p}.link_type`, 'link_type은 relation이다');
    if (!Array.isArray(l.subject) || l.subject.length !== 1 || !Array.isArray(l.target) || l.target.length !== 1) err('SCHEMA', p, 'subject·target은 참조 하나짜리 배열이다');
    else { checkRef(l.subject[0], `${p}.subject[0]`); checkRef(l.target[0], `${p}.target[0]`); }
    if (typeof l.bidirectional !== 'boolean') err('SCHEMA', `${p}.bidirectional`, 'bidirectional은 true | false다');
    if (!RELATION_TYPES.has(l.relation_type)) err('ENUM', `${p}.relation_type`, `relation_type은 ${[...RELATION_TYPES].join(' | ')}다`);
    if (!EPISTEMIC.has(l.epistemic_status)) err('ENUM', `${p}.epistemic_status`, 'epistemic_status는 established | claimed다');
    if (!CONTEXT_SCOPES.has(l.context_scope)) err('ENUM', `${p}.context_scope`, `context_scope는 ${[...CONTEXT_SCOPES].join(' | ')}다`);
    if (!TEMPORAL_ANCHORS.has(l.temporal_anchor)) err('ENUM', `${p}.temporal_anchor`, 'temporal_anchor는 scene_present | past_before_scene이다');
    if (!PROGRESSIONS.has(l.progression)) err('ENUM', `${p}.progression`, `progression은 ${[...PROGRESSIONS].join(' | ')}다`);
    if (!ORDER_BASES.has(l.order_basis)) err('ENUM', `${p}.order_basis`, `order_basis는 ${[...ORDER_BASES].join(' | ')}다`);
    checkConfidence(l.confidence, `${p}.confidence`);
    const claimants = Array.isArray(l.claimants) ? l.claimants : null;
    if (!claimants) err('SCHEMA', `${p}.claimants`, 'claimants는 배열이다');
    else {
      claimants.forEach((c, j) => checkRef(c, `${p}.claimants[${j}]`));
      if (l.epistemic_status === 'claimed' && !claimants.length) err('CLAIMANT_REQUIRED', `${p}.claimants`, 'claimed는 말한 화자를 claimants에 적는다');
      if (l.epistemic_status === 'established' && claimants.length) err('CLAIMANT_REQUIRED', `${p}.claimants`, 'established는 claimants를 비운다');
    }
    if (!isNonEmptyString(l.rationale) || !l.rationale.includes('상태:') || !l.rationale.includes('선후·근거:')) err('RATIONALE_FORM', `${p}.rationale`, 'rationale은 "상태: … / 선후·근거: …" 형식이다');
    if (!Array.isArray(l.prev_link_ids)) err('SCHEMA', `${p}.prev_link_ids`, 'prev_link_ids는 배열이다');
    if (!Array.isArray(l.memo_ids) || !l.memo_ids.length) err('MEMO_NOT_COVERED', `${p}.memo_ids`, 'memo_ids를 하나 이상 적는다');
    for (const id of l.memo_ids ?? []) {
      const m = memoById.get(id);
      if (!m) { err('FOREIGN_MEMO', `${p}.memo_ids`, `묶음에 없는 메모 ${id}`); continue; }
      if (m.unit_id !== l.unit_id) err('FOREIGN_MEMO', `${p}.memo_ids`, `${id}는 단위 ${m.unit_id}의 메모다`);
      if (covered.get(id) === 'excluded') err('MEMO_CONFLICT', `${p}.memo_ids`, `${id}가 excluded_memos에도 있다`);
      covered.set(id, 'link');
    }
    for (const k of ['supporting_evidence', 'contradicting_evidence', 'search_hints']) if (!Array.isArray(l[k])) err('SCHEMA', `${p}.${k}`, `${k}는 배열이다`);
    const sup = Array.isArray(l.supporting_evidence) ? l.supporting_evidence : [];
    if (!sup.length) err('QUOTE_LOCATION', `${p}.supporting_evidence`, '원문 근거를 하나 이상 적는다');
    sup.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
    (Array.isArray(l.contradicting_evidence) ? l.contradicting_evidence : []).forEach((ev, j) => checkEvidence(ev, `${p}.contradicting_evidence[${j}]`));
    const memoScenes = new Set((l.memo_ids ?? []).map((id) => memoById.get(id)?.scene_id).filter(Boolean));
    if (sup.length && memoScenes.size && !sup.some((ev) => memoScenes.has(ev.scene_id))) err('MEMO_SCENE_EVIDENCE', `${p}.supporting_evidence`, '귀속 메모 장면의 원문 인용이 하나도 없다');
    // 끝점 = 귀속 메모의 유효 쌍(G1 ④)
    const pairs = new Set((l.memo_ids ?? []).filter((id) => memoById.get(id)).map(effPair));
    if (pairs.size > 1) err('ENDPOINT_MISMATCH', `${p}.memo_ids`, '귀속 메모들의 (보정 뒤) 쌍이 서로 다르다');
    const sk = l.subject?.[0] ? canon.keyOfRef(l.subject[0]) : null;
    const tk = l.target?.[0] ? canon.keyOfRef(l.target[0]) : null;
    if (pairs.size === 1 && sk && tk) {
      const want = [...pairs][0];
      const surf = (k, side) => (k?.startsWith('surface:') ? [...new Set((l.memo_ids ?? []).map((id) => effective.get(id)?.[side]).filter(Boolean))].concat([...new Set((l.memo_ids ?? []).map((id) => effective.get(id)?.[side === 'subject' ? 'target' : 'subject']).filter(Boolean))]).find((x) => x.endsWith(k.slice(7))) ?? k : k);
      if (pairKeyOf(surf(sk, 'subject'), surf(tk, 'target')) !== want) err('ENDPOINT_MISMATCH', p, `subject·target이 귀속 메모의 (보정 뒤) 쌍(${want})과 다르다`);
    }
    // 배타 메모 섞기(G2 ①)
    const ms = (l.memo_ids ?? []).map((id) => memoById.get(id)).filter(Boolean);
    for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) if (memosExclusive(ms[a], ms[b], ctx.routes)) err('EXCLUSIVE_BRANCH_CHAINED', `${p}.memo_ids`, `서로 배타적인 갈래의 메모 ${ms[a].item_id}·${ms[b].item_id}를 한 기록에 섞었다`);
    // anchor 형식
    if (l.anchor != null) {
      if (typeof l.anchor !== 'object' || !ANCHOR_KINDS.has(l.anchor.kind)) err('ENUM', `${p}.anchor.kind`, 'anchor.kind는 timeline | script다');
      else {
        if (!Array.isArray(l.anchor.evidence) || !l.anchor.evidence.length) err('ANCHOR_REQUIRED', `${p}.anchor.evidence`, 'anchor는 원문 인용을 하나 이상 적는다');
        else l.anchor.evidence.forEach((ev, j) => checkEvidence(ev, `${p}.anchor.evidence[${j}]`));
        if (l.anchor.kind === 'timeline' && !store.has(l.anchor.scene_id)) err('ANCHOR_REQUIRED', `${p}.anchor.scene_id`, 'timeline anchor는 등록 장면 scene_id를 적는다');
      }
    }
  });
  excluded.forEach((x, i) => {
    const p = `excluded_memos[${i}]`;
    if (!units.has(x?.unit_id)) return err('UNKNOWN_UNIT', `${p}.unit_id`, `묶음에 없는 단위 ${x?.unit_id}`);
    const m = memoById.get(x.item_id);
    if (!m) return err('FOREIGN_MEMO', `${p}.item_id`, `묶음에 없는 메모 ${x.item_id}`);
    if (m.unit_id !== x.unit_id) err('FOREIGN_MEMO', `${p}.item_id`, `${x.item_id}는 단위 ${m.unit_id}의 메모다`);
    if (covered.get(x.item_id)) err('MEMO_CONFLICT', `${p}.item_id`, `${x.item_id}가 이미 ${covered.get(x.item_id) === 'link' ? 'candidate_links' : 'excluded_memos'}에 있다`);
    covered.set(x.item_id, 'excluded');
    if (!EXCLUDE_REASONS.has(x.reason)) err('ENUM', `${p}.reason`, `reason은 ${[...EXCLUDE_REASONS].join(' | ')}다`);
    if (!isNonEmptyString(x.note)) err('SCHEMA', `${p}.note`, 'note를 적는다');
    (Array.isArray(x.supporting_evidence) ? x.supporting_evidence : []).forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
  });
  for (const u of bundle.units) {
    const missing = u.memo_ids.filter((id) => !covered.has(id));
    if (missing.length === u.memo_ids.length) err('UNIT_NOT_COVERED', u.unit_id, '이 단위를 candidate_links·excluded_memos 어디에도 적지 않았다');
    else if (missing.length) err('MEMO_NOT_COVERED', u.unit_id, `빠진 메모: ${missing.join(', ')}`);
  }

  // 사슬: prev_link_ids, 순환, 배타, 순서 근거, anchor
  const isPastish = (l) => l.temporal_anchor === 'past_before_scene' || (l.memo_ids ?? []).some((id) => memoById.get(id)?.refers_to_past || memoById.get(id)?.chronology_type === 'flashback');
  const speechScene = (l) => (l.memo_ids ?? []).map((id) => memoById.get(id)?.scene_id).filter(Boolean).sort((a, b) => store.sceneOrder.get(b) - store.sceneOrder.get(a))[0];
  const posOf = (l) => {
    if (isPastish(l)) return l.anchor?.kind === 'timeline' ? ctx.timeline.get(l.anchor.scene_id) ?? null : null;
    const hs = (l.memo_ids ?? []).map((id) => ctx.timeline.get(memoById.get(id)?.scene_id)).filter(Boolean);
    return hs.length ? hs.sort((a, b) => a.history_order - b.history_order)[0] : null;
  };
  const referencedBy = new Map();
  for (const l of links) for (const pid of Array.isArray(l?.prev_link_ids) ? l.prev_link_ids : []) {
    if (!referencedBy.has(pid)) referencedBy.set(pid, []);
    referencedBy.get(pid).push(l);
  }
  links.forEach((l, i) => {
    if (!l || typeof l !== 'object' || !Array.isArray(l.prev_link_ids)) return;
    const p = `candidate_links[${i}]`;
    if (CHAINED.has(l.progression) && !l.prev_link_ids.length) err('PROGRESSION_AND_PREV', `${p}.prev_link_ids`, `${l.progression}는 앞선 기록을 prev_link_ids에 적는다`);
    if (['initial', 'standalone'].includes(l.progression) && l.prev_link_ids.length) err('PROGRESSION_AND_PREV', `${p}.prev_link_ids`, `${l.progression}에는 prev_link_ids를 적지 않는다`);
    if (l.progression === 'changes_from' && !['script', 'official_timeline'].includes(l.order_basis)) err('ORDER_BASIS_INVALID', `${p}.order_basis`, 'changes_from은 script | official_timeline 근거로만 잇는다');
    for (const pid of l.prev_link_ids) {
      const prev = linkById.get(pid);
      if (!prev) { err('PROGRESSION_AND_PREV', `${p}.prev_link_ids`, `없는 기록 ${pid}`); continue; }
      if (prev.unit_id !== l.unit_id) err('PROGRESSION_AND_PREV', `${p}.prev_link_ids`, `${pid}는 다른 단위의 기록이다`);
      const pa = (prev.memo_ids ?? []).filter((id) => memoById.get(id)).map(effPair);
      const pb = (l.memo_ids ?? []).filter((id) => memoById.get(id)).map(effPair);
      if (pa.length && pb.length && pa[0] !== pb[0]) err('ENDPOINT_MISMATCH', `${p}.prev_link_ids`, `${pid}와 (보정 뒤) 쌍이 다르다`);
      const ma = (prev.memo_ids ?? []).map((id) => memoById.get(id)).filter(Boolean);
      const mb = (l.memo_ids ?? []).map((id) => memoById.get(id)).filter(Boolean);
      if (ma.some((x) => mb.some((y) => memosExclusive(x, y, ctx.routes)))) err('EXCLUSIVE_BRANCH_CHAINED', `${p}.prev_link_ids`, `${pid}와 서로 배타적인 갈래의 기록을 이었다`);
      if (l.order_basis === 'official_timeline') {
        const a = posOf(prev);
        const b = posOf(l);
        if (!a || !b) err('ORDER_BASIS_INVALID', `${p}.order_basis`, `official_timeline인데 ${!a ? pid : l.link_id}의 연표 위치가 없다(회고는 timeline anchor)`);
        else if (a.history_order >= b.history_order) err('ORDER_BASIS_INVALID', `${p}.order_basis`, `연표 순서가 앞서지 않는다(${a.history_order} → ${b.history_order}). 같은 연표 단위면 script 근거를 쓴다`);
      }
      if (l.order_basis === 'script') {
        const a = posOf(prev);
        const b = posOf(l);
        if (a && b && a.history_order > b.history_order) warn('TIMELINE_CONFLICTS_WITH_SCRIPT', `${p}.order_basis`, `script로 이었는데 연표는 반대(${a.history_order} → ${b.history_order})다. contradicting_evidence를 확인한다`);
      }
    }
    // anchor 필수(G3, 8.2-4)
    if (isPastish(l)) {
      const usesOrder = ['official_timeline', 'script'].includes(l.order_basis) || (referencedBy.get(l.link_id) ?? []).some((n) => ['official_timeline', 'script'].includes(n.order_basis) || n.progression === 'changes_from');
      if (usesOrder && !l.anchor) err('ANCHOR_REQUIRED', `${p}.anchor`, '회고·회상 기록을 순서에 쓰려면 성립 시점 anchor를 적는다(없으면 발화 이전까지만, 순서 unknown)');
      if (l.anchor?.kind === 'timeline' && store.has(l.anchor.scene_id) && l.temporal_anchor === 'past_before_scene') {
        const sp = speechScene(l);
        const ta = ctx.timeline.get(l.anchor.scene_id);
        const ts = ctx.timeline.get(sp);
        const sameTitle = store.meta(l.anchor.scene_id)?.title_id === store.meta(sp)?.title_id;
        if (l.anchor.scene_id === sp) err('ANCHOR_REQUIRED', `${p}.anchor.scene_id`, 'anchor는 발화 장면 자신이 아니다');
        else if (ta && ts && ta.history_order > ts.history_order) err('ANCHOR_REQUIRED', `${p}.anchor.scene_id`, 'anchor가 발화 장면보다 연표상 뒤다');
        else if ((!ta || !ts || ta.history_order === ts.history_order) && sameTitle && store.meta(l.anchor.scene_id).index_in_title > store.meta(sp).index_in_title) err('ANCHOR_REQUIRED', `${p}.anchor.scene_id`, 'anchor가 발화 장면보다 뒤 장면이다');
      }
    }
    // 확립 경고
    if (l.epistemic_status === 'established' && (l.memo_ids ?? []).length && (l.memo_ids ?? []).every((id) => memoById.get(id)?.epistemic_type === 'character_claim')) warn('ESTABLISHED_FROM_CLAIM_ONLY', p, '귀속 메모가 모두 주장인데 established다. 지문·연출로 확인했는지 본다');
  });
  // 순환
  const visiting = new Set();
  const done = new Set();
  const dfs = (id) => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const cyc = (linkById.get(id)?.prev_link_ids ?? []).some((p) => linkById.has(p) && dfs(p));
    visiting.delete(id);
    done.add(id);
    return cyc;
  };
  for (const id of linkById.keys()) if (dfs(id)) { err('PROGRESSION_AND_PREV', id, 'prev_link_ids에 순환이 있다'); break; }

  // 병합 제안
  const sids = new Set();
  (Array.isArray(shard.merge_suggestions) ? shard.merge_suggestions : []).forEach((m, i) => {
    const p = `merge_suggestions[${i}]`;
    if (!m || typeof m !== 'object') return err('MERGE_SUGGESTION', p, '객체여야 한다');
    if (!isNonEmptyString(m.suggestion_id) || !new RegExp(`^${bundle.bundle_id}__M\\d{2}$`).test(m.suggestion_id) || sids.has(m.suggestion_id)) err('MERGE_SUGGESTION', `${p}.suggestion_id`, `suggestion_id는 "${bundle.bundle_id}__M01" 형식이고 겹치지 않는다`);
    sids.add(m.suggestion_id);
    if (!Array.isArray(m.unit_ids) || !m.unit_ids.length || m.unit_ids.some((u) => !units.has(u))) err('MERGE_SUGGESTION', `${p}.unit_ids`, 'unit_ids는 이 묶음 단위 하나 이상이다');
    if (!Array.isArray(m.targets) || m.targets.length < 2) err('MERGE_SUGGESTION', `${p}.targets`, 'targets는 둘 이상이다');
    else {
      m.targets.forEach((t, j) => checkRef(t, `${p}.targets[${j}]`));
      const keys = m.targets.map((t) => canon.keyOfRef(t)).filter(Boolean);
      if (keys.length >= 2 && new Set(keys).size === 1) warn('MERGE_SAME_ID', p, '이미 같은 공식 대상(병합·전환 포함)이다');
    }
    if (!['유력한 해석', '가능성'].includes(m.confidence)) err('MERGE_SUGGESTION', `${p}.confidence`, 'confidence는 유력한 해석 | 가능성이다');
    if (!isNonEmptyString(m.rationale)) err('MERGE_SUGGESTION', `${p}.rationale`, 'rationale을 적는다');
    if (!Array.isArray(m.supporting_evidence) || !m.supporting_evidence.length) err('MERGE_SUGGESTION', `${p}.supporting_evidence`, '원문 근거를 하나 이상 적는다');
    else m.supporting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.supporting_evidence[${j}]`));
  });
  // 검색 예산
  for (const [uid, n] of ctx.termCounts ?? []) {
    if (n < PAIR_TERM_BUDGET) continue;
    const held = links.filter((l) => l?.unit_id === uid && l.confidence === '판단 보류');
    if (held.length && !held.some((l) => String(l.rationale ?? '').includes(SEARCH_BUDGET_TAG))) warn('BUDGET_TAG_MISSING', uid, `고유 검색어 ${n}개를 다 썼다. 예산 때문에 판단 보류했으면 rationale에 ${SEARCH_BUDGET_TAG}를 적는다`);
  }
  return { errors, warnings };
};

// ---------------------------------------------------------------------------
// 병합(finish): 철회(묶음 base_increment, 8.1-1)·새 주인(회차 순서), evidence_scenes(반박·anchor 포함, 8.2-5)

/**
 * entries: [{ bundle, shard, wave }], retraction: makeRetraction 결과(없으면 철회 없음)
 * 반환: 단위(쌍)마다 마지막 주인의 판정만 남기고, 철회된 장면 메모를 뺀다
 */
export const effectiveDEntries = (entries, retraction = null) => {
  const ordered = [...entries].sort((a, b) => a.wave - b.wave || cmpStr(a.bundle.bundle_id, b.bundle.bundle_id));
  const owner = new Map(); // pair_key → bundle_id (뒤 회차가 새 주인)
  for (const e of ordered) for (const u of e.bundle.units) owner.set(u.pair_key, e.bundle.bundle_id);
  const retracted = (e, m) => Boolean(retraction?.isRetracted(e.bundle.base_increment ?? null, m.scene_id));
  const withdrawnPairs = new Set();
  const out = ordered.map((e) => {
    const keepUnits = new Set();
    const removed = [];
    for (const u of e.bundle.units) {
      if (owner.get(u.pair_key) !== e.bundle.bundle_id) { removed.push({ unit_id: u.unit_id, reason: 'new_owner' }); continue; }
      const live = e.bundle.memos.filter((m) => m.unit_id === u.unit_id && !retracted(e, m));
      if (!live.length) { withdrawnPairs.add(u.pair_key); removed.push({ unit_id: u.unit_id, reason: 'withdrawn_pair' }); continue; }
      keepUnits.add(u.unit_id);
    }
    const liveMemo = new Set(e.bundle.memos.filter((m) => keepUnits.has(m.unit_id) && !retracted(e, m)).map((m) => m.item_id));
    const shard = {
      ...e.shard,
      candidate_links: (e.shard.candidate_links ?? []).filter((l) => keepUnits.has(l.unit_id)).map((l) => ({ ...l, memo_ids: l.memo_ids.filter((id) => liveMemo.has(id)) })).filter((l) => l.memo_ids.length),
      excluded_memos: (e.shard.excluded_memos ?? []).filter((x) => keepUnits.has(x.unit_id) && liveMemo.has(x.item_id)),
      endpoint_overrides: (e.shard.endpoint_overrides ?? []).filter((o) => keepUnits.has(o.unit_id)),
    };
    return { ...e, shard, removed, liveMemo };
  });
  return { entries: out, withdrawnPairs };
};

export const evidenceScenesOf = (l) => [...new Set([
  ...(l.supporting_evidence ?? []).map((e) => e.scene_id),
  ...(l.contradicting_evidence ?? []).map((e) => e.scene_id),
  ...(l.anchor?.scene_id ? [l.anchor.scene_id] : []),
  ...(l.anchor?.evidence ?? []).map((e) => e.scene_id),
].filter(Boolean))].sort(cmpStr);

/** 단위 상태 층(감사 2.10절) */
export const unitStratum = (unit, links) => {
  if (!links.length) return 'all_excluded';
  if (links.some((l) => ['changes_from', 'contradicts', 'reinterprets'].includes(l.progression))) return 'has_change';
  return unit.memo_ids.length >= 2 ? 'multi_steady' : 'single_memo';
};

export const mergeD = ({ entries, canon, timeline, releaseDates, store }) => {
  const relations = [];
  const pairStatus = [];
  const excluded = [];
  const merges = [];
  const pairOwners = new Map(); // 보정 뒤 쌍 → [{ bundle_id, unit_id }]
  for (const e of entries) {
    const memoById = new Map(e.bundle.memos.map((m) => [m.item_id, m]));
    const eff = new Map(e.bundle.memos.map((m) => [m.item_id, { subject: m.subject_node, target: m.target_node }]));
    for (const o of e.shard.endpoint_overrides ?? []) for (const id of o.memo_ids) if (eff.has(id)) eff.get(id)[o.side] = canon.keyOfRef(o.to) ?? eff.get(id)[o.side];
    for (const u of e.bundle.units) {
      if (e.removed.some((r) => r.unit_id === u.unit_id)) continue;
      const links = e.shard.candidate_links.filter((l) => l.unit_id === u.unit_id);
      const live = u.memo_ids.filter((id) => e.liveMemo.has(id));
      const pairs = new Set(live.map((id) => pairKeyOf(eff.get(id).subject, eff.get(id).target)));
      for (const pk of pairs) {
        if (!pairOwners.has(pk)) pairOwners.set(pk, []);
        pairOwners.get(pk).push({ bundle_id: e.bundle.bundle_id, unit_id: u.unit_id });
      }
      pairStatus.push({ pair_key: u.pair_key, bundle_id: e.bundle.bundle_id, unit_id: u.unit_id, wave: e.wave, memos: live.length, links: links.length, excluded: e.shard.excluded_memos.filter((x) => x.unit_id === u.unit_id).length, stratum: unitStratum({ memo_ids: live }, links), effective_pairs: [...pairs].sort(cmpStr) });
      for (const l of links) {
        const scenes = evidenceScenesOf(l);
        const memoScenes = [...new Set(l.memo_ids.map((id) => memoById.get(id)?.scene_id).filter(Boolean))];
        const timelineInfo = [...new Set([...memoScenes, ...(l.anchor?.scene_id ? [l.anchor.scene_id] : [])])].map((sid) => ({ scene_id: sid, ...(timeline.get(sid) ?? {}) })).filter((x) => x.history_order !== undefined);
        const titles = [...new Set(memoScenes.map((sid) => store.meta(sid)?.title_id).filter(Boolean))];
        relations.push({ ...l, bundle_id: e.bundle.bundle_id, wave: e.wave, pair_key: u.pair_key, evidence_scenes: [...new Set([...scenes, ...memoScenes])].sort(cmpStr), timeline_info: timelineInfo, release_dates: Object.fromEntries(titles.map((t) => [t, releaseDates?.get?.(t)?.release_date ?? null])) });
      }
    }
    for (const x of e.shard.excluded_memos) excluded.push({ ...x, bundle_id: e.bundle.bundle_id });
    for (const m of e.shard.merge_suggestions ?? []) merges.push({ ...m, bundle_id: e.bundle.bundle_id, wave: e.wave });
  }
  const overlaps = [...pairOwners].filter(([, xs]) => xs.length > 1).map(([pair_key, owners]) => ({ pair_key, owners, kind: new Set(owners.map((o) => o.bundle_id)).size > 1 ? 'cross_bundle' : 'same_bundle' }));
  return { relations, pairStatus, excluded, merges, pairMergeNeeded: overlaps };
};

// ---------------------------------------------------------------------------
// 감사 표본(2.10절)

const rankOf = (seed, id) => sha256(`${seed}|${id}`);
export const sampleDAudit = ({ units, linksByUnit, memosByUnit, overrides, merges, rate, seed, includeIds = [], bundlePaths }) => {
  const strata = new Map();
  for (const u of units) {
    const links = linksByUnit.get(`${u.bundle_id}|${u.unit_id}`) ?? [];
    const st = unitStratum(u, links);
    const conf = links.length ? links.map((l) => l.confidence).sort().at(-1) : '해당 없음';
    const k = `${st}/${conf}`;
    if (!strata.has(k)) strata.set(k, []);
    strata.get(k).push(u);
  }
  const include = new Set(includeIds);
  const items = [];
  const report = [];
  for (const [k, list] of [...strata].sort((a, b) => cmpStr(a[0], b[0]))) {
    const st = k.split('/')[0];
    const r = Math.min(1, rate * (AUDIT_RATE_FACTOR[st] ?? 1));
    const n = Math.max(1, Math.ceil(list.length * r));
    const ranked = [...list].sort((a, b) => cmpStr(rankOf(seed, `${a.bundle_id}:${a.unit_id}`), rankOf(seed, `${b.bundle_id}:${b.unit_id}`)));
    const picked = new Set(ranked.slice(0, n).map((u) => `${u.bundle_id}:${u.unit_id}`));
    for (const u of list) if (include.has(`${u.bundle_id}:${u.unit_id}`)) picked.add(`${u.bundle_id}:${u.unit_id}`);
    report.push({ stratum: k, population: list.length, sampled: picked.size, rate: r });
    for (const u of list.filter((x) => picked.has(`${x.bundle_id}:${x.unit_id}`))) {
      items.push({ audit_id: `${u.bundle_id}:${u.unit_id}`, kind: 'unit', bundle_id: u.bundle_id, unit_id: u.unit_id, stratum: st, nodes: [u.node_a.ref, u.node_b.ref], memos: memosByUnit.get(`${u.bundle_id}|${u.unit_id}`) ?? [], links: linksByUnit.get(`${u.bundle_id}|${u.unit_id}`) ?? [], excluded: u.excluded ?? [], files: bundlePaths.get(u.bundle_id) });
    }
  }
  for (const o of overrides) items.push({ audit_id: `override:${o.bundle_id}:${o.unit_id}:${o.memo_ids.join(',')}:${o.side}`, kind: 'endpoint_override', ...o, files: bundlePaths.get(o.bundle_id) });
  for (const m of merges) items.push({ audit_id: `merge:${m.suggestion_id}`, kind: 'merge_suggestion', ...m, files: bundlePaths.get(m.bundle_id) });
  const ids = items.map((x) => x.audit_id);
  if (new Set(ids).size !== ids.length) throw new Error('감사 항목 ID가 겹친다');
  return { population_units: units.length, sampled_units: items.filter((x) => x.kind === 'unit').length, rate, seed, strata: report, items };
};

// ---------------------------------------------------------------------------
// 묶음 만들기

const BUNDLE_PREFIX = 'D1';
export const buildD = ({ run, inputs, baseIncrement, limits = {}, waveSize = WAVE_SIZE }) => {
  const P = pathsOf(run);
  const { store } = inputs;
  const memos = resolveMemos(inputs);
  const byPair = new Map();
  for (const m of memos) {
    const pk = pairKeyOf(m.subject_node, m.target_node);
    m.pair_key = pk;
    if (!byPair.has(pk)) byPair.set(pk, []);
    byPair.get(pk).push(m);
  }
  const nodeRef = new Map();
  for (const m of memos) { nodeRef.set(m.subject_node, m.subject_ref); nodeRef.set(m.target_node, m.target_ref); }
  const unitsRaw = [...byPair].map(([pk, ms]) => {
    const [a, b] = pk.split(' || ');
    ms.sort((x, y) => store.sceneOrder.get(x.scene_id) - store.sceneOrder.get(y.scene_id) || x.line_start - y.line_start);
    const u = { pair_key: pk, node_a: { key: a, ref: nodeRef.get(a) }, node_b: { key: b, ref: nodeRef.get(b) }, memo_count: ms.length, order: store.sceneOrder.get(ms[0].scene_id) };
    u.excerpt = excerptOfUnit({ ...u, unit_id: 'U000' }, ms, store);
    u.chars = u.excerpt.length;
    return u;
  });
  const packed = packUnits(unitsRaw, limits);
  fs.mkdirSync(P.bundles, { recursive: true });
  const planBundles = [];
  packed.forEach((pb, bi) => {
    const bundleId = `${BUNDLE_PREFIX}__${pad(bi + 1)}`;
    const wave = Math.floor(bi / waveSize) + 1;
    const units = pb.units.map((u, ui) => ({ unit_id: `U${pad(ui + 1)}`, pair_key: u.pair_key, node_a: u.node_a, node_b: u.node_b, memo_ids: byPair.get(u.pair_key).map((m) => m.item_id) }));
    const bundleMemos = units.flatMap((u) => byPair.get(u.pair_key).map((m) => ({ ...m, unit_id: u.unit_id, history_order: inputs.timeline.get(m.scene_id)?.history_order ?? null })));
    for (const u of units) {
      const ms = bundleMemos.filter((m) => m.unit_id === u.unit_id);
      u.address_summary = addressSummary(u, ms, inputs);
      u.prior_pass2_context = priorContext(u, ms, inputs);
      u.ambiguous_endpoints = ms.filter((m) => m.ambiguous_candidates.subject.length || m.ambiguous_candidates.target.length || ['title_unique', 'b_candidate'].includes(m.subject_resolved_by) || ['title_unique', 'b_candidate'].includes(m.target_resolved_by)).map((m) => ({ item_id: m.item_id, subject: { surface: m.subject, resolved_by: m.subject_resolved_by, candidates: m.ambiguous_candidates.subject }, target: { surface: m.target, resolved_by: m.target_resolved_by, candidates: m.ambiguous_candidates.target } }));
    }
    const scriptText = units.map((u) => excerptOfUnit(u, bundleMemos.filter((m) => m.unit_id === u.unit_id), store)).join('\n\n');
    const scriptFile = path.join(P.bundles, `${bundleId}.excerpts.txt`);
    fs.writeFileSync(scriptFile, `${scriptText}\n`);
    const bundle = {
      schema_version: PASS2_BUNDLE_SCHEMA_VERSION,
      kind: 'D',
      bundle_id: bundleId,
      run,
      wave,
      base_increment: baseIncrement ?? null,
      solo: pb.solo,
      script_file: relPath(scriptFile),
      units,
      memos: bundleMemos.map(({ ambiguous_candidates: _a, subject_ref: _s, target_ref: _t, pair_key: _p, ...m }) => m),
    };
    const bundleText = stringifyBundle(bundle);
    fs.writeFileSync(path.join(P.bundles, `${bundleId}.json`), bundleText);
    planBundles.push({
      bundle_id: bundleId,
      wave,
      units: units.length,
      memos: bundleMemos.length,
      solo: pb.solo,
      excerpt_chars: scriptText.length,
      bundle_json_chars: bundleText.length,
      total_input_chars: scriptText.length + bundleText.length,
      input: relPath(path.join(P.bundles, `${bundleId}.json`)),
      script: relPath(scriptFile),
      output: relPath(path.join(P.shards, `${bundleId}.json`)),
      validate: `node scripts/graph/pass2-d.mjs validate ${bundleId} --run=${run}`,
    });
  });
  const resolvedBy = {};
  for (const m of memos) for (const k of [m.subject_resolved_by, m.target_resolved_by]) resolvedBy[k] = (resolvedBy[k] ?? 0) + 1;
  const plan = {
    schema_version: 'pass2-d-plan-0.1.0',
    run,
    base_increment: baseIncrement ?? null,
    generated_at: new Date().toISOString(),
    limits: { MAX_UNITS, MAX_UNITS_SINGLE, MAX_MEMOS, MAX_CHARS, ...limits, wave_size: waveSize },
    population: { memos: memos.length, pairs: byPair.size, single_memo_pairs: unitsRaw.filter((u) => u.memo_count === 1).length, resolved_by: resolvedBy, solo_bundles: packed.filter((b) => b.solo).length },
    bundles: planBundles,
  };
  writeJsonAtomic(P.plan, plan);
  return plan;
};

/** 묶음 JSON: 메모는 한 줄에 하나(판정자 입력 글자 수를 줄인다) */
// 기본값 칸(false·null·present·participants/a2 해소)은 적지 않고, 단위의 memo_ids는 메모의 unit_id로 되살린다(loadBundleDoc)
const MEMO_DEFAULTS = { refers_to_past: false, chronology_type: 'present', in_branch_option: null, claimant: null, claim_line: null, history_order: null };
const compactMemo = (m) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'title_id' || k === 'unit_id_hint') continue;
    if (k in MEMO_DEFAULTS && v === MEMO_DEFAULTS[k]) continue;
    if ((k === 'subject_resolved_by' || k === 'target_resolved_by') && (v === 'participants' || v === 'a2')) continue;
    out[k] = v;
  }
  return out;
};
export const expandBundle = (b) => {
  const memos = b.memos.map((m) => ({ ...MEMO_DEFAULTS, subject_resolved_by: 'participants', target_resolved_by: 'participants', ...m }));
  const ids = new Map();
  for (const m of memos) { if (!ids.has(m.unit_id)) ids.set(m.unit_id, []); ids.get(m.unit_id).push(m.item_id); }
  return { ...b, memos, units: b.units.map((u) => ({ ...u, memo_ids: u.memo_ids ?? ids.get(u.unit_id) ?? [] })) };
};
export const stringifyBundle = (bundle) => {
  const { memos, ...rest } = bundle;
  rest.units = rest.units.map(({ memo_ids: _m, ...u }) => u);
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  return `${head},\n  "memos": [\n${memos.map((m) => `    ${JSON.stringify(compactMemo(m))}`).join(',\n')}\n  ]\n}\n`;
};

/** 쌍 사이 자주 쓴 호칭(근거 아님, 2.8절) */
const addressSummary = (unit, memos, inputs) => {
  const counts = new Map();
  const scenes = new Set(memos.map((m) => m.scene_id));
  const nameKeys = (node) => new Set([variantKey(node.ref?.name ?? ''), ...memos.flatMap((m) => [m.subject_node === node.key ? variantKey(m.subject) : null, m.target_node === node.key ? variantKey(m.target) : null]).filter(Boolean)]);
  const ka = nameKeys(unit.node_a);
  const kb = nameKeys(unit.node_b);
  for (const sid of scenes) {
    const s = inputs.sceneById?.get(sid);
    for (const f of s?.forms_of_address ?? []) {
      const from = variantKey(f.from_speaker);
      const to = variantKey(f.to_target);
      const dir = ka.has(from) && kb.has(to) ? 'a→b' : kb.has(from) && ka.has(to) ? 'b→a' : null;
      if (!dir) continue;
      const k = `${dir}|${f.address_term}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0])).slice(0, ADDRESS_TOP).map(([k, n]) => ({ direction: k.split('|')[0], address_term: k.split('|')[1], count: n }));
};

/** 쌍 메모 장면의 B 정체 판정·C 같은 대상 연결 중 걸리는 것(근거 아님, 2.8절) */
const priorContext = (unit, memos, inputs) => {
  const scenes = new Set(memos.map((m) => m.scene_id));
  const out = [];
  for (const l of inputs.bLinks ?? []) {
    if (!(l.subject ?? []).some((s) => scenes.has(String(s.item_id).replace(/__(unk|dca|dsp)_\d+$/, '')))) continue;
    out.push({ kind: 'B', link_id: l.link_id, verdict: l.verdict, target: l.target?.[0]?.name ?? null, confidence: l.confidence });
    if (out.length >= PRIOR_CONTEXT_MAX) return out;
  }
  const near = (ev) => memos.some((m) => m.scene_id === ev.scene_id && ev.line_end >= m.line_start - EXCERPT_RADIUS && ev.line_start <= m.line_end + EXCERPT_RADIUS);
  for (const l of inputs.cLinks ?? []) {
    if (l.verdict !== '같은 대상' || !(l.supporting_evidence ?? []).some(near)) continue;
    out.push({ kind: 'C', link_id: l.link_id, confidence: l.confidence, rationale: String(l.rationale ?? '').slice(0, 100) });
    if (out.length >= PRIOR_CONTEXT_MAX) break;
  }
  return out;
};

// ---------------------------------------------------------------------------
// CLI

const argValue = (args, name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const loadBundle = (P, id) => expandBundle(JSON.parse(fs.readFileSync(path.join(P.bundles, `${id}.json`), 'utf8')));
const loadShard = (P, id) => {
  const f = path.join(P.shards, `${id}.json`);
  if (!fs.existsSync(f)) return { missing: true };
  try { return { shard: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { parseError: e.message }; }
};
const stampPath = (P, id) => path.join(P.stamps, `${id}.json`);
const currentStamp = (P, id, bundle) => computeStamp({ rulesText: fs.readFileSync(RULES_PATH, 'utf8'), bundle, scriptText: fs.readFileSync(path.resolve(bundle.script_file), 'utf8'), shardText: fs.readFileSync(path.join(P.shards, `${id}.json`), 'utf8') });
const staleReasonOf = (P, id, bundle) => staleReason(readJsonIfExists(stampPath(P, id)), currentStamp(P, id, bundle));
export const pairTermCountsOf = (P, bundleId) => {
  const terms = new Map();
  if (!fs.existsSync(P.searchLog)) return terms;
  for (const line of fs.readFileSync(P.searchLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.bundle_id !== bundleId || !r.unit_id) continue;
    if (!terms.has(r.unit_id)) terms.set(r.unit_id, new Set());
    terms.get(r.unit_id).add(r.term);
  }
  return new Map([...terms].map(([k, v]) => [k, v.size]));
};
let ctxCache = null;
const makeCtx = () => {
  if (ctxCache) return ctxCache;
  const store = new SceneStore();
  const official = readJsonIfExists(OFFICIAL_ENTITIES_PATH) ?? {};
  const terms = readJsonIfExists(OFFICIAL_TERMS_PATH)?.terms ?? [];
  const a2 = readJsonIfExists(A2_RESOLUTIONS_PATH)?.resolutions ?? [];
  const registry = withUserAliases(loadRegistry(), a2);
  // 흡수된 지난 공식 ID도 조회(loadPass2Entities가 id_map을 함께 싣는다)
  for (const [id, e] of loadPass2Entities()) if (!registry.has(id) && !official.entities?.some((x) => x.entity_id === id)) registry.set(id, e);
  const canon = makeCanon({ registry, official, terms, userMerges: readJsonIfExists(USER_MERGES_PATH) ?? {} });
  ctxCache = { store, canon, timeline: timelineOfScenes(parseCsv(fs.readFileSync(WORLD_HISTORY_PATH, 'utf8')), store), routes: routeGraphOf(store), releaseDates: loadReleaseDates() };
  return ctxCache;
};
const validateOne = (P, id, ctx) => {
  const bundle = loadBundle(P, id);
  const s = loadShard(P, id);
  if (s.missing) return { bundle, status: 'missing', errors: [{ code: 'NO_OUTPUT', path: '$', message: '출력 파일이 없다' }], warnings: [] };
  if (s.parseError) return { bundle, status: 'fail', errors: [{ code: 'JSON_PARSE', path: '$', message: s.parseError }], warnings: [] };
  const r = validateDShard(s.shard, bundle, { ...ctx, termCounts: pairTermCountsOf(P, id) });
  return { bundle, shard: s.shard, status: r.errors.length ? 'fail' : 'pass', ...r };
};
const printResult = (id, r) => {
  const tag = r.status === 'pass' ? (r.warnings.length ? '[WARN]' : '[PASS]') : '[FAIL]';
  console.log(`${tag} ${id}: 오류 ${r.errors.length}건, 경고 ${r.warnings.length}건`);
  for (const e of r.errors) console.log(`  ERROR ${e.code} ${e.path}: ${e.message}`);
  for (const w of r.warnings) console.log(`  WARN  ${w.code} ${w.path}: ${w.message}`);
};
const doneEntries = (P, plan, ctx, maxWave = Infinity) => plan.bundles.filter((b) => b.wave <= maxWave).flatMap((b) => {
  const r = validateOne(P, b.bundle_id, ctx);
  if (r.status !== 'pass' || staleReasonOf(P, b.bundle_id, r.bundle)) return [];
  return [{ plan: b, bundle: r.bundle, shard: { endpoint_overrides: [], candidate_links: [], excluded_memos: [], merge_suggestions: [], ...r.shard }, wave: b.wave }];
});

/** 부분 결과를 샤드에 덧붙인다(2.5절 차선책 (가)). 임시 link_id(P1 등)는 이어지는 번호로 바꾸고 prev_link_ids도 고친다 */
export const appendPart = (shard, part, bundle) => {
  const out = { schema_version: PASS2_SCHEMA_VERSION, bundle_id: bundle.bundle_id, endpoint_overrides: [], candidate_links: [], excluded_memos: [], merge_suggestions: [], ...(shard ?? {}) };
  let next = Math.max(0, ...out.candidate_links.map((l) => Number(/__(\d{3})$/.exec(l.link_id ?? '')?.[1] ?? 0))) + 1;
  const rename = new Map();
  const realRe = new RegExp(`^${bundle.bundle_id}__\\d{3}$`);
  for (const l of part.candidate_links ?? []) {
    if (realRe.test(l.link_id ?? '') && !out.candidate_links.some((x) => x.link_id === l.link_id)) continue;
    rename.set(l.link_id, `${bundle.bundle_id}__${pad(next++)}`);
  }
  for (const l of part.candidate_links ?? []) out.candidate_links.push({ ...l, link_id: rename.get(l.link_id) ?? l.link_id, prev_link_ids: (l.prev_link_ids ?? []).map((p) => rename.get(p) ?? p) });
  for (const k of ['endpoint_overrides', 'excluded_memos', 'merge_suggestions']) out[k].push(...(part[k] ?? []));
  const covered = new Set([...out.candidate_links.flatMap((l) => l.memo_ids ?? []), ...out.excluded_memos.map((x) => x.item_id)]);
  return { shard: out, remaining: bundle.memos.filter((m) => !covered.has(m.item_id)).map((m) => m.item_id) };
};

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const run = argValue(args, 'run') ?? 'pilot';
  if (!RUNS.has(run)) throw new Error(`--run은 ${[...RUNS].join(' | ')} 중 하나다`);
  const P = pathsOf(run);

  if (cmd === 'build' && args.includes('--all')) {
    if (run !== 'main') throw new Error('전수 패킹은 --run=main에서만 한다. 파일럿은 build --select로 골라 복사한다');
    const inputs = loadDInputs();
    inputs.sceneById = new Map([...inputs.scenesByTitle.values()].flat().map((s) => [s.scene_id, s]));
    inputs.cLinks = (readJsonIfExists(C_CANDIDATES_PATH)?.links ?? []);
    const scopes = loadScopes();
    const base = scopes.map((s) => s.increment_id).sort().at(-1) ?? null;
    const plan = buildD({ run, inputs, baseIncrement: base, limits: { ...(argValue(args, 'max-units') ? { maxUnits: Number(argValue(args, 'max-units')) } : {}), ...(argValue(args, 'max-chars') ? { maxChars: Number(argValue(args, 'max-chars')) } : {}) } });
    const p = plan.population;
    console.log(`[build] 메모 ${p.memos}, 쌍 ${p.pairs}(메모 1건 ${p.single_memo_pairs}) → 묶음 ${plan.bundles.length}개(단독 ${p.solo_bundles}), 회차 ${Math.max(...plan.bundles.map((b) => b.wave))}, base_increment ${plan.base_increment}`);
    console.log(`[build] 끝점 해소 ${JSON.stringify(p.resolved_by)}`);
    const tot = plan.bundles.reduce((n, b) => n + b.total_input_chars, 0);
    console.log(`[build] 입력 합계 ${tot.toLocaleString()}자, 묶음 최대 ${Math.max(...plan.bundles.map((b) => b.total_input_chars)).toLocaleString()}자 → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'build' && argValue(args, 'select')) {
    if (run === 'main') throw new Error('--select는 파일럿·재시험 실행에 쓴다');
    const main = JSON.parse(fs.readFileSync(pathsOf('main').plan, 'utf8'));
    const waves = argValue(args, 'select').split(';').map((w) => w.split(',').map((x) => x.trim()).filter(Boolean));
    fs.mkdirSync(P.bundles, { recursive: true });
    const bundles = [];
    waves.forEach((ids, wi) => {
      for (const id of ids) {
        const pb = main.bundles.find((b) => b.bundle_id === id);
        if (!pb) throw new Error(`전수 계획에 없는 묶음 ${id}`);
        const b = loadBundle(pathsOf('main'), id);
        const script = path.join(P.bundles, `${id}.excerpts.txt`);
        fs.copyFileSync(path.resolve(b.script_file), script);
        const nb = { ...b, run, wave: wi + 1, script_file: relPath(script) };
        fs.writeFileSync(path.join(P.bundles, `${id}.json`), stringifyBundle(nb));
        bundles.push({ ...pb, wave: wi + 1, input: relPath(path.join(P.bundles, `${id}.json`)), script: relPath(script), output: relPath(path.join(P.shards, `${id}.json`)), validate: `node scripts/graph/pass2-d.mjs validate ${id} --run=${run}` });
      }
    });
    writeJsonAtomic(P.plan, { ...main, run, generated_at: new Date().toISOString(), copied_from: relPath(pathsOf('main').plan), bundles });
    console.log(`[build] ${run}: ${bundles.length}묶음(${waves.map((w, i) => `회차 ${i + 1}: ${w.length}`).join(', ')}) → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'status') {
    const plan = JSON.parse(fs.readFileSync(P.plan, 'utf8'));
    const ctx = makeCtx();
    const wave = argValue(args, 'wave') ? Number(argValue(args, 'wave')) : null;
    for (const b of selectWave(plan, wave)) {
      const r = validateOne(P, b.bundle_id, ctx);
      let tag = r.status === 'missing' ? 'new' : r.status === 'pass' ? 'done' : 'fail';
      let why = '';
      if (tag === 'done') { const s = staleReasonOf(P, b.bundle_id, r.bundle); if (s) { tag = 'rerun'; why = ` — ${s}`; } }
      console.log(`[${tag}] ${b.bundle_id} 회차 ${b.wave} (단위 ${b.units}, 메모 ${b.memos})${why}`);
    }
    return;
  }

  if (cmd === 'validate') {
    const id = args.find((a) => !a.startsWith('--'));
    if (!id) throw new Error('validate <bundle_id>');
    const ctx = makeCtx();
    const r = validateOne(P, id, ctx);
    printResult(id, r);
    await fsp.mkdir(P.root, { recursive: true });
    await fsp.appendFile(P.log, `${JSON.stringify({ at: new Date().toISOString(), bundle_id: id, status: r.status, errors: r.errors.length, warnings: r.warnings.length })}\n`);
    if (r.status === 'pass') {
      fs.mkdirSync(P.stamps, { recursive: true });
      writeJsonAtomic(stampPath(P, id), { bundle_id: id, validated_at: new Date().toISOString(), ...currentStamp(P, id, r.bundle) });
    } else process.exitCode = 1;
    return;
  }

  if (cmd === 'append-shard') {
    const id = args.find((a) => !a.startsWith('--'));
    const from = argValue(args, 'from');
    if (!id || !from) throw new Error('append-shard <bundle_id> --from=<part.json>');
    const bundle = loadBundle(P, id);
    const cur = loadShard(P, id);
    if (cur.parseError) throw new Error(`샤드를 읽을 수 없다: ${cur.parseError}`);
    const r = appendPart(cur.shard ?? null, JSON.parse(fs.readFileSync(path.resolve(from), 'utf8')), bundle);
    fs.mkdirSync(P.shards, { recursive: true });
    fs.writeFileSync(path.join(P.shards, `${id}.json`), `${JSON.stringify(r.shard, null, 2)}\n`);
    console.log(`[append-shard] ${id}: 기록 ${r.shard.candidate_links.length}, 제외 ${r.shard.excluded_memos.length}, 남은 메모 ${r.remaining.length}${r.remaining.length ? ` (${r.remaining.slice(0, 10).join(', ')}${r.remaining.length > 10 ? ' …' : ''})` : ' → validate 하라'}`);
    return;
  }

  if (cmd === 'cand') {
    const [id, unitId] = args.filter((a) => !a.startsWith('--'));
    if (!id) throw new Error('cand <bundle_id> [<unit_id>]');
    const b = loadBundle(P, id);
    for (const u of b.units.filter((x) => !unitId || x.unit_id === unitId)) {
      console.log(`# ${u.unit_id} ${u.node_a.key} (${u.node_a.ref.name}) ↔ ${u.node_b.key} (${u.node_b.ref.name}), 메모 ${u.memo_ids.length}`);
      for (const m of b.memos.filter((x) => x.unit_id === u.unit_id)) console.log(`  ${m.item_id} ${m.scene_id} L${m.line_start}-L${m.line_end} | ${m.subject}→${m.target} | ${m.epistemic_type}${m.claimant ? `(${m.claimant})` : ''} | ${m.chronology_type}${m.refers_to_past ? '·회고' : ''}${m.in_branch_option ? ` | 선택 L${m.in_branch_option.choice_line} "${m.in_branch_option.option_text}"` : ''}${m.history_order != null ? ` | 연표 ${m.history_order}` : ''} | ${m.relation_or_change}`);
      if (u.address_summary?.length) console.log(`  호칭(근거 아님): ${u.address_summary.map((a) => `${a.direction} ${a.address_term}×${a.count}`).join(', ')}`);
      for (const c of u.prior_pass2_context ?? []) console.log(`  앞 단계(근거 아님): ${c.kind} ${c.link_id} ${c.target ?? c.rationale ?? ''} (${c.confidence})`);
      for (const a of u.ambiguous_endpoints ?? []) console.log(`  끝점 확인: ${a.item_id} subject "${a.subject.surface}" ${a.subject.resolved_by}${a.subject.candidates.length ? ` 후보 ${a.subject.candidates.join(', ')}` : ''} / target "${a.target.surface}" ${a.target.resolved_by}${a.target.candidates.length ? ` 후보 ${a.target.candidates.join(', ')}` : ''}`);
    }
    return;
  }

  if (cmd === 'show') {
    const [sid, from, to] = args.filter((a) => !a.startsWith('--'));
    const ctx = makeCtx();
    const lines = ctx.store.lines(sid);
    if (!lines) throw new Error(`등록 장면이 아니다: ${sid}`);
    const a = Math.max(1, Number(from) || 1);
    const b = Math.min(lines.length - 1, Number(to) || lines.length - 1);
    const meta = ctx.store.meta(sid);
    const tl = ctx.timeline.get(sid);
    const route = meta.mgt?.route;
    console.log(`@@@ ${sid} | ${meta.title_id} | ${meta.sub_title ?? ''} | ${lines.length - 1}줄 | 이야기 안 ${meta.index_in_title + 1}번째${tl ? ` | 연표 ${tl.history_order}` : ''}`);
    if (route?.parallel_scene_ids?.length) console.log(`# 병렬 루트 장면: ${route.parallel_scene_ids.join(', ')}`);
    if (route?.next_routes?.length) console.log(`# 다음 경로: ${route.next_routes.map((r) => `${r.target}${r.option ? `(${r.option})` : ''}`).join(', ')}`);
    for (let i = a; i <= b; i++) console.log(`[${lineTag(i)}] ${lines[i]}`);
    return;
  }

  if (cmd === 'grep') {
    const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    const title = argValue(args, 'title');
    const titles = title ? [...new Set(title.split(',').map((t) => t.trim()).filter(Boolean))] : [];
    if (term.length < 2 && !titles.length) throw new Error('검색어는 2글자 이상이다. 한 글자 검색어는 --title을 정할 때만 쓴다');
    const bundle = argValue(args, 'bundle');
    const unit = argValue(args, 'unit');
    if (!bundle || !unit) throw new Error('grep <낱말> --bundle=<bundle_id> --unit=<unit_id> [--title=a,b] [--offset=0]');
    const limit = Math.min(100, Math.max(1, Number(argValue(args, 'limit')) || 30));
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const store = makeCtx().store;
    for (const t of titles) if (!store.titleIndex.has(t)) throw new Error(`등록 이야기가 아니다: ${t}`);
    const sceneIds = titles.length ? titles.flatMap((t) => store.titles[store.titleIndex.get(t)].scene_ids.filter((x) => store.has(x))) : [...store.allSceneIds()];
    const hits = [];
    const scenes = new Set();
    for (const sid of sceneIds) {
      const lines = store.lines(sid);
      for (let i = 1; i < lines.length; i++) if (lines[i]?.includes(term)) { hits.push({ scene_id: sid, line: i }); scenes.add(sid); }
    }
    const shown = hits.slice(offset, offset + limit);
    console.log(`"${term}": 장면 ${scenes.size}개, ${hits.length}줄${offset + shown.length < hits.length ? ` (이어 보기: --offset=${offset + shown.length})` : ''}`);
    for (const h of shown) console.log(`${h.scene_id} [${lineTag(h.line)}] (${store.meta(h.scene_id).title_id}) ${store.lines(h.scene_id)[h.line]}`);
    await fsp.mkdir(P.root, { recursive: true });
    await fsp.appendFile(P.searchLog, `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundle, unit_id: unit, term, titles, scenes: scenes.size, lines: hits.length, limit, offset, shown: shown.length })}\n`);
    return;
  }

  if (cmd === 'entity') {
    const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!q) throw new Error('entity <이름>');
    const nq = nfkc(q);
    const has = (names) => names.some((n) => nfkc(n ?? '').includes(nq));
    const a2 = readJsonIfExists(A2_RESOLUTIONS_PATH)?.resolutions ?? [];
    const reg = [...withUserAliases(loadRegistry(), a2).values()].filter((e) => has([e.canonical_name, ...(e.surface_labels ?? [])]));
    const off = (readJsonIfExists(OFFICIAL_ENTITIES_PATH)?.entities ?? []).filter((e) => has([e.canonical_name, ...(e.surface_labels ?? [])]));
    const terms = (readJsonIfExists(OFFICIAL_TERMS_PATH)?.terms ?? []).filter((t) => has([t.canonical_name, ...(t.surfaces ?? [])]));
    const um = readJsonIfExists(USER_MERGES_PATH) ?? {};
    if (!reg.length && !off.length && !terms.length) console.log(`"${q}": 레지스트리·공식 표·표기 묶음에 없다`);
    for (const e of reg.slice(0, 15)) {
      const m = (um.id_merges ?? []).find((x) => x.from === e.entity_id);
      const k = (um.kind_redirects ?? []).find((x) => x.from === e.entity_id);
      console.log(`entity\t${e.entity_id}\t${e.canonical_name}\t별칭: ${(e.surface_labels ?? []).join(', ')}${m ? `\t(→ ${m.to}로 합쳐짐)` : ''}${k ? `\t(→ ${k.to.ref} ${k.to.term_key ?? k.to.entity_id}로 전환)` : ''}`);
    }
    for (const e of off.slice(0, 15)) console.log(`entity\t${e.entity_id}\t${e.canonical_name}\t${e.entity_type}${e.qualifier ? ` (${e.qualifier})` : ''}\t표기: ${(e.surface_labels ?? []).join(', ')}`);
    for (const t of terms.slice(0, 15)) console.log(`term\t${t.term_key}\t${t.canonical_name}\t${t.entity_type}${t.qualifier ? ` (${t.qualifier})` : ''}\t표기: ${(t.surfaces ?? []).join(', ')}`);
    return;
  }

  if (cmd === 'finish') {
    const plan = JSON.parse(fs.readFileSync(P.plan, 'utf8'));
    const ctx = makeCtx();
    const all = doneEntries(P, plan, ctx);
    const missing = plan.bundles.filter((b) => !all.some((e) => e.bundle.bundle_id === b.bundle_id)).map((b) => b.bundle_id);
    const eff = effectiveDEntries(all, makeRetraction(loadScopes()));
    const m = mergeD({ entries: eff.entries, canon: ctx.canon, timeline: ctx.timeline, releaseDates: ctx.releaseDates, store: ctx.store });
    fs.mkdirSync(P.merged, { recursive: true });
    const head = (kind) => ({ schema_version: 'pass2-d-merged-0.1.0', kind, run, generated_at: new Date().toISOString() });
    writeJsonAtomic(path.join(P.merged, 'D_relations.json'), { ...head('relations'), relations: m.relations });
    writeJsonAtomic(path.join(P.merged, 'D_pair_status.json'), { ...head('pair_status'), pairs: m.pairStatus, pair_merge_needed: m.pairMergeNeeded, withdrawn_pairs: [...eff.withdrawnPairs].sort(cmpStr) });
    writeJsonAtomic(path.join(P.merged, 'D_excluded_memos.json'), { ...head('excluded'), excluded: m.excluded });
    writeJsonAtomic(path.join(P.merged, 'D_merge_suggestions.json'), { ...head('merge_suggestions'), suggestions: m.merges });
    writeJsonAtomic(P.progress, { run, at: new Date().toISOString(), bundles: plan.bundles.length, merged: all.length, missing });
    const strata = m.pairStatus.reduce((acc, x) => ((acc[x.stratum] = (acc[x.stratum] ?? 0) + 1), acc), {});
    console.log(`[finish] 병합 ${all.length}/${plan.bundles.length}묶음(누락 ${missing.length}${missing.length ? `: ${missing.slice(0, 10).join(', ')}` : ''}), 관계 기록 ${m.relations.length}, 제외 메모 ${m.excluded.length}, 병합 제안 ${m.merges.length}`);
    console.log(`[finish] 쌍 상태 ${JSON.stringify(strata)}, 쌍 겹침 ${m.pairMergeNeeded.length}건(다른 묶음 ${m.pairMergeNeeded.filter((x) => x.kind === 'cross_bundle').length}), 철회된 쌍 ${eff.withdrawnPairs.size}`);
    console.log(`[finish] → ${relPath(P.merged)}/`);
    return;
  }

  if (cmd === 'audit-input') {
    const wave = Number(argValue(args, 'wave'));
    const rate = Number(argValue(args, 'rate') ?? 0.1);
    const judgeFamily = argValue(args, 'judge-family') ?? 'gemini';
    const plan = JSON.parse(fs.readFileSync(P.plan, 'utf8'));
    const ctx = makeCtx();
    const selected = selectWave(plan, wave);
    const entries = doneEntries(P, plan, ctx, wave).filter((e) => e.wave === wave);
    if (entries.length !== selected.length) throw new Error(`회차 ${wave} 묶음 중 미완료·검증 실패가 있다(${selected.length - entries.length}개)`);
    const inputPath = path.join(P.audit, `wave_${pad(wave)}_input.json`);
    const previous = readJsonIfExists(inputPath);
    const units = [];
    const linksByUnit = new Map();
    const memosByUnit = new Map();
    const overrides = [];
    const merges = [];
    const bundlePaths = new Map();
    for (const e of entries) {
      bundlePaths.set(e.bundle.bundle_id, { input_file: e.plan.input, script_file: e.bundle.script_file, output_file: e.plan.output });
      for (const u of e.bundle.units) {
        units.push({ ...u, bundle_id: e.bundle.bundle_id, excluded: e.shard.excluded_memos.filter((x) => x.unit_id === u.unit_id) });
        linksByUnit.set(`${e.bundle.bundle_id}|${u.unit_id}`, e.shard.candidate_links.filter((l) => l.unit_id === u.unit_id));
        memosByUnit.set(`${e.bundle.bundle_id}|${u.unit_id}`, e.bundle.memos.filter((m) => m.unit_id === u.unit_id).map(({ subject_ref: _s, target_ref: _t, ...m }) => m));
      }
      for (const o of e.shard.endpoint_overrides) overrides.push({ ...o, bundle_id: e.bundle.bundle_id });
      for (const m of e.shard.merge_suggestions ?? []) merges.push({ ...m, bundle_id: e.bundle.bundle_id });
    }
    const sample = sampleDAudit({ units, linksByUnit, memosByUnit, overrides, merges, rate, seed: `D/${run}/${wave}`, includeIds: previous?.items.filter((x) => x.kind === 'unit').map((x) => x.audit_id) ?? [], bundlePaths });
    const stamps = selected.map((b) => ({ bundle_id: b.bundle_id, ...currentStamp(P, b.bundle_id, loadBundle(P, b.bundle_id)) }));
    const input = { schema_version: 'pass2-audit-input-0.1.0', kind: 'D', run, wave, judge_family: judgeFamily, bundle_stamps: stamps, ...sample };
    input.source_sha256 = sha256(JSON.stringify(input));
    fs.mkdirSync(P.audit, { recursive: true });
    writeJsonAtomic(inputPath, input);
    const kinds = sample.items.reduce((acc, x) => ((acc[x.kind] = (acc[x.kind] ?? 0) + 1), acc), {});
    console.log(`[audit-input] 회차 ${wave}: 단위 표본 ${sample.sampled_units}/${sample.population_units}, 항목 ${JSON.stringify(kinds)} → ${relPath(inputPath)}`);
    for (const s of sample.strata) console.log(`  층 ${s.stratum}: 모집단 ${s.population}, 표본 ${s.sampled} (비율 ${s.rate})`);
    console.log(`[audit-input] 다른 모델의 감사 출력 → ${relPath(path.join(P.audit, `wave_${pad(wave)}_output.json`))}`);
    return;
  }

  if (cmd === 'audit-check') {
    const wave = Number(argValue(args, 'wave'));
    const plan = JSON.parse(fs.readFileSync(P.plan, 'utf8'));
    const ctx = makeCtx();
    const input = readJsonIfExists(path.join(P.audit, `wave_${pad(wave)}_input.json`));
    const out = readJsonIfExists(path.join(P.audit, `wave_${pad(wave)}_output.json`));
    if (!input || !out) throw new Error('감사 입력 또는 출력이 없다');
    const stamps = selectWave(plan, wave).map((b) => ({ bundle_id: b.bundle_id, ...currentStamp(P, b.bundle_id, loadBundle(P, b.bundle_id)) }));
    // D는 회차 간 전파가 없어 이어 인정을 두지 않는다. 회차 shard를 고치면 그 회차를 다시 감사한다(2.10절)
    const r = checkAudit(input, out, { store: ctx.store, bundleStamps: stamps, problems: D_REVIEW_PROBLEMS });
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    console.log(`${r.errors.length ? '[FAIL]' : '[PASS]'} 감사 ${r.reviewed}/${input.items.length}항목, 판정 ${JSON.stringify(r.judgments)}`);
    const reviews = Array.isArray(out.reviews) ? out.reviews : [];
    const pc = reviews.flatMap((x) => x.problems ?? []).reduce((acc, c) => ((acc[c] = (acc[c] ?? 0) + 1), acc), {});
    console.log(`[audit-check] 감사자 ${out.auditor_family ?? '?'} / ${out.auditor_model ?? '?'} / 세션 ${out.auditor_session ?? '?'}, 문제 코드 ${JSON.stringify(pc)}`);
    for (const x of reviews.filter((y) => y.judgment !== '맞음' || (y.problems ?? []).length)) {
      console.log(`  ${x.audit_id} [${x.judgment}] ${(x.problems ?? []).join(', ') || '-'}`);
      console.log(`    이유: ${x.reason ?? ''}`);
      if (x.evidence) console.log(`    근거: ${typeof x.evidence === 'string' ? x.evidence : JSON.stringify(x.evidence)}`);
    }
    if (r.errors.length) process.exitCode = 1;
    return;
  }

  console.log('사용법: build --all --run=main | build --select="D1__001,…;D1__010,…" --run=pilot | status [--wave=N] | validate <bundle_id> | append-shard <bundle_id> --from=<part.json> | cand <bundle_id> [<unit_id>] | show <scene_id> [시작 끝] | grep <낱말> --bundle= --unit= [--title=a,b] | entity <이름> | finish | audit-input --wave=N [--rate=0.1] | audit-check --wave=N  [--run=pilot|retest|main]');
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(`[pass2-d] ${e.message}`);
    process.exitCode = 1;
  });
}
