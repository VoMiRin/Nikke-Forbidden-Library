import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRawScriptRecords } from './buildNotebookLmMarkdown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const scriptsRootDir = path.join(rootDir, 'public', 'scripts');
const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rootDir, 'custom_gpt_knowledge');

const listFiles = async (directory, relativeDirectory = '') => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push({ relativePath, fullPath });
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ko'));
};

const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const manifestPath = path.join(outputDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifestFileNames = manifest.files.map((file) => file.name).sort();
  const uploadFileNames = manifest.uploadFiles ?? [];
  const uploadFileSet = new Set(uploadFileNames);
  const supportFileSet = new Set(manifest.supportFiles ?? []);

  assertCondition(manifest.target === 'custom-gpt', 'Manifest target must be custom-gpt.');
  assertCondition(uploadFileSet.size === uploadFileNames.length, 'uploadFiles contains duplicates.');
  assertCondition(
    uploadFileNames.length <= Number.parseInt(process.env.CUSTOM_GPT_MAX_KNOWLEDGE_FILES || '20', 10),
    'uploadFiles exceeds the configured Custom GPT file maximum.',
  );
  assertCondition(
    uploadFileNames.every((fileName) => !supportFileSet.has(fileName)),
    'A support file was included in uploadFiles.',
  );

  const actualMarkdownFiles = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  assertCondition(
    JSON.stringify(actualMarkdownFiles) === JSON.stringify(manifestFileNames),
    'Generated Markdown files do not exactly match manifest.files.',
  );

  const generatedIds = [];
  const scriptIdMarker = '- 스크립트 ID: ';
  const markdownTick = String.fromCharCode(96);

  for (const file of manifest.files) {
    assertCondition(path.basename(file.name) === file.name, `Unsafe manifest file name: ${file.name}`);
    const filePath = path.join(outputDir, file.name);
    const contentBuffer = await fs.readFile(filePath);
    const actualHash = createHash('sha256').update(contentBuffer).digest('hex');
    assertCondition(contentBuffer.byteLength === file.bytes, `Byte count mismatch: ${file.name}`);
    assertCondition(actualHash === file.sha256, `SHA-256 mismatch: ${file.name}`);

    if (!uploadFileSet.has(file.name)) {
      continue;
    }

    assertCondition(
      contentBuffer.byteLength <= manifest.maxBytesPerContentFile,
      `Upload file exceeds byte limit: ${file.name}`,
    );
    const content = contentBuffer.toString('utf8');
    assertCondition(!content.includes('[본문 없음]'), `Upload file contains an empty body: ${file.name}`);

    for (const line of content.split(/\r?\n/)) {
      if (line.startsWith(scriptIdMarker)) {
        generatedIds.push(line.slice(scriptIdMarker.length).replaceAll(markdownTick, '').trim());
      }
    }
  }

  const rawIds = [];
  const emptySourceFiles = [];
  const sourceFiles = (await listFiles(scriptsRootDir))
    .filter((file) => file.relativePath.toLowerCase().endsWith('.txt'));

  for (const sourceFile of sourceFiles) {
    const content = await fs.readFile(sourceFile.fullPath, 'utf8');
    if (!content.trim()) {
      emptySourceFiles.push(sourceFile.relativePath);
      continue;
    }

    const records = parseRawScriptRecords(content, sourceFile.relativePath);
    for (const record of records) {
      assertCondition(record.content.trim(), `Raw script body is empty: ${record.id}`);
      rawIds.push(record.id);
    }
  }

  const rawIdSet = new Set(rawIds);
  const generatedIdSet = new Set(generatedIds);
  const missingIds = Array.from(rawIdSet).filter((id) => !generatedIdSet.has(id));
  const extraIds = Array.from(generatedIdSet).filter((id) => !rawIdSet.has(id));
  const uploadRecordCount = manifest.files
    .filter((file) => uploadFileSet.has(file.name))
    .reduce((sum, file) => sum + file.recordCount, 0);

  assertCondition(rawIdSet.size === rawIds.length, 'Raw script IDs are not globally unique.');
  assertCondition(generatedIdSet.size === generatedIds.length, 'Generated script IDs are not globally unique.');
  assertCondition(missingIds.length === 0, `Missing generated script IDs: ${missingIds.join(', ')}`);
  assertCondition(extraIds.length === 0, `Unexpected generated script IDs: ${extraIds.join(', ')}`);
  assertCondition(uploadRecordCount === generatedIds.length, 'Upload recordCount does not match rendered IDs.');
  assertCondition(manifest.includedScriptCount === generatedIds.length, 'Manifest script count mismatch.');
  assertCondition((manifest.missingScripts ?? []).length === 0, 'Manifest contains missing scripts.');
  assertCondition(
    manifest.sourceAudit.rawScriptRecordCount === rawIds.length,
    'Source audit raw script count mismatch.',
  );
  assertCondition(
    JSON.stringify([...emptySourceFiles].sort())
      === JSON.stringify([...(manifest.sourceAudit.skippedEmptySourceFiles ?? [])].sort()),
    'Source audit empty file list mismatch.',
  );

  console.log([
    'Custom GPT knowledge validation passed.',
    `Upload files: ${uploadFileNames.length}.`,
    `Script records: ${generatedIds.length}.`,
    `Empty source files skipped: ${emptySourceFiles.length}.`,
  ].join(' '));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
