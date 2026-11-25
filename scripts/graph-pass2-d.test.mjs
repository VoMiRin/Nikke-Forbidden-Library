// Pass 2 D 도구 시험. 8절 구현 조건(8.1·8.2·8.3)을 통과·실패 사례 짝으로 고정한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_DATA_DIR } from './graph/lib.mjs';
import { SceneStore, loadRegistry, readJsonIfExists } from './graph/pass2-lib.mjs';
import { makeRetraction } from './graph/increment-scope.mjs';
import {
  appendPart,
  effectiveDEntries,
  evidenceScenesOf,
  makeCanon,
  memosExclusive,
  mergeRanges,
  packUnits,
  pairKeyOf,
  parseCsv,
  routeGraphOf,
  timelineOfScenes,
  unitStratum,
  validateDShard,
} from './graph/pass2-d.mjs';

const store = new SceneStore();
const routes = routeGraphOf(store);
const timeline = timelineOfScenes(parseCsv(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'world_history_order.csv'), 'utf8')), store);
const canon = makeCanon({ registry: loadRegistry(), official: readJsonIfExists(path.join(GRAPH_DATA_DIR, 'pass2', 'entities.json')) ?? {}, terms: readJsonIfExists(path.join(GRAPH_DATA_DIR, 'pass2', 'terms.json'))?.terms ?? [], userMerges: readJsonIfExists(path.join(GRAPH_DATA_DIR, 'pass2', 'user_entity_merges.json')) ?? {} });
const ctx = { store, canon, timeline, routes };
const line = (sid, n) => store.lines(sid)[n];
const ev = (sid, a, b = a) => ({ scene_id: sid, line_start: a, line_end: b, quote: store.lines(sid).slice(a, b + 1).join('\n') });
const codes = (r) => r.errors.map((e) => e.code);

test('경로: 병렬 표시라도 한 경로에서 이어지면 배타가 아니고, 재시작 간선으로만 이어지는 결말끼리는 배타다(8.2-3·8.3)', () => {
  assert.equal(routes.scenesExclusive('fading_affection_1212', 'fading_affection_1211'), false);
  assert.equal(routes.scenesExclusive('fading_affection_7101', 'fading_affection_8101'), true);
  assert.equal(routes.scenesExclusive('2x2_love_1ch_03', '2x2_love_1ch_04'), true);
  // 경로 그래프 없는 선형 이야기는 장면 사이 배타 검사를 하지 않는다
  assert.equal(routes.scenesExclusive('main_14_14', 'main_14_17'), false);
});

test('배타 메모: 같은 장면 같은 선택지의 다른 옵션, 다른 루트 장면(G2)', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'pass1', 'by_title', 'event_stories__2x2_love_1ch.json'), 'utf8'));
  const memo = (id) => {
    for (const s of doc.scenes) for (const r of s.relationship_and_lore_notes ?? []) if (r.item_id === id) return { ...r, scene_id: s.scene_id };
    throw new Error(id);
  };
  assert.equal(memosExclusive(memo('2x2_love_1ch_06__rln_003'), memo('2x2_love_1ch_06__rln_004'), routes), true);
  assert.equal(memosExclusive(memo('2x2_love_1ch_06__rln_002'), memo('2x2_love_1ch_06__rln_003'), routes), false);
  assert.equal(memosExclusive(memo('2x2_love_1ch_03__rln_002'), memo('2x2_love_1ch_04__rln_005'), routes), true);
});

