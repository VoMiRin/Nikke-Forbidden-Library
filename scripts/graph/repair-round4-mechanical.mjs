import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 보수 4회차 0단계의 기계적인 수정(GRAPH_RAG_PASS1_REPAIR_ROUND4.md). 원문 판단이 필요한 것은 하지 않는다.
//   node scripts/graph/repair-round4-mechanical.mjs [--write]
// 1. 레지스트리에 없는 entity_id: 그 항목 표기로 새 레지스트리를 찾아 바꾼다. 일반 역할이 된 표기는 null(현장·원격 화자는 is_generic_role: true).
//    표기로 못 찾으면 옛 레지스트리(git HEAD)의 그 엔티티 이름으로 찾는다. 그래도 없으면 null.
// 2. 파서가 화자로 잘못 잡았던 라벨(JUNK_SPEAKER_LABELS)의 참여자 항목을 지운다. 배치 입력 화자 목록에 없을 때만.
// 3. entity_id가 null인데 표기가 레지스트리 이름·별칭과 정확히 같은 항목을 연결한다.
//    - 제외: SKIP_LINK_LABELS(지휘관·신)
//    - 화자로 나온 이야기가 LOCAL_TITLE_LIMIT개 이하인 인물은 그 이야기 안의 항목만 연결한다(이야기 하나에만 나오는 역할 이름 보호).
//      메인 스토리는 장마다 타이틀이 다르지만 한 이야기이므로 장 전체를 하나로 센다
//    - 연결하면 같은 장면 안에서 인물이 중복돼 검증 오류(3절 2항)가 나는 경우는 건너뛴다
// 수정한 샤드는 처음 손대기 전 것을 repairs/round4/shards_original/에 남기고, 바꾼 내용을 repairs/round4/mechanical_changes.json에 적는다.

export const JUNK_SPEAKER_LABELS = new Set(['아크레인저 극장판', '가제', '기획 의도', '취재 대상', '진행 상황', '목표 지점까지의 최고 달성률']);
// 지휘관·신: 시대·대상에 따라 다른 존재. ㅇㅇ: 익명 메신저 이름. 곰…?: 레지스트리 표기(곰...?)와 문자가 달라 검증기 28항 경고가 난다
export const SKIP_LINK_LABELS = new Set(['지휘관', '신', 'ㅇㅇ', '곰…?']);
const SKIP_LINK_NFKC = new Set([...SKIP_LINK_LABELS].map((x) => x.normalize('NFKC').trim()));
export const LOCAL_TITLE_LIMIT = 3;
const PART_FIELDS = ['present_in_scene', 'present_silent', 'remote_or_voice_only'];
const nfkc = (s) => String(s ?? '').normalize('NFKC').trim();
const labelOf = (item) => item?.speaker_label ?? item?.name ?? item?.surface_text ?? null;
const storyOf = (titleId) => (String(titleId).startsWith('main_story__') ? 'main_story' : titleId);

