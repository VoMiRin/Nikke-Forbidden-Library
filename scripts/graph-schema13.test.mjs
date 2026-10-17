import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GRAPH_DATA_DIR,
  SCRIPTS_ROOT_DIR,
  PASS1_SCHEMA_VERSION,
  buildNumberedScript,
  extractSceneMechanicalGroundTruth,
  parseChapterTextBlocks,
  planSceneParts,
  sha256,
} from './graph/lib.mjs';
import { loadTermLexicon, validateShard, validateShardFile } from './graph/validate-output.mjs';
import {
  buildPartInput,
  buildReviewInput,
  combineParts,
  nextPendingBatches,
  partInputPathOf,
  partPathOf,
  pickReviewScenes,
  waveNameOf,
} from './graph/batch-parts.mjs';
import { enrichSceneFromManifest } from './graph/merge-and-index.mjs';
import { planBatches } from './graph/build-manifest.mjs';
import { applyDescriptorReview } from './graph/init-registry.mjs';
import {
  checkRepair,
  planRepairJobs,
  prepareRepair,
  refreshBatchInput,
  repairInputPathOf,
  repairOutputPathOf,
  spliceRepair,
} from './graph/repair-pass1.mjs';

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

const wideBatch = (speakerOf) =>
  batchOf(
    makeInputScene('t13_gap', [
      '[SCENE START]',
      ...Array.from({ length: 20 }, (_, i) => `${speakerOf(i)}: 대사 ${i + 1}번입니다.`),
      '[SCENE END]',
    ])
  );
const wideWarnings = (res) => res.warnings.filter((w) => w.rule === 'WIDE_RANGE');

test('2.3-22 wide range: an item covering 20+ dialogue lines by 2+ speakers warns but still passes', () => {
  const twoSpeakers = (i) => (i % 2 === 0 ? '라피' : '아니스');
  const whole = event({ line_start: 2, line_end: 21, quote: '대사 1번입니다.' });

  const res = validateShard(shardOf(gapScene({ events_and_claims: [whole] })), wideBatch(twoSpeakers));
  assertValid(res);
  assert.equal(wideWarnings(res).length, 1);
  assert.match(wideWarnings(res)[0].path, /events_and_claims\[0\]$/);

  const note = {
    subject: '라피',
    target: '아니스',
    relation_or_change: '관계',
    epistemic_type: 'established_event',
    claimant: null,
    line_start: 2,
    line_end: 21,
    claim_line: null,
    quote: '대사 1번입니다.',
    refers_to_past: false,
  };
  assert.equal(wideWarnings(validateShard(shardOf(gapScene({ relationship_and_lore_notes: [note] })), wideBatch(twoSpeakers))).length, 1);

  // 대사 19줄은 경고 없음
  const nineteen = event({ line_start: 2, line_end: 20, quote: '대사 1번입니다.' });
  assert.equal(wideWarnings(validateShard(shardOf(gapScene({ events_and_claims: [nineteen] })), wideBatch(twoSpeakers))).length, 0);

  // 20줄 이상이어도 화자가 하나면 경고 없음
  const solo = validateShard(
    shardOf(gapScene({ events_and_claims: [whole], participants: { ...gapScene().participants, present_in_scene: present('라피') } })),
    wideBatch(() => '라피')
  );
  assertValid(solo);
  assert.equal(wideWarnings(solo).length, 0);
});

// 화자 라벨 없는 기록물: 본문 12줄(L1~L12)과 구분선
const DOC_LINES = [
  '연구 일지',
  '-----',
  ...Array.from({ length: 11 }, (_, i) => `${i + 1}일차. 실험체의 상태를 기록했다.`),
];

const docScene = (overrides = {}) =>
  emptyScene('t13_docgap', {
    participants: {
      present_in_scene: [],
      present_silent: [],
      remote_or_voice_only: [],
      mentioned_only: [],
      document_author: { name: '연구원', entity_id: null, voices: [] },
    },
    ...overrides,
  });

const docBatch = (lines = DOC_LINES) => batchOf(makeInputScene('t13_docgap', lines));