// ── 14장 지휘관–마리안 고정 묶음 ──
const A = 'entity:char_지휘관';
const B = 'entity:char_마리안';
const memoRec = (item_id, scene_id, ls, le, extra = {}) => ({ item_id, unit_id: 'U001', scene_id, subject: '지휘관', target: '마리안', subject_node: A, target_node: B, subject_resolved_by: 'participants', target_resolved_by: 'participants', relation_or_change: 'x', epistemic_type: 'character_claim', claimant: '지휘관', claim_line: ls, line_start: ls, line_end: le, refers_to_past: false, chronology_type: 'present', in_branch_option: null, history_order: 310, ...extra });
const bundle = {
  bundle_id: 'D1__900',
  units: [{ unit_id: 'U001', pair_key: pairKeyOf(A, B), node_a: { key: A, ref: canon.entityNode('char_지휘관').ref }, node_b: { key: B, ref: canon.entityNode('char_마리안').ref }, memo_ids: ['main_14_14__rln_005', 'main_14_17__rln_003', 'main_14_17__rln_004'] }],
  memos: [
    memoRec('main_14_14__rln_005', 'main_14_14', 69, 82),
    memoRec('main_14_17__rln_003', 'main_14_17', 32, 32, { refers_to_past: true }),
    memoRec('main_14_17__rln_004', 'main_14_17', 34, 34),
  ],
};
const ref = (k) => (k === A ? canon.entityNode('char_지휘관').ref : canon.entityNode('char_마리안').ref);
const link = (n, memoIds, evs, extra = {}) => ({ link_id: `D1__900__${String(n).padStart(3, '0')}`, unit_id: 'U001', link_type: 'relation', subject: [ref(A)], target: [ref(B)], bidirectional: false, relation_type: 'affinity_or_trust', epistemic_status: 'claimed', claimants: [ref(A)], context_scope: 'canon', temporal_anchor: 'scene_present', anchor: null, progression: 'initial', prev_link_ids: [], order_basis: 'not_applicable', memo_ids: memoIds, confidence: '유력한 해석', rationale: '상태: x / 선후·근거: y', supporting_evidence: evs, contradicting_evidence: [], search_hints: [], ...extra });
const shardWith = (links) => ({ schema_version: 'pass2-0.1.0', bundle_id: 'D1__900', endpoint_overrides: [], candidate_links: links, excluded_memos: [], merge_suggestions: [] });

test('검증기: 고정 묶음 기본형은 통과', () => {
  const r = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)], { temporal_anchor: 'past_before_scene', anchor: { kind: 'timeline', scene_id: 'main_14_14', evidence: [ev('main_14_14', 69, 72)] }, progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
  ]), bundle, ctx);
  assert.deepEqual(codes(r), []);
});

test('anchor: 같은 연표 단위(310) 안에서는 장면 순서로 앞선 anchor만 통과, 발화 뒤 장면은 실패(8.2-4)', () => {
  const base = (anchorScene) => validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)], { temporal_anchor: 'past_before_scene', anchor: { kind: 'timeline', scene_id: anchorScene, evidence: [ev(anchorScene, 1, 1)] }, progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)]),
  ]), bundle, ctx);
  assert.deepEqual(codes(base('main_14_14')).filter((c) => c === 'ANCHOR_REQUIRED'), []);
  assert.ok(codes(base('main_14_18')).includes('ANCHOR_REQUIRED'));
  // 과거 기록(past_before_scene)을 anchor 없이 순서에 쓰면 실패
  const r = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)], { temporal_anchor: 'past_before_scene', progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)]),
  ]), bundle, ctx);
  assert.ok(codes(r).includes('ANCHOR_REQUIRED'));
  // 회고 메모가 있어도 scene_present로 적었으면 anchor 없이 이을 수 있고 경고만 난다(파일럿 1회차 감사)
  const r2 = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)], { progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)]),
  ]), bundle, ctx);
  assert.ok(!codes(r2).includes('ANCHOR_REQUIRED'));
  assert.ok(r2.warnings.some((w) => w.code === 'PAST_MEMO_IN_PRESENT'));
});

test('같은 장면 줄 순서: 앞 기록 줄이 뒤 기록보다 늦으면 경고(파일럿 1회차)', () => {
  const mk = (first, second) => validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, [first], [ev('main_14_17', first.endsWith('3') ? 32 : 34)], { progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
    link(3, [second], [ev('main_14_17', second.endsWith('3') ? 32 : 34)], { progression: 'continues', prev_link_ids: ['D1__900__002'], order_basis: 'script' }),
  ]), bundle, ctx);
  const has = (r) => r.warnings.some((w) => w.code === 'SAME_SCENE_LINE_REVERSED');
  assert.ok(has(mk('main_14_17__rln_004', 'main_14_17__rln_003')));
  assert.ok(!has(mk('main_14_17__rln_003', 'main_14_17__rln_004')));
});

test('연표: 같은 연표 단위 기록 둘을 official_timeline만으로 310→310 잇는 것은 실패(8.3)', () => {
  const r = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)]),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { progression: 'changes_from', prev_link_ids: ['D1__900__001'], order_basis: 'official_timeline' }),
  ]), bundle, ctx);
  assert.ok(codes(r).includes('ORDER_BASIS_INVALID'));
});

