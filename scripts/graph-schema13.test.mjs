import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  GRAPH_DATA_DIR,
  SCRIPTS_ROOT_DIR,
  PASS1_SCHEMA_VERSION,
  buildNumberedScript,
  extractSceneMechanicalGroundTruth,
  parseChapterTextBlocks,
} from './graph/lib.mjs';
import { validateShard } from './graph/validate-output.mjs';
import { enrichSceneFromManifest } from './graph/merge-and-index.mjs';
import { planBatches } from './graph/build-manifest.mjs';
import { applyDescriptorReview } from './graph/init-registry.mjs';

// 2.4: 1.3.0에서 새로 생기거나 바뀐 검사(2.3의 항 번호)를 실제 파서로 만든 장면에 대해 확인한다.

const DESCRIPTOR_LOOKUP = {
  '양산을 든 여성': { entity_id: null, is_generic_role: true, role_category: 'descriptor_alias' },
};

const makeInputScene = (sceneId, lines, speakerLookup = null) => {
  const scene = { scene_id: sceneId, category: 'main_story', title: '테스트', body_lines: lines };
  return {
    scene_id: sceneId,
    numbered_script: buildNumberedScript(lines),
    mechanical_ground_truth: extractSceneMechanicalGroundTruth(scene, { speakerLookup }),
  };
};

const emptyScene = (sceneId, overrides = {}) => ({
  scene_id: sceneId,
  chronology_type: 'present',
  chronology_segments: [],
  is_plot_critical: true,
  summary: '테스트 장면이다.',
  participants: {
    present_in_scene: [],
    present_silent: [],
    remote_or_voice_only: [],
    mentioned_only: [],
    document_author: null,
  },
  forms_of_address: [],
  unknown_speakers: [],
  descriptor_speakers: [],
  same_scene_speaker_groups: [],
  cross_scene_hints: [],
  choice_branches: [],
  events_and_claims: [],
  clues_and_hooks: [],
  relationship_and_lore_notes: [],
  unregistered_entity_candidates: [],
  ...overrides,
});

const present = (...labels) => labels.map((label) => ({ speaker_label: label, entity_id: null, is_generic_role: false }));

const event = (fields) => ({
  epistemic_type: 'established_event',
  actor_or_speaker: '라피',
  summary: '요약',
  claim_line: null,
  refers_to_past: false,
  ...fields,
});

const shardOf = (...scenes) => ({ schema_version: PASS1_SCHEMA_VERSION, batch_id: 'batch_t13', scenes });
const batchOf = (...scenes) => ({ schema_version: PASS1_SCHEMA_VERSION, batch_id: 'batch_t13', scenes });

const rulesOf = (res) => res.errors.map((e) => e.rule);
const assertValid = (res) => assert.equal(res.valid, true, JSON.stringify(res.errors, null, 2));
const assertFails = (res, rule) =>
  assert.ok(rulesOf(res).includes(rule), `expected ${rule}, got ${JSON.stringify(res.errors, null, 2)}`);

// 문답·간접화법·선택지·호칭이 있는 장면
const QA_LINES = [
  '[SCENE START]',
  '지휘관: 둘이 무슨 사이야?',
  '라피는 잠시 침묵했다.',
  '라피: 레드 후드와는 같은 스쿼드였습니다.',
  '크로우는 방주의 선택을 보고 싶다고 했다.',
  '라피: 어제 네온을 구한 건 지휘관입니까?',
  '[CHOICE_START]',
  '[OPTION TEXT="맞아, 나야."]',
  '라피: 그러셨군요.',
  '[OPTION_END]',
  '[OPTION TEXT="아니, 난 아니야."]',
  '라피: 그렇군요.',
  '[OPTION_END]',
  '[CHOICE_END]',
  '은화는 지휘관을 싸늘하게 내려다보았다.',
  '은화: 애송이, 아직도 안 갔나.',
  '[SCENE END]',
];