test('2.3-20/21/22 unlabeled documents: text lines stand in for dialogue lines', () => {
  // 대사 줄이 없어도 본문 12줄(구분선 제외)이 비어 있으면 공백 구간이다
  const res = validateShard(shardOf(docScene()), docBatch());
  assertFails(res, 'COVERAGE_GAP');
  assert.match(res.errors.find((e) => e.rule === 'COVERAGE_GAP').message, /Text lines L1~L13 \(12 text lines\)/);

  // 항목이 본문 3줄(L1, L3, L4)을 덮으면 남은 공백은 9줄이다
  const firstItem = event({
    actor_or_speaker: '연구원',
    line_start: 1,
    line_end: 4,
    quote: '1일차. 실험체의 상태를 기록했다.',
  });
  assertValid(validateShard(shardOf(docScene({ events_and_claims: [firstItem] })), docBatch()));

  // 본문 20줄 이상을 한 항목으로 덮으면 화자 수와 관계없이 경고한다
  const longLines = Array.from({ length: 20 }, (_, i) => `${i + 1}일차. 실험체의 상태를 기록했다.`);
  const whole = event({ actor_or_speaker: '연구원', line_start: 1, line_end: 20, quote: '1일차. 실험체의 상태를 기록했다.' });
  const wide = validateShard(shardOf(docScene({ events_and_claims: [whole] })), docBatch(longLines));
  assertValid(wide);
  assert.equal(wide.warnings.filter((w) => w.rule === 'WIDE_RANGE').length, 1);

  // 본문 60줄 이상인데 사건이 없으면 밀도 경고
  const sixty = Array.from({ length: 60 }, (_, i) => `${i + 1}일차. 실험체의 상태를 기록했다.`);
  const reviewedAll = docScene({ reviewed_gaps: [{ line_start: 1, line_end: 60, reason: '같은 문장이 반복된다.' }] });
  const dense = validateShard(shardOf(reviewedAll), docBatch(sixty));
  assertValid(dense);
  assert.equal(dense.warnings.filter((w) => w.rule === 'DENSITY').length, 1);
});

test('1.2 document field labels: "FB :" in a news script is not a speaker', () => {
  const input = makeInputScene('t13_fb', ['방주에 랩쳐가 침공했습니다.', 'FB : 자세한 내용 전달 불필요.']);
  assert.deepEqual(input.mechanical_ground_truth.speakers, []);
  assert.deepEqual(input.mechanical_ground_truth.line_speaker, {});
});

// 라피의 주장 범위 안에 아니스·네온·마리안의 말이 끼어 있는 장면
const CLAIM_LINES = [
  '라피: 이번 작전은 제가 맡겠습니다.',
  '아니스: 정말?',
  '라피: 네. 지휘관의 명령입니다.',
  '네온: 저는 반대예요.',
  '라피: 그래도 따르겠습니다.',
  '마리안: 저도 같이 갈게요.',
  '아니스: ··· ···.',
  '라피: 출발하죠.',
];
const claimBatch = () => batchOf(makeInputScene('t13_claim', CLAIM_LINES));
const claimScene = (items) =>
  emptyScene('t13_claim', {
    participants: {
      present_in_scene: present('라피', '아니스', '네온', '마리안'),
      present_silent: [],
      remote_or_voice_only: [],
      mentioned_only: [],
      document_author: null,
    },
    events_and_claims: items,
  });
const rapiClaim = (lineEnd) =>
  event({
    epistemic_type: 'character_claim',
    actor_or_speaker: '라피',
    summary: '라피가 작전을 맡겠다고 말한다.',
    line_start: 1,
    line_end: lineEnd,
    claim_line: 1,
    quote: '이번 작전은 제가 맡겠습니다.',
  });
const claimWarnings = (res) => res.warnings.filter((w) => w.rule === 'CLAIM_OTHER_SPEAKERS');

