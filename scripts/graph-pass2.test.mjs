import assert from 'node:assert/strict';
import test from 'node:test';
import { checkQuote, compareRelease, makeTermMatcher } from './graph/pass2-lib.mjs';
import {
  buildUnitsForTitle,
  checkReview,
  classifyAuthor,
  enrichLink,
  scoreB,
  validateBShard,
} from './graph/pass2-b.mjs';

// 가짜 장면 두 개: s1(이야기 t1)에 ??? 세 줄(둘은 한 묶음), s2(이야기 t2)에 정체 공개
const SCRIPTS = {
  s1: ['[SCENE START]', '???: 손, 대지, 마.', '라피: 너···! 누구냐···!', '???: 죽는, 다.', '???: 와아아!', '[SCENE END]'],
  s2: ['[SCENE START]', '그레이브: ···그레이브.', '그레이브: 그렇게, 불러, 라.', '[SCENE END]'],
};
const META = {
  s1: { scene_id: 's1', title_id: 't1', index_in_title: 0, mgt: { line_speaker: { 2: '???', 3: '라피', 4: '???', 5: '???' } } },
  s2: { scene_id: 's2', title_id: 't2', index_in_title: 0, mgt: { line_speaker: { 2: '그레이브', 3: '그레이브' } } },
};
const store = {
  has: (id) => id in SCRIPTS,
  meta: (id) => META[id] ?? null,
  lines: (id) => (SCRIPTS[id] ? ['', ...SCRIPTS[id]] : null),
  sceneOrder: new Map([['s1', 0], ['s2', 1]]),
};
const registry = new Map([['char_그레이브', { entity_id: 'char_그레이브', surface_labels: ['그레이브'] }]]);
const ctx = { store, registry, pass2Entities: new Map() };

const titleDoc = {
  title_id: 't1',
  scenes: [
    {
      scene_id: 's1',
      unknown_speakers: [
        { item_id: 's1__unk_001', unknown_id: 'unk_s1_L0002', line: 2, quote: '손, 대지, 마.', speaking_style: '끊어 말함', target_addressed: '라피', contextual_clues: ["'언노운'으로 불림"], resolved_in_same_scene_to: null },
        { item_id: 's1__unk_002', unknown_id: 'unk_s1_L0004', line: 4, quote: '죽는, 다.', speaking_style: '끊어 말함', target_addressed: null, contextual_clues: [], resolved_in_same_scene_to: null },
        { item_id: 's1__unk_003', unknown_id: 'unk_s1_L0005', line: 5, quote: '와아아!', speaking_style: '함성', target_addressed: null, contextual_clues: [], resolved_in_same_scene_to: null },
      ],
      descriptor_speakers: [],
      same_scene_speaker_groups: [{ unknown_ids: ['unk_s1_L0002', 'unk_s1_L0004'], confidence: '유력한 해석', reason: '같은 어투' }],
      forms_of_address: [{ from_speaker: '라피', to_target: '???', address_term: '너', line_start: 3, line_end: 3 }],
      participants: { mentioned_only: [], document_author: null },
      unregistered_entity_candidates: [],
      clues_and_hooks: [],
    },
  ],
};
const built = buildUnitsForTitle(titleDoc, store, { genericLabels: new Set(), registry });
const bundle = { bundle_id: 'B1__t1', units: built.units };

const ev = (scene_id, line_start, line_end, quote, extra = {}) => ({ scene_id, line_start, line_end, quote, ...extra });
const goodShard = () => ({
  schema_version: 'pass2-0.1.0',
  bundle_id: 'B1__t1',
  candidate_links: [
    {
      link_id: 'B1__t1__001',
      link_type: 'identity',
      subject: [
        { ref: 'item', item_id: 's1__unk_001', unknown_id: 'unk_s1_L0002' },
        { ref: 'item', item_id: 's1__unk_002', unknown_id: 'unk_s1_L0004' },
      ],
      target: [{ ref: 'entity', entity_id: 'char_그레이브', name: '그레이브', entity_type: 'character' }],
      verdict: '정체 후보 있음',
      confidence: '유력한 해석',
      rationale: '같은 끊어 말하는 어투이고 s2에서 이름을 밝힌다.',
      supporting_evidence: [ev('s1', 2, 2, '손, 대지, 마.', { reveals_identity: false }), ev('s2', 2, 3, '그레이브: ···그레이브.\n그레이브: 그렇게, 불러, 라.', { reveals_identity: true })],
      contradicting_evidence: [],
      alternatives: [],
      search_hints: [],
    },
    {
      link_id: 'B1__t1__002',
      link_type: 'crowd',
      subject: [{ ref: 'item', item_id: 's1__unk_003', unknown_id: 'unk_s1_L0005' }],
      target: [],
      verdict: '군중·엑스트라',
      confidence: '가능성',
      rationale: '함성 한 줄이고 받는 말이 없다.',
      supporting_evidence: [ev('s1', 5, 5, '와아아!')],
      contradicting_evidence: [],
      alternatives: [],
      search_hints: [],
    },
  ],
});
const codes = (r) => r.errors.map((e) => e.code);

