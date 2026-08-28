import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import {
  buildAskRecoveryResult,
  fromFirestoreFields,
  normalizeAskRequestId,
} from './askRecovery.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const loadEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not load ${filePath}:`, error);
    }
  }
};

await loadEnvFile(path.join(rootDir, '.env.local'));
await loadEnvFile(path.join(rootDir, '.env'));

const port = Number(process.env.PORT ?? 8080);
const indexPath = process.env.SEARCH_INDEX_PATH ?? path.join(rootDir, 'public', 'search-index.json');
const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-3.7-flash';
const geminiFileSearchStore = process.env.GEMINI_FILE_SEARCH_STORE ?? '';
const allowedOrigins = (process.env.ACCESS_CONTROL_ALLOW_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 120);
const rateLimitStore = new Map();
const askRateLimitWindowMs = Number(process.env.ASK_RATE_LIMIT_WINDOW_MS ?? 600_000);
const askRateLimitMaxRequests = Number(process.env.ASK_RATE_LIMIT_MAX_REQUESTS ?? 10);
const askRateLimitStore = new Map();
const askGlobalRateLimitWindowMs = Number(process.env.ASK_GLOBAL_RATE_LIMIT_WINDOW_MS ?? 60_000);
const askGlobalRateLimitMaxRequests = Number(process.env.ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS ?? 6);
const askDailyLimitWindowMs = Number(process.env.ASK_DAILY_LIMIT_WINDOW_MS ?? 86_400_000);
const askDailyLimitMaxRequests = Number(process.env.ASK_DAILY_LIMIT_MAX_REQUESTS ?? 100);
const geminiRetryCount = Number(process.env.GEMINI_RETRY_COUNT ?? 3);
const geminiRetryInitialDelayMs = Number(process.env.GEMINI_RETRY_INITIAL_DELAY_MS ?? 5_000);
const geminiRetryMaxDelayMs = Number(process.env.GEMINI_RETRY_MAX_DELAY_MS ?? 60_000);
const geminiProviderCooldownMs = Number(process.env.GEMINI_PROVIDER_COOLDOWN_MS ?? 60_000);
const geminiCountTokensBeforeRequest = process.env.GEMINI_COUNT_TOKENS_BEFORE_REQUEST === '1';
const askLogStorage = (process.env.ASK_LOG_STORAGE ?? 'off').trim().toLowerCase();
const askLogProjectId = (
  process.env.ASK_LOG_PROJECT_ID
  ?? process.env.GOOGLE_CLOUD_PROJECT
  ?? process.env.GCLOUD_PROJECT
  ?? process.env.GCP_PROJECT
  ?? ''
).trim();
const askLogDatabaseId = (process.env.ASK_LOG_DATABASE_ID ?? '(default)').trim();
const askLogCollection = (process.env.ASK_LOG_COLLECTION ?? 'aiAskLogs').trim();
const askLogDefaultStatus = (process.env.ASK_LOG_DEFAULT_STATUS ?? 'pending_review').trim();
const askLogIncludePrompt = process.env.ASK_LOG_INCLUDE_PROMPT !== '0';
const askLogIncludeAnswer = process.env.ASK_LOG_INCLUDE_ANSWER !== '0';
const askLogWriteTimeoutMs = Number(process.env.ASK_LOG_WRITE_TIMEOUT_MS ?? 3_000);
let askGlobalRateLimitEntry = null;
let askDailyLimitEntry = null;
let geminiProviderCooldownUntil = 0;
let geminiClient = null;
let firestoreAccessTokenEntry = null;

const SYSTEM_INSTRUCTION = [
  'You answer questions about the GODDESS OF VICTORY: NIKKE script archive.',
  'Use only the attached File Search store as evidence.',
  'Do not answer from general model knowledge or from other games/franchises.',
  'If the File Search store does not contain relevant evidence, say that the archive did not return enough evidence.',
  'Answer in Korean unless the user asks for another language.',
  'Keep direct quotations short.',
].join('\n');

const normalizeSearchValue = (value = '') => (
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
);

const countTokenHits = (field, tokens, weight) => (
  tokens.reduce((score, token) => score + (field.includes(token) ? weight : 0), 0)
);

