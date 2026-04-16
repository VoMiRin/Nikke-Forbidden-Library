import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT ?? 8080);
const indexPath = process.env.SEARCH_INDEX_PATH ?? path.join(rootDir, 'public', 'search-index.json');
const allowOrigin = process.env.ACCESS_CONTROL_ALLOW_ORIGIN ?? '*';

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

const calculateScore = (document, normalizedQuery, tokens, mode) => {
  const normalizedTitle = normalizeSearchValue(document.title);
  const normalizedSubTitle = normalizeSearchValue(document.subTitle ?? '');
  const normalizedSpeakers = normalizeSearchValue(document.searchableSpeakers);
  const normalizedContent = normalizeSearchValue(document.searchableContent);

  if (mode === 'speaker') {
    if (!normalizedSpeakers.includes(normalizedQuery)) {
      return 0;
    }

    return 60
      + countTokenHits(normalizedSpeakers, tokens, 24)
      + (normalizedTitle.includes(normalizedQuery) ? 4 : 0);
  }

  const matchesQuery = (
    normalizedTitle.includes(normalizedQuery)
    || normalizedSubTitle.includes(normalizedQuery)
    || normalizedContent.includes(normalizedQuery)
  );

  if (!matchesQuery) {
    return 0;
  }

  return (
    (normalizedTitle.includes(normalizedQuery) ? 80 : 0)
    + (normalizedSubTitle.includes(normalizedQuery) ? 60 : 0)
    + (normalizedContent.includes(normalizedQuery) ? 32 : 0)
    + countTokenHits(normalizedTitle, tokens, 18)
    + countTokenHits(normalizedSubTitle, tokens, 12)
    + countTokenHits(normalizedContent, tokens, 5)
  );
};

const readSearchIndex = async () => {
  const raw = await fs.readFile(indexPath, 'utf8');
  return JSON.parse(raw);
};

let cachedDocuments = null;

const getDocuments = async () => {
  if (!cachedDocuments) {
    cachedDocuments = await readSearchIndex();
  }

  return cachedDocuments;
};

const writeJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': statusCode === 200 ? 'public, max-age=120' : 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(response, 400, { error: 'Missing request URL.' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

  if (url.pathname === '/healthz') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname !== '/api/search') {
    writeJson(response, 404, { error: 'Not found.' });
    return;
  }

  const rawQuery = url.searchParams.get('q') ?? '';
  const normalizedQuery = normalizeSearchValue(rawQuery);
  const mode = url.searchParams.get('mode') === 'speaker' ? 'speaker' : 'content';
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 50;

  if (!normalizedQuery) {
    writeJson(response, 200, {
      mode,
      query: '',
      results: [],
      source: 'api',
    });
    return;
  }

  try {
    const documents = await getDocuments();
    const tokens = normalizedQuery.split(' ').filter(Boolean);

    const results = documents
      .map((document) => ({
        document,
        score: calculateScore(document, normalizedQuery, tokens, mode),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
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

    writeJson(response, 200, {
      mode,
      query: normalizedQuery,
      results,
      source: 'api',
    });
  } catch (error) {
    console.error('Search request failed:', error);
    writeJson(response, 500, {
      error: 'Search index is unavailable.',
    });
  }
});

server.listen(port, () => {
  console.log(`Search API listening on port ${port}`);
});
