import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatcher,
  checkExposure,
  clhIndexByScene,
  clueSideIds,
  collectClues,
  evidenceSupportsEnd,
  externalChanges,
  mergeC,
  normalizeEnd,
  packBundles,
  resolveClueKey,
  sampleCAudit,
  carryOverAudit,
  diffCShards,
  auditDrift,
  conflictBundles,
  scanCorpus,
  selectPairs,
  storyOtherClues,
  termsOfUnit,
  validateCShard,
} from './graph/pass2-c.mjs';

// 가짜 장면: 이야기 ta(a1, a2, a3), tb(b1, b2)
const SCRIPTS = {
  a1: ['[SCENE START]', '인물 A: 이 상자는 아직 열어 보면 안 돼.', '인물 B: 왜?', '인물 A: 나중에 알게 될 거야.', '인물 B: 돌아서 가자.', '[SCENE END]'],
  a2: ['[SCENE START]', '인물 B: 아서 경을 만났어.', '인물 A: 그래?', '[SCENE END]'],
  a3: ['[SCENE START]', '인물 A: 상자 안에 있던 건 빈 기차표였어.', '인물 B: 목적지가 없는 표라니.', '[MSG SENDER="인물 C"]', '상자 얘기 들었어', '[MSG_END]', '[SCENE END]'],
  b1: ['[SCENE START]', '인물 C: 7-7-0. 이걸 기억해 둬.', '인물 D: 알았어.', '[SCENE END]'],
  b2: ['[SCENE START]', '인물 D: 7-7-0은 금고 번호였어.', '인물 C: 역시.', '[SCENE END]'],
};
const META = {
  a1: { scene_id: 'a1', title_id: 'ta', index_in_title: 0 },
  a2: { scene_id: 'a2', title_id: 'ta', index_in_title: 1 },
  a3: { scene_id: 'a3', title_id: 'ta', index_in_title: 2 },
  b1: { scene_id: 'b1', title_id: 'tb', index_in_title: 0 },
  b2: { scene_id: 'b2', title_id: 'tb', index_in_title: 1 },
};
const store = {
  has: (id) => id in SCRIPTS,
  meta: (id) => META[id] ?? null,
  lines: (id) => (SCRIPTS[id] ? ['', ...SCRIPTS[id]] : null),
  sceneOrder: new Map([['a1', 0], ['a2', 1], ['a3', 2], ['b1', 3], ['b2', 4]]),
  allSceneIds: function* all() { yield* Object.keys(SCRIPTS); },
};
const clue = (item_id, line_start, line_end, keyword, extra = {}) => ({ item_id, keyword, category: 'item', subject: null, detail: '', quote: '', line_start, line_end, ...extra });
const docs = [
  { title_id: 'ta', category: 'event_stories', scenes: [
    { scene_id: 'a1', clues_and_hooks: [clue('a1__clh_001', 2, 2, '상자'), clue('a1__clh_002', 4, 4, '나중에')] },
    { scene_id: 'a2', clues_and_hooks: [clue('a2__clh_001', 2, 2, '아서')] },
    { scene_id: 'a3', clues_and_hooks: [clue('a3__clh_001', 2, 3, '빈 기차표')] },
  ] },
  { title_id: 'tb', category: 'event_stories', scenes: [
    { scene_id: 'b1', clues_and_hooks: [clue('b1__clh_001', 2, 2, '7-7-0', { category: 'code_or_number' })] },
    { scene_id: 'b2', clues_and_hooks: [clue('b2__clh_001', 2, 2, '7-7-0', { category: 'code_or_number' })] },
  ] },
];
const units = collectClues(docs, store);
const clhById = new Map(units.map((u) => [u.item_id, u]));
const clhByScene = clhIndexByScene(units);
const ctx = { store, clhById, clhByScene, registry: new Map([['char_a', { entity_id: 'char_a' }]]), pass2Entities: new Map(), termKeys: new Set(['A2__001#E1']), releaseDates: null, scanById: new Map([['S0001', { scan_id: 'S0001', scene_id: 'b2', line: 2 }]]) };

const bundle = {
  bundle_id: 'C1__001',
  units: [{ item_id: 'a1__clh_001' }, { item_id: 'a1__clh_002' }, { item_id: 'b1__clh_001' }],
  suggested_pairs: [
    { pair_id: 'C1__001__P01', unit: 'a1__clh_002', other: { ref: 'item', item_id: 'a2__clh_001' } },
    { pair_id: 'C1__001__P02', unit: 'b1__clh_001', other: { ref: 'lines', scan_id: 'S0001', scene_id: 'b2', line_start: 2, line_end: 2 } },
  ],
};
const ev = (scene_id, line_start, line_end, quote) => ({ scene_id, line_start, line_end, quote });
const link = (n, s, t, verdict, roles, evidence, extra = {}) => ({
  link_id: `C1__001__${String(n).padStart(3, '0')}`,
  link_type: 'hook',
  subject: [s],
  target: [t],
  roles,
  verdict,
  confidence: verdict === '판단 보류' ? '판단 보류' : '유력한 해석',
  rationale: '질문: 무엇인가 / 답: 이것이다 / 근거: 원문',
  supporting_evidence: evidence,
  contradicting_evidence: [],
  search_hints: [],
  ...extra,
});
const item = (item_id) => ({ ref: 'item', item_id });
const goodShard = () => ({
  schema_version: 'pass2-0.1.0',
  bundle_id: 'C1__001',
  candidate_links: [
    link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, [ev('a1', 2, 2, '이 상자는 아직 열어 보면 안 돼'), ev('a3', 2, 2, '상자 안에 있던 건 빈 기차표였어')]),
    link(2, item('b1__clh_001'), { ref: 'lines', scene_id: 'b2', line_start: 2, line_end: 2, scan_id: 'S0001' }, '같은 대상', { clue: 'subject', reveal: 'target' }, [ev('b1', 2, 2, '7-7-0. 이걸 기억해 둬'), ev('b2', 2, 2, '7-7-0은 금고 번호였어')]),
  ],
  unlinked: [{ item_id: 'a1__clh_002', reason: '짝 없음', note: '나중에 알게 될 것이 무엇인지' }],
});
const codes = (r) => r.errors.map((e) => e.code);

