import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignEntityIds,
  buildUnits,
  collectA2Items,
  compareSampling,
  exceptionScopeCounts,
  findMergeCandidates,
  groupOccurrences,
  mergeA2,
  packUnits,
  previewBUpdate,
  promoteA2,
  officialResolutions,
  applyBUpdate,
  applyRejudge,
  a2ContextByTitle,
  buildRejudgeBundles,
  A2_CURATION_SCHEMA_VERSION,
  resolveOccurrences,
  sampleA2Audit,
  sampleOccurrences,
  validateA2Shard,
  variantKey,
} from './graph/pass2-a2.mjs';

// 가짜 장면: a1·a2(이야기 ta), b1(이야기 tb)
const SCRIPTS = {
  a1: ['[SCENE START]', '라피: 방주로 돌아가자.', '아니스: 중앙 정부가 또 시끄럽네.', '[MSG SENDER="네온"]', '중앙정부 공지 봤어?', '[SCENE END]'],
  a2: ['[SCENE START]', '소피아: 2호 쉘터의 관리자 소피아라고 해요', '[SCENE END]'],
  b1: ['[SCENE START]', '아리아: 이 노래를 부르는 소피아는, 무명의 가수야.', '라피: 방주 밖이다.', '[SCENE END]'],
};
const META = {
  a1: { scene_id: 'a1', title_id: 'ta', sub_title: '하나' },
  a2: { scene_id: 'a2', title_id: 'ta', sub_title: '둘' },
  b1: { scene_id: 'b1', title_id: 'tb', sub_title: '셋' },
};
const store = {
  has: (id) => id in SCRIPTS,
  meta: (id) => META[id] ?? null,
  lines: (id) => (SCRIPTS[id] ? ['', ...SCRIPTS[id]] : null),
  sceneOrder: new Map([['a1', 0], ['a2', 1], ['b1', 2]]),
};
const registry = new Map([
  ['char_라피', { entity_id: 'char_라피', canonical_name: '라피', surface_labels: ['라피'] }],
  ['char_리틀_머메이드', { entity_id: 'char_리틀_머메이드', canonical_name: '리틀 머메이드', surface_labels: ['리틀 머메이드', '세이렌'] }],
]);
const ctx = { store, registry, pass2Entities: new Map() };

const scene = (scene_id, extra) => ({ scene_id, participants: { present_in_scene: [], mentioned_only: [], document_author: null, ...extra.participants }, unregistered_entity_candidates: extra.uec ?? [] });
const docs = [
  {
    title_id: 'ta', category: 'event_stories', scenes: [
      scene('a1', {
        uec: [
          { item_id: 'a1__uec_001', surface_text: '방주', suggested_type: 'location', line_start: 2 },
          { item_id: 'a1__uec_002', surface_text: '중앙 정부', suggested_type: 'organization', line_start: 3 },
          { item_id: 'a1__uec_003', surface_text: '중앙정부', suggested_type: 'organization', line_start: 4 }, // 태그 줄을 가리킴(실태 조사 이상 징후 4번)
          { item_id: 'a1__uec_004', surface_text: '세이렌', suggested_type: 'alias', line_start: 2 },
          { item_id: 'a1__uec_005', surface_text: '제인', suggested_type: 'character', line_start: 2 },
        ],
        participants: {
          present_in_scene: [{ entity_id: 'char_리틀_머메이드' }],
          mentioned_only: [{ item_id: 'a1__mnt_001', surface_text: '방주', entity_id: null, entity_type: 'location', line_start: 2, line_end: 2 }],
        },
      }),
      scene('a2', {
        uec: [{ item_id: 'a2__uec_001', surface_text: '소피아', suggested_type: 'character', line_start: 2 }],
        participants: { document_author: { item_id: 'a2__dca_001', name: '소피아', entity_id: null } },
      }),
    ],
  },
  {
    title_id: 'tb', category: 'character_episodes', scenes: [
      scene('b1', {
        uec: [
          { item_id: 'b1__uec_001', surface_text: '소피아', suggested_type: 'character', line_start: 2 },
          { item_id: 'b1__uec_002', surface_text: '방주', suggested_type: 'location', line_start: 3 },
          { item_id: 'b1__uec_003', surface_text: '세이렌', suggested_type: 'alias', line_start: 3 },
        ],
      }),
    ],
  },
];

const collected = collectA2Items(docs, { registry, genericLabels: new Set() });
const units = buildUnits(collected.items, store, { registry });
const unitOf = (s) => units.find((u) => u.surface === s);

test('모집단: 사용자 제외만 빼고, 같은 장면 참여자와 같은 등록 표기는 표시만 해 판정자에게 넘긴다', () => {
  assert.deepEqual(collected.excluded.map((x) => x.surface), ['제인']);
  const sirens = collected.items.filter((x) => x.surface === '세이렌');
  assert.deepEqual(sirens.map((x) => `${x.item_id}:${x.participant_match ?? '-'}`), ['a1__uec_004:char_리틀_머메이드', 'b1__uec_003:-']);
  assert.ok(collected.items.some((x) => x.source === 'author' && x.surface === '소피아'));
  const siren = unitOf('세이렌');
  assert.equal(siren.registry_match.entity_id, 'char_리틀_머메이드');
  assert.equal(siren.coverage.participant_match_occurrences, 1);
});

test('출현: 같은 장면에서 줄이 겹치는 미등록 후보와 언급은 한 출현, 작성자는 따로 한 출현', () => {
  const bang = unitOf('방주');
  assert.equal(bang.occurrence_total, 2);
  assert.equal(bang.item_total, 3);
  assert.deepEqual(bang.occurrences[0].item_ids.sort(), ['a1__mnt_001', 'a1__uec_001']);
  const sofia = unitOf('소피아');
  assert.equal(sofia.occurrence_total, 3);
  assert.ok(sofia.occurrences.some((o) => o.line_start === null && o.item_ids[0] === 'a2__dca_001'));
  const occs = groupOccurrences([{ scene_id: 'a1', title_id: 'ta', category: 'x', item_id: 'i1', source: 'uec', type: 'item', line_start: 5, line_end: 5 }, { scene_id: 'a1', title_id: 'ta', category: 'x', item_id: 'i2', source: 'uec', type: 'item', line_start: 6, line_end: 6 }], store);
  assert.equal(occs.length, 2); // 맞닿기만 한 다른 줄은 다른 출현
});

