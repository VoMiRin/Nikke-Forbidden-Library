import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { loadAiConfig } from '../server/aiConfig.mjs';
import { configureDevelopmentTransport, createDevelopmentDispatcher } from '../server/devTransport.mjs';

test('native fetch and the SDK send Gemini requests without response timeouts', async t => {
  const originalDispatcher = getGlobalDispatcher();
  const mock = new MockAgent();
  mock.disableNetConnect();
  t.after(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mock.close();
  });
  mock.get('https://generativelanguage.googleapis.com')
    .intercept({ path: '/v1beta/models/gemini-4-argon:generateContent', method: 'POST' })
    .reply(200, { candidates: [{ content: { parts: [{ text: 'delayed answer' }] } }] }, {
      headers: { 'content-type': 'application/json' },
    }).delay(100);
  let dispatched;
  setGlobalDispatcher({
    dispatch(options, handler) {
      dispatched = options;
      return mock.dispatch(options, handler);
    },
  });
  await configureDevelopmentTransport();
  const config = await loadAiConfig({
    rootDir: fileURLToPath(new URL('./fixtures/no-ai-env/', import.meta.url)),
    development: true,
    env: { DEV_GEMINI_API_KEY: 'test-key' },
  });
  const client = new GoogleGenAI({ apiKey: config.apiKey, vertexai: false });
  const response = await client.models.generateContent({
    model: config.model, contents: 'test', config: config.requestConfig,
  });
  assert.equal(response.text, 'delayed answer');
  assert.equal(dispatched.headersTimeout, 0, 'override timeouts supplied by native fetch');
  assert.equal(dispatched.bodyTimeout, 0);
  mock.assertNoPendingInterceptors();
});

test('development transport preserves other hosts and their explicit timeouts', () => {
  const options = { origin: 'https://example.com', headersTimeout: 50, bodyTimeout: 75 };
  const handler = {};
  const dispatcher = createDevelopmentDispatcher({
    dispatch(actualOptions, actualHandler) {
      assert.equal(actualOptions, options);
      assert.equal(actualHandler, handler);
      return true;
    },
  });
  assert.equal(dispatcher.dispatch(options, handler), true);
});
