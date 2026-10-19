import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { markRerun, validateCommandOf } from './graph/batch-parts.mjs';
import { parseMergeArgs } from './graph/merge-and-index.mjs';
import { parseValidateArgs } from './graph/validate-output.mjs';
import {
  buildRerunMarker,
  buildValidationRecord,
  formatWaveCallSummary,
  readValidationLog,
  recordValidation,
  summarizeRun,
  summarizeWaveCalls,
} from './graph/validation-log.mjs';

// 5절 Pass 1 본 실행 회차의 검증 기록: 재검증은 직전 추출자 결과로 나누고, 기록이 없으면 0회가 아니라 "기록 없음"이다.

const WAVE = { wave: 'wave_0001-0002', created_at: '2026-10-19T00:00:00.000Z', batch_ids: ['batch_0001', 'batch_0002'] };

const res = (errors = [], warnings = []) => ({
  valid: errors.length === 0,
  errors: errors.map((rule) => ({ rule })),
  warnings: warnings.map((rule) => ({ rule })),
});

const rec = (fields, outcome = res()) =>
  buildValidationRecord({
    actor: 'extractor',
    batchId: 'batch_0001',
    part: 1,
    run: 1,
    wavePlan: WAVE,
    res: outcome,
    outputPath: '/nonexistent/out.json',
    inputPath: '/nonexistent/in.json',
    validator: 'v',
    ...fields,
  });

test('validation log: re-validations are classified by the previous extractor result', () => {
  const runs = [rec({}, res(['COVERAGE_GAP'])), rec({}, res(['QUOTE_LOCATION'])), rec({}, res([], ['WIDE_RANGE'])), rec({})];
  assert.deepEqual(
    (({ validations, after_fail, after_warn, extra_check }) => ({ validations, after_fail, after_warn, extra_check }))(summarizeRun(runs)),
    { validations: 4, after_fail: 2, after_warn: 1, extra_check: 0 }
  );
  assert.equal(summarizeRun(runs).first.errors.COVERAGE_GAP, 1);
  assert.equal(summarizeRun(runs).last.result, 'pass');

  assert.equal(summarizeRun([rec({}), rec({})]).extra_check, 1);

  const unreadable = rec({ res: null, fatal: 'Unexpected token } in JSON' });
  assert.equal(unreadable.result, 'unreadable');
  assert.equal(summarizeRun([unreadable, rec({})]).after_fail, 1);
});

test('validation log: wave summary keeps runs apart and never turns a missing record into a pass', () => {
  const plan = {
    ...WAVE,
    calls: [
      { call: 1, batch_id: 'batch_0001', part: 1, status: 'new' },
      { call: 2, batch_id: 'batch_0001', part: 2, status: 'new' },
      { call: 3, batch_id: 'batch_0002', part: null, status: 'done' },
    ],
  };
  const records = [
    rec({ run: 1 }, res(['COVERAGE_GAP'])),
    rec({ actor: 'finish' }, res(['COVERAGE_GAP'])),
    rec({ run: 2 }, res([], ['WIDE_RANGE'])),
    rec({ run: 2 }),
    // 같은 이름의 회차를 다시 계획한 뒤의 기록은 이 회차가 아니다
    rec({ wavePlan: { ...WAVE, created_at: '2026-10-20T00:00:00.000Z' } }, res(['X'])),
  ];
  const summary = summarizeWaveCalls(plan, records, { currentOutputHash: () => null });
  assert.deepEqual(summary[0].runs.map((r) => [r.run, r.validations, r.after_fail, r.after_warn]), [
    [1, 1, 0, 0],
    [2, 2, 0, 1],
  ]);
  assert.equal(summary[0].changed_after_last, false);
  assert.deepEqual(summary[1].runs, []);
  const lines = formatWaveCallSummary(summary);
  assert.ok(lines.some((l) => l.includes('call 2: batch_0001 part 2 [new]: 기록 없음')));
  assert.ok(lines.some((l) => l.includes('call 3: batch_0002 [done]: 재사용')));

  const changed = summarizeWaveCalls(plan, records, { currentOutputHash: () => 'different' });
  assert.equal(changed[0].changed_after_last, true);
  assert.ok(formatWaveCallSummary(changed)[0].includes('마지막 검증 뒤 출력이 바뀜'));
});

test('validation log: records carry file hashes and the wave only for batches in the plan', async () => {
  const graphDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-vlog-'));
  try {
    await fs.mkdir(path.join(graphDir, 'pass1', 'parts'), { recursive: true });
    await fs.writeFile(path.join(graphDir, 'pass1', 'parts', 'batch_0001.part1.json'), '{}');

    const inWave = await recordValidation({ actor: 'extractor', batchId: 'batch_0001', part: 1, run: 1, res: res([], ['WIDE_RANGE']), graphDir, wavePlan: WAVE });
    assert.equal(inWave.wave, WAVE.wave);
    assert.equal(inWave.result, 'pass_warn');
    assert.match(inWave.output_sha256, /^[0-9a-f]{64}$/);
    assert.equal(inWave.input_sha256, null);
    assert.match(inWave.validator_sha256, /^[0-9a-f]{64}$/);

    const outside = await recordValidation({ actor: 'next', batchId: 'batch_0009', res: res(), graphDir, wavePlan: WAVE });
    assert.equal(outside.wave, null);
    assert.equal(outside.output_sha256, null);

    await fs.appendFile(path.join(graphDir, 'pass1', 'waves', 'validation_log.jsonl'), '{broken\n');
    const log = await readValidationLog(graphDir);
    assert.equal(log.records.length, 2);
    assert.equal(log.broken, 1);
  } finally {
    await fs.rm(graphDir, { recursive: true, force: true });
  }
});