test('골라 보여 주기: 유형×분류 조합마다 하나, 이야기를 고루, 상한, 늘 같은 결과', () => {
  const mk = (n, title, type, category = 'c1') => Array.from({ length: n }, (_, i) => ({ scene_id: `${title}_${i}`, title_id: title, category, line_start: 1, line_end: 1, item_ids: [`${title}_${i}__uec`], types: [type] }));
  assert.equal(sampleOccurrences('x', mk(5, 't1', 'location'), 40).size, 5);
  // GPT 재현 사례: location/c2 조합은 한 곳뿐(유형·분류를 따로 덮으면 빠질 수 있다)
  const big = [...mk(100, 't1', 'location'), ...mk(30, 't2', 'organization', 'c2'), ...mk(1, 't3', 'location', 'c2'), ...mk(2, 't4', 'location')];
  const a = sampleOccurrences('방주', big, 40);
  assert.equal(a.size, 40);
  assert.deepEqual([...a].sort(), [...sampleOccurrences('방주', big, 40)].sort());
  const chosen = big.filter((o) => a.has(`${o.scene_id}:1:${o.item_ids[0]}`));
  assert.ok(chosen.some((o) => o.title_id === 't3'), 'location/c2 조합');
  for (const t of ['t1', 't2', 't4']) assert.ok(chosen.some((o) => o.title_id === t), t);
  assert.equal(chosen.filter((o) => o.title_id === 't4').length, 2);
});

test('묶음 나누기: 같은 변형 무리는 상한을 넘어도 한 묶음에 둔다', () => {
  assert.equal(variantKey('중앙 정부'), variantKey('중앙정부'));
  assert.equal(variantKey('T.T. STAR'), variantKey('t.t.star'));
  assert.equal(variantKey('[사고 전환]'), variantKey('사고전환'));
  const us = [
    { surface: 'a', variant_key: 'a', _chars: 10 },
    { surface: '중앙 정부', variant_key: '중앙정부', _chars: 10 },
    { surface: '중앙정부', variant_key: '중앙정부', _chars: 10 },
    { surface: 'z', variant_key: 'z', _chars: 10 },
  ];
  assert.deepEqual(packUnits(us, { maxUnits: 2, maxChars: 1000 }).map((b) => b.units.map((u) => u.surface)), [['a', '중앙 정부', '중앙정부'], ['z']]);
});

// 검증기용 묶음: U001 소피아(a2 본문 O0001, a2 작성자 O0002, b1 O0003), U002 방주
const bundleUnits = [unitOf('소피아'), unitOf('방주')].map((u, i) => ({ unit_id: `U00${i + 1}`, ...u }));
const bundle = { bundle_id: 'A2__001', units: bundleUnits };
const occMap = new Map(bundleUnits.map((u) => [u.unit_id, u.occurrences]));
const ev = (scene_id, line_start, line_end, quote) => ({ scene_id, line_start, line_end, quote });
const ent = (name, entity_type, entity_key, qualifier) => ({ ref: 'entity', entity_id: null, name, entity_type, entity_key, ...(qualifier ? { qualifier } : {}) });
const link = (n, unit, extra) => ({
  link_id: `A2__001__00${n}`,
  link_type: 'new_entity',
  subject: [{ ref: 'unit', unit_id: unit }],
  scope: { default: true },
  target: [ent('소피아', 'character', 'E1', '2호 쉘터 관리자')],
  verdict: '새 엔티티',
  confidence: '유력한 해석',
  rationale: '이유',
  supporting_evidence: [ev('a2', 2, 2, '2호 쉘터의 관리자 소피아라고 해요')],
  contradicting_evidence: [],
  alternatives: [],
  search_hints: [],
  ...extra,
});
const goodShard = () => ({
  schema_version: 'pass2-0.1.0',
  bundle_id: 'A2__001',
  candidate_links: [
    link(1, 'U001'),
    link(2, 'U001', {
      scope: { title_ids: ['tb'] },
      target: [ent('소피아', 'character', 'E2', '노래 속 가수')],
      supporting_evidence: [ev('b1', 2, 2, '이 노래를 부르는 소피아는, 무명의 가수야.')],
    }),
    link(3, 'U002', { target: [ent('방주', 'location', 'E3')], supporting_evidence: [ev('a1', 2, 2, '방주로 돌아가자.')] }),
  ],
});
const codes = (r) => r.errors.map((e) => e.code).sort();

