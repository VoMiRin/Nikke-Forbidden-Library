import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const generatedDir = path.join(rootDir, '.generated-search-assets');
const scriptsRootDir = path.join(rootDir, 'public', 'scripts');

const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rootDir, 'notebooklm_sources');

const maxBytesPerContentFile = Number.parseInt(
  process.env.NOTEBOOKLM_MAX_BYTES_PER_FILE || '2600000',
  10,
);

const categoryNames = {
  main_story: '메인 스토리',
  event_stories: '이벤트 스토리',
  side_stories: '사이드 스토리',
  sub_quests: '서브 퀘스트',
  outpost_stories: '돌발 스토리',
  character_episodes: '니케 에피소드',
  lost_relics: '유실물',
  event_lost_relics: '이벤트 유실물',
};

const exportGroups = [
  {
    key: 'main_story',
    title: '메인 스토리',
    fileBase: 'main_story',
    categories: ['main_story'],
  },
  {
    key: 'event_stories',
    title: '이벤트 스토리',
    fileBase: 'event_stories',
    categories: ['event_stories'],
  },
  {
    key: 'side_stories',
    title: '사이드 스토리',
    fileBase: 'side_stories',
    categories: ['side_stories'],
  },
  {
    key: 'character_episodes',
    title: '니케 에피소드',
    fileBase: 'character_episodes',
    categories: ['character_episodes'],
  },
  {
    key: 'sub_quests',
    title: '서브 퀘스트',
    fileBase: 'sub_quests',
    categories: ['sub_quests'],
  },
  {
    key: 'outpost_stories',
    title: '돌발 스토리',
    fileBase: 'outpost_stories',
    categories: ['outpost_stories'],
  },
  {
    key: 'lost_relics',
    title: '유실물',
    fileBase: 'lost_relics',
    categories: ['lost_relics'],
  },
  {
    key: 'event_lost_relics',
    title: '이벤트 유실물',
    fileBase: 'event_lost_relics',
    categories: ['event_lost_relics'],
  },
];

const extractScriptContent = (fullChapterText, scriptId) => {
  const scriptBlocks = fullChapterText.split(/\n*@@@SCRIPT_ID:\s*/);

  for (const block of scriptBlocks) {
    if (!block.trim()) {
      continue;
    }

    const idMatch = block.match(/^([^\n]+)/);
    if (!idMatch || idMatch[1].trim() !== scriptId) {
      continue;
    }

    let scriptContentStartIndex = block.indexOf('\n') + 1;
    const subTitleMatch = block
      .substring(scriptContentStartIndex)
      .match(/^@@@SUB_TITLE:[^\n]*\n?/i);

    if (subTitleMatch) {
      scriptContentStartIndex += subTitleMatch[0].length;
    }

    return block.substring(scriptContentStartIndex).trim();
  }

  return null;
};

const byteLength = (value) => Buffer.byteLength(value, 'utf8');

const escapeTableCell = (value) => String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();

const narrationKeywords = new Set([
  'LOCATION',
  'SOUND',
  'NARRATION',
  '나래이션',
  'MUSIC',
  'EFFECTS',
  'ACTION',
  'TRANSITION',
  'FADE IN',
  'FADE OUT',
  'CUT TO',
  'INT',
  'EXT',
  'SYSTEM',
]);

const technicalBracketPrefixes = [
  'CHOICE_',
  'OPTION ',
  'OPTION_',
  'SCENE ',
  'NEXT_',
  'MESSENGER_',
  'MSG',
  'IMAGE:',
  'STICKER:',
];

const normalizeKeyword = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const isUsefulKeyword = (value) => {
  const keyword = normalizeKeyword(value);

  if (keyword.length < 2 || keyword.length > 40) {
    return false;
  }

  if (!/[0-9A-Za-z가-힣]/.test(keyword)) {
    return false;
  }

  const upperKeyword = keyword.toUpperCase().replace(/\.$/, '');

  if (narrationKeywords.has(upperKeyword)) {
    return false;
  }

  return !technicalBracketPrefixes.some((prefix) => upperKeyword.startsWith(prefix));
};

