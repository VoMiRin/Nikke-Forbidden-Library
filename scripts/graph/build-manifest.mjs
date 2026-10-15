import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_DATA_DIR,
  SCRIPTS_ROOT_DIR,
  CATEGORY_NAMES,
  loadNewScriptsData,
  makeTitleId,
  parseChapterTextBlocks,
  buildNumberedScript,
  extractSceneMechanicalGroundTruth,
  computeCorpusRoutes,
  writeJsonAtomic,
  normalizeNewlines,
  sha256,
  PASS1_SCHEMA_VERSION,
  descriptorLabelsOf,
  emptyProgressDoc,
  isSceneReusable,
} from './lib.mjs';
import { runInitRegistryCli } from './init-registry.mjs';

const __filename = fileURLToPath(import.meta.url);

export const MIN_BATCH_BYTES = 40 * 1024; // 40 KB
export const TARGET_BATCH_BYTES = 64 * 1024; // ~64 KB target
export const MAX_BATCH_BYTES = 80 * 1024; // 80 KB

/**
 * 장면 경계를 지키며 원문 약 40~80KB 단위로 배치를 나눈다 (1.4).
 * 장면 하나가 80KB를 넘으면 그 장면만으로 배치 하나를 만든다.
 */
export const packScenesIntoBatches = (scenes, options = {}) => {
  const prefix = options.batchPrefix ?? 'batch_';
  const minBytes = options.minBytes ?? MIN_BATCH_BYTES;
  const targetBytes = options.targetBytes ?? TARGET_BATCH_BYTES;
  const maxBytes = options.maxBytes ?? MAX_BATCH_BYTES;

  const rawGroups = [];
  let currentGroup = [];
  let currentBytes = 0;

  for (const scene of scenes) {
    const sceneBytes = scene.raw_bytes;

    // 장면 하나가 80KB를 넘는 경우 단독 배치 생성 (1.4)
    if (sceneBytes > maxBytes) {
      if (currentGroup.length > 0) {
        rawGroups.push(currentGroup);
        currentGroup = [];
        currentBytes = 0;
      }
      rawGroups.push([scene]);
      continue;
    }

    // 현재 배치에 추가하면 maxBytes를 초과하거나, 이미 minBytes 이상인데 targetBytes를 넘기는 경우 새 배치 시작
    if (
      currentGroup.length > 0 &&
      (currentBytes + sceneBytes > maxBytes ||
        (currentBytes >= minBytes && currentBytes + sceneBytes > targetBytes))
    ) {
      rawGroups.push(currentGroup);
      currentGroup = [scene];
      currentBytes = sceneBytes;
    } else {
      currentGroup.push(scene);
      currentBytes += sceneBytes;
    }
  }

  if (currentGroup.length > 0) {
    rawGroups.push(currentGroup);
  }

  // 마지막 배치가 minBytes(40KB) 미만이고 직전 배치가 존재할 경우 경계 재조정
  if (rawGroups.length >= 2) {
    const sumBytes = (grp) => grp.reduce((acc, s) => acc + s.raw_bytes, 0);
    const lastIdx = rawGroups.length - 1;
    const prevIdx = lastIdx - 1;

    if (sumBytes(rawGroups[lastIdx]) < minBytes && sumBytes(rawGroups[prevIdx]) + sumBytes(rawGroups[lastIdx]) <= maxBytes) {
      rawGroups[prevIdx].push(...rawGroups[lastIdx]);
      rawGroups.pop();
    } else {
      // 뒤에서부터 앞 배치들의 여유분을 한 장면씩 뒤로 전달해 모든 배치를 minBytes 이상으로 맞춘다
      let guard = 0;
      while (rawGroups.some((g) => sumBytes(g) < minBytes) && guard < 500) {
        guard += 1;
        let movedAny = false;
        for (let k = rawGroups.length - 1; k >= 1; k--) {
          if (sumBytes(rawGroups[k]) >= minBytes) continue;
          const donor = rawGroups[k - 1];
          const receiver = rawGroups[k];
          if (donor.length <= 1) continue;
          const candidate = donor[donor.length - 1];
          if (sumBytes(receiver) + candidate.raw_bytes <= maxBytes) {
            donor.pop();
            receiver.unshift(candidate);
            movedAny = true;
          }
        }
        if (!movedAny) break;
      }
    }
  }

  const startNumber = options.startNumber ?? 1;
  return rawGroups.map((group, idx) => {
    const batchId = `${prefix}${String(startNumber + idx).padStart(4, '0')}`;
    const bodyBytes = group.reduce((acc, s) => acc + s.body_bytes, 0);
    const rawBytes = group.reduce((acc, s) => acc + s.raw_bytes, 0);
    const unknownCount = group.reduce(
      (acc, s) => acc + s.mechanical_ground_truth.unknowns.length,
      0
    );

    for (const s of group) {
      s.batch_id = batchId;
    }

    return {
      batch_id: batchId,
      is_pilot: prefix.startsWith('pilot_'),
      scene_ids: group.map((s) => s.scene_id),
      scene_count: group.length,
      body_bytes: bodyBytes,
      raw_bytes: rawBytes,
      unknown_count: unknownCount,
      scenes: group,
    };
  });
};

