import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertManifestStore,
  buildSyncPlan,
  includeManifestDocuments,
  listStoreDocuments,
  refreshUnsettledExactDocuments,
  selectUploadActions,
  uploadThenDeleteExisting,
  waitForOperation,
  waitForDocumentReady,
  writeManifestIfChanged,
} from './syncGeminiFileSearchStore.mjs';

const storeName = 'fileSearchStores/current-store';

function makeSource(overrides = {}) {
  return {
    relativePath: 'public/scripts/example.txt',
    displayName: 'public__scripts__example.txt',
    hash: 'local-hash',
    sizeBytes: 12,
    sourceKind: 'script-text',
    ...overrides,
  };
}

function makeRemote({
  name = `${storeName}/documents/example`,
  relativePath = 'public/scripts/example.txt',
  hash,
  state = 'STATE_ACTIVE',
} = {}) {
  const customMetadata = [
    { key: 'relativePath', stringValue: relativePath },
  ];
  if (hash !== undefined) {
    customMetadata.push({ key: 'sha256', stringValue: hash });
  }

  return {
    name,
    displayName: relativePath.replace(/\//g, '__'),
    state,
    customMetadata,
  };
}

function emptyManifest() {
  return { version: 1, storeName: '', files: {} };
}

test('manifest store binding is required once a manifest exists', () => {
  assert.doesNotThrow(() => assertManifestStore(false, emptyManifest(), storeName, 'manifest.json'));
  assert.doesNotThrow(() => assertManifestStore(
    true,
    { ...emptyManifest(), storeName },
    storeName,
    'manifest.json'
  ));
  assert.throws(
    () => assertManifestStore(
      true,
      { ...emptyManifest(), storeName: 'fileSearchStores/old-store' },
      storeName,
      'manifest.json'
    ),
    /Manifest store mismatch/
  );
  assert.throws(
    () => assertManifestStore(true, emptyManifest(), storeName, 'manifest.json'),
    /Manifest store: \(empty\)/
  );
});

test('legacy remote documents without a matching sha are reuploaded, not adopted', () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote();
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments: [remoteDocument],
  });

  assert.equal(plan.adopt.length, 0);
  assert.equal(plan.uploadNew.length, 0);
  assert.equal(plan.reuploadChanged.length, 1);
  assert.deepEqual(plan.reuploadChanged[0].documentNames, [remoteDocument.name]);
});

test('remote documents with a mismatching sha are reuploaded, not adopted', () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote({ hash: 'stale-hash' });
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments: [remoteDocument],
  });

  assert.equal(plan.adopt.length, 0);
  assert.equal(plan.reuploadChanged.length, 1);
  assert.deepEqual(plan.reuploadChanged[0].documentNames, [remoteDocument.name]);
});

test('remote documents are adopted only when sha metadata matches the local file', () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote({ hash: sourceFile.hash });
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments: [remoteDocument],
  });

  assert.equal(plan.adopt.length, 1);
  assert.equal(plan.adopt[0].document.name, remoteDocument.name);
  assert.equal(plan.reuploadChanged.length, 0);
  assert.equal(plan.uploadNew.length, 0);
});

test('pending and failed remote documents are replaced even when sha metadata matches', () => {
  const sourceFile = makeSource();

  for (const state of ['STATE_PENDING', 'STATE_FAILED', 'STATE_UNSPECIFIED']) {
    const remoteDocument = makeRemote({ hash: sourceFile.hash, state });
    const plan = buildSyncPlan({
      sourceFiles: [sourceFile],
      manifest: emptyManifest(),
      remoteDocuments: [remoteDocument],
    });

    assert.equal(plan.adopt.length, 0, state);
    assert.equal(plan.reuploadChanged.length, 1, state);
    assert.deepEqual(plan.reuploadChanged[0].documentNames, [remoteDocument.name], state);
  }
});

test('a manifest never treats its pending document as unchanged', () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote({ hash: sourceFile.hash, state: 'STATE_PENDING' });
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceFile.relativePath]: {
        hash: sourceFile.hash,
        documentName: remoteDocument.name,
      },
    },
  };
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest,
    remoteDocuments: [remoteDocument],
  });

  assert.equal(plan.reuploadChanged.length, 1);
  assert.deepEqual(plan.reuploadChanged[0].documentNames, [remoteDocument.name]);
});

