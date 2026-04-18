import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const generatedDir = path.join(rootDir, '.generated-search-assets');
const publicDir = path.join(rootDir, 'public');
const scriptsRootDir = path.join(publicDir, 'scripts');

const ensureGeneratedPackage = async () => {
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(
    path.join(generatedDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2),
    'utf8'
  );
};

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

const buildPreviewText = (content, options = {}) => {
  const documentStyleMode = typeof options.isDocumentStyleCategory === 'function'
    ? options.isDocumentStyleCategory(options.categoryKey)
    : false;
  const previewChunks = [];
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line === '---' || line.startsWith('@@@')) {
      continue;
    }

    if (line.startsWith('[CHOICE_START]') || line.startsWith('[CHOICE_END]') || line.startsWith('[OPTION_END]')) {
      continue;
    }

    const optionMatch = line.match(/^\[OPTION TEXT="(.+?)"\]$/i);
    if (optionMatch) {
      previewChunks.push(optionMatch[1]);
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      continue;
    }

    const actionDialogueMatch = line.match(/^([^\[]+)\[ACTION\]:\s*(.*)$/i);
    if (actionDialogueMatch?.[2]) {
      previewChunks.push(actionDialogueMatch[2].trim());
      continue;
    }

    const dialogueMatch = documentStyleMode ? null : line.match(/^([^:]+):\s*(.*)$/);
    if (dialogueMatch?.[2]) {
      previewChunks.push(dialogueMatch[2].trim());
      continue;
    }

    const parentheticalMatch = line.match(/^\((.*)\)$/);
    if (parentheticalMatch?.[1]) {
      previewChunks.push(parentheticalMatch[1].trim());
      continue;
    }

    previewChunks.push(line);
  }

  return previewChunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);
};

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const buildContentVersion = (content) => (
  crypto.createHash('sha256').update(content).digest('hex').slice(0, 12)
);

const main = async () => {
  await ensureGeneratedPackage();

  const require = createRequire(import.meta.url);
  const { newScriptsData } = require(path.join(generatedDir, 'data', 'newScripts.js'));
  const { extractTextFromScriptContent, isDocumentStyleCategory } = require(path.join(generatedDir, 'utils.js'));
  const chapterVersionCache = new Map();

  const chapterFileCache = new Map();
  const searchIndex = [];

  for (const script of newScriptsData) {
    const chapterKey = `${script.categoryKey}/${script.mainChapterFile}`;

    if (!chapterFileCache.has(chapterKey)) {
      const chapterPath = path.join(scriptsRootDir, script.categoryKey, script.mainChapterFile);
      try {
        const chapterFileContents = await fs.readFile(chapterPath, 'utf8');
        chapterFileCache.set(chapterKey, chapterFileContents);
        chapterVersionCache.set(chapterKey, buildContentVersion(chapterFileContents));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping searchable content for "${script.id}" because ${chapterPath} could not be read: ${message}`);
        chapterFileCache.set(chapterKey, null);
        chapterVersionCache.set(chapterKey, undefined);
      }
    }

    const fullChapterText = chapterFileCache.get(chapterKey);
    const content = typeof fullChapterText === 'string'
      ? extractScriptContent(fullChapterText, script.id)
      : '';

    if (typeof fullChapterText === 'string' && content === null) {
      console.warn(`Skipping searchable content for "${script.id}" because its block was not found in ${chapterKey}.`);
    }

    const safeContent = typeof content === 'string' ? content : '';
    const { content: searchableContent, speakers: searchableSpeakers } = extractTextFromScriptContent(safeContent, {
      categoryKey: script.categoryKey,
    });

    searchIndex.push({
      id: script.id,
      title: script.title,
      categoryKey: script.categoryKey,
      subTitle: script.subTitle,
      mainChapterFile: script.mainChapterFile,
      searchableContent,
      searchableSpeakers,
      snippet: safeContent ? buildPreviewText(safeContent, {
        categoryKey: script.categoryKey,
        isDocumentStyleCategory,
      }) : '',
    });
  }

  const manifest = newScriptsData.map(({ id, title, categoryKey, subTitle, mainChapterFile }) => ({
    id,
    title,
    categoryKey,
    subTitle,
    mainChapterFile,
    mainChapterVersion: chapterVersionCache.get(`${categoryKey}/${mainChapterFile}`),
  }));

  await writeJson(path.join(publicDir, 'script-manifest.json'), manifest);
  await writeJson(path.join(publicDir, 'search-index.json'), searchIndex);
  await writeJson(path.join(publicDir, 'app-version.json'), {
    version: new Date().toISOString(),
  });

  const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
  const searchIndexBytes = Buffer.byteLength(JSON.stringify(searchIndex));

  console.log(
    `Generated ${manifest.length} manifest entries (${(manifestBytes / 1024).toFixed(1)} kB) and ${searchIndex.length} search documents (${(searchIndexBytes / 1024 / 1024).toFixed(2)} MB).`
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
