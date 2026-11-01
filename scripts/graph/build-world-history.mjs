#!/usr/bin/env node
// 게임 데이터의 공식 연표(HistoryManagerTable)를 아카이브 타이틀·장면에 대응시킨다.
//
// 사용법:
//   node scripts/graph/build-world-history.mjs --source <게임 csv 폴더> --snapshot-date YYYY-MM-DD
//
// <게임 csv 폴더>에는 Data/ 와 Locale/ 가 있어야 한다.
// 출력:
//   data/graph/world_history/<날짜>/  원본 연표 테이블 사본과 이 스크립트가 쓴 이름·앨범 발췌
//   data/graph/world_history_order.csv  작중 순서 대응표(가장 최근 실행 결과)
//   data/graph/world_history_review.json  사람이 확인해야 할 항목
//
// 연표는 개발사가 스토리상 중요하다고 본 이야기만 담는다. 연표에 없다고 해서
// 중요하지 않거나 작중 순서가 없다는 뜻이 아니다. 순서 단위는 타이틀(두 파트 이벤트는 파트)이다.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const GRAPH = path.join(ROOT, 'data', 'graph');

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const source = argOf('--source');
const snapshotDate = argOf('--snapshot-date');
if (!source || !snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  console.error('usage: build-world-history.mjs --source <csv dir> --snapshot-date YYYY-MM-DD');
  process.exit(1);
}

// RFC 4180 CSV 파서(따옴표 안의 쉼표·줄바꿈·"" 처리)
const parseCsv = (text) => {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
};
const readCsv = (p) => parseCsv(fs.readFileSync(p, 'utf8'));
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const dataDir = path.join(source, 'Data');
const historyFiles = ['HistoryManagerTable.csv', 'HistoryTagGroupTable.csv', 'HistoryTagSetTable.csv'];
const history = readCsv(path.join(dataDir, 'HistoryManagerTable.csv'));
const tagGroups = readCsv(path.join(dataDir, 'HistoryTagGroupTable.csv'));
const tagSets = readCsv(path.join(dataDir, 'HistoryTagSetTable.csv'));
const albumInfo = readCsv(path.join(dataDir, 'AlbumInfoTable.csv'));
const albumResource = readCsv(path.join(dataDir, 'AlbumResourceTable.csv'));
const localeSystem = new Map(readCsv(path.join(source, 'Locale', 'Locale_System.csv')).map((r) => [r.Key, r.ko]));

const manifest = JSON.parse(fs.readFileSync(path.join(GRAPH, 'manifest.json'), 'utf8'));
const titles = new Map(manifest.titles.map((t) => [t.title_id, t]));

const HISTORY_TYPE = { 0: 'main_story', 1: 'event_story', 2: 'side_or_sub_quest' };

// 이름 정규화: 대문자, 영숫자·한글만
const norm = (s) => s.toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
// 연표 이름과 아카이브 타이틀 이름이 글자로 맞지 않는 경우
const NAME_ALIASES = { [norm('L.T.K -LICENSE TO KILL-')]: 'event_stories__license_to_kill' };

// 게임 앨범 대본 수와 아카이브 장면 수가 달라 손으로 정한 파트 경계(파트 순서대로 장면 수).
// LAST KINGDOM: 아카이브에 전투 장면 6개(07·08 중 하나, 11, 20, 25, 35, 40)가 더 있다.
// 부제 구조와 경계 앞뒤 장면의 줄 수(게임 45·124행, 아카이브 51·130줄)로 21|22 경계를 확인했다(2026-11-01).
const MANUAL_SPLITS = { 'event_stories__last_kingdom': [22, 23] };

const titleByNorm = new Map();
for (const t of manifest.titles) {
  if (t.category !== 'event_stories' && t.category !== 'side_stories') continue;
  titleByNorm.set(`${t.category}:${norm(t.title)}`, t.title_id);
}

const tagName = new Map(tagSets.map((r) => [r.id, localeSystem.get(r.tag_localkey) ?? r.tag_localkey]));
const tagsOf = new Map();
for (const r of tagGroups) {
  if (!tagsOf.has(r.group_id)) tagsOf.set(r.group_id, []);
  tagsOf.get(r.group_id).push(tagName.get(r.tag_id) ?? r.tag_id);
}

// 앨범(연표 항목의 album_id) → 게임 안 대본 목록
const albumScenarios = (albumId) => {
  const info = albumInfo.find((r) => r.id === albumId);
  if (!info) return null;
  return albumResource.filter((r) => r.sub_category_id === info.sub_category_id).map((r) => r.scenario_group_id);
};