test('B-0: 같은 장면 화자 묶음은 한 단위, 묶이지 않은 줄은 한 줄이 한 단위', () => {
  assert.equal(built.units.length, 2);
  assert.equal(built.units[0].unit_type, 'unknown_group');
  assert.deepEqual(built.units[0].subject_refs.map((r) => r.unknown_id), ['unk_s1_L0002', 'unk_s1_L0004']);
  assert.equal(built.units[1].unit_type, 'unknown_line');
  // 인용 부호 안의 지칭은 검색어가 되고, 대명사 호칭(너)은 빠진다
  assert.equal(built.units[0]._terms.has('언노운'), true);
  assert.equal(built.units[0]._terms.has('너'), false);
});

test('작성자 가르기: 가린 지칭·일반 역할은 B, 미등록 인물 후보와 같은 이름은 A-2, 나머지는 표시를 붙여 B', () => {
  const generic = new Set(['소녀', '의사']);
  assert.equal(classifyAuthor(null, {}, generic).route, 'B');
  assert.equal(classifyAuthor('비공식 보고서 작성자', {}, generic).route, 'B');
  assert.equal(classifyAuthor('어느 소녀', {}, generic).route, 'B');
  const withCand = { unregistered_entity_candidates: [{ surface_text: '마리아', suggested_type: 'character' }] };
  assert.equal(classifyAuthor('마리아', withCand, generic).route, 'A2');
  const unclear = classifyAuthor('광고 팜플렛', {}, generic);
  assert.equal(unclear.route, 'B');
  assert.equal(unclear.flag, 'unclear_author');
});

test('검증기: 올바른 B 출력은 통과', () => {
  const r = validateBShard(goodShard(), bundle, ctx);
  assert.deepEqual(r.errors, []);
});

test('검증기: 빠진 단위, 지어낸 참조, 중복 참조', () => {
  const s = goodShard();
  s.candidate_links.pop();
  s.candidate_links[0].subject.push({ ref: 'item', item_id: 's1__unk_009', unknown_id: 'unk_s1_L0009' });
  s.candidate_links[0].subject.push({ ref: 'item', item_id: 's1__unk_001', unknown_id: 'unk_s1_L0002' });
  const c = codes(validateBShard(s, bundle, ctx));
  assert.ok(c.includes('UNIT_NOT_COVERED'));
  assert.ok(c.includes('SUBJECT_NOT_IN_BUNDLE'));
  assert.ok(c.includes('SUBJECT_DUPLICATE'));
});

test('검증기: 인용 위치, 레지스트리에 없는 ID, C 전용·병합기 필드, 확인된 사실', () => {
  const s = goodShard();
  s.candidate_links[0].supporting_evidence[1].quote = '그런 말은 없다';
  s.candidate_links[0].target[0].entity_id = 'char_없는사람';
  s.candidate_links[0].roles = { clue: 'subject', reveal: 'target' };
  s.candidate_links[0].release_order = '단서 먼저';
  s.candidate_links[1].confidence = '확인된 사실';
  s.unlinked = [];
  const c = codes(validateBShard(s, bundle, ctx));
  for (const code of ['QUOTE_LOCATION', 'ENTITY_ID_NOT_IN_REGISTRY', 'FORBIDDEN_FIELD', 'FORBIDDEN_CONFIDENCE']) assert.ok(c.includes(code), code);
});

test('검증기: 군중·보류·근거 규칙', () => {
  const s = goodShard();
  s.candidate_links[1].target = [{ ref: 'entity', entity_id: null, name: '병사', entity_type: 'character' }];
  s.candidate_links[1].supporting_evidence[0].reveals_identity = false; // crowd 근거에는 못 씀
  s.candidate_links[0].supporting_evidence.forEach((e) => delete e.reveals_identity); // identity 근거에는 필수
  const c = codes(validateBShard(s, bundle, ctx));
  assert.ok(c.includes('TARGET'));
  assert.ok(c.includes('FORBIDDEN_FIELD'));
  assert.ok(c.includes('SCHEMA'));

  const s2 = goodShard();
  s2.candidate_links[0].verdict = '판단 보류';
  s2.candidate_links[0].target.push({ ref: 'entity', entity_id: null, name: '다른 후보', entity_type: 'character' });
  const c2 = codes(validateBShard(s2, bundle, ctx));
  assert.ok(c2.includes('VERDICT')); // 보류인데 confidence가 유력한 해석, reveals_identity: true
  assert.ok(c2.includes('TARGET')); // 보류의 target은 하나까지
  const s4 = goodShard();
  delete s4.candidate_links[0].rationale;
  assert.ok(codes(validateBShard(s4, bundle, ctx)).includes('SCHEMA'));
  const s3 = goodShard();
  s3.candidate_links[1].supporting_evidence = [];
  assert.ok(codes(validateBShard(s3, bundle, ctx)).includes('EVIDENCE'));
});