test('검증기: 기본 판정 + 이야기 예외는 통과', () => {
  const r = validateA2Shard(goodShard(), bundle, ctx, occMap);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('검증기: 같은 대상을 근거 종류에 따라 유력한 해석·가능성 두 연결로 나눠도 통과(규칙 3.3·3.6절)', () => {
  const s = goodShard();
  Object.assign(s.candidate_links[1], { target: [ent('소피아', 'character', 'E1', '2호 쉘터 관리자')], confidence: '가능성' });
  const r = validateA2Shard(s, bundle, ctx, occMap);
  assert.deepEqual(r.errors, []);
});

test('검증기: 기본 판정 누락·중복, 표기가 없는 범위, 예외 범위마다 근거', () => {
  const s = goodShard();
  s.candidate_links[2].scope = { title_ids: ['ta'] };
  assert.ok(codes(validateA2Shard(s, bundle, ctx, occMap)).includes('UNIT_NOT_COVERED'));
  const s2 = goodShard();
  s2.candidate_links[1].scope = { default: true };
  assert.ok(codes(validateA2Shard(s2, bundle, ctx, occMap)).includes('SCOPE'));
  const s3 = goodShard();
  s3.candidate_links[1].scope = { title_ids: ['tz'] };
  assert.ok(codes(validateA2Shard(s3, bundle, ctx, occMap)).includes('SCOPE'));
  // 이야기 둘을 예외로 적었는데 근거는 한 이야기뿐
  const s4 = goodShard();
  s4.candidate_links[1].scope = { title_ids: ['tb', 'ta'] };
  assert.ok(codes(validateA2Shard(s4, bundle, ctx, occMap)).includes('EVIDENCE_OUT_OF_SCOPE'));
});

test('검증기: 기본 판정의 근거가 모두 예외에 덮이면 실패, 기본이 보류면 경고', () => {
  // 소피아 기본 근거(a2)를 장면 예외로 덮는다 → 기본이 적용되는 출현(없음)… 예외를 b1에만 두고 기본 근거를 b1로 옮겨 본다
  const s = goodShard();
  s.candidate_links[0].supporting_evidence = [ev('b1', 2, 2, '이 노래를 부르는 소피아는, 무명의 가수야.')];
  assert.ok(codes(validateA2Shard(s, bundle, ctx, occMap)).includes('DEFAULT_EVIDENCE_NOT_APPLIED'));
  Object.assign(s.candidate_links[0], { link_type: 'unresolved', verdict: '판단 보류', confidence: '판단 보류', target: [] });
  const r = validateA2Shard(s, bundle, ctx, occMap);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((w) => w.code), ['DEFAULT_EVIDENCE_NOT_APPLIED']);
});

test('검증기: 같은 장면의 다른 출현은 출현 예외로 나눈다(작성자 ↔ 본문)', () => {
  const s = goodShard();
  // a2의 작성자 출현(O0002)만 따로: 작성자 항목은 그 장면 근거로 확인
  const authorOcc = bundleUnits[0].occurrences.find((o) => o.line_start === null).occ_id;
  s.candidate_links.push(link(4, 'U001', { scope: { occ_ids: [authorOcc] }, target: [ent('소피아', 'character', 'E1', '2호 쉘터 관리자')], link_type: 'new_entity', confidence: '가능성' }));
  assert.deepEqual(validateA2Shard(s, bundle, ctx, occMap).errors, []);
  const resolved = resolveOccurrences(s.candidate_links.filter((l) => l.subject[0].unit_id === 'U001'), bundleUnits[0].occurrences);
  assert.deepEqual(resolved.map((r) => r.applied_scope).sort(), ['default', 'occurrence', 'title']);
  s.candidate_links[3].scope = { occ_ids: ['O9999'] };
  assert.ok(codes(validateA2Shard(s, bundle, ctx, occMap)).includes('SCOPE'));
});

test('검증기: 별칭은 등록 인물 ID·character만, 새 엔티티는 ID 없이 entity_key, 일반 낱말은 target 없음', () => {
  const s = goodShard();
  Object.assign(s.candidate_links[2], { link_type: 'alias', verdict: '별칭' });
  assert.ok(codes(validateA2Shard(s, bundle, ctx, occMap)).includes('ALIAS_TARGET'));
  const s1 = goodShard();
  Object.assign(s1.candidate_links[2], { link_type: 'alias', verdict: '별칭', target: [{ ref: 'entity', entity_id: 'char_라피', name: '라피', entity_type: 'organization' }] });
  assert.ok(codes(validateA2Shard(s1, bundle, ctx, occMap)).includes('ALIAS_TARGET'));
  const s2 = goodShard();
  s2.candidate_links[0].target = [{ ref: 'entity', entity_id: 'char_라피', name: '라피', entity_type: 'character' }];
  assert.ok(codes(validateA2Shard(s2, bundle, ctx, occMap)).includes('NEW_ENTITY_ID'));
  const s3 = goodShard();
  Object.assign(s3.candidate_links[2], { link_type: 'generic_term', verdict: '일반 낱말' });
  assert.ok(codes(validateA2Shard(s3, bundle, ctx, occMap)).includes('TARGET'));
  const s4 = goodShard();
  delete s4.candidate_links[2].target[0].entity_key;
  assert.ok(codes(validateA2Shard(s4, bundle, ctx, occMap)).includes('ENTITY_KEY'));
  const s5 = goodShard();
  s5.candidate_links[2].supporting_evidence[0].reveals_identity = false;
  s5.candidate_links[2].target[0].entity_type = 'faction_or_species';
  assert.deepEqual(codes(validateA2Shard(s5, bundle, ctx, occMap)), ['FORBIDDEN_FIELD']);
  const s6 = goodShard();
  s6.candidate_links[0].supporting_evidence = [ev('a2', 2, 2, '원문에 없는 말')];
  assert.ok(codes(validateA2Shard(s6, bundle, ctx, occMap)).includes('QUOTE_LOCATION'));
});

test('검증기: entity_key는 같은 대상끼리만 공유, 다른 키에 같은 이름·qualifier는 실패, 대안에도 qualifier', () => {
  const s = goodShard();
  s.candidate_links[1].target[0].entity_key = 'E1'; // 다른 qualifier에 같은 키
  assert.ok(codes(validateA2Shard(s, bundle, ctx, occMap)).includes('ENTITY_KEY'));
  const s2 = goodShard();
  delete s2.candidate_links[0].target[0].qualifier;
  delete s2.candidate_links[1].target[0].qualifier; // E1·E2가 구별되지 않음
  assert.ok(codes(validateA2Shard(s2, bundle, ctx, occMap)).includes('ENTITY_KEY'));
  const s3 = goodShard();
  s3.candidate_links[0].alternatives = [{ link_type: 'new_entity', entity_id: null, name: '소피아', entity_type: 'character', qualifier: '노래 속 가수', why: '같은 이름', supporting_evidence: [ev('b1', 2, 2, '이 노래를 부르는 소피아는, 무명의 가수야.')] }];
  assert.deepEqual(validateA2Shard(s3, bundle, ctx, occMap).errors, []);
});

test('ID: 무리를 먼저 정하고 한 번만 만든다. 같은 바탕 ID는 모두 해시로 구별', () => {
  const gs = assignEntityIds([
    { group_key: 'A#E1', canonical_name: '테스트 인물', entity_type: 'character' },
    { group_key: 'B#E1', canonical_name: '테스트_인물', entity_type: 'character' },
    { group_key: 'A#E2', canonical_name: '중앙 정부', entity_type: 'organization' },
    { group_key: 'A#E3', canonical_name: '방주', entity_type: 'location' },
  ]);
  assert.notEqual(gs[0].entity_id, gs[1].entity_id);
  assert.ok(gs[0].entity_id.startsWith('char2_테스트_인물__'));
  assert.equal(gs[2].entity_id, 'org_중앙_정부');
  assert.equal(gs[3].entity_id, undefined);
});

test('병합: 무리 ID를 모든 항목이 공유, 묶음을 넘는 같은 이름은 합치지 않고 후보로, 사용자 확인 덮어쓰기', () => {
  // 묶음 1: 중앙 정부·중앙정부 두 표기를 같은 E1로
  const u1 = [{ unit_id: 'U001', surface: '중앙 정부' }, { unit_id: 'U002', surface: '중앙정부' }, { unit_id: 'U003', surface: '7호' }];
  const o1 = { units: [
    { unit_id: 'U001', occurrences: [{ occ_id: 'O0001', scene_id: 'a1', title_id: 'ta', item_ids: ['x1'], shown: true }] },
    { unit_id: 'U002', occurrences: [{ occ_id: 'O0001', scene_id: 'a1', title_id: 'ta', item_ids: ['x2'], shown: false }] },
    { unit_id: 'U003', occurrences: [{ occ_id: 'O0001', scene_id: 'a1', title_id: 'ta', item_ids: ['x3'], shown: false }] },
  ] };
  const L = (n, unit, t) => ({ link_id: `A2__001__00${n}`, link_type: 'new_entity', verdict: '새 엔티티', confidence: '유력한 해석', subject: [{ ref: 'unit', unit_id: unit }], scope: { default: true }, target: [t] });
  const s1 = { candidate_links: [L(1, 'U001', ent('중앙 정부', 'organization', 'E1')), L(2, 'U002', ent('중앙 정부', 'organization', 'E1')), L(3, 'U003', ent('7호', 'character', 'E2'))] };
  // 묶음 2: 다른 묶음의 '중앙 정부'
  const u2 = [{ unit_id: 'U001', surface: '정부' }];
  const o2 = { units: [{ unit_id: 'U001', occurrences: [{ occ_id: 'O0001', scene_id: 'b1', title_id: 'tb', item_ids: ['y1'], shown: true }] }] };
  const s2 = { candidate_links: [{ ...L(1, 'U001', ent('중앙 정부', 'organization', 'E1')), link_id: 'A2__002__001' }] };
  const m = mergeA2({ mainBundles: [
    { bundle: { bundle_id: 'A2__001', units: u1 }, shard: s1, occurrences: o1 },
    { bundle: { bundle_id: 'A2__002', units: u2 }, shard: s2, occurrences: o2 },
  ] });
  const byItem = new Map(m.resolutions.map((r) => [r.item_id, r]));
  assert.equal(byItem.get('x1').assigned_entity_id, byItem.get('x2').assigned_entity_id);
  assert.notEqual(byItem.get('x1').assigned_entity_id, byItem.get('y1').assigned_entity_id);
  const ids = new Set(m.entities.map((e) => e.entity_id));
  for (const r of m.resolutions) if (r.assigned_entity_id) assert.ok(ids.has(r.assigned_entity_id));
  assert.equal(m.mergeCandidates.length, 1);
  assert.equal(m.mergeCandidates[0].groups.length, 2);
  assert.equal(byItem.get('x3').target.entity_id, 'char_지휘관');
  assert.equal(byItem.get('x3').decided_by, 'user');
  assert.equal(m.userChecks[0].judge_agrees, false);
  assert.equal(byItem.get('x2').applied_scope, 'default');
  assert.equal(byItem.get('x2').shown, false);
});

test('ID: 지난 병합의 ID는 그대로 두고, 같은 이름의 새 무리만 해시로 구별한다(증분)', () => {
  const prior = new Map([['A#E1', 'char2_테스트']]);
  const gs = assignEntityIds([
    { group_key: 'A#E1', canonical_name: '테스트', entity_type: 'character' },
    { group_key: 'A2I1__001#E1', canonical_name: '테스트', entity_type: 'character' },
    { group_key: 'A2I1__001#E2', canonical_name: '새 인물', entity_type: 'character' },
  ], prior);
  assert.equal(gs[0].entity_id, 'char2_테스트');
  assert.ok(gs[1].entity_id.startsWith('char2_테스트__'));
  assert.equal(gs[2].entity_id, 'char2_새_인물');
  // 지난 ID의 무리가 없어졌으면(철회) 같은 이름의 새 무리가 바탕 ID를 쓴다
  const again = assignEntityIds([{ group_key: 'A2I1__001#E1', canonical_name: '테스트', entity_type: 'character' }], prior);
  assert.equal(again[0].entity_id, 'char2_테스트');
});

test('병합: 증분에서 바뀐 장면의 옛 출현은 철회하고 증분 묶음의 출현은 남긴다', () => {
  const retraction = { isRetracted: (inc, sid) => sid === 'toy' && !inc };
  const units = [{ unit_id: 'U001', surface: '가게' }];
  const occ = { units: [{ unit_id: 'U001', occurrences: [
    { occ_id: 'O0001', scene_id: 'toy', title_id: 't', item_ids: ['toy__uec_001'], shown: true },
    { occ_id: 'O0002', scene_id: 'other', title_id: 't', item_ids: ['other__uec_001'], shown: true },
  ] }] };
  const shard = { candidate_links: [{ link_id: 'A2__001__001', link_type: 'generic_term', verdict: '일반 낱말', confidence: '유력한 해석', subject: [{ ref: 'unit', unit_id: 'U001' }], scope: { default: true }, target: [] }] };
  const incShard = { candidate_links: [{ ...shard.candidate_links[0], link_id: 'A2I1__001__001' }] };
  const incOcc = { units: [{ unit_id: 'U001', occurrences: [{ occ_id: 'O0001', scene_id: 'toy', title_id: 't', item_ids: ['toy__uec_001'], shown: true }] }] };
  const m = mergeA2({ retraction, mainBundles: [
    { bundle: { bundle_id: 'A2__001', units }, shard, occurrences: occ },
    { bundle: { bundle_id: 'A2I1__001', increment: 'inc_001', units }, shard: incShard, occurrences: incOcc },
  ] });
  assert.deepEqual(m.resolutions.map((r) => `${r.bundle_id}:${r.item_id}`), ['A2__001:other__uec_001', 'A2I1__001:toy__uec_001']);
  assert.deepEqual(m.retractedOccurrences.map((x) => `${x.bundle_id}:${x.occ_id}`), ['A2__001:O0001']);
});

test('펼치기: 출현 예외 > 장면 예외 > 이야기 예외 > 기본', () => {
  const occs = [{ occ_id: 'O1', scene_id: 's1', title_id: 't1' }, { occ_id: 'O2', scene_id: 's2', title_id: 't1' }, { occ_id: 'O3', scene_id: 's2', title_id: 't1' }, { occ_id: 'O4', scene_id: 's3', title_id: 't2' }];
  const L = [{ link_id: 'd', scope: { default: true } }, { link_id: 't', scope: { title_ids: ['t1'] } }, { link_id: 's', scope: { scene_ids: ['s2'] } }, { link_id: 'o', scope: { occ_ids: ['O3'] } }];
  assert.deepEqual(resolveOccurrences(L, occs).map((x) => x.link.link_id), ['t', 's', 'o', 'd']);
});

test('제시·미제시 불일치: 미제시 출현과 확신도만 다른 것을 따로 센다', () => {
  const occs = [
    { occ_id: 'O1', scene_id: 's1', title_id: 't1', item_ids: ['i1'], shown: true },
    { occ_id: 'O2', scene_id: 's2', title_id: 't2', item_ids: ['i2'], shown: false },
    { occ_id: 'O3', scene_id: 's3', title_id: 't3', item_ids: ['i3'], shown: false },
  ];
  const t = (name) => [{ ref: 'entity', entity_id: null, name, entity_type: 'location', entity_key: 'E1' }];
  const main = { surface: 'x', occurrences: occs, links: [{ link_type: 'new_entity', confidence: '유력한 해석', scope: { default: true }, target: t('x') }] };
  const check = { surface: 'x', occurrences: occs.map((o) => ({ ...o, shown: true })), links: [{ link_type: 'new_entity', confidence: '가능성', scope: { default: true }, target: t('x') }, { link_type: 'generic_term', confidence: '가능성', scope: { title_ids: ['t3'] }, target: [] }] };
  const r = compareSampling({ main, check });
  assert.equal(r.agree, 2);
  assert.equal(r.agree_confidence_differs, 2);
  assert.equal(r.differ_not_shown, 1);
  assert.equal(r.differ_shown, 0);
});

test('B 갱신 미리 보기: 근거 장면의 A-2 판정이 하나·유형 일치일 때만 채움', () => {
  const entities = [
    { entity_id: 'org_도이스', canonical_name: '도이스', entity_type: 'organization' },
    { entity_id: 'char2_소피아', canonical_name: '소피아', entity_type: 'character' },
  ];
  const R = (scene_id, title_id, surface, extra) => ({ scene_id, title_id, surface, ...extra });
  const resolutions = [
    R('b1', 'tb', '도이스', { link_type: 'new_entity', target: { name: '도이스' }, assigned_entity_id: 'org_도이스' }),
    R('a2', 'ta', '소피아', { link_type: 'new_entity', target: { name: '소피아' }, assigned_entity_id: 'char2_소피아' }),
    R('a1', 'ta', '소피아', { link_type: 'generic_term', target: null }),
  ];
  const bLinks = [
    { link_id: 'B1', target: [{ entity_id: null, name: '도이스', entity_type: 'character' }], supporting_evidence: [{ scene_id: 'b1', reveals_identity: true }] },
    { link_id: 'B2', target: [{ entity_id: null, name: '소피아', entity_type: 'character' }], supporting_evidence: [{ scene_id: 'a2', reveals_identity: true }] },
    { link_id: 'B3', target: [{ entity_id: null, name: '소피아', entity_type: 'character' }], supporting_evidence: [{ scene_id: 'b1', reveals_identity: true }, { scene_id: 'a1' }] },
    { link_id: 'B4', target: [{ entity_id: null, name: '7호', entity_type: 'character' }], supporting_evidence: [{ scene_id: 'a1' }] },
  ];
  const rows = previewBUpdate({ bLinks, entities, resolutions, store });
  // B1: 유형 다름 → 재판정. B2: 근거 장면 a2의 판정이 하나 → 채움. B3: 공개 근거 b1에 소피아 항목 없음 → 이야기 tb에도 없음 → 유지. B4: 사용자 확인
  assert.deepEqual(rows.map((r) => `${r.link_id}:${r.result}`), ['B1:rejudge', 'B2:fill', 'B3:keep', 'B4:fill']);
  // 근거가 같은 이야기(ta)의 다른 장면까지 섞이면 하나로 모이지 않아 재판정
  const mixed = previewBUpdate({ bLinks: [{ link_id: 'B5', target: [{ entity_id: null, name: '소피아', entity_type: 'character' }], supporting_evidence: [{ scene_id: 'a1' }, { scene_id: 'a2' }] }], entities, resolutions, store });
  assert.equal(mixed[0].result, 'rejudge');
});

test('감사 표본: 층마다 최소 하나, 골라 보여 준 단위에는 못 본 출현을 따로 뽑아 준다', () => {
  const sampledUnit = { ...bundleUnits[1], unit_id: 'U002', sampled: true };
  const occ2 = sampledUnit.occurrences.map((o, i) => ({ ...o, shown: i === 0 }));
  const b = { bundle_id: 'A2__001', units: [bundleUnits[0], sampledUnit] };
  const args = { planBundles: [{ bundle_id: 'A2__001', input: 'i', script: 's' }], bundles: new Map([['A2__001', b]]), shards: new Map([['A2__001', goodShard()]]), occurrencesByBundle: new Map([['A2__001', new Map([['U001', bundleUnits[0].occurrences], ['U002', occ2]])]]), rate: 0.1, seed: 's' };
  const a = sampleA2Audit(args);
  assert.equal(a.population_units, 2);
  assert.equal(a.sampled_units, 2);
  const probe = a.items.find((x) => x.unit_id === 'U002').unseen_probes;
  assert.equal(probe.length, 1);
  assert.equal(probe[0].shown, false);
  assert.equal(probe[0].applied_scope, 'default');
  assert.deepEqual(sampleA2Audit(args).items.map((x) => x.audit_id), a.items.map((x) => x.audit_id));
});

test('제시·미제시 불일치: 유형·이름이 같고 qualifier만 다른 것은 불일치에서 빼고 따로 센다', () => {
  const occs = [
    { occ_id: 'O1', scene_id: 's1', title_id: 't1', item_ids: ['i1'], shown: true },
    { occ_id: 'O2', scene_id: 's2', title_id: 't2', item_ids: ['i2'], shown: false },
  ];
  const t = (name, qualifier, type = 'character') => [{ ref: 'entity', entity_id: null, name, entity_type: type, entity_key: 'E1', qualifier }];
  const main = { surface: '퀸', occurrences: occs, links: [{ link_type: 'new_entity', confidence: '유력한 해석', scope: { default: true }, target: t('퀸', '랩쳐의 초대 수장') }] };
  const check = { surface: '퀸', occurrences: occs, links: [
    { link_type: 'new_entity', confidence: '유력한 해석', scope: { default: true }, target: t('퀸', '원래의 랩쳐 퀸') },
    { link_type: 'new_entity', confidence: '유력한 해석', scope: { title_ids: ['t2'] }, target: t('퀸', '등급', 'faction_or_species') },
  ] };
  const r = compareSampling({ main, check });
  assert.equal(r.agree, 0);
  assert.equal(r.differ_qualifier_only, 1);
  assert.equal(r.differ_shown, 0);
  assert.equal(r.differ_not_shown, 1);
});

test('병합 후보: 묶음을 넘어 변형 열쇠(꼬리말 제거)가 겹치면 후보, 스쿼드·조직은 같은 무리, 다른 유형·같은 묶음은 아님', () => {
  const G = (bundle_id, key, canonical_name, entity_type, surfaces) => ({ group_key: `${bundle_id}#${key}`, bundle_id, canonical_name, entity_type, qualifier: null, surfaces: new Set(surfaces) });
  const c = findMergeCandidates([
    G('A2__004', 'E3', '리틀 캐논 스쿼드', 'squad', ['리틀 캐논 스쿼드']),
    G('A2__014', 'E2', '리틀 캐논', 'squad', ['폭죽놀이단']),
    G('A2__020', 'E1', '리틀캐논', 'organization', ['리틀캐논']),
    G('A2__021', 'E1', '리틀 캐논', 'item', ['리틀 캐논']),
    G('A2__005', 'E1', '방주', 'location', ['방주']),
    G('A2__005', 'E2', '방주', 'location', ['방주']),
    G('A2__006', 'E1', '중앙 정부', 'organization', ['중앙 정부']),
    G('A2__007', 'E1', '중앙정부', 'organization', ['중앙정부']),
  ]);
  assert.equal(c.length, 2);
  const little = c.find((x) => x.groups.some((g) => g.canonical_name === '리틀 캐논 스쿼드'));
  assert.deepEqual(little.groups.map((g) => g.group_key).sort(), ['A2__004#E3', 'A2__014#E2', 'A2__020#E1']);
  assert.equal(little.match, 'variant');
  const gov = c.find((x) => x.groups.some((g) => g.canonical_name === '중앙 정부'));
  assert.equal(gov.match, 'same_name');
});

test('감사 표본: 기본 판정이 일반 낱말인 층은 비율을 3배로 한다', () => {
  const units = Array.from({ length: 10 }, (_, i) => ({ unit_id: `U${String(i + 1).padStart(3, '0')}`, surface: `표기${i}`, sampled: false }));
  const links = units.map((u, i) => ({ link_id: `A2__001__${i}`, link_type: i < 5 ? 'generic_term' : 'new_entity', confidence: '유력한 해석', subject: [{ ref: 'unit', unit_id: u.unit_id }], scope: { default: true }, target: [] }));
  const a = sampleA2Audit({ planBundles: [{ bundle_id: 'A2__001', input: 'i', script: 's' }], bundles: new Map([['A2__001', { bundle_id: 'A2__001', units }]]), shards: new Map([['A2__001', { candidate_links: links }]]), rate: 0.2, seed: 's' });
  const by = Object.fromEntries(a.strata.map((s) => [s.stratum.split('/')[0], s]));
  assert.equal(by.generic_term.sampled, 3);
  assert.ok(Math.abs(by.generic_term.rate - 0.6) < 1e-9);
  assert.equal(by.new_entity.sampled, 1);
});

test('finish 예외 집계: 기본은 빼고 이야기·장면·출현 범위와 그 조합을 따로 센다', () => {
  const shard = { candidate_links: [
    { scope: { default: true } },
    { scope: { title_ids: ['ta'] } },
    { scope: { title_ids: ['ta', 'tb'], scene_ids: ['a1'] } },
    { scope: { scene_ids: ['b1'] } },
    { scope: { occ_ids: ['O0001'] } },
    { scope: { title_ids: ['tb'] } },
  ] };
  assert.deepEqual(exceptionScopeCounts(shard), { total: 5, 이야기: 2, '이야기+장면': 1, 장면: 1, 출현: 1 });
  assert.deepEqual(exceptionScopeCounts({ candidate_links: [{ scope: { default: true } }] }), { total: 0 });
});

test('공식 표: 합친 무리는 바탕 ID, 혼자인 무리는 ID 그대로, 표기 묶음은 대표 무리 키', () => {
  const ent = (gk, id, name, type = 'character', extra = {}) => ({ group_key: gk, bundle_id: gk.split('#')[0], entity_key: gk.split('#')[1], entity_id: id, canonical_name: name, qualifier: null, entity_type: type, surfaces: [name], units: [], title_ids: [`t_${gk}`], item_count: 2, ...extra });
  const entities = [
    ent('A2__001#E1', 'char2_퀸', '퀸', 'character', { item_count: 10 }),
    ent('A2__002#E1', 'char2_랩쳐_퀸__aaaaaa', '랩쳐 퀸', 'character', { surfaces: ['하트 여왕'] }),
    ent('A2__003#E1', 'char2_엄마__bbbbbb', '엄마'),
    ent('A2__004#E1', 'char2_엄마__cccccc', '엄마'),
    ent('A2__005#E1', 'char2_엄마__dddddd', '엄마'),
    ent('A2__006#E1', 'squad_메티스', '메티스', 'squad'),
  ];
  const terms = [
    { ...ent('A2__007#E1', undefined, '다크 매터', 'item'), entity_id: undefined },
    { ...ent('A2__008#E1', undefined, '다크 매터', 'item', { surfaces: ['검은 물'] }), entity_id: undefined },
    { ...ent('A2__009#E1', undefined, '릴리바이스 꽃', 'item'), entity_id: undefined },
  ];
  const mergeCandidates = [
    { signature: 'character|엄마', groups: [{ group_key: 'A2__003#E1' }, { group_key: 'A2__004#E1' }, { group_key: 'A2__005#E1' }] },
  ];
  const curation = {
    schema_version: A2_CURATION_SCHEMA_VERSION,
    merges: [
      { groups: ['A2__001#E1', 'A2__002#E1'], canonical_name: '퀸', qualifier: '초대 랩쳐 수장', note: '같은 개체' },
      { groups: ['A2__003#E1', 'A2__004#E1'], canonical_name: '엄마', note: '같은 사람' },
      { groups: ['A2__007#E1', 'A2__008#E1'], canonical_name: '다크 매터', note: '검은 물 = 다크 매터' },
    ],
    separate: [{ groups: ['A2__005#E1'], note: '다른 사람' }],
    type_changes: [{ group: 'A2__009#E1', entity_type: 'faction_or_species', note: '꽃 종류' }],
    link_overrides: [{ link_id: 'A2__009__001', link_type: 'unresolved', target: { ref: 'entity', entity_id: null, name: '소녀', entity_type: 'character' }, note: '같은 장면 기준' }],
  };
  const out = promoteA2({ entities, terms, mergeCandidates, linkIds: new Set(['A2__009__001']), curation });
  assert.deepEqual(out.errors, []);
  const byId = new Map(out.entities.map((e) => [e.entity_id, e]));
  // 퀸: 바탕 ID char2_퀸이 혼자인 무리와 겹치지 않으므로 그대로
  assert.ok(byId.has('char2_퀸'));
  assert.deepEqual(byId.get('char2_퀸').source_groups, ['A2__001#E1', 'A2__002#E1']);
  assert.equal(byId.get('char2_퀸').item_count, 12);
  assert.deepEqual(byId.get('char2_퀸').surface_labels, ['랩쳐 퀸', '퀸', '하트 여왕']);
  assert.equal(out.idMap['char2_랩쳐_퀸__aaaaaa'], 'char2_퀸');
  // 엄마: 혼자인 엄마(dddddd)가 남으므로 합친 무리 ID는 바탕 ID가 아니라 해시를 붙인다(char2_엄마는 쓰지 않는다)
  const momIds = out.entities.filter((e) => e.canonical_name === '엄마').map((e) => e.entity_id).sort();
  assert.equal(momIds.length, 2);
  assert.ok(momIds.includes('char2_엄마__dddddd'));
  assert.ok(!momIds.includes('char2_엄마'));
  assert.equal(out.idMap['char2_엄마__bbbbbb'], out.idMap['char2_엄마__cccccc']);
  // 혼자인 스쿼드는 ID 그대로
  assert.ok(byId.has('squad_메티스'));
  // 표기 묶음: 합친 묶음은 대표 무리 키, 유형 바꿈 반영
  const dark = out.terms.find((x) => x.canonical_name === '다크 매터');
  assert.equal(dark.term_key, 'A2__007#E1');
  assert.deepEqual(dark.surfaces, ['검은 물', '다크 매터']);
  assert.deepEqual(out.groupMap['A2__008#E1'], { term_key: 'A2__007#E1' });
  assert.equal(out.terms.find((x) => x.canonical_name === '릴리바이스 꽃').entity_type, 'faction_or_species');
  assert.equal(out.linkOverrides[0].verdict, '판단 보류');
  assert.equal(out.stats.entities_after, 4);
  assert.equal(out.stats.terms_after, 2);
});

test('공식 표: 지난 공식 표의 ID·표기 묶음 키를 이어받아 증분 무리가 더해져도 바뀌지 않는다', () => {
  const g = (gk, id, name, type) => ({ group_key: gk, bundle_id: gk.split('#')[0], entity_key: gk.split('#')[1], entity_id: id, canonical_name: name, qualifier: null, entity_type: type, surfaces: [name], units: [], title_ids: ['t'], item_count: 1 });
  const entities = [g('A2__001#E1', 'char2_엄마__aaaaaa', '엄마', 'character'), g('A2__002#E1', 'char2_엄마__bbbbbb', '엄마', 'character'), g('A2I1__001#E1', 'char2_엄마__cccccc', '엄마', 'character')];
  const terms = [g('A2__003#E1', undefined, '방주', 'location'), g('A2__004#E1', undefined, '방주', 'location'), g('A2I1__001#E2', undefined, '방주', 'location')];
  const curation = { schema_version: A2_CURATION_SCHEMA_VERSION, type_changes: [], link_overrides: [], separate: [], merges: [
    { groups: ['A2__001#E1', 'A2__002#E1', 'A2I1__001#E1'], canonical_name: '엄마', note: 'n' },
    { groups: ['A2__003#E1', 'A2__004#E1', 'A2I1__001#E2'], canonical_name: '방주', note: 'n' },
  ] };
  const prior = { groupMap: { 'A2__001#E1': { entity_id: 'char2_엄마__old111' }, 'A2__002#E1': { entity_id: 'char2_엄마__old111' }, 'A2__003#E1': { term_key: 'A2__003#E1' }, 'A2__004#E1': { term_key: 'A2__003#E1' } } };
  const out = promoteA2({ entities, terms, curation, prior });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.entities.map((e) => e.entity_id), ['char2_엄마__old111']);
  assert.equal(out.idMap['char2_엄마__cccccc'], 'char2_엄마__old111');
  assert.deepEqual(out.terms.map((t) => t.term_key), ['A2__003#E1']);
  // 지난 표가 없으면 예전 규칙(사전순 첫 무리)이다
  assert.deepEqual(promoteA2({ entities, terms, curation }).terms.map((t) => t.term_key), ['A2I1__001#E2']);
});

