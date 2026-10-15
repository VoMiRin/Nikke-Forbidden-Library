import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_DATA_DIR,
  PASS1_SCHEMA_VERSION,
  writeJsonAtomic,
  getBranchingOptionRanges,
  resolveBranchOption,
  chronologyAtLine,
  descriptorLabelsOf,
  emptyProgressDoc,
} from './lib.mjs';
import { validateShard, FORBIDDEN_SCENE_FIELDS, FORBIDDEN_ITEM_FIELDS } from './validate-output.mjs';

const __filename = fileURLToPath(import.meta.url);

const stripForbiddenItemFields = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const clone = { ...item };
  for (const field of FORBIDDEN_ITEM_FIELDS) {
    delete clone[field];
  }
  delete clone.branch_specific_facts;
  return clone;
};

/**
 * 근거 항목의 시점을 정한다 (3절 8항): character_claim은 claim_line, 그 외는 line_start 기준.
 * 검증기(2.3의 13항)가 character_claim이 아닌 항목의 구간 경계 걸침을 막으므로 line_start 하나로 정해진다.
 */
const chronologyForItem = (scene, item) => {
  const anchor =
    item.epistemic_type === 'character_claim' && Number.isInteger(item.claim_line)
      ? item.claim_line
      : item.line_start;
  return chronologyAtLine(scene.chronology_type, scene.chronology_segments, anchor);
};

/**
 * 장면 객체에서 모델이 임의로 썼을 수 있는 금지 필드를 제거하고,
 * 매니페스트의 권위 있는 값과 항목별 고유 item_id, 시점, 분기 소속을 부여한다 (2.3의 18항 & 4절).
 * mechanicalGroundTruth가 없으면 manifestScene.mechanical_ground_truth를 쓴다.
 */
