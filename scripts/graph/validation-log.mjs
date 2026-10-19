import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, sha256 } from './lib.mjs';
import { partInputPathOf, partPathOf, wavePlanPathOf } from './batch-parts.mjs';

// 5절 Pass 1 본 실행 회차: 검증할 때마다 결과를 한 줄씩 남겨, 보고서의 호출별 표를 서브에이전트의 자기 보고 대신 이 기록으로 채운다.
// 기록하는 것은 기계적으로 알 수 있는 것(결과, 규칙별 건수, 파일 해시)뿐이다. 무엇을 어떻게 고쳤는지와 그대로 둔 이유는 서브에이전트 보고에서 받는다.
// 경고가 사라졌다고 올바르게 고친 것은 아니므로, 경고 뒤의 재검증은 "경고 상태에서 재검증"이라고만 부른다.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// PASS1_VALIDATION_LOG로 기록 파일을 바꿀 수 있다(검증기 명령을 실행하는 테스트가 실제 기록을 건드리지 않게)
export const validationLogPathOf = (graphDir = GRAPH_DATA_DIR) =>
  process.env.PASS1_VALIDATION_LOG || path.join(graphDir, 'pass1', 'waves', 'validation_log.jsonl');

// 검증한 쪽: 서브에이전트가 실행한 검증기 명령(extractor), next의 재사용 판정, finish의 결합 전·후 검증
export const VALIDATION_ACTORS = new Set(['extractor', 'next', 'finish']);

// 검증기 버전: 검사 코드가 바뀌면 같은 출력이라도 결과가 달라지므로 소스 해시를 남긴다
export const validatorHash = () =>
  sha256(
    ['validate-output.mjs', 'lib.mjs'].map((name) => fsSync.readFileSync(path.join(SCRIPT_DIR, name), 'utf8')).join('\u0000')
  );

