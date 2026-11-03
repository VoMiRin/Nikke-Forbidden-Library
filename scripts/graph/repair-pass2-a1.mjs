import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// Pass 2 A-1 기계 연결(GRAPH_RAG_PASS2_A1.md, 사용자 확인 2026-11-04). 원문 판단은 하지 않는다.
//   node scripts/graph/repair-pass2-a1.mjs [--write]
// 1. 합친 엔티티의 옛 ID(MERGED_IDS)를 새 ID로 바꾼다. 모든 entity_id 칸이 대상이다.
//    바꾼 뒤 같은 장면 참여 갈래에 있는 인물이 언급에도 있으면 언급 쪽을 null로 한다(3절 2항, 4회차와 같음).
// 2. entity_id가 null이고 표기가 APPROVED_LINKS의 표기와 같은 항목을 그 엔티티에 잇는다.
//    - 언급(mentioned_only)은 entity_type이 character인 것만
//    - 레지스트리가 그 표기를 같은 ID로 가리킬 때만(레지스트리가 바뀌면 멈춘다)
//    - 같은 장면 참여 갈래에 같은 엔티티가 있으면 null로 두고 skip_conflict로 적는다(지우면 별칭 검색이 끊긴다)
// 3. 연결한 표기가 같은 장면 unregistered_entity_candidates에 있으면 지운다(2.3의 29항).
// 처음 손대기 전 샤드를 repairs/pass2_a1/shards_original/에, 바뀐 내용을 repairs/pass2_a1/changes.json에 남긴다.

// 2026-11-04 사용자 확인: 레비는 레비아탄의 애칭(init-registry.mjs USER_CONFIRMED_ALIASES)
export const MERGED_IDS = new Map([['char_레비', 'char_레비아탄']]);

// GRAPH_RAG_PASS2_A1.md 2.1(연결 80건)과 2.2에서 사용자가 연결로 정한 레비(7건)
export const APPROVED_LINKS = new Map([
  ['프리티', 'char_프리시아'],
  ['식스오', 'char_식스오'],
  ['아나키오르', 'char_아나키오르'],
  ['루루', 'char_루루'],
  ['마리아 박사', 'char_닥터_마리아'],
  ['피나', 'char_피나'],
  ['마리아-n', 'char_마리아_n'],
  ['마리아-2', 'char_마리아_2'],
  ['X', 'char_X'],
  ['데이파라', 'char_데이파라'],
  ['리버렐리오', 'char_리버렐리오'],
  ['해파리', 'char_리버렐리오'],
  ['마린', 'char_마린'],
  ['리안', 'char_리안'],
  ['카밀라', 'char_카밀라'],
  ['베히모스', 'char_베히모스'],
  ['카르히', 'char_카르히'],
  ['조쉬 허밋', 'char_조쉬_허밋'],
  ['#000000', 'char_000000'],
  ['레비', 'char_레비아탄'],
]);

const PART_FIELDS = ['present_in_scene', 'present_silent', 'remote_or_voice_only'];
const nfkc = (s) => String(s ?? '').normalize('NFKC').trim();
const labelOf = (item) => item?.speaker_label ?? item?.name ?? item?.surface_text ?? null;

const entityItems = (scene) => {
  const P = scene.participants;
  const out = [];
  for (const f of [...PART_FIELDS, 'mentioned_only']) P[f].forEach((it, i) => out.push({ it, path: `participants.${f}[${i}]`, field: f }));
  if (P.document_author) out.push({ it: P.document_author, path: 'participants.document_author', field: 'document_author' });
  (scene.unknown_speakers ?? []).forEach((u, i) => u.resolved_in_same_scene_to && out.push({ it: u.resolved_in_same_scene_to, path: `unknown_speakers[${i}].resolved_in_same_scene_to`, field: 'resolved' }));
  (scene.descriptor_speakers ?? []).forEach((d, i) => d.resolved_in_same_scene_to && out.push({ it: d.resolved_in_same_scene_to, path: `descriptor_speakers[${i}].resolved_in_same_scene_to`, field: 'resolved' }));
  return out;
};