test('an exact pending document is refreshed to active before planning a resumed sync', async () => {
  const sourceFile = makeSource();
  const pendingDocument = makeRemote({ hash: sourceFile.hash, state: 'STATE_PENDING' });
  const activeDocument = { ...pendingDocument, state: 'STATE_ACTIVE' };
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceFile.relativePath]: {
        hash: sourceFile.hash,
        documentName: pendingDocument.name,
      },
    },
  };
  const ai = {
    fileSearchStores: {
      documents: {
        get: async ({ name }) => {
          assert.equal(name, pendingDocument.name);
          return activeDocument;
        },
      },
    },
  };

  const remoteDocuments = await refreshUnsettledExactDocuments(
    ai,
    [sourceFile],
    manifest,
    [pendingDocument],
    { pollIntervalMs: 0, sleep: async () => {} }
  );
  const plan = buildSyncPlan({ sourceFiles: [sourceFile], manifest, remoteDocuments });

  assert.equal(plan.reuploadChanged.length, 0);
  assert.equal(plan.uploadNew.length, 0);
});

test('an active exact document prevents waiting on a pending duplicate', async () => {
  const sourceFile = makeSource();
  const activeDocument = makeRemote({
    name: `${storeName}/documents/active`,
    hash: sourceFile.hash,
  });
  const pendingDocument = makeRemote({
    name: `${storeName}/documents/pending`,
    hash: sourceFile.hash,
    state: 'STATE_PENDING',
  });
  const ai = {
    fileSearchStores: {
      documents: {
        get: async () => {
          throw new Error('pending duplicate should not be polled');
        },
      },
    },
  };

  const remoteDocuments = await refreshUnsettledExactDocuments(
    ai,
    [sourceFile],
    emptyManifest(),
    [pendingDocument, activeDocument]
  );
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments,
  });

  assert.equal(plan.adopt[0].document.name, activeDocument.name);
  assert.deepEqual(plan.adopt[0].duplicateDocumentNames, [pendingDocument.name]);
});

test('force mode skips waiting on a stuck exact document', async () => {
  const sourceFile = makeSource();
  const pendingDocument = makeRemote({ hash: sourceFile.hash, state: 'STATE_PENDING' });
  const ai = {
    fileSearchStores: {
      documents: {
        get: async () => {
          throw new Error('force mode should not poll existing documents');
        },
      },
    },
  };

  const remoteDocuments = await refreshUnsettledExactDocuments(
    ai,
    [sourceFile],
    emptyManifest(),
    [pendingDocument],
    { force: true }
  );

  assert.deepEqual(remoteDocuments, [pendingDocument]);
});

test('dry-run planning skips waiting on a stuck exact document', async () => {
  const sourceFile = makeSource();
  const pendingDocument = makeRemote({ hash: sourceFile.hash, state: 'STATE_PENDING' });
  const ai = {
    fileSearchStores: {
      documents: {
        get: async () => {
          throw new Error('dry-run should not poll existing documents');
        },
      },
    },
  };

  const remoteDocuments = await refreshUnsettledExactDocuments(
    ai,
    [sourceFile],
    emptyManifest(),
    [pendingDocument],
    { skipWait: true }
  );

  assert.deepEqual(remoteDocuments, [pendingDocument]);
});

test('document readiness polling waits for active and rejects failed indexing', async () => {
  const documentName = `${storeName}/documents/pending`;
  const states = ['STATE_PENDING', 'STATE_ACTIVE'];
  const sleeps = [];
  const ai = {
    fileSearchStores: {
      documents: {
        get: async () => ({ name: documentName, state: states.shift() }),
      },
    },
  };

  const document = await waitForDocumentReady(ai, documentName, {
    maxAttempts: 2,
    pollIntervalMs: 7,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(document.state, 'STATE_ACTIVE');
  assert.deepEqual(sleeps, [7]);

  ai.fileSearchStores.documents.get = async () => ({
    name: documentName,
    state: 'STATE_FAILED',
  });
  await assert.rejects(
    waitForDocumentReady(ai, documentName, { maxAttempts: 1 }),
    /indexing failed/
  );
});

test('operation polling has a bounded timeout', async () => {
  const operation = { name: 'operations/stuck', done: false };
  let getCalls = 0;
  const ai = {
    operations: {
      get: async () => {
        getCalls += 1;
        return operation;
      },
    },
  };

  await assert.rejects(
    waitForOperation(ai, operation, {
      maxAttempts: 2,
      pollIntervalMs: 0,
      sleep: async () => {},
    }),
    /Timed out waiting for Gemini operation/
  );
  assert.equal(getCalls, 2);
});

test('a manifest entry does not hide a missing remote document', () => {
  const sourceFile = makeSource();
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceFile.relativePath]: {
        hash: sourceFile.hash,
        documentName: `${storeName}/documents/missing`,
      },
    },
  };
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest,
    remoteDocuments: [],
  });

  assert.equal(plan.reuploadChanged.length, 1);
  assert.deepEqual(plan.reuploadChanged[0].documentNames, []);
});

