import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await fs.readFile(new URL('../lib/navigation.ts', import.meta.url), 'utf8');
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
outputText = outputText.replace("'./pageRoutes.mjs'", JSON.stringify(new URL('../lib/pageRoutes.mjs', import.meta.url).href));
const { parseHistoryStateFromLocation, buildHistoryUrl } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('search categories, speaker pages and source chapter links survive URL round trips', () => {
  for (const query of [
    '?view=search&q=단서&speaker=라피&category=event_stories',
    '?view=search&category=main_story',
    '?view=speakers&speakerId=abc123',
    '?view=stories&category=main_story&title=기록%20%26%20질문%3F',
    '?view=script&category=main_story&script=id&focus=라피&focusMode=speaker',
    '?q=라피&mode=speaker',
  ]) {
    const state = parseHistoryStateFromLocation(query);
    const url = new URL(buildHistoryUrl(state), 'https://example.test');
    const restored = parseHistoryStateFromLocation(url.search, url.pathname);
    assert.deepEqual(restored, state);
  }
});

test('static scene routes, legacy links, focus and subsequent home navigation agree', () => {
  const legacy = parseHistoryStateFromLocation('?view=script&category=event_stories&script=queen%27s_order_00&focus=단서');
  const canonical = new URL(buildHistoryUrl(legacy), 'https://example.test');
  assert.equal(canonical.pathname, "/stories/event_stories/queen's_order_00/");
  assert.deepEqual(parseHistoryStateFromLocation(canonical.search, canonical.pathname), legacy);
  assert.equal(buildHistoryUrl(parseHistoryStateFromLocation('')), '/');
  assert.equal(parseHistoryStateFromLocation('?view=search', '/stories/main_story/main_00_00/').view, 'script_viewer');
  assert.equal(parseHistoryStateFromLocation('', '/stories/main_story/').categoryKey, 'main_story');
});

test('search category is distinct from the story browsing category', () => {
  const state = parseHistoryStateFromLocation('?view=search&q=단서&category=main_story');
  assert.equal(state.categoryKey, null);
  assert.equal(state.searchCategoryKey, 'main_story');
  assert.equal(parseHistoryStateFromLocation('?view=stories&category=main_story').searchCategoryKey, null);
});