const qaScene = () =>
  emptyScene('t13_qa', {
    participants: {
      present_in_scene: present('지휘관', '라피', '은화'),
      present_silent: [],
      remote_or_voice_only: [],
      mentioned_only: [],
      document_author: null,
    },
    forms_of_address: [
      {
        from_speaker: '은화',
        to_target: '지휘관',
        address_term: '애송이',
        line_start: 15,
        line_end: 16,
        quote: '은화는 지휘관을 싸늘하게 내려다보았다. 애송이, 아직도 안 갔나.',
      },
    ],
    choice_branches: [
      {
        choice_line: 7,
        options: [
          { option_text: '맞아, 나야.', continuation_summary: '라피가 수긍한다.' },
          { option_text: '아니, 난 아니야.', continuation_summary: '라피가 받아들인다.' },
        ],
      },
    ],
    events_and_claims: [
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '라피',
        summary: '라피가 레드 후드와 같은 스쿼드였다고 말한다.',
        line_start: 2,
        line_end: 4,
        claim_line: 4,
        quote: '둘이 무슨 사이야? 라피는 잠시 침묵했다. 레드 후드와는 같은 스쿼드였습니다.',
        refers_to_past: true,
      }),
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '크로우',
        summary: '크로우가 방주의 선택을 보고 싶다고 했다고 전해진다.',
        line_start: 5,
        line_end: 5,
        claim_line: 5,
        quote: '크로우는 방주의 선택을 보고 싶다고 했다.',
      }),
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '지휘관',
        summary: '지휘관이 어제 네온을 구했다고 답한다.',
        line_start: 6,
        line_end: 8,
        claim_line: 8,
        quote: '어제 네온을 구한 건 지휘관입니까? 맞아, 나야.',
      }),
    ],
    relationship_and_lore_notes: [
      {
        subject: '라피',
        target: '레드 후드',
        relation_or_change: '예전에 같은 스쿼드였다고 함',
        epistemic_type: 'character_claim',
        claimant: '라피',
        line_start: 2,
        line_end: 4,
        claim_line: 4,
        quote: '레드 후드와는 같은 스쿼드였습니다.',
        refers_to_past: true,
      },
    ],
    clues_and_hooks: [
      {
        keyword: '싸늘한 시선',
        category: 'trait',
        subject: '은화',
        detail: '은화가 지휘관을 싸늘하게 내려다봄',
        line_start: 15,
        line_end: 15,
        quote: '은화는 지휘관을 싸늘하게 내려다보았다.',
      },
    ],
  });

const qaBatch = () => batchOf(makeInputScene('t13_qa', QA_LINES));

test('1.3.0 valid shard: Q&A context, narration claim, option-crossing claim, address range with narration', () => {
  assertValid(validateShard(shardOf(qaScene()), qaBatch()));
});

test('2.3-7 claim speaker: multiple speakers, wrong claim_line speaker, quote missing the claim line, narration teller', () => {
  const multi = qaScene();
  multi.events_and_claims[0].actor_or_speaker = '라피, 아니스';
  assertFails(validateShard(shardOf(multi), qaBatch()), 'CLAIM_SPEAKER');

  const wrongSpeaker = qaScene();
  wrongSpeaker.events_and_claims[0].actor_or_speaker = '지휘관';
  assertFails(validateShard(shardOf(wrongSpeaker), qaBatch()), 'CLAIM_SPEAKER');

  // 질문자를 주장 화자로 적고 claim_line을 질문 줄로 잡았지만 인용은 답만 담음
  const questionerAsClaimant = qaScene();
  Object.assign(questionerAsClaimant.events_and_claims[0], {
    actor_or_speaker: '지휘관',
    claim_line: 2,
    quote: '레드 후드와는 같은 스쿼드였습니다.',
  });
  assertFails(validateShard(shardOf(questionerAsClaimant), qaBatch()), 'CLAIM_SPEAKER');

  const missingClaimLine = qaScene();
  missingClaimLine.events_and_claims[0].claim_line = null;
  assertFails(validateShard(shardOf(missingClaimLine), qaBatch()), 'CLAIM_SPEAKER');

  const narrationWrongTeller = qaScene();
  narrationWrongTeller.events_and_claims[1].actor_or_speaker = '아니스';
  assertFails(validateShard(shardOf(narrationWrongTeller), qaBatch()), 'CLAIM_SPEAKER');

  const narrationNoTeller = qaScene();
  narrationNoTeller.events_and_claims[1].actor_or_speaker = '지문';
  assertValid(validateShard(shardOf(narrationNoTeller), qaBatch()));

  const claimLineOnEvent = qaScene();
  claimLineOnEvent.events_and_claims.push(
    event({ line_start: 4, line_end: 4, claim_line: 4, quote: '레드 후드와는 같은 스쿼드였습니다.' })
  );
  assertFails(validateShard(shardOf(claimLineOnEvent), qaBatch()), 'CLAIM_SPEAKER');
});

