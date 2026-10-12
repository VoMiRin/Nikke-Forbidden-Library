import assert from 'node:assert/strict';
import test from 'node:test';
import { searchDocuments, makeSnippet, displaySearchText, findMatchRange } from '../lib/search.mjs';

const document = (overrides = {}) => ({
  id: 'scene', title: '첫 번째 이야기', subTitle: '도서관', categoryKey: 'main_story', mainChapterFile: 'chapter.txt',
  searchableContent: '평범한 문장입니다.', searchableSpeakers: '라피 아니스',
  searchableSpeakerContent: { 라피: '평범한 문장입니다.', 아니스: '아직 할 말이 없어요.' },
  snippet: '기존 미리보기', ...overrides,
});

test('snippets include a late body match and preserve display casing', () => {
  const content = '앞부분입니다. '.repeat(80) + '중요한 CODE Name 단서입니다. 뒤의 설명입니다.';
  const result = searchDocuments([document({ searchableContent: content })], { contentQuery: 'ＣＯＤＥ   name' });
  assert.equal(result.totalResults, 1);
  assert.equal(result.results[0].matchType, 'content');
  assert.match(result.results[0].snippet, /CODE Name/);
  assert.ok(result.results[0].snippet.length <= 222);
  assert.ok(result.results[0].snippet.startsWith('…'));
});

test('combined searches show only the matching speaker dialogue', () => {
  const result = searchDocuments([document({
    searchableContent: '아니스가 먼저 단서를 찾았다. 라피도 숨은 단서를 찾았다.',
    searchableSpeakerContent: { 아니스: '아니스가 먼저 단서를 찾았다.', 라피: '라피도 숨은 단서를 찾았다.' },
  })], { contentQuery: '단서', speakerQuery: '라' });
  assert.equal(result.results[0].matchedSpeaker, '라피');
  assert.match(result.results[0].snippet, /라피도/);
  assert.doesNotMatch(result.results[0].snippet, /아니스/);
  assert.equal(searchDocuments([document()], { contentQuery: '아직', speakerQuery: '라피' }).totalResults, 0);
});

test('combined queries cannot match across two different speakers', () => {
  assert.equal(searchDocuments([document({
    searchableSpeakers: '라피 라피의 목소리',
    searchableSpeakerContent: { 라피: '숨은', '라피의 목소리': '단서' },
  })], { contentQuery: '숨은 단서', speakerQuery: '라피' }).totalResults, 0);
});

test('category is applied before limit and total counting', () => {
  const documents = Array.from({ length: 90 }, (_, i) => document({ id: `main-${i}`, title: '단서' }));
  documents.push(document({ id: 'event', title: '단서', categoryKey: 'event_stories' }));
  const result = searchDocuments(documents, { contentQuery: '단서', categoryKey: 'event_stories', limit: 1 });
  assert.deepEqual(result.results.map(result => result.id), ['event']);
  assert.equal(result.totalResults, 1);
  assert.equal(result.categoryKey, 'event_stories');
  assert.equal(searchDocuments(documents, { contentQuery: '단서', categoryKey: 'unknown' }).totalResults, 0);
});

test('title-only and subtitle-only hits keep previews and explicit match types', () => {
  const result = searchDocuments([
    document({ id: 'title', title: '숨은 단서' }),
    document({ id: 'subtitle', subTitle: '숨은 단서' }),
  ], { contentQuery: '단서' });
  assert.deepEqual(result.results.map(result => result.matchType), ['title', 'subtitle']);
  assert.ok(result.results.every(result => result.snippet === '기존 미리보기'));
});

test('speaker-only search uses individual names and shows their dialogue', () => {
  const result = searchDocuments([document()], { speakerQuery: '라피' });
  assert.equal(result.results[0].matchType, 'speaker');
  assert.equal(result.results[0].snippet, '평범한 문장입니다.');
  assert.equal(searchDocuments([document()], { speakerQuery: '라피 아니스' }).totalResults, 0);
});

test('empty search, finite limits, literal symbols and Unicode are handled', () => {
  assert.equal(searchDocuments([document()]).totalResults, 0);
  assert.equal(searchDocuments([document()], { speakerQuery: '라피', limit: Infinity }).limit, 80);
  assert.equal(searchDocuments([document()], { speakerQuery: '라피', limit: 1.8 }).limit, 1);
  assert.equal(makeSnippet('앞 [a+b] 뒤', '[a+b]'), '앞 [a+b] 뒤');
  assert.deepEqual(findMatchRange(displaySearchText('İ   CODE'), 'code'), { start: 2, end: 6 });
  assert.equal(makeSnippet('앞말 ' + '가'.repeat(250) + ' 뒷말', '가'.repeat(250)).includes('가'.repeat(250)), true);
});