test('검증기: 메모 누락·이중 기재, 화자, rationale 형식, 순환, changes_from 근거', () => {
  const r1 = validateDShard(shardWith([link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)])]), bundle, ctx);
  assert.ok(codes(r1).includes('MEMO_NOT_COVERED'));
  const s2 = shardWith([link(1, ['main_14_14__rln_005', 'main_14_17__rln_003', 'main_14_17__rln_004'], [ev('main_14_14', 69, 72)], { epistemic_status: 'established' })]);
  s2.excluded_memos = [{ unit_id: 'U001', item_id: 'main_14_17__rln_004', reason: '일회성 행동', note: 'n' }];
  const c2 = codes(validateDShard(s2, bundle, ctx));
  assert.ok(c2.includes('MEMO_CONFLICT'));
  assert.ok(c2.includes('CLAIMANT_REQUIRED'));
  const s3 = shardWith([link(1, ['main_14_14__rln_005', 'main_14_17__rln_003', 'main_14_17__rln_004'], [ev('main_14_14', 69, 72)], { rationale: '그냥 좋아함', progression: 'changes_from', prev_link_ids: ['D1__900__001'], order_basis: 'unknown' })]);
  const c3 = codes(validateDShard(s3, bundle, ctx));
  assert.ok(c3.includes('RATIONALE_FORM'));
  assert.ok(c3.includes('ORDER_BASIS_INVALID'));
  assert.ok(c3.includes('PROGRESSION_AND_PREV')); // 자기 자신을 가리키는 순환
  const s4 = shardWith([link(1, ['main_14_14__rln_005', 'main_14_17__rln_003', 'main_14_17__rln_004'], [ev('main_14_14', 69, 72)], { verdict: '관계 성립' })]);
  assert.ok(codes(validateDShard(s4, bundle, ctx)).includes('FORBIDDEN_FIELD'));
});

