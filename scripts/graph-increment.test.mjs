import test from 'node:test';
import assert from 'node:assert/strict';
import { diffScenes, itemIdsOfScene, makeRetraction } from './graph/increment-scope.mjs';

test('diffScenes: 새·바뀐·지운 장면을 정규화 본문 해시로 가른다', () => {
  const base = { a: { source_sha256: '1', batch_id: 'batch_0001' }, b: { source_sha256: '2', batch_id: 'batch_0001' }, c: { source_sha256: '3', batch_id: 'batch_0002' } };
  const now = { a: { title_id: 't', source_sha256: '1', batch_id: 'batch_0001' }, b: { title_id: 't', source_sha256: '9', batch_id: 'batch_0441' }, d: { title_id: 'u', source_sha256: '4', batch_id: 'batch_0441' } };
  const d = diffScenes(base, now);
  assert.deepEqual(d.added.map((s) => s.scene_id), ['d']);
  assert.deepEqual(d.changed.map((s) => [s.scene_id, s.old_source_sha256, s.source_sha256, s.old_batch_id, s.batch_id]), [['b', '2', '9', 'batch_0001', 'batch_0441']]);
  assert.deepEqual(d.deleted.map((s) => s.scene_id), ['c']);
});

test('itemIdsOfScene: 장면 객체 안의 item_id를 깊이와 상관없이 모아 정렬한다', () => {
  const scene = { scene_id: 's', clues_and_hooks: [{ item_id: 's__clh_002' }, { item_id: 's__clh_001' }], participants: { document_author: { item_id: 's__dca_001' }, mentioned_only: [{ item_id: 's__men_001', nested: { item_id: 's__x_001' } }] } };
  assert.deepEqual(itemIdsOfScene(scene), ['s__clh_001', 's__clh_002', 's__dca_001', 's__men_001', 's__x_001']);
});

test('makeRetraction: 증분 k에서 바뀐 장면은 증분 k보다 앞선 묶음에만 철회 대상이다', () => {
  const r = makeRetraction([
    { increment_id: 'inc_001', changed_scenes: [{ scene_id: 'a' }], deleted_scenes: [{ scene_id: 'd' }] },
    { increment_id: 'inc_002', changed_scenes: [{ scene_id: 'b' }] },
  ]);
  assert.equal(r.isRetracted(undefined, 'a'), true); // 본 실행 묶음
  assert.equal(r.isRetracted('inc_001', 'a'), false); // 그 증분이 다시 판정한 묶음
  assert.equal(r.isRetracted(undefined, 'd'), true);
  assert.equal(r.isRetracted('inc_001', 'b'), true); // 다음 증분에서 또 바뀜
  assert.equal(r.isRetracted('inc_002', 'b'), false);
  assert.equal(r.isRetracted(undefined, 'z'), false);
});
