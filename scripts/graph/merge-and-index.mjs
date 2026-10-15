import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, writeJsonAtomic } from './lib.mjs';
import { validateShard, FORBIDDEN_SCENE_FIELDS } from './validate-output.mjs';

const __filename = fileURLToPath(import.meta.url);

const stripForbiddenItemFields = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const clone = { ...item };
  delete clone.item_id;
  return clone;
};

/**
 * 장면 객체에서 모델이 임의로 썼을 수 있는 금지 필드를 제거하고,
 * 매니페스트의 권위 있는 값과 항목별 고유 item_id를 부여한다 (2.3.8 & 4절).
 */
export const enrichSceneFromManifest = (rawScene, manifestScene) => {
  const cleanScene = { ...rawScene };
  for (const field of FORBIDDEN_SCENE_FIELDS) {
    delete cleanScene[field];
  }

  const sid = manifestScene.scene_id;
  const attachItemIds = (arr, prefix) =>
    (Array.isArray(arr) ? arr : []).map((item, idx) => ({
      item_id: `${sid}__${prefix}_${String(idx + 1).padStart(3, '0')}`,
      ...stripForbiddenItemFields(item),
    }));

  const participants = {
    present_in_scene: attachItemIds(cleanScene.participants?.present_in_scene, 'pis'),
    present_silent: attachItemIds(cleanScene.participants?.present_silent, 'psl'),
    remote_or_voice_only: attachItemIds(cleanScene.participants?.remote_or_voice_only, 'rvo'),
    mentioned_only: attachItemIds(cleanScene.participants?.mentioned_only, 'mnt'),
    document_author:
      cleanScene.participants?.document_author &&
      typeof cleanScene.participants.document_author === 'object'
        ? {
            item_id: `${sid}__dca_001`,
            ...stripForbiddenItemFields(cleanScene.participants.document_author),
          }
        : null,
  };

  const unknownSpeakers = attachItemIds(cleanScene.unknown_speakers, 'unk').map((u) => ({
    ...u,
    resolved_in_same_scene_to:
      u.resolved_in_same_scene_to && typeof u.resolved_in_same_scene_to === 'object'
        ? stripForbiddenItemFields(u.resolved_in_same_scene_to)
        : null,
  }));

  const choiceBranches = attachItemIds(cleanScene.choice_branches, 'chb').map((cb) => ({
    ...cb,
    options: (Array.isArray(cb.options) ? cb.options : []).map((opt, oIdx) => ({
      item_id: `${cb.item_id}_opt_${String(oIdx + 1).padStart(2, '0')}`,
      ...stripForbiddenItemFields(opt),
    })),
  }));

  const eventsAndClaims = attachItemIds(cleanScene.events_and_claims, 'eac').map((ev) => ({
    item_id: ev.item_id,
    epistemic_type: ev.epistemic_type,
    chronology_type: ev.chronology_type,
    confidence: ev.confidence ?? null,
    ...ev,
    confidence: ev.confidence ?? null,
  }));

  return {
    scene_id: sid,
    title_id: manifestScene.title_id,
    category: manifestScene.category,
    source_file: manifestScene.source_file,
    source_sha256: manifestScene.source_sha256,
    route: manifestScene.route,
    mechanical_validated: true,
    chronology_type: cleanScene.chronology_type,
    is_plot_critical: cleanScene.is_plot_critical,
    summary: cleanScene.summary,
    participants,
    forms_of_address: attachItemIds(cleanScene.forms_of_address, 'foa'),
    unknown_speakers: unknownSpeakers,
    same_scene_speaker_groups: attachItemIds(cleanScene.same_scene_speaker_groups, 'ssg'),
    cross_scene_hints: attachItemIds(cleanScene.cross_scene_hints, 'csh'),
    choice_branches: choiceBranches,
    events_and_claims: eventsAndClaims,
    clues_and_hooks: attachItemIds(cleanScene.clues_and_hooks, 'clh'),
    relationship_and_lore_notes: attachItemIds(cleanScene.relationship_and_lore_notes, 'rln'),
    unregistered_entity_candidates: attachItemIds(
      cleanScene.unregistered_entity_candidates,
      'uec'
    ),
  };
};

/**
 * 병합된 장면 배열로부터 Pass 1 역색인(pass1_index.json)과 미등록 엔티티 후보 집계표를 생성한다 (5절).
 */