test('공식 표: 검토 안 한 병합 후보, 두 번 쓴 무리, ID·표기 섞기, 없는 연결은 오류', () => {
  const g = (gk, id, type) => ({ group_key: gk, bundle_id: gk.split('#')[0], entity_id: id, canonical_name: 'x', entity_type: type, surfaces: ['x'], title_ids: [], item_count: 1 });
  const entities = [g('A2__001#E1', 'char2_x__1', 'character'), g('A2__002#E1', 'char2_x__2', 'character'), g('A2__003#E1', 'org_x', 'organization')];
  const terms = [g('A2__004#E1', undefined, 'item')];
  const base = { schema_version: A2_CURATION_SCHEMA_VERSION };
  const cand = [{ signature: 'character|x', groups: [{ group_key: 'A2__001#E1' }, { group_key: 'A2__002#E1' }] }];
  const has = (out, re) => out.errors.some((e) => re.test(e));
  assert.ok(has(promoteA2({ entities, terms, mergeCandidates: cand, curation: base }), /검토하지 않은 무리/));
  assert.ok(has(promoteA2({ entities, terms, curation: { ...base, merges: [{ groups: ['A2__001#E1', 'A2__002#E1'], canonical_name: 'x', note: 'n' }], separate: [{ groups: ['A2__001#E1'], note: 'n' }] } }), /에도 있다/));
  assert.ok(has(promoteA2({ entities, terms, curation: { ...base, merges: [{ groups: ['A2__001#E1', 'A2__004#E1'], canonical_name: 'x', entity_type: 'character', note: 'n' }] } }), /한데 합칠 수 없다/));
  assert.ok(has(promoteA2({ entities, terms, curation: { ...base, merges: [{ groups: ['A2__001#E1', 'A2__003#E1'], canonical_name: 'x', note: 'n' }] } }), /유형이 섞였다/));
  assert.ok(has(promoteA2({ entities, terms, curation: { ...base, link_overrides: [{ link_id: 'A2__009__009', link_type: 'unresolved', target: null, note: 'n' }] } }), /해소 파일에 없다/));
  assert.ok(has(promoteA2({ entities, terms, curation: { ...base, type_changes: [{ group: 'A2__004#E1', entity_type: 'character', note: 'n' }] } }), /ID 없는 유형/));
});

