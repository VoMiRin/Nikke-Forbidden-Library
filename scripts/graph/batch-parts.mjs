import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  GRAPH_DATA_DIR,
  PASS1_SCHEMA_VERSION,
  countedLinesOf,
  planSceneParts,
  splitLinesOf,
  writeJsonAtomic,
} from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 5절 Pass 1: 장면 수(20개)나 줄 수(700줄) 상한을 넘는 배치는 서브에이전트 호출만 나눠 돌리고 하나의 샤드로 합친다.
// 부분 샤드는 병합기가 읽지 않도록 pass1/shards/ 밖의 pass1/parts/에 둔다.
// 부분마다 그 부분 장면만 담은 담당 입력(pass1/part_inputs/)을 만들어, 서브에이전트가 다른 부분의 장면을 읽지 않게 한다.

export const partPathOf = (batchId, partNo, graphDir = GRAPH_DATA_DIR) =>
  path.join(graphDir, 'pass1', 'parts', `${batchId}.part${partNo}.json`);

export const partInputPathOf = (batchId, partNo, graphDir = GRAPH_DATA_DIR) =>
  path.join(graphDir, 'pass1', 'part_inputs', `${batchId}.part${partNo}.json`);

export const readBatchInput = async (batchId, graphDir = GRAPH_DATA_DIR) =>
  JSON.parse(await fs.readFile(path.join(graphDir, 'pass1', 'batches', `${batchId}.json`), 'utf8'));

export const planBatchParts = (batchInput) => {
  const scenes = batchInput.scenes ?? [];
  const linesById = new Map(scenes.map((s) => [s.scene_id, splitLinesOf(s)]));
  return planSceneParts(
    scenes.map((s) => s.scene_id),
    { lineCounts: scenes.map((s) => linesById.get(s.scene_id)) }
  ).map((sceneIds, idx) => ({
    part: idx + 1,
    scene_ids: sceneIds,
    line_count: sceneIds.reduce((sum, id) => sum + linesById.get(id), 0),
  }));
};

/**
 * 부분 하나의 담당 입력. 장면 객체는 배치 입력 그대로 두고, 집계 값만 그 부분 장면으로 다시 센다.
 */
export const buildPartInput = (batchInput, part) => {
  const plan = planBatchParts(batchInput);
  const entry = plan.find((p) => p.part === part);
  if (!entry) throw new Error(`${batchInput.batch_id}: no part ${part} (plan has ${plan.length})`);
  const byId = new Map((batchInput.scenes ?? []).map((s) => [s.scene_id, s]));
  const scenes = entry.scene_ids.map((id) => byId.get(id));
  const sum = (fn) => scenes.reduce((acc, s) => acc + fn(s), 0);
  return {
    ...batchInput,
    part,
    part_count: plan.length,
    scene_count: scenes.length,
    body_bytes: sum((s) => s.body_bytes ?? 0),
    raw_bytes: sum((s) => s.raw_bytes ?? 0),
    unknown_count: sum((s) => s.mechanical_ground_truth?.unknowns?.length ?? 0),
    scenes,
  };
};

/**
 * 담당 입력이 지금 배치 입력과 같은 장면을 담고 있는지 확인한다. 배치 입력이 바뀐 뒤 옛 담당 입력으로 추출하는 것을 막는다.
 * 문제가 없으면 null, 있으면 이유를 돌려준다.
 */
export const partInputMismatch = (batchInput, part, partInput) => {
  const expected = buildPartInput(batchInput, part);
  if (partInput?.batch_id !== expected.batch_id || partInput?.part !== part) {
    return `part input is for ${partInput?.batch_id} part ${partInput?.part}, expected ${expected.batch_id} part ${part}`;
  }
  if (!isDeepStrictEqual(partInput.scenes, expected.scenes)) {
    return 'part input scenes differ from the batch input; run "batch-parts.mjs plan" again';
  }
  return null;
};

/**
 * progress.json에서 아직 끝나지 않은 본 실행 배치를 번호 순으로 count개 고른다(5절 Pass 1 본 실행 회차).
 */
export const nextPendingBatches = (progressDoc, count) =>
  Object.values(progressDoc.batches ?? {})
    .filter((b) => !b.is_pilot && b.status === 'pending')
    .map((b) => b.batch_id)
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .slice(0, count);

/**
 * 회차의 독립 표본 검토 장면을 기계적으로 고른다(5절 Pass 1 본 실행 회차).
 * 1) ??? 줄이 가장 많은 장면, 2) 대사 줄이 가장 많은 장면(다른 배치에서), 3) 회차 마지막 배치의 뒤쪽 3분의 1에서 대사 줄이 가장 많은 장면,
 * 4) 회차에 화자 없는 문서 장면이 있으면 본문 줄이 가장 많은 문서 장면(문서 형식은 대사 기준으로는 뽑히지 않는다).
 * 같은 값이면 배치·장면 순서가 앞선 것. 이미 고른 장면은 건너뛴다.
 */