/**
 * 배치 입력 파일용 JSON 객체를 만든다 (1.5).
 */
export const formatBatchInputPayload = (batch) => ({
  schema_version: PASS1_SCHEMA_VERSION,
  batch_id: batch.batch_id,
  is_pilot: Boolean(batch.is_pilot),
  scene_count: batch.scene_count,
  body_bytes: batch.body_bytes,
  raw_bytes: batch.raw_bytes,
  unknown_count: batch.unknown_count,
  scenes: batch.scenes.map((scene) => ({
    scene_id: scene.scene_id,
    title: scene.title,
    sub_title: scene.sub_title,
    line_count: scene.body_lines.length,
    body_bytes: scene.body_bytes,
    raw_bytes: scene.raw_bytes,
    numbered_script: scene.numbered_script,
    mechanical_ground_truth: scene.mechanical_ground_truth,
  })),
});

const batchNumberOf = (batchId) => {
  const match = /^batch_(\d+)$/.exec(batchId);
  return match ? Number(match[1]) : 0;
};

const groupStats = (batchId, scenes, isPilot = false) => ({
  batch_id: batchId,
  is_pilot: isPilot,
  scene_ids: scenes.map((s) => s.scene_id),
  scene_count: scenes.length,
  body_bytes: scenes.reduce((acc, s) => acc + s.body_bytes, 0),
  raw_bytes: scenes.reduce((acc, s) => acc + s.raw_bytes, 0),
  unknown_count: scenes.reduce((acc, s) => acc + s.mechanical_ground_truth.unknowns.length, 0),
  scenes,
});

/**
 * 장면 단위 재사용으로 이번에 추출할 배치를 정한다 (8절 1단계).
 * - 재사용 가능한 장면(해시·스키마 버전·묘사형 화자 목록이 같은 병합 장면)은 다시 추출하지 않는다.
 * - 아직 끝나지 않은 기존 배치는 장면이 그대로면 같은 번호로 유지한다.
 * - 나머지 장면만 새 배치로 묶고, 새 번호는 기존 번호를 재사용하지 않는다.
 */