test('검증기: 근거가 판정 대상 줄뿐인 후보는 경고', () => {
  const s = goodShard();
  s.candidate_links[0].supporting_evidence = [ev('s1', 2, 2, '손, 대지, 마.', { reveals_identity: false })];
  const r = validateBShard(s, bundle, ctx);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.code === 'EVIDENCE_ONLY_SUBJECT_LINES'));
});

test('인용 검사: 화자 라벨을 떼거나 붙인 인용 모두 통과, 범위 밖은 실패', () => {
  const lines = store.lines('s2');
  assert.equal(checkQuote(lines, 2, 3, '···그레이브. 그렇게, 불러, 라.'), null);
  assert.equal(checkQuote(lines, 2, 2, '그레이브: ···그레이브.'), null);
  assert.ok(checkQuote(lines, 2, 9, '그레이브'));
});

test('공개 순서: 날짜 → 같은 분류 안에서만 order → 월만 아는 날짜', () => {
  const rd = new Map([
    ['a', { category: 'main_story', order: 1, release_date: '2024-02-22' }],
    ['b', { category: 'main_story', order: 2, release_date: '2024-04-25' }],
    ['c', { category: 'main_story', order: 3, release_date: '2024-04-25' }],
    ['d', { category: 'event_stories', order: 1, release_date: '2024-04-25' }],
    ['e', { category: 'lost_relics', order: 1, release_date: '2024-04' }],
  ]);
  assert.equal(compareRelease(rd, 'a', 'b').result, '단서 먼저');
  assert.equal(compareRelease(rd, 'c', 'b').result, '공개 먼저');
  assert.equal(compareRelease(rd, 'b', 'd').result, '앞뒤 미정');
  assert.equal(compareRelease(rd, 'e', 'b').result, '앞뒤 미정');
  assert.equal(compareRelease(rd, 'a', 'x').result, '공개 시점 없음');
  assert.equal(compareRelease(rd, 'a', 'a').result, '같은 이야기');
});

test('병합기: evidence_scenes와 release_order(공개 근거 없으면 공개 미확인)', () => {
  const rd = new Map([
    ['t1', { category: 'main_story', order: 1, release_date: '2024-02-22' }],
    ['t2', { category: 'main_story', order: 2, release_date: '2024-04-25' }],
  ]);
  const [l1, l2] = goodShard().candidate_links;
  const e1 = enrichLink(l1, bundle, { store, releaseDates: rd });
  assert.equal(e1.release_order[0].result, '단서 먼저');
  assert.ok(e1.evidence_scenes.some((r) => r.scene_id === 's2' && r.line_start === 2));
  assert.equal(enrichLink(l2, bundle, { store, releaseDates: rd }).release_order, null);
  const noReveal = { ...l1, supporting_evidence: [l1.supporting_evidence[0]] };
  assert.equal(enrichLink(noReveal, bundle, { store, releaseDates: rd }).release_order, '공개 미확인');
});

test('검색어: 영문 코드는 낱말 경계, 한글은 부분 문자열', () => {
  assert.equal(makeTermMatcher('X')('D: X가 말했다'), true);
  assert.equal(makeTermMatcher('X')('XOXO'), false);
  assert.equal(makeTermMatcher('언노운')('언노운은 말했다'), true);
});

test('독립 검토 형식과 평가 지표', () => {
  const links = goodShard().candidate_links.map((l) => ({ bundle_id: 'B1__t1', ...l }));
  const input = { items: links.map((l) => ({ link_id: l.link_id })) };
  const bad = checkReview(input, { reviews: [{ link_id: 'B1__t1__001', judgment: '틀림', problems: [], reason: '' }] });
  assert.ok(bad.errors.length >= 3);
  const review = {
    reviews: [
      { link_id: 'B1__t1__001', judgment: '맞음', problems: [], reason: 'L2~3에서 이름을 밝힘' },
      { link_id: 'B1__t1__002', judgment: '틀림', problems: ['should_not_be_crowd'], reason: '대답하는 줄이 있음' },
    ],
  };
  assert.deepEqual(checkReview(input, review).errors, []);
  const plan = { bundles: [{ bundle_id: 'B1__t1' }] };
  const s = scoreB({
    plan,
    bundles: new Map([['B1__t1', bundle]]),
    merged: { links },
    answers: [
      { bundle_id: 'B1__t1', unit_id: 'U01', answer: { entity_id: 'char_그레이브' } },
      { bundle_id: 'B1__t1', unit_id: 'U02', answer: { name: '그레이브' } },
    ],
    review,
  });
  assert.equal(s.omission.rate, 0);
  assert.equal(s.candidate_recall.hit, 1);
  assert.equal(s.mislink.rate, 0.5);
});
