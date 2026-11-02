// Pass 1 결과 진단 (GRAPH_RAG_PASS1_DIAGNOSIS.md) — Claude 쪽 스크립트
// 사용법: node diagnose.mjs <입력 폴더> <출력 폴더>
//   입력 폴더: 문서 2절의 git archive + manifest 복사 결과
//   출력 폴더: findings.jsonl, stats.json을 쓴다. 같은 폴더의 checks.json(원문 확인 판정)이 있으면 반영한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [IN, OUT] = process.argv.slice(2);
if (!IN || !OUT) {
  console.error('Usage: node diagnose.mjs <input_dir> <out_dir>');
  process.exit(1);
}
const G = path.join(IN, 'data', 'graph');
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lib = await import(pathToFileURL(path.join(IN, 'scripts/graph/lib.mjs')).href);
const merger = await import(pathToFileURL(path.join(IN, 'scripts/graph/merge-and-index.mjs')).href);

const manifest = J(path.join(G, 'manifest.json'));
const progress = J(path.join(G, 'progress.json'));
const index = J(path.join(G, 'pass1_index.json'));
const registry = J(path.join(G, 'entity_registry.json'));
const generic = J(path.join(G, 'generic_roles.json'));
const unregDoc = J(path.join(G, 'unregistered_entity_candidates.json'));

const stats = {};
const findings = [];
const add = (f) => findings.push({
  question: f.question,
  target_key: f.target_key,
  scene_id: f.scene_id ?? null,
  batch_id: f.batch_id ?? null,
  field_path: f.field_path ?? null,
  item_id: f.item_id ?? null,
  observed: f.observed ?? {},
  verdict: f.verdict,
  reason: f.reason,
  source_checked: f.source_checked ?? [],
});

