import { createHash } from 'node:crypto';

export const unitElementKey = (ref) => ref.unknown_id != null
  ? `${ref.item_id}|unk:${ref.unknown_id}`
  : ref.voice_index != null ? `${ref.item_id}|voice:${ref.voice_index}` : `${ref.item_id}`;

/** 단위와 참조는 쪼개지 않는다. 각 부분은 이야기 전체 대본을 함께 쓴다. */
export const splitBundle = (bundle, maxUnits = 20) => {
  if (!Number.isInteger(maxUnits) || maxUnits < 1) throw new Error('max-units는 1 이상의 정수다');
  if (bundle.units.length <= maxUnits) return [bundle];
  const count = Math.ceil(bundle.units.length / maxUnits);
  return Array.from({ length: count }, (_, index) => {
    const units = bundle.units.slice(index * maxUnits, (index + 1) * maxUnits);
    const ids = new Set(units.map((u) => u.unit_id));
    const trim = (entries) => entries.flatMap((entry) => {
      const unit_ids = entry.unit_ids.filter((id) => ids.has(id));
      return unit_ids.length ? [{ ...entry, unit_ids }] : [];
    });
    return {
      ...bundle,
      bundle_id: `${bundle.bundle_id}__part_${String(index + 1).padStart(3, '0')}`,
      parent_bundle_id: bundle.bundle_id,
      part_index: index + 1,
      part_count: count,
      units,
      scan: { ...bundle.scan, terms: trim(bundle.scan.terms), hits: trim(bundle.scan.hits) },
    };
  });
};

export const planWaves = (bundles, waveSize = 20) => {
  if (!Number.isInteger(waveSize) || waveSize < 1) throw new Error('wave-size는 1 이상의 정수다');
  const whole = bundles.filter((b) => !b.parent_bundle_id);
  const planned = whole.map((b, i) => ({ ...b, wave: Math.floor(i / waveSize) + 1 }));

  // 나눈 큰 이야기는 일반 묶음 뒤에, 작은 이야기부터 이야기별로 회차를 모아 배치한다.
  // 앞 회차에서 드러난 규칙 문제를 고친 뒤 단위가 많은 이야기를 돌리기 위함이다.
  const parts = new Map();
  for (const b of bundles.filter((x) => x.parent_bundle_id)) {
    if (!parts.has(b.parent_bundle_id)) parts.set(b.parent_bundle_id, []);
    parts.get(b.parent_bundle_id).push(b);
  }
  const unitsOf = (group) => group.reduce((sum, b) => sum + (b.units ?? 0), 0);
  const groups = [...parts.values()].sort((a, b) => unitsOf(a) - unitsOf(b));

  let wave = planned.at(-1)?.wave ?? 0;
  let used = whole.length % waveSize; // 마지막 일반 회차에 남은 자리
  let holdsParts = false;
  for (const group of groups) {
    if (wave === 0 || holdsParts || used === 0 || used + group.length > waveSize) {
      wave += 1;
      used = 0;
    }
    group.forEach((b, i) => {
      if (i > 0 && (used % waveSize) === 0) {
        wave += 1;
        used = 0;
      }
      planned.push({ ...b, wave });
      used += 1;
    });
    holdsParts = true;
  }
  return planned;
};

export const selectWave = (plan, wave) => {
  if (wave === null || wave === undefined) return plan.bundles;
  if (!Number.isInteger(wave) || wave < 1) throw new Error('wave는 1 이상의 정수다');
  const selected = plan.bundles.filter((b) => b.wave === wave);
  if (!selected.length) throw new Error(`계획에 없는 회차: ${wave}`);
  return selected;
};

/** 판정 단위 기준. 종류·판정·확신도별로 최소 하나, 각 층의 ceil(rate*N)을 고정 추출한다. */
export const sampleAuditCases = ({ planBundles, bundles, links, rate = 0.1, seed = 'B', includeIds = [] }) => {
  if (!(rate > 0 && rate <= 1)) throw new Error('audit rate는 0 초과 1 이하다');
  const byElement = new Map();
  for (const link of links) for (const ref of link.subject) {
    const key = `${link.bundle_id}|${unitElementKey(ref)}`;
    if (byElement.has(key)) throw new Error(`중복 subject: ${key}`);
    byElement.set(key, link);
  }
  const strata = new Map();
  let total = 0;
  for (const b of planBundles) for (const unit of bundles.get(b.bundle_id).units) {
    const matched = unit.subject_refs.map((r) => byElement.get(`${b.bundle_id}|${unitElementKey(r)}`));
    if (!matched.length || matched.some((l) => !l)) throw new Error(`미병합 단위: ${b.bundle_id} ${unit.unit_id}`);
    const unitLinks = [...new Set(matched)];
    const decisions = [...new Set(unitLinks.map((l) => `${l.verdict}/${l.confidence}`))].sort().join('+');
    const stratum = `${unit.unit_type}/${decisions}`;
    const audit_id = `${b.bundle_id}:${unit.unit_id}`;
    const item = { audit_id, bundle_id: b.bundle_id, unit_id: unit.unit_id, stratum, input_file: b.input, script_file: b.script, unit, links: unitLinks };
    if (!strata.has(stratum)) strata.set(stratum, []);
    strata.get(stratum).push(item);
    total += 1;
  }
  const rank = (item) => createHash('sha256').update(`${seed}|${item.audit_id}`).digest('hex');
  const required = new Set(includeIds);
  const available = new Set([...strata.values()].flat().map((x) => x.audit_id));
  for (const id of required) if (!available.has(id)) throw new Error(`이전 감사 단위가 회차에서 사라졌다: ${id}`);
  const items = [];
  const counts = [];
  for (const [stratum, candidates] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const n = Math.ceil(candidates.length * rate);
    const chosen = [...new Set([...candidates.toSorted((a, b) => rank(a).localeCompare(rank(b))).slice(0, n), ...candidates.filter((x) => required.has(x.audit_id))])];
    items.push(...chosen);
    counts.push({ stratum, population: candidates.length, sampled: chosen.length });
  }
  return { population_units: total, sampled_units: items.length, rate, strata: counts, items };
};
