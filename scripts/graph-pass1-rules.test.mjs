import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  PASS1_RULES_PATH,
  PASS1_RULE_SECTIONS,
  SPEC_PATH,
  buildPass1Rules,
  splitSections,
} from './graph/build-pass1-rules.mjs';

test('Pass 1 규칙 파일이 현재 명세에서 만든 결과와 같다', async () => {
  const spec = await fs.readFile(SPEC_PATH, 'utf8');
  const committed = await fs.readFile(PASS1_RULES_PATH, 'utf8');
  assert.equal(
    committed,
    buildPass1Rules(spec),
    'GRAPH_RAG_PASS1_RULES.md가 명세와 다르다. node scripts/graph/build-pass1-rules.mjs로 다시 만든다'
  );
});

test('Pass 1 규칙 파일은 고른 절을 명세 그대로, 명세 순서대로 담는다', async () => {
  const spec = await fs.readFile(SPEC_PATH, 'utf8');
  const rules = buildPass1Rules(spec);
  const sections = splitSections(spec);
  let lastIndex = -1;
  for (const prefix of PASS1_RULE_SECTIONS) {
    const section = sections.find((s) => s.heading.startsWith(prefix));
    const index = rules.indexOf(section.text);
    assert.ok(index > lastIndex, `${prefix} 절이 없거나 순서가 다르다`);
    lastIndex = index;
  }
  // 감독관용 절은 넣지 않는다.
  assert.ok(!rules.includes('### 2.1 '));
  assert.ok(!rules.includes('## 8. '));
  assert.ok(!rules.includes('### Pass 1 본 실행 순서'));
});

test('코드 블록 안의 # 줄은 절 제목으로 보지 않는다', () => {
  const sections = splitSections('## A\n```\n# not a heading\n```\n## B\n');
  assert.deepEqual(
    sections.map((s) => s.heading),
    ['## A', '## B']
  );
});
