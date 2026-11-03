import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR } from './lib.mjs';
import { linkedEntityItems } from './validate-output.mjs';

const __filename = fileURLToPath(import.meta.url);

// 명세 2.3의 29항(LINKED_SURFACE_IN_CANDIDATES)의 기계적 수정: 같은 장면에서 entity_id로 연결한 표기와
// 같은(NFKC·앞뒤 공백 무시) unregistered_entity_candidates 항목을 지운다. 연결 자체는 바꾸지 않는다.
//   node scripts/graph/remove-linked-candidates.mjs [--write]
// --write 없이 실행하면 지울 항목 수만 보고한다. 지운 내용은 repairs/linked_candidates_removed.json에 적는다.

const keyOf = (s) => s.normalize('NFKC').trim();

export const removeLinkedCandidates = (scene) => {
  if (!Array.isArray(scene?.unregistered_entity_candidates)) return [];
  const linked = new Map();
  for (const [rel, obj, surface] of linkedEntityItems(scene)) {
    if (typeof obj?.entity_id !== 'string' || !obj.entity_id.trim() || typeof surface !== 'string' || !surface.trim()) continue;
    if (!linked.has(keyOf(surface))) linked.set(keyOf(surface), { entity_id: obj.entity_id, linked_at: rel });
  }
  const removed = [];
  scene.unregistered_entity_candidates = scene.unregistered_entity_candidates.filter((cand) => {
    const hit = typeof cand?.surface_text === 'string' ? linked.get(keyOf(cand.surface_text)) : undefined;
    if (!hit) return true;
    removed.push({ candidate: cand, ...hit });
    return false;
  });
  return removed;
};

const parseArgs = (args) => {
  const unknown = args.filter((a) => a !== '--write');
  if (unknown.length) return { error: `Unknown option(s): ${unknown.join(' ')}` };
  return { write: args.includes('--write') };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`${parsed.error}\nUsage: node scripts/graph/remove-linked-candidates.mjs [--write]`);
    process.exit(1);
  }
  const shardsDir = path.join(GRAPH_DATA_DIR, 'pass1', 'shards');
  const changes = [];
  const batches = new Set();
  for (const file of fs.readdirSync(shardsDir).filter((f) => /^batch_\d+\.json$/.test(f)).sort()) {
    const shardPath = path.join(shardsDir, file);
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    let changed = false;
    for (const scene of shard.scenes ?? []) {
      const removed = removeLinkedCandidates(scene);
      if (!removed.length) continue;
      changed = true;
      for (const r of removed) changes.push({ batch_id: file.replace(/\.json$/, ''), scene_id: scene.scene_id, ...r });
    }
    if (!changed) continue;
    batches.add(file);
    if (parsed.write) {
      fs.writeFileSync(`${shardPath}.tmp`, JSON.stringify(shard, null, 2));
      fs.renameSync(`${shardPath}.tmp`, shardPath);
    }
  }
  const scenes = new Set(changes.map((c) => c.scene_id)).size;
  console.log(`[linked-candidates] ${changes.length} candidates in ${scenes} scenes / ${batches.size} batches${parsed.write ? ' removed' : ' (dry run, use --write)'}`);
  if (parsed.write) {
    const out = path.join(GRAPH_DATA_DIR, 'pass1', 'repairs', 'linked_candidates_removed.json');
    fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), changes }, null, 1));
    console.log(`[linked-candidates] wrote ${path.relative(process.cwd(), out)}`);
  }
}