export const pickReviewScenes = (batchInputs) => {
  const rows = batchInputs.flatMap((input) =>
    input.scenes.map((scene, idx) => ({
      batch_id: input.batch_id,
      scene_id: scene.scene_id,
      unknowns: scene.mechanical_ground_truth?.unknowns?.length ?? 0,
      dialogue: Object.keys(scene.mechanical_ground_truth?.line_speaker ?? {}).length,
      back: idx >= Math.floor((input.scenes.length * 2) / 3),
      document_text: (() => {
        const rawLines = String(scene.numbered_script ?? '')
          .split('\n')
          .map((line) => line.replace(/^\[L\d+\]\s?/, ''));
        const counted = countedLinesOf(scene.mechanical_ground_truth, rawLines);
        return counted.mode === 'text' ? counted.lines.length : 0;
      })(),
    }))
  );
  const picked = [];
  const take = (candidates, key, reason) => {
    const best = candidates
      .filter((r) => !picked.some((p) => p.scene_id === r.scene_id))
      .reduce((a, r) => (a === null || r[key] > a[key] ? r : a), null);
    if (best && best[key] > 0) picked.push({ ...best, reason });
  };
  take(rows, 'unknowns', '??? 줄 최다');
  take(rows.filter((r) => !picked.some((p) => p.batch_id === r.batch_id)), 'dialogue', '대사 줄 최다(다른 배치)');
  const last = batchInputs.at(-1)?.batch_id;
  take(rows.filter((r) => r.batch_id === last && r.back), 'dialogue', '마지막 배치 뒤쪽 3분의 1');
  if (picked.length < 3) take(rows, 'dialogue', '대사 줄 최다');
  take(rows, 'document_text', '화자 없는 문서 본문 줄 최다');
  return picked;
};

/**
 * 부분 샤드들을 배치 입력의 장면 순서대로 합쳐 하나의 샤드를 만든다.
 * 부분마다 계획된 장면이 정확히 한 번씩 있어야 한다.
 */
export const combineParts = (batchInput, partShards) => {
  const plan = planBatchParts(batchInput);
  if (partShards.length !== plan.length) {
    throw new Error(`Expected ${plan.length} part(s), got ${partShards.length}`);
  }
  const scenes = [];
  plan.forEach(({ part, scene_ids: expected }, idx) => {
    const shard = partShards[idx];
    if (shard?.schema_version !== PASS1_SCHEMA_VERSION) {
      throw new Error(`part${part}: schema_version must be "${PASS1_SCHEMA_VERSION}"`);
    }
    const byId = new Map();
    for (const scene of shard.scenes ?? []) {
      if (byId.has(scene.scene_id)) throw new Error(`part${part}: duplicate scene ${scene.scene_id}`);
      byId.set(scene.scene_id, scene);
    }
    const missing = expected.filter((id) => !byId.has(id));
    const extra = [...byId.keys()].filter((id) => !expected.includes(id));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `part${part}: missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`
      );
    }
    for (const id of expected) scenes.push(byId.get(id));
  });
  return { schema_version: PASS1_SCHEMA_VERSION, batch_id: batchInput.batch_id, scenes };
};

// 회차 계획: next가 고른 배치·호출·검토 장면을 고정해 두고, finish가 같은 목록으로 마무리한다.
// 추출이 끝난 뒤 "다음 미완료 배치"를 다시 고르면 회차가 바뀔 수 있기 때문이다.
export const wavePlanPathOf = (graphDir = GRAPH_DATA_DIR) => path.join(graphDir, 'pass1', 'waves', 'current.json');

export const waveNameOf = (batchIds) =>
  `wave_${batchIds[0]?.replace(/^batch_/, '')}-${batchIds.at(-1)?.replace(/^batch_/, '')}`;

export const reviewInputPathOf = (wave, graphDir = GRAPH_DATA_DIR) =>
  path.join(graphDir, 'pass1', 'waves', `${wave}.review.json`);

/**
 * 독립 검토 입력. 검토 장면마다 배치 입력의 장면 객체 전체(원문·기계 추출값)와 샤드의 같은 장면 객체 전체를 그대로 담는다.
 * 검토자가 큰 배치·샤드 파일에서 장면을 직접 찾아 읽지 않게 하기 위함이다(대본은 JSON 한 줄이라 파일 줄 범위로는 고를 수 없다).
 * 병합되지 않은 배치의 장면이나 결과에 없는 장면은 status로 표시한다.
 * diagnostics({ 이름: (장면, 입력 장면) => 항목들 })를 주면 그 결과를 diagnostics에 담아 검토자가 항목마다 판정하게 한다(시험 중인 진단).
 * unseenWarnings(추출자가 보지 못한 경고: 부분 결합 뒤·병합 뒤)는 장면별로 묶어 warning_scenes에 담는다.
 * 감독관은 원문을 읽지 않으므로(명세 2.1) 검토자가 경고마다 판정한다. 검토 장면과 같은 장면이면 장면 객체를 다시 넣지 않는다.
 * 경고 장면에는 입력 장면 전체(다른 줄에 같은 것을 가리킨 말이 있는지 봐야 한다)와 경고가 난 항목만 넣는다.
 * 추출 결과 전체를 넣었던 8회차는 경고 장면 14개가 검토 입력 663KB 중 약 300KB였다.
 */
