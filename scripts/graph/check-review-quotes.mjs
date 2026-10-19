import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewInputPathOf } from './batch-parts.mjs';

const __filename = fileURLToPath(import.meta.url);

// 5절 Pass 1 회차 보고서: 독립 검토자가 인용한 원문 줄(`[L0025] 레드 후드: ...`)을 검토 입력의 장면 원문과 대조한다.
// 8회차 검토자는 인용 96줄 중 12줄을 원문에 없는 문장이나 다른 화자로 적었다(red_ash_05).
// 감독관은 원문을 읽지 않으므로(명세 2.1) 원문은 출력하지 않고, 틀린 인용의 위치만 출력한다. 검토자가 고친다.

// 줄 맨 앞의 인용만 본다(코드 블록·인용 블록·목록 안 포함). 문장 속 인용(`"..."`(L0045))은 보지 않는다
const QUOTE_LINE_RE = /^\s*(?:[>-]\s*)*\[L(\d+)\] ?(.*)$/;
// 장면 맥락: 제목(#)이나 번호 항목(1.)에서 처음 나온 `역따옴표` 낱말이 검토 입력의 장면 ID이면 그 장면이다.
// 장면 ID가 없는 제목은 맥락을 지운다. 단 맥락을 정한 제목보다 아래 단계의 제목(`#### 장면` 밑의 `##### 발견된 오류`)과
// 장면 ID가 없는 번호 항목(장면 안의 지적 1, 2…)은 그대로 둔다. 본문 속 다른 장면 언급(`main_24_00` L0040)은 맥락을 바꾸지 않는다
const HEADING_RE = /^\s*(#+)\s/;
const NUMBERED_RE = /^\s*\d+\.\s/;
const FIRST_CODE_RE = /`([^`]+)`/;

export const sceneLinesOf = (inputScene) => {
  const lines = new Map();
  for (const raw of String(inputScene?.numbered_script ?? '').split('\n')) {
    const m = raw.match(/^\[L(\d+)\] ?(.*)$/);
    if (m) lines.set(Number(m[1]), m[2].trim());
  }
  return lines;
};

// 검토 입력에 원문이 들어 있는 장면(검토 장면과 경고 장면)
export const reviewSceneLines = (reviewInput) => {
  const scenes = new Map();
  for (const s of [...(reviewInput?.scenes ?? []), ...(reviewInput?.warning_scenes ?? [])]) {
    if (s?.input_scene) scenes.set(s.scene_id, sceneLinesOf(s.input_scene));
  }
  return scenes;
};

/**
 * 보고서의 `[Lnnnn] 원문` 줄마다 장면 맥락의 원문 줄과 앞뒤 공백만 빼고 같은지 본다.
 * kind: 'mismatch'(원문과 다름), 'no_line'(장면에 그 줄 번호가 없음), 'no_scene'(장면 맥락을 알 수 없음)
 */
export const checkReviewQuotes = (reviewInput, reportText) => {
  const scenes = reviewSceneLines(reviewInput);
  let scene = null;
  let sceneLevel = 0; // 맥락을 정한 제목의 단계(번호 항목이면 제목보다 깊은 7)
  let checked = 0;
  const problems = [];
  String(reportText)
    .split('\n')
    .forEach((text, i) => {
      const level = text.match(HEADING_RE)?.[1].length ?? (NUMBERED_RE.test(text) ? 7 : 0);
      if (level > 0) {
        const code = text.match(FIRST_CODE_RE)?.[1];
        if (code && scenes.has(code)) [scene, sceneLevel] = [code, level];
        else if (level <= 6 && level <= sceneLevel) [scene, sceneLevel] = [null, 0];
      }
      const m = text.match(QUOTE_LINE_RE);
      if (!m) return;
      checked += 1;
      const at = { report_line: i + 1, scene_id: scene, line: Number(m[1]) };
      if (!scene) problems.push({ ...at, kind: 'no_scene' });
      else if (!scenes.get(scene).has(at.line)) problems.push({ ...at, kind: 'no_line' });
      else if (scenes.get(scene).get(at.line) !== m[2].trim()) problems.push({ ...at, kind: 'mismatch' });
    });
  return { checked, problems };
};

const KIND_LABEL = { mismatch: '원문과 다름', no_line: '장면에 그 줄 번호가 없음', no_scene: '장면을 알 수 없음(위 제목이나 번호 항목에 장면 ID가 없음)' };

export const formatQuoteCheck = ({ checked, problems }, reportPath) =>
  [
    `[quotes] ${reportPath}: [Lnnnn] 인용 ${checked}줄 중 ${problems.length}줄 문제`,
    ...(checked === 0 ? ['  줄 맨 앞의 [Lnnnn] 인용이 하나도 없다. 인용을 지시서 4절 형식(한 줄에 원문 한 줄)으로 적었는지 확인한다'] : []),
    ...problems.map(
      (p) => `  보고서 ${p.report_line}줄: ${p.scene_id ?? '?'} L${String(p.line).padStart(4, '0')} — ${KIND_LABEL[p.kind]}`
    ),
  ].join('\n');

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [wave, reportPath] = process.argv.slice(2);
  if (!wave || !reportPath) {
    console.error('Usage: node scripts/graph/check-review-quotes.mjs <wave> <report.md>');
    process.exit(1);
  }
  const reviewInput = JSON.parse(await fs.readFile(reviewInputPathOf(wave), 'utf8'));
  const result = checkReviewQuotes(reviewInput, await fs.readFile(reportPath, 'utf8'));
  console.log(formatQuoteCheck(result, reportPath));
  if (result.problems.length > 0) process.exitCode = 1;
}