test('끝점 보정: 메모 단위, from은 원래 끝점, 보정 뒤 쌍과 기록 끝점이 맞아야 한다(G1)', () => {
  const ov = (extra) => ({ unit_id: 'U001', memo_ids: ['main_14_17__rln_004'], side: 'target', from: ref(B), to: canon.entityNode('char_라피').ref, confidence: '가능성', rationale: 'r', supporting_evidence: [ev('main_14_17', 34)], ...extra });
  const s = shardWith([
    link(1, ['main_14_14__rln_005', 'main_14_17__rln_003'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { target: [canon.entityNode('char_라피').ref] }),
  ]);
  s.endpoint_overrides = [ov({})];
  assert.deepEqual(codes(validateDShard(s, bundle, ctx)), []);
  s.endpoint_overrides = [ov({ from: canon.entityNode('char_라피').ref })];
  assert.ok(codes(validateDShard(s, bundle, ctx)).includes('ENDPOINT_OVERRIDE_INVALID'));
  s.endpoint_overrides = [];
  assert.ok(codes(validateDShard(s, bundle, ctx)).includes('ENDPOINT_MISMATCH'));
});

test('철회: 묶음 base_increment보다 뒤 증분이 바꾼 장면만 철회한다. 기준 없음(inc_001 이전)이면 철회(8.1-1)', () => {
  const retraction = makeRetraction([{ increment_id: 'inc_001', changed_scenes: [{ scene_id: 'toy_shop_04' }, { scene_id: 'toy_shop_11' }], deleted_scenes: [] }]);
  const mk = (base) => ({ wave: 1, bundle: { bundle_id: 'D1__001', base_increment: base, units: [{ unit_id: 'U001', pair_key: 'a || b', memo_ids: ['toy_shop_04__rln_001', 'x_00__rln_001'] }], memos: [{ item_id: 'toy_shop_04__rln_001', unit_id: 'U001', scene_id: 'toy_shop_04' }, { item_id: 'x_00__rln_001', unit_id: 'U001', scene_id: 'x_00' }] }, shard: { candidate_links: [{ link_id: 'D1__001__001', unit_id: 'U001', memo_ids: ['toy_shop_04__rln_001', 'x_00__rln_001'] }], excluded_memos: [], endpoint_overrides: [] } });
  const live = effectiveDEntries([mk('inc_001')], retraction).entries[0];
  assert.deepEqual(live.shard.candidate_links[0].memo_ids, ['toy_shop_04__rln_001', 'x_00__rln_001']);
  const old = effectiveDEntries([mk(null)], retraction).entries[0];
  assert.deepEqual(old.shard.candidate_links[0].memo_ids, ['x_00__rln_001']);
  // 유효 메모 0건이 된 쌍은 쌍째 철회
  const only = mk(null);
  only.bundle.units[0].memo_ids = ['toy_shop_04__rln_001'];
  only.bundle.memos = only.bundle.memos.slice(0, 1);
  only.shard.candidate_links[0].memo_ids = ['toy_shop_04__rln_001'];
  const w = effectiveDEntries([only], retraction);
  assert.deepEqual([...w.withdrawnPairs], ['a || b']);
});

test('새 주인: 같은 쌍을 뒤 회차 묶음이 맡으면 앞 묶음의 그 단위는 빠진다(회차 순서)', () => {
  const e = (id, wave) => ({ wave, bundle: { bundle_id: id, base_increment: 'inc_001', units: [{ unit_id: 'U001', pair_key: 'a || b', memo_ids: ['m1'] }], memos: [{ item_id: 'm1', unit_id: 'U001', scene_id: 'x_00' }] }, shard: { candidate_links: [{ link_id: `${id}__001`, unit_id: 'U001', memo_ids: ['m1'] }], excluded_memos: [], endpoint_overrides: [] } });
  const r = effectiveDEntries([e('D1__001', 1), e('DR1__001', 12)], null);
  assert.equal(r.entries.find((x) => x.bundle.bundle_id === 'D1__001').shard.candidate_links.length, 0);
  assert.equal(r.entries.find((x) => x.bundle.bundle_id === 'DR1__001').shard.candidate_links.length, 1);
});

test('evidence_scenes: 반박 근거·anchor 장면·anchor 인용 장면을 모두 넣는다(8.2-5)', () => {
  assert.deepEqual(evidenceScenesOf({ supporting_evidence: [{ scene_id: 's1' }], contradicting_evidence: [{ scene_id: 's2' }], anchor: { scene_id: 's3', evidence: [{ scene_id: 's4' }] } }), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(evidenceScenesOf({ supporting_evidence: [{ scene_id: 's1' }], contradicting_evidence: [] }), ['s1']);
});

test('패킹: 큰 쌍은 단독, 메모 1건 쌍은 따로, 상한을 넘기지 않는다', () => {
  const u = (k, memo_count, chars, order) => ({ pair_key: k, memo_count, chars, order });
  const b = packUnits([u('big', 200, 60000, 1), u('a', 3, 1000, 2), u('b', 2, 1000, 3), u('s1', 1, 300, 4), u('s2', 1, 300, 5)], { maxUnits: 25, maxUnitsSingle: 35, maxMemos: 70, maxChars: 30000 });
  assert.deepEqual(b.map((x) => x.units.map((y) => y.pair_key)), [['big'], ['a', 'b'], ['s1', 's2']]);
  assert.equal(b[0].solo, true);
  assert.deepEqual(mergeRanges([[10, 12], [14, 15], [40, 40]], 2, 100), [[8, 17], [38, 42]]);
});

test('append-shard: 임시 link_id를 이어지는 번호로 바꾸고 prev_link_ids도 고친다', () => {
  const b = { bundle_id: 'D1__900', memos: [{ item_id: 'm1' }, { item_id: 'm2' }, { item_id: 'm3' }] };
  const r1 = appendPart(null, { candidate_links: [{ link_id: 'P1', memo_ids: ['m1'], prev_link_ids: [] }, { link_id: 'P2', memo_ids: ['m2'], prev_link_ids: ['P1'] }] }, b);
  assert.deepEqual(r1.shard.candidate_links.map((l) => l.link_id), ['D1__900__001', 'D1__900__002']);
  assert.deepEqual(r1.shard.candidate_links[1].prev_link_ids, ['D1__900__001']);
  assert.deepEqual(r1.remaining, ['m3']);
  const r2 = appendPart(r1.shard, { candidate_links: [{ link_id: 'P1', memo_ids: ['m3'], prev_link_ids: ['D1__900__002'] }] }, b);
  assert.equal(r2.shard.candidate_links[2].link_id, 'D1__900__003');
  assert.deepEqual(r2.remaining, []);
});

test('감사 층: 전부 제외·변화 있음·여러 메모 유지·메모 1건', () => {
  assert.equal(unitStratum({ memo_ids: ['a', 'b'] }, []), 'all_excluded');
  assert.equal(unitStratum({ memo_ids: ['a', 'b'] }, [{ progression: 'initial' }, { progression: 'changes_from' }]), 'has_change');
  assert.equal(unitStratum({ memo_ids: ['a', 'b'] }, [{ progression: 'continues' }]), 'multi_steady');
  assert.equal(unitStratum({ memo_ids: ['a'] }, [{ progression: 'initial' }]), 'single_memo');
});

test('연표: 14장 장면은 history_order 310, 공식 ID 정규화는 user_entity_merges를 따른다', () => {
  assert.equal(timeline.get('main_14_14').history_order, 310);
  assert.equal(timeline.get('main_14_17').history_order, 310);
  assert.equal(canon.entityNode('char_모더니아').key, 'entity:char_마리안');
  assert.equal(canon.entityNode('char_애니힐리오').key, 'term:A2__093#E7');
  assert.equal(canon.keyOfRef({ ref: 'term', term_key: 'A2__122#E4', name: '제1 방주' }), 'term:A2__001#E1');
  assert.ok(line('main_14_17', 32));
});

test('GPT 규칙 검수 반영: order_basis 짝, 갈래 기록을 합류 뒤 기록의 앞으로 쓰지 않음, append 복제 방지', () => {
  // 앞 기록이 있는데 not_applicable
  const r1 = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)]),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)]),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'not_applicable' }),
  ]), bundle, ctx);
  assert.ok(codes(r1).includes('ORDER_BASIS_INVALID'));
  // 한 갈래 기록(branch) 뒤에 갈래 밖 기록을 잇기
  const r2 = validateDShard(shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)], { context_scope: 'branch' }),
    link(2, ['main_14_17__rln_003'], [ev('main_14_17', 32)]),
    link(3, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { progression: 'continues', prev_link_ids: ['D1__900__001'], order_basis: 'script' }),
  ]), bundle, ctx);
  assert.ok(codes(r2).includes('EXCLUSIVE_BRANCH_CHAINED'));
  // 같은 부분 파일을 두 번 넣어도 복제되지 않는다, 배열만 넣으면 오류
  const b = { bundle_id: 'D1__900', memos: [{ item_id: 'm1' }] };
  const part = { candidate_links: [{ link_id: 'P1', memo_ids: ['m1'], prev_link_ids: [], rationale: 'x' }] };
  const a1 = appendPart(null, part, b);
  const a2 = appendPart(a1.shard, part, b);
  assert.equal(a2.shard.candidate_links.length, 1);
  assert.deepEqual(a2.skipped, ['P1']);
  assert.throws(() => appendPart(null, part.candidate_links, b), /객체/);
});