test('2.3-23 claim range with other speakers: 3+ turns no item of their own covers warn but still pass', () => {
  // 아니스 L2, 네온 L4, 마리안 L6 세 차례
  const res = validateShard(shardOf(claimScene([rapiClaim(8)])), claimBatch());
  assertValid(res);
  assert.equal(claimWarnings(res).length, 1);
  assert.match(claimWarnings(res)[0].message, /3 turns .*아니스 L2, 네온 L4, 마리안 L6/);

  // 두 차례까지는 경고 없음 (L1~L5: 아니스 L2, 네온 L4)
  assert.equal(claimWarnings(validateShard(shardOf(claimScene([rapiClaim(5)])), claimBatch())).length, 0);

  // 네온의 반대를 네온 자신의 항목으로 따로 적으면 그 차례는 묻힌 것이 아니다
  const neon = event({
    epistemic_type: 'character_claim',
    actor_or_speaker: '네온',
    summary: '네온이 반대한다.',
    line_start: 4,
    line_end: 4,
    claim_line: 4,
    quote: '저는 반대예요.',
  });
  assert.equal(claimWarnings(validateShard(shardOf(claimScene([rapiClaim(8), neon])), claimBatch())).length, 0);

  // 네온의 항목이라도 라피의 말을 두 차례 이상 함께 덮으면(L3~L5) 네온 자신의 항목으로 치지 않는다
  const overlay = event({
    actor_or_speaker: '네온',
    summary: '네온이 반대한다.',
    line_start: 3,
    line_end: 5,
    quote: '저는 반대예요.',
  });
  assert.equal(claimWarnings(validateShard(shardOf(claimScene([rapiClaim(8), overlay])), claimBatch())).length, 1);
  // 라피의 앞 말 한 차례를 문맥으로 함께 덮는 것(L3~L4)은 괜찮다
  assert.equal(claimWarnings(validateShard(shardOf(claimScene([rapiClaim(8), { ...overlay, line_end: 4 }])), claimBatch())).length, 0);

  // 말줄임표만 있는 차례(아니스 L7)는 세지 않는다: L3~L8은 네온 L4, 마리안 L6 두 차례
  const tail = { ...rapiClaim(8), line_start: 3, claim_line: 3, quote: '네. 지휘관의 명령입니다.' };
  assert.equal(claimWarnings(validateShard(shardOf(claimScene([tail])), claimBatch())).length, 0);
});

test('5 Pass 1 parts: batches over 20 scenes split evenly, parts validate alone and combine in batch order', async () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
  assert.deepEqual(planSceneParts(ids(20)).map((p) => p.length), [20]);
  assert.deepEqual(planSceneParts(ids(30)).map((p) => p.length), [15, 15]);
  assert.deepEqual(planSceneParts(ids(41)).map((p) => p.length), [14, 14, 13]);
  assert.deepEqual(planSceneParts(ids(117)).flat(), ids(117));

  // 장면 21개짜리 배치 → 11개, 10개
  const sceneIds = ids(21).map((id) => `t13_part_${id}`);
  const batchInput = { ...batchOf(...sceneIds.map((id) => makeInputScene(id, ['[SCENE START]', '[SCENE END]']))), batch_id: 'batch_parts' };
  const part1 = { schema_version: PASS1_SCHEMA_VERSION, batch_id: 'batch_parts', scenes: sceneIds.slice(0, 11).map((id) => emptyScene(id)) };
  const part2 = { schema_version: PASS1_SCHEMA_VERSION, batch_id: 'batch_parts', scenes: sceneIds.slice(11).reverse().map((id) => emptyScene(id)) };

  const combined = combineParts(batchInput, [part1, part2]);
  assert.deepEqual(combined.scenes.map((s) => s.scene_id), sceneIds);
  assert.throws(() => combineParts(batchInput, [part1]), /Expected 2 part/);
  assert.throws(() => combineParts(batchInput, [part1, { ...part2, scenes: part2.scenes.slice(1) }]), /missing/);
  assert.throws(() => combineParts(batchInput, [part2, part1]), /missing/);

  const graphDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-parts-'));
  try {
    await fs.mkdir(path.join(graphDir, 'pass1', 'batches'), { recursive: true });
    await fs.mkdir(path.join(graphDir, 'pass1', 'parts'), { recursive: true });
    await fs.writeFile(path.join(graphDir, 'pass1', 'batches', 'batch_parts.json'), JSON.stringify(batchInput));
    await fs.writeFile(partPathOf('batch_parts', 1, graphDir), JSON.stringify(part1));
    assertValid(await validateShardFile('batch_parts', { part: 1, graphDir }));
    // 부분 2에 부분 1의 장면을 쓰면 장면 누락으로 실패한다
    await fs.writeFile(partPathOf('batch_parts', 2, graphDir), JSON.stringify(part1));
    assert.equal((await validateShardFile('batch_parts', { part: 2, graphDir })).valid, false);
    await assert.rejects(validateShardFile('batch_parts', { part: 3, graphDir }), /part 3 does not exist/);

    // 담당 입력이 지금 배치 입력과 다르면(옛 입력으로 추출) 실패한다
    await fs.mkdir(path.dirname(partInputPathOf('batch_parts', 1, graphDir)), { recursive: true });
    await fs.writeFile(partInputPathOf('batch_parts', 1, graphDir), JSON.stringify(buildPartInput(batchInput, 1)));
    assertValid(await validateShardFile('batch_parts', { part: 1, graphDir }));
    const stale = buildPartInput(batchInput, 1);
    stale.scenes[0] = { ...stale.scenes[0], numbered_script: '[L0001] 바뀌기 전 원문' };
    await fs.writeFile(partInputPathOf('batch_parts', 1, graphDir), JSON.stringify(stale));
    assertFails(await validateShardFile('batch_parts', { part: 1, graphDir }), 'PART_INPUT');
  } finally {
    await fs.rm(graphDir, { recursive: true, force: true });
  }
});

