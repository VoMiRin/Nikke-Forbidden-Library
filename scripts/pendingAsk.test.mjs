import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PENDING_ASK_MAX_AGE_MS,
  PENDING_ASK_STORAGE_KEY,
  clearPendingAsk,
  parsePendingAsk,
  readPendingAsk,
  savePendingAsk,
} from '../components/pendingAsk.mjs';

const requestId = 'ask_0123456789abcdef0123456789abcdef';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('a pending AI request survives a page reload in session storage', () => {
  const storage = createStorage();
  const submittedAt = 10_000;

  savePendingAsk(storage, { requestId, submittedAt });

  assert.deepEqual(readPendingAsk(storage, submittedAt + 1_000), { requestId, submittedAt });
});

test('invalid and expired pending AI requests are discarded', () => {
  const storage = createStorage();
  storage.setItem(PENDING_ASK_STORAGE_KEY, '{not-json');
  assert.equal(readPendingAsk(storage, 20_000), null);
  assert.equal(storage.getItem(PENDING_ASK_STORAGE_KEY), null);

  const submittedAt = 30_000;
  storage.setItem(PENDING_ASK_STORAGE_KEY, JSON.stringify({ requestId, submittedAt }));
  assert.equal(readPendingAsk(storage, submittedAt + PENDING_ASK_MAX_AGE_MS + 1), null);
  assert.equal(parsePendingAsk(JSON.stringify({ requestId: 'ask_invalid', submittedAt }), submittedAt), null);
});

test('finishing an older request cannot clear a newer pending request', () => {
  const storage = createStorage();
  const newerRequestId = 'ask_abcdef0123456789abcdef0123456789';
  savePendingAsk(storage, { requestId: newerRequestId, submittedAt: Date.now() });

  clearPendingAsk(storage, requestId);
  assert.equal(readPendingAsk(storage)?.requestId, newerRequestId);

  clearPendingAsk(storage, newerRequestId);
  assert.equal(readPendingAsk(storage), null);
});
