import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { planWaves, sampleAuditCases, selectWave, splitBundle } from './graph/pass2-b-plan.mjs';
import { checkQuote, compareRelease, makeTermMatcher } from './graph/pass2-lib.mjs';
import {
  buildUnitsForTitle,
  checkAudit,
  checkReview,
  classifyAuthor,
  computeStamp,
  enrichLink,
  scoreB,
  staleReason,
  validateBShard,
} from './graph/pass2-b.mjs';

// 가짜 장면 두 개: s1(이야기 t1)에 ??? 세 줄(둘은 한 묶음), s2(이야기 t2)에 정체 공개
const SCRIPTS = {
  s1: ['[SCENE START]', '???: 손, 대지, 마.', '라피: 너···! 누구냐···!', '???: 죽는, 다.', '???: 와아아!', '[SCENE END]'],
  s2: ['[SCENE START]', '그레이브: ···그레이브.', '그레이브: 그렇게, 불러, 라.', '[SCENE END]'],
  // 파일럿 검토자가 원문에 없는 문장을 인용한 두 줄(main_06_01 L36, main_30_07 L108)의 실제 내용
  r1: ['루드밀라: 그래. 순례자는 북부에서 뭔가를 찾고 있는 모양이다.', '[NEXT_SUBCHAPTER_BUTTON TEXT="다음으로 이동"]', '  [OPTION TEXT="스노우 화이트···?"]'],
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

test('검증기: 단위를 넘어 합치는 것은 같은 라벨의 묘사형·작성자만 허용', () => {
  const s = goodShard();
  s.candidate_links[0].subject.push(s.candidate_links[1].subject[0]);
  s.candidate_links.pop();
  assert.ok(codes(validateBShard(s, bundle, ctx)).includes('UNIT_MERGE')); // ??? 묶음과 ??? 한 줄은 못 합침

  const descriptor = (unit_id, item_id, speaker_label) => ({
    unit_id,
    unit_type: 'descriptor',
    scene_ids: ['s1'],
    subject_refs: [{ ref: 'item', item_id }],
    lines: [],
    pass1: { descriptor: { speaker_label } },
  });
  const link = {
    ...goodShard().candidate_links[0],
    link_id: 'B1__t1__001',
    subject: [{ ref: 'item', item_id: 'd1' }, { ref: 'item', item_id: 'd2' }],
  };
  const shard = { schema_version: 'pass2-0.1.0', bundle_id: 'B1__t1', candidate_links: [link] };
  const same = { bundle_id: 'B1__t1', units: [descriptor('U01', 'd1', '양산을 든 여성'), descriptor('U02', 'd2', '양산을 든 여성')] };
  assert.equal(codes(validateBShard(shard, same, ctx)).includes('UNIT_MERGE'), false);
  const different = { bundle_id: 'B1__t1', units: [descriptor('U01', 'd1', '양산을 든 여성'), descriptor('U02', 'd2', '검은 물을 덮은 소녀')] };
  assert.ok(codes(validateBShard(shard, different, ctx)).includes('UNIT_MERGE'));
});

test('검증기: 공개 줄에 후보 이름이 없으면 경고, 오류로 막지는 않는다', () => {
  const s = goodShard();
  s.candidate_links[0].supporting_evidence.push(ev('s1', 3, 3, '라피: 너···! 누구냐···!', { reveals_identity: true }));
  const r = validateBShard(s, bundle, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((w) => w.code), ['REVEAL_WITHOUT_NAME']);
  assert.deepEqual(validateBShard(goodShard(), bundle, ctx).warnings, []);
});

test('공개 이름 검사는 범위가 아니라 quote를 보며, 지휘관 선택지 전체만 예외다', () => {
  const s = goodShard();
  s.candidate_links[0].supporting_evidence[1] = ev('s2', 2, 3, '그렇게, 불러, 라.', { reveals_identity: true });
  assert.ok(validateBShard(s, bundle, ctx).warnings.some((w) => w.code === 'REVEAL_WITHOUT_NAME'));
  const choiceStore = {
    ...store,
    has: (id) => id === 'choice' || store.has(id),
    lines: (id) => id === 'choice' ? ['', '지휘관. 들립니까?', '[OPTION TEXT="어떻게든 도와줄게."]'] : store.lines(id),
  };
  const choiceCtx = { ...ctx, store: choiceStore, registry: new Map([...registry, ['char_지휘관', { surface_labels: ['지휘관'] }]]) };
  const link = s.candidate_links[0];
  link.target = [{ ref: 'entity', entity_id: 'char_지휘관', name: '지휘관', entity_type: 'character' }];
  for (const quote of ['[OPTION TEXT="어떻게든 도와줄게."]', '어떻게든 도와줄게.']) {
    link.supporting_evidence[1] = ev('choice', 2, 2, quote, { reveals_identity: true });
    const result = validateBShard(s, bundle, choiceCtx);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  }
  link.target = goodShard().candidate_links[0].target;
  assert.ok(validateBShard(s, bundle, choiceCtx).warnings.some((w) => w.code === 'REVEAL_WITHOUT_NAME'));
});

test('집단 target은 보류만 허용하고, 대안 근거는 별도 검사 및 원문 변경 의존성에 포함한다', () => {
  const s = goodShard();
  const link = s.candidate_links[0];
  link.target = [{ ref: 'entity', entity_id: null, name: '관계자들', entity_type: 'organization' }];
  assert.ok(codes(validateBShard(s, bundle, ctx)).includes('GROUP_TARGET'));
  link.verdict = link.confidence = '판단 보류';
  link.supporting_evidence.forEach((e) => { e.reveals_identity = false; });
  assert.deepEqual(validateBShard(s, bundle, ctx).errors, []);
  const alternative = { entity_id: null, name: '다른 후보', why: '다른 가능성' };
  link.alternatives.push(alternative);
  assert.ok(codes(validateBShard(s, bundle, ctx)).includes('EVIDENCE'));
  alternative.supporting_evidence = [ev('s1', 3, 3, '라피: 너···! 누구냐···!')];
  assert.deepEqual(validateBShard(s, bundle, ctx).errors, []);
  const enriched = enrichLink(link, bundle, { store, releaseDates: new Map() });
  assert.ok(enriched.evidence_scenes.some((e) => e.scene_id === 's1' && e.line_start === 3));
  alternative.supporting_evidence[0].quote = '없는 인용';
  assert.ok(codes(validateBShard(s, bundle, ctx)).includes('QUOTE_LOCATION'));
});

test('큰 묶음: 118·44단위를 최대 20개씩 나누되 ID·참조·전체 대본 및 관련 스캔을 보존한다', () => {
  const units = Array.from({ length: 118 }, (_, i) => ({ unit_id: `U${i + 1}`, subject_refs: [{ item_id: `i${i}` }] }));
  const original = { bundle_id: 'B1__large', script_file: 'whole.script.txt', units, scan: {
    terms: [{ term: '단서', unit_ids: ['U1', 'U118'] }],
    hits: [{ scan_id: 'S1', unit_ids: ['U118'] }], dropped_terms: [],
  } };
  const parts = splitBundle(original);
  assert.deepEqual(parts.map((p) => p.units.length), [20, 20, 20, 20, 20, 18]);
  assert.deepEqual(parts.flatMap((p) => p.units), units);
  assert.equal(new Set(parts.map((p) => p.bundle_id)).size, 6);
  assert.ok(parts.every((p) => p.script_file === original.script_file && p.parent_bundle_id === original.bundle_id));
  assert.deepEqual(parts[0].scan.terms[0].unit_ids, ['U1']);
  assert.deepEqual(parts[0].scan.hits, []);
  assert.deepEqual(parts[5].scan.hits[0].unit_ids, ['U118']);
  assert.deepEqual(original.scan.terms[0].unit_ids, ['U1', 'U118']);
  assert.deepEqual(splitBundle({ ...original, units: units.slice(0, 44) }).map((p) => p.units.length), [20, 20, 4]);
  assert.throws(() => splitBundle(original, 0));
  const plan = { bundles: planWaves(Array.from({ length: 130 }, (_, i) => ({ bundle_id: `b${i}` }))) };
  assert.equal(selectWave(plan, 7).length, 10);
  assert.equal(selectWave(plan, 1).length, 20);
  assert.throws(() => selectWave(plan, 8));
});

test('회차 배치: 나눈 큰 이야기는 일반 묶음 뒤에, 작은 이야기부터 이야기별로 모은다', () => {
  const whole = (i) => ({ bundle_id: `w${i}`, units: 1 });
  const part = (parent, i, units) => ({ bundle_id: `${parent}_${i}`, parent_bundle_id: parent, units });
  const big = [1, 2, 3, 4, 5, 6].map((i) => part('big', i, 20));
  const small = [1, 2, 3].map((i) => part('small', i, 15));
  const bundles = [whole(0), ...big, ...small, ...Array.from({ length: 20 }, (_, i) => whole(i + 1))]; // 입력 순서와 무관
  const planned = planWaves(bundles, 20);
  const waveOf = Object.fromEntries(planned.map((b) => [b.bundle_id, b.wave]));
  assert.equal(planned.length, bundles.length);
  assert.equal(waveOf.w19, 1);
  assert.equal(waveOf.w20, 2);
  assert.deepEqual(small.map((b) => waveOf[b.bundle_id]), [2, 2, 2]); // 남은 자리에 작은 이야기가 먼저
  assert.deepEqual(big.map((b) => waveOf[b.bundle_id]), [3, 3, 3, 3, 3, 3]); // 큰 이야기는 다음 회차에 따로

  // 일반 묶음이 회차를 꽉 채웠으면 나눈 이야기는 새 회차에서 시작하고, 회차 크기를 넘으면 이어서 나눈다
  const full = planWaves([...Array.from({ length: 2 }, (_, i) => whole(i)), part('a', 1, 5), part('a', 2, 5), part('a', 3, 5)], 2);
  assert.deepEqual(full.map((b) => b.wave), [1, 1, 2, 2, 3]);
});

test('감사 표본: 유형별 최소 1개, 고정 추출, 단위의 일부 참조라도 누락되면 실패', () => {
  const units = Array.from({ length: 24 }, (_, i) => ({ unit_id: `U${i}`, unit_type: i < 20 ? 'unknown_line' : i < 22 ? 'author' : 'voice', subject_refs: [{ item_id: `i${i}` }] }));
  const links = units.map((u, i) => ({ bundle_id: 'B', subject: u.subject_refs.map((r) => ({ ...r })), verdict: i < 20 ? '군중·엑스트라' : i < 22 ? '판단 보류' : '정체 후보 있음', confidence: i < 20 ? '가능성' : i < 22 ? '판단 보류' : '가능성' }));
  const args = { planBundles: [{ bundle_id: 'B' }], bundles: new Map([['B', { units }]]), links };
  const sample = sampleAuditCases(args);
  assert.equal(sample.sampled_units, 4);
  assert.equal(sample.strata.length, 3);
  assert.deepEqual(sample, sampleAuditCases(args));
  const unsampled = units.map((u) => `B:${u.unit_id}`).find((id) => !sample.items.some((x) => x.audit_id === id));
  assert.ok(sampleAuditCases({ ...args, includeIds: [unsampled] }).items.some((x) => x.audit_id === unsampled));
  assert.equal(sampleAuditCases({ ...args, rate: 1 }).sampled_units, 24);
  units[0].subject_refs.push({ item_id: 'missing' });
  assert.throws(() => sampleAuditCases(args), /미병합/);
});

test('부분 묶음의 참조와 link_id는 검증기에서도 서로 격리된다', () => {
  const source = { ...bundle, scan: { terms: [], hits: [] }, script_file: 'whole.script.txt' };
  const parts = splitBundle(source, 1);
  for (const [i, part] of parts.entries()) {
    const shard = goodShard();
    shard.bundle_id = part.bundle_id;
    shard.candidate_links = [{ ...shard.candidate_links[i], link_id: `${part.bundle_id}__001` }];
    assert.deepEqual(validateBShard(shard, part, ctx).errors, []);
    shard.candidate_links[0].subject.push(goodShard().candidate_links[1 - i].subject[0]);
    assert.ok(codes(validateBShard(shard, part, ctx)).includes('SUBJECT_NOT_IN_BUNDLE'));
  }
});

test('감사 합격: 다른 계열·현재 입력·인용 대조·전수 표본 완료, 지적 또는 판단 불가는 실패', () => {
  const bundleStamps = [{ bundle_id: 'B', rules_sha256: 'r', input_sha256: 'i', shard_sha256: 's' }];
  const input = { judge_family: 'gemini', bundle_stamps: bundleStamps, items: [{ audit_id: 'B:U1' }] };
  input.source_sha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const out = { schema_version: 'pass2-audit-0.1.0', input_sha256: input.source_sha256, auditor_family: 'gpt', auditor_model: 'GPT', auditor_session: 'separate-session', reviews: [{ audit_id: 'B:U1', judgment: '맞음', problems: [], reason: '원문 확인', evidence: [{ scene_id: 's2', line: 2, quote: '그레이브: ···그레이브.' }] }] };
  const check = (changes = {}, stamps = bundleStamps) => checkAudit(input, { ...out, ...changes }, { store, bundleStamps: stamps });
  assert.deepEqual(check().errors, []);
  assert.ok(check({ auditor_family: 'gemini' }).errors.length);
  assert.ok(check({ input_sha256: 'old' }).errors.length);
  assert.ok(check({}, []).errors.length);
  assert.ok(check({ reviews: [] }).errors.length);
  assert.ok(check({ reviews: [{ ...out.reviews[0], judgment: '판단 불가' }] }).errors.length);
  assert.ok(check({ reviews: [{ ...out.reviews[0], problems: ['reveals_identity_wrong'] }] }).errors.length);
  assert.ok(check({ reviews: [{ ...out.reviews[0], evidence: [] }] }).errors.length);
});

test('재사용 기준: 규칙·입력·출력이 그대로일 때만 완료로 친다', () => {
  const base = { rulesText: 'rules v1', bundle: { bundle_id: 'b', generated_at: 'a', units: [] }, scriptText: 'script', shardText: '{}' };
  const stamp = computeStamp(base);
  assert.equal(staleReason(stamp, computeStamp({ ...base, bundle: { ...base.bundle, generated_at: 'b' } })), null); // 다시 빌드만 한 경우
  assert.match(staleReason(stamp, computeStamp({ ...base, rulesText: 'rules v2' })), /규칙/);
  assert.match(staleReason(stamp, computeStamp({ ...base, scriptText: 'changed' })), /묶음/);
  assert.match(staleReason(stamp, computeStamp({ ...base, shardText: '{"x":1}' })), /출력/);
  assert.match(staleReason(null, computeStamp(base)), /기록/);
});

test('독립 검토 인용: 원문 한 줄과 대조하고, 인용 0건은 실패', () => {
  const input = { items: [{ link_id: 'L1' }] };
  const reviewWith = (evidence) => ({ reviews: [{ link_id: 'L1', judgment: '맞음', problems: [], reason: '이유', evidence }] });
  const errorsOf = (evidence) => checkReview(input, reviewWith(evidence), { store }).errors;

  assert.deepEqual(errorsOf([{ scene_id: 's2', line: 2, quote: '그레이브: ···그레이브.' }]), []);
  assert.deepEqual(errorsOf([{ scene_id: 'r1', line: 3, quote: '[OPTION TEXT="스노우 화이트···?"]' }]), []); // 들여쓰기는 무시

  // 파일럿에서 나온 두 오류
  assert.match(errorsOf([{ scene_id: 'r1', line: 1, quote: '루드밀라: 북부를 배회하고 있는 필그림이야.' }])[0], /원문과 다르다/);
  assert.match(errorsOf([{ scene_id: 'r1', line: 2, quote: '그렇게 우리는 언노운의 뒤를 쫓아 이동했다.' }])[0], /원문과 다르다/);

  assert.match(errorsOf([])[0], /하나 이상/);
  assert.match(checkReview(input, { reviews: [{ link_id: 'L1', judgment: '맞음', problems: [], reason: '이유' }] }, { store }).errors[0], /하나 이상/);
  assert.match(errorsOf([{ scene_id: 's2', line: 2, quote: '···그레이브.' }])[0], /원문과 다르다/); // 화자 라벨까지 그 줄 전체
  assert.match(errorsOf([{ scene_id: 's2', line: 99, quote: '없는 줄' }])[0], /L99/);
  assert.match(errorsOf([{ scene_id: 'nope', line: 1, quote: '없는 장면' }])[0], /등록 장면/);
  assert.match(errorsOf([{ scene_id: 's2', line: 2, quote: '그레이브: ···그레이브.', note: 'x' }])[0], /알 수 없는 필드/);
});

test('채점: 보류 정답, 보류 연결의 target은 적중이 아님, 대안과 부분 적중 구분', () => {
  const identity = (link_id, item_id, verdict, target, alternatives = []) => ({
    bundle_id: 'B',
    link_id,
    link_type: 'identity',
    verdict,
    target,
    alternatives,
    rationale: '이유',
    subject: [{ ref: 'item', item_id }],
  });
  const grave = { entity_id: 'char_그레이브', name: '그레이브' };
  const other = { entity_id: 'char_다른', name: '다른' };
  const unit = (unit_id, ...items) => ({ unit_id, subject_refs: items.map((item_id) => ({ ref: 'item', item_id })) });
  const units = [unit('U1', 'a'), unit('U2', 'b'), unit('U3', 'c'), unit('U4', 'd'), unit('U5', 'e', 'f'), unit('U6', 'g'), unit('U7', 'h'), unit('U8', 'i')];
  const links = [
    identity('L1', 'a', '정체 후보 있음', [grave]),
    identity('L2', 'b', '정체 후보 있음', [other], [grave]),
    identity('L3', 'c', '판단 보류', [grave]),
    identity('L4', 'd', '판단 보류', []),
    identity('L5', 'e', '정체 후보 있음', [grave]),
    identity('L6', 'f', '정체 후보 있음', [other]),
    identity('L7', 'g', '정체 후보 있음', [other]),
    { ...identity('L8', 'h', '판단 보류', []), rationale: '[검색 예산 소진] 검색어 a, b' },
    { ...identity('L9', 'i', '군중·엑스트라', []), link_type: 'crowd' },
  ];
  const answer = (unit_id, value) => ({ bundle_id: 'B', unit_id, answer: value });
  const id = { entity_id: 'char_그레이브' };
  const s = scoreB({
    plan: { bundles: [{ bundle_id: 'B' }] },
    bundles: new Map([['B', { units }]]),
    merged: { links },
    answers: [answer('U1', id), answer('U2', id), answer('U3', id), answer('U4', 'hold'), answer('U5', id), answer('U6', 'hold'), answer('U8', 'crowd')],
    review: null,
  });
  assert.deepEqual(s.per_answer.map((x) => x.result), ['target', 'alternative', 'held_with_answer', 'correct', 'partial', 'miss', 'correct']);
  assert.deepEqual(s.candidate_recall, { answers: 4, hit: 2, in_target: 1, in_alternative: 1, rate: 0.5 });
  assert.deepEqual(s.by_answer_kind.hold, { answers: 2, results: { correct: 1, miss: 1 } });
  assert.deepEqual(s.by_answer_kind.crowd, { answers: 1, results: { correct: 1 } });
  assert.deepEqual(s.holds, { total: 3, search_budget_exhausted: 1 });
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
  const bad = checkReview(input, { reviews: [{ link_id: 'B1__t1__001', judgment: '틀림', problems: [], reason: '' }] }, { store });
  assert.ok(bad.errors.length >= 3);
  const review = {
    reviews: [
      { link_id: 'B1__t1__001', judgment: '맞음', problems: [], reason: 'L2~3에서 이름을 밝힘', evidence: [{ scene_id: 's2', line: 2, quote: '그레이브: ···그레이브.' }] },
      { link_id: 'B1__t1__002', judgment: '틀림', problems: ['should_not_be_crowd'], reason: '대답하는 줄이 있음', evidence: [{ scene_id: 's1', line: 3, quote: '라피: 너···! 누구냐···!' }] },
    ],
  };
  assert.deepEqual(checkReview(input, review, { store }).errors, []);
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