const extractRecordSignals = (content) => {
  const speakers = new Set();
  const keywords = new Set();
  const lines = String(content ?? '').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const messengerSenderMatch = line.match(/^\[MSG\s+SENDER="([^"]+?)".*?\]$/i);
    if (messengerSenderMatch?.[1] && !line.match(/IS_SYSTEM="true"/i)) {
      const sender = normalizeKeyword(messengerSenderMatch[1]);
      if (isUsefulKeyword(sender)) {
        speakers.add(sender);
        keywords.add(sender);
      }
    }

    const actionDialogueMatch = line.match(/^([^\[]+)\[ACTION\]:\s*(.*)$/i);
    if (actionDialogueMatch?.[1]) {
      const speaker = normalizeKeyword(actionDialogueMatch[1]);
      if (isUsefulKeyword(speaker)) {
        speakers.add(speaker);
        keywords.add(speaker);
      }
    }

    const dialogueMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (dialogueMatch?.[1]) {
      const speaker = normalizeKeyword(dialogueMatch[1]);
      const upperSpeaker = speaker.toUpperCase().replace(/\.$/, '');
      if (speaker.length < 75 && !narrationKeywords.has(upperSpeaker) && isUsefulKeyword(speaker)) {
        speakers.add(speaker);
        keywords.add(speaker);
      }
    }

    for (const bracketMatch of line.matchAll(/\[([^\]\n]{1,40})\]/g)) {
      const bracketKeyword = normalizeKeyword(bracketMatch[1]);
      if (isUsefulKeyword(bracketKeyword)) {
        keywords.add(bracketKeyword);
      }
    }
  }

  return {
    speakers: Array.from(speakers).sort((a, b) => a.localeCompare(b, 'ko')),
    keywords: Array.from(keywords).sort((a, b) => a.localeCompare(b, 'ko')),
  };
};

const formatScriptRecord = (script, content) => {
  const categoryName = categoryNames[script.categoryKey] || script.categoryKey;
  const heading = script.subTitle
    ? `${script.title} - ${script.subTitle}`
    : script.title;
  const safeContent = content || '[본문 없음]';
  const { speakers, keywords } = extractRecordSignals(safeContent);
  const previewKeywords = keywords.slice(0, 40);

  return [
    '---',
    '',
    `## ${heading}`,
    '',
    `- 분류: ${categoryName}`,
    `- 스크립트 ID: \`${script.id}\``,
    `- 원본 파일: \`public/scripts/${script.categoryKey}/${script.mainChapterFile}\``,
    speakers.length > 0 ? `- 등장 화자: ${speakers.join(', ')}` : null,
    previewKeywords.length > 0 ? `- 검색 키워드: ${previewKeywords.join(', ')}` : null,
    '',
    '### 본문',
    '',
    safeContent,
    '',
  ].filter((line) => line !== null).join('\n');
};

const formatChunkHeader = (group, partNumber, totalParts) => {
  const partLabel = totalParts > 1 ? ` Part ${String(partNumber).padStart(2, '0')}` : '';
  const categoryList = group.categories.map((categoryKey) => categoryNames[categoryKey] || categoryKey).join(', ');

  return [
    `# ${group.title}${partLabel}`,
    '',
    '- 용도: NotebookLM 또는 외부 AI 도구에서 스토리 질문, 떡밥 정리, 인물/사건 추적용으로 참조하는 원문 자료입니다.',
    `- 포함 분류: ${categoryList}`,
    totalParts > 1 ? `- 분할: ${partNumber} / ${totalParts}` : null,
    '- 주의: 답변할 때는 요약과 근거 위치 위주로 사용하고, 원문을 대량으로 그대로 출력하지 않는 용도로 쓰는 것을 권장합니다.',
    '',
  ].filter(Boolean).join('\n');
};

const createChunks = (records) => {
  const chunks = [];
  let currentRecords = [];
  let currentSize = 0;

  for (const record of records) {
    const recordSize = byteLength(record);

    if (currentRecords.length > 0 && currentSize + recordSize > maxBytesPerContentFile) {
      chunks.push(currentRecords);
      currentRecords = [];
      currentSize = 0;
    }

    currentRecords.push(record);
    currentSize += recordSize;
  }

  if (currentRecords.length > 0) {
    chunks.push(currentRecords);
  }

  return chunks;
};

