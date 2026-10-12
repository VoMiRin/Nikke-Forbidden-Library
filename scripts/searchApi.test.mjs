import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { searchDocuments } from '../lib/search.mjs';

test('HTTP API and static fallback agree on snippets, speaker matches and filtered totals', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nikke-search-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const documents = Array.from({ length: 90 }, (_, index) => ({
    id: `scene-${index}`, title: '검색 단서', subTitle: '장면',
    categoryKey: index === 89 ? 'event_stories' : 'main_story', mainChapterFile: 'file.txt',
    searchableContent: '앞부분입니다. '.repeat(50) + '숨은 단서가 있습니다.',
    searchableSpeakers: '라피 아니스',
    searchableSpeakerContent: { 라피: '숨은 단서를 찾았습니다.', 아니스: '다른 대사입니다.' },
    snippet: '앞부분입니다.',
  }));
  const indexPath = path.join(dir, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(documents));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', SEARCH_INDEX_PATH: indexPath, ASK_LOG_STORAGE: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`API startup timeout: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`API exited ${code}: ${output}`)); });
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/listening on port (\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
  for (const options of [
    { contentQuery: '단서', categoryKey: 'event_stories', limit: 1 },
    { contentQuery: '단서', speakerQuery: '라피', limit: 2 },
    { contentQuery: '단서', speakerQuery: '아니스' },
    { speakerQuery: '라피', categoryKey: 'event_stories' },
    { contentQuery: '단서', categoryKey: 'unknown' },
  ]) {
    const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.contentQuery) params.set('q', options.contentQuery);
    if (options.speakerQuery) params.set('speaker', options.speakerQuery);
    if (options.categoryKey) params.set('category', options.categoryKey);
    const response = await fetch(`http://127.0.0.1:${port}/api/search?${params}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify({ ...searchDocuments(documents, { limit: 50, ...options }), source: 'api' })));
  }
  const unsupported = await fetch(`http://127.0.0.1:${port}/api/search?q=단서`, { method: 'POST' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, OPTIONS');
  const hostileHost = await fetch(`http://127.0.0.1:${port}/api/search?q=단서`, { headers: { host: '[malformed' } });
  assert.equal(hostileHost.status, 200);
});