const usedLocale = {};
const albumExtract = {};
const entries = [];
for (const h of history) {
  const key = h.story_name_localkey.split(':').slice(1).join(':');
  const type = HISTORY_TYPE[h.history_type] ?? `unknown_${h.history_type}`;
  let name = key;
  if (h.set_locale_table === 'Locale_System') {
    name = localeSystem.get(key) ?? key;
    usedLocale[key] = name;
  }
  const scenarios = albumScenarios(h.album_id);
  albumExtract[h.album_id] = scenarios;
  const partMatch = /\bPART\s*(\d)/i.exec(name);
  entries.push({
    raw: h,
    type,
    name,
    baseName: name.replace(/\s*:?\s*PART\s*\d\s*$/i, '').trim(),
    part: h.story_group_id !== '0' ? Number(h.story_group_order) : null,
    partInName: partMatch ? Number(partMatch[1]) : null,
    scenarioCount: scenarios ? scenarios.length : null,
    tags: tagsOf.get(h.scenario_tag_group_id) ?? [],
  });
}

const review = [];
const rows = [];
const resolveTitle = (e) => {
  if (e.type === 'main_story') {
    const m = /^chapter_name_(\d+)$/.exec(e.name);
    return m ? `main_story__chapter_${m[1]}` : null;
  }
  if (/^subquest_\d+$/.test(e.name)) return 'sub_quests__랩칠리언';
  const n = norm(e.baseName);
  if (NAME_ALIASES[n]) return NAME_ALIASES[n];
  const cat = e.type === 'event_story' ? 'event_stories' : 'side_stories';
  return titleByNorm.get(`${cat}:${n}`) ?? null;
};

// 같은 타이틀의 연표 항목들(두 파트 이벤트·랩칠리언 서브 퀘스트)
const byTitle = new Map();
for (const e of entries) {
  e.titleId = resolveTitle(e);
  if (!e.titleId) continue;
  if (!byTitle.has(e.titleId)) byTitle.set(e.titleId, []);
  byTitle.get(e.titleId).push(e);
}