// ---------- 공통: 정규화와 이름 조회 ----------
const nfkc = (s) => String(s ?? '').normalize('NFKC').trim();
// 띄어쓰기·가운뎃점·마침표·하이픈·밑줄·따옴표 차이만 없앤다 (Q2·Q3·Q4 공통 기준)
const norm = (s) => nfkc(s).toLowerCase().replace(/[\s·・.\-_'"‘’“”`]/g, '');

// 이름 경계: 앞은 한글·영숫자가 아니고, 뒤는 끝·한글 아닌 문자·조사로 시작해야 이름으로 본다
const PARTICLE = /^(은|는|이|가|을|를|의|에|에게|에겐|에서|와|과|도|만|랑|이랑|하고|야|아|여|씨|님|양|군|언니|오빠|선배|이다|이야|이에요|예요|였|이었|한테|한텐|께|로|으로|처럼|보다|까지|부터|조차|마저|이나|나|든|이든|라고|이라고|라는|이라는|란|이란|요|들)/;
const HANGUL_OR_ALNUM = /[가-힣A-Za-z0-9]/;
const hasName = (text, name) => {
  let from = 0;
  for (;;) {
    const i = text.indexOf(name, from);
    if (i < 0) return false;
    from = i + 1;
    const before = i > 0 ? text[i - 1] : '';
    if (before && HANGUL_OR_ALNUM.test(before)) continue;
    const rest = text.slice(i + name.length);
    if (!rest || !/^[가-힣]/.test(rest) || PARTICLE.test(rest)) {
      if (/[A-Za-z0-9]$/.test(name) && /^[A-Za-z0-9]/.test(rest)) continue;
      return true;
    }
  }
};
const lookup = registry.speaker_lookup; // 라벨 → {entity_id, is_generic_role, role_category}
const entById = new Map(registry.entities.map((e) => [e.entity_id, e]));
const normToEntities = new Map(); // norm(이름) → Set(entity_id)
for (const e of registry.entities) {
  for (const n of [e.canonical_name, ...(e.surface_labels ?? [])]) {
    const k = norm(n);
    if (!k) continue;
    if (!normToEntities.has(k)) normToEntities.set(k, new Set());
    normToEntities.get(k).add(e.entity_id);
  }
}
const genericLabels = new Set(generic.role_labels ?? []);
const descriptorLabels = new Set(generic.descriptor_alias_labels ?? []);
const genericByLabel = new Map((generic.roles ?? []).map((r) => [r.label ?? r.speaker_label, r]));

// ---------- 활성 장면 적재 ----------
const shardDir = path.join(G, 'pass1', 'shards');
const shardFiles = fs.readdirSync(shardDir).filter((f) => /^batch_.*\.json$/.test(f)).sort();
const shards = new Map();
for (const f of shardFiles) {
  const d = J(path.join(shardDir, f));
  shards.set(d.batch_id || path.basename(f, '.json'), d);
}
const byTitleDir = path.join(G, 'pass1', 'by_title');
const byTitle = new Map(); // scene_id → enriched scene
let byTitleSceneTotal = 0;
for (const f of fs.readdirSync(byTitleDir).filter((x) => x.endsWith('.json'))) {
  const d = J(path.join(byTitleDir, f));
  for (const s of d.scenes) {
    byTitleSceneTotal += 1;
    byTitle.set(s.scene_id, s);
  }
}

const mScenes = manifest.scenes;
const active = []; // {scene_id, batch_id, raw, enriched, m}
const missingActive = [];
for (const [sid, m] of Object.entries(mScenes)) {
  const shard = shards.get(m.batch_id);
  const raw = shard?.scenes.find((s) => s.scene_id === sid);
  if (!raw) {
    missingActive.push(sid);
    continue;
  }
  active.push({ scene_id: sid, batch_id: m.batch_id, raw, enriched: byTitle.get(sid), m });
}

// ---------- 원문 적재 ----------
const bodyBySid = new Map();
const shaMismatch = [];
for (const file of new Set(Object.values(mScenes).map((m) => m.source_file))) {
  const text = fs.readFileSync(path.join(IN, file), 'utf8');
  for (const b of lib.parseChapterTextBlocks(text)) bodyBySid.set(b.scene_id, b);
}
for (const a of active) {
  const b = bodyBySid.get(a.scene_id);
  if (!b || b.source_sha256 !== a.m.source_sha256) shaMismatch.push(a.scene_id);
}

// =====================================================================
// Q6. 역색인과 샤드의 일치 (반영 누락 먼저: 다른 질문이 by_title을 믿어도 되는지 확인)
// =====================================================================
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const S = (v) => JSON.stringify(canon(v));

const reEnriched = [];
let byTitleDiff = 0;
for (const a of active) {
  const e = merger.enrichSceneFromManifest(a.raw, a.m, a.m.mechanical_ground_truth ?? null);
  reEnriched.push(e);
  if (!a.enriched) {
    add({ question: 'Q6', target_key: `index:by_title#${a.scene_id}`, scene_id: a.scene_id, batch_id: a.batch_id,
      observed: { by_title: 'missing' }, verdict: '오류 의심', reason: '활성 장면이 by_title에 없다' });
    byTitleDiff += 1;
  } else if (S(e) !== S(a.enriched)) {
    byTitleDiff += 1;
    add({ question: 'Q6', target_key: `index:by_title#${a.scene_id}`, scene_id: a.scene_id, batch_id: a.batch_id,
      observed: { diff: 'by_title 장면이 활성 샤드를 병합기로 다시 보강한 결과와 다르다' }, verdict: '오류 의심',
      reason: 'by_title이 활성 샤드와 맞지 않는다(옛 결과 혼입 또는 병합 후 샤드 변경)' });
  }
}
// 인덱스 재구성 비교
const mergedBatchIds = [...new Set(active.map((a) => a.batch_id))].sort();
const rebuilt = merger.buildPass1IndexAndCandidates(reEnriched, { isPilot: false, mergedBatchIds });
const idxCompare = {};
const sortEntries = (arr) => [...arr].map(S).sort();
const cmpKeyed = (name, a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let diff = 0;
  const examples = [];
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    let same;
    if (x && y && !Array.isArray(x) && typeof x === 'object' && 'present_in_scene' in x) {
      same = ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only'].every(
        (f) => S(sortEntries(x[f])) === S(sortEntries(y[f]))
      );
    } else if (Array.isArray(x) && Array.isArray(y)) {
      same = S(sortEntries(x)) === S(sortEntries(y));
    } else same = S(x) === S(y);
    if (!same) {
      diff += 1;
      if (examples.length < 20) examples.push(k);
      add({ question: 'Q6', target_key: `index:${name}[${JSON.stringify(k)}]`, observed: { in_index: x ? 'present' : 'missing', in_rebuilt: y ? 'present' : 'missing' },
        verdict: '오류 의심', reason: '활성 샤드로 다시 만든 인덱스와 다르다' });
    }
  }
  idxCompare[name] = { keys_index: Object.keys(a).length, keys_rebuilt: Object.keys(b).length, differing_keys: diff, examples };
};
for (const name of ['entities', 'relationships_by_entity', 'forms_of_address', 'clues_by_keyword', 'clues_by_category']) {
  cmpKeyed(name, index[name], rebuilt.pass1IndexDoc[name]);
}
for (const name of ['unknown_speakers', 'descriptor_speakers']) {
  const same = S(sortEntries(index[name])) === S(sortEntries(rebuilt.pass1IndexDoc[name]));
  idxCompare[name] = { len_index: index[name].length, len_rebuilt: rebuilt.pass1IndexDoc[name].length, same };
  if (!same) add({ question: 'Q6', target_key: `index:${name}`, observed: idxCompare[name], verdict: '오류 의심', reason: '활성 샤드로 다시 만든 인덱스와 다르다' });
}
{
  const a = Object.fromEntries(unregDoc.candidates.map((c) => [`${c.suggested_type}::${c.surface_text}`, c]));
  const b = Object.fromEntries(rebuilt.unregisteredCandidatesDoc.candidates.map((c) => [`${c.suggested_type}::${c.surface_text}`, c]));
  let diff = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k] || !b[k] || a[k].occurrence_count !== b[k].occurrence_count || S(sortEntries(a[k].occurrences)) !== S(sortEntries(b[k].occurrences))) {
      diff += 1;
      add({ question: 'Q6', target_key: `file:data/graph/unregistered_entity_candidates.json#${k}`, observed: { in_file: !!a[k], in_rebuilt: !!b[k] }, verdict: '오류 의심', reason: '활성 샤드로 다시 집계한 후보와 다르다' });
    }
  }
  idxCompare.unregistered_candidates = { file: Object.keys(a).length, rebuilt: Object.keys(b).length, differing: diff };
}
// 집계 수
const progressBatches = Object.entries(progress.batches);
const progressScenes = Object.entries(progress.scenes);
const counts = {
  manifest_scenes: Object.keys(mScenes).length,
  manifest_batches_listed: Array.isArray(manifest.batches) ? manifest.batches.length : null,
  manifest_distinct_scene_batch_ids: new Set(Object.values(mScenes).map((m) => m.batch_id)).size,
  shard_batch_files: shardFiles.length,
  active_scenes_found: active.length,
  active_scenes_missing: missingActive.length,
  by_title_scene_total: byTitleSceneTotal,
  by_title_distinct_scenes: byTitle.size,
  index_merged_scenes_count: index.merged_scenes_count,
  index_merged_batches_count: index.merged_batches_count,
  progress_batches_total: progressBatches.length,
  progress_batches_non_batch_prefix: progressBatches.filter(([k]) => !k.startsWith('batch_')).map(([k, v]) => ({ id: k, status: v.status, scenes: v.scene_ids?.length })),
  progress_scenes_total: progressScenes.length,
  progress_scene_status: Object.fromEntries(Object.entries(progressScenes.reduce((acc, [, v]) => ((acc[v.status] = (acc[v.status] || 0) + 1), acc), {}))),
  progress_scene_batch_mismatch: progressScenes.filter(([sid, v]) => mScenes[sid] && v.batch_id !== mScenes[sid].batch_id).length,
  progress_scene_sha_mismatch: progressScenes.filter(([sid, v]) => mScenes[sid] && v.source_sha256 !== mScenes[sid].source_sha256).length,
  raw_text_sha_mismatch: shaMismatch.length,
  by_title_vs_reenriched_diff: byTitleDiff,
  index_vs_rebuilt: idxCompare,
};
// 색인 배치 목록과 활성 배치 목록
const idxBatchSet = new Set(index.merged_batch_ids);
counts.active_batches = mergedBatchIds.length;
counts.index_batches_not_active = index.merged_batch_ids.filter((b) => !mergedBatchIds.includes(b));
counts.active_batches_not_in_index = mergedBatchIds.filter((b) => !idxBatchSet.has(b));
// 옛 결과(stale) 장면
const stale = [];
for (const [bid, d] of shards) {
  for (const s of d.scenes) {
    const m = mScenes[s.scene_id];
    if (m && m.batch_id !== bid) stale.push({ scene_id: s.scene_id, batch_id: bid, current_batch_id: m.batch_id });
    if (!m) stale.push({ scene_id: s.scene_id, batch_id: bid, current_batch_id: null });
  }
}
counts.stale_shard_scenes = stale.length;
counts.stale_examples = stale.slice(0, 10);
for (const ps of counts.progress_batches_non_batch_prefix) {
  add({ question: 'Q6', target_key: `global:progress_pilot_batch:${ps.id}`, observed: ps, verdict: '판단 보류',
    reason: 'progress.json에 파일럿 배치가 merged 상태로 남아 있다. 병합기는 batch_ 접두사만 병합하므로 인덱스에는 없다' });
}
if (progressScenes.length !== Object.keys(mScenes).length) {
  add({ question: 'Q6', target_key: 'global:scene_count', observed: { manifest: Object.keys(mScenes).length, progress: progressScenes.length }, verdict: '오류 의심', reason: '장면 수 불일치' });
}
stats.Q6_consistency = counts;