test('B 갱신: 공식 ID로 바꾼 해소 항목, 판정 바꿈 반영, 채움 줄만 entity_id를 넣고 유형이 다르면 멈춘다', () => {
  const official = {
    id_map: { 'org_x__aaaaaa': 'org_x', 'char2_y': 'char2_y' },
    link_overrides: [{ link_id: 'A2__001__002', link_type: 'unresolved', verdict: '판단 보류', target: null, note: 'n' }],
  };
  const res = officialResolutions([
    { link_id: 'A2__001__001', link_type: 'new_entity', assigned_entity_id: 'org_x__aaaaaa', group_key: 'A2__001#E1', decided_by: 'judge' },
    { link_id: 'A2__001__002', link_type: 'generic_term', target: null, decided_by: 'judge' },
    { link_id: null, link_type: 'alias', target: { entity_id: 'char_지휘관' }, decided_by: 'user' },
  ], official);
  assert.equal(res[0].assigned_entity_id, 'org_x');
  assert.equal(res[1].link_type, 'unresolved');
  assert.equal(res[1].decided_by, 'curation');
  assert.equal(res[2].decided_by, 'user');
  const entities = [{ entity_id: 'org_x', entity_type: 'organization' }, { entity_id: 'char2_y', entity_type: 'character' }];
  const bLinks = [
    { link_id: 'B1__t__001', target: [{ ref: 'entity', entity_id: null, name: 'X', entity_type: 'organization' }] },
    { link_id: 'B1__t__002', target: [{ ref: 'entity', entity_id: null, name: 'Z', entity_type: 'character' }] },
  ];
  const rows = [
    { link_id: 'B1__t__001', target_index: 0, result: 'fill', entity_id: 'org_x', basis: '근거 장면', evidence_scenes: ['s1'] },
    { link_id: 'B1__t__002', target_index: 0, result: 'keep', basis: '없음' },
  ];
  const { links, filled } = applyBUpdate({ bLinks, rows, entities });
  assert.equal(filled, 1);
  assert.equal(links[0].target[0].entity_id, 'org_x');
  assert.equal(links[0].target[0].a2_fill.basis, '근거 장면');
  assert.equal(links[1].target[0].entity_id, null);
  assert.equal(bLinks[0].target[0].entity_id, null); // 원본은 고치지 않는다
  assert.throws(() => applyBUpdate({ bLinks, rows: [{ ...rows[0], entity_id: 'char2_y' }], entities }), /유형이 다르다/);
  assert.throws(() => applyBUpdate({ bLinks, rows: [{ ...rows[0], entity_id: 'org_없음' }], entities }), /공식 표·레지스트리에 없다/);
});

