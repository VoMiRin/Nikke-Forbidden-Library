import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('development API uses only Argon Flex and recovers answers locally without Firestore', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nikke-dev-api-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const hookPath = path.join(dir, 'mock-provider.mjs');
  const requestsPath = path.join(dir, 'requests.jsonl');
  const manifestPath = path.join(dir, 'manifest.json');
  await fs.writeFile(manifestPath, '[]');
  await fs.writeFile(hookPath, `
    import fs from 'node:fs/promises';
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        throw new Error('Unexpected network call: ' + url);
      }
      const body = JSON.parse(options.body);
      await fs.appendFile(${JSON.stringify(requestsPath)}, JSON.stringify({
        url: String(url), body, key: new Headers(options.headers).get('x-goog-api-key')
      }) + '\\n');
      await new Promise(resolve => setTimeout(resolve, 200));
      const failure = body.contents[0].parts[0].text === 'fail';
      return new Response(JSON.stringify(failure ? {
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'daily request quota exceeded' }
      } : {
        candidates: [{ content: { parts: [{ text: '개발용 답변' }] },
          groundingMetadata: { groundingChunks: [{ retrievedContext: { title: '테스트 출처' } }] }
        }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
      }), { status: failure ? 429 : 200, headers: { 'content-type': 'application/json' } });
    };
  `);
  const child = fork(new URL('../server/index.mjs', import.meta.url), ['--dev'], {
    execArgv: ['--import', pathToFileURL(hookPath).href],
    env: {
      ...process.env, NODE_ENV: 'development', K_SERVICE: '', PORT: '0',
      DEV_GEMINI_API_KEY: 'dev-integration-key', GEMINI_API_KEY: 'unused-production-key',
      DEV_GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/test-existing',
      GEMINI_MODEL: 'unused-model', GEMINI_FALLBACK_MODEL: 'unused-fallback',
      GEMINI_RETRY_COUNT: '0', GEMINI_COUNT_TOKENS_BEFORE_REQUEST: '0',
      ASK_LOG_STORAGE: 'firestore', ASK_LOG_INCLUDE_ANSWER: '0',
      ASK_RATE_LIMIT_MAX_REQUESTS: '100', ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS: '100',
      SCRIPT_MANIFEST_PATH: manifestPath,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${output}`)), 10_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Startup failed: ${output}`)); });
    child.once('message', message => { clearTimeout(timeout); resolve(message.port); });
  });
  const base = `http://127.0.0.1:${port}`;
  const requestId = 'ask_0123456789abcdef0123456789abcdef';
  const post = fetch(`${base}/api/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, prompt: 'test' }),
  });
  let pending;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    pending = await fetch(`${base}/api/ask/result?requestId=${requestId}`);
    if (pending.status === 202) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(pending.status, 202);
  const answer = await post;
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).model, 'gemini-4-argon');
  const recovery = await fetch(`${base}/api/ask/result?requestId=${requestId}`);
  assert.equal(recovery.status, 200);
  assert.equal((await recovery.json()).answer, '개발용 답변');

  const failedId = 'ask_abcdef0123456789abcdef0123456789';
  const failed = await fetch(`${base}/api/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: failedId, prompt: 'fail' }),
  });
  assert.equal(failed.status, 429);
  const failedRecovery = await fetch(`${base}/api/ask/result?requestId=${failedId}`);
  assert.equal(failedRecovery.status, 422);
  const requests = (await fs.readFile(requestsPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.length, 2, 'daily quota errors must not use another model or key');
  for (const request of requests) {
    assert.match(request.url, /models\/gemini-4-argon:generateContent/);
    assert.equal(request.key, 'dev-integration-key');
    assert.equal(request.body.serviceTier, 'flex');
    assert.deepEqual(request.body.tools, [{ fileSearch: { fileSearchStoreNames: ['fileSearchStores/test-existing'] } }]);
  }
});

test('dev launcher proxies to its own API, hides keys, and stops both servers together', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nikke-dev-launcher-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const indexPath = path.join(dir, 'index.json');
  await fs.writeFile(indexPath, '[]');
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env, NODE_ENV: 'development', K_SERVICE: '', NO_COLOR: '1',
      DEV_GEMINI_API_KEY: 'dev-launcher-secret-sentinel',
      GEMINI_API_KEY: 'prod-secret-sentinel', SEARCH_INDEX_PATH: indexPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${output}`)), 20_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Startup failed: ${output}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)\//);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const apiPort = output.match(/Search API listening on port (\d+)/)?.[1];
  assert.ok(apiPort);
  const search = await fetch(`${base}/api/search?q=test`);
  assert.equal(search.status, 200);
  assert.equal((await search.json()).source, 'api');
  const moduleResponse = await fetch(`${base}/components/AiAskPanel.tsx`);
  assert.equal(moduleResponse.status, 200);
  const browserCode = await moduleResponse.text();
  assert.doesNotMatch(browserCode, /dev-launcher-secret-sentinel|prod-secret-sentinel/);
  assert.doesNotMatch(output, /dev-launcher-secret-sentinel|prod-secret-sentinel/);
  const envResponse = await fetch(`${base}/.env.development.local`);
  assert.equal(envResponse.status, 403);

  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/api/search?q=test`));
});
