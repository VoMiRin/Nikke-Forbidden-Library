import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { GRAPH_DATA_DIR, PASS1_SCHEMA_VERSION, sha256, writeJsonAtomic } from './lib.mjs';
import { extractRawLinesFromNumberedScript, loadEntityRegistry, validateShard } from './validate-output.mjs';

const __filename = fileURLToPath(import.meta.url);

// 5절 Pass 1 보수: 이미 검증을 통과한 샤드에서 문제가 있는 장면만 다시 쓰게 한다.
// - 대상 장면: 지금 배치 입력·검증기로 다시 검증했을 때 오류가 있거나 REPAIR_WARNING_RULES 경고가 있는 장면,
//   그리고 prepare --findings로 넘긴 독립 표본 검토 지적(REVIEW_FINDING)이 있는 장면
// - 서브에이전트는 대상 장면만 담은 보수 입력을 읽고, 대상 장면마다 바꾼 최상위 필드만 보수 출력에 쓴다
//   (배열 인덱스 패치가 아니라 필드 통째 교체. 쓰지 않은 필드는 지금 결과 그대로 남는다)
// - 보수 출력은 기존 샤드에서 대상 장면에만 덮어써 검증하므로, 대상이 아닌 장면은 바뀔 수 없다

export const REPAIR_WARNING_RULES = new Set(['CLAIM_OTHER_SPEAKERS']);
// 작업 하나가 읽는 보수 입력 크기 상한. 규칙 파일(약 63KB)의 네 배 정도다
export const MAX_REPAIR_INPUT_BYTES_PER_JOB = 256 * 1024;
// 지금 결과에 없어도 보수 출력에 쓸 수 있는 필드
const OPTIONAL_SCENE_FIELDS = new Set(['reviewed_gaps']);

const repairsDirOf = (graphDir) => path.join(graphDir, 'pass1', 'repairs');
export const repairInputPathOf = (batchId, graphDir = GRAPH_DATA_DIR) =>
  path.join(repairsDirOf(graphDir), `${batchId}.input.json`);
export const repairOutputPathOf = (batchId, graphDir = GRAPH_DATA_DIR) =>
  path.join(repairsDirOf(graphDir), `${batchId}.output.json`);
// check를 통과한 보수 후 장면(대상 장면만, 완전한 객체). 적용 전에 독립 검토가 읽는다
export const repairCandidatePathOf = (batchId, graphDir = GRAPH_DATA_DIR) =>
  path.join(repairsDirOf(graphDir), `${batchId}.candidate.json`);
const originalPathOf = (batchId, kind, graphDir) =>
  path.join(repairsDirOf(graphDir), 'original', `${batchId}.${kind}.json`);
const batchInputPathOf = (batchId, graphDir) => path.join(graphDir, 'pass1', 'batches', `${batchId}.json`);
const shardPathOf = (batchId, graphDir) => path.join(graphDir, 'pass1', 'shards', `${batchId}.json`);

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

/**
 * 저장된 배치 입력의 기계 추출값을 지금 매니페스트에 맞춘다.
 * 원문이 바뀐 장면은 보수 대상이 아니다(build-manifest가 새 배치로 다시 추출한다).
 */
export const refreshBatchInput = (batchInput, manifestScenes) => {
  const changedSceneIds = [];
  const scenes = batchInput.scenes.map((scene) => {
    const mScene = manifestScenes[scene.scene_id];
    if (!mScene) throw new Error(`${scene.scene_id}: not in manifest.json`);
    // 본문이 바뀌어 다른 배치로 다시 추출된 장면(옛 결과)은 병합기가 건너뛰므로 그대로 둔다(보수 4회차 batch_0161의 ark_guardian_13)
    if (mScene.batch_id && batchInput.batch_id && mScene.batch_id !== batchInput.batch_id) return scene;
    const body = extractRawLinesFromNumberedScript(scene.numbered_script).join('\n');
    if (sha256(body) !== mScene.source_sha256) {
      throw new Error(
        `${scene.scene_id}: source text changed since ${batchInput.batch_id} was extracted; re-extract it through build-manifest, not repair`
      );
    }
    if (isDeepStrictEqual(scene.mechanical_ground_truth, mScene.mechanical_ground_truth)) return scene;
    changedSceneIds.push(scene.scene_id);
    return { ...scene, mechanical_ground_truth: mScene.mechanical_ground_truth };
  });
  return { batchInput: { ...batchInput, scenes }, changedSceneIds };
};