export const planBatches = (allScenes, progressDoc) => {
  const sceneProgress = progressDoc.scenes ?? {};
  const existingBatches = progressDoc.batches ?? {};
  const sceneById = new Map(allScenes.map((s) => [s.scene_id, s]));

  const needsExtraction = new Set(
    allScenes.filter((s) => !isSceneReusable(sceneProgress[s.scene_id], s)).map((s) => s.scene_id)
  );

  const keptBatches = [];
  const assigned = new Set();
  for (const entry of Object.values(existingBatches)) {
    if (entry.is_pilot || entry.status === 'merged' || !Array.isArray(entry.scene_ids)) continue;
    const scenes = entry.scene_ids.map((id) => sceneById.get(id));
    const unchanged = scenes.every((scene) => {
      if (!scene || !needsExtraction.has(scene.scene_id) || assigned.has(scene.scene_id)) return false;
      const prev = sceneProgress[scene.scene_id];
      return (
        prev &&
        prev.batch_id === entry.batch_id &&
        prev.source_sha256 === scene.source_sha256 &&
        JSON.stringify(prev.descriptor_labels ?? []) === JSON.stringify(descriptorLabelsOf(scene.mechanical_ground_truth))
      );
    });
    if (!unchanged) continue;
    for (const s of scenes) {
      assigned.add(s.scene_id);
      s.batch_id = entry.batch_id;
    }
    keptBatches.push({ ...groupStats(entry.batch_id, scenes), status: entry.status, retries: entry.retries ?? 0 });
  }

  const maxExisting = Object.keys(existingBatches).reduce((max, id) => Math.max(max, batchNumberOf(id)), 0);
  const remaining = allScenes.filter((s) => needsExtraction.has(s.scene_id) && !assigned.has(s.scene_id));
  const newBatches = packScenesIntoBatches(remaining, { batchPrefix: 'batch_', startNumber: maxExisting + 1 }).map(
    (b) => ({ ...b, status: 'pending', retries: 0 })
  );

  return {
    batches: [...keptBatches, ...newBatches].sort((a, b) => batchNumberOf(a.batch_id) - batchNumberOf(b.batch_id)),
    reusedSceneIds: allScenes.filter((s) => !needsExtraction.has(s.scene_id)).map((s) => s.scene_id),
  };
};

const readProgressDoc = async (progressPath, { resetProgress = false } = {}) => {
  if (resetProgress || !fsSync.existsSync(progressPath)) return emptyProgressDoc();
  const doc = JSON.parse(await fs.readFile(progressPath, 'utf8'));
  if (doc.schema_version !== PASS1_SCHEMA_VERSION || !doc.scenes) {
    throw new Error(
      `progress.json is schema ${JSON.stringify(doc.schema_version)} (batch-level); ` +
        `run build-manifest with --reset-progress to start ${PASS1_SCHEMA_VERSION} scene-level progress (8절 2단계).`
    );
  }
  return doc;
};

/**
 * 매니페스트, 배치 입력, progress.json을 생성한다.
 */
