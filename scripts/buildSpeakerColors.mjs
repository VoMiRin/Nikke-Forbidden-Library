// 인게임 화자 색상 통합 목록(Markdown 표)에서 "표시 이름 → 인게임 기본 주색" 표를 만든다.
// 사용법: node scripts/buildSpeakerColors.mjs <모든_화자_색상_통합목록.md>
//
// - 대본 데이터에는 화자 ID가 없고 표시 이름만 있으므로 이름으로 연결한다.
// - 행 선택 규칙은 speakerColorTable.mjs에 있다(흰색 제외, 니케 우선, 가장 짧은 ID 우선, 공유 이름 제외).
// - 같은 이름이 장면에 따라 다른 ID(코스튬·변형)로 나오는 경우는 buildSpeakerSceneColors.mjs가 장면별로 덮어쓴다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baseColorByName, readSpeakerColorRows } from './speakerColorTable.mjs';

const OUTPUT_PATH = fileURLToPath(new URL('../lib/speakerColors.ts', import.meta.url));

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('사용법: node scripts/buildSpeakerColors.mjs <모든_화자_색상_통합목록.md>');
  process.exit(1);
}

const colors = baseColorByName(readSpeakerColorRows(readFileSync(sourcePath, 'utf8')));
const entries = [...colors.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko'));
const body = entries.map(([name, color]) => `  ${JSON.stringify(name)}: '${color}',`).join('\n');
writeFileSync(OUTPUT_PATH, `// 자동 생성 파일: scripts/buildSpeakerColors.mjs로 다시 만든다. 직접 수정하지 말 것.
// 니케·NPC 화자의 인게임 기본 주색. 대사 화자 이름 옆 색 막대에 쓴다.
export const SPEAKER_COLORS: Readonly<Record<string, string>> = {
${body}
};
`);
console.log(`화자 색상 ${entries.length}개를 ${OUTPUT_PATH}에 썼습니다.`);
