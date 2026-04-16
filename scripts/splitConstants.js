// Script to split constants.ts into separate category files
const fs = require('fs');
const path = require('path');

const constantsPath = process.argv[2] || 'constants.ts';
const dataDir = './data';

// Read the constants file
const content = fs.readFileSync(constantsPath, 'utf8');

// Extract the MOCK_SCRIPTS array content
const mockScriptsMatch = content.match(/export\s+const\s+MOCK_SCRIPTS[^=]*=\s*\[([\s\S]*?)\n\];/);
if (!mockScriptsMatch) {
    console.error('Could not find MOCK_SCRIPTS array');
    process.exit(1);
}

const scriptsContent = mockScriptsMatch[1];

// Extract createLoadContentFn (lines 60-115 approximately)
const createLoadContentFnMatch = content.match(/(\/\/ Module-level cache[\s\S]*?const createLoadContentFn[\s\S]*?^};?\n)/m);

// Parse individual script entries
const scriptEntries = [];
const scriptPattern = /\{ (?:id:|"id":)\s*['"]([^'"]+)['"],\s*(?:categoryKey:|"categoryKey":)\s*['"]([^'"]+)['"],\s*(?:title:|"title":)\s*['"]([^'"]+)['"],\s*(?:subTitle:|"subTitle":)\s*['"]([^'"]+)['"],\s*(?:mainChapterFile:|"mainChapterFile":)\s*['"]([^'"]+)['"][^}]*\}/g;

let match;
while ((match = scriptPattern.exec(scriptsContent)) !== null) {
    scriptEntries.push({
        id: match[1],
        categoryKey: match[2],
        title: match[3],
        subTitle: match[4].replace(/\\'/g, "'"),
        mainChapterFile: match[5]
    });
}

// Group by category
const categories = {};
scriptEntries.forEach(entry => {
    if (!categories[entry.categoryKey]) {
        categories[entry.categoryKey] = [];
    }
    categories[entry.categoryKey].push(entry);
});

console.log('Found categories:', Object.keys(categories));
console.log('Counts:', Object.entries(categories).map(([k, v]) => `${k}: ${v.length}`).join(', '));

// Create data directory if not exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Generate file for each category
const categoryFileMappings = {
    main_story: 'mainStoryScripts',
    event_stories: 'eventStoryScripts',
    side_stories: 'sideStoryScripts',
    sub_quests: 'subQuestScripts',
    character_episodes: 'characterEpisodeScripts',
    outpost_stories: 'outpostStoryScripts',
    lost_relics: 'lostRelicScripts',
    event_lost_relics: 'eventLostRelicScripts'
};

Object.entries(categories).forEach(([categoryKey, scripts]) => {
    const fileName = categoryFileMappings[categoryKey] || `${categoryKey}Scripts`;
    const exportName = fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/Scripts$/, '') + 'ScriptsData';

    const fileContent = `import type { ScriptData } from './scriptLoader';

/**
 * ${categoryKey} 스크립트 데이터
 * 총 ${scripts.length}개의 스크립트
 */
export const ${exportName}: ScriptData[] = [
${scripts.map(s => `  { id: '${s.id}', categoryKey: '${categoryKey}', title: '${s.title.replace(/'/g, "\\'")}', subTitle: '${s.subTitle.replace(/'/g, "\\'")}', mainChapterFile: '${s.mainChapterFile}' },`).join('\n')}
];
`;

    fs.writeFileSync(path.join(dataDir, `${fileName}.ts`), fileContent);
    console.log(`Created ${fileName}.ts with ${scripts.length} scripts`);
});

// Create index.ts that exports all scripts
const indexContent = `import { buildScripts } from './scriptLoader';
import type { Script } from '../types';

${Object.entries(categoryFileMappings)
        .filter(([k]) => categories[k])
        .map(([k, v]) => {
            const exportName = v.charAt(0).toUpperCase() + v.slice(1).replace(/Scripts$/, '') + 'ScriptsData';
            return `import { ${exportName} } from './${v}';`;
        }).join('\n')}

/**
 * 모든 스크립트를 카테고리에서 가져와 결합합니다.
 */
export const getAllScripts = (): Script[] => {
  const allData = [
    ${Object.entries(categoryFileMappings)
        .filter(([k]) => categories[k])
        .map(([, v]) => {
            const exportName = v.charAt(0).toUpperCase() + v.slice(1).replace(/Scripts$/, '') + 'ScriptsData';
            return `...${exportName},`;
        }).join('\n    ')}
  ];
  
  return buildScripts(allData);
};

// For backward compatibility
export const MOCK_SCRIPTS = getAllScripts();
`;

fs.writeFileSync(path.join(dataDir, 'index.ts'), indexContent);
console.log('Created index.ts');

console.log('\nDone! Update constants.ts to import MOCK_SCRIPTS from ./data');