test('2.3-8 forms of address are checked on the line holding the term', () => {
  const wrong = qaScene();
  wrong.forms_of_address[0].from_speaker = '지휘관';
  assertFails(validateShard(shardOf(wrong), qaBatch()), 'FORMS_OF_ADDRESS');
});

test('2.3-11/12 choices: completeness and incompatible option ranges', () => {
  const missingOption = qaScene();
  missingOption.choice_branches[0].options.pop();
  assertFails(validateShard(shardOf(missingOption), qaBatch()), 'CHOICE_BRANCHES');

  const missingBlock = qaScene();
  missingBlock.choice_branches = [];
  assertFails(validateShard(shardOf(missingBlock), qaBatch()), 'CHOICE_BRANCHES');

  const spansTwoOptions = qaScene();
  spansTwoOptions.events_and_claims.push(
    event({
      summary: '두 갈래를 한 항목에 섞음',
      line_start: 8,
      line_end: 12,
      quote: '맞아, 나야. 그러셨군요. 아니, 난 아니야. 그렇군요.',
    })
  );
  assertFails(validateShard(shardOf(spansTwoOptions), qaBatch()), 'BRANCH_BOUNDARY');

  // 본문 없는 옵션은 continuation_summary가 null이어야 한다 (지휘관 대사만 다른 블록)
  const lines = ['[CHOICE_START]', '[OPTION TEXT="고마워."]', '[OPTION_END]', '[OPTION TEXT="신경 쓰지 마."]', '[OPTION_END]', '[CHOICE_END]', '라피: 별말씀을요.'];
  const noBodyScene = (summary) =>
    emptyScene('t13_nobody', {
      participants: { present_in_scene: present('지휘관', '라피'), present_silent: [], remote_or_voice_only: [], mentioned_only: [], document_author: null },
      choice_branches: [
        {
          choice_line: 1,
          options: [
            { option_text: '고마워.', continuation_summary: summary },
            { option_text: '신경 쓰지 마.', continuation_summary: null },
          ],
        },
      ],
    });
  const noBodyBatch = batchOf(makeInputScene('t13_nobody', lines));
  assertValid(validateShard(shardOf(noBodyScene(null)), noBodyBatch));
  assertFails(validateShard(shardOf(noBodyScene('라피가 답한다.')), noBodyBatch), 'CHOICE_BRANCHES');
});

test('2.3-15/16/17 confidence, relationship notes, trait subject', () => {
  const certainOnEvent = qaScene();
  certainOnEvent.events_and_claims[0].confidence = '확인된 사실';
  assertFails(validateShard(shardOf(certainOnEvent), qaBatch()), 'CONFIDENCE');

  const interpretationNoConfidence = qaScene();
  interpretationNoConfidence.events_and_claims.push(
    event({ epistemic_type: 'interpretation', line_start: 4, line_end: 4, quote: '레드 후드와는 같은 스쿼드였습니다.' })
  );
  assertFails(validateShard(shardOf(interpretationNoConfidence), qaBatch()), 'CONFIDENCE');

  for (const subject of ['아니스, 네온', '아니스·네온']) {
    const multi = qaScene();
    multi.relationship_and_lore_notes[0].subject = subject;
    assertFails(validateShard(shardOf(multi), qaBatch()), 'RELATIONSHIP_NOTES');
  }
  for (const subject of ['헨젤 & 그레텔', '퀸(마코토)']) {
    const named = qaScene();
    named.relationship_and_lore_notes[0].target = subject;
    assertValid(validateShard(shardOf(named), qaBatch()));
  }

  const interpretationNote = qaScene();
  interpretationNote.relationship_and_lore_notes[0].epistemic_type = 'interpretation';
  assertFails(validateShard(shardOf(interpretationNote), qaBatch()), 'RELATIONSHIP_NOTES');

  const claimWithoutClaimant = qaScene();
  claimWithoutClaimant.relationship_and_lore_notes[0].claimant = null;
  assertFails(validateShard(shardOf(claimWithoutClaimant), qaBatch()), 'CLAIM_SPEAKER');

  const establishedWithClaimant = qaScene();
  Object.assign(establishedWithClaimant.relationship_and_lore_notes[0], { epistemic_type: 'established_event', claim_line: null });
  assertFails(validateShard(shardOf(establishedWithClaimant), qaBatch()), 'CLAIM_SPEAKER');

  const traitWithoutSubject = qaScene();
  traitWithoutSubject.clues_and_hooks[0].subject = null;
  assertFails(validateShard(shardOf(traitWithoutSubject), qaBatch()), 'TRAIT_SUBJECT');
});

