#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = path.join(repoRoot, '.gemini-file-search-manifest.json');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
  }
}

function readArg(name, fallback) {
  const prefixed = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex !== -1) {
    return process.argv[directIndex + 1] ?? fallback;
  }

  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  return inline ? inline.slice(prefixed.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printHelp() {
  console.log([
    'Usage:',
    '  npm run gemini:file-search:sync -- [options]',
    '',
    'Options:',
    '  --store <name>        File Search store name. Defaults to GEMINI_FILE_SEARCH_STORE.',
    '  --manifest <path>     Sync manifest path. Defaults to .gemini-file-search-manifest.json.',
    '  --dry-run            Show planned changes without uploading or deleting.',
    '  --prune              Delete store documents for files removed locally, when known in the manifest.',
    '  --force              Reupload every local source file.',
    '  --limit <n>          Process only the first n changed/new files.',
    '  --concurrency <n>    Parallel uploads. Defaults to 2, max 10.',
    '  --key-index <n>      Use nth key if GEMINI_API_KEYS or GEMINI_API_KEY_n are set.',
    '  --help               Show this help.',
  ].join('\n'));
}

function isUsableApiKey(value) {
  return value && value !== 'PLACEHOLDER_API_KEY' && !value.includes('YOUR_');
}

function collectApiKeys() {
  const keys = [];
  const addKey = (value) => {
    const key = value?.trim();
    if (isUsableApiKey(key) && !keys.includes(key)) {
      keys.push(key);
    }
  };

  addKey(process.env.GEMINI_API_KEY);
  addKey(process.env.GOOGLE_API_KEY);

  for (const key of (process.env.GEMINI_API_KEYS ?? '').split(/[,\s]+/)) {
    addKey(key);
  }

  for (let index = 1; index <= 10; index += 1) {
    addKey(process.env[`GEMINI_API_KEY_${index}`]);
  }

  if (!keys.length) {
    throw new Error('Set GEMINI_API_KEY in your shell or .env.local before syncing File Search.');
  }

  const keyIndexText = readArg('--key-index', '1');
  const keyIndex = Number.parseInt(keyIndexText, 10);
  if (!Number.isInteger(keyIndex) || keyIndex < 1 || keyIndex > keys.length) {
    throw new Error(`Invalid --key-index ${keyIndexText}. Choose 1-${keys.length}.`);
  }

  console.log(`Using Gemini API key #${keyIndex} of ${keys.length}.`);
  return keys[keyIndex - 1];
}

function listFilesByExtension(directory, extensions) {
  if (!fs.existsSync(directory)) return [];

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesByExtension(entryPath, extensions));
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function hashFile(absolutePath) {
  return createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function getSourceKind(relativePath) {
  if (relativePath.startsWith('public/scripts/')) return 'script-text';
  if (relativePath.startsWith('data/new_scripts/')) return 'script-metadata';
  return 'source';
}

function collectSourceFiles() {
  const scriptsRoot = path.join(repoRoot, 'public', 'scripts');
  const metadataRoot = path.join(repoRoot, 'data', 'new_scripts');
  const absolutePaths = [
    ...listFilesByExtension(scriptsRoot, ['.txt']),
    ...listFilesByExtension(metadataRoot, ['.ts']),
  ];

  const files = absolutePaths.map((absolutePath) => {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    const stats = fs.statSync(absolutePath);

    return {
      absolutePath,
      relativePath,
      displayName: relativePath.replace(/\//g, '__'),
      sizeBytes: stats.size,
      sizeKb: Math.round(stats.size / 1024),
      hash: hashFile(absolutePath),
      mimeType: 'text/plain',
      sourceKind: getSourceKind(relativePath),
    };
  });

  return {
    files: files.filter((file) => file.sizeBytes > 0),
    skippedEmptyFiles: files.filter((file) => file.sizeBytes === 0),
  };
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, storeName: '', files: {} };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    version: 1,
    storeName: manifest.storeName ?? '',
    updatedAt: manifest.updatedAt,
    files: manifest.files ?? {},
  };
}

function writeManifest(manifestPath, manifest) {
  const orderedFiles = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))
  );
  const nextManifest = {
    version: 1,
    storeName: manifest.storeName,
    updatedAt: new Date().toISOString(),
    files: orderedFiles,
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
}

