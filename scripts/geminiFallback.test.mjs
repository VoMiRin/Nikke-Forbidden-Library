import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGeminiFallbackRouter,
  getPacificDateKey,
  isGeminiDailyRequestQuotaError,
  isGeminiRateLimitError,
  isRetryableGeminiError,
} from '../server/geminiFallback.mjs';

const PRIMARY_MODEL = 'gemini-3.7-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

const makeQuotaError = (quotaId, model = PRIMARY_MODEL) => new Error(JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId,
            quotaDimensions: {
              location: 'global',
              model,
            },
            quotaValue: quotaId.includes('PerDay') ? '20' : '5',
          },
        ],
      },
    ],
  },
}));

test('only the per-model daily generate request quota triggers fallback', () => {
  const dailyError = makeQuotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  const minuteError = makeQuotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  const generic429 = new Error(JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'Resource exhausted. Please retry shortly.',
    },
  }));

  assert.equal(isGeminiRateLimitError(dailyError), true);
  assert.equal(isGeminiDailyRequestQuotaError(dailyError), true);
  assert.equal(isRetryableGeminiError(dailyError), false);

  assert.equal(isGeminiRateLimitError(minuteError), true);
  assert.equal(isGeminiDailyRequestQuotaError(minuteError), false);
  assert.equal(isRetryableGeminiError(minuteError), true);

  assert.equal(isGeminiDailyRequestQuotaError(generic429), false);
  assert.equal(isRetryableGeminiError(generic429), true);
  assert.equal(isRetryableGeminiError(new Error(JSON.stringify({
    error: { code: 503, status: 'UNAVAILABLE', message: 'High demand.' },
  }))), true);
});

test('the primary model is returned without touching fallback when generation succeeds', async () => {
  const router = createGeminiFallbackRouter({
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    getDateKey: () => '2026-08-29',
  });
  const calledModels = [];

  const result = await router.generate({ contents: '질문' }, async (request) => {
    calledModels.push(request.model);
    return { text: '3.7 답변' };
  });

  assert.deepEqual(calledModels, [PRIMARY_MODEL]);
  assert.equal(result.model, PRIMARY_MODEL);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.fallbackReason, null);
  assert.equal(result.response.text, '3.7 답변');
});

test('a primary daily quota error immediately falls back with the same prompt and File Search config', async () => {
  const router = createGeminiFallbackRouter({
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    getDateKey: () => '2026-08-29',
  });
  const originalRequest = {
    model: PRIMARY_MODEL,
    contents: '라피와 아니스의 관계를 설명해줘',
    config: {
      systemInstruction: '저장소만 근거로 답변',
      tools: [{ fileSearch: { fileSearchStoreNames: ['fileSearchStores/test'] } }],
    },
  };
  const requests = [];

  const result = await router.generate(originalRequest, async (request) => {
    requests.push(request);
    if (request.model === PRIMARY_MODEL) {
      throw makeQuotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    }
    return { text: 'Lite 답변' };
  });

  assert.deepEqual(requests.map((request) => request.model), [PRIMARY_MODEL, FALLBACK_MODEL]);
  assert.equal(requests[1].contents, originalRequest.contents);
  assert.deepEqual(requests[1].config, originalRequest.config);
  assert.equal(originalRequest.model, PRIMARY_MODEL);
  assert.equal(result.model, FALLBACK_MODEL);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackReason, 'primary_daily_quota');
  assert.equal(result.response.text, 'Lite 답변');
});

test('the exhausted primary stays bypassed for the Pacific day and is retried the next day', async () => {
  let dateKey = '2026-08-29';
  let primaryShouldFail = true;
  const router = createGeminiFallbackRouter({
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    getDateKey: () => dateKey,
  });
  const calledModels = [];
  const generate = async (request) => {
    calledModels.push(request.model);
    if (request.model === PRIMARY_MODEL && primaryShouldFail) {
      throw makeQuotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    }
    return { text: `${request.model} 답변` };
  };

  await router.generate({ contents: '첫 질문' }, generate);
  const sameDayResult = await router.generate({ contents: '둘째 질문' }, generate);

  assert.deepEqual(calledModels, [PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL]);
  assert.equal(sameDayResult.fallbackReason, 'primary_daily_quota_cached');
  assert.equal(router.isPrimaryQuotaExhausted(), true);

  dateKey = '2026-08-30';
  primaryShouldFail = false;
  const nextDayResult = await router.generate({ contents: '셋째 질문' }, generate);

  assert.equal(nextDayResult.model, PRIMARY_MODEL);
  assert.equal(router.isPrimaryQuotaExhausted(), false);
  assert.deepEqual(calledModels, [
    PRIMARY_MODEL,
    FALLBACK_MODEL,
    FALLBACK_MODEL,
    PRIMARY_MODEL,
  ]);
});

test('minute quota and provider errors never switch models', async () => {
  const router = createGeminiFallbackRouter({
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    getDateKey: () => '2026-08-29',
  });
  const minuteError = makeQuotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  const calledModels = [];

  await assert.rejects(
    router.generate({ contents: '질문' }, async (request) => {
      calledModels.push(request.model);
      throw minuteError;
    }),
    (error) => error === minuteError
  );

  assert.deepEqual(calledModels, [PRIMARY_MODEL]);
  assert.equal(router.isPrimaryQuotaExhausted(), false);
});

test('a fallback failure is propagated without recursively retrying the primary', async () => {
  const router = createGeminiFallbackRouter({
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    getDateKey: () => '2026-08-29',
  });
  const fallbackError = makeQuotaError(
    'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
    FALLBACK_MODEL
  );
  const calledModels = [];
  let activeModel = PRIMARY_MODEL;

  await assert.rejects(
    router.generate({ contents: '질문' }, async (request) => {
      activeModel = request.model;
      calledModels.push(request.model);
      if (request.model === PRIMARY_MODEL) {
        throw makeQuotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
      }
      throw fallbackError;
    }),
    (error) => error === fallbackError
  );

  assert.equal(activeModel, FALLBACK_MODEL);
  assert.deepEqual(calledModels, [PRIMARY_MODEL, FALLBACK_MODEL]);
  assert.equal(router.isPrimaryQuotaExhausted(), true);
});

test('the fallback circuit resets at Pacific midnight', () => {
  assert.equal(getPacificDateKey(new Date('2026-08-30T06:59:59Z')), '2026-08-29');
  assert.equal(getPacificDateKey(new Date('2026-08-30T07:00:00Z')), '2026-08-30');
});
