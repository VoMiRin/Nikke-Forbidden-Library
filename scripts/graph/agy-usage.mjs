import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// 감독관 한 번의 실행(사용자 요청 하나)에서 감독관과 그 실행이 만든 서브에이전트의 사용량을 원시 로그에서 센다.
// - 감독관은 마지막 사용자 요청 다음 스텝부터 센다(같은 세션의 이전 실행을 섞지 않는다).
//   실행 도중 사용자가 다른 질문을 했으면 --from-request <문구>로 그 실행을 시작한 요청을 지정한다
// - 서브에이전트는 그 구간에서 감독관이 만든 세션이다("Created the following subagents" 기록)
// - 토큰은 PLANNER_RESPONSE의 input_tokens(비캐시 입력)·cache_read_tokens·output_tokens 합이다.
//   thinking 토큰 수는 로그에 없고, output_tokens에 들어 있는지도 로그로는 알 수 없다

export const DEFAULT_BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
const TOKEN_FIELDS = ['input_tokens', 'cache_read_tokens', 'output_tokens'];

const transcriptPathOf = (brainDir, sessionId) =>
  path.join(brainDir, sessionId, '.system_generated', 'logs', 'transcript_full.jsonl');

export const readTranscript = (brainDir, sessionId) =>
  fs
    .readFileSync(transcriptPathOf(brainDir, sessionId), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const contentOf = (step) => (typeof step.content === 'string' ? step.content : '');

/**
 * 감독관 세션에서 이번 실행 구간을 정한다. fromStep이 없으면 마지막 사용자 요청 스텝이다.
 */
export const supervisorRange = (steps, { fromStep = null, toStep = null, fromRequest = null } = {}) => {
  const userSteps = steps
    .filter((s) => s.type === 'USER_INPUT' && (!fromRequest || contentOf(s).includes(fromRequest)))
    .map((s) => s.step_index);
  if (fromRequest && userSteps.length === 0) throw new Error(`no user request containing "${fromRequest}"`);
  const from = fromStep ?? (userSteps.length ? Math.max(...userSteps) : -1);
  const to = toStep ?? Math.max(...steps.map((s) => s.step_index));
  return { from, to, steps: steps.filter((s) => s.step_index > from && s.step_index <= to) };
};

export const createdSubagentIds = (steps) => {
  const ids = [];
  for (const step of steps) {
    const content = contentOf(step);
    if (!content.includes('Created the following subagents')) continue;
    for (const m of content.matchAll(/"conversationId":\s*"([0-9a-f-]{36})"/g)) {
      if (!ids.includes(m[1])) ids.push(m[1]);
    }
  }
  return ids;
};

/**
 * 서브에이전트에게 준 첫 지시문에서 역할과 맡은 배치를 읽어 이름표를 만든다.
 */
export const labelOf = (steps) => {
  const first = steps.find((s) => s.type === 'SYSTEM_MESSAGE' || s.type === 'USER_INPUT');
  const text = first ? contentOf(first) : '';
  const role = text.includes('독립 검토자')
    ? 'review'
    : text.includes('보수 서브에이전트')
      ? 'repair'
      : text.includes('추출 서브에이전트')
        ? 'extract'
        : 'other';
  const job = /\bjob\s*(\d+)/.exec(text)?.[1];
  const part = /--part\s+(\d+)/.exec(text)?.[1] ?? /\.part(\d+)\.json/.exec(text)?.[1];
  const batches = [...new Set([...text.matchAll(/\bbatch_\d{4}\b/g)].map((m) => m[0]))];
  const where = role === 'review' ? '' : batches.slice(0, 3).join('+') + (batches.length > 3 ? '+…' : '');
  return [role, where, part ? `part${part}` : '', job && role === 'repair' ? `job${job}` : ''].filter(Boolean).join(' ');
};

/**
 * 한 세션 구간의 사용량과 파일 열람을 센다.
 */
export const summarizeSteps = (steps) => {
  const responses = steps.filter((s) => s.type === 'PLANNER_RESPONSE');
  const totals = Object.fromEntries(TOKEN_FIELDS.map((f) => [f, 0]));
  const missing = new Set();
  for (const r of responses) {
    for (const f of TOKEN_FIELDS) {
      if (Number.isInteger(r[f])) totals[f] += r[f];
      else missing.add(f);
    }
  }
  const scriptReads = {};
  let firstScriptReadStep = null;
  let firstValidatorRunStep = null;
  let toolCalls = 0;
  let shellScriptReads = 0;
  for (const step of steps) {
    for (const call of step.tool_calls ?? []) {
      toolCalls += 1;
      const args = JSON.stringify(call.args ?? {});
      // 셸로 소스를 읽은 것(cat·sed·head 등으로 scripts/ 아래 파일). node scripts/... 실행은 제외
      if (call.name === 'run_command' && /\b(?:cat|sed|head|tail|less|more|grep|rg|awk|nl|bat)\b[^|;&]*\bscripts\//.test(String(call.args?.CommandLine ?? ''))) {
        shellScriptReads += 1;
      }
      if (firstValidatorRunStep === null && call.name === 'run_command' && /validate-output\.mjs|repair-pass1\.mjs (check|apply)/.test(args)) {
        firstValidatorRunStep = step.step_index;
      }
    }
    const content = contentOf(step);
    const file = step.type === 'GENERIC' ? /^File Path: `file:\/\/([^`]+)`/m.exec(content.slice(0, 600))?.[1] : null;
    if (file && /\/scripts\//.test(file)) {
      const name = file.split('/scripts/')[1];
      scriptReads[name] = (scriptReads[name] ?? 0) + 1;
      if (firstScriptReadStep === null) firstScriptReadStep = step.step_index;
    }
  }
  return {
    responses: responses.length,
    ...totals,
    missing_fields: [...missing],
    tool_calls: toolCalls,
    script_reads: scriptReads,
    shell_script_reads: shellScriptReads,
    first_script_read_step: firstScriptReadStep,
    first_validator_run_step: firstValidatorRunStep,
  };
};

export const collectRunUsage = ({ brainDir = DEFAULT_BRAIN_DIR, supervisor, fromStep = null, toStep = null, fromRequest = null }) => {
  const supSteps = readTranscript(brainDir, supervisor);
  const range = supervisorRange(supSteps, { fromStep, toStep, fromRequest });
  const rows = [{ session: supervisor, label: 'supervisor', ...summarizeSteps(range.steps) }];
  for (const id of createdSubagentIds(range.steps)) {
    const steps = readTranscript(brainDir, id);
    rows.push({ session: id, label: labelOf(steps), ...summarizeSteps(steps) });
  }
  const total = { responses: 0, ...Object.fromEntries(TOKEN_FIELDS.map((f) => [f, 0])) };
  for (const row of rows) for (const key of Object.keys(total)) total[key] += row[key];
  return { supervisor, from_step: range.from, to_step: range.to, rows, total };
};

const fmt = (n) => n.toLocaleString('en-US');

export const formatUsageTable = (usage) => {
  const lines = [
    `감독관 ${usage.supervisor} 스텝 ${usage.from_step} 초과 ~ ${usage.to_step} (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)`,
    '',
    '| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 |',
    '|---|---|---:|---:|---:|---:|---|',
  ];
  for (const r of usage.rows) {
    const reads = [
      ...Object.entries(r.script_reads).map(([f, n]) => `${f}×${n}`),
      ...(r.shell_script_reads ? [`셸 ${r.shell_script_reads}회`] : []),
    ].join(', ');
    const early =
      r.first_script_read_step !== null && (r.first_validator_run_step === null || r.first_script_read_step < r.first_validator_run_step)
        ? ' (검증 실행 전)'
        : '';
    lines.push(
      `| ${r.session.slice(0, 8)} | ${r.label} | ${r.responses} | ${fmt(r.input_tokens)} | ${fmt(r.cache_read_tokens)} | ${fmt(r.output_tokens)} | ${reads ? reads + early : '0'} |`
    );
  }
  const t = usage.total;
  lines.push(`| **합계** | | ${t.responses} | ${fmt(t.input_tokens)} | ${fmt(t.cache_read_tokens)} | ${fmt(t.output_tokens)} | |`);
  const missing = usage.rows.filter((r) => r.missing_fields.length);
  if (missing.length) {
    lines.push('', `토큰 필드가 없는 응답이 있는 세션(0으로 세지 않고 빠짐): ${missing.map((r) => `${r.session.slice(0, 8)} ${r.missing_fields.join('/')}`).join(', ')}`);
  }
  lines.push('', 'thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.');
  lines.push('scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.');
  return lines.join('\n');
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const supervisor = opt('--supervisor');
  if (!supervisor) {
    console.error(
      'Usage: node scripts/graph/agy-usage.mjs --supervisor <session-id> [--from-request TEXT | --from-step N] [--to-step N] [--brain-dir DIR] [--json]\n' +
        '  기본 시작점: 그 세션의 마지막 사용자 요청. --from-request: TEXT가 들어간 마지막 사용자 요청'
    );
    process.exit(1);
  }
  const usage = collectRunUsage({
    brainDir: opt('--brain-dir') ?? DEFAULT_BRAIN_DIR,
    supervisor,
    fromStep: opt('--from-step') !== null ? Number(opt('--from-step')) : null,
    fromRequest: opt('--from-request'),
    toStep: opt('--to-step') !== null ? Number(opt('--to-step')) : null,
  });
  console.log(args.includes('--json') ? JSON.stringify(usage, null, 2) : formatUsageTable(usage));
}
