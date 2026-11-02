import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, ROOT_DIR, buildNumberedScript, parseChapterTextBlocks, writeJsonAtomic } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 이미 병합된 장면의 배치 입력(pass1/batches/<batch_id>.json)을 지금 매니페스트의 기계 추출값으로 고친다.
// build-manifest는 다시 추출할 장면의 배치만 새로 쓰므로, 재사용 장면의 배치 입력에는 옛 기계 추출값이 남는다.
// 검증기·보수 도구·병합기는 배치 입력으로 검사하므로, 기계 추출 규칙이나 레지스트리가 바뀌면 이 도구로 맞춘다(보수 4회차 0단계).
//   node scripts/graph/refresh-batch-inputs.mjs [--write] [--backup-dir <dir>] [batch_id...]
//   - 배치를 주지 않으면 batches 폴더의 batch_*.json 전부를 본다.
//   - 장면 본문(numbered_script)이 지금 원문과 다르면 그 배치는 고치지 않고 오류로 보고한다(다시 추출할 대상이다).
//   - 매니페스트에서 다른 배치로 옮겨 간 장면(옛 결과)은 건드리지 않는다.
//   - --write 없이 실행하면 바뀔 장면만 출력한다.

export const refreshBatchInputs = ({ graphDir = GRAPH_DATA_DIR, rootDir = ROOT_DIR, batchIds = null, write = false, backupDir = null } = {}) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(graphDir, 'manifest.json'), 'utf8'));
  const batchesDir = path.join(graphDir, 'pass1', 'batches');
  const ids = batchIds?.length
    ? batchIds
    : fs.readdirSync(batchesDir).filter((f) => /^batch_\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
  const bodyCache = new Map();
  const bodyOf = (sceneId) => {
    const m = manifest.scenes[sceneId];
    if (!bodyCache.has(m.source_file)) {
      const blocks = parseChapterTextBlocks(fs.readFileSync(path.join(rootDir, m.source_file), 'utf8'));
      bodyCache.set(m.source_file, new Map(blocks.map((b) => [b.scene_id, b.body_lines])));
    }
    return bodyCache.get(m.source_file).get(sceneId);
  };
  const report = { batches: [], changed_scenes: 0, errors: [] };
  for (const batchId of ids) {
    const file = path.join(batchesDir, `${batchId}.json`);
    if (!fs.existsSync(file)) {
      report.errors.push(`${batchId}: 배치 입력 파일이 없다`);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const changed = [];
    let bad = false;
    for (const scene of doc.scenes) {
      const m = manifest.scenes[scene.scene_id];
      if (!m || m.batch_id !== batchId) continue; // 다른 배치로 옮겨 간 옛 결과
      if (JSON.stringify(scene.mechanical_ground_truth) === JSON.stringify(m.mechanical_ground_truth)) continue;
      const body = bodyOf(scene.scene_id);
      if (!body || buildNumberedScript(body) !== scene.numbered_script) {
        report.errors.push(`${batchId}/${scene.scene_id}: 배치 입력의 본문이 지금 원문과 다르다(다시 추출 대상)`);
        bad = true;
        continue;
      }
      changed.push(scene.scene_id);
      scene.mechanical_ground_truth = m.mechanical_ground_truth;
    }
    if (!changed.length || bad) {
      if (changed.length) report.errors.push(`${batchId}: 본문이 다른 장면이 있어 이 배치는 고치지 않았다`);
      continue;
    }
    report.batches.push({ batch_id: batchId, scenes: changed });
    report.changed_scenes += changed.length;
    if (write) {
      if (backupDir) {
        fs.mkdirSync(backupDir, { recursive: true });
        const backup = path.join(backupDir, `${batchId}.json`);
        if (!fs.existsSync(backup)) fs.copyFileSync(file, backup); // 처음 손대기 전 것만 남긴다
      }
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    }
  }
  return report;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const bi = args.indexOf('--backup-dir');
  const backupDir = bi >= 0 ? path.resolve(args[bi + 1]) : null;
  const batchIds = args.filter((a, i) => a.startsWith('batch_') && args[i - 1] !== '--backup-dir');
  if (write && !backupDir) {
    console.error('--write에는 --backup-dir <폴더>가 필요하다(처음 손대기 전 배치 입력을 남긴다)');
    process.exit(2);
  }
  const r = refreshBatchInputs({ batchIds, write, backupDir });
  for (const b of r.batches) console.log(`${b.batch_id}: ${b.scenes.length} scene(s) ${write ? 'updated' : 'would change'} [${b.scenes.join(', ')}]`);
  for (const e of r.errors) console.log(`[ERROR] ${e}`);
  console.log(`배치 ${r.batches.length}개, 장면 ${r.changed_scenes}개 ${write ? '갱신' : '변경 예정'}, 오류 ${r.errors.length}`);
  process.exitCode = r.errors.length ? 1 : 0;
}
