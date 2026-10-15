import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  ROOT_DIR,
  SCRIPTS_ROOT_DIR,
  GRAPH_DATA_DIR,
  loadNewScriptsData,
  parseChapterTextBlocks,
  extractSceneMechanicalGroundTruth,
  normalizeNewlines,
} from './graph/lib.mjs';
import { buildInitialRegistry, classifyGenericRole } from './graph/init-registry.mjs';
import {
  buildManifestAndBatches,
  packScenesIntoBatches,
  MIN_BATCH_BYTES,
  MAX_BATCH_BYTES,
} from './graph/build-manifest.mjs';
import { validateShard } from './graph/validate-output.mjs';
import { mergeValidatedShards, enrichSceneFromManifest } from './graph/merge-and-index.mjs';

const manifestRaw = await fs.readFile(path.join(GRAPH_DATA_DIR, 'manifest.json'), 'utf8');
const manifestDoc = JSON.parse(manifestRaw);
const newScriptsData = loadNewScriptsData();

test('2.4.1 registered files parsed scene IDs match newScriptsData entries exactly', async () => {
  const byFile = new Map();
  for (const script of newScriptsData) {
    const rel = `${script.categoryKey}/${script.mainChapterFile}`;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(script.id);
  }

  assert.equal(byFile.size, manifestDoc.totals.titles_count);
  assert.equal(newScriptsData.length, manifestDoc.totals.scenes_count);

  for (const [rel, expectedIds] of byFile.entries()) {
    const fullPath = path.join(SCRIPTS_ROOT_DIR, rel);
    const raw = await fs.readFile(fullPath, 'utf8');
    const blocks = parseChapterTextBlocks(raw);
    const parsedIds = blocks.map((b) => b.scene_id);
    assert.deepEqual(parsedIds, expectedIds, `Scene ID list mismatch in ${rel}`);
  }
});

test('2.4.2 total ???: line count in manifest matches raw grep -cE "^\\s*\\?\\?\\?:" sum across all registered files', async () => {
  const uniqueFiles = new Set(
    newScriptsData.map((s) => `${s.categoryKey}/${s.mainChapterFile}`)
  );

  let rawGrepSum = 0;
  for (const rel of uniqueFiles) {
    const raw = normalizeNewlines(await fs.readFile(path.join(SCRIPTS_ROOT_DIR, rel), 'utf8'));
    for (const line of raw.split('\n')) {
      if (/^\s*\?\?\?:/.test(line)) {
        rawGrepSum += 1;
      }
    }
  }

  let manifestUnknownSum = 0;
  for (const scene of Object.values(manifestDoc.scenes)) {
    manifestUnknownSum += scene.mechanical_ground_truth.unknowns.length;
  }

  assert.equal(rawGrepSum, 1071);
  assert.equal(manifestDoc.totals.total_unknown_lines, rawGrepSum);
  assert.equal(manifestUnknownSum, rawGrepSum);
});

test('2.4.3 second_affection_08 and second_affection_09 are NOT detected as parallel routes, and [OPTION TEXT] line_speaker is 지휘관', () => {
  const scene08 = manifestDoc.scenes['second_affection_08'];
  const scene09 = manifestDoc.scenes['second_affection_09'];

  assert.ok(scene08, 'second_affection_08 must exist in manifest');
  assert.ok(scene09, 'second_affection_09 must exist in manifest');

  assert.equal(scene08.route.subtitle_branch, undefined);
  assert.deepEqual(scene08.route.parallel_scene_ids, []);
  assert.equal(scene09.route.subtitle_branch, undefined);
  assert.deepEqual(scene09.route.parallel_scene_ids, []);

  // 1.5 (e) & 2.4: 선택지가 있는 장면에서 [OPTION TEXT] 줄의 line_speaker가 지휘관이고 speakers에 option 출처로 포함됨
  const sceneWithChoice = manifestDoc.scenes['main_30_08'];
  assert.ok(sceneWithChoice);
  const firstOptionLine = sceneWithChoice.mechanical_ground_truth.choices.choice_blocks[0].options[0].line;
  assert.equal(
    sceneWithChoice.mechanical_ground_truth.line_speaker[firstOptionLine] ??
      sceneWithChoice.mechanical_ground_truth.line_speaker[String(firstOptionLine)],
    '지휘관'
  );
  const commanderSpeaker = sceneWithChoice.mechanical_ground_truth.speakers.find(
    (s) => s.speaker_label === '지휘관'
  );
  assert.ok(commanderSpeaker, '지휘관 must be in speakers for scenes with choices');
  assert.ok(commanderSpeaker.sources.includes('option'));
});