test('a manifest document omitted by list is recovered with a direct get', async () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote({ hash: sourceFile.hash });
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceFile.relativePath]: {
        hash: sourceFile.hash,
        documentName: remoteDocument.name,
      },
    },
  };
  const ai = {
    fileSearchStores: {
      documents: {
        get: async ({ name }) => {
          assert.equal(name, remoteDocument.name);
          return remoteDocument;
        },
      },
    },
  };

  const remoteDocuments = await includeManifestDocuments(ai, manifest, []);
  const plan = buildSyncPlan({ sourceFiles: [sourceFile], manifest, remoteDocuments });

  assert.equal(plan.reuploadChanged.length, 0);
  assert.equal(plan.uploadNew.length, 0);
});

test('remote listing requests a larger page and consumes the complete pager', async () => {
  const documents = [
    makeRemote({ name: `${storeName}/documents/first` }),
    makeRemote({ name: `${storeName}/documents/second` }),
  ];
  const calls = [];
  const ai = {
    fileSearchStores: {
      documents: {
        list: async (params) => {
          calls.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              yield* documents;
            },
          };
        },
      },
    },
  };

  assert.deepEqual(await listStoreDocuments(ai, storeName), documents);
  assert.deepEqual(calls, [{ parent: storeName, config: { pageSize: 20 } }]);
});

test('a manifest document confirmed missing by direct get remains a replacement', async () => {
  const sourceFile = makeSource();
  const missingDocumentName = `${storeName}/documents/missing`;
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceFile.relativePath]: {
        hash: sourceFile.hash,
        documentName: missingDocumentName,
      },
    },
  };
  const ai = {
    fileSearchStores: {
      documents: {
        get: async () => {
          throw new Error('404 NOT_FOUND');
        },
      },
    },
  };

  const remoteDocuments = await includeManifestDocuments(ai, manifest, []);
  const plan = buildSyncPlan({ sourceFiles: [sourceFile], manifest, remoteDocuments });

  assert.equal(plan.reuploadChanged.length, 1);
  assert.deepEqual(plan.reuploadChanged[0].documentNames, []);
});

test('a verified orphan is adopted and stale duplicates are marked for deletion', () => {
  const sourceFile = makeSource();
  const exact = makeRemote({ name: `${storeName}/documents/exact`, hash: sourceFile.hash });
  const stale = makeRemote({ name: `${storeName}/documents/stale`, hash: 'old-hash' });
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments: [stale, exact],
  });

  assert.equal(plan.adopt.length, 1);
  assert.equal(plan.adopt[0].document.name, exact.name);
  assert.deepEqual(plan.adopt[0].duplicateDocumentNames, [stale.name]);
});

test('a cross-linked manifest document is never deleted for the wrong source path', () => {
  const sourceA = makeSource({
    relativePath: 'public/scripts/a.txt',
    displayName: 'public__scripts__a.txt',
    hash: 'hash-a',
  });
  const sourceB = makeSource({
    relativePath: 'public/scripts/b.txt',
    displayName: 'public__scripts__b.txt',
    hash: 'hash-b',
  });
  const remoteA = makeRemote({
    name: `${storeName}/documents/a`,
    relativePath: sourceA.relativePath,
  });
  const remoteB = makeRemote({
    name: `${storeName}/documents/b`,
    relativePath: sourceB.relativePath,
    hash: sourceB.hash,
  });
  const manifest = {
    version: 1,
    storeName,
    files: {
      [sourceA.relativePath]: {
        hash: sourceA.hash,
        documentName: remoteB.name,
      },
      [sourceB.relativePath]: {
        hash: sourceB.hash,
        documentName: remoteB.name,
      },
    },
  };

  assert.throws(
    () => buildSyncPlan({
      sourceFiles: [sourceA, sourceB],
      manifest,
      remoteDocuments: [remoteA, remoteB],
    }),
    /Manifest document path mismatch/
  );
});