export const enrichSceneFromManifest = (rawScene, manifestScene, mechanicalGroundTruth = null) => {
  const cleanScene = { ...rawScene };
  for (const field of FORBIDDEN_SCENE_FIELDS) {
    delete cleanScene[field];
  }
  const segments = Array.isArray(cleanScene.chronology_segments) ? cleanScene.chronology_segments : [];
  const sceneForChronology = { chronology_type: cleanScene.chronology_type, chronology_segments: segments };

  const mgt = mechanicalGroundTruth ?? manifestScene.mechanical_ground_truth ?? {};
  const optionRanges = getBranchingOptionRanges(mgt);
  const unknownIdByLine = new Map((mgt.unknowns ?? []).map((u) => [u.line, u.unknown_id]));

  const sid = manifestScene.scene_id;
  const attachItemIds = (arr, prefix) =>
    (Array.isArray(arr) ? arr : []).map((item, idx) => ({
      item_id: `${sid}__${prefix}_${String(idx + 1).padStart(3, '0')}`,
      ...stripForbiddenItemFields(item),
    }));

  // 근거 항목(2.3의 12항 목록)에 시점과 분기 소속을 붙인다
  const withLineContext = (item) => {
    if (!Number.isInteger(item.line_start) || !Number.isInteger(item.line_end)) return item;
    return {
      ...item,
      chronology_type: chronologyForItem(sceneForChronology, item),
      in_branch_option: resolveBranchOption(optionRanges, item.line_start, item.line_end).option,
    };
  };
  const attachEvidence = (arr, prefix) => attachItemIds(arr, prefix).map(withLineContext);

  const withClaimantUnknownId = (item, speakerField) => {
    if (item.epistemic_type !== 'character_claim' || item[speakerField] !== '???') return item;
    return { ...item, claimant_unknown_id: unknownIdByLine.get(item.claim_line) ?? null };
  };

  const resolvedWithContext = (res) =>
    res && typeof res === 'object' ? withLineContext(stripForbiddenItemFields(res)) : null;

  const participants = {
    present_in_scene: attachItemIds(cleanScene.participants?.present_in_scene, 'pis'),
    present_silent: attachEvidence(cleanScene.participants?.present_silent, 'psl'),
    remote_or_voice_only: attachItemIds(cleanScene.participants?.remote_or_voice_only, 'rvo'),
    mentioned_only: attachEvidence(cleanScene.participants?.mentioned_only, 'mnt'),
    document_author:
      cleanScene.participants?.document_author &&
      typeof cleanScene.participants.document_author === 'object'
        ? {
            item_id: `${sid}__dca_001`,
            ...stripForbiddenItemFields(cleanScene.participants.document_author),
          }
        : null,
  };

  // unknown_speakers는 unknown_id의 줄로 시점·분기를 붙인다 (3절 8항)
  const unknownLineById = new Map((mgt.unknowns ?? []).map((u) => [u.unknown_id, u.line]));
  const unknownSpeakers = attachItemIds(cleanScene.unknown_speakers, 'unk').map((u) => {
    const line = unknownLineById.get(u.unknown_id);
    return {
      ...u,
      ...(Number.isInteger(line)
        ? {
            line,
            chronology_type: chronologyAtLine(sceneForChronology.chronology_type, segments, line),
            in_branch_option: resolveBranchOption(optionRanges, line, line).option,
          }
        : {}),
      resolved_in_same_scene_to: resolvedWithContext(u.resolved_in_same_scene_to),
    };
  });

  const descriptorSpeakers = attachItemIds(cleanScene.descriptor_speakers, 'dsp').map((d) => ({
    ...d,
    resolved_in_same_scene_to: resolvedWithContext(d.resolved_in_same_scene_to),
  }));

  const choiceBranches = attachItemIds(cleanScene.choice_branches, 'chb').map((cb) => ({
    ...cb,
    options: (Array.isArray(cb.options) ? cb.options : []).map((opt, oIdx) => ({
      item_id: `${cb.item_id}_opt_${String(oIdx + 1).padStart(2, '0')}`,
      ...stripForbiddenItemFields(opt),
    })),
  }));

  const eventsAndClaims = attachEvidence(cleanScene.events_and_claims, 'eac').map((ev) =>
    withClaimantUnknownId({ ...ev, confidence: ev.confidence ?? null }, 'actor_or_speaker')
  );

  const relationshipNotes = attachEvidence(cleanScene.relationship_and_lore_notes, 'rln').map((rel) =>
    withClaimantUnknownId(rel, 'claimant')
  );

  return {
    scene_id: sid,
    title_id: manifestScene.title_id,
    category: manifestScene.category,
    source_file: manifestScene.source_file,
    source_sha256: manifestScene.source_sha256,
    route: manifestScene.route,
    mechanical_validated: true,
    chronology_type: cleanScene.chronology_type,
    chronology_segments: segments,
    is_plot_critical: cleanScene.is_plot_critical,
    summary: cleanScene.summary,
    participants,
    forms_of_address: attachEvidence(cleanScene.forms_of_address, 'foa'),
    unknown_speakers: unknownSpeakers,
    descriptor_speakers: descriptorSpeakers,
    same_scene_speaker_groups: attachItemIds(cleanScene.same_scene_speaker_groups, 'ssg'),
    cross_scene_hints: attachItemIds(cleanScene.cross_scene_hints, 'csh'),
    choice_branches: choiceBranches,
    events_and_claims: eventsAndClaims,
    clues_and_hooks: attachEvidence(cleanScene.clues_and_hooks, 'clh'),
    relationship_and_lore_notes: relationshipNotes,
    unregistered_entity_candidates: attachItemIds(
      cleanScene.unregistered_entity_candidates,
      'uec'
    ),
  };
};

/**
 * 배치 안 장면 위치(앞·중간·뒤 3등분)별 events_and_claims 밀도를 계산한다 (2.3의 20항).
 * 밀도는 대사 100줄당 항목 수다.
 */
