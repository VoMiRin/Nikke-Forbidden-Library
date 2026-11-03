import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 3절 2항의 기계적 수정: mentioned_only에서 entity_id가 null인데 같은 장면 unregistered_entity_candidates에
// 같은 표기(NFKC·앞뒤 공백 무시)가 없는 항목을 후보에 더한다. 단, 다른 장면에서 이미 후보로 적힌 표기만 더한다
// (어디서도 후보가 된 적 없는 표기는 엔티티인지 판단이 필요하므로 건드리지 않는다).
// 레지스트리의 이름(일반 역할 포함)인 표기는 후보가 아니므로 더하지 않는다.
//   node scripts/graph/add-missing-candidates.mjs [--write]
// 후보 값: surface_text·line_start는 그 언급 항목에서, suggested_type은 그 언급의 entity_type(이 장면 추출자의 판단).
// 한 장면에 같은 표기가 여러 번 있으면 첫 줄로 한 번만 더한다. 더한 내용은 repairs/missing_candidates_added.json에 적는다.

const keyOf = (s) => s.normalize('NFKC').trim();

const parseArgs = (args) => {
  const unknown = args.filter((a) => a !== '--write');
  if (unknown.length) return { error: `Unknown option(s): ${unknown.join(' ')}` };
  return { write: args.includes('--write') };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`${parsed.error}\nUsage: node scripts/graph/add-missing-candidates.mjs [--write]`);
    process.exit(1);
  }
  const reg = JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'entity_registry.json'), 'utf8'));
  const registered = new Set(Object.keys(reg.speaker_lookup).map(keyOf));
  for (const e of reg.entities) for (const n of e.surface_labels) registered.add(keyOf(n));

  const shardsDir = path.join(GRAPH_DATA_DIR, 'pass1', 'shards');
  const files = fs.readdirSync(shardsDir).filter((f) => /^batch_\d+\.json$/.test(f)).sort();
  const shards = files.map((file) => [file, JSON.parse(fs.readFileSync(path.join(shardsDir, file), 'utf8'))]);
  const candidateSurfaces = new Set();
  for (const [, shard] of shards) for (const s of shard.scenes ?? []) for (const c of s.unregistered_entity_candidates ?? []) {
    if (typeof c?.surface_text === 'string') candidateSurfaces.add(keyOf(c.surface_text));
  }

  const changes = [];
  const skipped = { registered: 0, never_candidate: 0 };
  const batches = new Set();
  for (const [file, shard] of shards) {
    let changed = false;
    for (const scene of shard.scenes ?? []) {
      if (!Array.isArray(scene.unregistered_entity_candidates)) continue;
      const have = new Set(scene.unregistered_entity_candidates.map((c) => keyOf(c.surface_text)));
      for (const m of scene.participants?.mentioned_only ?? []) {
        if (m.entity_id || typeof m.surface_text !== 'string') continue;
        const key = keyOf(m.surface_text);
        if (have.has(key)) continue;
        if (registered.has(key)) { skipped.registered++; continue; }
        if (!candidateSurfaces.has(key)) { skipped.never_candidate++; continue; }
        const cand = { surface_text: m.surface_text.trim(), suggested_type: m.entity_type, line_start: m.line_start };
        scene.unregistered_entity_candidates.push(cand);
        have.add(key);
        changed = true;
        changes.push({ batch_id: file.replace(/\.json$/, ''), scene_id: scene.scene_id, candidate: cand });
      }
    }
    if (!changed) continue;
    batches.add(file);
    if (parsed.write) {
      const shardPath = path.join(shardsDir, file);
      fs.writeFileSync(`${shardPath}.tmp`, JSON.stringify(shard, null, 2));
      fs.renameSync(`${shardPath}.tmp`, shardPath);
    }
  }
  const scenes = new Set(changes.map((c) => c.scene_id)).size;
  console.log(`[missing-candidates] ${changes.length} candidates in ${scenes} scenes / ${batches.size} batches${parsed.write ? ' added' : ' (dry run, use --write)'}`);
  console.log(`[missing-candidates] not added: registry name ${skipped.registered}, never a candidate ${skipped.never_candidate} (mentions, before de-duplication)`);
  if (parsed.write) {
    const out = path.join(GRAPH_DATA_DIR, 'pass1', 'repairs', 'missing_candidates_added.json');
    fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), changes }, null, 1));
    console.log(`[missing-candidates] wrote ${path.relative(process.cwd(), out)}`);
  }
}