export const buildPass1IndexAndCandidates = (enrichedScenes, metadata = {}) => {
  const byEntity = {};
  const ensureEntityBucket = (key, label = null, entityType = 'character') => {
    if (!byEntity[key]) {
      byEntity[key] = {
        key,
        canonical_or_surface: label ?? key,
        entity_type: entityType,
        present_in_scene: [],
        present_silent: [],
        remote_or_voice_only: [],
        mentioned_only: [],
      };
    }
    return byEntity[key];
  };

  const unknownSpeakersIndex = [];
  const formsOfAddressIndex = {};
  const clueKeywordsIndex = {};
  const clueCategoriesIndex = {};
  const unregisteredAggMap = new Map();

  for (const scene of enrichedScenes) {
    const sid = scene.scene_id;
    const tid = scene.title_id;
    const cat = scene.category;

    // 1. 엔티티별 참여 상태 역색인 (present_in_scene / present_silent / remote_or_voice_only / mentioned_only)
    for (const p of scene.participants.present_in_scene) {
      const key = p.entity_id || `surface:${p.speaker_label}`;
      const bucket = ensureEntityBucket(key, p.speaker_label, 'character');
      bucket.present_in_scene.push({
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: p.item_id,
        speaker_label: p.speaker_label,
        is_generic_role: p.is_generic_role,
      });
    }

    for (const p of scene.participants.present_silent) {
      const key = p.entity_id || `surface:${p.name}`;
      const bucket = ensureEntityBucket(key, p.name, 'character');
      bucket.present_silent.push({
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: p.item_id,
        name: p.name,
        line_start: p.line_start,
        line_end: p.line_end,
        quote: p.quote,
      });
    }

    for (const p of scene.participants.remote_or_voice_only) {
      const key = p.entity_id || `surface:${p.speaker_label}`;
      const bucket = ensureEntityBucket(key, p.speaker_label, 'character');
      bucket.remote_or_voice_only.push({
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: p.item_id,
        speaker_label: p.speaker_label,
        medium: p.medium,
        line_start: p.line_start,
        line_end: p.line_end,
        quote: p.quote,
      });
    }

    for (const p of scene.participants.mentioned_only) {
      const key = p.entity_id || `surface:${p.surface_text}`;
      const bucket = ensureEntityBucket(key, p.surface_text, p.entity_type);
      bucket.mentioned_only.push({
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: p.item_id,
        surface_text: p.surface_text,
        entity_type: p.entity_type,
        line_start: p.line_start,
        line_end: p.line_end,
        quote: p.quote,
      });
    }

    // 2. 미상 화자(???) 역색인
    for (const unk of scene.unknown_speakers) {
      unknownSpeakersIndex.push({
        unknown_id: unk.unknown_id,
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: unk.item_id,
        quote: unk.quote,
        speaking_style: unk.speaking_style,
        target_addressed: unk.target_addressed,
        contextual_clues: unk.contextual_clues,
        resolved_in_same_scene_to: unk.resolved_in_same_scene_to,
      });
    }

    // 3. 호칭(forms_of_address) 역색인
    for (const fa of scene.forms_of_address) {
      const termKey = fa.address_term.normalize('NFKC').trim();
      if (!formsOfAddressIndex[termKey]) {
        formsOfAddressIndex[termKey] = [];
      }
      formsOfAddressIndex[termKey].push({
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: fa.item_id,
        from_speaker: fa.from_speaker,
        to_target: fa.to_target,
        address_term: fa.address_term,
        line_start: fa.line_start,
        line_end: fa.line_end,
        quote: fa.quote,
      });
    }

    // 4. 단서 키워드 및 카테고리 역색인 (clues_and_hooks)
    for (const clue of scene.clues_and_hooks) {
      const kwKey = clue.keyword.normalize('NFKC').trim();
      if (!clueKeywordsIndex[kwKey]) {
        clueKeywordsIndex[kwKey] = [];
      }
      const entry = {
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: clue.item_id,
        keyword: clue.keyword,
        clue_category: clue.category,
        detail: clue.detail,
        line_start: clue.line_start,
        line_end: clue.line_end,
        quote: clue.quote,
      };
      clueKeywordsIndex[kwKey].push(entry);

      if (!clueCategoriesIndex[clue.category]) {
        clueCategoriesIndex[clue.category] = [];
      }
      clueCategoriesIndex[clue.category].push(entry);
    }

    // 5. 미등록 신규 엔티티 후보 집계 (1.6 & 5절)
    for (const cand of scene.unregistered_entity_candidates) {
      const surface = cand.surface_text.normalize('NFKC').trim();
      const mapKey = `${cand.suggested_type}::${surface}`;
      if (!unregisteredAggMap.has(mapKey)) {
        unregisteredAggMap.set(mapKey, {
          surface_text: surface,
          suggested_type: cand.suggested_type,
          occurrence_count: 0,
          occurrences: [],
        });
      }
      const agg = unregisteredAggMap.get(mapKey);
      agg.occurrence_count += 1;
      agg.occurrences.push({
        scene_id: sid,
        title_id: tid,
        item_id: cand.item_id,
        line_start: cand.line_start,
      });
    }
  }

  const pass1IndexDoc = {
    schema_version: '1.2.0',
    generated_at: new Date().toISOString(),
    is_pilot: Boolean(metadata.isPilot),
    merged_batches_count: metadata.mergedBatchIds?.length ?? 0,
    merged_batch_ids: metadata.mergedBatchIds ?? [],
    merged_scenes_count: enrichedScenes.length,
    entities: byEntity,
    unknown_speakers: unknownSpeakersIndex,
    forms_of_address: formsOfAddressIndex,
    clues_by_keyword: clueKeywordsIndex,
    clues_by_category: clueCategoriesIndex,
  };

  const unregisteredCandidatesDoc = {
    schema_version: '1.2.0',
    generated_at: new Date().toISOString(),
    is_pilot: Boolean(metadata.isPilot),
    total_candidates: unregisteredAggMap.size,
    candidates: [...unregisteredAggMap.values()].sort(
      (a, b) => b.occurrence_count - a.occurrence_count || a.surface_text.localeCompare(b.surface_text, 'ko')
    ),
  };

  return {
    pass1IndexDoc,
    unregisteredCandidatesDoc,
  };
};

