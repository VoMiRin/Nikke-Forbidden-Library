// 인게임 화자 색상 통합 목록(Markdown 표)을 읽는 공용 모듈.
// buildSpeakerColors.mjs(이름별 기본색)와 buildSpeakerSceneColors.mjs(장면별 색)가 같은 규칙을 쓰도록 한 곳에 둔다.
//
// - '니케 화자'와 'NPC 화자' 행만 쓴다. 흰색(#FFFFFF)은 NPC 공통 기본값이라 색이 없는 것으로 본다.
// - 같은 이름이 니케와 NPC 양쪽에 있으면 니케 색을 우선한다.
// - 같은 이름에 여러 ID가 있으면 기본 ID(가장 짧은 ID, 예: rapi < rapi_s)의 색을 쓴다.
// - '???'처럼 여러 인물이 공유하는 이름은 이름별 기본색을 정할 수 없으므로 뺀다.

const EXCLUDED_NAMES = new Set(['???', '(이름 미연결)']);
// 숫자가 작을수록 우선한다
const KIND_PRIORITY = { '니케 화자': 0, 'NPC 화자': 1 };

/** 통합 목록의 화자 행을 { name, id, kind, color } 목록으로 읽는다. color는 흰색이면 null이다. */
export const readSpeakerColorRows = (markdown) => {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\| \d+ \|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replace(/^`|`$/g, ''));
    const [, name, id, kind, mainColor] = cells;
    if (!(kind in KIND_PRIORITY)) continue;
    if (!/^#[0-9A-F]{6}$/i.test(mainColor)) continue;
    const color = /^#FFFFFF$/i.test(mainColor) ? null : mainColor.toUpperCase();
    rows.push({ name, id, kind, color });
  }
  return rows;
};

const isPreferredRow = (candidate, current) => {
  if (!current) return true;
  const a = KIND_PRIORITY[candidate.kind];
  const b = KIND_PRIORITY[current.kind];
  if (a !== b) return a < b;
  if (candidate.id.length !== current.id.length) return candidate.id.length < current.id.length;
  return candidate.id < current.id;
};

/** 표시 이름 → 기본 주색. 흰색과 공유 이름은 넣지 않는다. */
export const baseColorByName = (rows) => {
  const best = new Map();
  for (const row of rows) {
    if (!row.color || EXCLUDED_NAMES.has(row.name)) continue;
    if (isPreferredRow(row, best.get(row.name))) best.set(row.name, row);
  }
  return new Map([...best].map(([name, row]) => [name, row.color]));
};

/** 화자 ID → 주색(흰색이면 null). 한 ID에 행이 여럿이면 니케 행을 우선한다. */
export const colorBySpeakerId = (rows) => {
  const best = new Map();
  for (const row of rows) {
    const current = best.get(row.id);
    if (!current || KIND_PRIORITY[row.kind] < KIND_PRIORITY[current.kind]) best.set(row.id, row);
  }
  return new Map([...best].map(([id, row]) => [id, row.color]));
};