test('5 Pass 1 part inputs: each part holds only its scenes, unchanged, with recounted totals', async () => {
  // 실제 배치: 유실물 117장면 → 6부분
  const batchInput = JSON.parse(await fs.readFile(path.join(GRAPH_DATA_DIR, 'pass1', 'batches', 'batch_0236.json'), 'utf8'));
  const inputs = [1, 2, 3, 4, 5, 6].map((part) => buildPartInput(batchInput, part));
  assert.throws(() => buildPartInput(batchInput, 7), /no part 7/);

  // 부분을 이으면 배치 장면 순서와 같고, 장면 객체는 원본과 완전히 같다
  const joined = inputs.flatMap((p) => p.scenes);
  assert.deepEqual(joined.map((s) => s.scene_id), batchInput.scenes.map((s) => s.scene_id));
  joined.forEach((scene, idx) => assert.deepStrictEqual(scene, batchInput.scenes[idx]));

  for (const input of inputs) {
    assert.equal(input.batch_id, 'batch_0236');
    assert.equal(input.part_count, 6);
    assert.equal(input.scene_count, input.scenes.length);
    assert.equal(input.body_bytes, input.scenes.reduce((acc, s) => acc + s.body_bytes, 0));
  }
  assert.equal(inputs.reduce((acc, p) => acc + p.body_bytes, 0), batchInput.body_bytes);
  assert.equal(inputs.reduce((acc, p) => acc + p.unknown_count, 0), batchInput.unknown_count);
});