test('B 재판정 묶음: 후보 연결의 단위만 남기고 옛 판정 없이 a2_context를 붙인다', () => {
  const ref = (s, n) => ({ ref: 'item', item_id: `${s}__unk_00${n}`, unknown_id: `unk_${s}_L000${n}` });
  const main = {
    bundle_id: 'B1__t', title_id: 't', generated_at: 'x', script_file: 'data/graph/pass2/bundles/B1__t.script.txt',
    units: [{ unit_id: 'U01', subject_refs: [ref('s1', 1)] }, { unit_id: 'U02', subject_refs: [ref('s1', 2)] }],
    scan: { terms: [{ term: 'a', unit_ids: ['U01', 'U02'] }, { term: 'b', unit_ids: ['U02'] }], dropped_terms: [], hits: [{ scan_id: 'h1', unit_ids: ['U02'] }] },
    routed_to_a2: [{ name: 'x' }],
  };
  const bLinks = [
    { link_id: 'B1__t__001', bundle_id: 'B1__t', subject: [ref('s1', 1)], verdict: '판단 보류' },
    { link_id: 'B1__t__002', bundle_id: 'B1__t', subject: [ref('s1', 2)], verdict: '정체 후보 있음' },
  ];
  const registry = new Map([['char_라피', { entity_id: 'char_라피', canonical_name: '라피' }]]);
  const ctx = a2ContextByTitle({
    resolutions: [
      { title_id: 't', scene_id: 's1', surface: '그녀', link_type: 'alias', target: { entity_id: 'char_라피' }, confidence: '유력한 해석', bundle_id: 'A2__001', unit_id: 'U01', occ_id: 'O0001' },
      { title_id: 't', scene_id: 's1', surface: '김 간호사', link_type: 'new_entity', assigned_entity_id: 'char2_김_간호사', confidence: '유력한 해석', bundle_id: 'A2__001', unit_id: 'U02', occ_id: 'O0001' },
      { title_id: 't', scene_id: 's1', surface: '방주', link_type: 'new_entity', assigned_entity_id: undefined, confidence: '유력한 해석', bundle_id: 'A2__001', unit_id: 'U03', occ_id: 'O0001' },
    ],
    officialEntities: [{ entity_id: 'char2_김_간호사', canonical_name: '김 간호사', entity_type: 'character' }],
    registry,
    occLine: (b, u) => (u === 'U01' ? 5 : 9),
  });
  assert.deepEqual(ctx.get('t').map((x) => `${x.surface}→${x.entity_id}@${x.occurrences[0].line}`), ['그녀→char_라피@5', '김 간호사→char2_김_간호사@9']);
  const { bundles, replaced } = buildRejudgeBundles({ bLinks, candidates: [{ link_id: 'B1__t__001' }], mainBundles: new Map([['B1__t', main]]), contextByTitle: ctx });
  assert.equal(bundles.length, 1);
  const b = bundles[0];
  assert.equal(b.bundle_id, 'B1__t__rj');
  assert.equal(b.rejudge_of, 'B1__t');
  assert.deepEqual(b.units.map((u) => u.unit_id), ['U01']);
  assert.deepEqual(b.scan.terms.map((x) => [x.term, x.unit_ids]), [['a', ['U01']]]);
  assert.equal(b.scan.hits.length, 0);
  assert.deepEqual(b.routed_to_a2, []);
  assert.equal(b.a2_context.length, 2);
  assert.ok(!('generated_at' in b));
  assert.ok(!JSON.stringify(b).includes('판단 보류')); // 옛 판정은 넣지 않는다
  assert.deepEqual(replaced, [{ link_id: 'B1__t__001', bundle_id: 'B1__t', unit_ids: ['U01'] }]);
  assert.throws(() => buildRejudgeBundles({ bLinks, candidates: [{ link_id: 'B1__t__009' }], mainBundles: new Map([['B1__t', main]]), contextByTitle: ctx }), /B 결과에 없다/);
});

