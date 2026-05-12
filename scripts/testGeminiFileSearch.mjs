#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_FILE = 'public/scripts/event_stories/memories_teller.txt';
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_PROMPT = [
  '승리의 여신: 니케(NIKKE)의 MEMORIES TELLER 이벤트 스토리에서 핵심 갈등과 결말을 한국어로 짧게 요약해줘.',
  '원문 대사는 길게 인용하지 말고, 필요한 경우 아주 짧은 표현만 언급해줘.',
].join('\n');
const SYSTEM_INSTRUCTION = [
  'You answer questions about the GODDESS OF VICTORY: NIKKE script archive.',
  'Use only the attached File Search store as evidence.',
  'Do not answer from general model knowledge or from other games/franchises.',
  'If the File Search store does not contain relevant evidence, say that the archive did not return enough evidence.',
  'Keep direct quotations short.',
].join('\n');

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

    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
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

function installSigintCleanup(cleanup) {
  let isCleaningUp = false;

  process.on('SIGINT', async () => {
    if (isCleaningUp) {
      process.exit(130);
    }

    isCleaningUp = true;
    console.log('\nInterrupted. Cleaning up...');

    try {
      await cleanup();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }

    process.exit(130);
  });
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
    throw new Error('Set GEMINI_API_KEY in your shell or .env.local before running this test.');
  }

  const keyIndexText = readArg('--key-index', '1');
  const keyIndex = Number.parseInt(keyIndexText, 10);
  if (!Number.isInteger(keyIndex) || keyIndex < 1 || keyIndex > keys.length) {
    throw new Error(`Invalid --key-index ${keyIndexText}. Choose 1-${keys.length}.`);
  }

  console.log(`Using Gemini API key #${keyIndex} of ${keys.length}.`);
  return keys[keyIndex - 1];
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

