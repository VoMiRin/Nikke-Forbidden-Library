// 장면별 화자 색(data/speakerSceneColors.json)을 만든다. 계산 규칙은 speakerSceneColors.mjs에 있다.
// 사용법: node scripts/buildSpeakerSceneColors.mjs <개인 프로젝트 폴더>
//
// <개인 프로젝트 폴더> 아래에서 다음을 읽는다.
// - 니케 static data/csv: 원본 대사 테이블(메인·서브퀘·돌발, 이벤트, 사이드, 인연)과 ScenarioCharacterSettingTable
// - script_datamine/csv_output/Locale_*/Locale_*.csv: 대사·화자 이름 로케일(대본 변환기와 같은 파일)
// - 분석용폴더/SpeakerColorAnalysis/모든_화자_색상_통합목록.md: 화자 ID별 인게임 색
// 결과 파일은 커밋하고, buildSearchAssets.mjs가 script-manifest.json의 장면 항목에 붙인다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitScriptBlocks } from '../lib/scriptBlocks.mjs';
import { baseColorByName, colorBySpeakerId, readSpeakerColorRows } from './speakerColorTable.mjs';
import { normalizeDialogueKey, parseDialogueLines, resolveSceneColors } from './speakerSceneColors.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_ROOT = path.join(REPO_ROOT, 'public', 'scripts');
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'speakerSceneColors.json');
const DIALOG_TABLE_DIRS = [
  'ScenarioDialogTable',
  'EventScenarioDialogTable',
  'SideStoryScenarioDialogTable',
  'AttractiveScenarioDialogTable',
];

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('사용법: node scripts/buildSpeakerSceneColors.mjs <개인 프로젝트 폴더>');
  process.exit(1);
}
const tableRoot = path.join(projectRoot, '니케 static data', 'csv');
const localeRoot = path.join(projectRoot, 'script_datamine', 'csv_output');
const colorListPath = path.join(projectRoot, '분석용폴더', 'SpeakerColorAnalysis', '모든_화자_색상_통합목록.md');

/** RFC 4180 CSV(따옴표 안 쉼표·줄바꿈 포함)를 머리줄 기준 객체 목록으로 읽는다. */
const readCsv = (filePath) => {
  const text = readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { record.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field); field = '';
      records.push(record); record = [];
    } else field += char;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const [header, ...rows] = records;
  return rows
    .filter(row => row.length > 1 || row[0])
    .map(row => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])));
};

const localeCache = new Map();
const localeText = (table, key) => {
  if (!localeCache.has(table)) {
    const filePath = path.join(localeRoot, table, `${table}.csv`);
    let entries = new Map();
    try {
      entries = new Map(readCsv(filePath).map(row => [row.Key, row.ko]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    localeCache.set(table, entries);
  }
  return localeCache.get(table).get(key);
};

// 화자 ID → 표시 이름
const speakerNames = new Map();
for (const row of readCsv(path.join(tableRoot, 'Data', 'ScenarioCharacterSettingTable.csv'))) {
  const name = localeText('Locale_Character', row.name_localkey.replace(/^Locale_Character:/, ''));
  if (name) speakerNames.set(row.id, name);
}

// 정규화한 원본 문장 → 후보(화자 ID, 원본 그룹)
const candidates = new Map();
let tableRows = 0;
for (const dir of DIALOG_TABLE_DIRS) {
  for (const file of readdirSync(path.join(tableRoot, dir)).filter(name => name.endsWith('.csv')).sort()) {
    for (const row of readCsv(path.join(tableRoot, dir, file))) {
      const speakerId = (row.speaker ?? '').trim();
      const localeKey = (row.scenario_localkey ?? '').trim();
      const separator = localeKey.indexOf(':');
      if (!speakerId || separator < 0) continue;
      const text = localeText(localeKey.slice(0, separator), localeKey.slice(separator + 1));
      if (!text) continue;
      tableRows += 1;
      const key = normalizeDialogueKey(text);
      if (!candidates.has(key)) candidates.set(key, new Map());
      candidates.get(key).set(`${speakerId}\u0000${row.group_id}`, { speakerId, group: row.group_id });
    }
  }
}

const colorRows = readSpeakerColorRows(readFileSync(colorListPath, 'utf8'));
const speakerColors = colorBySpeakerId(colorRows);
const defaultColors = baseColorByName(colorRows);
const source = {
  candidatesFor: key => candidates.get(key)?.values(),
  nameOf: speakerId => speakerNames.get(speakerId),
  colorOf: speakerId => speakerColors.get(speakerId),
  defaultColorOf: name => defaultColors.get(name),
};

const listTextFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) return listTextFiles(fullPath);
  return entry.name.endsWith('.txt') ? [fullPath] : [];
});

const output = {};
const totals = { lines: 0, matched: 0, resolved: 0, ambiguous: 0, scenes: 0, sceneNames: 0, lineOverrides: 0 };
for (const filePath of listTextFiles(SCRIPTS_ROOT).sort()) {
  const categoryKey = path.relative(SCRIPTS_ROOT, filePath).split(path.sep)[0];
  for (const [scriptId, content] of splitScriptBlocks(readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n'))) {
    const { result, stats } = resolveSceneColors(parseDialogueLines(content), source);
    for (const key of ['lines', 'matched', 'resolved', 'ambiguous']) totals[key] += stats[key];
    if (!result) continue;
    output[`${categoryKey}/${scriptId}`] = result;
    totals.scenes += 1;
    totals.sceneNames += Object.keys(result.names ?? {}).length;
    totals.lineOverrides += Object.values(result.lines ?? {}).reduce((sum, byText) => sum + Object.keys(byText).length, 0);
  }
}

const sorted = Object.fromEntries(Object.entries(output).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(OUTPUT_PATH, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`원본 대사 ${tableRows}줄, 대본 대사 ${totals.lines}줄 중 원본과 맞은 줄 ${totals.matched}, 색이 정해진 줄 ${totals.resolved}, 후보 색이 갈려 기본색에 맡긴 줄 ${totals.ambiguous}.`);
console.log(`장면 ${totals.scenes}개에 장면 색 ${totals.sceneNames}개, 줄 색 ${totals.lineOverrides}개를 ${OUTPUT_PATH}에 썼습니다.`);
