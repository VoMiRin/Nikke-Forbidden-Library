import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceLookup, summarizeGrounding, createGroundingResolver } from '../server/groundingSources.mjs';
import { sourceTargetUrl } from '../lib/sourceLinks.mjs';
import { buildRecoveredAskResponse, fromFirestoreFields } from '../server/askRecovery.mjs';

const sourceName = 'public__scripts__main_story__chapter.txt';
const scripts = [
  { id: 'one', categoryKey: 'main_story', title: '첫 기록 & 질문?', mainChapterFile: 'chapter.txt' },
  { id: 'two', categoryKey: 'main_story', title: '첫 기록 & 질문?', mainChapterFile: 'chapter.txt' },
];
const grounding = title => ({ groundingChunks: [{ retrievedContext: { title, fileSearchStore: 'test' } }] });

test('only an exact known source filename links to a chapter, not a guessed scene', () => {
  const lookup = buildSourceLookup(scripts);
  const response = summarizeGrounding(grounding(sourceName), lookup);
  assert.deepEqual(response.sources[0].target, { kind: 'chapter', categoryKey: 'main_story', title: scripts[0].title });
  const url = new URL(sourceTargetUrl(response.sources[0].target), 'https://example.test');
  assert.equal(url.searchParams.get('title'), scripts[0].title);
  assert.equal(url.searchParams.get('view'), 'stories');
  assert.equal(url.searchParams.has('script'), false);
  for (const unknown of ['chapter.txt', 'data__new_scripts__main_story.ts', 'https://evil.test', sourceName + 'extra']) {
    assert.equal(summarizeGrounding(grounding(unknown), lookup).sources[0].target, undefined);
  }
});

const quotation = '라피: 이 장면에서만 등장하는 충분히 긴 인용문으로 원문 위치를 정확하게 확인합니다.';
const secondQuotation = '아니스: 다른 장면에서 발견된 충분히 긴 대사입니다. 인용된 장면을 별도로 확인합니다.';
const chapter = `@@@SCRIPT_ID: one\n@@@SUB_TITLE: 시작\n${quotation}\n@@@SCRIPT_ID: two\n${secondQuotation}`;
const retrieved = (...texts) => ({ groundingChunks: texts.map(text => ({ retrievedContext: { title: sourceName, text } })) });

test('verified source text links to the unique scene and survives answer recovery', async () => {
  let reads = 0;
  const resolve = createGroundingResolver(scripts, async () => { reads++; return chapter; });
  const result = await resolve(retrieved(quotation.replaceAll(' ', '\n'), quotation, secondQuotation));
  assert.equal(reads, 1);
  assert.deepEqual(result.sources.map(source => source.target.scriptId), ['one', 'two']);
  assert.equal(sourceTargetUrl(result.sources[0].target), '/stories/main_story/one/');
  const recovered = buildRecoveredAskResponse('id', { answer: '답변', sources: result.sources });
  assert.deepEqual(recovered.sources, result.sources);
  assert.equal((await resolve(retrieved(`@@@SCRIPT_ID: one\n@@@SUB_TITLE: 시작\n${quotation}`))).sources[0].target.scriptId, 'one');
});

test('ambiguous, short, mismatched, crossing or missing quotations keep the title fallback', async () => {
  const resolve = createGroundingResolver(scripts, async () => chapter);
  for (const text of ['알겠습니다.', '@@@SCRIPT_ID: one', `@@@SCRIPT_ID: two\n${quotation}`, `${quotation}\n@@@SCRIPT_ID: two\n${secondQuotation}`, '실제로 원문에 없는 긴 문장이지만 모델이 인용이라고 반환하는 경우 장면 링크를 만들면 안 됩니다.']) {
    assert.equal((await resolve(retrieved(text))).sources[0].target.kind, 'chapter');
  }
  const ambiguous = createGroundingResolver(scripts, async () => chapter + '\n' + quotation);
  assert.equal((await ambiguous(retrieved(quotation))).sources[0].target.kind, 'chapter');
  const missing = createGroundingResolver(scripts, async () => { throw new Error('unavailable'); });
  assert.equal((await missing(retrieved(quotation))).sources[0].target.kind, 'chapter');
  const unknown = retrieved(quotation);
  unknown.groundingChunks[0].retrievedContext.title = '../../unknown';
  assert.equal((await resolve(unknown)).sources[0].target, undefined);
});

test('different scene chunks from the same document remain separate sources', async () => {
  const resolve = createGroundingResolver(scripts, async () => chapter);
  const result = await resolve(retrieved(quotation, secondQuotation, '단문'));
  assert.deepEqual(result.sources.map(source => source.target.kind), ['scene', 'scene', 'chapter']);
  assert.equal(sourceTargetUrl({ kind: 'scene', categoryKey: 'main_story', title: '제목', scriptId: '../escape' }), null);
});

test('multiple titles in one file link to its category, and repeated chunks deduplicate', () => {
  const lookup = buildSourceLookup([...scripts, { ...scripts[0], id: 'three', title: '다른 타이틀' }]);
  const metadata = grounding(sourceName);
  metadata.groundingChunks.push(...metadata.groundingChunks);
  const response = summarizeGrounding(metadata, lookup);
  assert.equal(response.sources.length, 1);
  assert.equal(response.groundingChunkCount, 2);
  assert.deepEqual(response.sources[0].target, { kind: 'category', categoryKey: 'main_story' });
});

test('Firestore recovery retains structured source links and discards invalid targets', () => {
  const logEntry = fromFirestoreFields({
    answer: { stringValue: '답변' }, model: { stringValue: 'model' },
    sources: { arrayValue: { values: [{ mapValue: { fields: {
      title: { stringValue: sourceName },
      target: { mapValue: { fields: { kind: { stringValue: 'chapter' }, categoryKey: { stringValue: 'main_story' }, title: { stringValue: scripts[0].title } } } },
    } } }] } },
  });
  const response = buildRecoveredAskResponse('id', logEntry);
  assert.equal(response.sources[0].target.title, scripts[0].title);
  logEntry.sources[0].target = { kind: 'category', categoryKey: '//evil.test' };
  assert.equal(buildRecoveredAskResponse('id', logEntry).sources[0].target, undefined);
  assert.equal(sourceTargetUrl({ kind: 'url', href: 'javascript:alert(1)' }), null);
});