test('2.4.4 2x2_love_1ch_13 extracts 3 NEXT_ROUTE entries (TARGET _16, _17, _18) and links parallel targets', () => {
  const scene13 = manifestDoc.scenes['2x2_love_1ch_13'];
  assert.ok(scene13, '2x2_love_1ch_13 must exist in manifest');
  assert.equal(scene13.route.is_branch_point, true);

  const routes = scene13.route.next_routes;
  assert.equal(routes.length, 3);
  assert.deepEqual(
    routes.map((r) => r.target),
    ['2x2_love_1ch_16', '2x2_love_1ch_17', '2x2_love_1ch_18']
  );
  for (const r of routes) {
    assert.equal(r.if_choice, 'route_sxp7');
    assert.equal(r.is_default, false);
  }

  const scene16 = manifestDoc.scenes['2x2_love_1ch_16'];
  assert.ok(scene16.route.parallel_scene_ids.includes('2x2_love_1ch_17'));
  assert.ok(scene16.route.parallel_scene_ids.includes('2x2_love_1ch_18'));
});

test('2.4.5 messenger scenes capture SENDER and PARTICIPANTS as speakers and never parse body colon lines as speakers', async () => {
  // 1) Synthetic messenger block containing colon lines inside message bubble
  const syntheticScene = {
    scene_id: 'test_msg_01',
    category: 'blabla',
    title: '777',
    body_lines: [
      '[MESSENGER_START TITLE="777" PARTICIPANTS="블랑,누아르,지휘관"]',
      '[MSG SENDER="블랑"]',
      '가짜화자: 이 줄은 메시지 본문이므로 화자로 잡히면 안 됩니다!',
      '회의 시간: 15:00입니다.',
      '[MSG_END]',
      '[MSG SENDER="SYSTEM" IS_SYSTEM="true"]',
      '시스템: 공지사항입니다.',
      '[MSG_END]',
      '[MESSENGER_END]',
    ],
  };

  const mgt = extractSceneMechanicalGroundTruth(syntheticScene);
  const speakerLabels = mgt.speakers.map((s) => s.speaker_label);
  assert.ok(speakerLabels.includes('블랑'));
  assert.ok(speakerLabels.includes('누아르'));
  assert.ok(speakerLabels.includes('지휘관'));
  assert.ok(!speakerLabels.includes('가짜화자'), 'Body colon prefix must not become a speaker');
  assert.ok(!speakerLabels.includes('회의 시간'), 'Body colon prefix must not become a speaker');
  assert.ok(!speakerLabels.includes('SYSTEM'), 'System sender must not become a speaker');
  assert.equal(mgt.line_speaker[3], '블랑');
  assert.equal(mgt.line_speaker[4], '블랑');

  // 2) Real corpus blabla file check (public/scripts/blabla/group/777.txt)
  const realBlablaRaw = await fs.readFile(
    path.join(SCRIPTS_ROOT_DIR, 'blabla/group/777.txt'),
    'utf8'
  );
  const realBlocks = parseChapterTextBlocks(realBlablaRaw);
  assert.ok(realBlocks.length > 0);
  const firstRealMgt = extractSceneMechanicalGroundTruth({
    scene_id: realBlocks[0].scene_id,
    body_lines: realBlocks[0].body_lines,
    category: 'blabla',
    title: '777',
  });
  const realSenders = firstRealMgt.speakers.filter((s) =>
    s.sources.includes('messenger_sender')
  );
  assert.ok(realSenders.length > 0, 'Real messenger scene must extract SENDER speakers');
});