/**
 * 샤드를 배치 입력으로 다시 검증해 장면별 보수 사유를 모은다.
 */
export const collectRepairIssues = (shard, batchInput, options = {}) => {
  const result = validateShard(shard, batchInput, options);
  const issues = new Map();
  const add = (severity, entry) => {
    if (!entry.scene_id) throw new Error(`${batchInput.batch_id}: batch-level ${entry.rule} error cannot be repaired by scene: ${entry.message}`);
    if (!issues.has(entry.scene_id)) issues.set(entry.scene_id, []);
    issues.get(entry.scene_id).push({ severity, rule: entry.rule, path: entry.path, message: entry.message });
  };
  for (const err of result.errors) add('error', err);
  for (const warning of result.warnings) if (REPAIR_WARNING_RULES.has(warning.rule)) add('warning', warning);
  return issues;
};

// 독립 표본 검토가 짚은 의미 오류(검증기가 잡지 못하는 것)를 보수 사유로 넣을 때 쓰는 규칙 이름
export const REVIEW_FINDING_RULE = 'REVIEW_FINDING';
const FINDING_FIELDS = ['id', 'batch_id', 'scene_id', 'type', 'lines', 'finding', 'source'];

/**
 * 검토 지적 목록 파일({ findings: [...] })을 읽어 형식을 확인한다.
 * 항목마다 id·batch_id·scene_id·type·lines·finding·source가 있어야 하고 id는 겹치지 않는다. path는 선택이다.
 */
export const parseReviewFindings = (doc) => {
  const findings = doc?.findings;
  if (!Array.isArray(findings) || findings.length === 0) throw new Error('findings file must have a non-empty "findings" array');
  const seen = new Set();
  for (const f of findings) {
    const missing = FINDING_FIELDS.filter((k) => typeof f?.[k] !== 'string' || f[k].trim() === '');
    if (missing.length > 0) throw new Error(`finding ${f?.id ?? '(no id)'}: missing ${missing.join(', ')}`);
    if (seen.has(f.id)) throw new Error(`finding ${f.id}: duplicate id`);
    seen.add(f.id);
  }
  return findings;
};

/**
 * 검토 지적을 장면별 보수 사유에 더한다. 지적한 장면이 샤드에 없으면 실패한다.
 */
export const addReviewFindings = (issues, shard, findings) => {
  const sceneIds = new Set(shard.scenes.map((s) => s.scene_id));
  for (const f of findings) {
    if (f.batch_id !== shard.batch_id) throw new Error(`finding ${f.id}: batch_id ${f.batch_id} is not ${shard.batch_id}`);
    if (!sceneIds.has(f.scene_id)) throw new Error(`finding ${f.id}: ${f.scene_id} is not in ${shard.batch_id}`);
    if (!issues.has(f.scene_id)) issues.set(f.scene_id, []);
    issues.get(f.scene_id).push({
      severity: 'review',
      rule: REVIEW_FINDING_RULE,
      id: f.id,
      type: f.type,
      lines: f.lines,
      path: f.path ?? null,
      message: f.finding,
      source: f.source,
    });
  }
  return issues;
};

/**
 * 서브에이전트가 읽을 보수 입력: 대상 장면의 원문·기계 추출값, 지금 추출 결과, 보수 사유.
 */