// 경고 경로(`$.scenes[3].clues_and_hooks[1]`)가 가리키는 장면 안의 항목. 같은 항목에 경고가 여럿이면 한 번만 넣는다
const flaggedItems = (extraction, warnings) => {
  const seen = new Set();
  return warnings.flatMap((w) => {
    const at = String(w.path).replace(/^\$\.scenes\[\d+\]\./, '');
    if (seen.has(at)) return [];
    seen.add(at);
    const m = at.match(/^(\w+)(?:\[(\d+)\])?$/);
    const value = !extraction || !m ? null : m[2] === undefined ? extraction[m[1]] : extraction[m[1]]?.[Number(m[2])];
    return [{ path: at, item: value ?? null }];
  });
};

export const buildReviewInput = ({ wave, reviewScenes, batchInputs, shards, mergedBatchIds, diagnostics = null, unseenWarnings = [] }) => ({
  wave,
  scenes: reviewScenes.map((r) => {
    const inputScene = batchInputs[r.batch_id]?.scenes?.find((s) => s.scene_id === r.scene_id) ?? null;
    const shard = shards[r.batch_id];
    const extraction = shard?.scenes?.find((s) => s.scene_id === r.scene_id) ?? null;
    const status = !shard
      ? 'no_shard'
      : !mergedBatchIds.includes(r.batch_id)
        ? 'not_merged'
        : !extraction
          ? 'scene_missing'
          : 'ok';
    return {
      scene_id: r.scene_id,
      batch_id: r.batch_id,
      reason: r.reason,
      status,
      source: {
        batch_input: `data/graph/pass1/batches/${r.batch_id}.json`,
        shard: `data/graph/pass1/shards/${r.batch_id}.json`,
      },
      input_scene: inputScene,
      extraction,
      ...(diagnostics
        ? {
            diagnostics: Object.fromEntries(
              Object.entries(diagnostics).map(([name, diagnose]) => [name, extraction && inputScene ? diagnose(extraction, inputScene) : []])
            ),
          }
        : {}),
    };
  }),
  warning_scenes: [...new Set(unseenWarnings.map((w) => `${w.batch_id}\u0000${w.scene_id}`))].map((key) => {
    const [batchId, sceneId] = key.split('\u0000');
    const inReview = reviewScenes.some((r) => r.batch_id === batchId && r.scene_id === sceneId);
    return {
      scene_id: sceneId,
      batch_id: batchId,
      warnings: unseenWarnings
        .filter((w) => w.batch_id === batchId && w.scene_id === sceneId)
        .map(({ stage, rule, path: at, message }) => ({ stage, rule, path: at, message })),
      ...(inReview
        ? { same_as_review_scene: true }
        : {
            input_scene: batchInputs[batchId]?.scenes?.find((s) => s.scene_id === sceneId) ?? null,
            flagged_items: flaggedItems(
              shards[batchId]?.scenes?.find((s) => s.scene_id === sceneId) ?? null,
              unseenWarnings.filter((w) => w.batch_id === batchId && w.scene_id === sceneId)
            ),
          }),
    };
  }),
});

const countRules = (list) =>
  Object.entries(list.reduce((acc, x) => ({ ...acc, [x.rule]: (acc[x.rule] ?? 0) + 1 }), {}))
    .map(([rule, n]) => `${rule} ${n}`)
    .join(', ') || '없음';

/**
 * 회차 마무리(5절 Pass 1 본 실행 회차). 저장된 회차 계획의 배치마다
 * 1) 나뉜 배치는 모든 부분이 검증을 통과했을 때만 결합하고, 2) 배치 샤드를 검증해 경고·오류를 모은 뒤,
 * 3) 병합하고(통과한 샤드만 병합된다), 4) 독립 검토 입력을 만든다. 배치마다 결과를 따로 출력한다.
 * 일부 배치가 실패해도 나머지는 끝까지 처리한다. 실패한 배치는 pending으로 남아 다음 회차에 다시 골라진다.
 */
// 앞 검증에 없던 경고만 돌려준다. 규칙·장면·경로·메시지가 모두 같으면 같은 경고다.
export const newWarnings = (before, after) => {
  const keyOf = (w) => [w.rule, w.scene_id, w.path, w.message].join('\u0000');
  const seen = new Set(before.map(keyOf));
  return after.filter((w) => !seen.has(keyOf(w)));
};

// 이번 회차가 새로 올리는 후보 이름: 병합되면 2.3의 25항 이름 목록에 들어가 이전 회차 배치에도 새 경고를 낼 수 있다
export const newCandidateTerms = (waveShards, mergedCandidatesDoc) => {
  const known = new Set((mergedCandidatesDoc?.candidates ?? []).map((c) => String(c?.surface_text ?? '').trim()));
  const terms = new Set();
  for (const shard of waveShards) {
    for (const scene of shard?.scenes ?? []) {
      for (const c of Array.isArray(scene?.unregistered_entity_candidates) ? scene.unregistered_entity_candidates : []) {
        const t = String(c?.surface_text ?? '').trim();
        if (t.length >= 2 && !known.has(t)) terms.add(t);
      }
    }
  }
  return [...terms];
};