test('validation log: run numbers come from the supervisor\'s rerun markers, not from the extractor command', () => {
  const plan = { ...WAVE, calls: [{ call: 1, batch_id: 'batch_0001', part: 1, status: 'new' }, { call: 2, batch_id: 'batch_0001', part: 2, status: 'new' }] };
  const at = (iso) => new Date(`2026-10-19T${iso}Z`);
  const records = [
    rec({ run: null, now: at('01:00:00.000') }, res([], ['WIDE_RANGE'])),
    // 같은 세션에서 고친 뒤 다시 검증: 같은 실행(8·9회차에는 서브에이전트가 여기서 --run을 올려 실행이 나뉘었다)
    rec({ run: null, now: at('01:05:00.000') }),
    buildRerunMarker({ wavePlan: plan, call: plan.calls[0], now: at('02:00:00.000') }),
    rec({ run: null, now: at('02:10:00.000') }, res(['COVERAGE_GAP'])),
    rec({ run: null, now: at('02:20:00.000') }),
    // 다른 회차 계획의 표시는 세지 않는다
    buildRerunMarker({ wavePlan: { ...plan, created_at: '2026-10-20T00:00:00.000Z' }, call: plan.calls[0], now: at('01:30:00.000') }),
    // 다시 돌렸는데 검증 기록이 없는 실행
    buildRerunMarker({ wavePlan: plan, call: plan.calls[1], now: at('03:00:00.000') }),
  ];
  const summary = summarizeWaveCalls(plan, records, { currentOutputHash: () => null });
  assert.deepEqual(summary[0].runs.map((r) => [r.run, r.validations, r.after_fail, r.after_warn]), [
    [1, 2, 0, 1],
    [2, 2, 1, 0],
  ]);
  assert.deepEqual(summary[1].runs.map((r) => [r.run, r.validations]), [[2, 0]]);
  assert.equal(summary[1].changed_after_last, false);
  assert.ok(formatWaveCallSummary(summary).some((l) => l.includes('run 2: 다시 돌렸지만 검증 기록 없음')));

  // 9회차까지의 기록은 적힌 run 값을 그대로 쓴다
  const legacy = summarizeWaveCalls(plan, [rec({ run: 1 }), rec({ run: 2 })], { currentOutputHash: () => null });
  assert.deepEqual(legacy[0].runs.map((r) => r.run), [1, 2]);
});

test('validation log: rerun marks the call in the saved wave plan and the extractor command has no run number', async () => {
  const graphDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-rerun-'));
  try {
    const calls = [{ call: 1, batch_id: 'batch_0001', part: 1, status: 'new' }, { call: 2, batch_id: 'batch_0002', part: null, status: 'new' }];
    await fs.mkdir(path.join(graphDir, 'pass1', 'waves'), { recursive: true });
    await fs.writeFile(path.join(graphDir, 'pass1', 'waves', 'current.json'), JSON.stringify({ ...WAVE, calls }));
    assert.equal((await markRerun(1, graphDir)).run, 2);
    assert.equal((await markRerun(1, graphDir)).run, 3);
    assert.equal((await markRerun(2, graphDir)).run, 2);
    await assert.rejects(markRerun(9, graphDir), /call 9 is not in the wave plan/);
    const { records } = await readValidationLog(graphDir);
    assert.deepEqual(records.map((r) => [r.actor, r.call, r.part]), [['rerun', 1, 1], ['rerun', 1, 1], ['rerun', 2, null]]);

    assert.equal(validateCommandOf(calls[0]), 'node scripts/graph/validate-output.mjs batch_0001 --part 1');
    assert.equal(validateCommandOf(calls[1]), 'node scripts/graph/validate-output.mjs batch_0002');
  } finally {
    await fs.rm(graphDir, { recursive: true, force: true });
  }
});

test('validation log: command lines reject unknown options before validating or merging', () => {
  assert.deepEqual(parseValidateArgs(['batch_0001', '--part', '2']), { target: 'batch_0001', part: 2, log: true });
  assert.deepEqual(parseValidateArgs(['batch_0001', '--no-log']), { target: 'batch_0001', part: null, log: false });
  assert.match(parseValidateArgs(['batch_0001', '--run', '2']).error, /--run was removed/);
  assert.match(parseValidateArgs(['batch_0001', '--nolog']).error, /unknown option --nolog/);
  assert.match(parseValidateArgs(['batch_0001', '--part', '0']).error, /--part/);
  assert.match(parseValidateArgs(['batch_0001', 'batch_0002']).error, /unexpected argument/);
  assert.match(parseValidateArgs([]).error, /missing/);

  assert.deepEqual(parseMergeArgs([]), { pilot: false });
  assert.deepEqual(parseMergeArgs(['--pilot']), { pilot: true });
  assert.deepEqual(parseMergeArgs(['--help']), { help: true });
  assert.match(parseMergeArgs(['--bogus']).error, /unknown argument --bogus/);
});