test('2.3-2/18/19 speaker completeness, merger-only fields, schema version', () => {
  const missingSpeaker = qaScene();
  missingSpeaker.participants.present_in_scene = present('지휘관', '라피');
  assertFails(validateShard(shardOf(missingSpeaker), qaBatch()), 'SPEAKER_COMPLETENESS');

  const withMergerFields = qaScene();
  Object.assign(withMergerFields.events_and_claims[0], { chronology_type: 'present', branch_specific: false });
  const res = validateShard(shardOf(withMergerFields), qaBatch());
  assertValid(res);
  assert.ok(res.warnings.some((w) => w.rule === 'FORBIDDEN_MODEL_FIELD' && w.path.endsWith('.chronology_type')));

  assertFails(validateShard({ ...shardOf(qaScene()), schema_version: '1.2.0' }, qaBatch()), 'SCHEMA_VERSION');
});

// 회상 구간과 현재가 섞인 장면 (2.3의 13항)
const MIXED_LINES = [
  '지휘관은 그날의 대화를 떠올렸다.',
  '라피: 네온을 구한 사람은 아니스였어.',
  '회상이 끝나고 현재로 돌아왔다.',
  '지휘관: 방금 떠올린 그 말은 사실이 아니야.',
];

const mixedScene = () =>
  emptyScene('t13_mixed', {
    chronology_type: 'mixed',
    chronology_segments: [{ line_start: 1, line_end: 2, chronology_type: 'flashback' }],
    participants: { present_in_scene: present('라피', '지휘관'), present_silent: [], remote_or_voice_only: [], mentioned_only: [], document_author: null },
    events_and_claims: [
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '지휘관',
        summary: '지휘관이 회상 속 라피의 말을 부정한다.',
        line_start: 2,
        line_end: 4,
        claim_line: 4,
        quote: '네온을 구한 사람은 아니스였어. 회상이 끝나고 현재로 돌아왔다. 방금 떠올린 그 말은 사실이 아니야.',
      }),
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '라피',
        summary: '회상 속 라피가 네온을 구한 사람은 아니스라고 말한다.',
        line_start: 2,
        line_end: 2,
        claim_line: 2,
        quote: '네온을 구한 사람은 아니스였어.',
      }),
    ],
  });
const mixedBatch = () => batchOf(makeInputScene('t13_mixed', MIXED_LINES));

test('2.3-13 chronology segments: claims may cross, other items may not', () => {
  assertValid(validateShard(shardOf(mixedScene()), mixedBatch()));

  const eventCrossing = mixedScene();
  eventCrossing.events_and_claims.push(
    event({
      actor_or_speaker: '지휘관',
      line_start: 2,
      line_end: 4,
      quote: '네온을 구한 사람은 아니스였어. 회상이 끝나고 현재로 돌아왔다. 방금 떠올린 그 말은 사실이 아니야.',
    })
  );
  assertFails(validateShard(shardOf(eventCrossing), mixedBatch()), 'CHRONOLOGY_BOUNDARY');

  const noSegments = mixedScene();
  noSegments.chronology_segments = [];
  assertFails(validateShard(shardOf(noSegments), mixedBatch()), 'CHRONOLOGY_SEGMENTS');

  const segmentsOnPresent = mixedScene();
  segmentsOnPresent.chronology_type = 'present';
  assertFails(validateShard(shardOf(segmentsOnPresent), mixedBatch()), 'CHRONOLOGY_SEGMENTS');

  // 병합기: character_claim은 claim_line 기준, 회상 속 주장은 flashback
  const enriched = enrichSceneFromManifest(mixedScene(), { scene_id: 't13_mixed' }, mixedBatch().scenes[0].mechanical_ground_truth);
  assert.equal(enriched.events_and_claims[0].chronology_type, 'present');
  assert.equal(enriched.events_and_claims[1].chronology_type, 'flashback');
});

