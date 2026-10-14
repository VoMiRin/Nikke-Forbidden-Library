import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { loadAiConfig } from '../server/aiConfig.mjs';
import { createGeminiFallbackRouter } from '../server/geminiFallback.mjs';

const fixture = async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nikke-ai-config-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(rootDir, '.env.development.local'), 'DEV_GEMINI_API_KEY="dev-test-key"\n');
  return rootDir;
};

test('development fixes Argon/Flex, reuses the store, and never mutates operational settings', async t => {
  const rootDir = await fixture(t);
  const env = {
    GEMINI_API_KEY: 'operational-test-key', GEMINI_MODEL: 'operational-model',
    GEMINI_FALLBACK_MODEL: 'fallback-model', GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/existing',
  };
  const original = { ...env };
  const config = await loadAiConfig({ rootDir, env, development: true });
  assert.equal(config.apiKey, 'dev-test-key');
  assert.equal(config.model, 'gemini-4-argon');
  assert.equal(config.fallbackModel, '');
  assert.equal(config.fileSearchStore, 'fileSearchStores/existing');
  assert.equal(config.requestConfig.serviceTier, 'flex');
  assert.equal(config.requestConfig.httpOptions.timeout, 900_000);
  assert.deepEqual(env, original);

  const router = createGeminiFallbackRouter({ primaryModel: config.model, fallbackModel: config.fallbackModel });
  let attempts = 0;
  await assert.rejects(router.generate({ config: config.requestConfig }, async request => {
    attempts += 1;
    assert.equal(request.model, 'gemini-4-argon');
    assert.equal(request.config.serviceTier, 'flex');
    throw new Error('429 daily request quota exceeded');
  }), /daily request quota/);
  assert.equal(attempts, 1);
});

test('missing development keys cannot fall back to any operational key', async t => {
  const rootDir = await fixture(t);
  await fs.writeFile(path.join(rootDir, '.env.development.local'), 'DEV_GEMINI_API_KEY=\n');
  for (const key of [undefined, '', 'YOUR_DEVELOPMENT_GEMINI_API_KEY']) {
    await assert.rejects(loadAiConfig({ rootDir, development: true, env: {
      DEV_GEMINI_API_KEY: key, GEMINI_API_KEY: 'prod', GOOGLE_API_KEY: 'google',
      GEMINI_API_KEYS: 'multiple', GEMINI_API_KEY_1: 'numbered',
    } }), /Set DEV_GEMINI_API_KEY/);
  }
});

test('production ignores the development file and variables; deployed processes reject --dev', async t => {
  const rootDir = await fixture(t);
  const env = {
    DEV_GEMINI_API_KEY: 'dev-key', DEV_GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/dev',
    GEMINI_API_KEY: 'prod-key', GEMINI_MODEL: 'prod-model',
    GEMINI_FALLBACK_MODEL: 'fallback-model', GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/prod',
  };
  assert.deepEqual(await loadAiConfig({ rootDir, env }), {
    apiKey: 'prod-key', model: 'prod-model', fallbackModel: 'fallback-model',
    fileSearchStore: 'fileSearchStores/prod', requestConfig: {},
  });
  for (const guard of [{ NODE_ENV: 'production' }, { K_SERVICE: 'cloud-run' }]) {
    await assert.rejects(loadAiConfig({ rootDir, development: true, env: { ...env, ...guard } }), /cannot be used in production/);
  }
});

test('development store and shell key overrides stay separate from production', async t => {
  const rootDir = await fixture(t);
  const config = await loadAiConfig({ rootDir, development: true, env: {
    DEV_GEMINI_API_KEY: 'shell-dev-key', DEV_GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/dev',
    GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/prod',
  } });
  assert.equal(config.apiKey, 'shell-dev-key');
  assert.equal(config.fileSearchStore, 'fileSearchStores/dev');
});

test('installed SDK sends Flex at the API request level alongside File Search', async t => {
  const rootDir = await fixture(t);
  const config = await loadAiConfig({ rootDir, development: true, env: {
    GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/existing',
  } });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body), headers: new Headers(options.headers) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new GoogleGenAI({ apiKey: config.apiKey, vertexai: false });
  await client.models.generateContent({
    model: config.model, contents: 'test',
    config: { ...config.requestConfig, tools: [{ fileSearch: { fileSearchStoreNames: [config.fileSearchStore] } }] },
  });
  assert.match(captured.url, /generativelanguage\.googleapis\.com\/.*models\/gemini-4-argon:generateContent/);
  assert.equal(captured.headers.get('x-goog-api-key'), 'dev-test-key');
  assert.equal(captured.body.serviceTier, 'flex');
  assert.deepEqual(captured.body.tools, [{ fileSearch: { fileSearchStoreNames: ['fileSearchStores/existing'] } }]);
});