// 부분 결합 뒤 새 경고: 부분 샤드와 결합 샤드는 장면 배열 번호가 다르므로 장면 ID와 장면 안 경로로 비교한다
export const newWarningsAfterCombine = (partWarnings, batchWarnings) => {
  const keyOf = (w) =>
    [w.rule, w.scene_id, w.scene_id ? String(w.path).replace(/^\$\.scenes\[\d+\]/, '') : w.path, w.message].join('\u0000');
  const seen = new Set(partWarnings.map(keyOf));
  return batchWarnings.filter((w) => !seen.has(keyOf(w)));
};

const finishWave = async (rel) => {
  const planPath = wavePlanPathOf();
  if (!fsSync.existsSync(planPath)) {
    throw new Error(`No wave plan at ${rel(planPath)}; run "batch-parts.mjs next <count>" first`);
  }
  const wavePlan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const { validateShardFile, dialogueOnlyEvents, DIALOGUE_EVENT_MIN_TURNS, claimStartsOtherSpeaker } = await import('./validate-output.mjs');
  const { mergeValidatedShards } = await import('./merge-and-index.mjs');
  const { fileHashOf, formatWaveCallSummary, readValidationLog, recordValidation, summarizeWaveCalls, validationLogPathOf } = await import(
    './validation-log.mjs'
  );
  const shardPathOf = (id) => path.join(GRAPH_DATA_DIR, 'pass1', 'shards', `${id}.json`);
  // finish의 검증도 기록하지만(actor finish), 추출자의 재검증 횟수에는 넣지 않는다
  const tryValidate = async (id, options = {}) => {
    const part = options.part ?? null;
    try {
      const res = await validateShardFile(id, options);
      await recordValidation({ actor: 'finish', batchId: id, part, res, wavePlan });
      return res;
    } catch (err) {
      await recordValidation({ actor: 'finish', batchId: id, part, fatal: err.message, wavePlan });
      return { valid: false, errors: [{ rule: 'UNREADABLE', scene_id: null, path: '', message: err.message }], warnings: [] };
    }
  };

  // 추출자 검증 기록은 finish가 파일을 쓰기 전에 센다. 마지막 기록의 출력 해시가 지금 출력 파일과 다르면 그 뒤에 출력이 바뀐 것이다
  const log = await readValidationLog();
  const callSummary = summarizeWaveCalls(wavePlan, log.records, {
    currentOutputHash: (call) => fileHashOf(call.part ? partPathOf(call.batch_id, call.part) : shardPathOf(call.batch_id)),
  });

  console.log(`[finish] ${wavePlan.wave}: ${wavePlan.batch_ids.join(', ')} (plan ${rel(planPath)}, ${wavePlan.created_at})`);
  const batchInputs = {};
  const rows = [];
  for (const id of wavePlan.batch_ids) {
    const input = await readBatchInput(id);
    batchInputs[id] = input;
    const plan = planBatchParts(input);
    const row = { batch_id: id, parts: plan.length, combine: null, validation: '샤드 없음', errors: [], warnings: [], afterCombine: [] };
    const partWarnings = [];
    if (plan.length > 1) {
      const partProblems = [];
      for (const { part } of plan) {
        if (!fsSync.existsSync(partPathOf(id, part))) {
          partProblems.push(`part ${part} 출력 없음`);
          continue;
        }
        const res = await tryValidate(id, { part });
        partWarnings.push(...res.warnings);
        if (!res.valid) {
          partProblems.push(`part ${part} FAIL (${countRules(res.errors)})`);
          row.errors.push(...res.errors.map((e) => ({ ...e, part })));
        }
      }
      if (partProblems.length > 0) {
        row.combine = `결합 안 함: ${partProblems.join('; ')}`;
      } else {
        try {
          const partShards = [];
          for (const { part } of plan) partShards.push(JSON.parse(await fs.readFile(partPathOf(id, part), 'utf8')));
          await writeJsonAtomic(shardPathOf(id), combineParts(input, partShards));
          row.combine = `${plan.length}부분 결합`;
        } catch (err) {
          row.combine = `결합 실패: ${err.message}`;
        }
      }
    }
    if (fsSync.existsSync(shardPathOf(id))) {
      const res = await tryValidate(id);
      row.validation = res.valid ? `PASS, 경고 ${countRules(res.warnings)}` : `FAIL (${countRules(res.errors)})`;
      if (!res.valid) row.errors.push(...res.errors);
      row.warnings = res.warnings;
      // 서브에이전트는 자기 부분만 검증하므로, 같은 배치 다른 부분이 올린 후보 이름의 25항 경고는 결합 뒤에야 나온다
      if (plan.length > 1 && row.combine === `${plan.length}부분 결합`) row.afterCombine = newWarningsAfterCombine(partWarnings, res.warnings);
    }
    rows.push(row);
  }

  // 이전 회차 배치 중 이번 회차의 새 후보 이름이 샤드에 들어 있는 것만 병합 전에 검증해 둔다(병합 뒤와 비교)
  let mergedCandidatesDoc = null;
  try {
    mergedCandidatesDoc = JSON.parse(await fs.readFile(path.join(GRAPH_DATA_DIR, 'unregistered_entity_candidates.json'), 'utf8'));
  } catch {
    // 아직 병합된 후보가 없다
  }
  const waveShardDocs = [];
  for (const id of wavePlan.batch_ids) {
    try {
      waveShardDocs.push(JSON.parse(await fs.readFile(shardPathOf(id), 'utf8')));
    } catch {
      // 샤드가 없거나 깨진 배치는 병합되지 않는다
    }
  }
  const freshTerms = newCandidateTerms(waveShardDocs, mergedCandidatesDoc);
  const earlierBefore = {};
  const shardsDir = path.join(GRAPH_DATA_DIR, 'pass1', 'shards');
  for (const file of freshTerms.length > 0 ? fsSync.readdirSync(shardsDir).filter((f) => /^batch_\d+\.json$/.test(f)).sort() : []) {
    const id = file.replace(/\.json$/, '');
    if (wavePlan.batch_ids.includes(id)) continue;
    const text = await fs.readFile(path.join(shardsDir, file), 'utf8');
    if (!freshTerms.some((term) => text.includes(term))) continue;
    const res = await tryValidate(id);
    if (res.valid) earlierBefore[id] = res.warnings;
  }

  const merged = await mergeValidatedShards();
  const mergedIds = new Set(merged.mergedBatchIds);

  console.log(`[finish] 호출별 추출자 검증 기록(${rel(validationLogPathOf())}):`);
  for (const line of formatWaveCallSummary(callSummary)) console.log(line);
  if (log.broken > 0) console.log(`  읽지 못한 기록 줄 ${log.broken}개`);
  console.log('[finish] 배치별 결과:');
  for (const row of rows) {
    const steps = [row.combine, row.validation, mergedIds.has(row.batch_id) ? '병합됨' : '병합 안 됨(pending)'].filter(Boolean);
    console.log(`  ${row.batch_id}${row.parts > 1 ? ` (${row.parts}부분)` : ''}: ${steps.join(' | ')}`);
  }
  const printWarning = (w) => console.log(`  [WARN][${w.rule}] ${w.batch_id} (${w.scene_id ?? 'batch'}) ${w.path}: ${w.message}`);
  const seenWarnings = rows.flatMap((row) =>
    row.warnings.filter((w) => !row.afterCombine.includes(w)).map((w) => ({ batch_id: row.batch_id, ...w }))
  );
  const afterCombine = rows.flatMap((row) => row.afterCombine.map((w) => ({ batch_id: row.batch_id, ...w })));
  console.log(`[finish] 추출자가 본 경고 ${seenWarnings.length}건${seenWarnings.length > 0 ? ':' : ''}`);
  seenWarnings.forEach(printWarning);
  console.log(`[finish] 부분을 결합한 뒤 새로 생긴 경고 ${afterCombine.length}건(부분 검증에는 없었다)${afterCombine.length > 0 ? ':' : ''}`);
  afterCombine.forEach(printWarning);
  // 2.3의 25항은 병합된 미등록 후보를 이름 목록에 넣으므로, 같은 회차 다른 배치가 올린 이름은 병합 뒤에야 보인다
  const afterMerge = [];
  for (const row of rows) {
    if (!mergedIds.has(row.batch_id)) continue;
    const res = await tryValidate(row.batch_id);
    afterMerge.push(...newWarnings(row.warnings, res.warnings).map((w) => ({ batch_id: row.batch_id, ...w })));
  }
  console.log(`[finish] 병합 뒤 다시 검증한 새 경고 ${afterMerge.length}건${afterMerge.length > 0 ? ':' : ''}`);
  afterMerge.forEach(printWarning);
  // 이번 회차의 새 후보 이름 때문에 이전 회차 배치에 생긴 경고
  const earlierAfterMerge = [];
  for (const [id, before] of Object.entries(earlierBefore)) {
    if (!mergedIds.has(id)) continue;
    const res = await tryValidate(id);
    earlierAfterMerge.push(...newWarnings(before, res.warnings).map((w) => ({ batch_id: id, ...w })));
  }
  console.log(
    `[finish] 이번 회차의 새 후보 이름 ${freshTerms.length}개로 이전 회차 배치에 생긴 새 경고 ${earlierAfterMerge.length}건` +
      `(검증한 이전 배치 ${Object.keys(earlierBefore).length}개)${earlierAfterMerge.length > 0 ? ':' : ''}`
  );
  earlierAfterMerge.forEach(printWarning);
  const unseenWarnings = [
    ...afterCombine.map((w) => ({ stage: '결합 뒤', ...w })),
    ...afterMerge.map((w) => ({ stage: '병합 뒤', ...w })),
    ...earlierAfterMerge.map((w) => ({ stage: '병합 뒤(이전 회차)', ...w })),
  ];
  const errors = rows.flatMap((row) => row.errors.map((e) => ({ batch_id: row.batch_id, ...e })));
  if (errors.length > 0) {
    console.log(`[finish] 남은 오류 ${errors.length}건:`);
    for (const e of errors) {
      console.log(`  [${e.rule}] ${e.batch_id}${e.part ? ` part ${e.part}` : ''} (${e.scene_id ?? 'batch'}) ${e.path}: ${e.message}`);
    }
  }
  const notMerged = wavePlan.batch_ids.filter((id) => !mergedIds.has(id));
  console.log(
    `[finish] 병합: 이번 회차 ${wavePlan.batch_ids.length - notMerged.length}/${wavePlan.batch_ids.length}배치` +
      (notMerged.length > 0 ? `, 병합 안 됨(다음 회차에 다시 골라짐): ${notMerged.join(', ')}` : '') +
      ` — 전체 병합 ${merged.mergedBatchIds.length}배치 ${merged.mergedScenesCount}장면, 건너뛴 샤드 ${merged.skippedBatches.length}개`
  );

  console.log('[finish] 위치별 밀도(사건·주장 / 대사 100줄, 앞·중간·뒤):');
  for (const id of wavePlan.batch_ids) {
    const thirds = merged.densityReportDoc.by_batch?.[id];
    if (thirds) console.log(`  ${id}: ${thirds.map((t) => `${t.events_per_100_lines ?? '-'} (${t.events}/${t.dialogue_lines})`).join(' · ')}`);
  }

  const shards = {};
  for (const id of new Set([...wavePlan.batch_ids, ...wavePlan.review_scenes.map((r) => r.batch_id), ...earlierAfterMerge.map((w) => w.batch_id)])) {
    try {
      shards[id] = JSON.parse(await fs.readFile(shardPathOf(id), 'utf8'));
    } catch {
      // 샤드가 없거나 깨졌으면 검토 입력에 no_shard로 표시된다
    }
    batchInputs[id] ??= await readBatchInput(id);
  }

  // 시험 중인 진단(2.3의 경고가 아니다). 서브에이전트에게는 보이지 않고, 독립 검토자가 표본 장면의 항목을 판정한다
  console.log(`[finish] 진단(시험, 경고 아님): 지문 없이 대사만으로 된 여러 화자 사건(${DIALOGUE_EVENT_MIN_TURNS}차례 이상)`);
  let diagnosed = 0;
  for (const id of wavePlan.batch_ids) {
    if (!mergedIds.has(id) || !shards[id]) continue;
    const inputById = new Map((batchInputs[id]?.scenes ?? []).map((s) => [s.scene_id, s]));
    const counts = shards[id].scenes.map((s) => dialogueOnlyEvents(s, inputById.get(s.scene_id)).length);
    const n = counts.reduce((a, b) => a + b, 0);
    diagnosed += n;
    console.log(`  ${id}: ${n}건`);
  }
  console.log(`  합계 ${diagnosed}건`);
  console.log('[finish] 진단(시험, 경고 아님): 주장 범위가 다른 화자의 말로 시작하고 그 화자 자신의 항목이 없음(질문·짧은 감탄 제외)');
  let leading = 0;
  for (const id of wavePlan.batch_ids) {
    if (!mergedIds.has(id) || !shards[id]) continue;
    const inputById = new Map((batchInputs[id]?.scenes ?? []).map((s) => [s.scene_id, s]));
    const n = shards[id].scenes.reduce((acc, s) => acc + claimStartsOtherSpeaker(s, inputById.get(s.scene_id)).length, 0);
    leading += n;
    console.log(`  ${id}: ${n}건`);
  }
  console.log(`  합계 ${leading}건`);
  const reviewInput = buildReviewInput({
    wave: wavePlan.wave,
    reviewScenes: wavePlan.review_scenes,
    batchInputs,
    shards,
    mergedBatchIds: merged.mergedBatchIds,
    diagnostics: { dialogue_only_events: dialogueOnlyEvents, claim_starts_other_speaker: claimStartsOtherSpeaker },
    unseenWarnings,
  });
  const reviewPath = reviewInputPathOf(wavePlan.wave);
  await writeJsonAtomic(reviewPath, reviewInput);
  console.log(`[finish] 독립 검토 입력: ${rel(reviewPath)}`);
  for (const s of reviewInput.scenes) {
    const dialogueOnly = s.diagnostics?.dialogue_only_events?.length ?? 0;
    const startsOther = s.diagnostics?.claim_starts_other_speaker?.length ?? 0;
    console.log(
      `  ${s.scene_id} (${s.batch_id}) — ${s.reason}: ${s.status}` +
        (s.status === 'ok' ? `, 진단 항목 대사만 사건 ${dialogueOnly}건 · 주장 앞 다른 화자 ${startsOther}건` : '')
    );
  }
  console.log(`  추출자가 보지 못한 경고: ${unseenWarnings.length}건, ${reviewInput.warning_scenes.length}장면(검토자가 경고마다 판정한다)`);
};