test('1.4 & 1.6 batch packing and initial registry rules work as specified', async () => {
  // Check all batches in manifest are within 40~80KB
  for (const b of manifestDoc.batches) {
    assert.ok(
      b.raw_bytes >= MIN_BATCH_BYTES && b.raw_bytes <= MAX_BATCH_BYTES,
      `Batch ${b.batch_id} raw_bytes ${b.raw_bytes} outside 40KB~80KB`
    );
  }

  // Check single >80KB scene gets its own batch
  const oversizedPack = packScenesIntoBatches([
    {
      scene_id: 's_small_1',
      raw_bytes: 45 * 1024,
      body_bytes: 44 * 1024,
      mechanical_ground_truth: { unknowns: [] },
    },
    {
      scene_id: 's_huge',
      raw_bytes: 95 * 1024,
      body_bytes: 94 * 1024,
      mechanical_ground_truth: { unknowns: [] },
    },
    {
      scene_id: 's_small_2',
      raw_bytes: 45 * 1024,
      body_bytes: 44 * 1024,
      mechanical_ground_truth: { unknowns: [] },
    },
  ]);
  assert.equal(oversizedPack.length, 3);
  assert.deepEqual(oversizedPack[1].scene_ids, ['s_huge']);

  // Check generic_roles.json and entity_registry.json
  const genericDoc = JSON.parse(
    await fs.readFile(path.join(GRAPH_DATA_DIR, 'generic_roles.json'), 'utf8')
  );
  const registryDoc = JSON.parse(
    await fs.readFile(path.join(GRAPH_DATA_DIR, 'entity_registry.json'), 'utf8')
  );

  for (const mustBeGeneric of ['???', '병사', '연구원', '양산형 니케', '시민']) {
    assert.ok(
      genericDoc.role_labels.includes(mustBeGeneric),
      `${mustBeGeneric} must be in generic_roles.json`
    );
    assert.equal(registryDoc.speaker_lookup[mustBeGeneric]?.entity_id, null);
    assert.equal(registryDoc.speaker_lookup[mustBeGeneric]?.is_generic_role, true);
  }

  // Check 1.6 descriptor_alias labels (e.g. 인자해 보이는 남자, 검은 물을 덮은 소녀)
  const rolesByLabel = new Map(genericDoc.roles.map((r) => [r.speaker_label, r]));
  for (const descLabel of ['인자해 보이는 남자', '검은 물을 덮은 소녀']) {
    const roleEntry = rolesByLabel.get(descLabel);
    assert.ok(roleEntry, `${descLabel} must be in generic_roles.json`);
    assert.equal(roleEntry.role_category, 'descriptor_alias');
    assert.equal(roleEntry.is_generic_role, true);
    assert.equal(roleEntry.entity_id, null);
    assert.equal(registryDoc.speaker_lookup[descLabel]?.role_category, 'descriptor_alias');
    assert.equal(registryDoc.speaker_lookup[descLabel]?.is_generic_role, true);
    assert.equal(registryDoc.speaker_lookup[descLabel]?.entity_id, null);
  }

  for (const mustBeNamed of ['라피', '아니스', '네온', '지휘관', 'D', '리틀 머메이드']) {
    assert.equal(registryDoc.speaker_lookup[mustBeNamed]?.is_generic_role, false);
    assert.ok(registryDoc.speaker_lookup[mustBeNamed]?.entity_id);
  }

  // Distinct speaker names stay distinct (1.6)
  assert.notEqual(
    registryDoc.speaker_lookup['라피']?.entity_id,
    registryDoc.speaker_lookup['라피의 목소리']?.entity_id
  );
});

