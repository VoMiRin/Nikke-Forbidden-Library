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
      { step_index: 0, type: 'SYSTEM_MESSAGE', content: '너는 GraphRAG Pass 1 보수 서브에이전트다. 독립 검토자가 짚은 장면만 고친다. job 3 맡은 배치: batch_0236, batch_0001' },
      response(1, 50, 500, 5),
      { step_index: 2, type: 'GENERIC', content: 'File Path: `file:///repo/scripts/graph/validate-output.mjs`\n...' },
      response(3, 60, 600, 6, [
        { name: 'run_command', args: { CommandLine: 'node scripts/graph/repair-pass1.mjs check batch_0236' } },
        { name: 'run_command', args: { CommandLine: 'sed -n 1,80p scripts/graph/validate-output.mjs' } },
      ]),
      { step_index: 4, type: 'GENERIC', content: 'File Path: `file:///repo/data/graph/pass1/repairs/batch_0236.input.json`\n...' },
    ]);

    const usage = collectRunUsage({ brainDir, supervisor: 'sup' });
    assert.equal(usage.from_step, 3);
    assert.deepEqual(usage.rows.map((r) => r.session), ['sup', SUB_NEW]);
    assert.deepEqual(usage.total, { responses: 4, input_tokens: 120, cache_read_tokens: 1200, output_tokens: 14 });

    const sub = usage.rows[1];
    assert.equal(sub.label, 'repair batch_0236+batch_0001 job3');
    assert.deepEqual(sub.script_reads, { 'graph/validate-output.mjs': 1 });
    assert.equal(sub.shell_script_reads, 1);
    assert.ok(sub.first_script_read_step < sub.first_validator_run_step);
    assert.match(formatUsageTable(usage), /graph\/validate-output\.mjs×1, 셸 1회 \(검증 실행 전\)/);

    // 실행 도중 사용자가 다른 질문을 해도, 그 실행을 시작한 요청 문구로 시작점을 고정한다
    await writeSession(brainDir, 'sup2', [
      { step_index: 0, type: 'USER_INPUT', content: 'GRAPH_RAG_PASS1_WAVES.md를 보고 수행해줘' },
      response(1, 7, 70, 1),
      created(2, SUB_NEW),
      { step_index: 3, type: 'USER_INPUT', content: '얼마나 진행됐어?' },
      response(4, 3, 30, 2),
    ]);
    assert.deepEqual(collectRunUsage({ brainDir, supervisor: 'sup2' }).rows.map((r) => r.session), ['sup2']);
    const pinned = collectRunUsage({ brainDir, supervisor: 'sup2', fromRequest: 'GRAPH_RAG_PASS1_WAVES.md' });
    assert.deepEqual(pinned.rows.map((r) => r.session), ['sup2', SUB_NEW]);
    assert.equal(pinned.from_step, 0);

    // 세션 안에서 복구된 오류와 10분 넘게 걸린 도구 스텝도 센다
    const SUB_ERR = '00000000-0000-0000-0000-000000000003';
    await writeSession(brainDir, 'sup3', [{ step_index: 0, type: 'USER_INPUT', content: '이번 요청' }, created(1, SUB_ERR)]);
    await writeSession(brainDir, SUB_ERR, [
      { step_index: 0, type: 'SYSTEM_MESSAGE', content: '추출 서브에이전트 batch_0025.part1.json' },
      { step_index: 1, type: 'ERROR_MESSAGE', content: 'Error: Your previous response was cut off because it exceeded the output token limit' },
      { step_index: 2, type: 'ERROR_MESSAGE', content: 'Error: The stream was interrupted. Please continue the task you were working on.' },
      { step_index: 3, type: 'GENERIC', status: 'INVALID', content: 'Error invalid tool call: unknown tool' },
      {
        step_index: 4,
        type: 'GENERIC',
        status: 'DONE',
        content: 'Created At: 2026-10-18T16:48:19+09:00\nCompleted At: 2026-10-18T17:33:12+09:00\nCreated file ...',
      },
      { step_index: 5, type: 'GENERIC', status: 'DONE', content: 'Created At: 2026-10-18T17:34:17+09:00\nCompleted At: 2026-10-18T17:34:31+09:00\n...' },
    ]);
    const withErrors = collectRunUsage({ brainDir, supervisor: 'sup3' });
    assert.deepEqual(withErrors.rows[1].errors, { cutoff: 1, interrupted: 1, tool: 1, other: 0 });
    assert.deepEqual(withErrors.rows[1].long_waits, [{ step: 4, minutes: 45 }]);
    const table = formatUsageTable(withErrors);
    assert.match(table, /출력 잘림 1, 스트림 끊김 1, 도구 실패 1 \| 스텝 4 45분 \|/);
    assert.match(table, /\*\*합계\*\* .*\| 출력 잘림 1, 스트림 끊김 1, 도구 실패 1 \| 1회 \|/);

    // 이전 요청 구간을 지정하면 그때 만든 서브에이전트를 센다
    const earlier = collectRunUsage({ brainDir, supervisor: 'sup', fromStep: -1, toStep: 2 });
    assert.deepEqual(earlier.rows.map((r) => r.session), ['sup', SUB_OLD]);

    // 한 번에 하나씩 만든 기록(단수형)도 세고, 명령 출력에 든 다른 회차 로그의 문구는 세지 않는다(13회차)
    await writeSession(brainDir, 'sup4', [
      { step_index: 0, type: 'USER_INPUT', content: '이번 요청' },
      {
        step_index: 1,
        type: 'GENERIC',
        content: `Created At: 2026-10-20T10:41:48+09:00\nCompleted At: 2026-10-20T10:45:50+09:00\nCreated the following subagent:\n{\n  "conversationId": "${SUB_NEW}"\n}`,
      },
      {
        step_index: 2,
        type: 'GENERIC',
        content: `Created At: 2026-10-20T13:18:51+09:00\nCompleted At: 2026-10-20T13:19:02+09:00\nCommand exited with code 0.\n\nCommand output:\n    'Created the following subagents:\\n' +\n    '  "conversationId": "${SUB_OLD}",\\n' +`,
      },
    ]);
    assert.deepEqual(collectRunUsage({ brainDir, supervisor: 'sup4' }).rows.map((r) => r.session), ['sup4', SUB_NEW]);
  } finally {
    await fs.rm(brainDir, { recursive: true, force: true });
  }
});