export const buildRepairInput = (batchInput, shard, issues) => {
  const shardScenes = new Map(shard.scenes.map((s) => [s.scene_id, s]));
  return {
    schema_version: PASS1_SCHEMA_VERSION,
    batch_id: batchInput.batch_id,
    scene_count: issues.size,
    scenes: batchInput.scenes
      .filter((s) => issues.has(s.scene_id))
      .map((s) => ({ ...s, issues: issues.get(s.scene_id), current_output: shardScenes.get(s.scene_id) })),
  };
};

/**
 * 기존 샤드의 대상 장면에 보수 출력의 필드를 덮어쓴다. 대상과 다른 장면이 있거나 빠지면 실패한다.
 */
export const spliceRepair = (shard, repairInput, repairOutput) => {
  if (repairOutput?.schema_version !== PASS1_SCHEMA_VERSION) {
    throw new Error(`repair output schema_version must be "${PASS1_SCHEMA_VERSION}"`);
  }
  if (repairOutput.batch_id !== repairInput.batch_id) {
    throw new Error(`repair output batch_id must be "${repairInput.batch_id}"`);
  }
  const targets = repairInput.scenes.map((s) => s.scene_id);
  const byId = new Map();
  for (const scene of repairOutput.scenes ?? []) {
    if (byId.has(scene.scene_id)) throw new Error(`duplicate scene ${scene.scene_id} in repair output`);
    byId.set(scene.scene_id, scene);
  }
  const missing = targets.filter((id) => !byId.has(id));
  const extra = [...byId.keys()].filter((id) => !targets.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`repair output must hold exactly the target scenes: missing [${missing.join(', ')}], not a target [${extra.join(', ')}]`);
  }
  return {
    ...shard,
    scenes: shard.scenes.map((current) => {
      const patch = byId.get(current.scene_id);
      if (!patch) return current;
      const unknown = Object.keys(patch).filter((k) => !(k in current) && !OPTIONAL_SCENE_FIELDS.has(k));
      if (unknown.length > 0) {
        throw new Error(`${current.scene_id}: repair output has fields the scene does not have: ${unknown.join(', ')}`);
      }
      return { ...current, ...patch };
    }),
  };
};

/**
 * 보수할 배치들을 작업으로 묶는다. 배치는 쪼개지 않고, 작업 수는 보수 입력 크기 합을 상한으로 나눈 만큼,
 * 큰 배치부터 가장 가벼운 작업에 넣어 크기를 고르게 한다.
 */
export const planRepairJobs = (bytesByBatch, maxBytesPerJob = MAX_REPAIR_INPUT_BYTES_PER_JOB) => {
  const entries = Object.entries(bytesByBatch).filter(([, n]) => n > 0);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  if (total === 0) return [];
  const jobs = Array.from({ length: Math.ceil(total / maxBytesPerJob) }, () => ({ batch_ids: [], input_bytes: 0 }));
  for (const [batchId, n] of entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const lightest = jobs.reduce((min, j) => (j.input_bytes < min.input_bytes ? j : min));
    lightest.batch_ids.push(batchId);
    lightest.input_bytes += n;
  }
  return jobs.map((j, idx) => ({ job: idx + 1, batch_ids: j.batch_ids.sort(), input_bytes: j.input_bytes }));
};

