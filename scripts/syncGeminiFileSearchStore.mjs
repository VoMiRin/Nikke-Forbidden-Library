#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
    '  --start-at <path>    Start at this upload action path (inclusive).',
    '  --only <path>        Process exactly one upload action path.',
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
    return {
      exists: false,
      manifest: { version: 1, storeName: '', files: {} },
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    exists: true,
    manifest: {
      version: 1,
      storeName: manifest.storeName ?? '',
      updatedAt: manifest.updatedAt,
      files: manifest.files ?? {},
    },
  };
}

function getManifestCore(manifest) {
  const orderedFiles = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    version: 1,
    storeName: manifest.storeName,
    files: orderedFiles,
  };
}

function writeManifestIfChanged(
  manifestPath,
  manifest,
  now = () => new Date(),
  fileSystem = fs
) {
  const nextCore = getManifestCore(manifest);
  let previousCore = null;

  if (fileSystem.existsSync(manifestPath)) {
    const previousManifest = JSON.parse(fileSystem.readFileSync(manifestPath, 'utf8'));
    previousCore = getManifestCore({
      storeName: previousManifest.storeName ?? '',
      files: previousManifest.files ?? {},
    });
  }

  if (previousCore && JSON.stringify(previousCore) === JSON.stringify(nextCore)) {
    return false;
  }

  const nextManifest = {
    version: nextCore.version,
    storeName: nextCore.storeName,
    updatedAt: now().toISOString(),
    files: nextCore.files,
  };
  const manifestDirectory = path.dirname(manifestPath);
  const manifestBaseName = path.basename(manifestPath);
  const tempPath = path.join(
    manifestDirectory,
    `.${manifestBaseName}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    fileSystem.writeFileSync(tempPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fileSystem.renameSync(tempPath, manifestPath);
  } finally {
    fileSystem.rmSync(tempPath, { force: true });
  }

  return true;
}

function assertManifestStore(manifestExists, manifest, storeName, manifestPath) {
  if (!manifestExists) return;
  if (manifest.storeName === storeName) return;

  throw new Error([
    `Manifest store mismatch in ${manifestPath}.`,
    `Manifest store: ${manifest.storeName || '(empty)'}`,
    `Configured store: ${storeName}`,
    'Refusing to reuse document IDs from another store. Back up or remove the manifest only when intentionally bootstrapping the configured store.',
  ].join(' '));
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

function isActiveRemoteDocument(document) {
  return document.state === 'STATE_ACTIVE';
}

function isFailedRemoteDocument(document) {
  return document.state === 'STATE_FAILED';
}

async function waitForDocumentReady(
  ai,
  documentName,
  {
    allowFailed = false,
    maxAttempts = 120,
    pollIntervalMs = 5000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let document;

    try {
      document = await ai.fileSearchStores.documents.get({ name: documentName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isEventuallyConsistentNotFound = /404|not found|NOT_FOUND/i.test(message);
      if (!isEventuallyConsistentNotFound || attempt === maxAttempts) {
        throw error;
      }
    }

    if (document && isActiveRemoteDocument(document)) {
      return document;
    }

    if (document && isFailedRemoteDocument(document)) {
      if (allowFailed) return document;
      throw new Error(`File Search document indexing failed: ${documentName}`);
    }

    if (attempt === maxAttempts) {
      const state = document?.state ?? 'not visible';
      throw new Error(
        `Timed out waiting for File Search document ${documentName} to become active (last state: ${state}).`
      );
    }

    const state = document?.state ?? 'not visible';
    console.log(
      `Waiting for File Search document to become active (${attempt * pollIntervalMs / 1000}s, state: ${state})...`
    );
    await sleep(pollIntervalMs);
  }

  throw new Error(`Unable to verify File Search document state: ${documentName}`);
}

async function listStoreDocuments(ai, storeName) {
  const pager = await ai.fileSearchStores.documents.list({
    parent: storeName,
    config: { pageSize: 20 },
  });
  const documents = [];

  for await (const document of pager) {
    documents.push(document);
  }

  return documents;
}

async function includeManifestDocuments(
  ai,
  manifest,
  remoteDocuments,
  { concurrency = 5 } = {}
) {
  const documentsByName = new Map(
    remoteDocuments
      .filter((document) => document.name)
      .map((document) => [document.name, document])
  );
  const missingDocumentNames = Array.from(new Set(
    Object.values(manifest.files)
      .map((entry) => entry.documentName)
      .filter((documentName) => documentName && !documentsByName.has(documentName))
  ));

  if (!missingDocumentNames.length) {
    return remoteDocuments;
  }

  console.log(
    `Verifying ${missingDocumentNames.length} manifest document(s) not returned by the list API...`
  );
  await runWithConcurrency(missingDocumentNames, concurrency, async (documentName) => {
    try {
      const document = await ai.fileSearchStores.documents.get({ name: documentName });
      documentsByName.set(documentName, document);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/404|not found|NOT_FOUND/i.test(message)) {
        console.warn(`Manifest document is missing remotely: ${documentName}`);
        return;
      }

      throw error;
    }
  });

  return Array.from(documentsByName.values());
}

async function refreshUnsettledExactDocuments(
  ai,
  sourceFiles,
  manifest,
  remoteDocuments,
  options = {}
) {
  const { force = false, skipWait = false, ...waitOptions } = options;
  if (force || skipWait) return remoteDocuments;

  const remoteDocumentsByPath = indexRemoteDocuments(remoteDocuments, sourceFiles);
  const refreshedByName = new Map();

  for (const sourceFile of sourceFiles) {
    const manifestEntry = manifest.files[sourceFile.relativePath];
    const exactDocuments = (remoteDocumentsByPath.get(sourceFile.relativePath) ?? [])
      .filter((document) => document.name)
      .filter((document) => (
        getMetadataValue(document, 'sha256') === sourceFile.hash
        || (
          manifestEntry?.hash === sourceFile.hash
          && manifestEntry.documentName === document.name
        )
      ));

    if (exactDocuments.some(isActiveRemoteDocument)) {
      continue;
    }

    const unsettledDocuments = exactDocuments.filter((document) => (
      !isActiveRemoteDocument(document) && !isFailedRemoteDocument(document)
    ));
    const document = unsettledDocuments.find(
      (candidate) => candidate.name === manifestEntry?.documentName
    ) ?? unsettledDocuments[0];

    if (!document) continue;

    console.log(`Verifying unsettled File Search document: ${sourceFile.relativePath}`);
    refreshedByName.set(document.name, await waitForDocumentReady(
      ai,
      document.name,
      { ...waitOptions, allowFailed: true }
    ));
  }

  return remoteDocuments.map((document) => (
    refreshedByName.get(document.name) ?? document
  ));
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

function getKnownDocumentNames(relativePath, remoteDocumentsByPath) {
  const names = new Set();

  for (const document of remoteDocumentsByPath.get(relativePath) ?? []) {
    if (document.name) {
      names.add(document.name);
    }
  }

  return Array.from(names);
}

function buildSyncPlan({ sourceFiles, manifest, remoteDocuments, prune = false, force = false }) {
  const sourceByPath = new Map(sourceFiles.map((file) => [file.relativePath, file]));
  const remoteDocumentsByPath = indexRemoteDocuments(remoteDocuments, sourceFiles);
  const remoteDocumentsByName = new Map(
    remoteDocuments
      .filter((document) => document.name)
      .map((document) => [document.name, document])
  );
  const remotePathsByDocumentName = new Map();
  for (const [relativePath, documents] of remoteDocumentsByPath) {
    for (const document of documents) {
      if (document.name) {
        remotePathsByDocumentName.set(document.name, relativePath);
      }
    }
  }

  for (const [relativePath, manifestEntry] of Object.entries(manifest.files)) {
    if (!manifestEntry.documentName) continue;
    if (!remoteDocumentsByName.has(manifestEntry.documentName)) continue;

    const remoteRelativePath = remotePathsByDocumentName.get(manifestEntry.documentName);
    if (!remoteRelativePath) {
      throw new Error(
        `Cannot verify remote path for manifest document ${manifestEntry.documentName}. Refusing to mutate an unverified document.`
      );
    }
    if (remoteRelativePath !== relativePath) {
      throw new Error(
        `Manifest document path mismatch: ${manifestEntry.documentName} belongs to ${remoteRelativePath}, not ${relativePath}.`
      );
    }
  }

  const plan = {
    totalSourceCount: sourceFiles.length,
    adopt: [],
    uploadNew: [],
    reuploadChanged: [],
    reuploadForced: [],
    deleteDuplicates: [],
    deleteRemoved: [],
    removedLocalFiles: [],
  };

  for (const sourceFile of sourceFiles) {
    const manifestEntry = manifest.files[sourceFile.relativePath];
    const remoteMatches = remoteDocumentsByPath.get(sourceFile.relativePath) ?? [];
    const documentNames = getKnownDocumentNames(sourceFile.relativePath, remoteDocumentsByPath);
    const manifestRemote = manifestEntry?.documentName
      ? remoteMatches.find((document) => (
        document.name === manifestEntry.documentName && isActiveRemoteDocument(document)
      ))
      : null;

    if (force) {
      plan.reuploadForced.push({ sourceFile, documentNames });
      continue;
    }

    if (manifestEntry?.hash === sourceFile.hash && manifestRemote) {
      const duplicateDocumentNames = documentNames.filter((name) => name !== manifestRemote.name);
      if (duplicateDocumentNames.length) {
        plan.deleteDuplicates.push({
          relativePath: sourceFile.relativePath,
          documentNames: duplicateDocumentNames,
        });
      }
      continue;
    }

    const verifiedRemote = remoteMatches.find((document) => (
      document.name
      && isActiveRemoteDocument(document)
      && getMetadataValue(document, 'sha256') === sourceFile.hash
    ));

    if (verifiedRemote) {
      plan.adopt.push({
        sourceFile,
        document: verifiedRemote,
        duplicateDocumentNames: documentNames.filter((name) => name !== verifiedRemote.name),
      });
      continue;
    }

    if (manifestEntry || remoteMatches.length) {
      plan.reuploadChanged.push({ sourceFile, documentNames });
      continue;
    }

    plan.uploadNew.push({ sourceFile, documentNames: [] });
  }

  for (const [relativePath, manifestEntry] of Object.entries(manifest.files)) {
    if (sourceByPath.has(relativePath)) continue;
    plan.removedLocalFiles.push(relativePath);

    if (prune) {
      const documentNames = new Set();
      for (const document of remoteDocumentsByPath.get(relativePath) ?? []) {
        if (document.name) {
          documentNames.add(document.name);
        }
      }
      plan.deleteRemoved.push({
        relativePath,
        documentNames: Array.from(documentNames),
      });
    }
  }

  return plan;
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

async function waitForOperation(
  ai,
  operation,
  {
    maxAttempts = 120,
    pollIntervalMs = 5000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}
) {
  let current = operation;
  let attempts = 0;

  while (!current.done) {
    if (attempts >= maxAttempts) {
      throw new Error(
        `Timed out waiting for Gemini operation ${current.name ?? '(unknown)'} after ${maxAttempts * pollIntervalMs / 1000}s.`
      );
    }

    attempts += 1;
    process.stdout.write(`Indexing still running... ${attempts * pollIntervalMs / 1000}s\n`);
    await sleep(pollIntervalMs);
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

  await waitForDocumentReady(ai, documentName);

  return documentName;
}

async function uploadThenDeleteExisting({
  uploadDocument,
  onUploaded = async () => {},
  deleteDocumentByName,
  existingDocumentNames,
}) {
  const documentName = await uploadDocument();
  await onUploaded(documentName);

  for (const existingDocumentName of existingDocumentNames) {
    if (existingDocumentName === documentName) continue;
    await deleteDocumentByName(existingDocumentName);
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
  const duplicateDocumentCount = plan.adopt.reduce(
    (count, entry) => count + (entry.duplicateDocumentNames?.length ?? 0),
    plan.deleteDuplicates.reduce(
      (count, entry) => count + entry.documentNames.length,
      0
    )
  );
  console.log([
    `Source files: ${plan.totalSourceCount}`,
    `Skipped empty files: ${skippedEmptyFiles.length}`,
    `Adopt unchanged remote docs: ${plan.adopt.length}`,
    `Upload new files: ${plan.uploadNew.length}`,
    `Reupload changed files: ${plan.reuploadChanged.length}`,
    `Reupload forced files: ${plan.reuploadForced.length}`,
    `Delete duplicate documents: ${duplicateDocumentCount}`,
    `Delete removed files: ${plan.deleteRemoved.length}`,
  ].join('\n'));
}

function selectUploadActions(uploadActions, { startAt = '', only = '', limit = null } = {}) {
  if (startAt && only) {
    throw new Error('--start-at and --only cannot be used together.');
  }

  let selectedActions = uploadActions;

  if (only) {
    const action = uploadActions.find((entry) => entry.sourceFile.relativePath === only);
    if (!action) {
      throw new Error(`Upload action not found for --only ${only}.`);
    }
    selectedActions = [action];
  } else if (startAt) {
    const startIndex = uploadActions.findIndex(
      (entry) => entry.sourceFile.relativePath === startAt
    );
    if (startIndex === -1) {
      throw new Error(`Upload action not found for --start-at ${startAt}.`);
    }
    selectedActions = uploadActions.slice(startIndex);
  }

  if (limit !== null) {
    selectedActions = selectedActions.slice(0, limit);
  }

  return selectedActions;
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
  const startAt = readArg('--start-at', '').trim();
  const only = readArg('--only', '').trim();
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

  const { exists: manifestExists, manifest } = readManifest(manifestPath);

  assertManifestStore(
    manifestExists,
    manifest,
    storeName,
    path.relative(repoRoot, manifestPath)
  );

  const apiKey = collectApiKeys();
  const { files: sourceFiles, skippedEmptyFiles } = collectSourceFiles();
  const ai = new GoogleGenAI({ apiKey });

  console.log(`Using store: ${storeName}`);
  console.log(`Using manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log('Listing remote File Search documents...');
  let remoteDocuments = await listStoreDocuments(ai, storeName);
  remoteDocuments = await includeManifestDocuments(ai, manifest, remoteDocuments);
  remoteDocuments = await refreshUnsettledExactDocuments(
    ai,
    sourceFiles,
    manifest,
    remoteDocuments,
    { force, skipWait: dryRun }
  );
  const plan = buildSyncPlan({ sourceFiles, manifest, remoteDocuments, prune, force });

  const allUploadActions = [
    ...plan.reuploadChanged,
    ...plan.reuploadForced,
    ...plan.uploadNew,
  ];
  const uploadActions = selectUploadActions(allUploadActions, {
    startAt,
    only,
    limit,
  });

  summarizePlan(plan, skippedEmptyFiles);
  if (startAt || only || limit !== null) {
    console.log(`Selected upload actions: ${uploadActions.length}/${allUploadActions.length}`);
  }

  if (!prune && plan.removedLocalFiles.length) {
    console.log('Removed local files were found in the manifest. Pass --prune to delete their known remote documents.');
  }

  if (dryRun) {
    for (const entry of plan.adopt) {
      console.log(`[dry-run] Would adopt ${entry.sourceFile.relativePath} -> ${entry.document.name}`);
      for (const documentName of entry.duplicateDocumentNames ?? []) {
        console.log(`[dry-run] Would delete duplicate ${entry.sourceFile.relativePath} -> ${documentName}`);
      }
    }
    for (const entry of uploadActions) {
      console.log(`[dry-run] Would upload ${entry.sourceFile.relativePath}`);
      if (entry.documentNames?.length) {
        console.log(`[dry-run] Would then delete ${entry.documentNames.length} existing document(s) for ${entry.sourceFile.relativePath}`);
      }
    }
    for (const entry of plan.deleteDuplicates) {
      for (const documentName of entry.documentNames) {
        console.log(`[dry-run] Would delete duplicate ${entry.relativePath} -> ${documentName}`);
      }
    }
    for (const entry of plan.deleteRemoved) {
      for (const documentName of entry.documentNames) {
        console.log(`[dry-run] Would delete removed ${entry.relativePath} -> ${documentName}`);
      }
    }
    console.log('Dry run complete. No remote documents or manifest were changed.');
    return;
  }

  manifest.storeName = storeName;

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
  if (plan.adopt.length) {
    writeManifestIfChanged(manifestPath, manifest);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-file-search-sync-'));
  try {
    await runWithConcurrency(uploadActions, concurrency, async (entry, index) => {
      const documentName = await uploadThenDeleteExisting({
        uploadDocument: () => uploadSourceFile(
          ai,
          storeName,
          entry.sourceFile,
          index + 1,
          uploadActions.length,
          tempDir,
          false
        ),
        onUploaded: async (uploadedDocumentName) => {
          manifest.files[entry.sourceFile.relativePath] = {
            hash: entry.sourceFile.hash,
            sizeBytes: entry.sourceFile.sizeBytes,
            displayName: entry.sourceFile.displayName,
            documentName: uploadedDocumentName,
            sourceKind: entry.sourceFile.sourceKind,
            uploadedAt: new Date().toISOString(),
          };
          writeManifestIfChanged(manifestPath, manifest);
        },
        deleteDocumentByName: (existingDocumentName) => (
          deleteDocument(ai, existingDocumentName, false)
        ),
        existingDocumentNames: entry.documentNames ?? [],
      });
      if (manifest.files[entry.sourceFile.relativePath].documentName !== documentName) {
        throw new Error(`Manifest checkpoint failed for ${entry.sourceFile.relativePath}.`);
      }
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  for (const entry of plan.adopt) {
    for (const documentName of entry.duplicateDocumentNames ?? []) {
      await deleteDocument(ai, documentName, false);
    }
  }

  for (const entry of plan.deleteDuplicates) {
    for (const documentName of entry.documentNames) {
      await deleteDocument(ai, documentName, false);
    }
  }

  for (const entry of plan.deleteRemoved) {
    for (const documentName of entry.documentNames) {
      await deleteDocument(ai, documentName, false);
    }
    delete manifest.files[entry.relativePath];
    writeManifestIfChanged(manifestPath, manifest);
  }

  const manifestChanged = writeManifestIfChanged(manifestPath, manifest);
  console.log(
    manifestChanged
      ? `Sync complete. Manifest updated: ${path.relative(repoRoot, manifestPath)}`
      : `Sync complete. Manifest unchanged: ${path.relative(repoRoot, manifestPath)}`
  );
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error('\nGemini File Search sync failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  assertManifestStore,
  buildSyncPlan,
  getMetadataValue,
  includeManifestDocuments,
  listStoreDocuments,
  readManifest,
  refreshUnsettledExactDocuments,
  selectUploadActions,
  uploadThenDeleteExisting,
  waitForOperation,
  waitForDocumentReady,
  writeManifestIfChanged,
};