async function uploadSourceFile(ai, fileSearchStoreName, sourceFile, index, total) {
  console.log(`[${index}/${total}] Uploading ${sourceFile.relativePath} (${sourceFile.sizeKb} KB)`);
  let operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: sourceFile.uploadPath ?? sourceFile.absolutePath,
    fileSearchStoreName,
    config: {
      displayName: sourceFile.displayName,
      mimeType: sourceFile.mimeType,
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
}

async function uploadSourceFiles(ai, fileSearchStoreName, sourceFiles, concurrency) {
  let nextIndex = 0;
  let firstError = null;

  async function worker() {
    while (!firstError && nextIndex < sourceFiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        await uploadSourceFile(ai, fileSearchStoreName, sourceFiles[index], index + 1, sourceFiles.length);
      } catch (error) {
        firstError = error;
      }
    }
  }

  const workerCount = Math.min(concurrency, sourceFiles.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError) {
    throw firstError;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorPayload(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);

  try {
    return JSON.parse(rawMessage);
  } catch {
    return { error: { message: rawMessage } };
  }
}

function isRetryableGenerateError(error) {
  const payload = parseErrorPayload(error);
  const code = payload?.error?.code;
  const status = payload?.error?.status;
  const message = payload?.error?.message ?? '';

  return code === 503 ||
    status === 'UNAVAILABLE' ||
    /high demand|try again later|unavailable|503/i.test(message);
}

async function generateContentWithRetry(ai, request, retryCount, retryDelayMs) {
  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (attempt > 0) {
        console.log(`Retrying generateContent (${attempt}/${retryCount})...`);
      }
      return await ai.models.generateContent(request);
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !isRetryableGenerateError(error)) {
        throw error;
      }

      const waitMs = retryDelayMs * (attempt + 1);
      console.log(`Gemini returned a retryable error. Waiting ${Math.round(waitMs / 1000)}s before retry...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

async function listStores(ai) {
  const stores = await ai.fileSearchStores.list();
  let count = 0;

  for await (const store of stores) {
    count += 1;
    console.log([
      store.name,
      store.displayName ? `displayName=${store.displayName}` : null,
      store.activeDocumentsCount ? `active=${store.activeDocumentsCount}` : null,
      store.pendingDocumentsCount ? `pending=${store.pendingDocumentsCount}` : null,
      store.failedDocumentsCount ? `failed=${store.failedDocumentsCount}` : null,
      store.sizeBytes ? `sizeBytes=${store.sizeBytes}` : null,
    ].filter(Boolean).join(' '));
  }

  if (!count) {
    console.log('No File Search stores found.');
  }
}

function resolveInputFile(inputPath) {
  const resolved = path.resolve(repoRoot, inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const stats = fs.statSync(resolved);
  if (!stats.isFile()) {
    throw new Error(`Input path is not a file: ${inputPath}`);
  }
  if (stats.size === 0) {
    throw new Error(`Input file is empty and cannot be uploaded to File Search: ${inputPath}`);
  }

  return {
    absolutePath: resolved,
    displayName: path.relative(repoRoot, resolved).split(path.sep).join('__'),
    relativePath: path.relative(repoRoot, resolved).split(path.sep).join('/'),
    sizeKb: Math.round(stats.size / 1024),
    mimeType: 'text/plain',
    sourceCount: 1,
  };
}

function makeAsciiFileName(relativePath, index) {
  const extension = path.extname(relativePath) || '.txt';
  const hash = createHash('sha1').update(relativePath).digest('hex').slice(0, 12);
  return `${String(index + 1).padStart(6, '0')}-${hash}${extension}`;
}

function prepareAsciiUploadCopies(sourceFiles) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-upload-files-'));

  return {
    tempDir,
    files: sourceFiles.map((sourceFile, index) => {
      const uploadPath = path.join(tempDir, makeAsciiFileName(sourceFile.relativePath, index));
      fs.copyFileSync(sourceFile.absolutePath, uploadPath);

      return {
        ...sourceFile,
        uploadPath,
      };
    }),
  };
}

function listFilesByExtension(directory, extensions) {
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

function buildAllScriptsBundle() {
  const { files: sourceFiles } = collectAllScriptSourceFiles();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-file-search-'));
  const bundlePath = path.join(tempDir, 'nikke-all-scripts.txt');
  const chunks = [];

  for (const sourceFile of sourceFiles) {
    const text = fs.readFileSync(sourceFile.absolutePath, 'utf8').trim();
    chunks.push([
      `===== SOURCE_FILE: ${sourceFile.relativePath} =====`,
      text,
      `===== END_SOURCE_FILE: ${sourceFile.relativePath} =====`,
    ].join('\n'));
  }

  fs.writeFileSync(bundlePath, `${chunks.join('\n\n')}\n`, 'utf8');
  const stats = fs.statSync(bundlePath);

  return {
    absolutePath: bundlePath,
    displayName: 'nikke-all-scripts.txt',
    relativePath: 'nikke-all-scripts.txt',
    mimeType: 'text/plain',
    sizeKb: Math.round(stats.size / 1024),
    sourceCount: sourceFiles.length,
    textFileCount: sourceFiles.filter((file) => file.relativePath.endsWith('.txt')).length,
    metadataFileCount: sourceFiles.filter((file) => file.relativePath.endsWith('.ts')).length,
    tempDir,
  };
}

function collectAllScriptSourceFiles() {
  const scriptsRoot = path.join(repoRoot, 'public', 'scripts');
  const metadataRoot = path.join(repoRoot, 'data', 'new_scripts');
  const absolutePaths = [
    ...listFilesByExtension(scriptsRoot, ['.txt']),
    ...listFilesByExtension(metadataRoot, ['.ts']),
  ];

  if (!absolutePaths.length) {
    throw new Error('No source files found under public/scripts or data/new_scripts.');
  }

  const files = absolutePaths.map((absolutePath) => {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    const stats = fs.statSync(absolutePath);

    return {
      absolutePath,
      relativePath,
      displayName: relativePath.replace(/\//g, '__'),
      sizeBytes: stats.size,
      sizeKb: Math.round(stats.size / 1024),
      mimeType: 'text/plain',
    };
  });

  return {
    files: files.filter((file) => file.sizeBytes > 0),
    skippedEmptyFiles: files.filter((file) => file.sizeBytes === 0),
  };
}

function summarizeSourceFiles(sourceFiles, skippedEmptyFiles = []) {
  const totalBytes = sourceFiles.reduce((sum, file) => sum + fs.statSync(file.absolutePath).size, 0);

  return {
    sourceCount: sourceFiles.length,
    textFileCount: sourceFiles.filter((file) => file.relativePath.endsWith('.txt')).length,
    metadataFileCount: sourceFiles.filter((file) => file.relativePath.endsWith('.ts')).length,
    skippedEmptyCount: skippedEmptyFiles.length,
    sizeKb: Math.round(totalBytes / 1024),
  };
}

function normalizeLocalPath(inputPath) {
  const windowsDriveMatch = inputPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (windowsDriveMatch && process.platform !== 'win32') {
    const [, driveLetter, rest] = windowsDriveMatch;
    return path.join('/mnt', driveLetter.toLowerCase(), ...rest.split(/[\\/]+/));
  }

  return path.resolve(repoRoot, inputPath);
}

function sanitizeFileBaseName(value) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    || `gemini-file-search-${Date.now()}`;
}

function buildMarkdownResult({ model, storeName, prompt, answer, groundingMetadata }) {
  const createdAt = new Date().toISOString();
  const groundingChunkCount = groundingMetadata?.groundingChunks?.length ?? 0;
  const groundingSupportCount = groundingMetadata?.groundingSupports?.length ?? 0;

  return [
    '# Gemini File Search Result',
    '',
    `- Model: \`${model}\``,
    `- Store: \`${storeName}\``,
    `- Created: \`${createdAt}\``,
    `- Grounding chunks: \`${groundingChunkCount}\``,
    `- Grounding supports: \`${groundingSupportCount}\``,
    '',
    '## Question',
    '',
    prompt,
    '',
    '## Answer',
    '',
    answer,
    '',
    '## Grounding Metadata',
    '',
    'Saved separately as `.grounding.json`.',
    '',
  ].join('\n');
}