test('2.3 & 2.4.6 validate-output catches all required failure modes and passes valid shard (v1.2.0)', () => {
  // Also verify extractSceneMechanicalGroundTruth extracts indented ???: inside choice blocks
  // and assigns line_speaker="지휘관" to [OPTION TEXT]
  const choiceUnknownMgt = extractSceneMechanicalGroundTruth({
    scene_id: 'choice_unk_scene',
    category: 'event',
    title: '테스트',
    body_lines: [
      '???: 첫 번째 미상 대사다.',
      '[CHOICE_START]',
      '[OPTION TEXT="누구냐!"]',
      '   ???: 선택지 안의 미상 대사다.',
      '[OPTION_END]',
      '[CHOICE_END]',
    ],
  });
  assert.equal(choiceUnknownMgt.unknowns.length, 2);
  assert.equal(choiceUnknownMgt.unknowns[0].line, 1);
  assert.equal(choiceUnknownMgt.unknowns[1].line, 4);
  assert.equal(choiceUnknownMgt.unknowns[1].text, '선택지 안의 미상 대사다.');
  assert.equal(choiceUnknownMgt.line_speaker[3], '지휘관');
  assert.ok(choiceUnknownMgt.speakers.some((s) => s.speaker_label === '지휘관' && s.sources.includes('option')));

  const sampleBatchInput = {
    schema_version: '1.2.0',
    batch_id: 'batch_9999',
    scenes: [
      {
        scene_id: 'test_scene_1',
        numbered_script: [
          '[L0001] [SCENE START]',
          '[L0002] 라피: 지휘관님, 아니스는 아직 도착하지 않았습니다.',
          '[L0003] ???: 크크크··· 날 찾았나?',
          '[L0004] [CHOICE_START]',
          '[L0005] [OPTION TEXT="누구냐!"]',
          '[L0006]    ???: 어딜 보는 거냐?',
          '[L0007] [OPTION_END]',
          '[L0008] [OPTION TEXT="경계한다."]',
          '[L0009] [OPTION_END]',
          '[L0010] [CHOICE_END]',
          '[L0011] 라피: 조심하십시오.',
          '[L0012] 라피: 적이 가까이에 있습니다.',
          '[L0013] [SCENE END]',
        ].join('\n'),
        mechanical_ground_truth: {
          speakers: [
            { speaker_label: '라피', sources: ['dialogue'], dialogue_line_count: 3, first_line: 2 },
            { speaker_label: '???', sources: ['dialogue'], dialogue_line_count: 2, first_line: 3 },
            { speaker_label: '지휘관', sources: ['option'], dialogue_line_count: 2, first_line: 5 },
          ],
          unknowns: [
            { unknown_id: 'unk_test_scene_1_L0003', line: 3, text: '크크크··· 날 찾았나?' },
            { unknown_id: 'unk_test_scene_1_L0006', line: 6, text: '어딜 보는 거냐?' },
          ],
          choices: {
            choice_blocks: [
              {
                choice_line: 4,
                end_line: 10,
                choice_id: null,
                in_messenger: false,
                is_branching: true,
                options: [
                  { line: 5, end_line: 7, option_text: '누구냐!', option_value: null, body_line_count: 1 },
                  { line: 8, end_line: 9, option_text: '경계한다.', option_value: null, body_line_count: 0 },
                ],
              },
            ],
            next_routes: [],
          },
          route: {
            is_branch_point: false,
            next_routes: [],
            incoming_routes: [],
            parallel_scene_ids: [],
          },
          line_speaker: {
            2: '라피',
            3: '???',
            5: '지휘관',
            6: '???',
            8: '지휘관',
            11: '라피',
            12: '라피',
          },
        },
      },
      {
        scene_id: 'test_scene_2',
        numbered_script: '[L0001] 네온: 네.',
        mechanical_ground_truth: {
          speakers: [
            { speaker_label: '네온', sources: ['dialogue'], dialogue_line_count: 1, first_line: 1 },
          ],
          unknowns: [],
          choices: { choice_blocks: [], next_routes: [] },
          route: {},
          line_speaker: { 1: '네온' },
        },
      },
    ],
  };

  const makeValidShard = () => ({
    schema_version: '1.2.0',
    batch_id: 'batch_9999',
    scenes: [
      {
        scene_id: 'test_scene_1',
        chronology_type: 'present',
        is_plot_critical: true,
        summary: '라피가 아니스의 부재를 알리던 중 미상 화자가 등장한다.',
        participants: {
          present_in_scene: [
            { speaker_label: '라피', entity_id: 'char_라피', is_generic_role: false },
            { speaker_label: '지휘관', entity_id: 'char_지휘관', is_generic_role: false },
          ],
          present_silent: [],
          remote_or_voice_only: [],
          mentioned_only: [
            {
              surface_text: '아니스',
              entity_id: 'char_아니스',
              entity_type: 'character',
              line_start: 2,
              line_end: 2,
              quote: '아니스는 아직 도착하지 않았습니다.',
            },
          ],
          document_author: null,
        },
        forms_of_address: [
          {
            from_speaker: '라피',
            to_target: '지휘관',
            address_term: '지휘관님',
            line_start: 2,
            line_end: 2,
            quote: '지휘관님, 아니스는 아직 도착하지 않았습니다.',
          },
        ],
        unknown_speakers: [
          {
            unknown_id: 'unk_test_scene_1_L0003',
            quote: '크크크··· 날 찾았나?',
            speaking_style: '비웃는 어조',
            target_addressed: '지휘관 일행',
            contextual_clues: ['기습 등장'],
            resolved_in_same_scene_to: null,
          },
          {
            unknown_id: 'unk_test_scene_1_L0006',
            quote: '어딜 보는 거냐?',
            speaking_style: '위협적인 어조',
            target_addressed: '지휘관',
            contextual_clues: ['선택지 분기 내 반응'],
            resolved_in_same_scene_to: null,
          },
        ],
        same_scene_speaker_groups: [
          {
            unknown_ids: ['unk_test_scene_1_L0003', 'unk_test_scene_1_L0006'],
            confidence: '유력한 해석',
            reason: '기습 등장 후 선택지 반응으로 이어지는 동일 미상 화자',
          },
        ],
        cross_scene_hints: [
          {
            text: '이후 장면에서 정체가 공개될 수 있는 기습 화자',
            related_scene_ids: ['test_scene_2'],
          },
        ],
        choice_branches: [
          {
            choice_line: 4,
            options: [
              { option_text: '누구냐!', continuation_summary: '정체를 묻는다', branch_specific_facts: [] },
              { option_text: '경계한다.', continuation_summary: '자세를 낮춘다', branch_specific_facts: [] },
            ],
          },
        ],
        events_and_claims: [
          {
            epistemic_type: 'established_event',
            chronology_type: 'present',
            actor_or_speaker: '라피',
            summary: '아니스가 아직 도착하지 않았다고 보고함',
            line_start: 2,
            line_end: 2,
            quote: '지휘관님, 아니스는 아직 도착하지 않았습니다.',
            branch_specific: false,
            branch_option_text: null,
            refers_to_past: false,
          },
          {
            epistemic_type: 'established_event',
            chronology_type: 'present',
            actor_or_speaker: '라피',
            summary: '라피가 두 줄에 걸쳐 적의 접근을 경고함 (화자 라벨 제거 대사 연결 인용 허용 확인)',
            line_start: 11,
            line_end: 12,
            quote: '조심하십시오. 적이 가까이에 있습니다.',
            branch_specific: false,
            branch_option_text: null,
            refers_to_past: false,
          },
        ],
        clues_and_hooks: [],
        relationship_and_lore_notes: [],
        unregistered_entity_candidates: [],
      },
      {
        scene_id: 'test_scene_2',
        chronology_type: 'present',
        is_plot_critical: false,
        summary: '네온이 짧게 대답한다.',
        participants: {
          present_in_scene: [
            { speaker_label: '네온', entity_id: 'char_네온', is_generic_role: false },
          ],
          present_silent: [],
          remote_or_voice_only: [],
          mentioned_only: [],
          document_author: null,
        },
        forms_of_address: [],
        unknown_speakers: [],
        same_scene_speaker_groups: [],
        cross_scene_hints: [],
        choice_branches: [],
        events_and_claims: [
          {
            epistemic_type: 'established_event',
            chronology_type: 'present',
            actor_or_speaker: '네온',
            summary: '네온이 짧게 긍정함',
            line_start: 1,
            line_end: 1,
            quote: '네.',
            branch_specific: false,
            branch_option_text: null,
            refers_to_past: false,
          },
        ],
        clues_and_hooks: [],
        relationship_and_lore_notes: [],
        unregistered_entity_candidates: [],
      },
    ],
  });

  // 0. 정상 샤드 통과 확인 (원문 대사 전체가 4글자 미만인 '네.' 단답 허용, 조사 결합 '아니스는' 포함, 다중 줄 화자 라벨 제거 인용 허용)
  const validRes = validateShard(makeValidShard(), sampleBatchInput);
  assert.equal(validRes.valid, true, JSON.stringify(validRes.errors));
  assert.equal(validRes.errors.length, 0);

  // 1. 언급만 된 인물("아니스")을 present_in_scene에 넣은 경우 실패
  const mentionedAsPresent = makeValidShard();
  mentionedAsPresent.scenes[0].participants.present_in_scene.push({
    speaker_label: '아니스',
    entity_id: 'char_아니스',
    is_generic_role: false,
  });
  const res1 = validateShard(mentionedAsPresent, sampleBatchInput);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.rule === 'SPEAKER_EXISTENCE'));

  // 1b. "???"를 present_in_scene에 넣은 경우 실패 (3.2)
  const unknownAsPresent = makeValidShard();
  unknownAsPresent.scenes[0].participants.present_in_scene.push({
    speaker_label: '???',
    entity_id: null,
    is_generic_role: true,
  });
  const res1b = validateShard(unknownAsPresent, sampleBatchInput);
  assert.equal(res1b.valid, false);
  assert.ok(res1b.errors.some((e) => e.rule === 'SPEAKER_EXISTENCE'));

  // 2. 인용 줄 범위가 틀린 경우 (2번 줄 대사를 5~6번 줄로 기입) 실패
  const wrongLineRange = makeValidShard();
  wrongLineRange.scenes[0].events_and_claims[0].line_start = 5;
  wrongLineRange.scenes[0].events_and_claims[0].line_end = 6;
  const res2 = validateShard(wrongLineRange, sampleBatchInput);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.rule === 'QUOTE_LOCATION'));

  // 2b. ··· 를 ... 로 바꾼 인용문 실패 (2.3.4: ···와 ...는 같은 것으로 보지 않음)
  const wrongEllipsis = makeValidShard();
  wrongEllipsis.scenes[0].unknown_speakers[0].quote = '크크크... 날 찾았나?';
  const res2b = validateShard(wrongEllipsis, sampleBatchInput);
  assert.equal(res2b.valid, false);
  assert.ok(res2b.errors.some((e) => e.rule === 'QUOTE_LOCATION'));

  // 2c. 1~3글자 조각(예: "다.", "아니스")만 넣은 quote 실패 (2.3.4 최소 길이 규칙)
  const tooShortQuote = makeValidShard();
  tooShortQuote.scenes[0].events_and_claims[0].quote = '다.';
  const res2c = validateShard(tooShortQuote, sampleBatchInput);
  assert.equal(res2c.valid, false);
  assert.ok(res2c.errors.some((e) => e.rule === 'QUOTE_LOCATION'));

  const threeCharQuote = makeValidShard();
  threeCharQuote.scenes[0].participants.mentioned_only[0].quote = '아니스';
  const res2d = validateShard(threeCharQuote, sampleBatchInput);
  assert.equal(res2d.valid, false);
  assert.ok(res2d.errors.some((e) => e.rule === 'QUOTE_LOCATION'));

  // 2e. mentioned_only[].surface_text가 quote 안에 없는 경우 실패 (2.3.6-1)
  const missingSurfaceInQuote = makeValidShard();
  missingSurfaceInQuote.scenes[0].participants.mentioned_only[0].quote = '아직 도착하지 않았습니다.';
  const res2e = validateShard(missingSurfaceInQuote, sampleBatchInput);
  assert.equal(res2e.valid, false);
  assert.ok(res2e.errors.some((e) => e.rule === 'MENTIONED_SURFACE_TEXT'));

  // 3. ??? 누락 실패 (특히 선택지 내부 들여쓰기된 ??? 줄 누락 실패)
  const missingIndentedUnknown = makeValidShard();
  missingIndentedUnknown.scenes[0].unknown_speakers = [
    missingIndentedUnknown.scenes[0].unknown_speakers[0],
  ];
  const res3 = validateShard(missingIndentedUnknown, sampleBatchInput);
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some((e) => e.rule === 'UNKNOWN_SPEAKER_COMPLETENESS'));

  // 3b. same_scene_speaker_groups에 1개 ID만 넣거나 동일 ID를 중복 그룹에 넣은 경우 실패 (4절)
  const invalidSingleGroup = makeValidShard();
  invalidSingleGroup.scenes[0].same_scene_speaker_groups = [
    { unknown_ids: ['unk_test_scene_1_L0003'], confidence: '가능성', reason: '단일 ID 그룹 오류' },
  ];
  const res3b = validateShard(invalidSingleGroup, sampleBatchInput);
  assert.equal(res3b.valid, false);
  assert.ok(res3b.errors.some((e) => e.rule === 'SCHEMA_VALIDATION'));

  // 4. 장면 누락 실패
  const missingScene = makeValidShard();
  missingScene.scenes.pop();
  const res4 = validateShard(missingScene, sampleBatchInput);
  assert.equal(res4.valid, false);
  assert.ok(res4.errors.some((e) => e.rule === 'SCENE_COMPLETENESS'));

  // 5. 호칭 화자 불일치 실패
  const wrongAddressSpeaker = makeValidShard();
  wrongAddressSpeaker.scenes[0].forms_of_address[0].from_speaker = '아니스';
  const res5 = validateShard(wrongAddressSpeaker, sampleBatchInput);
  assert.equal(res5.valid, false);
  assert.ok(res5.errors.some((e) => e.rule === 'FORMS_OF_ADDRESS'));

  // 6. 선택지 텍스트 불일치 실패
  const wrongOptionText = makeValidShard();
  wrongOptionText.scenes[0].choice_branches[0].options[0].option_text = '누구세요?';
  const res6 = validateShard(wrongOptionText, sampleBatchInput);
  assert.equal(res6.valid, false);
  assert.ok(res6.errors.some((e) => e.rule === 'CHOICE_BRANCHES'));

  // 7. 금지 필드(title_id, item_id 등)는 경고만 발생하고 병합기가 덮어씀 (2.3.8)
  const withForbiddenFields = makeValidShard();
  withForbiddenFields.scenes[0].title_id = 'model_hallucinated_title';
  withForbiddenFields.scenes[0].participants.present_in_scene[0].item_id = 'bad_id';
  const res7 = validateShard(withForbiddenFields, sampleBatchInput);
  assert.equal(res7.valid, true);
  assert.ok(res7.warnings.some((w) => w.rule === 'FORBIDDEN_MODEL_FIELD'));

  // 8. 2.3 4항: 인용문 쪽에서도 화자: 라벨을 떼고 비교하므로 라벨을 붙인 줄과 뗀 줄이 섞인 인용도 통과
  const mixedLabelQuoteShard = makeValidShard();
  mixedLabelQuoteShard.scenes[0].events_and_claims[1].quote =
    '라피: 조심하십시오.\n적이 가까이에 있습니다.';
  const res8a = validateShard(mixedLabelQuoteShard, sampleBatchInput);
  assert.equal(res8a.valid, true, JSON.stringify(res8a.errors));

  const mixedLabelQuoteShard2 = makeValidShard();
  mixedLabelQuoteShard2.scenes[0].events_and_claims[1].quote =
    '조심하십시오. 라피: 적이 가까이에 있습니다.';
  const res8b = validateShard(mixedLabelQuoteShard2, sampleBatchInput);
  assert.equal(res8b.valid, true, JSON.stringify(res8b.errors));

  // 9. 3절 2항: 같은 speaker_label이 present_in_scene과 remote_or_voice_only에 함께 있으면 실패
  const duplicateBranchSpeaker = makeValidShard();
  duplicateBranchSpeaker.scenes[0].participants.remote_or_voice_only.push({
    speaker_label: '라피',
    entity_id: 'char_라피',
    medium: 'messenger',
    line_start: 2,
    line_end: 2,
    quote: '지휘관님, 아니스는 아직 도착하지 않았습니다.',
  });
  const res9 = validateShard(duplicateBranchSpeaker, sampleBatchInput);
  assert.equal(res9.valid, false);
  assert.ok(res9.errors.some((e) => e.rule === 'PARTICIPANT_BRANCH_EXCLUSIVITY'));
});