export const prepareRepair = async (batchId, { graphDir = GRAPH_DATA_DIR, manifestScenes, findings = [] } = {}) => {
  const batchInputPath = batchInputPathOf(batchId, graphDir);
  const shardPath = shardPathOf(batchId, graphDir);
  if (!fsSync.existsSync(shardPath)) throw new Error(`${batchId}: no shard at ${shardPath}`);
  // 이전 회차의 보수 출력·후보가 남아 있으면 새 보수 입력과 섞인다
  for (const leftover of [repairOutputPathOf(batchId, graphDir), repairCandidatePathOf(batchId, graphDir)]) {
    if (fsSync.existsSync(leftover)) {
      throw new Error(`${batchId}: ${path.basename(leftover)} from a previous repair round is still there; move it away first`);
    }
  }
  const originalInput = await readJson(batchInputPath);
  const shard = await readJson(shardPath);

  // 처음 손대기 전의 배치 입력과 샤드를 남긴다(다시 실행해도 덮어쓰지 않는다)
  for (const [kind, src] of [['batch_input', batchInputPath], ['shard', shardPath]]) {
    const dest = originalPathOf(batchId, kind, graphDir);
    if (!fsSync.existsSync(dest)) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
  }

  const { batchInput, changedSceneIds } = refreshBatchInput(originalInput, manifestScenes);
  if (changedSceneIds.length > 0) await writeJsonAtomic(batchInputPath, batchInput);

  const issues = addReviewFindings(
    collectRepairIssues(shard, batchInput, { registry: await loadEntityRegistry(graphDir) }),
    shard,
    findings.filter((f) => f.batch_id === batchId)
  );
  const inputPath = repairInputPathOf(batchId, graphDir);
  if (issues.size > 0) {
    await writeJsonAtomic(inputPath, buildRepairInput(batchInput, shard, issues));
  } else if (fsSync.existsSync(inputPath)) {
    await fs.rm(inputPath);
  }
  return { batchId, changedSceneIds, issues };
};

/**
 * 보수 입력을 만든 뒤 대상 장면의 샤드나 배치 입력이 바뀌었으면 그 장면 목록을 돌려준다.
 * 바뀌었으면 보수 출력이 최신 내용을 덮어쓸 수 있으므로 prepare부터 다시 해야 한다.
 */
export const staleRepairScenes = (repairInput, shard, batchInput) => {
  const shardScenes = new Map(shard.scenes.map((s) => [s.scene_id, s]));
  const inputScenes = new Map(batchInput.scenes.map((s) => [s.scene_id, s]));
  return repairInput.scenes
    .filter((target) => {
      const nowInput = inputScenes.get(target.scene_id);
      return (
        !isDeepStrictEqual(shardScenes.get(target.scene_id), target.current_output) ||
        !nowInput ||
        nowInput.numbered_script !== target.numbered_script ||
        !isDeepStrictEqual(nowInput.mechanical_ground_truth, target.mechanical_ground_truth)
      );
    })
    .map((target) => target.scene_id);
};