// 색인 대상 필드(병합기 buildPass1IndexAndCandidates 기준)
const INDEXED_DESC = {
  keyed: {
    entities: 'participants 네 갈래: entity_id 또는 surface:<표기>',
    relationships_by_entity: 'relationship_and_lore_notes의 subject·target 원문 표기',
    forms_of_address: 'address_term',
    clues_by_keyword: 'clues_and_hooks의 keyword',
    clues_by_category: 'clues_and_hooks의 category',
  },
  listed_unkeyed: ['unknown_speakers', 'descriptor_speakers'],
  not_indexed: ['summary', 'events_and_claims', 'participants.document_author', 'same_scene_speaker_groups', 'cross_scene_hints', 'choice_branches', 'reviewed_gaps', 'chronology_type/segments', 'is_plot_critical', 'unregistered_entity_candidates(별도 파일로만 집계)'],
};

// =====================================================================
// Q3. entity_id null 현황
// =====================================================================
const classifyNull = (label, fieldKind, entityType) => {
  const l = nfkc(label);
  if (/^\?\?\?/.test(l)) return ['정상', 'unknown_placeholder'];
  if (fieldKind === 'mentioned_only' && entityType !== 'character') return ['정상', 'non_character'];
  if (descriptorLabels.has(l)) return ['정상', 'descriptor_alias'];
  const lk = lookup[l];
  if (lk && lk.is_generic_role) return ['정상', `generic:${lk.role_category ?? 'role'}`];
  if (genericLabels.has(l)) return ['정상', 'generic:role_labels'];
  if (lk && lk.entity_id) return ['연결 누락 의심', 'exact_registry_label'];
  const ents = normToEntities.get(norm(l));
  if (ents && ents.size) return ['연결 누락 의심', 'variant_of_registry_label'];
  return ['정상', 'not_in_registry'];
};
const q3 = {};
const bump = (field, key) => {
  q3[field] = q3[field] || { denominator: 0, non_null: 0, null: 0, by_class: {} };
  q3[field][key] = (q3[field][key] || 0) + 1;
};
const labelEntityPairs = new Map(); // `${label}\t${entity}` → {count, fields, scenes:Set}
const pushPair = (label, eid, sid) => {
  const k = `${nfkc(label)}\t${eid}`;
  if (!labelEntityPairs.has(k)) labelEntityPairs.set(k, { label: nfkc(label), entity_id: eid, count: 0, scenes: new Set() });
  const p = labelEntityPairs.get(k);
  p.count += 1;
  p.scenes.add(sid);
};
const visitEntityFields = (a, cb) => {
  const s = a.enriched;
  const P = s.participants;
  P.present_in_scene.forEach((p, i) => cb('present_in_scene', `participants.present_in_scene[${i}]`, p, p.speaker_label));
  P.present_silent.forEach((p, i) => cb('present_silent', `participants.present_silent[${i}]`, p, p.name));
  P.remote_or_voice_only.forEach((p, i) => cb('remote_or_voice_only', `participants.remote_or_voice_only[${i}]`, p, p.speaker_label));
  P.mentioned_only.forEach((p, i) => cb(p.entity_type === 'character' ? 'mentioned_only(character)' : 'mentioned_only(non_character)', `participants.mentioned_only[${i}]`, p, p.surface_text, p.entity_type));
  if (P.document_author) cb('document_author', 'participants.document_author', P.document_author, P.document_author.name);
  s.unknown_speakers.forEach((u, i) => u.resolved_in_same_scene_to && cb('unknown_speakers.resolved', `unknown_speakers[${i}].resolved_in_same_scene_to`, u.resolved_in_same_scene_to, u.resolved_in_same_scene_to.surface_text));
  (s.descriptor_speakers ?? []).forEach((d, i) => d.resolved_in_same_scene_to && cb('descriptor_speakers.resolved', `descriptor_speakers[${i}].resolved_in_same_scene_to`, d.resolved_in_same_scene_to, d.resolved_in_same_scene_to.surface_text));
};
for (const a of active) {
  visitEntityFields(a, (field, fp, obj, label, etype) => {
    bump(field, 'denominator');
    if (obj.entity_id) {
      bump(field, 'non_null');
      pushPair(label ?? '', obj.entity_id, a.scene_id);
      return;
    }
    bump(field, 'null');
    const kind = field.startsWith('mentioned_only') ? 'mentioned_only' : field;
    const [verdict, cls] = classifyNull(label ?? '', kind, etype ?? (field.startsWith('mentioned_only') ? 'character' : 'character'));
    q3[field].by_class[cls] = (q3[field].by_class[cls] || 0) + 1;
    if (verdict !== '정상') {
      const ents = cls === 'exact_registry_label' ? [lookup[nfkc(label)].entity_id] : [...(normToEntities.get(norm(label)) ?? [])];
      add({ question: 'Q3', target_key: `shard:${a.scene_id}#${fp}`, scene_id: a.scene_id, batch_id: a.batch_id, field_path: fp,
        item_id: obj.item_id ?? null, observed: { label, entity_id: null, registry_match: ents, match_kind: cls }, verdict,
        reason: cls === 'exact_registry_label' ? '표기가 레지스트리 라벨과 정확히 같은데 entity_id가 null이다' : '표기가 띄어쓰기·문장부호만 다른 레지스트리 라벨이 있는데 entity_id가 null이다' });
    }
  });
}
stats.Q3_null = q3;

