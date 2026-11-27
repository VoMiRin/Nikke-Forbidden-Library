// 장면별 화자 색 계산(순수 로직). CLI는 buildSpeakerSceneColors.mjs.
//
// 대본 TXT에는 표시 이름만 있고 화자 ID가 없다. 같은 이름이라도 코스튬·변형 ID(marian_q, neon_s 등)에 따라
// 인게임 색이 다르므로, 대사 문장을 원본 대사 테이블과 맞춰 줄마다 화자 ID를 찾는다.
//
// 1. 대사 줄마다 정규화한 문장으로 원본 후보(화자 ID, 원본 그룹)를 찾고, 표시 이름이 같은 후보만 남긴다.
// 2. 짧은 문장("··· ···." 등)은 여러 장면에 있으므로, 장면 안 대사들이 가장 많이 가리키는 원본 그룹의 후보를 고른다.
// 3. 고른 후보의 색(흰색 제외)이 하나로 정해진 줄만 쓴다. 정해지지 않은 줄은 이름 기본색을 그대로 쓴다.
// 4. 장면 안에서 이름마다 가장 많은 색을 장면 색으로 두고(기본색과 같으면 생략), 그와 다른 줄만 문장 단위로 적는다.

/** 대본 파서(components/script/scriptParser.ts)와 같은 방식으로 "이름: 대사" 줄을 읽는다. */
const DIALOGUE_LINE = /^([^:]+):\s*(.*)/;

export const parseDialogueLines = (sceneContent) => {
  const lines = [];
  for (const rawLine of sceneContent.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(DIALOGUE_LINE);
    if (!match) continue;
    const speaker = match[1].trim();
    if (!speaker || speaker.length >= 75 || speaker.startsWith('[')) continue;
    lines.push({ speaker, text: match[2].trim() });
  }
  return lines;
};

/** 원본 문장과 TXT 문장을 맞추기 위한 키. 변환 과정의 문장부호·줄바꿈·태그 차이를 지우고 글자만 남긴다. */
export const normalizeDialogueKey = (text) => text
  .replace(/\{AccountData\.NickName\}/g, '지휘관')
  .replace(/<[^>]*>/g, '')
  .replace(/\[\/?REDACT\]/g, '')
  .replace(/[^\p{L}\p{N}]/gu, '');

const pickMajority = (counts, preferred) => {
  let best = null;
  let bestCount = -1;
  for (const [color, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (count > bestCount || (count === bestCount && color === preferred)) {
      best = color;
      bestCount = count;
    }
  }
  return best;
};

/**
 * 한 장면의 화자 색을 정한다.
 * @param {{speaker: string, text: string}[]} lines
 * @param {{
 *   candidatesFor: (key: string) => Iterable<{speakerId: string, group: string}>,
 *   nameOf: (speakerId: string) => string | undefined,
 *   colorOf: (speakerId: string) => string | null | undefined,
 *   defaultColorOf: (name: string) => string | undefined,
 * }} source
 * @returns {{ result: {names?: Record<string,string>, lines?: Record<string, Record<string,string>>} | null,
 *   stats: {lines: number, matched: number, resolved: number, ambiguous: number} }}
 */
export const resolveSceneColors = (lines, source) => {
  const stats = { lines: lines.length, matched: 0, resolved: 0, ambiguous: 0 };
  const votes = new Map();
  const items = lines.map(({ speaker, text }) => {
    const sameName = [];
    for (const candidate of source.candidatesFor(normalizeDialogueKey(text)) ?? []) {
      if (source.nameOf(candidate.speakerId) === speaker) sameName.push(candidate);
    }
    for (const group of new Set(sameName.map(candidate => candidate.group))) {
      votes.set(group, (votes.get(group) ?? 0) + 1);
    }
    return { speaker, text, sameName };
  });

  // 이름 → (색 → 줄 수), 이름 → (문장 → 색 집합)
  const colorCounts = new Map();
  const textColors = new Map();
  for (const { speaker, text, sameName } of items) {
    if (sameName.length === 0) continue;
    stats.matched += 1;
    const topVote = Math.max(...sameName.map(candidate => votes.get(candidate.group)));
    const colors = new Set(
      sameName
        .filter(candidate => votes.get(candidate.group) === topVote)
        .map(candidate => source.colorOf(candidate.speakerId))
        .filter(Boolean),
    );
    if (colors.size !== 1) {
      if (colors.size > 1) stats.ambiguous += 1;
      continue;
    }
    stats.resolved += 1;
    const [color] = colors;
    if (!colorCounts.has(speaker)) colorCounts.set(speaker, new Map());
    const counts = colorCounts.get(speaker);
    counts.set(color, (counts.get(color) ?? 0) + 1);
    if (!textColors.has(speaker)) textColors.set(speaker, new Map());
    const byText = textColors.get(speaker);
    if (!byText.has(text)) byText.set(text, new Set());
    byText.get(text).add(color);
  }

  const names = {};
  const lineColors = {};
  for (const [speaker, counts] of colorCounts) {
    const fallback = source.defaultColorOf(speaker);
    const sceneColor = pickMajority(counts, fallback);
    if (sceneColor !== fallback) names[speaker] = sceneColor;
    for (const [text, colors] of textColors.get(speaker)) {
      // 같은 장면에서 같은 문장이 다른 색으로 나오면 줄을 가를 수 없으므로 장면 색에 맡긴다
      if (colors.size !== 1) continue;
      const [color] = colors;
      if (color === sceneColor) continue;
      (lineColors[speaker] ??= {})[text] = color;
    }
  }

  const result = {};
  if (Object.keys(names).length > 0) result.names = names;
  if (Object.keys(lineColors).length > 0) result.lines = lineColors;
  return { result: Object.keys(result).length > 0 ? result : null, stats };
};