test('5 Pass 1 repair: only scenes with errors or CLAIM_OTHER_SPEAKERS are repaired, others cannot change', async () => {
  // 장면 둘: t13_claim(경고 있음), t13_qa(문제 없음)
  const batchInput = { ...batchOf(makeInputScene('t13_claim', CLAIM_LINES), makeInputScene('t13_qa', QA_LINES)), batch_id: 'batch_rep' };
  const shard = { ...shardOf(claimScene([rapiClaim(8)]), qaScene()), batch_id: 'batch_rep' };
  const bodyHash = (lines) => sha256(lines.join('\n'));
  const manifestScenes = {
    t13_claim: { source_sha256: bodyHash(CLAIM_LINES), mechanical_ground_truth: batchInput.scenes[0].mechanical_ground_truth },
    t13_qa: { source_sha256: bodyHash(QA_LINES), mechanical_ground_truth: batchInput.scenes[1].mechanical_ground_truth },
  };

  // 기계 추출값이 바뀐 장면만 새로 고치고, 원문이 바뀐 장면은 보수 대상이 아니다
  const changedMgt = { ...manifestScenes, t13_qa: { ...manifestScenes.t13_qa, mechanical_ground_truth: { ...manifestScenes.t13_qa.mechanical_ground_truth, line_speaker: {} } } };
  assert.deepEqual(refreshBatchInput(batchInput, changedMgt).changedSceneIds, ['t13_qa']);
  assert.deepEqual(refreshBatchInput(batchInput, manifestScenes).changedSceneIds, []);
  assert.throws(
    () => refreshBatchInput(batchInput, { ...manifestScenes, t13_qa: { ...manifestScenes.t13_qa, source_sha256: 'x' } }),
    /source text changed/
  );

  const graphDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-repair-'));
  try {
    for (const dir of ['batches', 'shards']) await fs.mkdir(path.join(graphDir, 'pass1', dir), { recursive: true });
    await fs.writeFile(path.join(graphDir, 'pass1', 'batches', 'batch_rep.json'), JSON.stringify(batchInput));
    await fs.writeFile(path.join(graphDir, 'pass1', 'shards', 'batch_rep.json'), JSON.stringify(shard));

    const prepared = await prepareRepair('batch_rep', { graphDir, manifestScenes });
    assert.deepEqual([...prepared.issues.keys()], ['t13_claim']);
    const repairInput = JSON.parse(await fs.readFile(repairInputPathOf('batch_rep', graphDir), 'utf8'));
    assert.deepEqual(repairInput.scenes.map((s) => s.scene_id), ['t13_claim']);
    assert.equal(repairInput.scenes[0].issues[0].rule, 'CLAIM_OTHER_SPEAKERS');
    assert.deepEqual(repairInput.scenes[0].current_output, shard.scenes[0]);
    assert.ok(fsSync.existsSync(path.join(graphDir, 'pass1', 'repairs', 'original', 'batch_rep.shard.json')));

    // 대상 장면만, 바꾼 필드만 쓴다
    const fixed = {
      scene_id: 't13_claim',
      events_and_claims: [
        { ...rapiClaim(1) },
        event({ epistemic_type: 'character_claim', actor_or_speaker: '네온', summary: '네온이 반대한다.', line_start: 4, line_end: 4, claim_line: 4, quote: '저는 반대예요.' }),
      ],
    };
    const output = { schema_version: PASS1_SCHEMA_VERSION, batch_id: 'batch_rep', scenes: [fixed] };
    assert.throws(() => spliceRepair(shard, repairInput, { ...output, scenes: [fixed, qaScene()] }), /not a target \[t13_qa\]/);
    assert.throws(() => spliceRepair(shard, repairInput, { ...output, scenes: [] }), /missing \[t13_claim\]/);
    assert.throws(() => spliceRepair(shard, repairInput, { ...output, scenes: [{ ...fixed, notes: 'x' }] }), /fields the scene does not have: notes/);
    const spliced = spliceRepair(shard, repairInput, output);
    assert.deepEqual(spliced.scenes[1], shard.scenes[1]);
    // 쓰지 않은 필드는 지금 결과 그대로
    assert.deepEqual(spliced.scenes[0].participants, shard.scenes[0].participants);
    assert.deepEqual(spliced.scenes[0].events_and_claims, fixed.events_and_claims);

    await fs.writeFile(repairOutputPathOf('batch_rep', graphDir), JSON.stringify(output));
    const checked = await checkRepair('batch_rep', { graphDir });
    assertValid(checked);
    assert.equal(checked.warnings.filter((w) => w.rule === 'CLAIM_OTHER_SPEAKERS').length, 0);

    assert.deepEqual(checked.candidate.scenes.map((s) => s.scene_id), ['t13_claim']);
    assert.deepEqual(checked.candidate.scenes[0].events_and_claims, fixed.events_and_claims);

    // prepare 뒤 대상 장면의 샤드가 바뀌었으면(다른 수정이 들어옴) 옛 보수 출력으로 덮어쓰지 않는다
    const shardFile = path.join(graphDir, 'pass1', 'shards', 'batch_rep.json');
    const edited = { ...shard, scenes: [{ ...shard.scenes[0], summary: '다른 수정이 들어왔다.' }, shard.scenes[1]] };
    await fs.writeFile(shardFile, JSON.stringify(edited));
    await assert.rejects(checkRepair('batch_rep', { graphDir }), /changed since prepare for t13_claim/);
    // 대상이 아닌 장면이 바뀐 것은 막지 않는다(그 장면은 지금 샤드 그대로 남는다)
    await fs.writeFile(shardFile, JSON.stringify({ ...shard, scenes: [shard.scenes[0], { ...shard.scenes[1], summary: '다른 장면 수정.' }] }));
    assertValid(await checkRepair('batch_rep', { graphDir }));
    // 배치 입력의 기계 추출값이 바뀌어도 다시 prepare해야 한다
    await fs.writeFile(shardFile, JSON.stringify(shard));
    const inputFile = path.join(graphDir, 'pass1', 'batches', 'batch_rep.json');
    const movedInput = { ...batchInput, scenes: [{ ...batchInput.scenes[0], mechanical_ground_truth: { ...batchInput.scenes[0].mechanical_ground_truth, unknowns: [{ line: 1 }] } }, batchInput.scenes[1]] };
    await fs.writeFile(inputFile, JSON.stringify(movedInput));
    await assert.rejects(checkRepair('batch_rep', { graphDir }), /changed since prepare/);
    await fs.writeFile(inputFile, JSON.stringify(batchInput));

    // 보수 출력이 남아 있으면 다음 회차 prepare는 멈춘다
    await assert.rejects(prepareRepair('batch_rep', { graphDir, manifestScenes }), /previous repair round/);

    // 보수 출력에 오류가 있으면 실패
    const broken = { ...output, scenes: [{ scene_id: 't13_claim', events_and_claims: [{ ...rapiClaim(1), quote: '없는 대사입니다.' }] }] };
    await fs.writeFile(repairOutputPathOf('batch_rep', graphDir), JSON.stringify(broken));
    assert.equal((await checkRepair('batch_rep', { graphDir })).valid, false);
  } finally {
    await fs.rm(graphDir, { recursive: true, force: true });
  }

  // 작업 묶기: 배치를 쪼개지 않고, 크기 합 / 상한만큼의 작업에 고르게
  const jobs = planRepairJobs({ a: 250, b: 170, c: 120, d: 40, e: 10, f: 0 }, 256);
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.flatMap((j) => j.batch_ids).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(Math.max(...jobs.map((j) => j.input_bytes)) <= 256);
});

