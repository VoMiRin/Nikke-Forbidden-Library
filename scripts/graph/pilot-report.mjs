import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, writeJsonAtomic } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 8절 4단계 파일럿 보고 중 기계적으로 셀 수 있는 항목을 모은다.
// 1.3.0 샤드를 shards_1.2.0의 1.2.0 샤드와 비교한다. 비교는 양쪽에 모두 있는 장면만 한다
// (pilot_0002는 1.3.0에서 coins_in_rush_09를 gingerbreadhouse_02로 바꿨다).
export const PILOT_COMPARISONS = [
  { batch_id: 'batch_0001', baseline: 'batch_0001' },
  { batch_id: 'pilot_full_0025', baseline: 'batch_0025' },
  { batch_id: 'pilot_0001', baseline: 'pilot_0001' },
  { batch_id: 'pilot_0002', baseline: 'pilot_0002' },
];

const readJsonIfExists = async (p) => (fsSync.existsSync(p) ? JSON.parse(await fs.readFile(p, 'utf8')) : null);

const noteExample = (sceneId, n) => ({
  scene_id: sceneId,
  lines: `${n.line_start}~${n.line_end}`,
  subject: n.subject,
  target: n.target,
  relation_or_change: n.relation_or_change,
  epistemic_type: n.epistemic_type ?? null,
  claimant: n.claimant ?? null,
  quote: n.quote,
});

const rangesOverlap = (a, b) => a.line_start <= b.line_end && b.line_start <= a.line_end;

/**
 * 한 배치의 1.3.0 샤드를 요약하고, 기준 1.2.0 샤드가 있으면 관계 메모를 비교한다.
 */
export const summarizeBatch = (shard, baselineShard = null, examplesPerType = 5) => {
  const scenes = shard.scenes ?? [];
  const notes = scenes.flatMap((s) => (s.relationship_and_lore_notes ?? []).map((n) => ({ scene_id: s.scene_id, n })));
  const events = scenes.flatMap((s) => s.events_and_claims ?? []);

  const byType = {};
  for (const { scene_id: sid, n } of notes) {
    const key = n.epistemic_type ?? 'missing';
    byType[key] = byType[key] ?? { count: 0, examples: [] };
    byType[key].count += 1;
    if (byType[key].examples.length < examplesPerType) byType[key].examples.push(noteExample(sid, n));
  }

  const eventTypes = {};
  for (const ev of events) eventTypes[ev.epistemic_type] = (eventTypes[ev.epistemic_type] ?? 0) + 1;

  const claims = [
    ...events.filter((e) => e.epistemic_type === 'character_claim').map((e) => e.actor_or_speaker),
    ...notes.filter(({ n }) => n.epistemic_type === 'character_claim').map(({ n }) => n.claimant),
  ];

  const summary = {
    scenes: scenes.length,
    relationship_notes: notes.length,
    relationship_notes_by_type: byType,
    events_and_claims: events.length,
    events_by_type: eventTypes,
    claims_by_unknown_speaker: claims.filter((c) => c === '???').length,
    claims_from_narration: claims.filter((c) => c === '지문').length,
    descriptor_speakers: scenes.reduce((acc, s) => acc + (s.descriptor_speakers?.length ?? 0), 0),
    trait_clues: scenes.reduce((acc, s) => acc + (s.clues_and_hooks ?? []).filter((c) => c.category === 'trait').length, 0),
    mixed_scenes: scenes.filter((s) => s.chronology_type === 'mixed').length,
  };

  if (baselineShard) {
    const currentIds = new Set(scenes.map((s) => s.scene_id));
    const baseScenes = (baselineShard.scenes ?? []).filter((s) => currentIds.has(s.scene_id));
    const scenesOnlyInCurrent = scenes.filter((s) => !baseScenes.some((b) => b.scene_id === s.scene_id));
    const comparedNotes = notes.filter((x) => baseScenes.some((b) => b.scene_id === x.scene_id));
    const baseNotes = baseScenes.flatMap((s) =>
      (s.relationship_and_lore_notes ?? []).map((n) => ({ scene_id: s.scene_id, n }))
    );
    // 1.2.0 메모 중 같은 장면에 줄 범위가 겹치는 1.3.0 메모가 없는 것: 빠지면 안 되는 관계인지 사람이 확인할 대상
    const dropped = baseNotes.filter(
      ({ scene_id: sid, n }) => !notes.some((x) => x.scene_id === sid && rangesOverlap(x.n, n))
    );
    summary.baseline = {
      compared_scenes: baseScenes.length,
      scenes_without_baseline: scenesOnlyInCurrent.map((s) => s.scene_id),
      relationship_notes_1_3_0_in_compared_scenes: comparedNotes.length,
      relationship_notes_1_2_0: baseNotes.length,
      change: comparedNotes.length - baseNotes.length,
      events_and_claims_1_2_0: baseScenes.reduce((acc, s) => acc + (s.events_and_claims?.length ?? 0), 0),
      dropped_1_2_0_notes_count: dropped.length,
      dropped_1_2_0_notes: dropped.map(({ scene_id: sid, n }) => noteExample(sid, n)),
    };
  }
  return summary;
};

export const buildPilotReport = async (options = {}) => {
  const graphDir = options.graphDir ?? GRAPH_DATA_DIR;
  const shardsDir = path.join(graphDir, 'pass1', 'shards');
  const baselineDir = path.join(graphDir, 'pass1', 'shards_1.2.0');
  const batches = {};
  for (const { batch_id: id, baseline } of options.comparisons ?? PILOT_COMPARISONS) {
    const shard = await readJsonIfExists(path.join(shardsDir, `${id}.json`));
    if (!shard) {
      batches[id] = { missing: true };
      continue;
    }
    const base = baseline ? await readJsonIfExists(path.join(baselineDir, `${baseline}.json`)) : null;
    batches[id] = { baseline_batch: baseline, ...summarizeBatch(shard, base) };
  }
  const density = {
    pilot: (await readJsonIfExists(path.join(graphDir, 'pilot', 'pass1_density_report.json')))?.totals_by_position ?? null,
    main: (await readJsonIfExists(path.join(graphDir, 'pass1_density_report.json')))?.totals_by_position ?? null,
    baseline_1_2_0: [
      { position: 'front', events_per_100_lines: 5.7 },
      { position: 'middle', events_per_100_lines: 4.7 },
      { position: 'back', events_per_100_lines: 4.5 },
    ],
  };
  return { generated_at: new Date().toISOString(), batches, density };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildPilotReport()
    .then(async (report) => {
      const outPath = path.join(GRAPH_DATA_DIR, 'pilot', 'pilot_report_1.3.0.json');
      await writeJsonAtomic(outPath, report);
      for (const [id, b] of Object.entries(report.batches)) {
        if (b.missing) {
          console.log(`[pilot-report] ${id}: shard missing`);
          continue;
        }
        const base = b.baseline
          ? `, 1.2.0 notes ${b.baseline.relationship_notes_1_2_0} (${b.baseline.change >= 0 ? '+' : ''}${b.baseline.change}), dropped-to-review ${b.baseline.dropped_1_2_0_notes_count}`
          : '';
        const types = Object.entries(b.relationship_notes_by_type).map(([k, v]) => `${k}=${v.count}`).join(' ');
        console.log(`[pilot-report] ${id}: notes ${b.relationship_notes} [${types}]${base}`);
      }
      console.log(`[pilot-report] Written: ${outPath}`);
    })
    .catch((err) => {
      console.error('[pilot-report] Error:', err);
      process.exitCode = 1;
    });
}
