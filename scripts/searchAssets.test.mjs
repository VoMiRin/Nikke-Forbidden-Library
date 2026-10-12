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

test('system notices, prose times, ratios and document labels stay searchable without becoming speakers', () => {
  const lines = [
    '*[시스템 : 익스터미네이션을 사용합니다.]*',
    '[시스템 : 즉사의 마안에 비친 모든 적에게 기절을 부여합니다.]',
    '시스템: [인식 완료]', '나레이션: 폴리가 쓰러졌습니다.', '나래이션: 문이 열립니다.',
    '[제목: 기록]', '[크로우 : ON] [바이퍼 : ON]', '[주의 : 진입 금지]라고 적혀 있다.',
    '[RE] 제목 : 답장', '제목: 기록 문서', '장소 : 디저트 존.',
    '06:30 AM, 리페어 센터.', '오전 ??:00, 숙소.', '현재 시각 15:00.',
    '다음날 AM 11:00, 주차장.', '평일 / 09:00-20:00',
    '휴대폰에 뜬 숫자가 00:00으로 바뀌었다.', '1:1 사이즈로 만든 조각상.',
    '우리는 3:1로 팀을 나누었다.', '(화면: 점검 중)',
    'ARK GUARDIAN : To Be Continued···.', 'OPERATION ARK GUARDIAN : END',
  ];
  const extract = extractTextFromScriptContent(lines.join('\n'), { title: 'ARK GUARDIAN' });
  assert.deepEqual(extract.speakerDetails, {});
  assert.deepEqual(extract.speakerContent, {});
  assert.equal(extract.speakers, '');
  for (const text of ['익스터미네이션', '인식 완료', '폴리가 쓰러졌습니다', '디저트 존', '06:30', '기록 문서', '3:1']) {
    assert.ok(extract.displayContent.includes(text), text);
  }
  assert.deepEqual(buildSpeakerAssets([{ script: { id: 'notice', title: 'ARK GUARDIAN', categoryKey: 'event_stories' }, speakerDetails: extract.speakerDetails }]).speakers, []);
});

test('real bracketed handles, timestamped chat and dialogue mentioning times or ratios retain speakers', () => {
  const extract = extractTextFromScriptContent([
    '[블랙로즈] : 저도 처음엔 그랬어요',
    '[파피용] [오후 1:31] 지휘관의 목적을 알아냈어요 ;-)',
    '[파피용] [오전 4:34] 낙원에 진입 성공했어요 :D',
    '라피: 오후 03:00에 우리는 3:1로 팀을 나눕니다.',
    'N102: 안녕하세요.', '#000000: 열어요 빨리.', 'VII: 임무다.', '???: 누구지?',
    'MISSILIS Line. 0: 개망나니라고 얘기해.',
    '퀸(마코토): 괜찮아.', '의뢰 타겟: 도망쳐!',
    '라피: END',
  ].join('\n'), { title: 'ARK GUARDIAN' });
  assert.equal(extract.speakerDetails['[블랙로즈]'].dialogueCount, 1);
  assert.equal(extract.speakerDetails['파피용'].dialogueCount, 2);
  assert.equal(extract.speakerDetails['라피'].dialogueCount, 2);
  for (const key of ['n102', '#000000', 'vii', '???', 'missilis line. 0', '퀸(마코토)', '의뢰 타겟']) assert.ok(extract.speakerDetails[key], key);
  assert.match(extract.speakerContent['라피'], /3:1/);
});

test('messenger system senders need not carry IS_SYSTEM to be excluded from the catalog', () => {
  const extract = extractTextFromScriptContent([
    '[MESSENGER_START TITLE="채팅"]', '[MSG SENDER="시스템"]', '사용자가 입장했습니다.', '[MSG_END]',
    '[MSG SENDER="SYSTEM"]', '연결되었습니다.', '[MSG_END]',
    '[MSG SENDER="라피"]', '확인했습니다.', '[MSG_END]', '[MESSENGER_END]',
  ].join('\n'));
  assert.deepEqual(Object.keys(extract.speakerDetails), ['라피']);
  assert.equal(extract.speakers, '라피');
  assert.match(extract.displayContent, /사용자가 입장했습니다/);
});
