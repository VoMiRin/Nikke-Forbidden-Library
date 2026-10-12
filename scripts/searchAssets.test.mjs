import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { buildSpeakerAssets } from './speakerAssets.mjs';

const source = await fs.readFile(new URL('../utils.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { extractTextFromScriptContent } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('speaker assets count dialogue lines, not mentions, actions or system messages', () => {
  const extract = extractTextFromScriptContent([
    'NARRATION: 아니스의 이름만 언급된다.',
    '라피: 첫 대사.',
    '라피[ACTION]: 조용히 고개를 끄덕인다.',
    '[MESSENGER_START TITLE="대화"]',
    '[MSG SENDER="라피"]',
    '메시지 첫 줄.',
    '메시지 둘째 줄.',
    '[MSG_END]',
    '[MSG SENDER="SYSTEM" IS_SYSTEM="true"]',
    '입장했습니다.',
    '[MSG_END]',
    '[MESSENGER_END]',
  ].join('\n'));
  assert.equal(extract.speakerDetails['라피'].dialogueCount, 3);
  assert.equal(extract.speakerDetails['아니스'], undefined);
  assert.equal(extract.speakerDetails['system'], undefined);
  const { speakers, speakerIndex } = buildSpeakerAssets([
    { script: { id: 'one', title: '이야기', categoryKey: 'main_story' }, speakerDetails: extract.speakerDetails },
    { script: { id: 'two', title: '이야기', categoryKey: 'main_story' }, speakerDetails: extract.speakerDetails },
  ]);
  assert.equal(speakers.length, 1);
  assert.equal(speakers[0].sceneCount, 2);
  assert.equal(speakers[0].titleCount, 1);
  assert.equal(speakers[0].dialogueCount, 6);
  assert.equal(speakerIndex[speakers[0].id].scenes.length, 2);
});

test('display text preserves casing while search extraction remains normalized', () => {
  const extract = extractTextFromScriptContent('Rapi: Secret CODE');
  assert.equal(extract.content, 'secret code');
  assert.equal(extract.displayContent, 'Secret CODE');
  assert.equal(extract.speakerDetails.rapi.name, 'Rapi');
  assert.deepEqual(extract.speakerDetails.rapi.lines, ['Secret CODE']);
});

test('nested messenger branches do not count control tags and restore the parent speaker', () => {
  const extract = extractTextFromScriptContent([
    '[MESSENGER_START TITLE="대화"]', '[MSG SENDER="지휘관"]', '[CHOICE_START]',
    '[OPTION TEXT="선택 문구"]', '[MSG SENDER="라피"]', '분기 대사', '[MSG_END]',
    '[OPTION_END]', '[CHOICE_END]', '지휘관의 다음 대사', '[MSG_END]', '[MESSENGER_END]',
  ].join('\n'));
  assert.equal(extract.speakerDetails['라피'].dialogueCount, 1);
  assert.equal(extract.speakerDetails['지휘관'].dialogueCount, 1);
  assert.deepEqual(extract.speakerDetails['지휘관'].lines, ['지휘관의 다음 대사']);
  assert.doesNotMatch(extract.displayContent, /CHOICE|OPTION|MSG/);
});

test('speaker aliases stay separate and document-style colons do not create speakers', () => {
  const extract = extractTextFromScriptContent('라피: 대사\n라피의 목소리: 다른 표기');
  assert.equal(buildSpeakerAssets([{ script: { id: 'one', title: '이야기', categoryKey: 'main_story' }, speakerDetails: extract.speakerDetails }]).speakers.length, 2);
  assert.deepEqual(extractTextFromScriptContent('보고서: 오늘의 기록', { categoryKey: 'lost_relics' }).speakerDetails, {});
});