test('validateCShard: 맞는 출력은 통과한다', () => {
  const r = validateCShard(goodShard(), bundle, ctx);
  assert.deepEqual(r.errors, []);
});

test('validateCShard: 넓은 근거 범위로 끝 범위 검사를 피하지 못한다(설계 R3)', () => {
  const s = goodShard();
  // a3__clh_001은 L2-L3. 인용은 실제로 L4(목적지…)지만 범위를 L1-L4로 넓게 적음 → L4는 T+2 안이라 통과, L1-L6이면 실패
  s.candidate_links[0].supporting_evidence[1] = ev('a3', 1, 6, '상자 얘기 들었어');
  assert.ok(codes(validateCShard(s, bundle, ctx)).includes('BOTH_SIDES_EVIDENCE'));
  assert.equal(evidenceSupportsEnd(ev('a3', 3, 5, 'x'), { scene_id: 'a3', line_start: 2, line_end: 3 }), true);
  assert.equal(evidenceSupportsEnd(ev('a3', 1, 6, 'x'), { scene_id: 'a3', line_start: 2, line_end: 3 }), false);
  assert.equal(evidenceSupportsEnd(ev('a3', 5, 5, 'x'), { scene_id: 'a3', line_start: 2, line_end: 3 }), false); // 겹치지 않음
});

test('validateCShard: lines 범위·scan_id·폭을 검사한다', () => {
  const s = goodShard();
  s.candidate_links[1].target = [{ ref: 'lines', scene_id: 'b2', line_start: 999999, line_end: 999999, scan_id: null }];
  assert.ok(codes(validateCShard(s, bundle, ctx)).includes('REFERENCE'));
  const s2 = goodShard();
  s2.candidate_links[1].target = [{ ref: 'lines', scene_id: 'b2', line_start: 3, line_end: 3, scan_id: 'S0001' }];
  assert.ok(validateCShard(s2, bundle, ctx).errors.some((e) => e.code === 'REFERENCE' && e.path.endsWith('scan_id')));
  const s3 = goodShard();
  s3.candidate_links[1].target = [{ ref: 'lines', scene_id: 'b2', line_start: 2, line_end: 2 }];
  assert.ok(codes(validateCShard(s3, bundle, ctx)).includes('REFERENCE'));
});

test('validateCShard: 같은 장면·roles·양쪽 묶음 밖·단서가 아닌 item', () => {
  const s = goodShard();
  s.candidate_links[0].target = [item('a1__clh_002')];
  assert.ok(codes(validateCShard(s, bundle, ctx)).includes('SAME_SCENE_LINK'));
  const s2 = goodShard();
  s2.candidate_links[0].roles = null;
  assert.ok(codes(validateCShard(s2, bundle, ctx)).includes('ROLES'));
  const s3 = goodShard();
  s3.candidate_links[0].subject = [item('a2__clh_001')];
  assert.ok(codes(validateCShard(s3, bundle, ctx)).includes('REFERENCE'));
  const s4 = goodShard();
  s4.candidate_links[0].target = [item('a3__eac_001')];
  assert.ok(codes(validateCShard(s4, bundle, ctx)).includes('REFERENCE'));
});

test('validateCShard: 공개 쪽으로만 쓰인 단위는 unlinked에 적어야 하고, 단서 쪽 단위는 적으면 안 된다(설계 R1)', () => {
  // b1을 공개 쪽으로 돌림: b1은 단서 쪽 연결이 없어 unlinked가 필요하다
  const s = goodShard();
  s.candidate_links[1].roles = { clue: 'target', reveal: 'subject' };
  assert.ok(validateCShard(s, bundle, ctx).errors.some((e) => e.code === 'UNIT_NOT_COVERED' && e.path === 'b1__clh_001'));
  s.unlinked.push({ item_id: 'b1__clh_001', reason: '단서 아님' });
  assert.deepEqual(codes(validateCShard(s, bundle, ctx)), []);
  const s2 = goodShard();
  s2.unlinked.push({ item_id: 'a1__clh_001', reason: '단서 아님' });
  assert.ok(codes(validateCShard(s2, bundle, ctx)).includes('LINKED_AND_UNLINKED'));
  // 단서 쪽으로 이었어도 남은 의문은 짝 없음(note 필수)으로 적을 수 있다
  const s3 = goodShard();
  s3.unlinked.push({ item_id: 'a1__clh_001', reason: '짝 없음' });
  assert.deepEqual(codes(validateCShard(s3, bundle, ctx)), ['UNLINKED_NOTE']);
  s3.unlinked.at(-1).note = '누가 상자를 보냈는지';
  assert.deepEqual(codes(validateCShard(s3, bundle, ctx)), []);
});