// =====================================================================
// Q2. 엔티티 분할·병합
// =====================================================================
// (a) entity_id에 붙은 표기가 레지스트리 이름과 다른 것
const q2 = { label_entity_mismatch_pairs: 0, surface_variant_groups: 0, registry_dup_groups: 0, surface_matches_registry: 0 };
const byEntityLabels = new Map();
for (const p of labelEntityPairs.values()) {
  const e = entById.get(p.entity_id);
  const names = e ? [e.canonical_name, ...(e.surface_labels ?? [])].map(norm) : [];
  if (names.includes(norm(p.label))) continue;
  if (!byEntityLabels.has(p.entity_id)) byEntityLabels.set(p.entity_id, []);
  byEntityLabels.get(p.entity_id).push(p);
}
for (const [eid, arr] of byEntityLabels) {
  for (const p of arr) {
    q2.label_entity_mismatch_pairs += 1;
    // 다른 등록 인물의 이름이면 오류 의심, 아니면 별명·호칭 연결로 보고 판단 보류
    const other = [...(normToEntities.get(norm(p.label)) ?? [])].filter((x) => x !== eid);
    add({ question: 'Q2', target_key: `group:${[p.label, entById.get(eid)?.canonical_name ?? eid].sort().join('|')}`,
      observed: { label: p.label, entity_id: eid, occurrences: p.count, scenes: [...p.scenes].slice(0, 10), label_is_other_registered: other },
      verdict: other.length ? '오류 의심' : '판단 보류',
      reason: other.length ? `표기가 다른 등록 인물(${other.join(', ')})의 이름인데 ${eid}에 연결됐다` : '레지스트리 이름이 아닌 표기(별명·호칭 등)가 이 엔티티에 연결됐다. 맞는 연결인지 원문 확인 필요' });
  }
}
// (b) surface: 키가 레지스트리 이름의 변형인 것 / surface 키끼리의 변형
const surfaceKeys = Object.keys(index.entities).filter((k) => k.startsWith('surface:'));
const surfNormGroups = new Map();
for (const k of surfaceKeys) {
  const label = k.slice('surface:'.length);
  const n = norm(label);
  if (!surfNormGroups.has(n)) surfNormGroups.set(n, []);
  surfNormGroups.get(n).push(label);
  const ents = normToEntities.get(n);
  if (ents && ents.size) {
    const lk = lookup[nfkc(label)];
    if (lk && lk.is_generic_role) continue;
    q2.surface_matches_registry += 1;
    const b = index.entities[k];
    const n_occ = ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only'].reduce((s, f) => s + b[f].length, 0);
    add({ question: 'Q2', target_key: `group:${[label, ...[...ents].map((e) => entById.get(e).canonical_name)].filter((v, i, x) => x.indexOf(v) === i).sort().join('|')}`,
      observed: { surface_key: k, registry_entities: [...ents], occurrences: n_occ },
      verdict: '연결 누락 의심', reason: '같은 인물이 등록 엔티티 키와 surface: 키로 나뉘어 있다(표기가 레지스트리 이름과 같거나 띄어쓰기·문장부호만 다름)' });
  }
}
for (const [n, labels] of surfNormGroups) {
  if (labels.length < 2) continue;
  q2.surface_variant_groups += 1;
  add({ question: 'Q2', target_key: `group:${[...labels].sort().join('|')}`, observed: { surface_keys: labels.map((l) => `surface:${l}`) },
    verdict: '연결 누락 의심', reason: '띄어쓰기·문장부호만 다른 surface: 키 여러 개로 흩어져 있다' });
}
// (c) 레지스트리 안 중복
const regNorm = new Map();
for (const e of registry.entities) {
  const n = norm(e.canonical_name);
  if (!regNorm.has(n)) regNorm.set(n, []);
  regNorm.get(n).push(e);
}
for (const [n, es] of regNorm) {
  if (es.length < 2) continue;
  q2.registry_dup_groups += 1;
  add({ question: 'Q2', target_key: `group:${es.map((e) => e.canonical_name).sort().join('|')}`, observed: { entities: es.map((e) => e.entity_id) },
    verdict: '판단 보류', reason: '레지스트리에 띄어쓰기·문장부호만 다른 엔티티가 여럿 있다' });
}
stats.Q2_split_merge = q2;

// =====================================================================
// Q4. 미등록 후보
// =====================================================================
const q4 = { total_candidates: unregDoc.candidates.length, by_type: {}, registered_as_candidate: 0, variant_groups: 0, same_surface_multi_type: 0,
  candidate_scene_without_participant_key: 0, candidate_occurrences: 0, top_by_frequency: [] };
const participantSurfacesByScene = new Map();
for (const a of active) {
  const set = new Set();
  const P = a.enriched.participants;
  for (const p of P.present_in_scene) set.add(norm(p.speaker_label));
  for (const p of P.present_silent) set.add(norm(p.name));
  for (const p of P.remote_or_voice_only) set.add(norm(p.speaker_label));
  for (const p of P.mentioned_only) set.add(norm(p.surface_text));
  participantSurfacesByScene.set(a.scene_id, set);
}
const candNormGroups = new Map();
const surfaceTypes = new Map();
for (const c of unregDoc.candidates) {
  q4.by_type[c.suggested_type] = (q4.by_type[c.suggested_type] || 0) + 1;
  const key = `${c.suggested_type}::${c.surface_text}`;
  const n = norm(c.surface_text);
  if (!candNormGroups.has(n)) candNormGroups.set(n, new Set());
  candNormGroups.get(n).add(c.surface_text);
  if (!surfaceTypes.has(c.surface_text)) surfaceTypes.set(c.surface_text, new Set());
  surfaceTypes.get(c.surface_text).add(c.suggested_type);
  const ents = normToEntities.get(n);
  const lk = lookup[nfkc(c.surface_text)];
  if (ents && ents.size && !(lk && lk.is_generic_role)) {
    q4.registered_as_candidate += 1;
    add({ question: 'Q4', target_key: `file:data/graph/unregistered_entity_candidates.json#${key}`, observed: { occurrence_count: c.occurrence_count, registry_entities: [...ents] },
      verdict: '연결 누락 의심', reason: '이미 등록된 인물 이름(또는 띄어쓰기·문장부호만 다른 표기)이 미등록 후보로 올라왔다' });
  }
  // 후보가 그 장면의 참여자 키(색인)에 없는 경우
  let miss = 0;
  const missScenes = [];
  for (const o of c.occurrences) {
    q4.candidate_occurrences += 1;
    const set = participantSurfacesByScene.get(o.scene_id);
    if (set && !set.has(n)) {
      miss += 1;
      if (missScenes.length < 10) missScenes.push(o.scene_id);
    }
  }
  if (miss) {
    q4.candidate_scene_without_participant_key += miss;
    if (c.suggested_type === 'character' || c.suggested_type === 'alias') {
      add({ question: 'Q4', target_key: `file:data/graph/unregistered_entity_candidates.json#${key}`, observed: { occurrence_count: c.occurrence_count, scenes_without_participant_entry: miss, examples: missScenes },
        verdict: '판단 보류', reason: '후보로 적힌 장면 중 일부에서 같은 표기가 참여자 항목(인덱스 entities 키)에 없다. 그 장면은 이 표기로 찾을 수 없다' });
    }
  }
}
for (const [n, set] of candNormGroups) {
  if (set.size < 2) continue;
  q4.variant_groups += 1;
  add({ question: 'Q4', target_key: `group:${[...set].sort().join('|')}`, observed: { surfaces: [...set] }, verdict: '연결 누락 의심',
    reason: '띄어쓰기·문장부호만 다른 표기로 후보가 나뉘어 있다' });
}
for (const [, t] of surfaceTypes) if (t.size > 1) q4.same_surface_multi_type += 1;
q4.top_by_frequency = unregDoc.candidates.slice(0, 40).map((c) => ({ key: `${c.suggested_type}::${c.surface_text}`, n: c.occurrence_count }));
stats.Q4_unregistered = q4;

