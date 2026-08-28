export const PENDING_ASK_STORAGE_KEY = 'nikke.ai.pendingAsk.v1';
export const PENDING_ASK_MAX_AGE_MS = 30 * 60_000;

const ASK_REQUEST_ID_PATTERN = /^ask_[0-9a-f]{32}$/;

export const parsePendingAsk = (rawValue, now = Date.now()) => {
  if (typeof rawValue !== 'string' || !rawValue) return null;

  try {
    const value = JSON.parse(rawValue);
    if (
      !value
      || typeof value !== 'object'
      || typeof value.requestId !== 'string'
      || !ASK_REQUEST_ID_PATTERN.test(value.requestId)
      || !Number.isFinite(value.submittedAt)
    ) {
      return null;
    }

    const ageMs = now - value.submittedAt;
    if (ageMs < -60_000 || ageMs > PENDING_ASK_MAX_AGE_MS) return null;

    return {
      requestId: value.requestId,
      submittedAt: value.submittedAt,
    };
  } catch {
    return null;
  }
};

export const readPendingAsk = (storage, now = Date.now()) => {
  if (!storage) return null;

  try {
    const rawValue = storage.getItem(PENDING_ASK_STORAGE_KEY);
    const pendingAsk = parsePendingAsk(rawValue, now);
    if (rawValue && !pendingAsk) storage.removeItem(PENDING_ASK_STORAGE_KEY);
    return pendingAsk;
  } catch {
    return null;
  }
};

export const savePendingAsk = (storage, pendingAsk) => {
  if (!storage) return;

  try {
    storage.setItem(PENDING_ASK_STORAGE_KEY, JSON.stringify(pendingAsk));
  } catch {
    // Recovery is best-effort when session storage is unavailable.
  }
};

export const clearPendingAsk = (storage, requestId) => {
  if (!storage) return;

  try {
    const pendingAsk = parsePendingAsk(storage.getItem(PENDING_ASK_STORAGE_KEY));
    if (!pendingAsk || pendingAsk.requestId === requestId) {
      storage.removeItem(PENDING_ASK_STORAGE_KEY);
    }
  } catch {
    // Recovery is best-effort when session storage is unavailable.
  }
};
