import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
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
