import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const deployScriptPath = path.join(scriptDirectory, 'deploy.sh');

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function makeFixture() {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-deploy-test-'));
  const scriptsDirectory = path.join(rootDirectory, 'scripts');
  const mockBinDirectory = path.join(rootDirectory, 'mock-bin');
  const logPath = path.join(rootDirectory, 'commands.log');
  fs.mkdirSync(scriptsDirectory, { recursive: true });
  fs.mkdirSync(mockBinDirectory, { recursive: true });
  fs.copyFileSync(deployScriptPath, path.join(scriptsDirectory, 'deploy.sh'));

  const mockCommand = `#!/usr/bin/env bash
set -eu
command_name="$(basename "$0")"
printf '%s %s\n' "$command_name" "$*" >> "$DEPLOY_FLOW_LOG"

if [[ "$command_name" == "npm" && "$*" == "run build" ]]; then
  mkdir -p public
  printf '{}\n' > public/search-index.json
fi

if [[ "$command_name" == "npm" && "$*" == "run gemini:file-search:sync" ]]; then
  exit "\${MOCK_SYNC_EXIT:-0}"
fi

if [[ "$command_name" == "gcloud" && -n "\${EXPECTED_SECRET_VALUE:-}" ]]; then
  case "$*" in
    "secrets versions add"*)
      secret_value=""
      IFS= read -r secret_value || true
      [[ "$secret_value" == "$EXPECTED_SECRET_VALUE" ]] || exit 97
      ;;
  esac
fi
`;

  for (const commandName of ['npm', 'gcloud', 'firebase']) {
    writeExecutable(path.join(mockBinDirectory, commandName), mockCommand);
  }

  return {
    rootDirectory,
    logPath,
    env: {
      ...process.env,
      PATH: `${mockBinDirectory}:${process.env.PATH}`,
      DEPLOY_FLOW_LOG: logPath,
      MOCK_SYNC_EXIT: '0',
      EXPECTED_SECRET_VALUE: '',
      PROJECT_ID: 'test-project',
      GEMINI_API_KEY: 'test-only-key',
      GOOGLE_API_KEY: '',
      GEMINI_API_KEYS: '',
      GEMINI_API_KEY_1: '',
      GEMINI_API_KEY_2: '',
      GEMINI_API_KEY_3: '',
      GEMINI_API_KEY_4: '',
      GEMINI_API_KEY_5: '',
      GEMINI_API_KEY_6: '',
      GEMINI_API_KEY_7: '',
      GEMINI_API_KEY_8: '',
      GEMINI_API_KEY_9: '',
      GEMINI_API_KEY_10: '',
      GEMINI_FILE_SEARCH_STORE: 'fileSearchStores/test-store',
      SYNC_GEMINI_FILE_SEARCH: '1',
      SYNC_GEMINI_SECRET: '0',
      SYNC_FIRESTORE_IAM: '0',
      ASK_LOG_STORAGE: 'off',
      DEPLOY_HOSTING: '1',
    },
  };
}

function runFixture(overrides = {}) {
  const fixture = makeFixture();
  const result = spawnSync('bash', ['scripts/deploy.sh'], {
    cwd: fixture.rootDirectory,
    env: { ...fixture.env, ...overrides },
    encoding: 'utf8',
  });
  const commands = fs.existsSync(fixture.logPath)
    ? fs.readFileSync(fixture.logPath, 'utf8').trim().split('\n').filter(Boolean)
    : [];

  return { ...fixture, result, commands };
}

function commandIndex(commands, prefix) {
  return commands.findIndex((command) => command.startsWith(prefix));
}

test('deploy syncs File Search once before any external deployment command', () => {
  const fixture = runFixture();

  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);
    assert.match(fixture.result.stdout, /GEMINI_MODEL=gemini-3\.7-flash/);
    assert.equal(
      fixture.commands.filter((command) => command === 'npm run gemini:file-search:sync').length,
      1
    );

    const buildIndex = commandIndex(fixture.commands, 'npm run build');
    const syncIndex = commandIndex(fixture.commands, 'npm run gemini:file-search:sync');
    const cloudBuildIndex = commandIndex(fixture.commands, 'gcloud builds submit');
    const cloudRunIndex = commandIndex(fixture.commands, 'gcloud run deploy');
    const hostingIndex = commandIndex(fixture.commands, 'firebase deploy --only hosting');

    assert.ok(buildIndex >= 0);
    assert.ok(buildIndex < syncIndex);
    assert.ok(syncIndex < cloudBuildIndex);
    assert.ok(cloudBuildIndex < cloudRunIndex);
    assert.ok(cloudRunIndex < hostingIndex);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test('explicit sync opt-out preserves the rest of the deploy flow', () => {
  const fixture = runFixture({ SYNC_GEMINI_FILE_SEARCH: '0' });

  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);
    assert.equal(
      fixture.commands.some((command) => command === 'npm run gemini:file-search:sync'),
      false
    );
    assert.ok(commandIndex(fixture.commands, 'npm run build') >= 0);
    const buildIndex = commandIndex(fixture.commands, 'npm run build');
    const cloudBuildIndex = commandIndex(fixture.commands, 'gcloud builds submit');
    const cloudRunIndex = commandIndex(fixture.commands, 'gcloud run deploy');
    const hostingIndex = commandIndex(fixture.commands, 'firebase deploy --only hosting');
    assert.ok(buildIndex < cloudBuildIndex);
    assert.ok(cloudBuildIndex < cloudRunIndex);
    assert.ok(cloudRunIndex < hostingIndex);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test('a sync failure stops Cloud Build, Cloud Run, and Hosting', () => {
  const fixture = runFixture({ MOCK_SYNC_EXIT: '42' });

  try {
    assert.equal(fixture.result.status, 42);
    assert.deepEqual(fixture.commands, [
      'npm run build',
      'npm run gemini:file-search:sync',
    ]);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test('invalid sync flag values fail before build', () => {
  const fixture = runFixture({ SYNC_GEMINI_FILE_SEARCH: 'yes' });

  try {
    assert.notEqual(fixture.result.status, 0);
    assert.deepEqual(fixture.commands, []);
    assert.match(fixture.result.stdout, /must be 0 or 1/);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test('placeholder API keys are rejected when a deploy operation needs a key', () => {
  const fixture = runFixture({
    GEMINI_API_KEY: 'PLACEHOLDER_API_KEY',
    SYNC_GEMINI_FILE_SEARCH: '0',
    SYNC_GEMINI_SECRET: '1',
  });

  try {
    assert.notEqual(fixture.result.status, 0);
    assert.deepEqual(fixture.commands, []);
    assert.match(fixture.result.stdout, /Gemini API key is empty/);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test('a valid fallback key is used instead of a placeholder primary key', () => {
  const fixture = runFixture({
    GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
    GOOGLE_API_KEY: 'valid-google-key',
    EXPECTED_SECRET_VALUE: 'valid-google-key',
    SYNC_GEMINI_FILE_SEARCH: '0',
    SYNC_GEMINI_SECRET: '1',
  });

  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);
    assert.ok(commandIndex(fixture.commands, 'gcloud secrets versions add') >= 0);
  } finally {
    fs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
  }
});