function getMetadataValue(document, key) {
  for (const metadata of document.customMetadata ?? []) {
    if (metadata.key !== key) continue;

    if (metadata.stringValue !== undefined) return metadata.stringValue;
    if (metadata.numericValue !== undefined) return String(metadata.numericValue);
    if (metadata.stringListValue?.values?.length) return metadata.stringListValue.values[0];
  }

  return null;
}

async function listStoreDocuments(ai, storeName) {
  const pager = await ai.fileSearchStores.documents.list({ parent: storeName });
  const documents = [];

  for await (const document of pager) {
    documents.push(document);
  }

  return documents;
}

function indexRemoteDocuments(documents, sourceFiles) {
  const displayNameToRelativePath = new Map(sourceFiles.map((file) => [file.displayName, file.relativePath]));
  const byRelativePath = new Map();

  for (const document of documents) {
    const metadataRelativePath = getMetadataValue(document, 'relativePath');
    const relativePath = metadataRelativePath || displayNameToRelativePath.get(document.displayName);
    if (!relativePath) continue;

    const matches = byRelativePath.get(relativePath) ?? [];
    matches.push(document);
    byRelativePath.set(relativePath, matches);
  }

  return byRelativePath;
}

function getKnownDocumentNames(relativePath, manifestEntry, remoteDocumentsByPath) {
  const names = new Set();

  if (manifestEntry?.documentName) {
    names.add(manifestEntry.documentName);
  }

  for (const document of remoteDocumentsByPath.get(relativePath) ?? []) {
    if (document.name) {
      names.add(document.name);
    }
  }

  return Array.from(names);
}

function makeAsciiFileName(relativePath, index) {
  const extension = path.extname(relativePath) || '.txt';
  const hash = createHash('sha1').update(relativePath).digest('hex').slice(0, 12);
  return `${String(index + 1).padStart(6, '0')}-${hash}${extension}`;
}

function prepareUploadFile(sourceFile, index, tempDir) {
  if (/^[\x00-\x7F]+$/.test(path.basename(sourceFile.absolutePath))) {
    return sourceFile.absolutePath;
  }

  const uploadPath = path.join(tempDir, makeAsciiFileName(sourceFile.relativePath, index));
  fs.copyFileSync(sourceFile.absolutePath, uploadPath);
  return uploadPath;
}

