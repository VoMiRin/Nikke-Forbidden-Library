import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignEntityIds,
  buildUnits,
  collectA2Items,
  compareSampling,
  groupOccurrences,
  mergeA2,
  packUnits,
  previewBUpdate,
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