// 서브에이전트가 실행할 검증 명령. 실행 번호는 넣지 않는다(서브에이전트가 바꿀 수 없게, 감독관의 rerun 표시로 센다)
export const validateCommandOf = (call) =>
  `node scripts/graph/validate-output.mjs ${call.batch_id}${call.part ? ` --part ${call.part}` : ''}`;

/**
 * 감독관이 호출 하나를 새 서브에이전트로 처음부터 다시 돌릴 때(지시서 2절). 검증 기록에 표시를 남겨,
 * 그 뒤의 추출자 검증을 다음 실행으로 센다. 같은 세션에서 고친 뒤 다시 검증하는 것은 같은 실행이다.
 */
export const markRerun = async (callNumber, graphDir = GRAPH_DATA_DIR) => {
  const planPath = wavePlanPathOf(graphDir);
  if (!fsSync.existsSync(planPath)) throw new Error(`No wave plan at ${planPath}; run "batch-parts.mjs next <count>" first`);
  const wavePlan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const call = (wavePlan.calls ?? []).find((c) => c.call === callNumber);
  if (!call) throw new Error(`call ${callNumber} is not in the wave plan (${wavePlan.wave})`);
  const { appendValidationRecord, buildRerunMarker, readValidationLog, rerunStartsOf } = await import('./validation-log.mjs');
  await appendValidationRecord(buildRerunMarker({ wavePlan, call }), graphDir);
  const { records } = await readValidationLog(graphDir);
  return { wavePlan, call, run: 1 + rerunStartsOf(wavePlan, call, records).length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [command, batchId] = process.argv.slice(2);
  const usage =
    'Usage: node scripts/graph/batch-parts.mjs <plan|combine> <batch_id>\n' +
    '       node scripts/graph/batch-parts.mjs next <count>   (다음 미완료 배치 count개의 호출 목록, 나뉘는 배치는 담당 입력도 만든다. 회차 계획을 저장한다)\n' +
    '       node scripts/graph/batch-parts.mjs rerun <call>   (회차의 호출 하나를 새 서브에이전트로 다시 돌린다는 표시를 남기고 그 호출을 출력한다)\n' +
    '       node scripts/graph/batch-parts.mjs finish         (저장된 회차의 결합·검증·병합, 독립 검토 입력 생성)';
  const rel = (p) => path.relative(process.cwd(), p);

  const run = async () => {
    if (command === 'next') {
      const count = Number(batchId);
      if (!Number.isInteger(count) || count < 1) throw new Error(usage);
      const progressDoc = JSON.parse(await fs.readFile(path.join(GRAPH_DATA_DIR, 'progress.json'), 'utf8'));
      const ids = nextPendingBatches(progressDoc, count);
      // 중단된 회차를 이어 돌릴 때: 출력이 있고 지금 검증을 통과하면 다시 돌리지 않는다(done), 실패하거나 읽을 수 없으면 다시 돌린다(rerun)
      const { validateShardFile } = await import('./validate-output.mjs');
      const { recordValidation } = await import('./validation-log.mjs');
      const newPlan = { wave: ids.length > 0 ? waveNameOf(ids) : null, created_at: new Date().toISOString(), batch_ids: ids };
      const statusOf = async (outPath, id, part = null) => {
        if (!fsSync.existsSync(outPath)) return 'new';
        try {
          const res = await validateShardFile(id, part ? { part } : {});
          await recordValidation({ actor: 'next', batchId: id, part, res, wavePlan: newPlan });
          return res.valid ? 'done' : 'rerun';
        } catch (err) {
          await recordValidation({ actor: 'next', batchId: id, part, fatal: err.message, wavePlan: newPlan });
          return 'rerun';
        }
      };
      const statusCount = { new: 0, done: 0, rerun: 0 };
      let call = 0;
      let scenes = 0;
      let bytes = 0;
      const inputs = [];
      const calls = [];
      for (const id of ids) {
        const input = await readBatchInput(id);
        inputs.push(input);
        const plan = planBatchParts(input);
        scenes += input.scenes.length;
        bytes += input.body_bytes ?? 0;
        const shardOut = path.join(GRAPH_DATA_DIR, 'pass1', 'shards', `${id}.json`);
        const combinedStatus = await statusOf(shardOut, id);
        if (plan.length === 1) {
          call += 1;
          statusCount[combinedStatus] += 1;
          calls.push({ call, batch_id: id, part: null, scene_count: input.scenes.length, line_count: plan[0].line_count, status: combinedStatus });
          console.log(`call ${call}: ${id} (${input.scenes.length} scenes, ${plan[0].line_count} lines) [${combinedStatus}]`);
          console.log(`  input    ${rel(path.join(GRAPH_DATA_DIR, 'pass1', 'batches', `${id}.json`))}`);
          console.log(`  output   ${rel(path.join(GRAPH_DATA_DIR, 'pass1', 'shards', `${id}.json`))}`);
          console.log(`  validate ${validateCommandOf({ batch_id: id, part: null })}`);
          continue;
        }
        for (const { part, scene_ids: partIds, line_count: lineCount } of plan) {
          call += 1;
          const inputPath = partInputPathOf(id, part);
          await writeJsonAtomic(inputPath, buildPartInput(input, part));
          const status =
            combinedStatus === 'done' ? 'done' : await statusOf(partPathOf(id, part), id, part);
          statusCount[status] += 1;
          calls.push({ call, batch_id: id, part, scene_count: partIds.length, line_count: lineCount, status });
          console.log(`call ${call}: ${id} part ${part}/${plan.length} (${partIds.length} scenes, ${lineCount} lines) [${status}]`);
          console.log(`  input    ${rel(inputPath)}`);
          console.log(`  output   ${rel(partPathOf(id, part))}`);
          console.log(`  validate ${validateCommandOf({ batch_id: id, part })}`);
        }
      }
      console.log(`[batch-parts] next ${ids.length} batch(es): ${ids.join(', ')} — ${scenes} scenes, ${bytes} body bytes, ${call} call(s)`);
      console.log(`[batch-parts] calls to run: new ${statusCount.new}, rerun ${statusCount.rerun}; reuse (done): ${statusCount.done}`);
      const reviewScenes = pickReviewScenes(inputs);
      console.log('[batch-parts] review sample:');
      for (const r of reviewScenes) {
        console.log(`  ${r.scene_id} (${r.batch_id}) — ${r.reason}: ??? ${r.unknowns}, dialogue ${r.dialogue}`);
      }
      if (ids.length > 0) {
        const { wave } = newPlan;
        await writeJsonAtomic(wavePlanPathOf(), {
          wave,
          created_at: newPlan.created_at,
          batch_ids: ids,
          scene_count: scenes,
          body_bytes: bytes,
          calls,
          review_scenes: reviewScenes.map(({ batch_id, scene_id, reason }) => ({ batch_id, scene_id, reason })),
        });
        console.log(`[batch-parts] wave plan saved: ${rel(wavePlanPathOf())} (${wave}); after extraction run "node scripts/graph/batch-parts.mjs finish"`);
      }
      return;
    }
    if (command === 'finish') {
      await finishWave(rel);
      return;
    }
    if (command === 'rerun') {
      const callNumber = Number(batchId);
      if (!Number.isInteger(callNumber) || callNumber < 1) throw new Error(usage);
      const { call, run: runNumber } = await markRerun(callNumber);
      const { batch_id: id, part } = call;
      console.log(`call ${call.call}: ${id}${part ? ` part ${part}` : ''} — run ${runNumber}부터 센다(이전 서브에이전트는 멈추고 새 서브에이전트에게 맡긴다)`);
      console.log(`  input    ${rel(part ? partInputPathOf(id, part) : path.join(GRAPH_DATA_DIR, 'pass1', 'batches', `${id}.json`))}`);
      console.log(`  output   ${rel(part ? partPathOf(id, part) : path.join(GRAPH_DATA_DIR, 'pass1', 'shards', `${id}.json`))}`);
      console.log(`  validate ${validateCommandOf(call)}`);
      return;
    }
    if (!batchId || !['plan', 'combine'].includes(command)) throw new Error(usage);
    const batchInput = await readBatchInput(batchId);
    const plan = planBatchParts(batchInput);

    if (command === 'plan') {
      if (plan.length === 1) {
        console.log(`[batch-parts] ${batchId}: ${plan[0].scene_ids.length} scenes, ${plan[0].line_count} lines, no split needed`);
        return;
      }
      console.log(`[batch-parts] ${batchId}: ${batchInput.scenes.length} scenes → ${plan.length} parts`);
      for (const { part, scene_ids: ids, line_count: lineCount } of plan) {
        const inputPath = partInputPathOf(batchId, part);
        await writeJsonAtomic(inputPath, buildPartInput(batchInput, part));
        console.log(`  part ${part} (${ids.length} scenes, ${lineCount} lines)`);
        console.log(`    input  ${path.relative(process.cwd(), inputPath)}`);
        console.log(`    output ${path.relative(process.cwd(), partPathOf(batchId, part))}`);
        console.log(`    ${ids.join(', ')}`);
      }
      return;
    }

    const partShards = [];
    for (const { part } of plan) {
      const partPath = partPathOf(batchId, part);
      if (!fsSync.existsSync(partPath)) throw new Error(`Missing part file: ${partPath}`);
      partShards.push(JSON.parse(await fs.readFile(partPath, 'utf8')));
    }
    const shard = combineParts(batchInput, partShards);
    const outPath = path.join(GRAPH_DATA_DIR, 'pass1', 'shards', `${batchId}.json`);
    await writeJsonAtomic(outPath, shard);
    console.log(`[batch-parts] ${batchId}: combined ${plan.length} parts (${shard.scenes.length} scenes) → ${outPath}`);
  };

  run().catch((err) => {
    console.error('[batch-parts]', err.message || err);
    process.exit(1);
  });
}