test('2.3-24 premature identity: a name revealed later in the scene must not be used before the reveal line', () => {
  // L2~3 ??? 가 말하고, L4에서 지엔이라고 밝혀진다
  const lines = ['[SCENE START]', '???: 방주 깊은 곳의 어둠을 조심해요.', '마나: 누구시죠?', '지엔: 지엔이에요. 잘 부탁해요.', '[SCENE END]'];
  const batch = batchOf(makeInputScene('t13_reveal', lines));
  const unknownId = batch.scenes[0].mechanical_ground_truth.unknowns[0].unknown_id;
  const scene = (actor) =>
    emptyScene('t13_reveal', {
      participants: { present_in_scene: present('마나', '지엔'), present_silent: [], remote_or_voice_only: [], mentioned_only: [], document_author: null },
      unknown_speakers: [
        {
          unknown_id: unknownId,
          line: 2,
          quote: '방주 깊은 곳의 어둠을 조심해요.',
          speaking_style: '느긋한 존댓말',
          contextual_clues: [],
          resolved_in_same_scene_to: { surface_text: '지엔', entity_id: null, line_start: 4, line_end: 4, quote: '지엔: 지엔이에요. 잘 부탁해요.' },
        },
      ],
      events_and_claims: [
        event({ epistemic_type: 'character_claim', actor_or_speaker: actor, summary: '어둠을 조심하라고 경고한다.', line_start: 2, line_end: 2, claim_line: 2, quote: '방주 깊은 곳의 어둠을 조심해요.' }),
      ],
    });
  const warnings = (res) => res.warnings.filter((w) => w.rule === 'PREMATURE_IDENTITY');
  const early = validateShard(shardOf(scene('지엔')), batch);
  assert.equal(warnings(early).length, 1, JSON.stringify(early.errors));
  assert.equal(warnings(validateShard(shardOf(scene('???')), batch)).length, 0);

  // 공개 전에 다른 인물이 그 이름을 이미 말했으면 그 인물을 가리킨 것일 수 있어 경고하지 않는다
  const namedBefore = ['[SCENE START]', '마나: 지엔이 올 거예요.', '???: 방주 깊은 곳의 어둠을 조심해요.', '지엔: 지엔이에요.', '[SCENE END]'];
  const batch2 = batchOf(makeInputScene('t13_reveal', namedBefore));
  const s2 = scene('지엔');
  s2.unknown_speakers[0] = { ...s2.unknown_speakers[0], unknown_id: batch2.scenes[0].mechanical_ground_truth.unknowns[0].unknown_id, line: 3 };
  s2.events_and_claims[0] = { ...s2.events_and_claims[0], line_start: 3, line_end: 3, claim_line: 3 };
  assert.equal(warnings(validateShard(shardOf(s2), batch2)).length, 0);
});