/**
 * 검증을 통과한 샤드만 모아 병합·역색인·타이틀별 뷰·progress.json을 원자적으로 갱신한다 (5절).
 */
export const mergeValidatedShards = async (options = {}) => {
  const graphDir = options.graphDir ?? GRAPH_DATA_DIR;
  const isPilot = Boolean(options.pilot);
  const shardPrefix = options.shardPrefix ?? (isPilot ? 'pilot_' : 'batch_');

  const manifestPath = options.manifestPath ?? path.join(graphDir, 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }
  const manifestDoc = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifestScenes = manifestDoc.scenes ?? {};
  const manifestTitlesById = new Map((manifestDoc.titles ?? []).map((t) => [t.title_id, t]));

  const shardsDir = options.shardsDir ?? path.join(graphDir, 'pass1', 'shards');
  const batchesDir = options.batchesDir ?? path.join(graphDir, 'pass1', 'batches');

  let shardFiles = [];
  if (fsSync.existsSync(shardsDir)) {
    const entries = await fs.readdir(shardsDir);
    shardFiles = entries
      .filter((name) => name.startsWith(shardPrefix) && name.endsWith('.json'))
      .sort();
  }

  const enrichedScenes = [];
  const mergedBatchIds = [];
  const skippedBatches = [];

  for (const fileName of shardFiles) {
    const shardPath = path.join(shardsDir, fileName);
    const shardData = JSON.parse(await fs.readFile(shardPath, 'utf8'));
    const batchId = shardData.batch_id || path.basename(fileName, '.json');
    const batchInputPath = path.join(batchesDir, `${batchId}.json`);

    if (!fsSync.existsSync(batchInputPath)) {
      skippedBatches.push({
        batch_id: batchId,
        reason: `Missing batch input file: ${batchInputPath}`,
      });
      continue;
    }

    const batchInput = JSON.parse(await fs.readFile(batchInputPath, 'utf8'));
    const validation = validateShard(shardData, batchInput);

    // 통과한 샤드만 병합 대상에 포함한다 (5절)
    if (!validation.valid) {
      skippedBatches.push({
        batch_id: batchId,
        reason: `Validation failed with ${validation.errors.length} error(s)`,
        errors: validation.errors,
      });
      continue;
    }

    mergedBatchIds.push(batchId);

    for (const rawScene of shardData.scenes) {
      const mScene = manifestScenes[rawScene.scene_id];
      if (!mScene) {
        throw new Error(`Scene "${rawScene.scene_id}" in shard "${batchId}" not found in manifest.json`);
      }
      enrichedScenes.push(enrichSceneFromManifest(rawScene, mScene));
    }
  }

  // 출력 경로 결정 (파일럿은 본 실행 결과와 섞이지 않도록 분리 가능)
  const targetBaseDir = isPilot ? path.join(graphDir, 'pilot') : graphDir;
  const byTitleDir = isPilot
    ? path.join(targetBaseDir, 'by_title')
    : path.join(graphDir, 'pass1', 'by_title');

  await fs.mkdir(byTitleDir, { recursive: true });

  // 타이틀별 뷰 생성
  const scenesByTitle = new Map();
  for (const scene of enrichedScenes) {
    if (!scenesByTitle.has(scene.title_id)) {
      scenesByTitle.set(scene.title_id, []);
    }
    scenesByTitle.get(scene.title_id).push(scene);
  }

  const writtenTitleViewPaths = [];
  for (const [titleId, titleScenes] of scenesByTitle.entries()) {
    const titleMeta = manifestTitlesById.get(titleId) ?? {
      title_id: titleId,
      category: titleScenes[0]?.category ?? null,
      title: titleId,
      source_file: titleScenes[0]?.source_file ?? null,
    };
    const titleViewDoc = {
      schema_version: '1.2.0',
      generated_at: new Date().toISOString(),
      title_id: titleId,
      category: titleMeta.category,
      title: titleMeta.title,
      source_file: titleMeta.source_file,
      scene_count: titleScenes.length,
      scenes: titleScenes,
    };
    const viewPath = path.join(byTitleDir, `${titleId}.json`);
    await writeJsonAtomic(viewPath, titleViewDoc);
    writtenTitleViewPaths.push(viewPath);
  }

  // 역색인 및 미등록 엔티티 후보 생성
  const { pass1IndexDoc, unregisteredCandidatesDoc } = buildPass1IndexAndCandidates(
    enrichedScenes,
    {
      isPilot,
      mergedBatchIds,
    }
  );

  const pass1IndexPath = path.join(targetBaseDir, 'pass1_index.json');
  const unregisteredPath = path.join(targetBaseDir, 'unregistered_entity_candidates.json');

  await writeJsonAtomic(pass1IndexPath, pass1IndexDoc);
  await writeJsonAtomic(unregisteredPath, unregisteredCandidatesDoc);

  // progress.json 원자적 갱신
  const progressPath = path.join(graphDir, 'progress.json');
  let progressDoc = {
    schema_version: '1.2.0',
    updated_at: new Date().toISOString(),
    batches: {},
  };
  if (fsSync.existsSync(progressPath)) {
    try {
      progressDoc = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    } catch {
      // fallback
    }
  }

  const nowIso = new Date().toISOString();
  for (const batchId of mergedBatchIds) {
    if (progressDoc.batches?.[batchId]) {
      progressDoc.batches[batchId].status = 'merged';
      progressDoc.batches[batchId].updated_at = nowIso;
    } else {
      progressDoc.batches[batchId] = {
        batch_id: batchId,
        is_pilot: isPilot,
        status: 'merged',
        retries: 0,
        updated_at: nowIso,
      };
    }
  }
  progressDoc.updated_at = nowIso;
  await writeJsonAtomic(progressPath, progressDoc);

  return {
    isPilot,
    mergedBatchIds,
    skippedBatches,
    mergedScenesCount: enrichedScenes.length,
    pass1IndexPath,
    unregisteredPath,
    writtenTitleViewPaths,
    pass1IndexDoc,
    unregisteredCandidatesDoc,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const isPilot = args.includes('--pilot');

  mergeValidatedShards({ pilot: isPilot })
    .then((res) => {
      console.log(
        `[merge-and-index] Mode: ${res.isPilot ? 'pilot' : 'main'}, Merged batches: ${
          res.mergedBatchIds.length
        }, Merged scenes: ${res.mergedScenesCount}, Skipped batches: ${
          res.skippedBatches.length
        }, Index: ${res.pass1IndexPath}`
      );
    })
    .catch((err) => {
      console.error('[merge-and-index] Error:', err);
      process.exitCode = 1;
    });
}