export const runA1 = ({ graphDir = GRAPH_DATA_DIR, write = false } = {}) => {
  const reg = JSON.parse(fs.readFileSync(path.join(graphDir, 'entity_registry.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(graphDir, 'manifest.json'), 'utf8'));
  const progress = JSON.parse(fs.readFileSync(path.join(graphDir, 'progress.json'), 'utf8'));
  const ids = new Set(reg.entities.map((e) => e.entity_id));
  const byName = new Map();
  for (const e of reg.entities) for (const n of e.surface_labels) byName.set(nfkc(n), e.entity_id);
  for (const [oldId, newId] of MERGED_IDS) {
    if (ids.has(oldId) || !ids.has(newId)) throw new Error(`MERGED_IDS ${oldId} → ${newId}: 레지스트리가 합친 상태가 아니다`);
  }
  for (const [label, id] of APPROVED_LINKS) {
    if (byName.get(nfkc(label)) !== id) throw new Error(`APPROVED_LINKS ${label} → ${id}: 레지스트리는 ${byName.get(nfkc(label))}`);
  }
  const approved = new Map([...APPROVED_LINKS].map(([k, v]) => [nfkc(k), v]));

  const changes = [];
  const touched = new Map();
  const batchIds = Object.keys(progress.batches).filter((b) => b.startsWith('batch_')).sort();
  for (const batchId of batchIds) {
    const shardPath = path.join(graphDir, 'pass1', 'shards', `${batchId}.json`);
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    let changed = false;
    for (const scene of shard.scenes) {
      const m = manifest.scenes[scene.scene_id];
      if (!m || m.batch_id !== batchId) continue; // 옛 결과
      const P = scene.participants;
      const log = (field, oldV, newV, reason) => {
        changes.push({ batch_id: batchId, scene_id: scene.scene_id, field, old: oldV, new: newV, reason });
        if (!reason.startsWith('skip_')) changed = true;
      };
      // 1. 합친 엔티티의 옛 ID
      for (const { it, path: p } of entityItems(scene)) {
        if (!MERGED_IDS.has(it.entity_id)) continue;
        const old = it.entity_id;
        it.entity_id = MERGED_IDS.get(old);
        log(`${p}.entity_id`, old, it.entity_id, 'merged_alias_entity');
      }
      const participating = () => new Set(PART_FIELDS.flatMap((f) => P[f].map((x) => x.entity_id).filter(Boolean)));
      const partNow = participating();
      P.mentioned_only.forEach((it, i) => {
        if (it.entity_id && partNow.has(it.entity_id) && [...MERGED_IDS.values()].includes(it.entity_id)) {
          const old = it.entity_id;
          it.entity_id = null;
          log(`participants.mentioned_only[${i}].entity_id`, old, null, 'mention_duplicates_participant');
        }
      });
      // 2. 확인된 표기 연결
      const linkedLabels = new Set();
      for (const { it, path: p, field } of entityItems(scene)) {
        if (it.entity_id) continue;
        if (field === 'resolved') continue;
        const l = nfkc(labelOf(it));
        const id = approved.get(l);
        if (!id) continue;
        if (field === 'mentioned_only' && it.entity_type !== 'character') {
          log(`${p}.entity_id`, null, null, `skip_not_character:${it.entity_type}`);
          continue;
        }
        const part = participating();
        const mention = new Set(P.mentioned_only.map((x) => x.entity_id).filter(Boolean));
        const conflict = field === 'mentioned_only' ? part.has(id) : PART_FIELDS.includes(field) ? part.has(id) || mention.has(id) : false;
        if (conflict) {
          log(`${p}.entity_id`, null, null, `skip_conflict:${id}`);
          continue;
        }
        it.entity_id = id;
        if ('is_generic_role' in it) it.is_generic_role = false;
        linkedLabels.add(l);
        log(`${p}.entity_id`, null, id, 'linked_user_confirmed_label');
      }
      // 3. 연결한 표기의 후보 삭제
      if (linkedLabels.size && Array.isArray(scene.unregistered_entity_candidates)) {
        const keep = [];
        scene.unregistered_entity_candidates.forEach((c, i) => {
          if (linkedLabels.has(nfkc(c.surface_text))) log(`unregistered_entity_candidates[${i}]`, c, null, 'linked_surface_candidate_removed');
          else keep.push(c);
        });
        scene.unregistered_entity_candidates = keep;
      }
    }
    if (changed) touched.set(batchId, { shardPath, shard });
  }
  if (write) {
    const outDir = path.join(graphDir, 'pass1', 'repairs', 'pass2_a1');
    const backupDir = path.join(outDir, 'shards_original');
    fs.mkdirSync(backupDir, { recursive: true });
    for (const [batchId, { shardPath, shard }] of touched) {
      const backup = path.join(backupDir, `${batchId}.json`);
      if (!fs.existsSync(backup)) fs.copyFileSync(shardPath, backup);
      fs.writeFileSync(`${shardPath}.tmp`, JSON.stringify(shard, null, 2));
      fs.renameSync(`${shardPath}.tmp`, shardPath);
    }
    fs.writeFileSync(path.join(outDir, 'changes.json'), JSON.stringify({ generated_at: new Date().toISOString(), changes }, null, 1));
  }
  return { changes, touchedBatches: [...touched.keys()] };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--write');
  if (unknown.length) {
    console.error(`unknown argument ${unknown[0]}\nUsage: node scripts/graph/repair-pass2-a1.mjs [--write]`);
    process.exit(1);
  }
  const write = args.includes('--write');
  const r = runA1({ write });
  const count = {};
  for (const c of r.changes) {
    const k = c.reason.split(':')[0];
    count[k] = (count[k] || 0) + 1;
  }
  console.log(JSON.stringify(count), `배치 ${r.touchedBatches.length}개 ${write ? '수정' : '수정 예정'}`);
}