const calculateScore = (document, normalizedContentQuery, normalizedSpeakerQuery, contentTokens, speakerTokens) => {
  const normalizedTitle = normalizeSearchValue(document.title);
  const normalizedSubTitle = normalizeSearchValue(document.subTitle ?? '');
  const normalizedSpeakers = normalizeSearchValue(document.searchableSpeakers);
  const normalizedContent = normalizeSearchValue(document.searchableContent);

  const getSpeakerContentForQuery = () => (
    Object.entries(document.searchableSpeakerContent ?? {})
      .filter(([speaker]) => normalizeSearchValue(speaker).includes(normalizedSpeakerQuery))
      .map(([, speakerContent]) => normalizeSearchValue(speakerContent))
      .join(' ')
  );

  let score = 0;

  if (normalizedContentQuery && normalizedSpeakerQuery) {
    const matchedSpeakerContent = getSpeakerContentForQuery();

    if (!matchedSpeakerContent.includes(normalizedContentQuery)) {
      return 0;
    }

    return (
      120
      + countTokenHits(matchedSpeakerContent, contentTokens, 12)
      + countTokenHits(normalizedSpeakers, speakerTokens, 24)
      + (normalizedTitle.includes(normalizedSpeakerQuery) ? 4 : 0)
    );
  }

  if (normalizedContentQuery) {
    const matchesContentQuery = (
      normalizedTitle.includes(normalizedContentQuery)
      || normalizedSubTitle.includes(normalizedContentQuery)
      || normalizedContent.includes(normalizedContentQuery)
    );

    if (!matchesContentQuery) {
      return 0;
    }

    score += (
      (normalizedTitle.includes(normalizedContentQuery) ? 80 : 0)
      + (normalizedSubTitle.includes(normalizedContentQuery) ? 60 : 0)
      + (normalizedContent.includes(normalizedContentQuery) ? 32 : 0)
      + countTokenHits(normalizedTitle, contentTokens, 18)
      + countTokenHits(normalizedSubTitle, contentTokens, 12)
      + countTokenHits(normalizedContent, contentTokens, 5)
    );
  }

  if (normalizedSpeakerQuery) {
    if (!normalizedSpeakers.includes(normalizedSpeakerQuery)) {
      return 0;
    }

    score += 60
      + countTokenHits(normalizedSpeakers, speakerTokens, 24)
      + (normalizedTitle.includes(normalizedSpeakerQuery) ? 4 : 0);
  }

  return score;
};

const getSearchModeForQueries = (normalizedContentQuery, normalizedSpeakerQuery) => {
  if (normalizedContentQuery && normalizedSpeakerQuery) {
    return 'combined';
  }

  return normalizedSpeakerQuery ? 'speaker' : 'content';
};

const readSearchIndex = async () => {
  const raw = await fs.readFile(indexPath, 'utf8');
  return JSON.parse(raw);
};

let cachedDocuments = null;

const getRequestIp = (request) => (
  request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
  || request.socket.remoteAddress
  || 'unknown'
);

const getAllowedOrigin = (request) => {
  const requestOrigin = request.headers.origin?.toString();
  if (!requestOrigin || allowedOrigins.length === 0) {
    return null;
  }

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
};

const buildSecurityHeaders = (request) => {
  const allowedOrigin = getAllowedOrigin(request);
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };

  if (allowedOrigin) {
    headers['access-control-allow-origin'] = allowedOrigin;
    headers['access-control-allow-methods'] = 'GET,POST,OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers.vary = 'Origin';
  }

  return headers;
};

const getDocuments = async () => {
  if (!cachedDocuments) {
    cachedDocuments = await readSearchIndex();
  }

  return cachedDocuments;
};

const isRateLimited = (request) => {
  const ip = getRequestIp(request);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    return null;
  }

  if (entry.count >= rateLimitMaxRequests) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  entry.count += 1;
  return null;
};

const isAskRateLimited = (request) => {
  const ip = getRequestIp(request);
  const now = Date.now();
  const entry = askRateLimitStore.get(ip);

  if (!entry || entry.resetAt <= now) {
    askRateLimitStore.set(ip, { count: 1, resetAt: now + askRateLimitWindowMs });
    return null;
  }

  if (entry.count >= askRateLimitMaxRequests) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  entry.count += 1;
  return null;
};

