// 인게임 화자 색상 통합 목록(Markdown 표)에서 "표시 이름 → 인게임 기본 주색" 표를 만든다.
// 사용법: node scripts/buildSpeakerColors.mjs <모든_화자_색상_통합목록.md>
//
// - 대본 데이터에는 화자 ID가 없고 표시 이름만 있으므로 이름으로 연결한다.
// - '니케 화자'와 'NPC 화자' 행을 쓴다. 흰색(#FFFFFF)은 NPC 공통 기본값이라 색이 없는 것으로 본다.
// - 같은 이름이 니케와 NPC 양쪽에 있으면 니케 색을 우선한다.
// - 같은 이름에 여러 ID가 있으면 기본 ID(가장 짧은 ID, 예: rapi < rapi_s)의 색을 쓴다.
// - '???'처럼 여러 인물이 공유하는 이름은 색을 정할 수 없으므로 뺀다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXCLUDED_NAMES = new Set(['???', '(이름 미연결)']);
// 숫자가 작을수록 우선한다
const KIND_PRIORITY = { '니케 화자': 0, 'NPC 화자': 1 };
const OUTPUT_PATH = fileURLToPath(new URL('../lib/speakerColors.ts', import.meta.url));

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('사용법: node scripts/buildSpeakerColors.mjs <모든_화자_색상_통합목록.md>');
  process.exit(1);
}

const baseRowByName = new Map();
for (const line of readFileSync(sourcePath, 'utf8').split(/\r?\n/)) {
  if (!/^\| \d+ \|/.test(line)) continue;
  const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replace(/^`|`$/g, ''));
  const [, name, id, kind, mainColor] = cells;
  if (!(kind in KIND_PRIORITY) || EXCLUDED_NAMES.has(name)) continue;
  if (!/^#[0-9A-F]{6}$/i.test(mainColor) || /^#FFFFFF$/i.test(mainColor)) continue;

  const priority = KIND_PRIORITY[kind];
  const current = baseRowByName.get(name);
  const isPreferred = !current
    || priority < current.priority
    || (priority === current.priority && (id.length < current.id.length || (id.length === current.id.length && id < current.id)));
  if (isPreferred) {
    baseRowByName.set(name, { id, priority, color: mainColor.toUpperCase() });
  }
}

const entries = [...baseRowByName.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko'));
const body = entries.map(([name, { color }]) => `  ${JSON.stringify(name)}: '${color}',`).join('\n');
writeFileSync(OUTPUT_PATH, `// 자동 생성 파일: scripts/buildSpeakerColors.mjs로 다시 만든다. 직접 수정하지 말 것.
// 니케·NPC 화자의 인게임 기본 주색. 대사 화자 이름 옆 색 막대에 쓴다.
export const SPEAKER_COLORS: Readonly<Record<string, string>> = {
${body}
};
`);
console.log(`화자 색상 ${entries.length}개를 ${OUTPUT_PATH}에 썼습니다.`);