// =====================================================================
// Q5. 원문에는 있는데 색인 필드에 없는 대상
// =====================================================================
// 이름 후보: 레지스트리 정식 이름 중 일반 역할이 아니고 2글자 이상. 흔한 낱말과 겹치는 이름은 STOP으로 뺀다(보고서에 목록).
const STOP = new Set(JSON.parse(fs.existsSync(path.join(OUT, 'q5_stop_names.json')) ? fs.readFileSync(path.join(OUT, 'q5_stop_names.json'), 'utf8') : '[]'));
const nameList = registry.entities
  .filter((e) => !e.is_generic_role)
  .map((e) => ({ name: nfkc(e.canonical_name), id: e.entity_id }))
  .filter((x) => [...x.name].length >= 2 && !STOP.has(x.name) && !/^\[.*\]$/.test(x.name));
nameList.sort((a, b) => b.name.length - a.name.length);
const dialogueText = (line) => {
  const t = line.trim();
  if (/^\[(SCENE|NEXT_|CHOICE_|MESSENGER_|MSG_END|OPTION_END|MSG SENDER)/.test(t)) return '';
  const opt = t.match(/^\[OPTION TEXT="([^"]*)"/);
  if (opt) return opt[1];
  const m = t.match(/^([^:\[\]]{1,40}):\s?(.*)$/);
  return m ? m[2] : t;
};
const q5 = { scenes: active.length, speaker_missing: 0, unknown_missing: 0, descriptor_missing: 0,
  name_mentions_checked: 0, name_missing_everywhere: 0, name_only_unindexed: 0, by_name: {} };
for (const a of active) {
  const s = a.enriched;
  const gt = a.m.mechanical_ground_truth;
  const P = s.participants;
  const partLabels = new Set([...P.present_in_scene.map((p) => nfkc(p.speaker_label)), ...P.remote_or_voice_only.map((p) => nfkc(p.speaker_label))]);
  for (const sp of gt.speakers ?? []) {
    if (/^\?\?\?$/.test(nfkc(sp.speaker_label))) continue; // 명세 3절: ???는 present_in_scene에 넣지 않는다
    if (!partLabels.has(nfkc(sp.speaker_label))) {
      q5.speaker_missing += 1;
      add({ question: 'Q5', target_key: `missing:${a.scene_id}#${nfkc(sp.speaker_label)}`, scene_id: a.scene_id, batch_id: a.batch_id,
        observed: { kind: 'mechanical_speaker', sources: sp.sources, first_line: sp.first_line }, verdict: '오류 의심', reason: '기계 추출 화자가 present_in_scene·remote_or_voice_only에 없다' });
    }
  }
  const unkIds = new Set(s.unknown_speakers.map((u) => u.unknown_id));
  for (const u of gt.unknowns ?? []) {
    if (!unkIds.has(u.unknown_id)) {
      q5.unknown_missing += 1;
      add({ question: 'Q5', target_key: `missing:${a.scene_id}#???@L${String(u.line).padStart(4, '0')}`, scene_id: a.scene_id, batch_id: a.batch_id,
        observed: { kind: 'unknown', unknown_id: u.unknown_id }, verdict: '오류 의심', reason: '??? 줄이 unknown_speakers에 없다' });
    }
  }
  const dsp = new Set((s.descriptor_speakers ?? []).map((d) => nfkc(d.speaker_label)));
  for (const sp of gt.speakers ?? []) {
    if (sp.is_descriptor_alias && !dsp.has(nfkc(sp.speaker_label))) {
      q5.descriptor_missing += 1;
      add({ question: 'Q5', target_key: `missing:${a.scene_id}#${nfkc(sp.speaker_label)}`, scene_id: a.scene_id, batch_id: a.batch_id,
        observed: { kind: 'descriptor' }, verdict: '오류 의심', reason: '묘사형 화자가 descriptor_speakers에 없다' });
    }
  }
  // 등록 인물 이름 언급
  const body = bodyBySid.get(a.scene_id)?.body_lines ?? [];
  const hits = new Map(); // name → [line]
  body.forEach((line, i) => {
    let text = dialogueText(line);
    if (!text) return;
    for (const { name } of nameList) {
      if (!text.includes(name) || !hasName(text, name)) continue;
      if (!hits.has(name)) hits.set(name, []);
      hits.get(name).push(i + 1);
      text = text.split(name).join('\u0000'.repeat(name.length)); // 긴 이름 안의 짧은 이름 중복 방지
    }
  });
  if (!hits.size) continue;
  const indexedEntityIds = new Set();
  const indexedSurf = new Set();
  for (const f of ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only']) {
    for (const p of P[f]) {
      if (p.entity_id) indexedEntityIds.add(p.entity_id);
      indexedSurf.add(norm(p.speaker_label ?? p.name ?? p.surface_text));
    }
  }
  for (const r of s.relationship_and_lore_notes) { indexedSurf.add(norm(r.subject)); indexedSurf.add(norm(r.target)); }
  for (const f of s.forms_of_address) indexedSurf.add(norm(f.address_term));
  for (const c of s.clues_and_hooks) indexedSurf.add(norm(c.keyword));
  const unindexedText = JSON.stringify({ summary: s.summary, eac: s.events_and_claims, doc: P.document_author, csh: s.cross_scene_hints, cb: s.choice_branches,
    unk: s.unknown_speakers, dsp: s.descriptor_speakers, foa: s.forms_of_address, clh: s.clues_and_hooks, rln: s.relationship_and_lore_notes, part: P });
  for (const [name, lines] of hits) {
    q5.name_mentions_checked += 1;
    const ids = [...(normToEntities.get(norm(name)) ?? [])];
    if (ids.some((id) => indexedEntityIds.has(id)) || indexedSurf.has(norm(name))) continue;
    const where = hasName(unindexedText, name) ? 'only_unindexed' : 'nowhere';
    if (where === 'nowhere') q5.name_missing_everywhere += 1; else q5.name_only_unindexed += 1;
    q5.by_name[name] = q5.by_name[name] || { nowhere: 0, only_unindexed: 0 };
    q5.by_name[name][where === 'nowhere' ? 'nowhere' : 'only_unindexed'] += 1;
    add({ question: 'Q5', target_key: `missing:${a.scene_id}#${name}`, scene_id: a.scene_id, batch_id: a.batch_id,
      observed: { kind: 'registered_name_mention', entity_ids: ids, lines: lines.slice(0, 10), found_in: where === 'nowhere' ? 'nowhere' : 'unindexed_fields_only' },
      verdict: '판단 보류', reason: where === 'nowhere' ? '원문 대사·지문에 나오는 등록 인물 이름이 장면 결과 어디에도 없다' : '등록 인물 이름이 색인되지 않는 필드(요약·사건 등)에만 있고 색인 필드에는 없다' });
  }
}
q5.by_name_top = Object.entries(q5.by_name).sort((x, y) => (y[1].nowhere + y[1].only_unindexed) - (x[1].nowhere + x[1].only_unindexed)).slice(0, 40);
delete q5.by_name;
stats.Q5_missing = q5;

// =====================================================================
// Q1. 화자 라벨이 다른 인물의 엔티티에 연결된 경우
// =====================================================================
// 탐지 (가) 라벨 넘김: 한 장면에서 라벨 L의 마지막 대사 직후(3줄 이내) N의 이름이 불리고 N 라벨이 처음 말한다.
//          그리고 같은 타이틀에서 그 장면 뒤로 L 라벨이 다시 안 나오거나, 그 장면 전에 N 라벨이 한 번도 안 나왔다.
// 탐지 (나) Pass 1 자유 서술에 "<등록 인물> 지휘관" / "지휘관 <등록 인물>" / "<X>의 지휘관"이 나오는데 그 타이틀에서 지휘관 라벨이 char_지휘관에 연결됨.
const squadOrgNames = new Set(unregDoc.candidates.filter((c) => c.suggested_type === 'squad' || c.suggested_type === 'organization').map((c) => c.surface_text));
// 이름 붙은 지휘관: 등록 인물 이름 + 미등록 인물 후보 중 성과 이름이 있는 것(띄어쓰기 포함). 호칭형 후보(선생님, 7호 등)는 뺀다
const personNames = [...new Set([...nameList.map((x) => x.name), ...unregDoc.candidates.filter((c) => c.suggested_type === 'character' && /\S \S/.test(nfkc(c.surface_text))).map((c) => nfkc(c.surface_text))])].filter((n) => n !== '지휘관' && [...n].length >= 2);
const q1 = { handoff_candidates: 0, commander_text_candidates: 0, titles_flagged: [] };
const titleScenes = new Map();
for (const a of active) {
  if (!titleScenes.has(a.m.title_id)) titleScenes.set(a.m.title_id, []);
  titleScenes.get(a.m.title_id).push(a);
}
const sceneOrder = (a) => a.m.scene_order ?? 0;
const titleFlags = new Map();
const flag = (tid, entry) => {
  if (!titleFlags.has(tid)) titleFlags.set(tid, []);
  titleFlags.get(tid).push(entry);
};
for (const [tid, list] of titleScenes) {
  // 원문 파일 안 순서로 정렬
  const fileOrder = new Map();
  const blocks = [...bodyBySid.keys()];
  blocks.forEach((sid, i) => fileOrder.set(sid, i));
  list.sort((x, y) => (fileOrder.get(x.scene_id) ?? 0) - (fileOrder.get(y.scene_id) ?? 0));
  const labelScenes = new Map(); // label → [scene index]
  list.forEach((a, i) => {
    for (const lab of new Set(Object.values(a.m.mechanical_ground_truth.line_speaker ?? {}))) {
      if (!labelScenes.has(lab)) labelScenes.set(lab, []);
      labelScenes.get(lab).push(i);
    }
  });
  list.forEach((a, si) => {
    const ls = a.m.mechanical_ground_truth.line_speaker ?? {};
    const first = new Map();
    const last = new Map();
    for (const [ln, lab] of Object.entries(ls)) {
      const n = Number(ln);
      if (!first.has(lab) || n < first.get(lab)) first.set(lab, n);
      if (!last.has(lab) || n > last.get(lab)) last.set(lab, n);
    }
    const body = bodyBySid.get(a.scene_id)?.body_lines ?? [];
    for (const [L, lastL] of last) {
      const lkL = lookup[nfkc(L)];
      if (!lkL || !lkL.entity_id) continue;
      for (const [N, firstN] of first) {
        if (N === L || firstN <= lastL || firstN - lastL > 3) continue;
        const lkN = lookup[nfkc(N)];
        if (!lkN || !lkN.entity_id || lkN.entity_id === lkL.entity_id) continue;
        const between = body.slice(lastL, firstN - 1).join('\n');
        if (!between.includes(N)) continue;
        const scenesL = labelScenes.get(L) ?? [];
        const scenesN = labelScenes.get(N) ?? [];
        const lAfter = scenesL.some((i) => i > si);
        const nBefore = scenesN.some((i) => i < si);
        if (lAfter && nBefore) continue;
        q1.handoff_candidates += 1;
        flag(tid, { kind: 'handoff', scene_id: a.scene_id, batch_id: a.batch_id, L, N, entity_L: lkL.entity_id, lastL, firstN, L_scene_count: scenesL.length, L_after: lAfter, N_before: nBefore });
      }
    }
  });
  // (나) 다른 집단의 지휘관, 이름 붙은 지휘관
  const cmdMapped = list.filter((a) => a.enriched.participants.present_in_scene.some((p) => nfkc(p.speaker_label) === '지휘관' && p.entity_id === 'char_지휘관'));
  if (cmdMapped.length) {
    const pats = [];
    for (const a of list) {
      const text = [a.enriched.summary, ...a.enriched.events_and_claims.map((x) => x.summary), ...a.enriched.relationship_and_lore_notes.map((x) => x.relation_or_change), ...a.enriched.clues_and_hooks.map((x) => x.detail)].join('\n');
      for (const m of text.matchAll(/([가-힣A-Za-z0-9.]+(?: 스쿼드| 별동대| 부대)?)의 지휘관/g)) {
        const owner = m[1];
        if (/^(카운터스|방주|중앙 정부|중앙정부)/.test(owner)) continue;
        if (!(squadOrgNames.has(owner) || /(스쿼드|별동대|부대|소대|중대|대대)$/.test(owner))) continue;
        pats.push({ scene_id: a.scene_id, text: m[0] });
      }
      for (const name of personNames) {
        if (hasName(text, `${name} 지휘관`) || text.includes(`지휘관 ${name}`) || text.includes(`지휘관(${name})`)) pats.push({ scene_id: a.scene_id, text: `${name} 지휘관` });
      }
    }
    if (pats.length) {
      q1.commander_text_candidates += 1;
      flag(tid, { kind: 'commander_text', mapped_scenes: cmdMapped.length, patterns: pats.slice(0, 12), pattern_count: pats.length });
    }
  }
}
for (const [tid, entries] of titleFlags) {
  const handoffs = entries.filter((e) => e.kind === 'handoff');
  const strong = handoffs.filter((h) => !h.L_after && !h.N_before);
  const texts = entries.filter((e) => e.kind === 'commander_text');
  q1.titles_flagged.push({ title_id: tid, handoffs: handoffs.length, strong_handoffs: strong.length, commander_text: texts.length ? texts[0].pattern_count : 0 });
  // 강한 넘김(그 장면 뒤로 L 라벨이 안 나오고, 그 장면 전에 N 라벨이 안 나옴)만 판정 줄을 만든다
  for (const h of strong) {
    for (const a of titleScenes.get(tid)) {
      a.enriched.participants.present_in_scene.forEach((p, i) => {
        if (nfkc(p.speaker_label) !== h.L || p.entity_id !== h.entity_L) return;
        add({ question: 'Q1', target_key: `shard:${a.scene_id}#participants.present_in_scene[${i}]`, scene_id: a.scene_id, batch_id: a.batch_id,
          field_path: `participants.present_in_scene[${i}]`, item_id: p.item_id,
          observed: { speaker_label: p.speaker_label, entity_id: p.entity_id, signal: 'handoff', handoff_scene: h.scene_id, handoff_to: h.N, lines: [h.lastL, h.firstN] },
          verdict: '판단 보류', reason: `같은 타이틀의 ${h.scene_id}에서 ${h.L} 라벨의 마지막 대사 직후 ${h.N}의 이름이 불리고 ${h.N} 라벨로 바뀐다. 그 뒤로 ${h.L} 라벨은 안 나온다. ${h.L} 라벨이 이 타이틀에서 ${h.N}을 가리켰을 수 있다` });
      });
    }
  }
  for (const t of texts) {
    for (const a of titleScenes.get(tid)) {
      a.enriched.participants.present_in_scene.forEach((p, i) => {
        if (nfkc(p.speaker_label) !== '지휘관' || p.entity_id !== 'char_지휘관') return;
        const key = `shard:${a.scene_id}#participants.present_in_scene[${i}]`;
        if (findings.some((f) => f.question === 'Q1' && f.target_key === key)) return;
        add({ question: 'Q1', target_key: key, scene_id: a.scene_id, batch_id: a.batch_id, field_path: `participants.present_in_scene[${i}]`, item_id: p.item_id,
          observed: { speaker_label: p.speaker_label, entity_id: p.entity_id, signal: 'commander_text', patterns: t.patterns.slice(0, 5) },
          verdict: '판단 보류', reason: 'Pass 1 서술에 다른 스쿼드·조직의 지휘관이나 이름 붙은 지휘관이 나오는 타이틀에서 지휘관 라벨이 주인공에 연결됐다' });
      });
    }
  }
}
// 탐지 (다) 선택지 화자 규칙: 시점 인물이 지휘관이 아닌 화자 라벨 없는 장면(document_author 있음)에서
//          지휘관의 출처가 선택지(option)뿐인데 지휘관이 참여자로 연결된 것. 기계 추출은 OPTION 줄을 지휘관 대사로 본다(명세 1.5 (e)).
q1.option_pov_scenes = 0;
for (const a of active) {
  const P = a.enriched.participants;
  const author = P.document_author?.name ? nfkc(P.document_author.name) : null;
  if (!author || author === '지휘관') continue;
  const sp = (a.m.mechanical_ground_truth.speakers ?? []).find((x) => nfkc(x.speaker_label) === '지휘관');
  if (!sp || sp.sources.length !== 1 || sp.sources[0] !== 'option') continue;
  for (const f of ['present_in_scene', 'remote_or_voice_only']) {
    P[f].forEach((p, i) => {
      if (nfkc(p.speaker_label) !== '지휘관') return;
      q1.option_pov_scenes += 1;
      const key = `shard:${a.scene_id}#participants.${f}[${i}]`;
      if (findings.some((x) => x.question === 'Q1' && x.target_key === key)) return;
      add({ question: 'Q1', target_key: key, scene_id: a.scene_id, batch_id: a.batch_id, field_path: `participants.${f}[${i}]`, item_id: p.item_id,
        observed: { speaker_label: p.speaker_label, entity_id: p.entity_id, signal: 'option_pov', document_author: author },
        verdict: '판단 보류', reason: `시점 인물이 ${author}인 텍스트 어드벤처 장면에서 지휘관의 근거가 선택지뿐이다. 선택지는 시점 인물의 선택일 수 있는데 기계 추출 규칙이 지휘관 대사로 보아 ${p.entity_id}에 연결됐다` });
    });
  }
}
q1.titles_flagged.sort((x, y) => y.handoffs - x.handoffs || y.commander_text - x.commander_text);
q1.handoff_list = [...titleFlags.values()].flat().filter((e) => e.kind === 'handoff');
stats.Q1_label_entity = q1;

// =====================================================================
// Q6 (설계상 사각지대) 집계와 Q7
// =====================================================================
{
  const blind = { scenes: active.length, events_and_claims: 0, events_actor_registered: 0, events_actor_registered_not_in_scene_keys: 0,
    document_author_nonnull: 0, document_author_not_in_participants: 0, cross_scene_hints: 0, choice_branches: 0, same_scene_speaker_groups: 0,
    relationship_keys: 0, relationship_keys_registry_name: 0, relationship_keys_matching_entity_bucket_label: 0, relationship_keys_other: 0,
    forms_of_address_entries: 0, foa_target_registered: 0 };
  const bucketLabels = new Set(Object.values(index.entities).map((b) => norm(b.canonical_or_surface)));
  for (const k of Object.keys(index.relationships_by_entity)) {
    blind.relationship_keys += 1;
    if (normToEntities.has(norm(k))) blind.relationship_keys_registry_name += 1;
    else if (bucketLabels.has(norm(k))) blind.relationship_keys_matching_entity_bucket_label += 1;
    else blind.relationship_keys_other += 1;
  }
  for (const a of active) {
    const s = a.enriched;
    const P = s.participants;
    const keys = new Set();
    for (const f of ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only']) for (const p of P[f]) { if (p.entity_id) keys.add(p.entity_id); keys.add(norm(p.speaker_label ?? p.name ?? p.surface_text)); }
    blind.events_and_claims += s.events_and_claims.length;
    for (const e of s.events_and_claims) {
      const ids = normToEntities.get(norm(e.actor_or_speaker));
      if (!ids) continue;
      blind.events_actor_registered += 1;
      if (![...ids].some((id) => keys.has(id)) && !keys.has(norm(e.actor_or_speaker))) blind.events_actor_registered_not_in_scene_keys += 1;
    }
    if (P.document_author) {
      blind.document_author_nonnull += 1;
      if (P.document_author.name && !keys.has(norm(P.document_author.name)) && !(P.document_author.entity_id && keys.has(P.document_author.entity_id))) blind.document_author_not_in_participants += 1;
    }
    blind.cross_scene_hints += s.cross_scene_hints.length;
    blind.choice_branches += s.choice_branches.length;
    blind.same_scene_speaker_groups += s.same_scene_speaker_groups.length;
    for (const f of s.forms_of_address) { blind.forms_of_address_entries += 1; if (normToEntities.has(norm(f.to_target))) blind.foa_target_registered += 1; }
  }
  stats.Q6_blind_spots = blind;
  const g = (k, observed, reason) => add({ question: 'Q6', target_key: `global:${k}`, observed, verdict: '판단 보류', reason });
  g('unindexed_field:events_and_claims', { items: blind.events_and_claims, actor_registered: blind.events_actor_registered, actor_registered_not_in_scene_keys: blind.events_actor_registered_not_in_scene_keys },
    'events_and_claims는 색인되지 않는다. 사건의 행위자·화자가 등록 인물인데 그 장면의 참여자 키에 없으면 인덱스로는 그 사건을 찾을 수 없다');
  g('unindexed_field:document_author', { nonnull: blind.document_author_nonnull, author_not_in_participants: blind.document_author_not_in_participants },
    'document_author는 색인되지 않는다. 기록물·텍스트 어드벤처의 작성자·시점 인물이 참여자에 따로 없으면 인덱스로 찾을 수 없다');
  g('relationship_keys_surface_only', { keys: blind.relationship_keys, registry_name: blind.relationship_keys_registry_name, matches_entity_bucket_label: blind.relationship_keys_matching_entity_bucket_label, other: blind.relationship_keys_other },
    'relationships_by_entity는 entity_id가 아니라 subject·target 원문 표기로 색인된다. 엔티티 키(char_...)로 찾으면 관계 메모가 나오지 않고, 표기가 다르면(별명·호칭) 같은 인물의 관계가 여러 키로 흩어진다');
  g('unindexed_field:forms_of_address_speakers', { entries: blind.forms_of_address_entries, to_target_registered: blind.foa_target_registered },
    'forms_of_address는 address_term으로만 색인된다. 누가 누구를 불렀는지(from_speaker·to_target)로는 찾을 수 없다');
  g('unindexed_field:cross_scene_hints', { items: blind.cross_scene_hints }, 'cross_scene_hints는 색인되지 않는다(명세상 Pass 2 힌트용)');
}
add({ question: 'Q7', target_key: 'global:option_speaker_rule_in_pov_text_adventure', observed: { option_pov_entries: q1.option_pov_scenes },
  verdict: '판단 보류', reason: '기계 추출이 OPTION 줄을 언제나 지휘관 대사로 본다(명세 1.5 (e)). 시점 인물이 지휘관이 아닌 텍스트 어드벤처(WHITE MEMORY, FADING AFFECTION)에서는 시점 인물의 선택이 지휘관 발화로 기록되고, 검증기 2항 때문에 지휘관이 참여자로 들어간다. Q1 (다)의 근본 원인이다' });
{
  const groupLike = registry.entities.filter((e) => e.scene_count <= 2 && unregDoc.candidates.some((c) => c.suggested_type !== 'character' && c.suggested_type !== 'alias' && norm(c.surface_text) === norm(e.canonical_name)));
  add({ question: 'Q7', target_key: 'global:registry_character_vs_non_character_mentions', observed: { entities: groupLike.map((e) => e.entity_id) },
    verdict: '판단 보류', reason: '레지스트리는 화자 라벨로 만들어져 집단·사물 라벨(정의 괴도단, 아웃로, 물거품 등)도 character로 등록돼 있다. 다른 장면에서 같은 이름이 조직·세력·물건으로 언급되면 명세 2.3의 27항대로 null이 되어 char_ 키와 surface: 키로 갈라진다' });
}
// =====================================================================
// 원문 확인 판정(checks.json) 반영과 출력
// =====================================================================
const checksPath = path.join(OUT, 'checks.json');
const checks = fs.existsSync(checksPath) ? J(checksPath) : [];
const applied = [];
for (const c of checks) {
  const matchOk = (f) => !c.match || Object.entries(c.match).every(([k, v]) => (k === 'scene_id' ? f.scene_id : f.observed?.[k]) === v);
  const targets = findings.filter((f) => f.question === c.question && matchOk(f) &&
    (c.target_key ? f.target_key === c.target_key : c.target_prefix ? f.target_key.startsWith(c.target_prefix) : !!c.match));
  if (!targets.length && c.add) {
    add({ ...c.add, question: c.question, verdict: c.verdict, reason: c.reason, source_checked: c.source_checked });
    applied.push({ key: c.target_key, n: 1, added: true });
    continue;
  }
  for (const f of targets) {
    f.verdict = c.verdict;
    f.reason = c.reason;
    f.source_checked = c.source_checked;
  }
  applied.push({ key: c.target_key ?? c.target_prefix ?? JSON.stringify(c.match), n: targets.length });
  if (!targets.length) console.error('check matched nothing:', JSON.stringify(c).slice(0, 160));
}
stats.checks_applied = applied;
stats.indexed_fields = INDEXED_DESC;
const byQ = {};
for (const f of findings) {
  byQ[f.question] = byQ[f.question] || {};
  byQ[f.question][f.verdict] = (byQ[f.question][f.verdict] || 0) + 1;
}
stats.findings_by_question = byQ;
stats.source_checked_by_question = Object.fromEntries(Object.keys(byQ).map((q) => [q, findings.filter((f) => f.question === q && f.source_checked.length).length]));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'findings.jsonl'), findings.map((f) => JSON.stringify(f)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ findings: findings.length, byQ, source_checked: stats.source_checked_by_question }, null, 1));
