import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkGateFiles } from './graph/gate-tools.mjs';

const manifest = { scenes: { s1: { title_id: 't', source_file: 'x.txt' } } };
const readScene = (id) => (id === 's1' ? ['릴리바이스: 지휘관!', '지휘관: 나는!', '릴리바이스: 엔더슨!!'] : null);
const write = (dir, name, rows) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
};

test('측정 게이트 질문·정답 파일 형식 검사', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  try {
    const q = write(dir, 'q.jsonl', [
      { question_id: 'G001', type: 'past_title_speaker', question: '지휘관 라벨의 정체는?' },
      { question_id: 'G002', type: 'nope', question: '엔더슨은 누구?', hint: '스포' },
    ]);
    const a = write(dir, 'a.jsonl', [
      { question_id: 'G001', answer: '엔더슨', evidence: [{ scene_id: 's1', line_start: 2, line_end: 3, quote: '릴리바이스:  엔더슨!!', required: true }] },
      { question_id: 'G002', answer: '엔더슨', evidence: [{ scene_id: 's1', line_start: 1, line_end: 9, quote: 'x', required: true }] },
    ]);
    const r = checkGateFiles({ questionsPath: q, answersPath: a, manifest, readScene });
    assert.equal(r.errors.some((e) => e.includes('type이 목록에 없다')), true);
    assert.equal(r.errors.some((e) => e.includes('hint')), true);
    assert.equal(r.errors.some((e) => e.includes('줄 범위가 틀렸다')), true);
    assert.equal(r.errors.some((e) => e.includes('G001')), false);
    assert.equal(r.warnings.some((w) => w.includes('G002')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { termPositions, runQuestion } from './graph/gate-run.mjs';
import { scoreRun } from './graph/gate-score.mjs';

test('측정 게이트 검색: 이름 경계, 긴 키 우선, 희소도 점수, 채점', () => {
  assert.deepEqual(termPositions('엑시아는 누구', '엑시아'), [0]);
  assert.deepEqual(termPositions('보나 마나', '마나'), [3]); // 경계는 맞으므로 잡힌다(조사 판정은 뒤쪽만)
  assert.deepEqual(termPositions('레비아탄을', '레비'), []);
  const postings = new Map([
    ['레드 후드', { scenes: new Set(['a', 'b']), sources: new Set(['entity']) }],
    ['레드', { scenes: new Set(['c']), sources: new Set(['clue']) }],
    ['방주', { scenes: new Set(['a', 'b', 'c', 'd']), sources: new Set(['clue']) }],
  ]);
  const manifest = { scenes: { a: { title_id: 't' }, b: { title_id: 't' }, c: { title_id: 't' }, d: { title_id: 't' } } };
  const sceneOrder = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
  const r = runQuestion('레드 후드가 방주에 온 장면은?', { postings, titleMatchers: [], manifest, sceneOrder, N: 4 });
  assert.deepEqual(r.terms.map((t) => t.term), ['레드 후드', '방주']);
  assert.equal(r.top[0].scene_id, 'a');
  assert.equal(r.candidate_count, 4);
  const s = scoreRun({ results: [{ question_id: 'G001', type: 'x', candidate_count: 4, top: r.top }] },
    [{ question_id: 'G001', evidence: [{ scene_id: 'b', required: true }, { scene_id: 'z', required: true }, { scene_id: 'c', required: false }] }]);
  assert.equal(s.rows[0]['hit@10'], 1);
  assert.equal(s.rows[0]['all@10'], false);
  assert.equal(s.overall['scene_recall@10'], 0.5);
});

import { matchTitles } from './graph/gate-run.mjs';

test('측정 게이트 검색: 장 번호는 "13챕터", "13장", "챕터 13", "Chapter.13" 모두 찾는다', () => {
  const tm = [13, 20].map((n) => ({ title_id: `main_story__chapter_${n}`, forms: [], chapter: n }));
  assert.deepEqual(matchTitles('메인 스토리 13챕터와 20장에서', tm).sort(), ['main_story__chapter_13', 'main_story__chapter_20']);
  assert.deepEqual(matchTitles('챕터 13, Chapter.20', tm).sort(), ['main_story__chapter_13', 'main_story__chapter_20']);
  assert.deepEqual(matchTitles('13장면', tm), []);
});

test('보충 질문 형식 검사(--no-title): 질문에 이야기 제목·장 번호가 있으면 오류', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  try {
    const m = { scenes: manifest.scenes, titles: [
      { title_id: 'event_stories__ark_guardian', category: 'event_stories', title: 'ARK GUARDIAN' },
      { title_id: 'main_story__chapter_13', category: 'main_story', title: 'Chapter.13: 수혈' },
    ] };
    const q = write(dir, 'q.jsonl', [
      { question_id: 'G101', type: 'other', question: 'ARK GUARDIAN에서 누가?' },
      { question_id: 'G102', type: 'other', question: '13챕터에서 누가?' },
      { question_id: 'G103', type: 'other', question: '갓데스 스쿼드의 지휘관이 말하는 장면은?' },
    ]);
    const r = checkGateFiles({ questionsPath: q, manifest: m, readScene, noTitle: true });
    assert.equal(r.errors.filter((e) => e.includes('--no-title')).length, 2);
    assert.equal(r.errors.some((e) => e.includes('G103')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { buildTermPostings } from './graph/gate-run.mjs';

test('측정 게이트 검색 v1.2: 별칭은 그 표기가 나온 장면만, 연결된 항목도 장면별 표기로 찾는다', () => {
  const bucket = (entries) => ({ present_in_scene: entries, present_silent: [], remote_or_voice_only: [], mentioned_only: [] });
  const index = {
    entities: {
      char_엑시아: bucket([
        { scene_id: 'a', speaker_label: '엑시아' },
        { scene_id: 'b', speaker_label: '[사이코뮤]' },
        { scene_id: 'c', speaker_label: '엑시아' },
      ]),
      char_엔더슨: bucket([{ scene_id: 'd', speaker_label: '지휘관' }, { scene_id: 'e', speaker_label: '엔더슨' }]),
      char_지휘관: bucket([{ scene_id: 'f', speaker_label: '지휘관' }]),
    },
    relationships_by_entity: {},
    forms_of_address: {},
    clues_by_keyword: {},
    descriptor_speakers: [],
    unknown_speakers: [],
  };
  const registry = {
    entities: [
      { entity_id: 'char_엑시아', canonical_name: '엑시아', surface_labels: ['엑시아', '[사이코뮤]'], alias_kinds: { '[사이코뮤]': 'handle' } },
      { entity_id: 'char_엔더슨', canonical_name: '엔더슨', surface_labels: ['엔더슨'] },
      { entity_id: 'char_지휘관', canonical_name: '지휘관', surface_labels: ['지휘관'] },
    ],
  };
  const p = buildTermPostings(index, registry);
  assert.deepEqual([...p.get('[사이코뮤]').scenes].sort(), ['b']); // 별칭: 표기가 나온 장면만
  assert.deepEqual([...p.get('엑시아').scenes].sort(), ['a', 'b', 'c']); // 본이름: 인물 전체
  assert.deepEqual([...p.get('지휘관').scenes].sort(), ['d', 'f']); // 엔더슨에 연결된 "지휘관" 장면도 표기로 잡힌다
  assert.deepEqual([...p.get('엔더슨').scenes].sort(), ['d', 'e']);
});