// 묘사형 화자와 ??? 정체 공개 (2.3의 4·10항)
const DESC_LINES = ['양산을 든 여성: 어서 오게.', '???: 드디어 왔구나.', '라피: 당신은 누구죠?', '???: 나는 머스탱이다.'];

const descScene = () =>
  emptyScene('t13_desc', {
    participants: {
      present_in_scene: [
        { speaker_label: '양산을 든 여성', entity_id: null, is_generic_role: true },
        { speaker_label: '라피', entity_id: null, is_generic_role: false },
      ],
      present_silent: [],
      remote_or_voice_only: [],
      mentioned_only: [],
      document_author: null,
    },
    unknown_speakers: [
      { unknown_id: 'unk_t13_desc_L0002', quote: '드디어 왔구나.', speaking_style: '반가운 말투', target_addressed: null, contextual_clues: [], resolved_in_same_scene_to: null },
      {
        unknown_id: 'unk_t13_desc_L0004',
        quote: '나는 머스탱이다.',
        speaking_style: '당당한 말투',
        target_addressed: '라피',
        contextual_clues: [],
        resolved_in_same_scene_to: { surface_text: '머스탱', entity_id: null, line_start: 4, line_end: 4, quote: '나는 머스탱이다.' },
      },
    ],
    descriptor_speakers: [
      {
        speaker_label: '양산을 든 여성',
        line_start: 1,
        line_end: 1,
        quote: '어서 오게.',
        speaking_style: '온화한 하오체',
        target_addressed: null,
        contextual_clues: [],
        resolved_in_same_scene_to: null,
      },
    ],
    events_and_claims: [
      event({
        epistemic_type: 'character_claim',
        actor_or_speaker: '???',
        summary: '미상 화자가 자신이 머스탱이라고 말한다.',
        line_start: 3,
        line_end: 4,
        claim_line: 4,
        quote: '당신은 누구죠? 나는 머스탱이다.',
      }),
    ],
  });
const descBatch = () => batchOf(makeInputScene('t13_desc', DESC_LINES, DESCRIPTOR_LOOKUP));

test('2.3-4/10 descriptor speakers and resolved identity surface text', () => {
  assertValid(validateShard(shardOf(descScene()), descBatch()));

  const missingDescriptor = descScene();
  missingDescriptor.descriptor_speakers = [];
  assertFails(validateShard(shardOf(missingDescriptor), descBatch()), 'DESCRIPTOR_SPEAKERS');

  const otherSpeakersLine = descScene();
  Object.assign(otherSpeakersLine.descriptor_speakers[0], { line_start: 3, line_end: 3, quote: '당신은 누구죠?' });
  assertFails(validateShard(shardOf(otherSpeakersLine), descBatch()), 'DESCRIPTOR_SPEAKERS');

  const priorKnowledgeName = descScene();
  priorKnowledgeName.unknown_speakers[1].resolved_in_same_scene_to.surface_text = '신데렐라';
  assertFails(validateShard(shardOf(priorKnowledgeName), descBatch()), 'RESOLVED_SURFACE_TEXT');

  const enriched = enrichSceneFromManifest(descScene(), { scene_id: 't13_desc' }, descBatch().scenes[0].mechanical_ground_truth);
  assert.equal(enriched.events_and_claims[0].claimant_unknown_id, 'unk_t13_desc_L0004');
  assert.equal(enriched.unknown_speakers[1].line, 4);
  assert.equal(enriched.unknown_speakers[1].chronology_type, 'present');
});

test('2.3-5/7 unlabeled recording with several voices', () => {
  const lines = ['남자의 목소리가 들린다.', '"나는 A의 부하야."', '여자의 목소리가 대답한다.', '"나는 B의 부하야."'];
  const scene = (documentAuthor) =>
    emptyScene('t13_doc', {
      participants: { present_in_scene: [], present_silent: [], remote_or_voice_only: [], mentioned_only: [], document_author: documentAuthor },
      events_and_claims: [
        event({
          epistemic_type: 'character_claim',
          actor_or_speaker: '여자의 목소리',
          summary: '여자의 목소리가 자신은 B의 부하라고 말한다.',
          line_start: 3,
          line_end: 4,
          claim_line: 4,
          quote: '여자의 목소리가 대답한다. "나는 B의 부하야."',
        }),
      ],
    });
  const batch = batchOf(makeInputScene('t13_doc', lines));
  assertValid(validateShard(shardOf(scene({ name: null, entity_id: null, voices: ['남자의 목소리', '여자의 목소리'] })), batch));
  assertFails(validateShard(shardOf(scene({ name: null, entity_id: null, voices: [] })), batch), 'DOCUMENT_AUTHOR');
});