const formatReadme = (files) => [
  '# NotebookLM 사용 가이드',
  '',
  '이 폴더의 Markdown 파일들은 니케 스크립트 아카이브 원문을 NotebookLM 같은 외부 AI 도구에 넣기 쉽게 재구성한 자료입니다.',
  '',
  '## 권장 사용법',
  '',
  '- `00_notebooklm_readme.md`, `index_aliases_glossary.md`, `keyword_occurrence_index.md`를 함께 업로드하면 전체 구조와 키워드 위치를 잡는 데 도움이 됩니다.',
  '- 질문은 “어느 인물/사건/챕터를 중심으로 볼지”를 같이 적으면 더 정확합니다.',
  '- 답변 지시에는 “원문 대량 출력 금지, 요약과 근거 위치 중심, 확실하지 않으면 모른다고 말하기”를 넣는 것을 권장합니다.',
  '',
  '## 추천 시스템 지시문',
  '',
  '```text',
  '이 자료는 니케 스토리 분석과 떡밥 정리용 참조 자료다. 답변할 때 원문을 길게 그대로 출력하지 말고, 요약과 근거가 되는 파일명/분류/제목/서브타이틀을 중심으로 설명해라. 사용자가 원문 전체나 대량 발췌를 요청하면 거절하고 짧은 인용 또는 위치 안내로 대체해라. 자료에 근거가 없거나 확실하지 않으면 추측하지 말고 불확실하다고 말해라.',
  '```',
  '',
  '## 생성 파일',
  '',
  '| 파일 | 크기 | 항목 수 |',
  '| --- | ---: | ---: |',
  ...files.map((file) => `| ${escapeTableCell(file.name)} | ${(file.bytes / 1024 / 1024).toFixed(2)} MB | ${file.recordCount} |`),
  '',
].join('\n');

const formatKeywordIndex = (keywordMap) => {
  const rows = Array.from(keywordMap.entries())
    .filter(([, locations]) => locations.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([keyword, locations]) => {
      const visibleLocations = locations.slice(0, 50);
      const suffix = locations.length > visibleLocations.length
        ? ` 외 ${locations.length - visibleLocations.length}곳`
        : '';

      return [
        `## ${keyword}`,
        '',
        ...visibleLocations.map((location) => `- ${location}`),
        suffix ? `- ${suffix}` : null,
        '',
      ].filter(Boolean).join('\n');
    });

  return [
    '# 키워드 및 화자 출현 색인',
    '',
    '이 파일은 NotebookLM이 특정 인물명, 별명, 대괄호 키워드, 화자명을 더 쉽게 찾도록 돕는 보조 색인입니다.',
    '각 항목은 해당 키워드가 등장하는 분류, 제목, 서브타이틀, 스크립트 ID를 가리킵니다.',
    '',
    ...rows,
  ].join('\n');
};

const formatIndex = (scripts, files) => {
  const bySource = new Map();

  for (const script of scripts) {
    const key = `${script.categoryKey}/${script.mainChapterFile}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        categoryKey: script.categoryKey,
        mainChapterFile: script.mainChapterFile,
        titles: new Set(),
        subTitleCount: 0,
      });
    }

    const entry = bySource.get(key);
    entry.titles.add(script.title);
    if (script.subTitle) {
      entry.subTitleCount += 1;
    }
  }

  const sourceRows = Array.from(bySource.values()).map((entry) => {
    const categoryName = categoryNames[entry.categoryKey] || entry.categoryKey;
    const title = Array.from(entry.titles).join(' / ');

    return `| ${escapeTableCell(categoryName)} | ${escapeTableCell(title)} | ${entry.subTitleCount} | \`${escapeTableCell(entry.categoryKey)}/${escapeTableCell(entry.mainChapterFile)}\` |`;
  });

  return [
    '# 인덱스 및 질문 가이드',
    '',
    '이 파일은 NotebookLM이 전체 자료의 분류와 원본 위치를 이해하도록 돕는 보조 인덱스입니다.',
    '',
    '## 질문 예시',
    '',
    '- 라피와 신데렐라가 함께 언급되는 장면을 정리해줘.',
    '- 특정 인물과 관련된 떡밥을 메인 스토리와 이벤트 스토리 근거로 나눠서 정리해줘.',
    '- 레드 애쉬와 올드 테일즈에서 반복되는 키워드를 비교해줘.',
    '- 답변마다 근거가 되는 분류, 제목, 서브타이틀을 붙여줘.',
    '',
    '## 업로드 파일 목록',
    '',
    '| 파일 | 크기 | 항목 수 |',
    '| --- | ---: | ---: |',
    ...files.map((file) => `| ${escapeTableCell(file.name)} | ${(file.bytes / 1024 / 1024).toFixed(2)} MB | ${file.recordCount} |`),
    '',
    '## 원본 자료 인덱스',
    '',
    '| 분류 | 제목 | 항목 수 | 원본 파일 |',
    '| --- | --- | ---: | --- |',
    ...sourceRows,
    '',
  ].join('\n');
};

