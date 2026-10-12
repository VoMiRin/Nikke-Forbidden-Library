// Shared by the API and static-index fallback. Keep matching, ranking and
// snippets in one place so a failed API request cannot change search semantics.
export const SEARCH_VERSION = 2;

export const displaySearchText = (value = '') => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const normalizeSearchValue = (value = '') => displaySearchText(value).toLowerCase();

export const findMatchRange = (text, query) => {
  const needle = normalizeSearchValue(query);
  if (!needle) return null;
  const normalized = text.toLowerCase();
  const index = normalized.indexOf(needle);
  if (index < 0) return null;
  if (normalized.length === text.length) return { start: index, end: index + needle.length };
  // Lowercasing can expand a character (e.g. İ). Map back to display offsets.
  const offsets = [];
  let offset = 0;
  for (const character of text) {
    for (let i = 0; i < character.toLowerCase().length; i++) offsets.push([offset, offset + character.length]);
    offset += character.length;
  }
  return { start: offsets[index][0], end: offsets[index + needle.length - 1][1] };
};

export const makeSnippet = (value, query = '', maxLength = 220) => {
  const text = displaySearchText(value);
  const match = findMatchRange(text, query);
  if (!match) return text.slice(0, maxLength) + (text.length > maxLength ? '…' : '');
  const length = Math.max(maxLength, match.end - match.start);
  let start = Math.max(0, match.start - Math.floor((length - (match.end - match.start)) / 3));
  // Prefer a nearby sentence start over cutting the first visible sentence.
  const prefix = text.slice(start, match.start);
  const boundaries = [...prefix.matchAll(/[.!?。！？]\s+/gu)];
  if (boundaries.length) {
    const boundary = boundaries.at(-1);
    start += boundary.index + boundary[0].length;
  } else if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < match.start) start = space + 1;
  }
  let end = Math.min(text.length, Math.max(start + length, match.end));
  const suffix = text.slice(match.end, end);
  const lastBoundary = [...suffix.matchAll(/[.!?。！？](?:\s|$)/gu)].at(-1);
  if (end < text.length && lastBoundary) end = match.end + lastBoundary.index + 1;
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
};

const tokenScore = (field, tokens, weight) => tokens.reduce((sum, token) => sum + (field.includes(token) ? weight : 0), 0);

/** @param {import('../types').SearchIndexDocument[]} documents
 * @param {{contentQuery?: string, speakerQuery?: string, categoryKey?: string | null, limit?: number}} options
 * @returns {Omit<import('../types').SearchApiResponse, 'source'>}
 */
export const searchDocuments = (documents, options = {}) => {
  const contentQuery = normalizeSearchValue(options.contentQuery);
  const speakerQuery = normalizeSearchValue(options.speakerQuery);
  const categoryKey = options.categoryKey?.trim() || null;
  const requestedLimit = options.limit ?? 80;
  const limit = Number.isFinite(requestedLimit) ? Math.min(5000, Math.max(1, Math.floor(requestedLimit))) : 80;
  const contentTokens = contentQuery.split(' ').filter(Boolean);
  const speakerTokens = speakerQuery.split(' ').filter(Boolean);
  const scored = [];

  for (const document of documents) {
    if (categoryKey && document.categoryKey !== categoryKey) continue;
    if (!contentQuery && !speakerQuery) continue;
    const title = normalizeSearchValue(document.title);
    const subTitle = normalizeSearchValue(document.subTitle);
    const content = normalizeSearchValue(document.searchableContent);
    const speakers = normalizeSearchValue(document.searchableSpeakers);
    const speakerEntries = Object.entries(document.searchableSpeakerContent ?? {});
    const matchingSpeakers = speakerEntries.filter(([name]) => normalizeSearchValue(name).includes(speakerQuery));
    const speakerMatch = speakerQuery && (speakerEntries.length
      ? matchingSpeakers.length > 0
      : speakers.includes(speakerQuery));
    if (speakerQuery && !speakerMatch) continue;

    let score = 0;
    let snippetText = document.snippet;
    /** @type {import('../types').SearchMatchType} */
    let matchType = 'speaker';
    let matchedSpeaker;
    if (contentQuery && speakerQuery) {
      // Never match a phrase spanning two different speakers.
      const matched = matchingSpeakers.find(([, text]) => normalizeSearchValue(text).includes(contentQuery));
      if (!matched) continue;
      [matchedSpeaker, snippetText] = matched;
      matchType = 'content';
      score = 120 + tokenScore(normalizeSearchValue(snippetText), contentTokens, 12)
        + tokenScore(speakers, speakerTokens, 24) + (title.includes(speakerQuery) ? 4 : 0);
    } else if (contentQuery) {
      const inContent = content.includes(contentQuery);
      const inTitle = title.includes(contentQuery);
      const inSubTitle = subTitle.includes(contentQuery);
      if (!inContent && !inTitle && !inSubTitle) continue;
      matchType = inContent ? 'content' : inSubTitle ? 'subtitle' : 'title';
      if (inContent) snippetText = document.searchableContent;
      score = (inTitle ? 80 : 0) + (inSubTitle ? 60 : 0) + (inContent ? 32 : 0)
        + tokenScore(title, contentTokens, 18) + tokenScore(subTitle, contentTokens, 12)
        + tokenScore(content, contentTokens, 5);
    } else {
      if (matchingSpeakers.length) [matchedSpeaker, snippetText] = matchingSpeakers[0];
      score = 60 + tokenScore(speakers, speakerTokens, 24) + (title.includes(speakerQuery) ? 4 : 0);
    }
    scored.push({ document, score, snippetText, matchType, matchedSpeaker });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    searchVersion: SEARCH_VERSION,
    mode: contentQuery && speakerQuery ? 'combined' : speakerQuery ? 'speaker' : 'content',
    query: [contentQuery, speakerQuery].filter(Boolean).join(' '),
    contentQuery,
    speakerQuery,
    categoryKey,
    speakerContentSearch: !!(contentQuery && speakerQuery),
    limit,
    totalResults: scored.length,
    results: scored.slice(0, limit).map(({ document, score, snippetText, matchType, matchedSpeaker }) => ({
      id: document.id,
      title: document.title,
      subTitle: document.subTitle,
      categoryKey: document.categoryKey,
      mainChapterFile: document.mainChapterFile,
      snippet: makeSnippet(snippetText, matchType === 'content' ? contentQuery : ''),
      matchType,
      ...(matchedSpeaker ? { matchedSpeaker } : {}),
      score,
    })),
  };
};