const isAskGloballyRateLimited = () => {
  const now = Date.now();

  if (!askGlobalRateLimitEntry || askGlobalRateLimitEntry.resetAt <= now) {
    askGlobalRateLimitEntry = { count: 1, resetAt: now + askGlobalRateLimitWindowMs };
    return null;
  }

  if (askGlobalRateLimitEntry.count >= askGlobalRateLimitMaxRequests) {
    return Math.ceil((askGlobalRateLimitEntry.resetAt - now) / 1000);
  }

  askGlobalRateLimitEntry.count += 1;
  return null;
};

const isAskDailyLimitReached = () => {
  if (askDailyLimitWindowMs <= 0 || askDailyLimitMaxRequests <= 0) {
    return null;
  }

  const now = Date.now();

  if (!askDailyLimitEntry || askDailyLimitEntry.resetAt <= now) {
    askDailyLimitEntry = { count: 1, resetAt: now + askDailyLimitWindowMs };
    return null;
  }

  if (askDailyLimitEntry.count >= askDailyLimitMaxRequests) {
    return Math.ceil((askDailyLimitEntry.resetAt - now) / 1000);
  }

  askDailyLimitEntry.count += 1;
  return null;
};

const writeJson = (request, response, statusCode, payload, extraHeaders = {}) => {
  const securityHeaders = buildSecurityHeaders(request);
  response.writeHead(statusCode, {
    ...securityHeaders,
    'cache-control': statusCode === 200 ? 'public, max-age=120' : 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 3_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readJsonBody = async (request, maxBytes = 16_384) => (
  new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  })
);

const collectApiKeys = () => {
  const keys = [];
  const addKey = (value) => {
    const key = value?.trim();
    if (key && key !== 'PLACEHOLDER_API_KEY' && !key.includes('YOUR_') && !keys.includes(key)) {
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

  return keys;
};

const getGeminiClient = () => {
  if (geminiClient) return geminiClient;

  const [apiKey] = collectApiKeys();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseErrorPayload = (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  try {
    return JSON.parse(rawMessage);
  } catch {
    return { error: { message: rawMessage } };
  }
};

const getErrorDetails = (error) => {
  const payload = parseErrorPayload(error);
  return {
    payload,
    code: payload?.error?.code,
    status: payload?.error?.status,
    message: payload?.error?.message ?? '',
    details: Array.isArray(payload?.error?.details) ? payload.error.details : [],
  };
};

const parseDelayMs = (value) => {
  if (!value) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000 ? value : value * 1_000;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const secondsMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) {
    return Math.round(Number(secondsMatch[1]) * 1_000);
  }

  const millisMatch = trimmed.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (millisMatch) {
    return Math.round(Number(millisMatch[1]));
  }

  const numericSeconds = Number(trimmed);
  if (Number.isFinite(numericSeconds)) {
    return Math.round(numericSeconds * 1_000);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
};

const getHeaderValue = (headers, name) => {
  if (!headers) return null;

  if (typeof headers.get === 'function') {
    return headers.get(name);
  }

  const lowerName = name.toLowerCase();
  return headers[name] ?? headers[lowerName] ?? null;
};

const getRetryAfterMs = (error) => {
  const headerValue = getHeaderValue(error?.headers, 'retry-after');
  const headerDelayMs = parseDelayMs(headerValue);
  if (headerDelayMs !== null) return headerDelayMs;

  const { details } = getErrorDetails(error);
  for (const detail of details) {
    const type = detail?.['@type'] ?? detail?.type;
    if (typeof type !== 'string' || !type.includes('RetryInfo')) continue;

    const delayMs = parseDelayMs(detail.retryDelay ?? detail.retry_delay);
    if (delayMs !== null) return delayMs;
  }

  return null;
};

const getGeminiRetryDelayMs = (error, attempt, initialDelayMs, maxDelayMs) => {
  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.min(maxDelayMs, Math.max(1_000, retryAfterMs));
  }

  const exponentialDelayMs = initialDelayMs * (2 ** attempt);
  const jitterMs = Math.floor(Math.random() * Math.min(1_000, Math.round(exponentialDelayMs * 0.2)));
  return Math.min(maxDelayMs, exponentialDelayMs + jitterMs);
};

const isGeminiRateLimitError = (error) => {
  const { code, status, message } = getErrorDetails(error);

  return code === 429
    || status === 'RESOURCE_EXHAUSTED'
    || /rate limit|quota|resource exhausted|429/i.test(message);
};

const isRetryableGeminiError = (error) => {
  const { code, status, message } = getErrorDetails(error);

  return isGeminiRateLimitError(error)
    || code === 503
    || status === 'UNAVAILABLE'
    || /high demand|try again later|unavailable|503/i.test(message);
};

const generateContentWithRetry = async (
  client,
  request,
  retryCount = geminiRetryCount,
  retryInitialDelayMs = geminiRetryInitialDelayMs,
  retryMaxDelayMs = geminiRetryMaxDelayMs,
) => {
  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await client.models.generateContent(request);
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !isRetryableGeminiError(error)) {
        throw error;
      }
      await sleep(getGeminiRetryDelayMs(error, attempt, retryInitialDelayMs, retryMaxDelayMs));
    }
  }

  throw lastError;
};