for (const e of entries) {
  const h = e.raw;
  const t = e.titleId ? titles.get(e.titleId) : null;
  let sceneStart = '';
  let sceneEnd = '';
  let status;
  const notes = [];

  if (!e.titleId || !t) {
    status = 'missing_in_archive';
    notes.push(e.titleId ? `${e.titleId} 타이틀이 매니페스트에 없음` : '이름이 맞는 아카이브 타이틀 없음');
  } else {
    const group = byTitle.get(e.titleId);
    if (group.length === 1) {
      sceneStart = t.scene_ids[0];
      sceneEnd = t.scene_ids.at(-1);
      status = 'title';
      if (e.scenarioCount != null && e.scenarioCount !== t.scene_count) {
        notes.push(`게임 앨범 대본 ${e.scenarioCount}개, 아카이브 장면 ${t.scene_count}개`);
      }
    } else {
      // 여러 항목이 한 타이틀을 나눠 가짐: 게임 앨범 대본 수로 앞에서부터 자른다.
      const ordered = [...group].sort((a, b) =>
        e.titleId === 'sub_quests__랩칠리언'
          ? Number(a.name.split('_')[1]) - Number(b.name.split('_')[1])
          : (a.part ?? 0) - (b.part ?? 0));
      const albumCounts = ordered.map((g) => g.scenarioCount);
      const total = albumCounts.reduce((s, c) => s + (c ?? NaN), 0);
      let counts = null;
      if (MANUAL_SPLITS[e.titleId]) {
        counts = MANUAL_SPLITS[e.titleId];
        status = 'manual_split';
        notes.push(`손으로 정한 경계(장면 ${counts.join('+')}). 게임 앨범 대본 ${albumCounts.join('+')}개`);
      } else if (total === t.scene_count) {
        counts = albumCounts;
        status = 'split_by_album_count';
        notes.push(`게임 앨범 대본 수(${counts.join('+')})로 앞에서부터 나눔`);
      } else if (ordered.length === t.scene_count) {
        // 랩칠리언: 게임 퀘스트 하나(대본 3~4개)가 아카이브 장면 하나로 합쳐져 있다.
        counts = ordered.map(() => 1);
        status = 'one_scene_per_entry';
        notes.push(`연표 항목 ${ordered.length}개와 아카이브 장면 ${t.scene_count}개를 순서대로 1:1 대응`);
      }
      if (counts && counts.reduce((s, c) => s + c, 0) === t.scene_count) {
        let offset = 0;
        for (const [k, g] of ordered.entries()) {
          if (g === e) {
            sceneStart = t.scene_ids[offset];
            sceneEnd = t.scene_ids[offset + counts[k] - 1];
          }
          offset += counts[k];
        }
      } else {
        status = 'needs_review';
        notes.push(`파트별 게임 앨범 대본 ${counts.join('+')}=${total}개, 아카이브 장면 ${t.scene_count}개. 파트 경계를 정하지 못함`);
      }
    }
  }
  if (e.part != null && e.partInName != null && e.part !== e.partInName) {
    notes.push(`story_group_order(${e.part})와 이름의 PART 번호(${e.partInName})가 다름`);
  }
  // 장면 순서 검산: 게임 대본 수와 장면 수가 같은 이벤트 항목은 아카이브 부제 ": A"/": B"가
  // 게임 대본 "_s"/"_e"와 짝이 맞아야 한다.
  if (sceneStart && e.type === 'event_story' && status !== 'manual_split') {
    const sc = albumExtract[h.album_id] ?? [];
    const i0 = t.scene_ids.indexOf(sceneStart);
    const ids = t.scene_ids.slice(i0, t.scene_ids.indexOf(sceneEnd) + 1);
    if (sc.length === ids.length) {
      const bad = ids.filter((sid, k) => {
        const sub = (manifest.scenes[sid]?.sub_title ?? '').trim();
        return (/:\s*A$/.test(sub) && !sc[k].endsWith('_s')) || (/:\s*B$/.test(sub) && !sc[k].endsWith('_e'));
      });
      if (bad.length) {
        status = 'needs_review';
        notes.push(`부제 A/B와 게임 대본 _s/_e 짝이 안 맞는 장면: ${bad.join(', ')}`);
      }
    }
  }
  if (!['title', 'split_by_album_count', 'one_scene_per_entry'].includes(status)) review.push({ history_id: h.id, name: e.name, status, notes });
  else if (notes.some((n) => n.startsWith('게임 앨범 대본') && status === 'title')) review.push({ history_id: h.id, name: e.name, status: 'count_mismatch', notes });

  rows.push({
    history_order: Number(h.history_order),
    update_order: Number(h.update_order),
    history_id: h.id,
    history_type: e.type,
    official_name: e.name,
    part: e.part ?? '',
    title_id: t ? e.titleId : '',
    scene_start: sceneStart,
    scene_end: sceneEnd,
    tags: e.tags.join('|'),
    visible_date: h.visible_date,
    mapping_status: status,
    note: notes.join(' / '),
  });
}

rows.sort((a, b) => a.history_order - b.history_order);
const orders = rows.map((r) => r.history_order);
if (new Set(orders).size !== orders.length) review.push({ status: 'duplicate_history_order', notes: ['history_order 중복 있음'] });

// 스냅숏: 원본 연표 테이블 사본 + 이 스크립트가 쓴 이름·앨범 발췌
const snapDir = path.join(GRAPH, 'world_history', snapshotDate);
fs.mkdirSync(snapDir, { recursive: true });
for (const f of historyFiles) fs.copyFileSync(path.join(dataDir, f), path.join(snapDir, f));
for (const r of tagSets) usedLocale[r.tag_localkey] = tagName.get(r.id);
fs.writeFileSync(path.join(snapDir, 'locale_system_used.json'), JSON.stringify(usedLocale, null, 2) + '\n');
fs.writeFileSync(path.join(snapDir, 'album_scenarios_used.json'), JSON.stringify(albumExtract, null, 2) + '\n');

for (const r of rows) r.source_snapshot = snapshotDate;
const columns = Object.keys(rows[0]);
const csv = [columns.join(','),...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(GRAPH, 'world_history_order.csv'), csv);
fs.writeFileSync(path.join(GRAPH, 'world_history_review.json'), JSON.stringify({ source_snapshot: snapshotDate, items: review }, null, 2) + '\n');

const statusCount = rows.reduce((m, r) => ((m[r.mapping_status] = (m[r.mapping_status] ?? 0) + 1), m), {});
console.log(`entries ${rows.length}`, statusCount);
console.log(`review items ${review.length}`);
for (const r of review) console.log(' -', r.history_id ?? '', r.name ?? '', r.status, '|', r.notes.join(' / '));