export const buildManifestAndBatches = async (options = {}) => {
  const outDir = options.outDir ?? GRAPH_DATA_DIR;
  const scriptsRootDir = options.scriptsRootDir ?? SCRIPTS_ROOT_DIR;
  const newScriptsData = options.newScriptsData ?? loadNewScriptsData();
  const writeFiles = options.writeFiles ?? true;
  const progressPath = path.join(outDir, 'progress.json');

  // 레지스트리가 없으면 먼저 초기화
  const registryPath = path.join(outDir, 'entity_registry.json');
  let speakerLookup = options.speakerLookup ?? null;
  if (!speakerLookup) {
    if (!fsSync.existsSync(registryPath) && writeFiles) {
      await runInitRegistryCli({ outDir, scriptsRootDir, newScriptsData });
    }
    if (fsSync.existsSync(registryPath)) {
      const regRaw = await fs.readFile(registryPath, 'utf8');
      speakerLookup = JSON.parse(regRaw).speaker_lookup ?? null;
    }
  }

  // 파일별 등록 항목 그룹화
  const scriptsByFile = new Map();
  for (const script of newScriptsData) {
    const relFile = `${script.categoryKey}/${script.mainChapterFile}`;
    if (!scriptsByFile.has(relFile)) {
      scriptsByFile.set(relFile, []);
    }
    scriptsByFile.get(relFile).push(script);
  }

  // 파일 파싱 및 정합성 검증
  const parsedBlockMapByFile = new Map();
  const fileMetadataMap = new Map();

  for (const [relFile, registeredList] of scriptsByFile.entries()) {
    const absPath = path.join(scriptsRootDir, relFile);
    const rawContent = await fs.readFile(absPath, 'utf8');
    const normalizedContent = normalizeNewlines(rawContent);
    const blocks = parseChapterTextBlocks(normalizedContent);

    const parsedIds = blocks.map((b) => b.scene_id);
    const expectedIds = registeredList.map((s) => s.id);
    if (
      parsedIds.length !== expectedIds.length ||
      parsedIds.some((id, idx) => id !== expectedIds[idx])
    ) {
      throw new Error(
        `Scene ID mismatch in ${relFile}: expected ${expectedIds.length} scenes, parsed ${parsedIds.length} scenes.`
      );
    }

    const blockMap = new Map(blocks.map((b) => [b.scene_id, b]));
    parsedBlockMapByFile.set(relFile, blockMap);

    const firstScript = registeredList[0];
    const titleId = makeTitleId(firstScript.categoryKey, firstScript.mainChapterFile);

    fileMetadataMap.set(relFile, {
      title_id: titleId,
      category: firstScript.categoryKey,
      section: firstScript.section ?? null,
      title: firstScript.title,
      source_file: `public/scripts/${relFile}`,
      file_sha256: sha256(normalizedContent),
      raw_file_bytes: Buffer.byteLength(normalizedContent, 'utf8'),
    });
  }

  // newScriptsData 순서대로 장면 데이터 구성
  const allScenes = [];
  for (const script of newScriptsData) {
    const relFile = `${script.categoryKey}/${script.mainChapterFile}`;
    const block = parsedBlockMapByFile.get(relFile).get(script.id);
    const fileMeta = fileMetadataMap.get(relFile);

    const sceneObj = {
      scene_id: script.id,
      title_id: fileMeta.title_id,
      category: script.categoryKey,
      section: script.section ?? null,
      title: script.title,
      sub_title: script.subTitle ?? block.sub_title_in_file ?? '',
      sub_title_in_file: block.sub_title_in_file,
      source_file: fileMeta.source_file,
      source_sha256: block.source_sha256,
      body_bytes: block.body_bytes,
      raw_bytes: block.raw_bytes,
      body_lines: block.body_lines,
      numbered_script: buildNumberedScript(block.body_lines),
      batch_id: null,
      mechanical_ground_truth: null,
    };

    sceneObj.mechanical_ground_truth = extractSceneMechanicalGroundTruth(sceneObj, {
      speakerLookup,
    });

    allScenes.push(sceneObj);
  }

  // 1.3 분기 판별 (장면 간 루트 + 부제 루트)
  computeCorpusRoutes(allScenes);

  // 1.4 용량 기준 배치 생성. ignoreProgress면 전체 장면을 1번부터 묶는다(파일럿의 batch_0025 복제용).
  const progressDoc = options.ignoreProgress
    ? emptyProgressDoc()
    : await readProgressDoc(progressPath, { resetProgress: options.resetProgress });
  const { batches, reusedSceneIds } = planBatches(allScenes, progressDoc);
  const reusedSet = new Set(reusedSceneIds);
  for (const scene of allScenes) {
    if (reusedSet.has(scene.scene_id)) {
      scene.batch_id = progressDoc.scenes[scene.scene_id]?.batch_id ?? null;
    }
  }

  // 분류별 / 타이틀별 통계 집계 (1.1 & 7.2)
  const categoryStatsMap = new Map();
  const titleStatsMap = new Map();

  for (const [relFile, fileMeta] of fileMetadataMap.entries()) {
    const catKey = fileMeta.category;
    if (!categoryStatsMap.has(catKey)) {
      categoryStatsMap.set(catKey, {
        category_key: catKey,
        category_name: CATEGORY_NAMES[catKey] ?? catKey,
        titles_count: 0,
        scenes_count: 0,
        raw_file_bytes: 0,
        raw_scene_bytes: 0,
        body_bytes: 0,
        unknown_lines_count: 0,
      });
    }
    const catStat = categoryStatsMap.get(catKey);
    catStat.titles_count += 1;
    catStat.raw_file_bytes += fileMeta.raw_file_bytes;

    titleStatsMap.set(fileMeta.title_id, {
      title_id: fileMeta.title_id,
      category: fileMeta.category,
      section: fileMeta.section,
      title: fileMeta.title,
      source_file: fileMeta.source_file,
      file_sha256: fileMeta.file_sha256,
      raw_file_bytes: fileMeta.raw_file_bytes,
      body_bytes: 0,
      scene_count: 0,
      unknown_lines_count: 0,
      scene_ids: [],
    });
  }

  let totalBodyBytes = 0;
  let totalRawSceneBytes = 0;
  let totalUnknownLines = 0;

  for (const scene of allScenes) {
    const catStat = categoryStatsMap.get(scene.category);
    const titleStat = titleStatsMap.get(scene.title_id);
    const unkCount = scene.mechanical_ground_truth.unknowns.length;

    catStat.scenes_count += 1;
    catStat.raw_scene_bytes += scene.raw_bytes;
    catStat.body_bytes += scene.body_bytes;
    catStat.unknown_lines_count += unkCount;

    titleStat.scene_count += 1;
    titleStat.body_bytes += scene.body_bytes;
    titleStat.unknown_lines_count += unkCount;
    titleStat.scene_ids.push(scene.scene_id);

    totalBodyBytes += scene.body_bytes;
    totalRawSceneBytes += scene.raw_bytes;
    totalUnknownLines += unkCount;
  }

  const totalRawFileBytes = [...categoryStatsMap.values()].reduce(
    (acc, c) => acc + c.raw_file_bytes,
    0
  );

  const batchSizes = batches.map((b) => b.raw_bytes);
  const minBatchBytes = batchSizes.length ? Math.min(...batchSizes) : 0;
  const maxBatchBytes = batchSizes.length ? Math.max(...batchSizes) : 0;
  const avgBatchBytes = batchSizes.length
    ? Math.round(batchSizes.reduce((a, b) => a + b, 0) / batchSizes.length)
    : 0;

  const manifestDoc = {
    schema_version: PASS1_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    totals: {
      categories_count: categoryStatsMap.size,
      titles_count: titleStatsMap.size,
      scenes_count: allScenes.length,
      total_raw_file_bytes: totalRawFileBytes,
      total_raw_scene_bytes: totalRawSceneBytes,
      total_body_bytes: totalBodyBytes,
      total_unknown_lines: totalUnknownLines,
      reused_scenes_count: reusedSceneIds.length,
      batches_count: batches.length,
      min_batch_bytes: minBatchBytes,
      max_batch_bytes: maxBatchBytes,
      avg_batch_bytes: avgBatchBytes,
    },
    categories: [...categoryStatsMap.values()],
    titles: [...titleStatsMap.values()],
    batches: batches.map((b) => ({
      batch_id: b.batch_id,
      is_pilot: false,
      scene_count: b.scene_count,
      scene_ids: b.scene_ids,
      body_bytes: b.body_bytes,
      raw_bytes: b.raw_bytes,
      unknown_count: b.unknown_count,
      batch_input_file: `data/graph/pass1/batches/${b.batch_id}.json`,
      expected_shard_file: `data/graph/pass1/shards/${b.batch_id}.json`,
    })),
    scenes: Object.fromEntries(
      allScenes.map((s) => [
        s.scene_id,
        {
          scene_id: s.scene_id,
          title_id: s.title_id,
          category: s.category,
          section: s.section,
          title: s.title,
          sub_title: s.sub_title,
          source_file: s.source_file,
          source_sha256: s.source_sha256,
          line_count: s.body_lines.length,
          body_bytes: s.body_bytes,
          raw_bytes: s.raw_bytes,
          unknown_count: s.mechanical_ground_truth.unknowns.length,
          batch_id: s.batch_id,
          route: s.mechanical_ground_truth.route,
          mechanical_ground_truth: s.mechanical_ground_truth,
        },
      ])
    ),
  };

  if (writeFiles) {
    const manifestPath = path.join(outDir, 'manifest.json');
    await writeJsonAtomic(manifestPath, manifestDoc);

    const batchesDir = path.join(outDir, 'pass1', 'batches');
    await fs.mkdir(batchesDir, { recursive: true });
    for (const batch of batches) {
      const batchInputPath = path.join(batchesDir, `${batch.batch_id}.json`);
      await writeJsonAtomic(batchInputPath, formatBatchInputPayload(batch));
    }

    // progress.json: 장면 단위 상태 + 배치 요약 (6절, 8절 1단계)
    const nowIso = new Date().toISOString();
    const nextProgress = {
      schema_version: PASS1_SCHEMA_VERSION,
      updated_at: nowIso,
      scenes: {},
      batches: {},
    };

    // 병합된 배치 기록과 파일럿 배치는 보존한다. 끝나지 않은 배치는 planBatches 결과로 다시 쓴다.
    for (const [bId, bEntry] of Object.entries(progressDoc.batches ?? {})) {
      if (bEntry.is_pilot || bEntry.status === 'merged') {
        nextProgress.batches[bId] = bEntry;
      }
    }
    for (const batch of batches) {
      const prev = progressDoc.batches?.[batch.batch_id];
      nextProgress.batches[batch.batch_id] = {
        batch_id: batch.batch_id,
        is_pilot: false,
        status: batch.status,
        retries: batch.retries,
        scene_ids: batch.scene_ids,
        updated_at: prev?.updated_at ?? nowIso,
      };
    }

    for (const scene of allScenes) {
      const prev = progressDoc.scenes?.[scene.scene_id];
      if (reusedSet.has(scene.scene_id)) {
        nextProgress.scenes[scene.scene_id] = prev;
        continue;
      }
      const keptSameBatch = prev && prev.batch_id === scene.batch_id;
      nextProgress.scenes[scene.scene_id] = {
        scene_id: scene.scene_id,
        status: keptSameBatch ? prev.status : 'pending',
        source_sha256: scene.source_sha256,
        extraction_schema_version: null,
        descriptor_labels: descriptorLabelsOf(scene.mechanical_ground_truth),
        batch_id: scene.batch_id,
        retries: keptSameBatch ? prev.retries ?? 0 : 0,
        updated_at: keptSameBatch ? prev.updated_at : nowIso,
      };
    }

    await writeJsonAtomic(progressPath, nextProgress);
  }

  return {
    manifestDoc,
    batches,
    allScenes,
  };
};