const countTokensIfEnabled = async (client, request) => {
  if (!geminiCountTokensBeforeRequest) return null;

  try {
    return await client.models.countTokens({
      model: request.model,
      contents: request.contents,
      config: request.config,
    });
  } catch (error) {
    console.warn('Gemini countTokens failed:', error);
    return null;
  }
};

const buildTokenUsage = (geminiResponse, countedTokens) => {
  const usageMetadata = geminiResponse?.usageMetadata;

  if (!usageMetadata && !countedTokens) return null;

  return {
    estimatedInputTokenCount: countedTokens?.totalTokens,
    promptTokenCount: usageMetadata?.promptTokenCount,
    candidatesTokenCount: usageMetadata?.candidatesTokenCount,
    totalTokenCount: usageMetadata?.totalTokenCount,
    cachedContentTokenCount: usageMetadata?.cachedContentTokenCount,
    thoughtsTokenCount: usageMetadata?.thoughtsTokenCount,
    toolUsePromptTokenCount: usageMetadata?.toolUsePromptTokenCount,
  };
};

const getGeminiCooldownRetryAfterSeconds = () => {
  const waitMs = geminiProviderCooldownUntil - Date.now();
  return waitMs > 0 ? Math.ceil(waitMs / 1_000) : null;
};

const setGeminiProviderCooldown = (error) => {
  const waitMs = getRetryAfterMs(error) ?? geminiProviderCooldownMs;
  geminiProviderCooldownUntil = Math.max(geminiProviderCooldownUntil, Date.now() + waitMs);
  return Math.ceil(waitMs / 1_000);
};

const isAskLogEnabled = () => askLogStorage !== 'off' && askLogStorage !== 'none' && askLogStorage !== '';

const toFirestoreValue = (value) => {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { nullValue: null };
    }

    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue),
      },
    };
  }

  return {
    mapValue: {
      fields: toFirestoreFields(value),
    },
  };
};

const toFirestoreFields = (data) => (
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)])
  )
);

const getFirestoreAccessToken = async () => {
  if (process.env.ASK_LOG_ACCESS_TOKEN) {
    return process.env.ASK_LOG_ACCESS_TOKEN;
  }

  if (firestoreAccessTokenEntry && firestoreAccessTokenEntry.expiresAt > Date.now() + 60_000) {
    return firestoreAccessTokenEntry.accessToken;
  }

  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const response = await fetchWithTimeout(metadataUrl, {
    headers: {
      'metadata-flavor': 'Google',
    },
  }, askLogWriteTimeoutMs);

  if (!response.ok) {
    throw new Error(`Could not get metadata access token: ${response.status}`);
  }

  const payload = await response.json();
  const accessToken = payload.access_token;
  if (!accessToken) {
    throw new Error('Metadata token response did not include access_token.');
  }

  firestoreAccessTokenEntry = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 300) - 60) * 1_000,
  };

  return accessToken;
};

