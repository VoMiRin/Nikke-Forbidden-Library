import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecoveredAskResponse,
  fromFirestoreFields,
  normalizeAskRequestId,
} from '../server/askRecovery.mjs';

test('AI request IDs accept only the unguessable client-generated format', () => {
  assert.equal(
    normalizeAskRequestId('ask_0123456789abcdef0123456789abcdef'),
    'ask_0123456789abcdef0123456789abcdef'
  );
  assert.equal(normalizeAskRequestId('ASK_0123456789ABCDEF0123456789ABCDEF'), 'ask_0123456789abcdef0123456789abcdef');
  assert.equal(normalizeAskRequestId('ask_too_short'), null);
  assert.equal(normalizeAskRequestId('../documents/private'), null);
  assert.equal(normalizeAskRequestId(null), null);
});

test('Firestore fields are decoded into the stored AI response shape', () => {
  const logEntry = fromFirestoreFields({
    answer: { stringValue: '저장된 답변' },
    model: { stringValue: 'gemini-3.7-flash' },
    groundingChunkCount: { integerValue: '2' },
    groundingSupportCount: { integerValue: '1' },
    sources: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                title: { stringValue: '챕터 1' },
                fileSearchStore: { stringValue: 'fileSearchStores/test' },
              },
            },
          },
        ],
      },
    },
    tokenUsage: {
      mapValue: {
        fields: {
          totalTokenCount: { integerValue: '42' },
        },
      },
    },
  });

  assert.deepEqual(
    buildRecoveredAskResponse('ask_0123456789abcdef0123456789abcdef', logEntry),
    {
      status: 'completed',
      answer: '저장된 답변',
      model: 'gemini-3.7-flash',
      grounded: true,
      sources: [{ title: '챕터 1', fileSearchStore: 'fileSearchStores/test' }],
      groundingChunkCount: 2,
      groundingSupportCount: 1,
      tokenUsage: { totalTokenCount: 42 },
      askLogId: 'ask_0123456789abcdef0123456789abcdef',
    }
  );
});

test('an absent or incomplete Firestore document remains pending', () => {
  assert.equal(buildRecoveredAskResponse('ask_0123456789abcdef0123456789abcdef', null), null);
  assert.equal(buildRecoveredAskResponse(
    'ask_0123456789abcdef0123456789abcdef',
    { model: 'gemini-3.7-flash' }
  ), null);
});