const writeTextFile = async (fileName, content, recordCount) => {
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, content, 'utf8');

  return {
    name: fileName,
    bytes: byteLength(content),
    recordCount,
  };
};

const main = async () => {
  const require = createRequire(import.meta.url);
  const generatedScriptsPath = path.join(generatedDir, 'data', 'newScripts.js');
  const { newScriptsData } = require(generatedScriptsPath);

  await fs.mkdir(outputDir, { recursive: true });

  const chapterFileCache = new Map();
  const recordsByGroup = new Map(exportGroups.map((group) => [group.key, []]));
  const keywordMap = new Map();
  const includedScripts = [];
  const missingScripts = [];

  for (const script of newScriptsData) {
    const group = exportGroups.find((candidate) => candidate.categories.includes(script.categoryKey));

    if (!group) {
      continue;
    }

    const chapterKey = `${script.categoryKey}/${script.mainChapterFile}`;

    if (!chapterFileCache.has(chapterKey)) {
      const chapterPath = path.join(scriptsRootDir, script.categoryKey, script.mainChapterFile);
      const chapterText = await fs.readFile(chapterPath, 'utf8').catch(() => null);
      chapterFileCache.set(chapterKey, chapterText);
    }

    const fullChapterText = chapterFileCache.get(chapterKey);
    const content = typeof fullChapterText === 'string'
      ? extractScriptContent(fullChapterText, script.id)
      : null;

    if (content === null) {
      missingScripts.push(script);
    }

    const safeContent = content || '';
    const { keywords } = extractRecordSignals(safeContent);
    const categoryName = categoryNames[script.categoryKey] || script.categoryKey;
    const locationLabel = `${categoryName} / ${script.title}${script.subTitle ? ` - ${script.subTitle}` : ''} (\`${script.id}\`)`;

    for (const keyword of keywords) {
      if (!keywordMap.has(keyword)) {
        keywordMap.set(keyword, []);
      }

      const locations = keywordMap.get(keyword);
      if (!locations.includes(locationLabel)) {
        locations.push(locationLabel);
      }
    }

    recordsByGroup.get(group.key).push(formatScriptRecord(script, content));
    includedScripts.push(script);
  }

  const generatedFiles = [];

  for (const group of exportGroups) {
    const records = recordsByGroup.get(group.key) || [];
    if (records.length === 0) {
      continue;
    }

    const chunks = createChunks(records);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunkRecords = chunks[chunkIndex];
      const fileName = chunks.length > 1
        ? `${group.fileBase}_part_${String(chunkIndex + 1).padStart(2, '0')}.md`
        : `${group.fileBase}.md`;
      const content = [
        formatChunkHeader(group, chunkIndex + 1, chunks.length),
        ...chunkRecords,
      ].join('\n');

      generatedFiles.push(await writeTextFile(fileName, content, chunkRecords.length));
    }
  }

  const indexFile = await writeTextFile(
    'index_aliases_glossary.md',
    formatIndex(includedScripts, generatedFiles),
    includedScripts.length,
  );
  const keywordIndexFile = await writeTextFile(
    'keyword_occurrence_index.md',
    formatKeywordIndex(keywordMap),
    keywordMap.size,
  );
  const readmeFile = await writeTextFile(
    '00_notebooklm_readme.md',
    formatReadme([indexFile, keywordIndexFile, ...generatedFiles]),
    generatedFiles.reduce((sum, file) => sum + file.recordCount, 0),
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputDir,
    maxBytesPerContentFile,
    files: [readmeFile, indexFile, keywordIndexFile, ...generatedFiles],
    missingScripts: missingScripts.map((script) => ({
      id: script.id,
      title: script.title,
      subTitle: script.subTitle,
      categoryKey: script.categoryKey,
      mainChapterFile: script.mainChapterFile,
    })),
  };

  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`Generated ${manifest.files.length} markdown files in ${outputDir}`);
  console.log(`Included ${includedScripts.length} script records.`);
  if (missingScripts.length > 0) {
    console.warn(`Missing content for ${missingScripts.length} script records. See manifest.json.`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