test('2.3-25 names not in the scene: warn on rare names only, ignoring word parts, spacing and generic tails', () => {
  const lines = ['[SCENE START]', '엑시아: 안-녕-', '노벨: 메티스가 온 것입니다. 여기는 데이터베이스인 것입니다.', '[SCENE END]'];
  const batch = batchOf(makeInputScene('t13_term', lines));
  const lexicon = {
    terms: new Map([
      ['데이터 센터', 'location name'],
      ['이그조틱', 'squad name'],
      ['메티스 스쿼드', 'squad name'],
      ['나가', 'registered character'],
      ['소라', 'registered character'],
    ]),
    sceneCountOf: (term) => (term === '나가' ? 1383 : 5),
  };
  const scene = (summary, eventSummary = '엑시아가 인사한다.') =>
    emptyScene('t13_term', {
      summary,
      participants: { present_in_scene: present('엑시아', '노벨'), present_silent: [], remote_or_voice_only: [], mentioned_only: [], document_author: null },
      events_and_claims: [event({ actor_or_speaker: '엑시아', summary: eventSummary, line_start: 2, line_end: 2, quote: '안-녕-' })],
    });
  const termWarnings = (s, b = batch) =>
    validateShard(shardOf(s), b, { termLexicon: lexicon }).warnings.filter((w) => w.rule === 'TERM_NOT_IN_SCENE');

  const leaked = termWarnings(scene('데이터 센터에서 엑시아를 만난다.', '이그조틱이 나간다.'));
  assert.deepEqual(leaked.map((w) => w.path), ['$.scenes[0].summary', '$.scenes[0].events_and_claims[0]']);
  assert.match(leaked[0].message, /"데이터 센터"/);
  assert.match(leaked[1].message, /"이그조틱"/); // `나간다`의 `나가`는 흔한 이름이라 보지 않는다

  // 끝의 일반 낱말(스쿼드), 다른 낱말의 일부(장소라고), 이름 목록이 없을 때는 경고하지 않는다
  assert.equal(termWarnings(scene('메티스 스쿼드가 온다.', '엑시아가 이 장소라고 말한다.')).length, 0);
  assert.equal(
    validateShard(shardOf(scene('데이터 센터에서 만난다.')), batch).warnings.filter((w) => w.rule === 'TERM_NOT_IN_SCENE').length,
    0
  );

  // 띄어쓰기만 다르면 장면에 있는 것이다
  const spaced = batchOf(makeInputScene('t13_term', ['[SCENE START]', '엑시아: 안-녕-', '노벨: 데이터센터인 것입니다.', '[SCENE END]']));
  assert.equal(termWarnings(scene('데이터 센터에서 만난다.'), spaced).length, 0);
});