test('1.6 descriptor review: kept labels are tracked, excluded labels are not, unreviewed labels are flagged', () => {
  const review = { keep: new Set(['양산을 든 여성']), drop: new Set(['인자해 보이는 남자']) };
  const heuristic = { is_generic_role: true, category: 'descriptor_alias', reason: '휴리스틱' };
  assert.equal(applyDescriptorReview('양산을 든 여성', heuristic, review).category, 'descriptor_alias');
  assert.equal(applyDescriptorReview('인자해 보이는 남자', heuristic, review).category, 'descriptor_excluded');
  assert.equal(applyDescriptorReview('새로운 묘사형 라벨', heuristic, review).review_status, 'unreviewed');
  const named = { is_generic_role: false, category: null, reason: null };
  assert.deepEqual(applyDescriptorReview('양산을 든 여성', named, review), named);
});

test('2.4 real corpus: gingerbreadhouse_02 requires descriptor_speakers, coins_in_rush_09 no longer does, bunny_x_777_08 options split by line', async () => {
  const registry = JSON.parse(await fs.readFile(path.join(GRAPH_DATA_DIR, 'entity_registry.json'), 'utf8'));
  const realInput = async (file, sceneId, category) => {
    const raw = await fs.readFile(path.join(SCRIPTS_ROOT_DIR, file), 'utf8');
    const block = parseChapterTextBlocks(raw).find((b) => b.scene_id === sceneId);
    assert.ok(block, `${sceneId} must exist`);
    return {
      scene_id: sceneId,
      numbered_script: buildNumberedScript(block.body_lines),
      mechanical_ground_truth: extractSceneMechanicalGroundTruth(
        { scene_id: sceneId, category, title: sceneId, body_lines: block.body_lines },
        { speakerLookup: registry.speaker_lookup }
      ),
    };
  };
  const descLabelsOf = (input) => input.mechanical_ground_truth.speakers.filter((s) => s.is_descriptor_alias).map((s) => s.speaker_label);

  const ginger = await realInput('side_stories/gingerbread_house.txt', 'gingerbreadhouse_02', 'side_stories');
  assert.deepEqual(descLabelsOf(ginger), ['양산을 든 여성']);
  const res = validateShard(shardOf(emptyScene('gingerbreadhouse_02')), batchOf(ginger));
  assert.ok(res.errors.some((e) => e.rule === 'DESCRIPTOR_SPEAKERS' && e.message.includes('양산을 든 여성')));

  // 사용자 검토로 제외된 인자해 보이는 남자는 descriptor_speakers 대상이 아니다
  const coins = await realInput('event_stories/coins_in_rush.txt', 'coins_in_rush_09', 'event_stories');
  assert.deepEqual(descLabelsOf(coins), []);

  const manifest = JSON.parse(await fs.readFile(path.join(GRAPH_DATA_DIR, 'manifest.json'), 'utf8'));
  const bunny = manifest.scenes['bunny_x_777_08'];
  const blocks = bunny.mechanical_ground_truth.choices.choice_blocks.filter((b) => b.is_branching);
  const second = blocks[1];
  const scissorsLine = second.options.find((o) => o.option_text === '가위를 낸다.').line;
  assert.ok(blocks[0].options.some((o) => o.option_text === '가위를 낸다.'), 'same option text must exist in the first block too');
  const enriched = enrichSceneFromManifest(
    emptyScene('bunny_x_777_08', {
      events_and_claims: [event({ actor_or_speaker: '지휘관', line_start: scissorsLine, line_end: scissorsLine, quote: '가위를 낸다.' })],
    }),
    bunny
  );
  assert.deepEqual(enriched.events_and_claims[0].in_branch_option, { choice_line: second.choice_line, option_text: '가위를 낸다.' });
});

