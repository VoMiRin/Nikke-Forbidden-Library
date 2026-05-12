import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

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
const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
const geminiFileSearchStore = process.env.GEMINI_FILE_SEARCH_STORE ?? '';
const allowedOrigins = (process.env.ACCESS_CONTROL_ALLOW_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 120);
const rateLimitStore = new Map();
const askRateLimitWindowMs = Number(process.env.ASK_RATE_LIMIT_WINDOW_MS ?? 60_000);
const askRateLimitMaxRequests = Number(process.env.ASK_RATE_LIMIT_MAX_REQUESTS ?? 12);
const askRateLimitStore = new Map();
let geminiClient = null;

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

const writeJson = (request, response, statusCode, payload, extraHeaders = {}) => {
  const securityHeaders = buildSecurityHeaders(request);
  response.writeHead(statusCode, {
    ...securityHeaders,
    'cache-control': statusCode === 200 ? 'public, max-age=120' : 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
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

const isRetryableGeminiError = (error) => {
  const payload = parseErrorPayload(error);
  const code = payload?.error?.code;
  const status = payload?.error?.status;
  const message = payload?.error?.message ?? '';

  return code === 503
    || status === 'UNAVAILABLE'
    || /high demand|try again later|unavailable|503/i.test(message);
};

const generateContentWithRetry = async (client, request, retryCount = 2, retryDelayMs = 3_000) => {
  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await client.models.generateContent(request);
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !isRetryableGeminiError(error)) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
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
  const retryAfterSeconds = isAskRateLimited(request);
  if (retryAfterSeconds !== null) {
    writeJson(request, response, 429, {
      error: 'Too many AI requests. Please try again later.',
    }, {
      'retry-after': String(retryAfterSeconds),
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
  if (!prompt) {
    writeJson(request, response, 400, { error: 'Prompt is required.' });
    return;
  }

  if (prompt.length > 1_200) {
    writeJson(request, response, 400, { error: 'Prompt is too long.' });
    return;
  }

  try {
    const client = getGeminiClient();
    const geminiResponse = await generateContentWithRetry(client, {
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
    });

    const groundingMetadata = geminiResponse.candidates?.[0]?.groundingMetadata;
    const grounding = summarizeGrounding(groundingMetadata);

    if (!grounding.grounded) {
      writeJson(request, response, 502, {
        error: 'Gemini did not return grounded File Search evidence. Please retry or narrow the question.',
        answer: geminiResponse.text ?? '',
        model: geminiModel,
      });
      return;
    }

    writeJson(request, response, 200, {
      answer: geminiResponse.text ?? '',
      model: geminiModel,
      ...grounding,
    });
  } catch (error) {
    console.error('Ask request failed:', error);
    const payload = parseErrorPayload(error);
    writeJson(request, response, payload?.error?.code === 503 ? 503 : 500, {
      error: payload?.error?.message ?? 'Gemini request failed.',
      status: payload?.error?.status,
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