export const checkRepair = async (batchId, { graphDir = GRAPH_DATA_DIR } = {}) => {
  const repairInput = await readJson(repairInputPathOf(batchId, graphDir));
  const outputPath = repairOutputPathOf(batchId, graphDir);
  if (!fsSync.existsSync(outputPath)) throw new Error(`${batchId}: no repair output at ${outputPath}`);
  const shard = await readJson(shardPathOf(batchId, graphDir));
  const batchInput = await readJson(batchInputPathOf(batchId, graphDir));
  const stale = staleRepairScenes(repairInput, shard, batchInput);
  if (stale.length > 0) {
    throw new Error(
      `${batchId}: shard or batch input changed since prepare for ${stale.join(', ')}; run prepare again and redo the repair`
    );
  }
  const repaired = spliceRepair(shard, repairInput, await readJson(outputPath));
  const targets = new Set(repairInput.scenes.map((s) => s.scene_id));
  const result = validateShard(repaired, batchInput, { registry: await loadEntityRegistry(graphDir) });
  return {
    repaired,
    candidate: {
      schema_version: PASS1_SCHEMA_VERSION,
      batch_id: batchId,
      scenes: repaired.scenes.filter((s) => targets.has(s.scene_id)),
    },
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings.filter((w) => targets.has(w.scene_id)),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [command, ...rest] = process.argv.slice(2);
  const findingsFlag = rest.indexOf('--findings');
  const findingsPath = findingsFlag >= 0 ? rest[findingsFlag + 1] : null;
  const batchIds = findingsFlag >= 0 ? rest.filter((_, i) => i !== findingsFlag && i !== findingsFlag + 1) : rest;
  const usage =
    'Usage: node scripts/graph/repair-pass1.mjs prepare <batch_id> [batch_id...] [--findings <file>]\n' +
    '       node scripts/graph/repair-pass1.mjs <check|apply> <batch_id> [batch_id...]\n' +
    '  --findings: 독립 표본 검토가 짚은 의미 오류 목록({ findings: [...] }). 그 장면도 보수 대상에 넣는다(prepare 전용)';
  const rel = (p) => path.relative(process.cwd(), p);

  const run = async () => {
    if (batchIds.length === 0 || !['prepare', 'check', 'apply'].includes(command)) throw new Error(usage);
    if (findingsFlag >= 0 && (command !== 'prepare' || !findingsPath)) throw new Error(usage);

    if (command === 'prepare') {
      const manifestScenes = (await readJson(path.join(GRAPH_DATA_DIR, 'manifest.json'))).scenes ?? {};
      const findings = findingsPath ? parseReviewFindings(await readJson(findingsPath)) : [];
      const outside = [...new Set(findings.map((f) => f.batch_id))].filter((b) => !batchIds.includes(b));
      if (outside.length > 0) throw new Error(`findings name batches not given to prepare: ${outside.join(', ')}`);
      const bytes = {};
      for (const batchId of batchIds) {
        const { changedSceneIds, issues } = await prepareRepair(batchId, { manifestScenes, findings });
        bytes[batchId] = issues.size > 0 ? (await fs.stat(repairInputPathOf(batchId))).size : 0;
        const rules = {};
        for (const list of issues.values()) for (const i of list) rules[i.rule] = (rules[i.rule] ?? 0) + 1;
        console.log(
          `[repair] ${batchId}: ${issues.size} scene(s) to repair ${JSON.stringify(rules)}` +
            (changedSceneIds.length ? `; refreshed batch input for ${changedSceneIds.join(', ')}` : '')
        );
        if (issues.size > 0) console.log(`    input  ${rel(repairInputPathOf(batchId))}\n    output ${rel(repairOutputPathOf(batchId))}`);
      }
      for (const job of planRepairJobs(bytes)) {
        console.log(`[repair] job ${job.job} (${Math.round(job.input_bytes / 1024)}KB): ${job.batch_ids.join(', ')}`);
      }
      return;
    }

    // apply는 모든 배치가 통과해야 하나라도 쓴다(일부만 적용된 상태를 만들지 않는다)
    let failed = false;
    const passed = [];
    for (const batchId of batchIds) {
      let res;
      try {
        res = await checkRepair(batchId);
      } catch (err) {
        failed = true;
        console.error(`[FAIL] ${batchId} repair: ${err.message || err}`);
        continue;
      }
      for (const w of res.warnings) console.warn(`[WARN][${w.rule}] (${w.scene_id}) ${w.path}: ${w.message}`);
      const candidatePath = repairCandidatePathOf(batchId);
      if (!res.valid) {
        failed = true;
        if (fsSync.existsSync(candidatePath)) await fs.rm(candidatePath);
        console.error(`[FAIL] ${batchId} repair: ${res.errors.length} error(s)`);
        for (const e of res.errors) console.error(`  - [${e.rule}] (${e.scene_id ?? 'batch'}) ${e.path}: ${e.message}`);
        continue;
      }
      if (command === 'check') {
        await writeJsonAtomic(candidatePath, res.candidate);
        console.log(`[PASS] ${batchId} repair: mechanical validation succeeded (${res.warnings.length} warning(s) in repaired scenes)`);
        console.log(`    candidate ${rel(candidatePath)}`);
      }
      passed.push([batchId, res]);
    }
    if (failed) {
      if (command === 'apply') console.error('[repair] nothing applied: every batch must pass first');
      process.exit(1);
    }
    if (command === 'apply') {
      for (const [batchId, res] of passed) {
        await writeJsonAtomic(shardPathOf(batchId, GRAPH_DATA_DIR), res.repaired);
        console.log(`[repair] ${batchId}: applied (${res.warnings.length} warning(s) left in repaired scenes)`);
      }
    }
  };

  run().catch((err) => {
    console.error('[repair]', err.message || err);
    process.exit(1);
  });
}
