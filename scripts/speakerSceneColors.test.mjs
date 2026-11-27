import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDialogueKey, parseDialogueLines, resolveSceneColors } from './speakerSceneColors.mjs';

const BASE = '#5176AD';
const QUEEN = '#342443';
const SAD = '#334B52';

// 원본: 장면 g1에서 marian(기본)과 marian_queen(퀸)이 말하고, 짧은 문장은 다른 장면 g2의 marian_sad에도 있다.
const makeSource = (rows) => {
  const byKey = new Map();
  for (const [speakerId, group, text] of rows) {
    const key = normalizeDialogueKey(text);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ speakerId, group });
  }
  const names = { marian: '마리안', marian_queen: '마리안', marian_sad: '마리안', rapi: '라피', rapi_h: '라피' };
  const colors = { marian: BASE, marian_queen: QUEEN, marian_sad: SAD, rapi: '#C82200', rapi_h: null };
  return {
    candidatesFor: key => byKey.get(key) ?? [],
    nameOf: id => names[id],
    colorOf: id => colors[id],
    defaultColorOf: name => ({ 마리안: BASE, 라피: '#C82200' })[name],
  };
};

test('parses dialogue lines the same way as the script parser', () => {
  assert.deepEqual(parseDialogueLines('[SCENE START]\n마리안: 안녕… \n  라피 : 응.\n[MSG SENDER="라피"]\nNARRATION 없음'), [
    { speaker: '마리안', text: '안녕…' },
    { speaker: '라피', text: '응.' },
  ]);
});

test('normalizes punctuation, tags and the commander placeholder', () => {
  assert.equal(normalizeDialogueKey('{AccountData.NickName}…! <color=#FF0000>좋아</color>'), normalizeDialogueKey('지휘관···! 좋아'));
});

test('uses the scene majority as the scene colour and lists the other lines', () => {
  const source = makeSource([
    ['marian_queen', 'g1', '여기는 어디지?'],
    ['marian_queen', 'g1', '지휘관.'],
    ['marian_queen', 'g1', '돌아가야 해.'],
    ['marian', 'g1', '꿈이었구나.'],
    ['marian_sad', 'g2', '지휘관.'],
  ]);
  const { result, stats } = resolveSceneColors(parseDialogueLines([
    '마리안: 여기는 어디지?',
    '마리안: 지휘관.',
    '마리안: 돌아가야 해.',
    '마리안: 꿈이었구나.',
  ].join('\n')), source);
  assert.deepEqual(result, { names: { 마리안: QUEEN }, lines: { 마리안: { '꿈이었구나.': BASE } } });
  assert.equal(stats.resolved, 4);
});

test('omits colours equal to the name default and ignores white or unknown speakers', () => {
  const source = makeSource([
    ['marian', 'g1', '좋은 아침.'],
    ['rapi_h', 'g1', '···.'],
  ]);
  const { result } = resolveSceneColors(parseDialogueLines('마리안: 좋은 아침.\n라피: ···.\n아니스: 안 맞는 줄.'), source);
  assert.equal(result, null);
});

test('leaves a line to the default when the same sentence has different colours in one scene', () => {
  const source = makeSource([
    ['marian_queen', 'g1', '아.'],
    ['marian', 'g1', '아.'],
    ['marian_queen', 'g1', '가자.'],
  ]);
  const { result, stats } = resolveSceneColors(parseDialogueLines('마리안: 아.\n마리안: 가자.'), source);
  assert.equal(stats.ambiguous, 1);
  assert.deepEqual(result, { names: { 마리안: QUEEN } });
});