test('validateCShard: 검색어를 다 쓴 짝 없음 단위에 예산 소진 표시가 없으면 경고한다(2회차 보고서 9.3)', () => {
  const warnCodes = (r) => r.warnings.map((w) => w.code);
  const s = goodShard();
  s.candidate_links[1].roles = { clue: 'target', reveal: 'subject' };
  s.unlinked.push({ item_id: 'b1__clh_001', reason: '짝 없음', note: '편지를 쓴 사람이 누구인지' });
  const used = { ...ctx, unitTermCounts: new Map([['b1__clh_001', 3], ['a1__clh_001', 3]]) };
  assert.deepEqual(codes(validateCShard(s, bundle, used)), []);
  assert.deepEqual(warnCodes(validateCShard(s, bundle, used)), ['BUDGET_TAG_MISSING']);
  // 2개만 썼거나, 표시가 있으면 경고하지 않는다
  assert.deepEqual(warnCodes(validateCShard(s, bundle, { ...ctx, unitTermCounts: new Map([['b1__clh_001', 2]]) })), []);
  s.unlinked.at(-1).note = '[검색 예산 소진] 편지를 쓴 사람이 누구인지';
  assert.deepEqual(warnCodes(validateCShard(s, bundle, used)), []);
  // 단서 쪽으로 이은 단위의 남은 의문은 예산 소진과 상관없다
  const s2 = goodShard();
  s2.unlinked.push({ item_id: 'a1__clh_001', reason: '짝 없음', note: '누가 상자를 보냈는지' });
  assert.deepEqual(warnCodes(validateCShard(s2, bundle, used)), []);
});

test('validateCShard: 방향 없는 보류는 양쪽 다 단서 쪽이다', () => {
  const l = link(1, item('a1__clh_002'), item('a2__clh_001'), '판단 보류', null, [ev('a1', 4, 4, '나중에 알게 될 거야'), ev('a2', 2, 2, '아서 경을 만났어')]);
  assert.deepEqual(clueSideIds(l).sort(), ['a1__clh_002', 'a2__clh_001']);
  const s = goodShard();
  s.candidate_links.push({ ...l, link_id: 'C1__001__003' });
  s.unlinked = [];
  assert.deepEqual(codes(validateCShard(s, bundle, ctx)), []);
});

test('validateCShard: 다른 대상은 제시 쌍만, roles는 null, 단서 쪽 연결이 아니다', () => {
  const s = goodShard();
  s.candidate_links.push(link(3, item('a1__clh_002'), item('a2__clh_001'), '다른 대상', null, [ev('a2', 2, 2, '아서 경을 만났어')]));
  assert.deepEqual(codes(validateCShard(s, bundle, ctx)), []);
  const s2 = goodShard();
  s2.candidate_links.push(link(3, item('a1__clh_002'), item('b2__clh_001'), '다른 대상', null, [ev('b2', 2, 2, '7-7-0은 금고 번호였어')]));
  assert.ok(codes(validateCShard(s2, bundle, ctx)).includes('UNSOLICITED_REJECTION'));
});

test('validateCShard: 병합 제안 형식', () => {
  const s = goodShard();
  s.merge_suggestions = [{ suggestion_id: 'C1__001__M01', unit_ids: ['b1__clh_001'], link_ids: ['C1__001__002'], targets: [{ kind: 'entity', id: 'char_a', name: 'A' }, { kind: 'surface', id: null, name: '코드명' }], confidence: '가능성', rationale: '같은 인물', supporting_evidence: [ev('b1', 2, 2, '7-7-0. 이걸 기억해 둬')] }];
  assert.deepEqual(codes(validateCShard(s, bundle, ctx)), []);
  s.merge_suggestions[0].targets[1] = { kind: 'term', id: 'A2__999#E9', name: '없음' };
  assert.ok(codes(validateCShard(s, bundle, ctx)).includes('MERGE_SUGGESTION'));
});

// ---------------------------------------------------------------------------

test('normalizeEnd: 단서 하나 안에 완전히 든 lines만 그 단서로 본다(설계 G4)', () => {
  assert.equal(normalizeEnd({ ref: 'lines', scene_id: 'a3', line_start: 3, line_end: 3 }, clhByScene).key, 'item:a3__clh_001');
  const partial = normalizeEnd({ ref: 'lines', scene_id: 'a3', line_start: 3, line_end: 5 }, clhByScene);
  assert.equal(partial.item_id, null);
  assert.deepEqual(partial.partial, ['a3__clh_001']);
});