test('GPT 규칙 검수 반영: 두 보정이 같은 새 쌍으로 모이면 같은 묶음 겹침 경고', () => {
  const two = { ...bundle, units: [{ ...bundle.units[0], unit_id: 'U001', memo_ids: ['main_14_14__rln_005'] }, { unit_id: 'U002', pair_key: pairKeyOf(A, 'entity:char_네온'), node_a: { key: A, ref: ref(A) }, node_b: { key: 'entity:char_네온', ref: canon.entityNode('char_네온').ref }, memo_ids: ['main_14_17__rln_004'] }], memos: [bundle.memos[0], { ...bundle.memos[2], unit_id: 'U002', target_node: 'entity:char_네온' }] };
  const rapi = canon.entityNode('char_라피').ref;
  const ovr = (unit, id, from) => ({ unit_id: unit, memo_ids: [id], side: 'target', from, to: rapi, confidence: '가능성', rationale: 'r', supporting_evidence: [ev('main_14_17', 34)] });
  const s = shardWith([
    link(1, ['main_14_14__rln_005'], [ev('main_14_14', 69, 72)], { target: [rapi] }),
    { ...link(2, ['main_14_17__rln_004'], [ev('main_14_17', 34)], { target: [rapi] }), unit_id: 'U002' },
  ]);
  s.endpoint_overrides = [ovr('U001', 'main_14_14__rln_005', ref(B)), ovr('U002', 'main_14_17__rln_004', canon.entityNode('char_네온').ref)];
  const r = validateDShard(s, two, ctx);
  assert.ok(r.warnings.some((w) => w.code === 'SAME_BUNDLE_PAIR_OVERLAP'));
});