export const computeBatchDensity = (shardScenes, batchInput) => {
  const gtById = new Map((batchInput?.scenes ?? []).map((s) => [s.scene_id, s]));
  const thirds = [
    { position: 'front', events: 0, dialogue_lines: 0 },
    { position: 'middle', events: 0, dialogue_lines: 0 },
    { position: 'back', events: 0, dialogue_lines: 0 },
  ];
  const n = shardScenes.length;
  shardScenes.forEach((scene, idx) => {
    const third = thirds[Math.min(2, Math.floor((idx * 3) / Math.max(1, n)))];
    const lineSpeaker = gtById.get(scene.scene_id)?.mechanical_ground_truth?.line_speaker ?? {};
    third.events += Array.isArray(scene.events_and_claims) ? scene.events_and_claims.length : 0;
    third.dialogue_lines += Object.keys(lineSpeaker).length;
  });
  return thirds.map((t) => ({
    ...t,
    events_per_100_lines: t.dialogue_lines > 0 ? Math.round((t.events / t.dialogue_lines) * 1000) / 10 : null,
  }));
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
  const descriptorSpeakersIndex = [];
  const relationshipsByEntity = {};
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
        line: unk.line ?? null,
        chronology_type: unk.chronology_type ?? null,
        in_branch_option: unk.in_branch_option ?? null,
        quote: unk.quote,
        speaking_style: unk.speaking_style,
        target_addressed: unk.target_addressed,
        contextual_clues: unk.contextual_clues,
        resolved_in_same_scene_to: unk.resolved_in_same_scene_to,
      });
    }

    // 2-1. 묘사형 화자 역색인 (3절 3항)
    for (const dsp of scene.descriptor_speakers ?? []) {
      descriptorSpeakersIndex.push({
        speaker_label: dsp.speaker_label,
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: dsp.item_id,
        line_start: dsp.line_start,
        line_end: dsp.line_end,
        quote: dsp.quote,
        speaking_style: dsp.speaking_style,
        target_addressed: dsp.target_addressed,
        contextual_clues: dsp.contextual_clues,
        resolved_in_same_scene_to: dsp.resolved_in_same_scene_to,
      });
    }

    // 2-2. 관계 메모 역색인: subject와 target 양쪽 표기로 찾을 수 있게 한다 (3절 9항)
    for (const rel of scene.relationship_and_lore_notes ?? []) {
      const entry = {
        scene_id: sid,
        title_id: tid,
        category: cat,
        item_id: rel.item_id,
        subject: rel.subject,
        target: rel.target,
        relation_or_change: rel.relation_or_change,
        epistemic_type: rel.epistemic_type,
        claimant: rel.claimant ?? null,
        claimant_unknown_id: rel.claimant_unknown_id ?? null,
        chronology_type: rel.chronology_type ?? null,
        in_branch_option: rel.in_branch_option ?? null,
        refers_to_past: rel.refers_to_past,
        line_start: rel.line_start,
        line_end: rel.line_end,
        quote: rel.quote,
      };
      for (const surface of new Set([rel.subject, rel.target])) {
        const key = String(surface).normalize('NFKC').trim();
        if (!relationshipsByEntity[key]) relationshipsByEntity[key] = [];
        relationshipsByEntity[key].push(entry);
      }
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
        chronology_type: fa.chronology_type ?? null,
        in_branch_option: fa.in_branch_option ?? null,
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
        subject: clue.subject ?? null,
        detail: clue.detail,
        chronology_type: clue.chronology_type ?? null,
        in_branch_option: clue.in_branch_option ?? null,
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
    schema_version: PASS1_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    is_pilot: Boolean(metadata.isPilot),
    merged_batches_count: metadata.mergedBatchIds?.length ?? 0,
    merged_batch_ids: metadata.mergedBatchIds ?? [],
    merged_scenes_count: enrichedScenes.length,
    entities: byEntity,
    unknown_speakers: unknownSpeakersIndex,
    descriptor_speakers: descriptorSpeakersIndex,
    relationships_by_entity: relationshipsByEntity,
    forms_of_address: formsOfAddressIndex,
    clues_by_keyword: clueKeywordsIndex,
    clues_by_category: clueCategoriesIndex,
  };

  const unregisteredCandidatesDoc = {
    schema_version: PASS1_SCHEMA_VERSION,
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
  const densityByBatch = {};
  const densityWarnings = [];
  const mergedSceneRecords = [];

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
    densityByBatch[batchId] = computeBatchDensity(shardData.scenes, batchInput);
    densityWarnings.push(
      ...validation.warnings.filter((w) => w.rule === 'DENSITY').map((w) => ({ batch_id: batchId, ...w }))
    );

    const gtById = new Map((batchInput.scenes ?? []).map((s) => [s.scene_id, s]));
    for (const rawScene of shardData.scenes) {
      const mScene = manifestScenes[rawScene.scene_id];
      if (!mScene) {
        throw new Error(`Scene "${rawScene.scene_id}" in shard "${batchId}" not found in manifest.json`);
      }
      const gtScene = gtById.get(rawScene.scene_id);
      enrichedScenes.push(enrichSceneFromManifest(rawScene, mScene, gtScene?.mechanical_ground_truth ?? null));
      mergedSceneRecords.push({
        scene_id: rawScene.scene_id,
        batch_id: batchId,
        source_sha256: mScene.source_sha256,
        extraction_schema_version: shardData.schema_version,
        descriptor_labels: descriptorLabelsOf(gtScene?.mechanical_ground_truth ?? mScene.mechanical_ground_truth),
      });
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
      schema_version: PASS1_SCHEMA_VERSION,
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

  // 밀도 보고 (2.3의 20항)
  const densityReportPath = path.join(targetBaseDir, 'pass1_density_report.json');
  const densityTotals = ['front', 'middle', 'back'].map((position) => {
    const parts = Object.values(densityByBatch).map((thirds) => thirds.find((t) => t.position === position));
    const events = parts.reduce((acc, t) => acc + t.events, 0);
    const lines = parts.reduce((acc, t) => acc + t.dialogue_lines, 0);
    return {
      position,
      events,
      dialogue_lines: lines,
      events_per_100_lines: lines > 0 ? Math.round((events / lines) * 1000) / 10 : null,
    };
  });
  const densityReportDoc = {
    schema_version: PASS1_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    is_pilot: isPilot,
    totals_by_position: densityTotals,
    by_batch: densityByBatch,
    empty_event_warnings: densityWarnings,
  };
  await writeJsonAtomic(densityReportPath, densityReportDoc);

  // progress.json 원자적 갱신: 배치 요약 + 본 실행은 장면 단위 (8절 1단계)
  const progressPath = path.join(graphDir, 'progress.json');
  let progressDoc = emptyProgressDoc();
  if (fsSync.existsSync(progressPath)) {
    try {
      progressDoc = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    } catch {
      // fallback
    }
  }
  progressDoc.batches = progressDoc.batches ?? {};
  progressDoc.scenes = progressDoc.scenes ?? {};

  const nowIso = new Date().toISOString();
  for (const batchId of mergedBatchIds) {
    progressDoc.batches[batchId] = {
      batch_id: batchId,
      is_pilot: isPilot,
      retries: 0,
      ...progressDoc.batches[batchId],
      status: 'merged',
      updated_at: nowIso,
    };
  }
  if (!isPilot) {
    for (const record of mergedSceneRecords) {
      progressDoc.scenes[record.scene_id] = {
        retries: 0,
        ...progressDoc.scenes[record.scene_id],
        ...record,
        status: 'merged',
        updated_at: nowIso,
      };
    }
  }
  progressDoc.schema_version = PASS1_SCHEMA_VERSION;
  progressDoc.updated_at = nowIso;
  await writeJsonAtomic(progressPath, progressDoc);

  return {
    isPilot,
    mergedBatchIds,
    skippedBatches,
    mergedScenesCount: enrichedScenes.length,
    pass1IndexPath,
    unregisteredPath,
    densityReportPath,
    writtenTitleViewPaths,
    pass1IndexDoc,
    unregisteredCandidatesDoc,
    densityReportDoc,
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
