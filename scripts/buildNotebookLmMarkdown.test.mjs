import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseRawScriptRecords,
  selectUnincludedRawRecords,
} from './buildNotebookLmMarkdown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('parseRawScriptRecords preserves IDs, subtitles, and content', () => {
  const records = parseRawScriptRecords([
    'ignored preamble',
    '@@@SCRIPT_ID: sample_00',
    '@@@SUB_TITLE: 첫 장면',
    '라피: 첫 대사',
    '@@@SCRIPT_ID: sample_01',
    '아니스: 두 번째 대사',
  ].join('\r\n'), 'event_stories/sample.txt');

  assert.deepEqual(records, [
    {
      id: 'sample_00',
      subTitle: '첫 장면',
      content: '라피: 첫 대사',
      relativePath: 'event_stories/sample.txt',
    },
    {
      id: 'sample_01',
      subTitle: '',
      content: '아니스: 두 번째 대사',
      relativePath: 'event_stories/sample.txt',
    },
  ]);
});

test('parseRawScriptRecords retains a non-empty file without SCRIPT_ID', () => {
  const records = parseRawScriptRecords('독립된 원문 자료', 'lost_relics/standalone.txt');

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'raw_file_lost_relics_standalone_txt');
  assert.equal(records[0].content, '독립된 원문 자료');
});

test('selectUnincludedRawRecords recovers a new block from a partially registered file', () => {
  const rawRecords = [
    { id: 'sample_00', content: '등록됨' },
    { id: 'sample_01', content: '새 블록' },
  ];
  const includedScriptKeys = new Set(['event_stories:sample_00']);

  assert.deepEqual(
    selectUnincludedRawRecords(rawRecords, 'event_stories', includedScriptKeys),
    [{ id: 'sample_01', content: '새 블록' }],
  );
});

test('unregistered source files are parsed into all 29 script records', async () => {
  const sourcePaths = [
    ['event_stories/chocolate_please.txt', 6],
    ['event_lost_relics/outer_automata_lost.txt', 23],
  ];
  const allIds = new Set();

  for (const [relativePath, expectedCount] of sourcePaths) {
    const content = await fs.readFile(path.join(rootDir, 'public', 'scripts', relativePath), 'utf8');
    const records = parseRawScriptRecords(content, relativePath);
    assert.equal(records.length, expectedCount);
    for (const record of records) {
      assert.equal(allIds.has(record.id), false, `duplicate raw script ID: ${record.id}`);
      allIds.add(record.id);
    }
  }

  assert.equal(allIds.size, 29);
});