function writeResultFiles({ outDirArg, outNameArg, model, storeName, prompt, answer, groundingMetadata }) {
  if (!outDirArg) return;

  const outDir = normalizeLocalPath(outDirArg);
  const outName = sanitizeFileBaseName(outNameArg || `gemini-file-search-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const markdownPath = path.join(outDir, `${outName}.md`);
  const groundingPath = path.join(outDir, `${outName}.grounding.json`);
  const markdown = buildMarkdownResult({ model, storeName, prompt, answer, groundingMetadata });

  fs.writeFileSync(markdownPath, markdown, 'utf8');
  fs.writeFileSync(groundingPath, JSON.stringify(groundingMetadata ?? null, null, 2), 'utf8');

  console.log('\nSaved result files:');
  console.log(markdownPath);
  console.log(groundingPath);
}

async function main() {
  loadEnvFile(path.join(repoRoot, '.env.local'));
  loadEnvFile(path.join(repoRoot, '.env'));

  const fileArg = readArg('--file', DEFAULT_FILE);
  const model = readArg('--model', DEFAULT_MODEL);
  const existingStoreName = readArg('--store', '');
  const deleteStoreName = readArg('--delete-store', '');
  const prompt = readArg('--prompt', DEFAULT_PROMPT);
  const limitText = readArg('--limit', '');
  const concurrencyText = readArg('--concurrency', '2');
  const retriesText = readArg('--retries', '5');
  const retryDelayText = readArg('--retry-delay-ms', '5000');
  const outDirArg = readArg('--out-dir', '');
  const outNameArg = readArg('--out-name', '');
  const shouldListStores = hasFlag('--list-stores');
  const uploadAll = hasFlag('--all');
  const bundleAll = hasFlag('--bundle');
  const dryRun = hasFlag('--dry-run');
  const keepStore = hasFlag('--keep-store');
  const keepPartialStore = hasFlag('--keep-partial-store');
  const allowUngrounded = hasFlag('--allow-ungrounded');
  const concurrency = Number.parseInt(concurrencyText, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error(`Invalid --concurrency ${concurrencyText}. Choose 1-10.`);
  }
  const retries = Number.parseInt(retriesText, 10);
  if (!Number.isInteger(retries) || retries < 0 || retries > 20) {
    throw new Error(`Invalid --retries ${retriesText}. Choose 0-20.`);
  }
  const retryDelayMs = Number.parseInt(retryDelayText, 10);
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 1000) {
    throw new Error(`Invalid --retry-delay-ms ${retryDelayText}. Choose 1000 or greater.`);
  }

  let uploadFile = null;
  let uploadFiles = [];
  let skippedEmptyFiles = [];
  if (!existingStoreName && uploadAll && bundleAll) {
    uploadFile = buildAllScriptsBundle();
  } else if (!existingStoreName && uploadAll) {
    const collected = collectAllScriptSourceFiles();
    uploadFiles = collected.files;
    skippedEmptyFiles = collected.skippedEmptyFiles;

    if (limitText) {
      const limit = Number.parseInt(limitText, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid --limit ${limitText}.`);
      }
      uploadFiles = uploadFiles.slice(0, limit);
    }
  } else if (!existingStoreName) {
    uploadFile = resolveInputFile(fileArg);
  }

  const uploadSummary = uploadAll && !bundleAll
    ? summarizeSourceFiles(uploadFiles, skippedEmptyFiles)
    : uploadFile;

  if (dryRun) {
    if (existingStoreName) {
      console.log(`Would query existing File Search store: ${existingStoreName}`);
    } else {
      const label = uploadAll
        ? bundleAll ? 'all scripts and metadata files as one bundle' : 'all scripts and metadata files separately'
        : fileArg;
      console.log(`Would upload ${label} (${uploadSummary.sizeKb} KB, ${uploadSummary.sourceCount} source file(s))`);
      if (uploadSummary.textFileCount !== undefined && uploadSummary.metadataFileCount !== undefined) {
        console.log(`Includes ${uploadSummary.textFileCount} script text file(s) and ${uploadSummary.metadataFileCount} metadata TS file(s).`);
      }
      if (uploadSummary.skippedEmptyCount) {
        console.log(`Skips ${uploadSummary.skippedEmptyCount} empty source file(s).`);
      }
      if (uploadFile?.tempDir) {
        fs.rmSync(uploadFile.tempDir, { recursive: true, force: true });
      }
    }
    console.log(`Would query model: ${model}`);
    console.log(`Would retry generateContent up to ${retries} time(s) after retryable 503/high-demand errors.`);
    if (outDirArg) {
      console.log(`Would save result files under: ${normalizeLocalPath(outDirArg)}`);
    }
    return;
  }

  const apiKey = collectApiKeys();
  const ai = new GoogleGenAI({ apiKey });
  let uploadTempDir = null;

  if (shouldListStores) {
    await listStores(ai);
    return;
  }

  if (deleteStoreName) {
    await ai.fileSearchStores.delete({
      name: deleteStoreName,
      config: { force: true },
    });
    console.log(`Deleted File Search store: ${deleteStoreName}`);
    return;
  }

  const storeDisplayName = `nikke-test-${Date.now()}`;
  const fileSearchStore = existingStoreName
    ? { name: existingStoreName }
    : await ai.fileSearchStores.create({
      config: { displayName: storeDisplayName },
    });

  if (existingStoreName) {
    console.log(`Using existing File Search store: ${existingStoreName}`);
  } else {
    console.log(`Created File Search store: ${storeDisplayName}`);
    console.log(`Store name: ${fileSearchStore.name}`);
  }

  let uploadCompleted = Boolean(existingStoreName);
  let shouldDeleteCreatedStore = !existingStoreName && !keepStore;
  let shouldDeleteFailedCreatedStore = !existingStoreName && !keepPartialStore;
  installSigintCleanup(async () => {
    if (uploadFile?.tempDir) {
      fs.rmSync(uploadFile.tempDir, { recursive: true, force: true });
    }
    if (uploadTempDir) {
      fs.rmSync(uploadTempDir, { recursive: true, force: true });
    }

    if (!existingStoreName && !keepPartialStore) {
      console.log(`Deleting File Search store: ${fileSearchStore.name}`);
      await ai.fileSearchStores.delete({
        name: fileSearchStore.name,
        config: { force: true },
      });
    } else if (!existingStoreName) {
      console.log(`Keeping File Search store: ${fileSearchStore.name}`);
    }
  });

  try {
    if (!existingStoreName) {
      const label = uploadAll
        ? bundleAll ? 'all scripts and metadata files as one bundle' : 'all scripts and metadata files separately'
        : fileArg;
      console.log(`Uploading ${label} (${uploadSummary.sizeKb} KB, ${uploadSummary.sourceCount} source file(s))`);
      if (uploadSummary.textFileCount !== undefined && uploadSummary.metadataFileCount !== undefined) {
        console.log(`Includes ${uploadSummary.textFileCount} script text file(s) and ${uploadSummary.metadataFileCount} metadata TS file(s).`);
      }
      if (uploadSummary.skippedEmptyCount) {
        console.log(`Skips ${uploadSummary.skippedEmptyCount} empty source file(s).`);
      }

      if (uploadFiles.length) {
        const prepared = prepareAsciiUploadCopies(uploadFiles);
        uploadTempDir = prepared.tempDir;
        uploadFiles = prepared.files;
        await uploadSourceFiles(ai, fileSearchStore.name, uploadFiles, concurrency);
      } else {
        let fileForUpload = uploadFile;
        if (!/^[\x00-\x7F]+$/.test(path.basename(uploadFile.absolutePath))) {
          const prepared = prepareAsciiUploadCopies([uploadFile]);
          uploadTempDir = prepared.tempDir;
          fileForUpload = prepared.files[0];
        }

        let operation = await ai.fileSearchStores.uploadToFileSearchStore({
          file: fileForUpload.uploadPath ?? fileForUpload.absolutePath,
          fileSearchStoreName: fileSearchStore.name,
          config: {
            displayName: fileForUpload.displayName,
            mimeType: fileForUpload.mimeType,
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
          throw new Error(`Indexing failed: ${JSON.stringify(operation.error)}`);
        }
      }

      uploadCompleted = true;
    }

    console.log(`\nModel: ${model}`);
    console.log('\nQuestion:');
    console.log(prompt);

    const response = await generateContentWithRetry(ai, {
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [fileSearchStore.name],
            },
          },
        ],
      },
    }, retries, retryDelayMs);

    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const hasGrounding = Boolean(
      groundingMetadata?.groundingChunks?.length ||
      groundingMetadata?.groundingSupports?.length ||
      groundingMetadata?.retrievalMetadata
    );

    if (!hasGrounding && !allowUngrounded) {
      console.log('\nUngrounded answer was blocked:');
      console.log(response.text);
      throw new Error([
        'No File Search grounding metadata was returned, so this answer is probably model knowledge or hallucination.',
        'Recreate the store with separate source documents using --all, or pass --allow-ungrounded if you intentionally want to inspect the raw ungrounded output.',
      ].join(' '));
    }

    console.log('\nAnswer:');
    console.log(response.text);

    if (groundingMetadata) {
      console.log('\nGrounding metadata:');
      console.log(JSON.stringify(groundingMetadata, null, 2));
    }

    writeResultFiles({
      outDirArg,
      outNameArg,
      model,
      storeName: fileSearchStore.name,
      prompt,
      answer: response.text,
      groundingMetadata,
    });
  } finally {
    if (uploadFile?.tempDir) {
      fs.rmSync(uploadFile.tempDir, { recursive: true, force: true });
    }
    if (uploadTempDir) {
      fs.rmSync(uploadTempDir, { recursive: true, force: true });
    }

    if (existingStoreName) {
      console.log('\nExisting File Search store was not modified or deleted.');
    } else if (!uploadCompleted && shouldDeleteFailedCreatedStore) {
      console.log(`\nDeleting failed partial File Search store: ${fileSearchStore.name}`);
      await ai.fileSearchStores.delete({
        name: fileSearchStore.name,
        config: { force: true },
      });
      shouldDeleteCreatedStore = false;
    } else if (keepStore) {
      console.log(`\nKeeping File Search store: ${fileSearchStore.name}`);
    } else {
      console.log(`\nDeleting File Search store: ${fileSearchStore.name}`);
      await ai.fileSearchStores.delete({
        name: fileSearchStore.name,
        config: { force: true },
      });
      shouldDeleteCreatedStore = false;
    }
  }
}

main().catch((error) => {
  console.error('\nGemini File Search test failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