export const DEFAULT_PILOT_SCENE_IDS = [
  '2x2_love_1ch_13',
  '2x2_love_1ch_16',
  '2x2_love_1ch_17',
  '2x2_love_1ch_18',
  'second_affection_08',
  'second_affection_09',
  'main_30_07',
  'main_30_08',
  'over_zone_14',
  'main_31_00',
  'hotel_02',
  'hotel_03',
  'coins_in_rush_09',
  'blabla_onemoretime_001',
  '어느남자의수기_00',
];

/**
 * 파일럿 전용 배치를 생성한다 (7.3: pilot_ 접두사 사용, 본 실행 배치와 분리).
 * - 15개 지정 장면을 크기에 맞춰 pilot_0001, pilot_0002로 묶음
 * - 실제 크기 배치 검증용으로 batch_0025와 동일한 장면 구성의 pilot_full_0025 생성
 */
export const buildPilotBatches = async (pilotSceneIds = DEFAULT_PILOT_SCENE_IDS, options = {}) => {
  const outDir = options.outDir ?? GRAPH_DATA_DIR;
  const includeFullBatchId = options.includeFullBatchId ?? 'batch_0025';
  const { allScenes, batches: mainBatches } = await buildManifestAndBatches({
    ...options,
    writeFiles: false,
    ignoreProgress: true,
  });

  const sceneById = new Map(allScenes.map((s) => [s.scene_id, s]));
  const selectedScenes = [];
  for (const id of pilotSceneIds) {
    const found = sceneById.get(id);
    if (!found) {
      throw new Error(`Pilot scene_id not found in registered corpus: ${id}`);
    }
    selectedScenes.push({ ...found });
  }

  // 15개 장면(합계 ~77.9KB)을 크기에 맞춰 1~2개 배치(~43KB / ~35KB 2개)로 분할하되 쌍 장면(main_30_07~08, hotel_02~03)이 한 배치에 묶이도록 설정
  const pilotBatches = packScenesIntoBatches(selectedScenes, {
    batchPrefix: options.batchPrefix ?? 'pilot_',
    minBytes: options.minBytes ?? 34 * 1024,
    targetBytes: options.targetBytes ?? 44 * 1024,
    maxBytes: options.maxBytes ?? 48 * 1024,
  });

  // 실제 크기 배치(batch_0025 복제본 -> pilot_full_0025) 추가 (7.3)
  if (includeFullBatchId) {
    const sourceBatch = mainBatches.find((b) => b.batch_id === includeFullBatchId);
    if (!sourceBatch) {
      throw new Error(`Full batch source "${includeFullBatchId}" not found in main batches.`);
    }
    const suffix = includeFullBatchId.replace(/^batch_/, '');
    const fullPilotBatchId = `pilot_full_${suffix}`;
    const clonedScenes = sourceBatch.scenes.map((s) => ({
      ...s,
      batch_id: fullPilotBatchId,
    }));
    pilotBatches.push({
      batch_id: fullPilotBatchId,
      is_pilot: true,
      scene_ids: clonedScenes.map((s) => s.scene_id),
      scene_count: clonedScenes.length,
      body_bytes: sourceBatch.body_bytes,
      raw_bytes: sourceBatch.raw_bytes,
      unknown_count: sourceBatch.unknown_count,
      scenes: clonedScenes,
    });
  }

  if (options.writeFiles !== false) {
    const batchesDir = path.join(outDir, 'pass1', 'batches');
    await fs.mkdir(batchesDir, { recursive: true });
    for (const batch of pilotBatches) {
      const batchInputPath = path.join(batchesDir, `${batch.batch_id}.json`);
      await writeJsonAtomic(batchInputPath, formatBatchInputPayload(batch));
    }

    const progressPath = path.join(outDir, 'progress.json');
    const progressDoc = await readProgressDoc(progressPath, { resetProgress: options.resetProgress });

    // 기존 pilot_ 항목 정리 후 새 파일럿 배치만 등록
    for (const key of Object.keys(progressDoc.batches)) {
      if (key.startsWith('pilot_')) {
        delete progressDoc.batches[key];
      }
    }

    for (const batch of pilotBatches) {
      const sceneHashes = Object.fromEntries(
        batch.scenes.map((s) => [s.scene_id, s.source_sha256])
      );
      progressDoc.batches[batch.batch_id] = {
        batch_id: batch.batch_id,
        is_pilot: true,
        status: 'pending',
        retries: 0,
        scene_ids: batch.scene_ids,
        scene_hashes: sceneHashes,
        updated_at: new Date().toISOString(),
      };
      progressDoc.schema_version = PASS1_SCHEMA_VERSION;
    }
    progressDoc.updated_at = new Date().toISOString();
    await writeJsonAtomic(progressPath, progressDoc);
  }

  return pilotBatches;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const pilotScenesArg = args.find((a) => a.startsWith('--pilot-scenes='));
  const isDefaultPilot = args.includes('--pilot');
  const resetProgress = args.includes('--reset-progress');

  if (pilotScenesArg || isDefaultPilot) {
    const ids = pilotScenesArg
      ? pilotScenesArg
          .slice('--pilot-scenes='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_PILOT_SCENE_IDS;
    const includeFullBatchId = pilotScenesArg ? null : 'batch_0025';
    // 파일럿은 progress.json의 본 실행 장면 기록을 지우지 않도록 --reset-progress를 받지 않는다
    buildPilotBatches(ids, { includeFullBatchId })
      .then((pilotBatches) => {
        for (const b of pilotBatches) {
          console.log(
            `[build-manifest] Pilot batch ${b.batch_id}: ${b.scene_count} scenes, raw_bytes=${b.raw_bytes}, unknown_count=${b.unknown_count}, scenes=[${b.scene_ids.join(', ')}]`
          );
        }
      })
      .catch((err) => {
        console.error('[build-manifest] Pilot Error:', err);
        process.exitCode = 1;
      });
  } else {
    buildManifestAndBatches({ resetProgress })
      .then(({ manifestDoc }) => {
        const t = manifestDoc.totals;
        console.log(`[build-manifest] Reused scenes: ${t.reused_scenes_count}, batches to extract: ${t.batches_count}`);
        console.log(
          `[build-manifest] Categories: ${t.categories_count}, Titles: ${t.titles_count}, Scenes: ${t.scenes_count}, Raw File Bytes: ${t.total_raw_file_bytes} (${(
            t.total_raw_file_bytes /
            1024 /
            1024
          ).toFixed(2)} MB), Body Bytes: ${t.total_body_bytes} (${(
            t.total_body_bytes /
            1024 /
            1024
          ).toFixed(2)} MB), Unknown (???): ${t.total_unknown_lines}, Batches: ${t.batches_count}`
        );
      })
      .catch((err) => {
        console.error('[build-manifest] Error:', err);
        process.exitCode = 1;
      });
  }
}