test('8-1 scene-level reuse: hash, schema version and descriptor labels decide re-extraction; new batch numbers never reuse old ones', () => {
  const scene = (id, hash, descriptor = false) => ({
    scene_id: id,
    source_sha256: hash,
    raw_bytes: 30 * 1024,
    body_bytes: 30 * 1024,
    mechanical_ground_truth: {
      unknowns: [],
      speakers: descriptor ? [{ speaker_label: '검은 외투의 여자', is_descriptor_alias: true }] : [],
    },
  });
  const merged = (id, hash, extra = {}) => ({
    scene_id: id,
    status: 'merged',
    source_sha256: hash,
    extraction_schema_version: PASS1_SCHEMA_VERSION,
    descriptor_labels: [],
    batch_id: 'batch_0003',
    ...extra,
  });
  const scenes = [scene('a', 'h1'), scene('b', 'h2-changed'), scene('c', 'h3', true), scene('d', 'h4'), scene('e', 'h5')];
  const progress = {
    schema_version: PASS1_SCHEMA_VERSION,
    scenes: {
      a: merged('a', 'h1'),
      b: merged('b', 'h2'),
      c: merged('c', 'h3'),
      d: { scene_id: 'd', status: 'pending', source_sha256: 'h4', descriptor_labels: [], batch_id: 'batch_0007' },
    },
    batches: {
      batch_0003: { batch_id: 'batch_0003', status: 'merged', scene_ids: ['a', 'b', 'c'] },
      batch_0007: { batch_id: 'batch_0007', status: 'pending', scene_ids: ['d'] },
    },
  };
  const { batches, reusedSceneIds } = planBatches(scenes, progress);
  assert.deepEqual(reusedSceneIds, ['a']);
  const kept = batches.find((b) => b.batch_id === 'batch_0007');
  assert.deepEqual(kept?.scene_ids, ['d']);
  const fresh = batches.filter((b) => b.batch_id !== 'batch_0007');
  assert.deepEqual(fresh.flatMap((b) => b.scene_ids).sort(), ['b', 'c', 'e']);
  for (const b of fresh) {
    assert.ok(Number(b.batch_id.slice(6)) > 7, `${b.batch_id} must not reuse an existing number`);
  }
});

// 대사 12줄(L2~L13)이 이어지는 장면
const GAP_LINES = [
  '[SCENE START]',
  ...Array.from({ length: 12 }, (_, i) => `${i % 2 === 0 ? '라피' : '아니스'}: 대사 ${i + 1}번입니다.`),
  '[SCENE END]',
];

const gapScene = (overrides = {}) =>
  emptyScene('t13_gap', {
    participants: {
      present_in_scene: present('라피', '아니스'),
      present_silent: [],
      remote_or_voice_only: [],
      mentioned_only: [],
      document_author: null,
    },
    ...overrides,
  });

const gapBatch = () => batchOf(makeInputScene('t13_gap', GAP_LINES));

test('2.3-21 coverage gap: long uncovered dialogue needs extraction or a reviewed_gaps reason', () => {
  assertFails(validateShard(shardOf(gapScene()), gapBatch()), 'COVERAGE_GAP');

  const reviewed = gapScene({
    reviewed_gaps: [{ line_start: 2, line_end: 13, reason: '같은 인사말만 반복되고 사건·주장·관계가 없다.' }],
  });
  assertValid(validateShard(shardOf(reviewed), gapBatch()));

  const noReason = gapScene({ reviewed_gaps: [{ line_start: 2, line_end: 13, reason: '' }] });
  assertFails(validateShard(shardOf(noReason), gapBatch()), 'COVERAGE_GAP');

  const partial = gapScene({ reviewed_gaps: [{ line_start: 2, line_end: 8, reason: '인사말뿐이다.' }] });
  assertFails(validateShard(shardOf(partial), gapBatch()), 'COVERAGE_GAP');

  // 항목이 앞 3줄을 덮으면 남은 공백은 9줄이라 기준(10줄) 미만이다
  const firstItem = event({ line_start: 2, line_end: 4, quote: '대사 1번입니다. 대사 2번입니다. 대사 3번입니다.' });
  assertValid(validateShard(shardOf(gapScene({ events_and_claims: [firstItem] })), gapBatch()));

  // 이미 항목이 덮은 줄을 reviewed_gaps에 넣으면 실패
  const overlapping = gapScene({
    events_and_claims: [firstItem],
    reviewed_gaps: [{ line_start: 2, line_end: 13, reason: '인사말뿐이다.' }],
  });
  assertFails(validateShard(shardOf(overlapping), gapBatch()), 'COVERAGE_GAP');
});