export const runMechanical = ({ graphDir = GRAPH_DATA_DIR, oldRegistry, write = false }) => {
  const reg = JSON.parse(fs.readFileSync(path.join(graphDir, 'entity_registry.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(graphDir, 'manifest.json'), 'utf8'));
  const progress = JSON.parse(fs.readFileSync(path.join(graphDir, 'progress.json'), 'utf8'));
  const ids = new Set(reg.entities.map((e) => e.entity_id));
  const byName = new Map(); // 표기 → { entity_id | null(일반 역할) }
  for (const e of reg.entities) for (const n of e.surface_labels) byName.set(nfkc(n), e.entity_id);
  for (const [k, v] of Object.entries(reg.speaker_lookup)) if (!byName.has(nfkc(k))) byName.set(nfkc(k), v.entity_id ?? null);
  const genericLabels = new Set(Object.entries(reg.speaker_lookup).filter(([, v]) => v.is_generic_role).map(([k]) => nfkc(k)));
  const oldNameById = new Map((oldRegistry?.entities ?? []).map((e) => [e.entity_id, e.canonical_name]));
  // 인물이 화자로 나온 이야기
  const titlesById = new Map();
  for (const [, s] of Object.entries(manifest.scenes)) {
    for (const sp of s.mechanical_ground_truth.speakers) {
      const id = reg.speaker_lookup[sp.speaker_label]?.entity_id;
      if (!id) continue;
      if (!titlesById.has(id)) titlesById.set(id, new Set());
      titlesById.get(id).add(storyOf(s.title_id));
    }
  }
  const changes = [];
  const touched = new Map();
  const batchIds = Object.keys(progress.batches).filter((b) => b.startsWith('batch_')).sort();
  for (const batchId of batchIds) {
    const shardPath = path.join(graphDir, 'pass1', 'shards', `${batchId}.json`);
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    const input = JSON.parse(fs.readFileSync(path.join(graphDir, 'pass1', 'batches', `${batchId}.json`), 'utf8'));
    const inputById = new Map(input.scenes.map((s) => [s.scene_id, s]));
    let changed = false;
    shard.scenes.forEach((scene, si) => {
      const m = manifest.scenes[scene.scene_id];
      if (!m || m.batch_id !== batchId) return; // 옛 결과
      const P = scene.participants;
      const speakers = new Set((inputById.get(scene.scene_id)?.mechanical_ground_truth?.speakers ?? []).map((s) => nfkc(s.speaker_label)));
      const log = (field, oldV, newV, reason) => {
        changes.push({ batch_id: batchId, scene_id: scene.scene_id, field, old: oldV, new: newV, reason });
        changed = true;
      };
      // 2. 잘못 잡힌 화자 항목 삭제
      for (const f of PART_FIELDS) {
        const keep = [];
        P[f].forEach((it, i) => {
          const l = nfkc(labelOf(it));
          if (JUNK_SPEAKER_LABELS.has(l) && !speakers.has(l)) log(`participants.${f}[${i}]`, it, null, 'junk_speaker_removed');
          else keep.push(it);
        });
        P[f] = keep;
      }
      // 모든 entity_id 항목
      const entityItems = () => {
        const out = [];
        for (const f of [...PART_FIELDS, 'mentioned_only']) P[f].forEach((it, i) => out.push({ it, path: `participants.${f}[${i}]`, field: f }));
        if (P.document_author) out.push({ it: P.document_author, path: 'participants.document_author', field: 'document_author' });
        scene.unknown_speakers.forEach((u, i) => u.resolved_in_same_scene_to && out.push({ it: u.resolved_in_same_scene_to, path: `unknown_speakers[${i}].resolved_in_same_scene_to`, field: 'resolved' }));
        (scene.descriptor_speakers ?? []).forEach((d, i) => d.resolved_in_same_scene_to && out.push({ it: d.resolved_in_same_scene_to, path: `descriptor_speakers[${i}].resolved_in_same_scene_to`, field: 'resolved' }));
        return out;
      };
      // 1. 레지스트리에 없는 ID
      for (const { it, path: p, field } of entityItems()) {
        if (!it.entity_id || ids.has(it.entity_id)) continue;
        const l = nfkc(labelOf(it));
        let next = byName.has(l) ? byName.get(l) : undefined;
        if (next === undefined) {
          const oldName = oldNameById.get(it.entity_id);
          next = oldName && byName.has(nfkc(oldName)) ? byName.get(nfkc(oldName)) : null;
        }
        const old = it.entity_id;
        it.entity_id = next ?? null;
        if (!it.entity_id && 'is_generic_role' in it && genericLabels.has(l)) it.is_generic_role = true;
        log(`${p}.entity_id`, old, it.entity_id, it.entity_id ? 'merged_into_alias_entity' : 'entity_removed_from_registry');
      }
      // 중복 정리: 참여 갈래(현장·무발화·원격)에 있는 인물이 언급에도 있으면 언급 쪽을 null로
      const participating = new Set(PART_FIELDS.flatMap((f) => P[f].map((x) => x.entity_id).filter(Boolean)));
      P.mentioned_only.forEach((it, i) => {
        if (it.entity_id && participating.has(it.entity_id)) {
          const old = it.entity_id;
          it.entity_id = null;
          log(`participants.mentioned_only[${i}].entity_id`, old, null, 'mention_duplicates_participant');
        }
      });
      // 3. 표기가 같은 null 연결
      for (const { it, path: p, field } of entityItems()) {
        if (it.entity_id) continue;
        if (field === 'mentioned_only' && it.entity_type !== 'character') continue;
        const l = nfkc(labelOf(it));
        if (!l || SKIP_LINK_NFKC.has(l) || genericLabels.has(l)) continue;
        const id = byName.get(l);
        if (!id) continue;
        const titles = titlesById.get(id);
        if (titles && titles.size <= LOCAL_TITLE_LIMIT && !titles.has(storyOf(m.title_id))) {
          changes.push({ batch_id: batchId, scene_id: scene.scene_id, field: `${p}.entity_id`, old: null, new: null, reason: `skip_local_entity_other_title:${id}` });
          continue;
        }
        const partNow = new Set(PART_FIELDS.flatMap((f) => P[f].map((x) => x.entity_id).filter(Boolean)));
        const mentionNow = new Set(P.mentioned_only.map((x) => x.entity_id).filter(Boolean));
        const conflict = field === 'mentioned_only' ? partNow.has(id) : PART_FIELDS.includes(field) ? partNow.has(id) || mentionNow.has(id) : false;
        if (conflict) {
          changes.push({ batch_id: batchId, scene_id: scene.scene_id, field: `${p}.entity_id`, old: null, new: null, reason: `skip_conflict:${id}` });
          continue;
        }
        it.entity_id = id;
        if ('is_generic_role' in it) it.is_generic_role = false;
        log(`${p}.entity_id`, null, id, 'linked_exact_registry_label');
      }
    });
    if (changed) touched.set(batchId, { shardPath, shard });
  }
  if (write) {
    const backupDir = path.join(graphDir, 'pass1', 'repairs', 'round4', 'shards_original');
    fs.mkdirSync(backupDir, { recursive: true });
    for (const [batchId, { shardPath, shard }] of touched) {
      const backup = path.join(backupDir, `${batchId}.json`);
      if (!fs.existsSync(backup)) fs.copyFileSync(shardPath, backup);
      fs.writeFileSync(`${shardPath}.tmp`, JSON.stringify(shard, null, 2));
      fs.renameSync(`${shardPath}.tmp`, shardPath);
    }
    fs.writeFileSync(path.join(graphDir, 'pass1', 'repairs', 'round4', 'mechanical_changes.json'), JSON.stringify({ generated_at: new Date().toISOString(), changes }, null, 1));
  }
  return { changes, touchedBatches: [...touched.keys()] };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const write = process.argv.includes('--write');
  const oldRegIdx = process.argv.indexOf('--old-registry');
  const oldRegistry = oldRegIdx >= 0 ? JSON.parse(fs.readFileSync(process.argv[oldRegIdx + 1], 'utf8')) : null;
  const r = runMechanical({ write, oldRegistry });
  const count = {};
  for (const c of r.changes) {
    const k = c.reason.split(':')[0];
    count[k] = (count[k] || 0) + 1;
  }
  console.log(JSON.stringify(count), `배치 ${r.touchedBatches.length}개 ${write ? '수정' : '수정 예정'}`);
}