const getAskLogDocumentUrl = (documentId) => {
  if (!askLogProjectId) {
    throw new Error('ASK_LOG_PROJECT_ID is not configured.');
  }

  if (!askLogCollection) {
    throw new Error('ASK_LOG_COLLECTION is not configured.');
  }

  const databaseId = encodeURIComponent(askLogDatabaseId || '(default)');
  const collection = encodeURIComponent(askLogCollection);
  return (
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(askLogProjectId)}`
    + `/databases/${databaseId}/documents/${collection}/${encodeURIComponent(documentId)}`
  );
};

const writeAskLogToFirestore = async (documentId, logEntry) => {
  const accessToken = await getFirestoreAccessToken();
  const url = getAskLogDocumentUrl(documentId);
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const firestoreResponse = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fields: toFirestoreFields(logEntry),
        }),
      }, askLogWriteTimeoutMs);

      if (firestoreResponse.ok) return;

      const errorBody = await firestoreResponse.text().catch(() => '');
      lastError = new Error(`Firestore ask log write failed: ${firestoreResponse.status} ${errorBody}`);
      if (firestoreResponse.status < 500 || attempt > 0) break;
    } catch (error) {
      lastError = error;
      if (attempt > 0) break;
    }

    await sleep(250);
  }

  throw lastError ?? new Error('Firestore ask log write failed.');
};

const readAskLogFromFirestore = async (documentId) => {
  const accessToken = await getFirestoreAccessToken();
  const url = getAskLogDocumentUrl(documentId);
  const firestoreResponse = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  }, askLogWriteTimeoutMs);

  if (firestoreResponse.status === 404) return null;

  if (!firestoreResponse.ok) {
    const errorBody = await firestoreResponse.text().catch(() => '');
    throw new Error(`Firestore ask log read failed: ${firestoreResponse.status} ${errorBody}`);
  }

  const document = await firestoreResponse.json();
  return fromFirestoreFields(document.fields);
};

const saveAskLog = async ({
  documentId,
  request,
  prompt,
  answer = null,
  model,
  tokenUsage = null,
  grounding = null,
  generationStatus = 'completed',
  failureCode = null,
  failureMessage = null,
  createdAt = null,
}) => {
  if (!isAskLogEnabled()) return null;

  if (askLogStorage !== 'firestore') {
    console.warn(`Unsupported ASK_LOG_STORAGE=${askLogStorage}. Skipping ask log.`);
    return null;
  }

  const now = new Date().toISOString();
  const resolvedDocumentId = documentId
    ?? `ask_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const logEntry = {
    id: resolvedDocumentId,
    createdAt: createdAt ?? now,
    updatedAt: now,
    status: generationStatus === 'completed'
      ? askLogDefaultStatus || 'pending_review'
      : generationStatus === 'failed'
        ? 'generation_failed'
        : 'generating',
    generationStatus,
    model,
    path: '/api/ask',
    promptLength: prompt.length,
    answerLength: typeof answer === 'string' ? answer.length : 0,
    sources: grounding?.sources ?? [],
    groundingChunkCount: grounding?.groundingChunkCount ?? 0,
    groundingSupportCount: grounding?.groundingSupportCount ?? 0,
    tokenUsage,
    origin: request.headers.origin?.toString() ?? null,
  };

  if (failureCode) {
    logEntry.failureCode = failureCode;
  }

  if (failureMessage) {
    logEntry.failureMessage = failureMessage;
  }

  if (askLogIncludePrompt) {
    logEntry.prompt = prompt;
  }

  if (askLogIncludeAnswer && typeof answer === 'string') {
    logEntry.answer = answer;
  }

  await writeAskLogToFirestore(resolvedDocumentId, logEntry);
  return resolvedDocumentId;
};

const summarizeGrounding = (groundingMetadata) => {
  const seenTitles = new Set();
  const sources = [];

  for (const chunk of groundingMetadata?.groundingChunks ?? []) {
    const context = chunk.retrievedContext;
    const title = context?.title;
    if (!title || seenTitles.has(title)) continue;

    seenTitles.add(title);
    sources.push({
      title,
      fileSearchStore: context.fileSearchStore,
    });
  }

  return {
    grounded: Boolean(
      groundingMetadata?.groundingChunks?.length
      || groundingMetadata?.groundingSupports?.length
      || groundingMetadata?.retrievalMetadata
    ),
    sources,
    groundingChunkCount: groundingMetadata?.groundingChunks?.length ?? 0,
    groundingSupportCount: groundingMetadata?.groundingSupports?.length ?? 0,
  };
};