test('force mode reuploads even a verified remote document', () => {
  const sourceFile = makeSource();
  const remoteDocument = makeRemote({ hash: sourceFile.hash });
  const plan = buildSyncPlan({
    sourceFiles: [sourceFile],
    manifest: emptyManifest(),
    remoteDocuments: [remoteDocument],
    force: true,
  });

  assert.equal(plan.reuploadForced.length, 1);
  assert.deepEqual(plan.reuploadForced[0].documentNames, [remoteDocument.name]);
});

test('upload action selection can resume at a path or isolate one path', () => {
  const actions = ['a', 'b', 'c'].map((relativePath) => ({
    sourceFile: makeSource({ relativePath }),
  }));

  assert.deepEqual(
    selectUploadActions(actions, { startAt: 'b' }).map((entry) => entry.sourceFile.relativePath),
    ['b', 'c']
  );
  assert.deepEqual(
    selectUploadActions(actions, { only: 'b' }).map((entry) => entry.sourceFile.relativePath),
    ['b']
  );
  assert.deepEqual(
    selectUploadActions(actions, { startAt: 'b', limit: 1 })
      .map((entry) => entry.sourceFile.relativePath),
    ['b']
  );
  assert.throws(
    () => selectUploadActions(actions, { startAt: 'missing' }),
    /Upload action not found/
  );
  assert.throws(
    () => selectUploadActions(actions, { startAt: 'a', only: 'b' }),
    /cannot be used together/
  );
});

test('removed manifest files are reported without prune and all known duplicates are pruned', () => {
  const relativePath = 'public/scripts/removed.txt';
  const manifestDocumentName = `${storeName}/documents/removed-old`;
  const duplicateDocumentName = `${storeName}/documents/removed-duplicate`;
  const manifest = {
    version: 1,
    storeName,
    files: {
      [relativePath]: {
        hash: 'removed-hash',
        documentName: manifestDocumentName,
      },
    },
  };
  const remoteDocuments = [
    makeRemote({ name: manifestDocumentName, relativePath, hash: 'removed-hash' }),
    makeRemote({ name: duplicateDocumentName, relativePath, hash: 'removed-hash' }),
  ];

  const noPrunePlan = buildSyncPlan({
    sourceFiles: [],
    manifest,
    remoteDocuments,
  });
  assert.deepEqual(noPrunePlan.removedLocalFiles, [relativePath]);
  assert.equal(noPrunePlan.deleteRemoved.length, 0);

  const prunePlan = buildSyncPlan({
    sourceFiles: [],
    manifest,
    remoteDocuments,
    prune: true,
  });
  assert.deepEqual(
    prunePlan.deleteRemoved[0].documentNames.sort(),
    [duplicateDocumentName, manifestDocumentName].sort()
  );
});

test('prune refuses a manifest document that belongs to another remote path', () => {
  const removedPath = 'public/scripts/removed.txt';
  const otherPath = 'public/scripts/other.txt';
  const otherDocument = makeRemote({
    name: `${storeName}/documents/other`,
    relativePath: otherPath,
    hash: 'other-hash',
  });
  const manifest = {
    version: 1,
    storeName,
    files: {
      [removedPath]: {
        hash: 'removed-hash',
        documentName: otherDocument.name,
      },
    },
  };

  assert.throws(
    () => buildSyncPlan({
      sourceFiles: [],
      manifest,
      remoteDocuments: [otherDocument],
      prune: true,
    }),
    /Manifest document path mismatch/
  );
});

test('prune removes a stale manifest entry after its remote document is already gone', () => {
  const removedPath = 'public/scripts/already-gone.txt';
  const manifest = {
    version: 1,
    storeName,
    files: {
      [removedPath]: {
        hash: 'removed-hash',
        documentName: `${storeName}/documents/already-gone`,
      },
    },
  };

  const plan = buildSyncPlan({
    sourceFiles: [],
    manifest,
    remoteDocuments: [],
    prune: true,
  });

  assert.deepEqual(plan.deleteRemoved, [{
    relativePath: removedPath,
    documentNames: [],
  }]);
});

