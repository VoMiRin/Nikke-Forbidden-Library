// 증분 범위 파일(GRAPH_RAG_INCREMENT_DESIGN.md 4.1). 하위 단계(A-2·B·C)는 "바뀐 장면"을 이 파일에서만 읽는다.
//
//   node scripts/graph/increment-scope.mjs build --id=inc_001 --base=<증분 전 커밋>
//     증분 전 커밋의 progress.json·by_title과 지금 manifest.json을 비교해 새·바뀐·지운 장면과
//     바뀐·지운 장면의 옛 Pass 1 항목 ID를 적는다. Pass 1 병합 전에 만든다.
//   node scripts/graph/increment-scope.mjs refresh --id=inc_001
//     Pass 1 병합 뒤 새·바뀐 장면의 새 항목 ID와 병합 상태를 덧붙인다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, ROOT_DIR, writeJsonAtomic } from './lib.mjs';

export const INCREMENTS_DIR = path.join(GRAPH_DATA_DIR, 'increments');

/** 장면 객체 안의 항목 ID 전부(병합기가 붙인 item_id). 정렬해 낸다 */
export const itemIdsOfScene = (scene) => {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.item_id === 'string') out.add(v.item_id);
      Object.values(v).forEach(walk);
    }
  };
  walk(scene);
  return [...out].sort();
};

/**
 * 증분 전 장면 기록(progress.json scenes)과 지금 manifest 장면을 비교한다.
 * 해시는 manifest와 같은 정규화 본문 해시(source_sha256)다.
 */
export const diffScenes = (baseScenes, manifestScenes) => {
  const added = [];
  const changed = [];
  const deleted = [];
  for (const [id, s] of Object.entries(manifestScenes)) {
    const b = baseScenes[id];
    if (!b) added.push({ scene_id: id, title_id: s.title_id, source_sha256: s.source_sha256, batch_id: s.batch_id ?? null });
    else if (b.source_sha256 !== s.source_sha256) changed.push({ scene_id: id, title_id: s.title_id, old_source_sha256: b.source_sha256, source_sha256: s.source_sha256, old_batch_id: b.batch_id ?? null, batch_id: s.batch_id ?? null });
  }
  for (const [id, b] of Object.entries(baseScenes)) {
    if (!manifestScenes[id]) deleted.push({ scene_id: id, old_source_sha256: b.source_sha256, old_batch_id: b.batch_id ?? null });
  }
  const byId = (a, b) => (a.scene_id < b.scene_id ? -1 : a.scene_id > b.scene_id ? 1 : 0);
  return { added: added.sort(byId), changed: changed.sort(byId), deleted: deleted.sort(byId) };
};

const incNo = (id) => {
  const m = /^inc_(\d{3})$/.exec(id ?? '');
  return m ? Number(m[1]) : 0;
};

/**
 * 철회 판단(4.2). 증분 k에서 바뀌거나 지운 장면을, 증분 k보다 앞선 묶음(increment 필드가 없는 본 실행 묶음 포함)이
 * 근거·출현으로 가리키면 그 부분은 철회 대상이다. 묶음은 만들 때의 increment ID를 bundle.increment에 적는다.
 */
export const makeRetraction = (scopes) => {
  const changedAt = new Map(); // scene_id → 마지막으로 바뀐 증분 번호
  for (const s of [...scopes].sort((a, b) => incNo(a.increment_id) - incNo(b.increment_id))) {
    const n = incNo(s.increment_id);
    for (const x of [...(s.changed_scenes ?? []), ...(s.deleted_scenes ?? [])]) changedAt.set(x.scene_id, n);
  }
  const isRetracted = (bundleIncrement, sceneId) => {
    const n = changedAt.get(sceneId);
    return n !== undefined && incNo(bundleIncrement) < n;
  };
  return { changedAt, isRetracted, scopes };
};

export const loadScopes = (dir = INCREMENTS_DIR) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^inc_\d{3}\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    : [];
export const loadRetraction = (dir = INCREMENTS_DIR) => makeRetraction(loadScopes(dir));

const git = (...args) => execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitJson = (rev, rel) => JSON.parse(git('show', `${rev}:${rel}`));
const byTitleRel = (titleId) => `data/graph/pass1/by_title/${titleId}.json`;
const scopePath = (id) => path.join(INCREMENTS_DIR, `${id}.json`);
const loadManifestScenes = () => JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'manifest.json'), 'utf8')).scenes;

const sceneFromByTitle = (doc, sceneId) => (doc?.scenes ?? []).find((s) => s.scene_id === sceneId) ?? null;