const handleAskRequest = async (request, response) => {
  const providerCooldownRetryAfterSeconds = getGeminiCooldownRetryAfterSeconds();
  if (providerCooldownRetryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'AI requests are temporarily paused after a Gemini rate limit. Please try again later.',
      status: 'RESOURCE_EXHAUSTED',
    }, {
      'retry-after': String(providerCooldownRetryAfterSeconds),
    });
    return;
  }

  const retryAfterSeconds = isAskRateLimited(request);
  if (retryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'Too many AI requests. Please try again later.',
    }, {
      'retry-after': String(retryAfterSeconds),
    });
    return;
  }

  const globalRetryAfterSeconds = isAskGloballyRateLimited();
  if (globalRetryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'Too many AI requests for this service. Please try again later.',
    }, {
      'retry-after': String(globalRetryAfterSeconds),
    });
    return;
  }

  const dailyRetryAfterSeconds = isAskDailyLimitReached();
  if (dailyRetryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'Daily AI request limit reached. Please try again later.',
    }, {
      'retry-after': String(dailyRetryAfterSeconds),
    });
    return;
  }

  if (!geminiFileSearchStore) {
    writeJson(request, response, 503, {
      error: 'Gemini File Search store is not configured.',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    writeJson(request, response, 400, {
      error: error instanceof Error ? error.message : 'Invalid request body.',
    });
    return;
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const requestId = body.requestId === undefined ? null : normalizeAskRequestId(body.requestId);

  if (body.requestId !== undefined && !requestId) {
    writeJson(request, response, 400, { error: 'Invalid AI request ID.' });
    return;
  }

  if (!prompt) {
    writeJson(request, response, 400, { error: 'Prompt is required.' });
    return;
  }

  if (prompt.length > 1_200) {
    writeJson(request, response, 400, { error: 'Prompt is too long.' });
    return;
  }

  const askLogId = requestId
    ?? `ask_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const askCreatedAt = new Date().toISOString();
  const saveAskFailure = async (failureCode, failureMessage) => {
    await saveAskLog({
      documentId: askLogId,
      request,
      prompt,
      model: geminiModel,
      generationStatus: 'failed',
      failureCode,
      failureMessage,
      createdAt: askCreatedAt,
    }).catch((logError) => {
      console.warn('Could not save failed ask state:', logError);
    });
  };

  try {
    await saveAskLog({
      documentId: askLogId,
      request,
      prompt,
      model: geminiModel,
      generationStatus: 'processing',
      createdAt: askCreatedAt,
    });
  } catch (logError) {
    console.warn('Could not register pending ask state:', logError);
    writeJson(request, response, 503, {
      error: 'AI 질문을 서버에 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      status: 'ASK_REGISTRATION_FAILED',
    });
    return;
  }

  let generationPhase = 'generating';

  try {
    const client = getGeminiClient();
    const geminiRequest = {
      model: geminiModel,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [geminiFileSearchStore],
            },
          },
        ],
      },
    };
    const countedTokens = await countTokensIfEnabled(client, geminiRequest);
    const geminiResponse = await generateContentWithRetry(client, geminiRequest);
    const tokenUsage = buildTokenUsage(geminiResponse, countedTokens);

    const groundingMetadata = geminiResponse.candidates?.[0]?.groundingMetadata;
    const grounding = summarizeGrounding(groundingMetadata);

    if (!grounding.grounded) {
      const failureMessage = '검색 근거가 충분한 답변을 생성하지 못했습니다. 질문을 조금 더 구체적으로 바꿔 주세요.';
      await saveAskFailure('UNGROUNDED_RESPONSE', failureMessage);
      generationPhase = 'failed';
      writeJson(request, response, 502, {
        error: failureMessage,
        answer: geminiResponse.text ?? '',
        model: geminiModel,
        tokenUsage,
      });
      return;
    }

    const answer = geminiResponse.text ?? '';

    if (tokenUsage) {
      console.info('Ask token usage:', {
        model: geminiModel,
        promptTokens: tokenUsage.promptTokenCount,
        outputTokens: tokenUsage.candidatesTokenCount,
        toolTokens: tokenUsage.toolUsePromptTokenCount,
        totalTokens: tokenUsage.totalTokenCount,
        estimatedInputTokens: tokenUsage.estimatedInputTokenCount,
      });
    }

    let savedAskLogId;
    try {
      savedAskLogId = await saveAskLog({
        documentId: askLogId,
        request,
        prompt,
        answer,
        model: geminiModel,
        tokenUsage,
        grounding,
        generationStatus: 'completed',
        createdAt: askCreatedAt,
      });
    } catch (logError) {
      console.warn('Could not confirm completed ask log write:', logError);

      const persistedRecoveryResult = await readAskLogFromFirestore(askLogId)
        .then((logEntry) => buildAskRecoveryResult(askLogId, logEntry))
        .catch((readError) => {
          console.warn('Could not verify completed ask log after write failure:', readError);
          return null;
        });

      if (persistedRecoveryResult?.state === 'completed') {
        generationPhase = 'completed';
        writeJson(request, response, 200, persistedRecoveryResult.response, {
          'cache-control': 'no-store',
        });
        return;
      }

      generationPhase = 'persistence_uncertain';
      writeJson(request, response, 503, {
        error: '생성된 답변의 저장 상태를 확인하고 있습니다. 잠시만 기다려 주세요.',
        status: 'ANSWER_PERSISTENCE_UNCERTAIN',
      }, {
        'cache-control': 'no-store',
        'retry-after': '2',
      });
      return;
    }

    generationPhase = 'completed';
    writeJson(request, response, 200, {
      answer,
      model: geminiModel,
      tokenUsage,
      askLogId: savedAskLogId,
      ...grounding,
    }, {
      'cache-control': 'no-store',
    });
  } catch (error) {
    if (generationPhase !== 'generating') {
      console.warn(`Could not return AI request state ${generationPhase}:`, error);
      return;
    }

    console.error('Ask request failed:', error);
    const { payload, code, status } = getErrorDetails(error);

    if (isGeminiRateLimitError(error)) {
      const retryAfterSeconds = setGeminiProviderCooldown(error);
      const failureMessage = 'Gemini 사용량 제한으로 답변 생성을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      await saveAskFailure(status ?? 'RESOURCE_EXHAUSTED', failureMessage);
      writeJson(request, response, 429, {
        error: failureMessage,
        status: status ?? 'RESOURCE_EXHAUSTED',
      }, {
        'retry-after': String(retryAfterSeconds),
      });
      return;
    }

    const failureMessage = 'AI 답변 생성을 완료하지 못했습니다. 잠시 후 다시 질문해 주세요.';
    await saveAskFailure(status ?? 'PROVIDER_ERROR', failureMessage);
    writeJson(request, response, code === 503 ? 503 : 500, {
      error: payload?.error?.message ?? failureMessage,
      status,
    });
  }
};

const handleAskResultRequest = async (request, response, url) => {
  const requestId = normalizeAskRequestId(url.searchParams.get('requestId'));
  if (!requestId) {
    writeJson(request, response, 400, { error: 'Invalid AI request ID.' });
    return;
  }

  if (askLogStorage !== 'firestore' || !askLogIncludeAnswer) {
    writeJson(request, response, 503, {
      error: 'Stored AI answer recovery is not configured.',
      status: 'RECOVERY_NOT_CONFIGURED',
    }, {
      'retry-after': '3',
    });
    return;
  }

  try {
    const logEntry = await readAskLogFromFirestore(requestId);
    const recoveryResult = buildAskRecoveryResult(requestId, logEntry);

    if (recoveryResult.state === 'not_found') {
      writeJson(request, response, 404, {
        status: 'not_found',
        requestId,
        error: 'AI 질문 기록을 아직 확인하지 못했습니다.',
      }, {
        'cache-control': 'no-store',
        'retry-after': '2',
      });
      return;
    }

    if (recoveryResult.state === 'failed') {
      writeJson(request, response, 422, {
        status: 'failed',
        requestId,
        error: recoveryResult.error,
        failureCode: recoveryResult.failureCode,
      }, {
        'cache-control': 'no-store',
      });
      return;
    }

    if (recoveryResult.state === 'pending') {
      writeJson(request, response, 202, {
        status: 'processing',
        requestId,
      }, {
        'cache-control': 'no-store',
        'retry-after': '2',
      });
      return;
    }

    writeJson(request, response, 200, recoveryResult.response, {
      'cache-control': 'no-store',
    });
  } catch (error) {
    console.warn('Could not recover stored AI answer:', error);
    writeJson(request, response, 503, {
      error: 'Stored AI answer is temporarily unavailable.',
    }, {
      'retry-after': '3',
    });
  }
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(request, response, 400, { error: 'Missing request URL.' });
    return;
  }

  if (request.method === 'OPTIONS') {
    const allowedOrigin = getAllowedOrigin(request);
    if (!allowedOrigin) {
      response.writeHead(403, buildSecurityHeaders(request));
      response.end();
      return;
    }

    response.writeHead(204, buildSecurityHeaders(request));
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

  if (url.pathname === '/healthz') {
    writeJson(request, response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/ask') {
    if (request.method !== 'POST') {
      writeJson(request, response, 405, { error: 'Method not allowed.' });
      return;
    }

    await handleAskRequest(request, response);
    return;
  }

  if (url.pathname === '/api/ask/result') {
    if (request.method !== 'GET') {
      writeJson(request, response, 405, { error: 'Method not allowed.' });
      return;
    }

    const retryAfterSeconds = isRateLimited(request);
    if (retryAfterSeconds !== null) {
      writeJson(request, response, 429, {
        error: 'Too many stored answer checks. Please try again later.',
      }, {
        'retry-after': String(retryAfterSeconds),
      });
      return;
    }

    await handleAskResultRequest(request, response, url);
    return;
  }

  if (url.pathname !== '/api/search') {
    writeJson(request, response, 404, { error: 'Not found.' });
    return;
  }

  const retryAfterSeconds = isRateLimited(request);
  if (retryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'Too many search requests. Please try again later.',
    }, {
      'retry-after': String(retryAfterSeconds),
    });
    return;
  }

  const rawQuery = url.searchParams.get('q') ?? '';
  const legacyMode = url.searchParams.get('mode') === 'speaker' ? 'speaker' : 'content';
  const rawContentQuery = url.searchParams.get('content') ?? (legacyMode === 'speaker' ? '' : rawQuery);
  const rawSpeakerQuery = url.searchParams.get('speaker') ?? (legacyMode === 'speaker' ? rawQuery : '');
  const normalizedContentQuery = normalizeSearchValue(rawContentQuery);
  const normalizedSpeakerQuery = normalizeSearchValue(rawSpeakerQuery);
  const normalizedQuery = [normalizedContentQuery, normalizedSpeakerQuery].filter(Boolean).join(' ');
  const mode = getSearchModeForQueries(normalizedContentQuery, normalizedSpeakerQuery);
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(5000, requestedLimit))
    : 50;

  if (!normalizedQuery) {
    writeJson(request, response, 200, {
      mode,
      query: '',
      contentQuery: '',
      speakerQuery: '',
      speakerContentSearch: false,
      limit,
      totalResults: 0,
      results: [],
      source: 'api',
    });
    return;
  }

  try {
    const documents = await getDocuments();
    const contentTokens = normalizedContentQuery.split(' ').filter(Boolean);
    const speakerTokens = normalizedSpeakerQuery.split(' ').filter(Boolean);

    const scoredResults = documents
      .map((document) => ({
        document,
        score: calculateScore(document, normalizedContentQuery, normalizedSpeakerQuery, contentTokens, speakerTokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const results = scoredResults
      .slice(0, limit)
      .map(({ document, score }) => ({
        id: document.id,
        title: document.title,
        categoryKey: document.categoryKey,
        subTitle: document.subTitle,
        mainChapterFile: document.mainChapterFile,
        snippet: document.snippet,
        score,
      }));

    writeJson(request, response, 200, {
      mode,
      query: normalizedQuery,
      contentQuery: normalizedContentQuery,
      speakerQuery: normalizedSpeakerQuery,
      speakerContentSearch: !!(normalizedContentQuery && normalizedSpeakerQuery),
      limit,
      totalResults: scoredResults.length,
      results,
      source: 'api',
    });
  } catch (error) {
    console.error('Search request failed:', error);
    writeJson(request, response, 500, {
      error: 'Search index is unavailable.',
    });
  }
});

server.listen(port, () => {
  console.log(`Search API listening on port ${port}`);
});
