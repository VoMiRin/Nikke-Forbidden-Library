import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAskRecoveryResult,
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

test('a stored fallback-model answer keeps its effective model during recovery', () => {
  const documentId = 'ask_abcdef0123456789abcdef0123456789';
  const response = buildRecoveredAskResponse(documentId, {
    answer: 'Flash-Lite가 생성한 답변',
    model: 'gemini-3.5-flash-lite',
    groundingChunkCount: 1,
    sources: [{ title: '메인 스토리' }],
  });

  assert.equal(response.model, 'gemini-3.5-flash-lite');
  assert.equal(response.answer, 'Flash-Lite가 생성한 답변');
  assert.equal(response.askLogId, documentId);
});

test('recovery distinguishes a missing request, active generation, and failed generation', () => {
  const documentId = 'ask_0123456789abcdef0123456789abcdef';

  assert.deepEqual(buildAskRecoveryResult(documentId, null), { state: 'not_found' });
  assert.deepEqual(
    buildAskRecoveryResult(documentId, { generationStatus: 'processing' }),
    { state: 'pending' }
  );
  assert.deepEqual(
    buildAskRecoveryResult(documentId, {
      generationStatus: 'failed',
      failureCode: 'PROVIDER_ERROR',
      failureMessage: 'AI 답변 생성이 완료되지 않았습니다. 다시 질문해 주세요.',
    }),
    {
      state: 'failed',
      failureCode: 'PROVIDER_ERROR',
      error: 'AI 답변 생성이 완료되지 않았습니다. 다시 질문해 주세요.',
    }
  );
  assert.equal(
    buildAskRecoveryResult(documentId, {
      generationStatus: 'completed',
      answer: '완료된 답변',
      model: 'gemini-3.7-flash',
    }).state,
    'completed'
  );
});