const buildScope = ({ id, base }) => {
  const rev = git('rev-parse', base).trim();
  const baseProgress = gitJson(rev, 'data/graph/progress.json');
  const manifestScenes = loadManifestScenes();
  const d = diffScenes(baseProgress.scenes ?? {}, manifestScenes);
  // 옛 Pass 1 항목: 증분 전 커밋의 by_title에서 읽는다(Pass 1 병합 뒤에도 같은 값을 다시 얻을 수 있다)
  const oldDocs = new Map();
  const oldDoc = (titleId) => {
    if (!oldDocs.has(titleId)) {
      try {
        oldDocs.set(titleId, gitJson(rev, byTitleRel(titleId)));
      } catch {
        oldDocs.set(titleId, null);
      }
    }
    return oldDocs.get(titleId);
  };
  const baseTitleOf = (sceneId) => baseProgress.scenes?.[sceneId]?.title_id ?? manifestScenes[sceneId]?.title_id;
  for (const s of [...d.changed, ...d.deleted]) {
    const scene = sceneFromByTitle(oldDoc(s.title_id ?? baseTitleOf(s.scene_id)), s.scene_id);
    s.old_item_ids = scene ? itemIdsOfScene(scene) : null;
  }
  const baseTitles = new Set(Object.values(baseProgress.scenes ?? {}).map((s) => s.title_id).filter(Boolean));
  // progress.json 장면 기록에 title_id가 없으면 by_title 파일 유무로 본다
  const titleExistedBefore = (t) => baseTitles.has(t) || oldDoc(t) !== null;
  const newTitles = [...new Set(d.added.map((s) => s.title_id))].filter((t) => !titleExistedBefore(t)).sort();
  return {
    schema_version: 'increment-scope-0.1.0',
    increment_id: id,
    generated_at: new Date().toISOString(),
    base_commit: rev,
    note: '하위 단계(A-2·B·C)의 철회·증분 모집단 기준. 바뀐·지운 장면의 옛 판(old_source_sha256)에 근거를 둔 옛 판정은 철회 대상이다(GRAPH_RAG_INCREMENT_DESIGN.md 4.2)',
    counts: { added: d.added.length, changed: d.changed.length, deleted: d.deleted.length, new_titles: newTitles.length },
    new_titles: newTitles,
    added_scenes: d.added,
    changed_scenes: d.changed,
    deleted_scenes: d.deleted,
    pass1: null,
  };
};

const refreshScope = (scope) => {
  const progress = JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'progress.json'), 'utf8'));
  const docs = new Map();
  const doc = (t) => {
    if (!docs.has(t)) {
      const p = path.join(ROOT_DIR, byTitleRel(t));
      docs.set(t, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
    }
    return docs.get(t);
  };
  const pending = [];
  for (const s of [...scope.added_scenes, ...scope.changed_scenes]) {
    const pr = progress.scenes?.[s.scene_id];
    const merged = pr?.status === 'merged' && pr.source_sha256 === s.source_sha256;
    if (!merged) {
      pending.push(s.scene_id);
      s.item_ids = null;
      continue;
    }
    const scene = sceneFromByTitle(doc(s.title_id), s.scene_id);
    s.item_ids = scene ? itemIdsOfScene(scene) : null;
    if (!scene) pending.push(s.scene_id);
  }
  scope.pass1 = { refreshed_at: new Date().toISOString(), merged: pending.length === 0, pending_scenes: pending };
  return scope;
};

const argValue = (args, name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const id = argValue(args, 'id');
  if (!id || !/^inc_\d{3}$/.test(id)) throw new Error('--id=inc_NNN');
  if (cmd === 'build') {
    const base = argValue(args, 'base');
    if (!base) throw new Error('--base=<증분 전 커밋>');
    if (fs.existsSync(scopePath(id)) && !args.includes('--force')) throw new Error(`이미 있다: ${path.relative(ROOT_DIR, scopePath(id))}`);
    const scope = buildScope({ id, base });
    fs.mkdirSync(INCREMENTS_DIR, { recursive: true });
    await writeJsonAtomic(scopePath(id), scope);
    const c = scope.counts;
    console.log(`[increment-scope] ${id}: 새 장면 ${c.added}, 바뀐 장면 ${c.changed}, 지운 장면 ${c.deleted}, 새 이야기 ${c.new_titles} (기준 ${scope.base_commit.slice(0, 8)})`);
    for (const s of scope.changed_scenes) console.log(`  바뀜 ${s.scene_id}: 옛 항목 ${s.old_item_ids?.length ?? '없음'}개, ${s.old_batch_id} → ${s.batch_id}`);
    for (const s of scope.deleted_scenes) console.log(`  지움 ${s.scene_id}: 옛 항목 ${s.old_item_ids?.length ?? '없음'}개`);
    console.log(`  새 이야기: ${scope.new_titles.join(', ') || '없음'}`);
    return;
  }
  if (cmd === 'refresh') {
    const scope = JSON.parse(fs.readFileSync(scopePath(id), 'utf8'));
    refreshScope(scope);
    await writeJsonAtomic(scopePath(id), scope);
    console.log(`[increment-scope] ${id}: Pass 1 병합 ${scope.pass1.merged ? '완료' : `미완료(${scope.pass1.pending_scenes.join(', ')})`}`);
    for (const s of scope.changed_scenes) {
      const same = s.item_ids && s.old_item_ids ? s.item_ids.filter((x) => s.old_item_ids.includes(x)).length : null;
      console.log(`  바뀜 ${s.scene_id}: 옛 ${s.old_item_ids?.length ?? '-'} → 새 ${s.item_ids?.length ?? '-'}(ID 같은 것 ${same ?? '-'})`);
    }
    return;
  }
  throw new Error('사용법: build --id=inc_NNN --base=<커밋> | refresh --id=inc_NNN');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[increment-scope] ${err.message}`);
    process.exitCode = 1;
  });
}