test('2.3-25 term lexicon: registry names without generic roles, merged and own candidates, corpus scene counts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-terms-'));
  try {
    await fs.mkdir(path.join(dir, 'pass1', 'batches'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'entity_registry.json'),
      JSON.stringify({
        entities: [
          { canonical_name: '모더니아', surface_labels: ['모더니아'], is_generic_role: false },
          { canonical_name: '병사', surface_labels: ['병사'], is_generic_role: true },
          { canonical_name: '[블랙로즈]', surface_labels: ['[블랙로즈]'], is_generic_role: false },
        ],
      })
    );
    await fs.writeFile(
      path.join(dir, 'unregistered_entity_candidates.json'),
      JSON.stringify({ candidates: [{ surface_text: '데이터 센터', suggested_type: 'location' }] })
    );
    const batchFile = (id, scripts) =>
      fs.writeFile(
        path.join(dir, 'pass1', 'batches', `${id}.json`),
        JSON.stringify({ scenes: scripts.map((s, i) => ({ scene_id: `${id}_${i}`, title: 't', sub_title: '', numbered_script: s })) })
      );
    await batchFile('batch_0001', ['[L0001] 노벨: 데이터센터인 것입니다.', '[L0001] 라피: 모더니아.']);
    await batchFile('batch_0002', ['[L0001] 엑시아: 데이터 센터.']);
    await batchFile('pilot_0001', ['[L0001] 엑시아: 데이터 센터.']); // 파일럿 배치는 세지 않는다
    const shard = shardOf(emptyScene('x', { unregistered_entity_candidates: [{ surface_text: '실버건', suggested_type: 'squad', line_start: 1 }] }));

    const lexicon = await loadTermLexicon(dir, shard);
    assert.deepEqual([...lexicon.terms.keys()].sort(), ['데이터 센터', '모더니아', '실버건']);
    assert.equal(lexicon.sceneCountOf('데이터 센터'), 2);
    assert.equal(lexicon.sceneCountOf('모더니아'), 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('5 Pass 1 waves: next pending batches in number order, skipping merged and pilot batches', () => {
  const progress = {
    batches: {
      batch_0010: { batch_id: 'batch_0010', status: 'pending' },
      batch_0002: { batch_id: 'batch_0002', status: 'pending' },
      batch_0001: { batch_id: 'batch_0001', status: 'merged' },
      batch_0003: { batch_id: 'batch_0003', status: 'failed' },
      pilot_0001: { batch_id: 'pilot_0001', status: 'pending', is_pilot: true },
      batch_0004: { batch_id: 'batch_0004', status: 'pending' },
    },
  };
  assert.deepEqual(nextPendingBatches(progress, 2), ['batch_0002', 'batch_0004']);
  assert.deepEqual(nextPendingBatches(progress, 10), ['batch_0002', 'batch_0004', 'batch_0010']);
});

test('5 Pass 1 waves: review sample is picked mechanically from the wave', () => {
  const scene = (id, unknowns, dialogue) => ({
    scene_id: id,
    mechanical_ground_truth: {
      unknowns: Array.from({ length: unknowns }, (_, i) => ({ line: i + 1 })),
      line_speaker: Object.fromEntries(Array.from({ length: dialogue }, (_, i) => [String(i + 1), '라피'])),
    },
  });
  const wave = [
    { batch_id: 'batch_a', scenes: [scene('a1', 5, 10), scene('a2', 0, 90), scene('a3', 0, 20)] },
    { batch_id: 'batch_b', scenes: [scene('b1', 0, 40), scene('b2', 1, 30), scene('b3', 0, 35)] },
  ];
  assert.deepEqual(
    pickReviewScenes(wave).map((r) => r.scene_id),
    ['a1', 'b1', 'b3'] // ??? 최다 a1, 다른 배치의 대사 최다 b1, 마지막 배치 뒤쪽 b3
  );

  // 화자 없는 문서 장면이 있으면 본문 줄이 가장 많은 문서 장면을 하나 더 고른다
  const doc = (id, lines) => ({
    scene_id: id,
    numbered_script: buildNumberedScript(lines),
    mechanical_ground_truth: { unknowns: [], line_speaker: {} },
  });
  const withDocs = [...wave, { batch_id: 'batch_c', scenes: [doc('c1', ['기록 1', '기록 2']), doc('c2', ['기록 1', '-----', '기록 2', '기록 3'])] }];
  const picked = pickReviewScenes(withDocs);
  assert.equal(picked.at(-1).scene_id, 'c2');
  assert.equal(picked.at(-1).document_text, 3);
});

test('5 Pass 1 waves: review input carries whole scene objects and marks samples that were not merged', () => {
  assert.equal(waveNameOf(['batch_0002', 'batch_0003', 'batch_0011']), 'wave_0002-0011');
  const inputScene = (id) => ({ scene_id: id, numbered_script: '[L0001] 라피: 가자.', mechanical_ground_truth: { unknowns: [] } });
  const shardScene = (id) => ({ scene_id: id, events_and_claims: [{ summary: `${id} 사건` }] });
  const review = buildReviewInput({
    wave: 'wave_0002-0004',
    reviewScenes: [
      { batch_id: 'batch_0002', scene_id: 'a1', reason: '??? 줄 최다' },
      { batch_id: 'batch_0003', scene_id: 'b1', reason: '대사 줄 최다(다른 배치)' },
      { batch_id: 'batch_0004', scene_id: 'c1', reason: '마지막 배치 뒤쪽 3분의 1' },
      { batch_id: 'batch_0002', scene_id: 'a9', reason: '대사 줄 최다' },
    ],
    batchInputs: {
      batch_0002: { scenes: [inputScene('a1')] },
      batch_0003: { scenes: [inputScene('b1')] },
      batch_0004: { scenes: [inputScene('c1')] },
    },
    shards: { batch_0002: { scenes: [shardScene('a1')] }, batch_0003: { scenes: [shardScene('b1')] } },
    mergedBatchIds: ['batch_0002'],
  });
  assert.deepEqual(
    review.scenes.map((s) => [s.scene_id, s.status]),
    [['a1', 'ok'], ['b1', 'not_merged'], ['c1', 'no_shard'], ['a9', 'scene_missing']]
  );
  assert.deepEqual(review.scenes[0].input_scene, inputScene('a1'));
  assert.deepEqual(review.scenes[0].extraction, shardScene('a1'));
  assert.equal(review.scenes[2].extraction, null);
  assert.equal(review.scenes[0].source.shard, 'data/graph/pass1/shards/batch_0002.json');
});
