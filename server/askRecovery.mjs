const ASK_REQUEST_ID_PATTERN = /^ask_[0-9a-f]{32}$/;

export const normalizeAskRequestId = (value) => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  return ASK_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
};

export const fromFirestoreValue = (value) => {
  if (!value || typeof value !== 'object') return null;

  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;

  if ('arrayValue' in value) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map(fromFirestoreValue);
  }

  if ('mapValue' in value) {
    return fromFirestoreFields(value.mapValue?.fields);
  }

  return null;
};

export const fromFirestoreFields = (fields) => {
  if (!fields || typeof fields !== 'object') return {};

  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
};

const normalizeSources = (sources) => {
  if (!Array.isArray(sources)) return [];

  return sources
    .filter((source) => source && typeof source === 'object' && typeof source.title === 'string')
    .map((source) => ({
      title: source.title,
      ...(typeof source.fileSearchStore === 'string'
        ? { fileSearchStore: source.fileSearchStore }
        : {}),
    }));
};

export const buildRecoveredAskResponse = (documentId, logEntry) => {
  if (!logEntry || typeof logEntry !== 'object' || typeof logEntry.answer !== 'string') {
    return null;
  }

  const groundingChunkCount = Number(logEntry.groundingChunkCount ?? 0);
  const groundingSupportCount = Number(logEntry.groundingSupportCount ?? 0);
  const sources = normalizeSources(logEntry.sources);

  return {
    status: 'completed',
    answer: logEntry.answer,
    model: typeof logEntry.model === 'string' ? logEntry.model : '',
    grounded: true,
    sources,
    groundingChunkCount: Number.isFinite(groundingChunkCount) ? groundingChunkCount : 0,
    groundingSupportCount: Number.isFinite(groundingSupportCount) ? groundingSupportCount : 0,
    tokenUsage: logEntry.tokenUsage && typeof logEntry.tokenUsage === 'object'
      ? logEntry.tokenUsage
      : null,
    askLogId: documentId,
  };
};