test('B 재판정 끼우기: 바꿀 연결 자리에 재판정 연결을 넣고 rejudge_of를 붙이며, 덮는 단위가 다르면 멈춘다', () => {
  const s = (item, v) => ({ ref: 'item', item_id: item, ...(v == null ? {} : { voice_index: v }) });
  const bLinks = [
    { link_id: 'B1__t__001', bundle_id: 'B1__t', subject: [s('a__unk_001')] },
    { link_id: 'B1__t__002', bundle_id: 'B1__t', subject: [s('a__unk_002'), s('a__dca_001', 0)] },
    { link_id: 'B1__u__001', bundle_id: 'B1__u', subject: [s('b__unk_001')] },
  ];
  const replaced = [{ link_id: 'B1__t__002', bundle_id: 'B1__t', unit_ids: ['U02', 'U03'] }];
  const rejudgeLinks = [
    { link_id: 'B1__t__rj__001', bundle_id: 'B1__t__rj', subject: [s('a__dca_001', 0)] },
    { link_id: 'B1__t__rj__002', bundle_id: 'B1__t__rj', subject: [s('a__unk_002')] },
  ];
  const r = applyRejudge({ bLinks, replaced, rejudgeLinks });
  assert.deepEqual(r.links.map((l) => l.link_id), ['B1__t__001', 'B1__t__rj__001', 'B1__t__rj__002', 'B1__u__001']);
  assert.deepEqual(r.links[1].rejudge_of, ['B1__t__002']);
  assert.equal(r.removed, 1);
  assert.equal(r.added, 2);
  assert.throws(() => applyRejudge({ bLinks, replaced, rejudgeLinks: rejudgeLinks.slice(0, 1) }), /덮는 단위 원소가 다르다/);
  assert.throws(() => applyRejudge({ bLinks, replaced: [{ link_id: 'B1__t__009', bundle_id: 'B1__t' }], rejudgeLinks }), /B 결과에 없다/);
  assert.throws(() => applyRejudge({ bLinks, replaced, rejudgeLinks: [...rejudgeLinks, { link_id: 'B1__v__rj__001', bundle_id: 'B1__v__rj', subject: [] }] }), /바꿀 연결이 없다/);
});
