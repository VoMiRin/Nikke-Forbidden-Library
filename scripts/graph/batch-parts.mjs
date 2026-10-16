import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, PASS1_SCHEMA_VERSION, planSceneParts, writeJsonAtomic } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 5절 Pass 1: 장면이 상한(20개)을 넘는 배치는 서브에이전트 호출만 나눠 돌리고 하나의 샤드로 합친다.
// 부분 샤드는 병합기가 읽지 않도록 pass1/shards/ 밖의 pass1/parts/에 둔다.

export const partPathOf = (batchId, partNo, graphDir = GRAPH_DATA_DIR) =>
  path.join(graphDir, 'pass1', 'parts', `${batchId}.part${partNo}.json`);

export const readBatchInput = async (batchId, graphDir = GRAPH_DATA_DIR) =>
  JSON.parse(await fs.readFile(path.join(graphDir, 'pass1', 'batches', `${batchId}.json`), 'utf8'));

export const planBatchParts = (batchInput) =>
  planSceneParts((batchInput.scenes ?? []).map((s) => s.scene_id)).map((sceneIds, idx) => ({
    part: idx + 1,
    scene_ids: sceneIds,
  }));

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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [command, batchId] = process.argv.slice(2);
  const usage = 'Usage: node scripts/graph/batch-parts.mjs <plan|combine> <batch_id>';

  const run = async () => {
    if (!batchId || !['plan', 'combine'].includes(command)) throw new Error(usage);
    const batchInput = await readBatchInput(batchId);
    const plan = planBatchParts(batchInput);

    if (command === 'plan') {
      if (plan.length === 1) {
        console.log(`[batch-parts] ${batchId}: ${plan[0].scene_ids.length} scenes, no split needed`);
        return;
      }
      console.log(`[batch-parts] ${batchId}: ${batchInput.scenes.length} scenes → ${plan.length} parts`);
      for (const { part, scene_ids: ids } of plan) {
        console.log(`  part ${part} (${ids.length} scenes) → ${path.relative(process.cwd(), partPathOf(batchId, part))}`);
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
