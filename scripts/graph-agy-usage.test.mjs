import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectRunUsage, formatUsageTable } from './graph/agy-usage.mjs';

// 5절 사용량 집계: 감독관 로그의 이번 요청 구간과 그 구간에서 만든 서브에이전트만 센다.

const writeSession = async (brainDir, id, steps) => {
  const dir = path.join(brainDir, id, '.system_generated', 'logs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'transcript_full.jsonl'), steps.map((s) => JSON.stringify(s)).join('\n') + '\n');
};
const response = (step, input, cache, output, toolCalls = []) => ({
  step_index: step,
  type: 'PLANNER_RESPONSE',
  input_tokens: input,
  cache_read_tokens: cache,
  output_tokens: output,
  tool_calls: toolCalls,
});
const SUB_OLD = '00000000-0000-0000-0000-000000000001';
const SUB_NEW = '00000000-0000-0000-0000-000000000002';
const created = (step, id) => ({
  step_index: step,
  type: 'GENERIC',
  content: `Created the following subagents:\n{\n  "conversationId": "${id}"\n}`,
});

test('5 agy usage: only the latest request of the supervisor and the subagents it created', async () => {
  const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-usage-'));
  try {
    await writeSession(brainDir, 'sup', [
      { step_index: 0, type: 'USER_INPUT', content: '이전 요청' },
      response(1, 100, 1000, 10),
      created(2, SUB_OLD),
      { step_index: 3, type: 'USER_INPUT', content: '이번 요청' },
      response(4, 7, 70, 1),
      created(5, SUB_NEW),
      response(6, 3, 30, 2),
    ]);
    await writeSession(brainDir, SUB_OLD, [{ step_index: 0, type: 'SYSTEM_MESSAGE', content: '추출 서브에이전트' }, response(1, 999, 999, 999)]);
    await writeSession(brainDir, SUB_NEW, [
      { step_index: 0, type: 'SYSTEM_MESSAGE', content: '너는 GraphRAG Pass 1 보수 서브에이전트다. job 3 맡은 배치: batch_0236, batch_0001' },
      response(1, 50, 500, 5),
      { step_index: 2, type: 'GENERIC', content: 'File Path: `file:///repo/scripts/graph/validate-output.mjs`\n...' },
      response(3, 60, 600, 6, [{ name: 'run_command', args: { CommandLine: 'node scripts/graph/repair-pass1.mjs check batch_0236' } }]),
      { step_index: 4, type: 'GENERIC', content: 'File Path: `file:///repo/data/graph/pass1/repairs/batch_0236.input.json`\n...' },
    ]);

    const usage = collectRunUsage({ brainDir, supervisor: 'sup' });
    assert.equal(usage.from_step, 3);
    assert.deepEqual(usage.rows.map((r) => r.session), ['sup', SUB_NEW]);
    assert.deepEqual(usage.total, { responses: 4, input_tokens: 120, cache_read_tokens: 1200, output_tokens: 14 });

    const sub = usage.rows[1];
    assert.equal(sub.label, 'repair batch_0236+batch_0001 job3');
    assert.deepEqual(sub.script_reads, { 'graph/validate-output.mjs': 1 });
    assert.ok(sub.first_script_read_step < sub.first_validator_run_step);
    assert.match(formatUsageTable(usage), /graph\/validate-output\.mjs×1 \(검증 실행 전\)/);

    // 이전 요청 구간을 지정하면 그때 만든 서브에이전트를 센다
    const earlier = collectRunUsage({ brainDir, supervisor: 'sup', fromStep: -1, toStep: 2 });
    assert.deepEqual(earlier.rows.map((r) => r.session), ['sup', SUB_OLD]);
  } finally {
    await fs.rm(brainDir, { recursive: true, force: true });
  }
});