async function waitForOperation(ai, operation) {
  let current = operation;
  let attempts = 0;

  while (!current.done) {
    attempts += 1;
    process.stdout.write(`Indexing still running... ${attempts * 5}s\n`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = await ai.operations.get({ operation: current });
  }

  return current;
}

async function deleteDocument(ai, documentName, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] Would delete ${documentName}`);
    return;
  }

  console.log(`Deleting ${documentName}`);
  try {
    await ai.fileSearchStores.documents.delete({
      name: documentName,
      config: { force: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404|not found|NOT_FOUND/i.test(message)) {
      console.warn(`Document was already missing: ${documentName}`);
      return;
    }

    throw error;
  }
}

async function uploadSourceFile(ai, storeName, sourceFile, index, total, tempDir, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] Would upload ${sourceFile.relativePath} (${sourceFile.sizeKb} KB)`);
    return null;
  }

  console.log(`[${index}/${total}] Uploading ${sourceFile.relativePath} (${sourceFile.sizeKb} KB)`);
  const uploadPath = prepareUploadFile(sourceFile, index, tempDir);
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: uploadPath,
    fileSearchStoreName: storeName,
    config: {
      displayName: sourceFile.displayName,
      mimeType: sourceFile.mimeType,
      customMetadata: [
        { key: 'relativePath', stringValue: sourceFile.relativePath },
        { key: 'sha256', stringValue: sourceFile.hash },
        { key: 'sourceKind', stringValue: sourceFile.sourceKind },
      ],
      chunkingConfig: {
        whiteSpaceConfig: {
          maxTokensPerChunk: 400,
          maxOverlapTokens: 40,
        },
      },
    },
  });

  operation = await waitForOperation(ai, operation);
  if (operation.error) {
    throw new Error(`Indexing failed for ${sourceFile.relativePath}: ${JSON.stringify(operation.error)}`);
  }

  const documentName = operation.response?.documentName;
  if (!documentName) {
    throw new Error(`Upload completed without a document name for ${sourceFile.relativePath}.`);
  }

  return documentName;
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  let firstError = null;

  async function runWorker() {
    while (!firstError && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError = error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (firstError) {
    throw firstError;
  }
}

function summarizePlan(plan, skippedEmptyFiles) {
  console.log([
    `Source files: ${plan.totalSourceCount}`,
    `Skipped empty files: ${skippedEmptyFiles.length}`,
    `Adopt unchanged remote docs: ${plan.adopt.length}`,
    `Upload new files: ${plan.uploadNew.length}`,
    `Reupload changed files: ${plan.reuploadChanged.length}`,
    `Reupload forced files: ${plan.reuploadForced.length}`,
    `Delete removed files: ${plan.deleteRemoved.length}`,
  ].join('\n'));
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  loadEnvFile(path.join(repoRoot, '.env.local'));
  loadEnvFile(path.join(repoRoot, '.env'));

  const storeName = readArg('--store', process.env.GEMINI_FILE_SEARCH_STORE ?? '').trim();
  const manifestPath = path.resolve(repoRoot, readArg('--manifest', defaultManifestPath));
  const dryRun = hasFlag('--dry-run');
  const prune = hasFlag('--prune');
  const force = hasFlag('--force');
  const limitText = readArg('--limit', '');
  const concurrencyText = readArg('--concurrency', '2');
  const concurrency = Number.parseInt(concurrencyText, 10);

  if (!storeName) {
    throw new Error('Set GEMINI_FILE_SEARCH_STORE in .env.local or pass --store fileSearchStores/...');
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error(`Invalid --concurrency ${concurrencyText}. Choose 1-10.`);
  }

  const limit = limitText ? Number.parseInt(limitText, 10) : null;
  if (limitText && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`Invalid --limit ${limitText}.`);
  }

  const apiKey = collectApiKeys();
  const ai = new GoogleGenAI({ apiKey });
  const { files: sourceFiles, skippedEmptyFiles } = collectSourceFiles();
  const sourceByPath = new Map(sourceFiles.map((file) => [file.relativePath, file]));
  const manifest = readManifest(manifestPath);

  console.log(`Using store: ${storeName}`);
  console.log(`Using manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log('Listing remote File Search documents...');
  const remoteDocuments = await listStoreDocuments(ai, storeName);
  const remoteDocumentsByPath = indexRemoteDocuments(remoteDocuments, sourceFiles);

  const plan = {
    totalSourceCount: sourceFiles.length,
    adopt: [],
    uploadNew: [],
    reuploadChanged: [],
    reuploadForced: [],
    deleteRemoved: [],
  };

  for (const sourceFile of sourceFiles) {
    const manifestEntry = manifest.files[sourceFile.relativePath];
    const remoteMatches = remoteDocumentsByPath.get(sourceFile.relativePath) ?? [];
    const primaryRemote = remoteMatches[0];

    if (force) {
      plan.reuploadForced.push({ sourceFile, documentNames: getKnownDocumentNames(sourceFile.relativePath, manifestEntry, remoteDocumentsByPath) });
      continue;
    }

    if (manifestEntry?.hash === sourceFile.hash && getKnownDocumentNames(sourceFile.relativePath, manifestEntry, remoteDocumentsByPath).length) {
      continue;
    }

    if (!manifestEntry && primaryRemote) {
      plan.adopt.push({ sourceFile, document: primaryRemote });
      continue;
    }

    if (manifestEntry && manifestEntry.hash !== sourceFile.hash) {
      plan.reuploadChanged.push({ sourceFile, documentNames: getKnownDocumentNames(sourceFile.relativePath, manifestEntry, remoteDocumentsByPath) });
      continue;
    }

    plan.uploadNew.push({ sourceFile, documentNames: [] });
  }

  if (prune) {
    for (const [relativePath, manifestEntry] of Object.entries(manifest.files)) {
      if (sourceByPath.has(relativePath)) continue;
      if (!manifestEntry.documentName) continue;
      plan.deleteRemoved.push({ relativePath, documentName: manifestEntry.documentName });
    }
  }

  let uploadActions = [
    ...plan.reuploadChanged,
    ...plan.reuploadForced,
    ...plan.uploadNew,
  ];

  if (limit !== null) {
    uploadActions = uploadActions.slice(0, limit);
  }

  summarizePlan(plan, skippedEmptyFiles);
  if (limit !== null) {
    console.log(`Upload action limit: ${uploadActions.length}/${plan.reuploadChanged.length + plan.reuploadForced.length + plan.uploadNew.length}`);
  }

  if (!prune && Object.entries(manifest.files).some(([relativePath]) => !sourceByPath.has(relativePath))) {
    console.log('Removed local files were found in the manifest. Pass --prune to delete their known remote documents.');
  }

  if (dryRun) {
    for (const entry of plan.adopt) {
      console.log(`[dry-run] Would adopt ${entry.sourceFile.relativePath} -> ${entry.document.name}`);
    }
    for (const entry of uploadActions) {
      if (entry.documentNames?.length) {
        console.log(`[dry-run] Would delete ${entry.documentNames.length} existing document(s) for ${entry.sourceFile.relativePath}`);
      }
      console.log(`[dry-run] Would upload ${entry.sourceFile.relativePath}`);
    }
    for (const entry of plan.deleteRemoved) {
      console.log(`[dry-run] Would delete removed ${entry.relativePath} -> ${entry.documentName}`);
    }
    console.log('Dry run complete. No remote documents or manifest were changed.');
    return;
  }

  for (const entry of plan.adopt) {
    manifest.files[entry.sourceFile.relativePath] = {
      hash: entry.sourceFile.hash,
      sizeBytes: entry.sourceFile.sizeBytes,
      displayName: entry.sourceFile.displayName,
      documentName: entry.document.name,
      sourceKind: entry.sourceFile.sourceKind,
      adoptedAt: new Date().toISOString(),
    };
  }

  for (const entry of plan.deleteRemoved) {
    await deleteDocument(ai, entry.documentName, false);
    delete manifest.files[entry.relativePath];
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-file-search-sync-'));
  try {
    await runWithConcurrency(uploadActions, concurrency, async (entry, index) => {
      for (const documentName of entry.documentNames ?? []) {
        await deleteDocument(ai, documentName, false);
      }

      const documentName = await uploadSourceFile(
        ai,
        storeName,
        entry.sourceFile,
        index + 1,
        uploadActions.length,
        tempDir,
        false
      );

      manifest.files[entry.sourceFile.relativePath] = {
        hash: entry.sourceFile.hash,
        sizeBytes: entry.sourceFile.sizeBytes,
        displayName: entry.sourceFile.displayName,
        documentName,
        sourceKind: entry.sourceFile.sourceKind,
        uploadedAt: new Date().toISOString(),
      };
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  manifest.storeName = storeName;
  writeManifest(manifestPath, manifest);
  console.log(`Sync complete. Manifest updated: ${path.relative(repoRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error('\nGemini File Search sync failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