export const fileHashOf = (filePath) => {
  try {
    return sha256(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const countByRule = (list) =>
  (list ?? []).reduce((acc, x) => ({ ...acc, [x.rule]: (acc[x.rule] ?? 0) + 1 }), {});

/**
 * 결과 하나: fail(오류 있음) | pass_warn(통과, 경고 있음) | pass(통과, 경고 없음) | unreadable(파일을 읽거나 파싱하지 못함).
 * 읽지 못한 것도 시도로 남긴다. 기록이 빠진 시도를 0회나 통과로 세지 않기 위함이다.
 */
export const resultOf = (res, fatal) => {
  if (fatal) return 'unreadable';
  if (!res.valid) return 'fail';
  return res.warnings.length > 0 ? 'pass_warn' : 'pass';
};

/**
 * 기록 한 줄. 회차는 저장된 회차 계획(waves/current.json)에 이 배치가 있을 때만 붙인다.
 * 같은 이름의 회차를 중단 뒤 다시 계획할 수 있으므로 계획의 created_at도 함께 남긴다.
 */
export const buildValidationRecord = ({ actor, batchId, part = null, run = null, wavePlan = null, res = null, fatal = null, outputPath, inputPath, validator, now = new Date() }) => {
  if (!VALIDATION_ACTORS.has(actor)) throw new Error(`unknown validation actor: ${actor}`);
  const inWave = Array.isArray(wavePlan?.batch_ids) && wavePlan.batch_ids.includes(batchId);
  return {
    recorded_at: now.toISOString(),
    actor,
    wave: inWave ? wavePlan.wave : null,
    wave_plan_created_at: inWave ? wavePlan.created_at : null,
    batch_id: batchId,
    part,
    run,
    result: resultOf(res ?? { valid: false, warnings: [] }, fatal),
    errors: fatal ? {} : countByRule(res?.errors),
    warnings: fatal ? {} : countByRule(res?.warnings),
    fatal: fatal ? String(fatal).slice(0, 300) : null,
    output_sha256: fileHashOf(outputPath),
    input_sha256: fileHashOf(inputPath),
    validator_sha256: validator,
  };
};

// 동시에 돌아가는 서브에이전트들이 같은 파일에 쓴다. 한 줄씩 덧붙이기(O_APPEND)는 짧은 줄이면 섞이지 않는다
export const appendValidationRecord = async (record, graphDir = GRAPH_DATA_DIR) => {
  const logPath = validationLogPathOf(graphDir);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
};

const readWavePlan = (graphDir) => {
  try {
    return JSON.parse(fsSync.readFileSync(wavePlanPathOf(graphDir), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * 배치(또는 부분) 검증 한 번을 기록한다. 출력·입력 파일은 검증기가 읽는 경로와 같다.
 * 기록에 실패해도 검증 결과는 그대로 둔다(그 시도는 요약에서 "기록 없음"이나 빠진 회수로 드러난다).
 */
export const recordValidation = async ({ actor, batchId, part = null, run = null, res = null, fatal = null, graphDir = GRAPH_DATA_DIR, wavePlan = readWavePlan(graphDir), shardPath = null }) => {
  try {
    const outputPath =
      shardPath ?? (part ? partPathOf(batchId, part, graphDir) : path.join(graphDir, 'pass1', 'shards', `${batchId}.json`));
    const inputPath = part ? partInputPathOf(batchId, part, graphDir) : path.join(graphDir, 'pass1', 'batches', `${batchId}.json`);
    const record = buildValidationRecord({ actor, batchId, part, run, wavePlan, res, fatal, outputPath, inputPath, validator: validatorHash() });
    await appendValidationRecord(record, graphDir);
    return record;
  } catch (err) {
    console.error(`[validation-log] 기록 실패 (${batchId}${part ? ` part ${part}` : ''}): ${err.message || err}`);
    return null;
  }
};

export const readValidationLog = async (graphDir = GRAPH_DATA_DIR) => {
  const logPath = validationLogPathOf(graphDir);
  if (!fsSync.existsSync(logPath)) return { records: [], broken: 0 };
  const records = [];
  let broken = 0;
  for (const line of (await fs.readFile(logPath, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      broken += 1;
    }
  }
  return { records, broken };
};

const RETRY_KIND = {
  fail: 'after_fail',
  unreadable: 'after_fail',
  pass_warn: 'after_warn',
  pass: 'extra_check',
};

/**
 * 추출 실행 하나(회차 계획·배치·부분·run 번호)의 추출자 검증 기록을 센다.
 * 재검증은 직전 추출자 검증 결과로 나눈다: 실패·읽기 실패 뒤 → 실패 후 재검증, 경고 있는 통과 뒤 → 경고 상태에서 재검증,
 * 경고 없는 통과 뒤 → 추가 확인. next·finish의 검증은 이 계산에 넣지 않는다.
 * 예: 실패 → 실패 → 경고만 있음 → 경고 없음 = 검증 4회, 실패 후 재검증 2회, 경고 상태에서 재검증 1회.
 */
export const summarizeRun = (records) => {
  const counts = { after_fail: 0, after_warn: 0, extra_check: 0 };
  for (let i = 1; i < records.length; i += 1) counts[RETRY_KIND[records[i - 1].result]] += 1;
  return { validations: records.length, first: records[0], last: records.at(-1), ...counts };
};

/**
 * 회차 계획의 호출마다 추출자 검증 기록을 run 번호별로 묶는다.
 * 기록이 없는 호출은 runs가 비어 있다("기록 없음"이지 0회 통과가 아니다). [done]으로 재사용한 호출은 이번 회차에 추출하지 않았다.
 * 마지막 검증 뒤에 출력 파일이 바뀌었으면 changed_after_last에 표시한다(그 기록은 지금 파일의 결과가 아니다).
 */
export const summarizeWaveCalls = (wavePlan, records, { currentOutputHash = () => null } = {}) =>
  (wavePlan.calls ?? []).map((call) => {
    const mine = records.filter(
      (r) =>
        r.actor === 'extractor' &&
        r.wave === wavePlan.wave &&
        r.wave_plan_created_at === wavePlan.created_at &&
        r.batch_id === call.batch_id &&
        (r.part ?? null) === (call.part ?? null)
    );
    const byRun = new Map();
    for (const r of mine) {
      const key = r.run ?? null;
      if (!byRun.has(key)) byRun.set(key, []);
      byRun.get(key).push(r);
    }
    const runs = [...byRun.entries()]
      .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .map(([run, list]) => ({ run, ...summarizeRun(list) }));
    const lastHash = runs.at(-1)?.last.output_sha256 ?? null;
    const nowHash = currentOutputHash(call);
    return {
      ...call,
      runs,
      changed_after_last: runs.length > 0 && nowHash !== lastHash,
    };
  });

const RESULT_LABEL = { fail: 'FAIL', pass_warn: 'PASS(경고)', pass: 'PASS', unreadable: '읽기 실패' };

const formatCounts = (counts) =>
  Object.entries(counts ?? {})
    .map(([rule, n]) => `${rule} ${n}`)
    .join(', ') || '없음';

export const formatRecordResult = (record) => {
  if (record.result === 'unreadable') return `읽기 실패(${record.fatal ?? '이유 없음'})`;
  const parts = [RESULT_LABEL[record.result]];
  if (record.result === 'fail') parts.push(`오류 ${formatCounts(record.errors)}`);
  if (Object.keys(record.warnings ?? {}).length > 0) parts.push(`경고 ${formatCounts(record.warnings)}`);
  return parts.join(' / ');
};

export const formatWaveCallSummary = (summary) =>
  summary.flatMap((call) => {
    const label = `call ${call.call}: ${call.batch_id}${call.part ? ` part ${call.part}` : ''} [${call.status}]`;
    if (call.runs.length === 0) {
      return [`  ${label}: ${call.status === 'done' ? '재사용(이번 회차에 추출 안 함)' : '기록 없음'}`];
    }
    return [
      `  ${label}${call.changed_after_last ? ' — 마지막 검증 뒤 출력이 바뀜' : ''}`,
      ...call.runs.map(
        (r) =>
          `    run ${r.run ?? '번호 없음'}: 검증 ${r.validations}회 (실패 후 재검증 ${r.after_fail}, 경고 상태에서 재검증 ${r.after_warn}, 추가 확인 ${r.extra_check})` +
          ` | 첫 결과 ${formatRecordResult(r.first)} | 마지막 ${formatRecordResult(r.last)}`
      ),
    ];
  });