test('5. merge-and-index merges validated shards, attaches manifest fields & item_ids, and updates progress atomically', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nikke-graph-test-'));
  try {
    const batchesDir = path.join(tmpDir, 'pass1', 'batches');
    const shardsDir = path.join(tmpDir, 'pass1', 'shards');
    await fs.mkdir(batchesDir, { recursive: true });
    await fs.mkdir(shardsDir, { recursive: true });

    const testManifest = {
      schema_version: '1.2.0',
      titles: [
        {
          title_id: 'main_story__chapter_00',
          category: 'main_story',
          title: '챕터 00',
          source_file: 'public/scripts/main_story/chapter_00.txt',
        },
      ],
      scenes: {
        s1: {
          scene_id: 's1',
          title_id: 'main_story__chapter_00',
          category: 'main_story',
          source_file: 'public/scripts/main_story/chapter_00.txt',
          source_sha256: 'abc123hash',
          route: {
            is_branch_point: false,
            next_routes: [],
            incoming_routes: [],
            parallel_scene_ids: [],
          },
        },
      },
    };

    const batchInput = {
      schema_version: '1.2.0',
      batch_id: 'batch_0001',
      scenes: [
        {
          scene_id: 's1',
          numbered_script: '[L0001] 라피: 지휘관님, 이 낡은 태엽 오르골을 보십시오.',
          mechanical_ground_truth: {
            speakers: [{ speaker_label: '라피', sources: ['dialogue'], dialogue_line_count: 1, first_line: 1 }],
            unknowns: [],
            choices: { choice_blocks: [], next_routes: [] },
            route: testManifest.scenes.s1.route,
            line_speaker: { 1: '라피' },
          },
        },
      ],
    };

    const validShard = {
      schema_version: '1.2.0',
      batch_id: 'batch_0001',
      scenes: [
        {
          scene_id: 's1',
          title_id: 'model_wrong_title_id',
          chronology_type: 'present',
          is_plot_critical: true,
          summary: '라피가 낡은 태엽 오르골을 보여준다.',
          participants: {
            present_in_scene: [{ speaker_label: '라피', entity_id: 'char_라피', is_generic_role: false }],
            present_silent: [],
            remote_or_voice_only: [],
            mentioned_only: [],
            document_author: null,
          },
          forms_of_address: [
            {
              from_speaker: '라피',
              to_target: '지휘관',
              address_term: '지휘관님',
              line_start: 1,
              line_end: 1,
              quote: '지휘관님, 이 낡은 태엽 오르골을 보십시오.',
            },
          ],
          unknown_speakers: [],
          same_scene_speaker_groups: [],
          cross_scene_hints: [],
          choice_branches: [],
          events_and_claims: [
            {
              epistemic_type: 'established_event',
              chronology_type: 'present',
              actor_or_speaker: '라피',
              summary: '라피가 지휘관에게 낡은 태엽 오르골을 보여 달라고 요청한다.',
              line_start: 1,
              line_end: 1,
              quote: '지휘관님, 이 낡은 태엽 오르골을 보십시오.',
              branch_specific: false,
              branch_option_text: null,
              refers_to_past: false,
            },
          ],
          clues_and_hooks: [
            {
              keyword: '낡은 태엽 오르골',
              category: 'item',
              detail: '라피가 발견한 단서 소품',
              line_start: 1,
              line_end: 1,
              quote: '이 낡은 태엽 오르골을 보십시오.',
            },
          ],
          relationship_and_lore_notes: [],
          unregistered_entity_candidates: [
            {
              surface_text: '태엽 오르골',
              suggested_type: 'item',
              line_start: 1,
            },
          ],
        },
      ],
    };

    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(testManifest, null, 2));
    await fs.writeFile(path.join(batchesDir, 'batch_0001.json'), JSON.stringify(batchInput, null, 2));
    await fs.writeFile(path.join(shardsDir, 'batch_0001.json'), JSON.stringify(validShard, null, 2));

    // CLI exit code 1 test on invalid shard file
    const invalidShardPath = path.join(tmpDir, 'invalid_shard.json');
    await fs.writeFile(
      invalidShardPath,
      JSON.stringify({ ...validShard, scenes: [] }, null, 2)
    );
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts/graph/validate-output.mjs'), invalidShardPath],
        { stdio: 'pipe' }
      );
    });

    const mergeResult = await mergeValidatedShards({ graphDir: tmpDir, pilot: false });
    assert.deepEqual(mergeResult.mergedBatchIds, ['batch_0001']);
    assert.equal(mergeResult.mergedScenesCount, 1);

    const indexDoc = JSON.parse(await fs.readFile(path.join(tmpDir, 'pass1_index.json'), 'utf8'));
    assert.ok(indexDoc.entities['char_라피']);
    assert.equal(indexDoc.entities['char_라피'].present_in_scene.length, 1);
    assert.ok(indexDoc.forms_of_address['지휘관님']);
    assert.ok(indexDoc.clues_by_keyword['낡은 태엽 오르골']);

    const titleViewDoc = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'pass1', 'by_title', 'main_story__chapter_00.json'), 'utf8')
    );
    assert.equal(titleViewDoc.scenes[0].title_id, 'main_story__chapter_00');
    assert.equal(titleViewDoc.scenes[0].source_sha256, 'abc123hash');
    assert.equal(titleViewDoc.scenes[0].mechanical_validated, true);
    assert.equal(titleViewDoc.scenes[0].participants.present_in_scene[0].item_id, 's1__pis_001');
    assert.equal(titleViewDoc.scenes[0].events_and_claims[0].confidence, null);
    assert.ok(Object.prototype.hasOwnProperty.call(titleViewDoc.scenes[0].events_and_claims[0], 'confidence'));

    const progressDoc = JSON.parse(await fs.readFile(path.join(tmpDir, 'progress.json'), 'utf8'));
    assert.equal(progressDoc.batches['batch_0001'].status, 'merged');

    const candidatesDoc = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'unregistered_entity_candidates.json'), 'utf8')
    );
    assert.equal(candidatesDoc.total_candidates, 1);
    assert.equal(candidatesDoc.candidates[0].surface_text, '태엽 오르골');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