test('replacement uploads successfully before deleting existing documents', async () => {
  const events = [];
  const newDocumentName = `${storeName}/documents/new`;
  const oldDocumentName = `${storeName}/documents/old`;

  const result = await uploadThenDeleteExisting({
    uploadDocument: async () => {
      events.push('upload');
      return newDocumentName;
    },
    onUploaded: async (documentName) => {
      events.push(`checkpoint:${documentName}`);
    },
    deleteDocumentByName: async (documentName) => {
      events.push(`delete:${documentName}`);
    },
    existingDocumentNames: [oldDocumentName, newDocumentName],
  });

  assert.equal(result, newDocumentName);
  assert.deepEqual(events, [
    'upload',
    `checkpoint:${newDocumentName}`,
    `delete:${oldDocumentName}`,
  ]);
});

test('replacement never deletes the old document when manifest checkpointing fails', async () => {
  const events = [];

  await assert.rejects(
    uploadThenDeleteExisting({
      uploadDocument: async () => {
        events.push('upload');
        return `${storeName}/documents/new`;
      },
      onUploaded: async () => {
        events.push('checkpoint');
        throw new Error('checkpoint failed');
      },
      deleteDocumentByName: async (documentName) => {
        events.push(`delete:${documentName}`);
      },
      existingDocumentNames: [`${storeName}/documents/old`],
    }),
    /checkpoint failed/
  );

  assert.deepEqual(events, ['upload', 'checkpoint']);
});

test('replacement never deletes the old document when upload fails', async () => {
  const events = [];

  await assert.rejects(
    uploadThenDeleteExisting({
      uploadDocument: async () => {
        events.push('upload');
        throw new Error('upload failed');
      },
      deleteDocumentByName: async (documentName) => {
        events.push(`delete:${documentName}`);
      },
      existingDocumentNames: [`${storeName}/documents/old`],
    }),
    /upload failed/
  );

  assert.deepEqual(events, ['upload']);
});

test('replacement keeps the new document and surfaces an old-document delete failure', async () => {
  const events = [];
  const oldDocumentName = `${storeName}/documents/old`;

  await assert.rejects(
    uploadThenDeleteExisting({
      uploadDocument: async () => {
        events.push('upload');
        return `${storeName}/documents/new`;
      },
      deleteDocumentByName: async (documentName) => {
        events.push(`delete:${documentName}`);
        throw new Error('delete failed');
      },
      existingDocumentNames: [oldDocumentName],
    }),
    /delete failed/
  );

  assert.deepEqual(events, ['upload', `delete:${oldDocumentName}`]);
});

test('manifest writes are atomic and no-op syncs preserve bytes and updatedAt', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nikke-sync-test-'));
  const manifestPath = path.join(tempDirectory, 'manifest.json');
  const manifest = {
    version: 1,
    storeName,
    files: {
      'public/scripts/example.txt': {
        hash: 'first-hash',
        documentName: `${storeName}/documents/example`,
      },
    },
  };

  try {
    assert.equal(
      writeManifestIfChanged(manifestPath, manifest, () => new Date('2026-08-07T00:00:00.000Z')),
      true
    );
    const firstBytes = fs.readFileSync(manifestPath, 'utf8');

    assert.equal(
      writeManifestIfChanged(manifestPath, manifest, () => new Date('2026-08-08T00:00:00.000Z')),
      false
    );
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), firstBytes);

    manifest.files['public/scripts/example.txt'].hash = 'second-hash';
    const failingFileSystem = Object.create(fs);
    failingFileSystem.renameSync = () => {
      throw new Error('rename failed');
    };
    assert.throws(
      () => writeManifestIfChanged(
        manifestPath,
        manifest,
        () => new Date('2026-08-09T00:00:00.000Z'),
        failingFileSystem
      ),
      /rename failed/
    );
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), firstBytes);
    assert.deepEqual(fs.readdirSync(tempDirectory).sort(), ['manifest.json']);

    assert.equal(
      writeManifestIfChanged(manifestPath, manifest, () => new Date('2026-08-10T00:00:00.000Z')),
      true
    );
    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(updatedManifest.updatedAt, '2026-08-10T00:00:00.000Z');
    assert.equal(updatedManifest.files['public/scripts/example.txt'].hash, 'second-hash');
    assert.deepEqual(
      fs.readdirSync(tempDirectory).sort(),
      ['manifest.json']
    );
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