const entry = (bundle_id, wave, links, unlinked) => ({ bundle: { bundle_id }, wave, shard: { candidate_links: links, unlinked } });
const judgedOf = (spec) => new Map(Object.entries(spec).map(([id, [bundle_id, wave]]) => [id, { bundle_id, wave, stage: 2, clue_category: 'item' }]));

test('mergeC: 공개 전용은 묶음과 상관없이 전체 연결로 정한다(설계 R1)', () => {
  const l1 = { ...link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__001__001' };
  const entries = [
    entry('C1__001', 1, [l1], []),
    entry('C1__002', 1, [], [{ item_id: 'a3__clh_001', reason: '단서 아님' }, { item_id: 'a2__clh_001', reason: '단서 아님' }]),
  ];
  const m = mergeC({ entries, judged: judgedOf({ 'a1__clh_001': ['C1__001', 1], 'a3__clh_001': ['C1__002', 1], 'a2__clh_001': ['C1__002', 1] }), clhByScene });
  assert.equal(m.statuses.get('a1__clh_001').status, '해결됨');
  assert.equal(m.statuses.get('a3__clh_001').status, '공개 전용');
  assert.equal(m.statuses.get('a2__clh_001').status, '단서 아님');
});

test('mergeC: 공개 쪽으로만 쓰이면 짝 없음이 지워지지 않고, 다른 묶음의 단서 쪽 연결은 짝 없음을 푼다', () => {
  const asReveal = { ...link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__001__001' };
  const asClue = { ...link(1, item('b1__clh_001'), item('b2__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__003__001' };
  const entries = [
    entry('C1__001', 1, [asReveal], []),
    entry('C1__002', 1, [], [{ item_id: 'a3__clh_001', reason: '짝 없음' }, { item_id: 'b1__clh_001', reason: '짝 없음' }]),
    entry('C1__003', 2, [asClue], [{ item_id: 'b2__clh_001', reason: '단서 아님' }]),
  ];
  const judged = judgedOf({ 'a1__clh_001': ['C1__001', 1], 'a3__clh_001': ['C1__002', 1], 'b1__clh_001': ['C1__002', 1], 'b2__clh_001': ['C1__003', 2] });
  const m = mergeC({ entries, judged, clhByScene });
  assert.equal(m.statuses.get('a3__clh_001').status, '짝 없음');
  assert.equal(m.statuses.get('b1__clh_001').status, '해결됨');
  assert.equal(m.statuses.get('b2__clh_001').status, '공개 전용');
  // 2회차가 1회차 단위 b1의 상태를 바꿨다
  const ext = externalChanges({ entries, judged, clhByScene, wave: 2 });
  assert.deepEqual(ext.map((x) => [x.item_id, x.before, x.after]), [['b1__clh_001', '짝 없음', '해결됨']]);
});

test('mergeC: 자기 묶음은 단서 아님인데 다른 묶음이 단서 쪽으로 이으면 상태 충돌', () => {
  const l = { ...link(1, item('b1__clh_001'), item('b2__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__003__001' };
  const entries = [entry('C1__002', 1, [], [{ item_id: 'b1__clh_001', reason: '단서 아님' }]), entry('C1__003', 2, [l], [{ item_id: 'b2__clh_001', reason: '단서 아님' }])];
  const m = mergeC({ entries, judged: judgedOf({ 'b1__clh_001': ['C1__002', 1], 'b2__clh_001': ['C1__003', 2] }), clhByScene });
  assert.equal(m.statuses.get('b1__clh_001').status, '충돌 보류');
  assert.ok(m.conflicts.some((c) => c.kind === 'status' && c.item_id === 'b1__clh_001'));
});

test('mergeC: 같은 쌍의 판정이 묶음마다 다르면 쌍 충돌, 같으면 하나로 합친다(item과 lines가 섞여도)', () => {
  const a = { ...link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, [ev('a1', 2, 2, 'x')]), link_id: 'C1__001__001' };
  const bSame = { ...link(1, item('a3__clh_001'), item('a1__clh_001'), '같은 대상', { clue: 'target', reveal: 'subject' }, [ev('a3', 2, 2, 'y')]), link_id: 'C1__002__001', confidence: '가능성' };
  const judged = judgedOf({ 'a1__clh_001': ['C1__001', 1], 'a3__clh_001': ['C1__002', 1] });
  const m = mergeC({ entries: [entry('C1__001', 1, [a], []), entry('C1__002', 1, [bSame], [{ item_id: 'a3__clh_001', reason: '단서 아님' }])], judged, clhByScene });
  assert.equal(m.links.length, 1);
  assert.equal(m.links[0].confidence, '가능성');
  assert.equal(m.conflicts.length, 0);
  // 같은 공개를 lines로 적고 방향을 반대로
  const bLines = { ...link(1, { ref: 'lines', scene_id: 'a3', line_start: 2, line_end: 2, scan_id: null }, item('a1__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__002__001' };
  const m2 = mergeC({ entries: [entry('C1__001', 1, [a], []), entry('C1__002', 1, [bLines], [{ item_id: 'a3__clh_001', reason: '단서 아님' }])], judged, clhByScene });
  assert.ok(m2.conflicts.some((c) => c.kind === 'pair'));
  assert.equal(m2.statuses.get('a1__clh_001').status, '충돌 보류');
});

// ---------------------------------------------------------------------------

test('packBundles: 이야기 둘 이상의 키 무리가 1단계, 큰 이야기는 장면 경계로 자르고 작은 이야기 묶음을 닫는다', () => {
  const u = (item_id, title_id, scene_id, key, scene_order) => ({ item_id, title_id, scene_id, key, scene_order, line_start: 1, chars: 10 });
  const list = [
    u('x1', 'T1', 's1', 'k:공통', 0), u('x2', 'T2', 's5', 'k:공통', 5),
    u('y1', 'T1', 's1', 'vk:a', 0), u('y2', 'T1', 's2', 'vk:b', 1),
    u('z1', 'T2', 's5', 'vk:c', 5), u('z2', 'T2', 's6', 'vk:d', 6), u('z3', 'T2', 's6', 'vk:e', 6), u('z4', 'T2', 's7', 'vk:f', 7),
    u('w1', 'T3', 's9', 'vk:g', 9),
  ];
  const b = packBundles(list, { titleOrder: ['T1', 'T2', 'T3'], maxUnits: 2, maxChars: 1000 });
  assert.deepEqual(b.map((x) => [x.stage, x.units.map((v) => v.item_id)]), [
    [1, ['x1', 'x2']],
    [2, ['y1', 'y2']],
    [2, ['z1']], // T2는 큰 이야기(4개 > 2): s5 / s6(둘) / s7, 장면을 가르지 않는다
    [2, ['z2', 'z3']],
    [2, ['z4']],
    [2, ['w1']], // 큰 이야기 뒤에는 새 작은 묶음
  ]);
  const others = storyOtherClues(b, list, new Map());
  assert.deepEqual(others[2].map((v) => v.item_id), ['x2', 'z2', 'z3', 'z4']);
  assert.deepEqual(others[0].map((v) => v.item_id), ['y1', 'z1']); // 1단계: 같은 이야기의 다른 1단계 단서 + 같은 장면 2단계 단서
  const exp = checkExposure(b, storyOtherClues(b, list, new Map()));
  assert.deepEqual(exp.missing, []);
});

test('checkExposure: 1단계끼리 다른 묶음이면 색인으로 보인다', () => {
  const u = (item_id, title_id, scene_id, key) => ({ item_id, title_id, scene_id, key, scene_order: Number(scene_id.slice(1)), line_start: 1, chars: 10 });
  const list = [u('p1', 'T1', 's1', 'k:a'), u('p2', 'T2', 's8', 'k:a'), u('q1', 'T1', 's2', 'k:b'), u('q2', 'T2', 's9', 'k:b')];
  const b = packBundles(list, { titleOrder: ['T1', 'T2'], maxUnits: 2, maxChars: 1000 });
  assert.equal(b.length, 2);
  const others = storyOtherClues(b, list, new Map());
  assert.deepEqual(checkExposure(b, others).missing, []);
  assert.deepEqual(checkExposure(b, [[], []]).missing.length, 2);
});

test('resolveClueKey: A-2 출현 줄 → 장면 → 전역 사전 → 변형 열쇠', () => {
  const occIndex = new Map([['a1', [
    { vk: '상자', line_start: 2, line_end: 2, keys: new Set(['term:A2__001#E1']) },
    { vk: '상자', line_start: 9, line_end: 9, keys: new Set(['term:A2__002#E1']) },
  ]]]);
  const dictionary = new Map([['아서', new Set(['ent:char_아서'])], ['기차표', new Set(['term:x', 'term:y'])]]);
  const a = { scene_id: 'a1', keyword: '상자', line_start: 2, line_end: 2 };
  assert.deepEqual(resolveClueKey(a, { occIndex, dictionary }), { key: 'term:A2__001#E1', via: 'a2_line' });
  assert.equal(resolveClueKey({ ...a, line_start: 5, line_end: 5 }, { occIndex, dictionary }).via, 'variant'); // 장면 안 키가 둘
  assert.deepEqual(resolveClueKey({ scene_id: 'a2', keyword: '아 서', line_start: 2, line_end: 2 }, { occIndex, dictionary }), { key: 'ent:char_아서', via: 'dictionary' });
  assert.equal(resolveClueKey({ scene_id: 'a2', keyword: '기차표', line_start: 2, line_end: 2 }, { occIndex, dictionary }).key, 'vk:기차표');
});

test('C-0: 제어 태그 안 말은 검색어가 아니고, 두 글자 한글은 어절 앞에서만 맞춘다', () => {
  const t = termsOfUnit({ keyword: '상자', quote: '[MSG SENDER="인물 C"]\n상자 "빈 기차표" 얘기', detail: '' });
  assert.deepEqual([...t.keys()].sort(), ['빈 기차표', '상자']);
  const scan = scanCorpus(store, new Set(['아서', '7-7-0', '상자']));
  assert.deepEqual(scan.get('아서').hits.map((h) => h.scene_id), ['a2']); // a1 "돌아서"는 빼고
  assert.deepEqual([...scan.get('7-7-0').scenes].sort(), ['b1', 'b2']);
  assert.deepEqual([...scan.get('상자').scenes].sort(), ['a1', 'a3']);
  const m = buildMatcher(['he', 'she', 'hers']);
  assert.deepEqual(m('ushers').found.sort(), [[0, 2], [1, 1], [2, 2]]);
});

test('selectPairs: 우선순위, 단위당·묶음당 상한, 무방향 중복 제거', () => {
  const c = (unit, other, priority) => ({ unit, other: { ref: 'item', item_id: other }, priority, source: 's', cross_title: false });
  const pairs = selectPairs('C1__001', [c('u1', 'v3', 4), c('u1', 'v1', 1), c('u1', 'v2', 2), c('u1', 'v4', 3), c('v1', 'u1', 1), c('u2', 'v9', 1)], { perUnit: 3, perBundle: 3 });
  assert.deepEqual(pairs.map((p) => [p.unit, p.other.item_id]), [['u1', 'v1'], ['u2', 'v9'], ['u1', 'v2']]);
});

test('sampleCAudit: 단서 아님 3배·해결됨 2배, 층마다 최소 1개, 전수 항목은 따로', () => {
  const statuses = new Map();
  const unitsList = [];
  for (let i = 0; i < 20; i++) {
    const id = `s${i}__clh_001`;
    const status = i < 10 ? '단서 아님' : i < 15 ? '해결됨' : '짝 없음';
    statuses.set(id, { status, conf: status === '해결됨' ? '유력한 해석' : '해당 없음' });
    unitsList.push({ item_id: id, bundle_id: 'C1__001', stage: 2, title_id: 't', scene_id: `s${i}`, scene_order: i });
  }
  const r = sampleCAudit({ units: unitsList, statuses, linksByItem: new Map(), bundlePaths: new Map([['C1__001', {}]]), others: new Map(), rate: 0.1, extra: { externalChanges: [{ item_id: 'x' }], mergeSuggestions: [{ suggestion_id: 'C1__001__M01', bundle_id: 'C1__001' }] } });
  const by = Object.fromEntries(r.strata.map((s) => [s.stratum, s.sampled]));
  assert.deepEqual(by, { '단서 아님/해당 없음/2단계': 3, '짝 없음/해당 없음/2단계': 1, '해결됨/유력한 해석/2단계': 1 });
  assert.equal(r.extra_items, 2);
  // 외부 변경 항목에 현재 상태(남은 의문 포함)가 실린다(2회차 3차 감사 판단 불가)
  statuses.set('x', { status: '해결됨', conf: '유력한 해석', residual: '남은 의문' });
  const r2 = sampleCAudit({ units: unitsList, statuses, linksByItem: new Map(), bundlePaths: new Map([['C1__001', {}]]), others: new Map(), extra: { externalChanges: [{ item_id: 'x', before: '짝 없음', after: '해결됨' }] } });
  assert.equal(r2.items.find((x) => x.audit_id === 'ext:x').status.residual, '남은 의문');
  assert.throws(() => sampleCAudit({ units: unitsList, statuses, linksByItem: new Map(), bundlePaths: new Map([['C1__001', {}]]), others: new Map(), includeIds: ['C1__009:없음'] }));
  // 전수 항목은 사라져도 멈추지 않는다
  sampleCAudit({ units: unitsList, statuses, linksByItem: new Map(), bundlePaths: new Map([['C1__001', {}]]), others: new Map(), includeIds: ['ext:없어짐'] });
});

test('validateCShard: 같은 대상·보류의 rationale 형식, 링크·제안 ID 형식과 중복(GPT 규칙 검수 3·9)', () => {
  const s = goodShard();
  s.candidate_links[0].rationale = '그냥 이어짐';
  assert.ok(codes(validateCShard(s, bundle, ctx)).includes('RATIONALE_FORM'));
  const s2 = goodShard();
  s2.candidate_links[0].link_id = 'C1__001__000';
  assert.ok(codes(validateCShard(s2, bundle, ctx)).includes('SCHEMA'));
  const s3 = goodShard();
  const m = { suggestion_id: 'C1__001__M01', unit_ids: ['b1__clh_001'], link_ids: [], targets: [{ kind: 'surface', id: null, name: 'A' }, { kind: 'surface', id: null, name: 'B' }], confidence: '가능성', rationale: 'r', supporting_evidence: [ev('b1', 2, 2, '7-7-0. 이걸 기억해 둬')] };
  s3.merge_suggestions = [m, { ...m }];
  assert.ok(validateCShard(s3, bundle, ctx).errors.some((e) => e.message.includes('중복')));
  s3.merge_suggestions = [{ ...m, suggestion_id: 'C1__001__Mbanana' }];
  assert.ok(codes(validateCShard(s3, bundle, ctx)).includes('MERGE_SUGGESTION'));
});

test('validateCShard: 제시 쌍 기각은 item·lines 어느 쪽으로 적어도 같은 정규화로 맞춘다(GPT 규칙 검수 1)', () => {
  // 제시 쌍: b1 ↔ lines S0001(b2 L2, 단서 b2__clh_001 안에 완전히 듦) → item으로 적어도, lines로 적어도 통과
  const rej = (target) => link(3, item('b1__clh_001'), target, '다른 대상', null, [ev('b2', 2, 2, '7-7-0은 금고 번호였어')]);
  const base = () => {
    const s = goodShard();
    s.candidate_links = [s.candidate_links[0]];
    s.unlinked.push({ item_id: 'b1__clh_001', reason: '단서 아님' });
    return s;
  };
  for (const t of [item('b2__clh_001'), { ref: 'lines', scene_id: 'b2', line_start: 2, line_end: 2, scan_id: 'S0001' }, { ref: 'lines', scene_id: 'b2', line_start: 2, line_end: 2, scan_id: null }]) {
    const s = base();
    s.candidate_links.push(rej(t));
    assert.deepEqual(codes(validateCShard(s, bundle, ctx)), [], JSON.stringify(t));
  }
});

test('mergeC: 단서 쪽으로 이었는데 짝 없음도 적은 단위는 해결됨 + 남은 의문', () => {
  const l = { ...link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__001__001' };
  const m = mergeC({ entries: [entry('C1__001', 1, [l], [{ item_id: 'a1__clh_001', reason: '짝 없음', note: '[검색 예산 소진] 누가 보냈는지' }, { item_id: 'a3__clh_001', reason: '단서 아님' }])], judged: judgedOf({ 'a1__clh_001': ['C1__001', 1], 'a3__clh_001': ['C1__001', 1] }), clhByScene });
  const st = m.statuses.get('a1__clh_001');
  assert.equal(st.status, '해결됨');
  assert.equal(st.residual, '[검색 예산 소진] 누가 보냈는지');
  assert.equal(st.budget_exhausted, true);
});

test('sampleCAudit: 감사 항목 ID가 겹치면 멈춘다(GPT 규칙 검수 9)', () => {
  const statuses = new Map([['a__clh_001', { status: '짝 없음', conf: '해당 없음' }]]);
  const units1 = [{ item_id: 'a__clh_001', bundle_id: 'C1__001', stage: 2, title_id: 't', scene_id: 'a', scene_order: 0 }];
  const dup = { suggestion_id: 'C1__001__M01', bundle_id: 'C1__001' };
  assert.throws(() => sampleCAudit({ units: units1, statuses, linksByItem: new Map(), bundlePaths: new Map([['C1__001', {}]]), others: new Map(), extra: { mergeSuggestions: [dup, dup] } }), /겹친다/);
});

test('carryOverAudit: 뒤 회차 PASS 감사가 덮은 앞 회차 shard 변경만 이어 인정한다', async () => {
  const { createHash } = await import('node:crypto');
  const h = (t) => createHash('sha256').update(t).digest('hex');
  const link = (id, rationale) => ({ link_id: id, subject: [{ ref: 'item', item_id: 'a__clh_001' }], target: [{ ref: 'item', item_id: 'b__clh_001' }], rationale });
  const oldShard = JSON.stringify({ candidate_links: [link('C1__001__001', '옛'), link('C1__001__002', '그대로')], unlinked: [], merge_suggestions: [] });
  const newShard = JSON.stringify({ candidate_links: [link('C1__001__001', '새'), link('C1__001__002', '그대로')], unlinked: [], merge_suggestions: [] });
  assert.deepEqual(diffCShards(JSON.parse(oldShard), JSON.parse(newShard)).links, ['C1__001__001']);
  const stamp = (shard) => ({ bundle_id: 'C1__001', rules_sha256: 'r', input_sha256: 'i', shard_sha256: h(shard) });
  const items = [{ audit_id: 'C1__001:x__clh_001', item_id: 'x__clh_001', links: [] }];
  const audited = { bundle_stamps: [stamp(oldShard)], items };
  const current = [stamp(newShard)];
  const laterInput = { bundle_stamps: [stamp(newShard), { bundle_id: 'C1__002' }], items: [{ audit_id: 'C1__002:b__clh_001', item_id: 'b__clh_001', links: [{ link_id: 'C1__001__001' }] }] };
  const base = { audited, current, snapshots: new Map([['C1__001', oldShard]]), shardsNow: new Map([['C1__001', newShard]]), regenerated: items, later: [{ wave: 2, input: laterInput }] };
  const ok = carryOverAudit(base);
  assert.ok(ok.ok, ok.errors.join('\n'));
  assert.deepEqual(ok.changes[0].covered_by, [2]);
  // 뒤 회차 감사가 PASS가 아니면(later에 없으면) 덮지 못한다
  assert.ok(carryOverAudit({ ...base, later: [] }).errors.some((e) => e.includes('덮지 않은 변경')));
  // 뒤 회차 감사가 옛 shard를 봤으면 덮지 못한다
  assert.ok(!carryOverAudit({ ...base, later: [{ wave: 2, input: { ...laterInput, bundle_stamps: [stamp(oldShard)] } }] }).ok);
  // 스냅숏이 없거나 도장과 다르면 안 된다
  assert.ok(!carryOverAudit({ ...base, snapshots: new Map() }).ok);
  assert.ok(!carryOverAudit({ ...base, snapshots: new Map([['C1__001', newShard]]) }).ok);
  // 다시 만든 항목이 달라지면 안 된다
  assert.ok(!carryOverAudit({ ...base, regenerated: [{ ...items[0], links: [{ link_id: 'C1__001__001' }] }] }).ok);
  // 규칙이 바뀌면 안 된다
  assert.ok(!carryOverAudit({ ...base, current: [{ ...current[0], rules_sha256: 'r2' }] }).ok);
  // 자기 상태 변경은 그 단위가 뒤 회차 항목이어야 덮는다
  const unl = JSON.stringify({ ...JSON.parse(newShard), unlinked: [{ item_id: 'a__clh_001', reason: '짝 없음', note: 'n' }] });
  const r = carryOverAudit({ ...base, current: [stamp(unl)], shardsNow: new Map([['C1__001', unl]]), later: [{ wave: 2, input: { ...laterInput, bundle_stamps: [stamp(unl)] } }] });
  assert.ok(r.errors.some((e) => e.includes('자기 상태 a__clh_001')));
});

test('auditDrift: 앞 회차 감사 뒤 그 회차 shard를 고쳐 바뀐 상태만 잡는다', () => {
  const l1 = { ...link(1, item('a1__clh_001'), item('a3__clh_001'), '같은 대상', { clue: 'subject', reveal: 'target' }, []), link_id: 'C1__001__001' };
  const audited = { candidate_links: [l1], unlinked: [] };
  const fixed = { candidate_links: [], unlinked: [{ item_id: 'a1__clh_001', reason: '단서 아님' }] };
  const entries = [
    { bundle: { bundle_id: 'C1__001' }, wave: 1, shard: fixed },
    entry('C1__002', 1, [], [{ item_id: 'a3__clh_001', reason: '단서 아님' }]),
  ];
  const judged = judgedOf({ 'a1__clh_001': ['C1__001', 1], 'a3__clh_001': ['C1__002', 1] });
  const d = auditDrift({ entries, judged, clhByScene, wave: 1, snapshots: new Map([['C1__001', audited]]) });
  assert.deepEqual(d.map((x) => [x.item_id, x.before, x.after]).sort(), [['a1__clh_001', '해결됨', '단서 아님'], ['a3__clh_001', '공개 전용', '단서 아님']]);
  assert.deepEqual(auditDrift({ entries, judged, clhByScene, wave: 1, snapshots: new Map() }), []);
});

test('carryOverAudit: 다시 만든 표본이 늘어도 그 단위를 뒤 회차 PASS 감사가 덮으면 인정한다', async () => {
  const { createHash } = await import('node:crypto');
  const h = (t) => createHash('sha256').update(t).digest('hex');
  const oldShard = JSON.stringify({ candidate_links: [{ link_id: 'C1__001__001', subject: [{ ref: 'item', item_id: 'a__clh_001' }], target: [{ ref: 'item', item_id: 'b__clh_001' }] }], unlinked: [], merge_suggestions: [] });
  const newShard = JSON.stringify({ candidate_links: [], unlinked: [], merge_suggestions: [] });
  const stamp = (shard) => ({ bundle_id: 'C1__001', rules_sha256: 'r', input_sha256: 'i', shard_sha256: h(shard) });
  const items = [{ audit_id: 'C1__001:x__clh_001', item_id: 'x__clh_001', links: [] }];
  const regenerated = [...items, { audit_id: 'C1__001:a__clh_001', item_id: 'a__clh_001', links: [] }];
  const later = (laterItems) => [{ wave: 2, input: { bundle_stamps: [stamp(newShard)], items: laterItems } }];
  const base = { audited: { bundle_stamps: [stamp(oldShard)], items }, current: [stamp(newShard)], snapshots: new Map([['C1__001', oldShard]]), shardsNow: new Map([['C1__001', newShard]]), regenerated };
  // 새 표본 a와 지운 연결의 끝 a를 외부 변경 항목이 덮는다
  const ok = carryOverAudit({ ...base, later: later([{ audit_id: 'ext:a__clh_001', kind: 'external_change', item_id: 'a__clh_001', links: [] }]) });
  assert.ok(ok.ok, ok.errors.join('\n'));
  const no = carryOverAudit({ ...base, later: later([{ audit_id: 'C1__002:z__clh_001', item_id: 'z__clh_001', links: [] }]) });
  assert.ok(no.errors.some((e) => e.includes('C1__001:a__clh_001')));
  // 감사한 항목이 빠지면 안 된다
  assert.ok(!carryOverAudit({ ...base, regenerated: regenerated.slice(1), later: later([{ audit_id: 'ext:a__clh_001', item_id: 'a__clh_001', links: [] }]) }).ok);
});

test('conflictBundles: 일부 겹침 충돌은 만난 연결(meets)의 묶음도 걸린 묶음으로 본다', () => {
  const c = { kind: 'partial_line_item_overlap', link_id: 'C1__002__001', bundle_id: 'C1__002', lines: 'lines:s:60-70', overlapped_items: ['s__clh_001', 's__clh_002'], meets: ['C1__028__004', 'C1__028__010'] };
  assert.deepEqual(conflictBundles(c), ['C1__002', 'C1__028']);
  assert.deepEqual(conflictBundles({ kind: 'status', item_id: 'x', own: { bundle_id: 'C1__006' }, links: [{ link_id: 'C1__039__006', bundle_id: 'C1__039', wave: 2 }] }), ['C1__006', 'C1__039']);
});
