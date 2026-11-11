import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, normalizeWhitespaceOnly, writeJsonAtomic } from './lib.mjs';
import { planWaves, sampleAuditCases, selectWave, splitBundle, unitElementKey } from './pass2-b-plan.mjs';
import {
  CONFIDENCE_ENUM,
  ENTITY_TYPE_ENUM,
  PASS2_BUNDLE_SCHEMA_VERSION,
  PASS2_SCHEMA_VERSION,
  SceneStore,
  checkQuote,
  compareRelease,
  excerpt,
  isNonEmptyString,
  isOutsideRepo,
  isPositiveInt,
  loadByTitle,
  loadPass2Entities,
  loadRegistry,
  loadReleaseDates,
  makeTermMatcher,
  readJsonIfExists,
  relPath,
  scanTerms,
} from './pass2-lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// Pass 2 B. 정체 후보(명세 5절 Pass 2 B, 초안 5절 B-0·B-1, 6절, 7절).
//   node scripts/graph/pass2-b.mjs build [--pilot | --titles=a,b | --all] [--max-units=20] [--wave-size=20] [--run=pilot|probe|probe-retest|main]
//   node scripts/graph/pass2-b.mjs status [--wave=N] [--run=...]
//   node scripts/graph/pass2-b.mjs validate <bundle_id> [--run=...]
//   node scripts/graph/pass2-b.mjs show <scene_id> [시작줄 끝줄]      (원문 보기)
//   node scripts/graph/pass2-b.mjs grep <낱말> --bundle=<bundle_id> [--limit=30] [--offset=0]   (등록 원문 전체 검색, search_log.jsonl에 기록)
//   node scripts/graph/pass2-b.mjs entity <이름>                      (레지스트리 찾기)
//   node scripts/graph/pass2-b.mjs finish [--run=...]
//   node scripts/graph/pass2-b.mjs review-check [--run=...]
//   node scripts/graph/pass2-b.mjs audit-input --wave=N [--rate=0.1] [--judge-family=gemini] [--run=...]
//   node scripts/graph/pass2-b.mjs audit-check --wave=N [--run=...]
//   node scripts/graph/pass2-b.mjs answers-template --out=<저장소 밖 경로> [--run=...]
//   node scripts/graph/pass2-b.mjs score --answers=<저장소 밖 경로> [--run=...]
// build(B-0)는 기계 작업이다. 판정(군중인지, 누구인지)은 하지 않는다. 군중 표시는 힌트다.

// B 파일럿 이야기(사용자 지정 2026-11-07: 메인·주년·사이드 스토리 위주, reborn_evil·persona_on_frontline·memories_teller 제외).
// 이 분류에서 미해결 판정 단위가 있는 이야기 전부와, 작성자 단위를 시험할 유실물 하나(수정 지역 이야기와 이어짐)다.
export const PILOT_TITLES = [
  'main_story__chapter_04',
  'main_story__chapter_28',
  'main_story__chapter_29',
  'main_story__chapter_30',
  'event_stories__unbreakable_sphere',
  'side_stories__mudfish',
  'side_stories__gingerbread_house',
  'lost_relics__수정지역깊은곳어딘가',
];

export const B_LINK_TYPES = new Set(['identity', 'crowd']);
export const B_VERDICTS = new Set(['정체 후보 있음', '군중·엑스트라', '판단 보류']);

// 역방향 스캔 검색어 기준(초안 5절 C-0 1단계, 파일럿에서 고친다)
export const SCAN_COMMON_MAX_SCENES = 60; // 이보다 많은 장면에 나오는 낱말은 흔한 낱말로 뺀다
// 이름 검색어(같은 이야기에서 밝혀진 이름, 묘사형 라벨)는 흔해도 같은 이야기 안의 대사 줄은 남긴다
const NAME_SOURCES = new Set(['resolved_name', 'descriptor_label']);
export const SCAN_MAX_HITS_PER_TERM = 40;
export const CONTEXT_RADIUS = 8;
const ADDRESS_STOPWORDS = new Set([
  '너', '넌', '너흰', '너희', '너희들', '너도', '당신', '당신들', '그쪽', '야', '자네', '거기', '이봐', '저기', '얘', '얘들아',
  '님', '씨', '선생', '여러분', '그대', '이 녀석', '녀석', '놈', '이놈', '저놈', '너희는', '너네',
]);
const QUOTED_TERM_RE = /['‘"“「『]([^'’"”」』\n]{2,20})['’"”」』]/g;
const CODE_TERM_RE = /\b(?:[A-Z]{2,}[0-9-]*|[A-Z]-?\d+|#[0-9A-Fa-f]{3,})\b|\d+호/g;

// 작성자 가르기(초안 5절 B-0). 지칭 목록은 파일럿에서 고친다.
const MASKED_AUTHOR_SUFFIX_RE = /(작성자|기록자|녹음자|화자|발신자|목소리|저자)$/;
const AUTHOR_MODIFIERS = new Set(['어느', '어떤', '익명의', '익명', '미상의', '신임', '정체불명의']);
const EXTRA_GENERIC_WORDS = new Set(['남자', '여자', '여자친구', '남자친구', '장교', '병사', '군인', '소년', '소녀']);

const RUNS = new Set(['pilot', 'probe', 'probe-retest', 'main']);
const runRoot = (run) => (run === 'main' ? path.join(GRAPH_DATA_DIR, 'pass2') : path.join(GRAPH_DATA_DIR, 'pass2', run));
const RULES_PATH = path.resolve(GRAPH_DATA_DIR, '..', '..', 'docs', 'graphrag', 'GRAPH_RAG_PASS2_B_RULES.md');
const pathsOf = (run) => {
  const root = runRoot(run);
  return {
    root,
    bundles: path.join(root, 'bundles'),
    plan: path.join(root, 'bundles', 'plan.json'),
    shards: path.join(root, 'shards'),
    stamps: path.join(root, 'stamps'),
    merged: path.join(root, 'merged', 'B_candidates.json'),
    progress: path.join(root, 'progress.json'),
    log: path.join(root, 'validation_log.jsonl'),
    reviewInput: path.join(root, 'review', 'review_input.json'),
    reviewOutput: path.join(root, 'review', 'review_output.json'),
  };
};

export const bundleIdOf = (titleId) => `B1__${titleId}`;
const pad = (n, w = 3) => String(n).padStart(w, '0');
const lineTag = (n) => `L${String(n).padStart(4, '0')}`;

// ---------------------------------------------------------------------------
// B-0: 판정 단위

export const classifyAuthor = (name, scene, genericLabels) => {
  if (!isNonEmptyString(name) || name.trim() === '???') return { route: 'B', reason: '이름 없음' };
  const n = name.trim();
  if (MASKED_AUTHOR_SUFFIX_RE.test(n)) return { route: 'B', reason: '정체를 가린 지칭(…작성자 등)' };
  const tokens = n.split(/\s+/);
  const isGeneric = (t) => genericLabels.has(t) || EXTRA_GENERIC_WORDS.has(t);
  if (isGeneric(n) || (isGeneric(tokens.at(-1)) && tokens.slice(0, -1).every((t) => AUTHOR_MODIFIERS.has(t) || isGeneric(t)))) {
    return { route: 'B', reason: '일반 역할 낱말' };
  }
  const asCandidate = (scene.unregistered_entity_candidates ?? []).some(
    (c) => c.surface_text === n && (c.suggested_type === 'character' || c.suggested_type === 'alias')
  );
  if (asCandidate) return { route: 'A2', reason: '미등록 인물 후보(unregistered_entity_candidates)와 같은 이름' };
  return { route: 'B', reason: '기계로 가르지 못함', flag: 'unclear_author' };
};

const lineText = (store, sceneId, line) => store.lines(sceneId)?.[line] ?? '';

const contextRanges = (store, entries) => {
  const byScene = new Map();
  for (const { scene_id, line } of entries) {
    if (!byScene.has(scene_id)) byScene.set(scene_id, []);
    byScene.get(scene_id).push(line);
  }
  const out = [];
  for (const [sid, lines] of byScene) {
    const total = (store.lines(sid)?.length ?? 1) - 1;
    out.push({
      scene_id: sid,
      line_start: Math.max(1, Math.min(...lines) - CONTEXT_RADIUS),
      line_end: Math.min(total, Math.max(...lines) + CONTEXT_RADIUS),
    });
  }
  return out;
};

const quotedTerms = (texts) => {
  const out = new Set();
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(QUOTED_TERM_RE)) out.add(m[1].trim());
  }
  return out;
};

const termMap = (pairs) => {
  const m = new Map();
  for (const [source, terms] of pairs) {
    for (const t of terms) {
      const term = String(t ?? '').trim();
      if (term.length < 2 || term === '???') continue;
      if (!m.has(term)) m.set(term, new Set());
      m.get(term).add(source);
    }
  }
  return m;
};

/** 판정 대상 줄에 나온 언급·미등록 후보 이름, 또는 Pass 1 단서 글에 나온 그 이름 */
const sceneMentions = (scene, unitLines, clueTexts) => {
  const joined = clueTexts.filter(Boolean).join('\n');
  const out = new Set();
  const items = [
    ...(scene.participants?.mentioned_only ?? []).map((m) => ({ text: m.surface_text, ls: m.line_start, le: m.line_end })),
    ...(scene.unregistered_entity_candidates ?? []).map((c) => ({ text: c.surface_text, ls: c.line_start, le: c.line_start })),
  ];
  for (const it of items) {
    if (!isNonEmptyString(it.text)) continue;
    let onLine = false;
    for (let n = it.ls; n <= (it.le ?? it.ls); n++) if (unitLines.has(n)) onLine = true;
    if (onLine || (it.text.trim().length >= 2 && joined.includes(it.text.trim()))) out.add(it.text.trim());
  }
  return out;
};

const codeTerms = (texts) => {
  const out = new Set();
  for (const t of texts) for (const m of String(t ?? '').matchAll(CODE_TERM_RE)) out.add(m[0]);
  return out;
};

/** 이야기 하나의 판정 단위. 반환: { units, a2Authors, resolvedNames } */
export const buildUnitsForTitle = (titleDoc, store, { genericLabels, registry }) => {
  const units = [];
  const a2Authors = [];
  const authorGroups = new Map(); // name → unit
  const resolvedNames = new Set();
  let seq = 0;
  const nextId = () => `U${pad(++seq, 2)}`;

  for (const scene of titleDoc.scenes) {
    const sid = scene.scene_id;
    for (const r of [...(scene.unknown_speakers ?? []), ...(scene.descriptor_speakers ?? [])]) {
      const res = r.resolved_in_same_scene_to;
      if (!res) continue;
      if (isNonEmptyString(res.surface_text)) resolvedNames.add(res.surface_text.trim());
      const ent = res.entity_id && registry.get(res.entity_id);
      for (const label of ent?.surface_labels ?? []) resolvedNames.add(label);
    }

    const unres = (scene.unknown_speakers ?? []).filter((u) => !u.resolved_in_same_scene_to);
    const unresById = new Map(unres.map((u) => [u.unknown_id, u]));
    const grouped = new Set();
    const unknownUnits = [];
    for (const g of scene.same_scene_speaker_groups ?? []) {
      const ids = g.unknown_ids.filter((id) => unresById.has(id));
      if (!ids.length) continue;
      ids.forEach((id) => grouped.add(id));
      unknownUnits.push({
        members: ids.map((id) => unresById.get(id)),
        group: {
          confidence: g.confidence,
          reason: g.reason,
          resolved_members: g.unknown_ids.filter((id) => !unresById.has(id)),
        },
      });
    }
    const loose = unres.filter((u) => !grouped.has(u.unknown_id));
    for (const u of loose) unknownUnits.push({ members: [u], group: null });

    const unitsInScene = unknownUnits.length;
    for (const { members, group } of unknownUnits) {
      const lines = members.map((u) => ({
        scene_id: sid,
        line: u.line,
        unknown_id: u.unknown_id,
        text: lineText(store, sid, u.line),
      }));
      const unitLines = new Set(members.map((u) => u.line));
      const addressTerms = (scene.forms_of_address ?? [])
        .filter(
          (f) =>
            (f.from_speaker === '???' && unitLines.has(f.line_start)) ||
            (f.to_target === '???' && unitsInScene === 1)
        )
        .map((f) => f.address_term?.trim())
        .filter((t) => isNonEmptyString(t) && !ADDRESS_STOPWORDS.has(t));
      const shortLoose = loose.filter((u) => normalizeWhitespaceOnly(u.quote).length <= 20).length;
      const crowd =
        !group && loose.length >= 3 && normalizeWhitespaceOnly(members[0].quote).length <= 20
          ? { flag: true, reason: `이 장면에 묶이지 않은 미해결 ??? ${loose.length}줄(짧은 줄 ${shortLoose})` }
          : { flag: false, reason: null };
      units.push({
        unit_id: nextId(),
        unit_type: group && members.length > 1 ? 'unknown_group' : 'unknown_line',
        scene_ids: [sid],
        subject_refs: members.map((u) => ({ ref: 'item', item_id: u.item_id, unknown_id: u.unknown_id })),
        lines,
        pass1: {
          unknowns: members.map((u) => ({
            unknown_id: u.unknown_id,
            quote: u.quote,
            speaking_style: u.speaking_style,
            target_addressed: u.target_addressed,
            contextual_clues: u.contextual_clues,
          })),
          group,
        },
        context: contextRanges(store, lines),
        crowd_hint: crowd,
        _terms: termMap([
          ['address', addressTerms],
          ['quoted', quotedTerms(members.flatMap((u) => [...(u.contextual_clues ?? []), u.speaking_style]))],
          ['code', codeTerms(lines.map((l) => l.text))],
          ['scene_mention', sceneMentions(scene, unitLines, [...members.flatMap((u) => u.contextual_clues ?? []), group?.reason])],
        ]),
      });
    }

    for (const d of scene.descriptor_speakers ?? []) {
      if (d.resolved_in_same_scene_to) continue;
      const ls = store.meta(sid)?.mgt?.line_speaker ?? {};
      const spoken = Object.entries(ls)
        .filter(([, label]) => label === d.speaker_label)
        .map(([n]) => Number(n))
        .sort((a, b) => a - b);
      const lines = spoken.map((n) => ({ scene_id: sid, line: n, text: lineText(store, sid, n) }));
      units.push({
        unit_id: nextId(),
        unit_type: 'descriptor',
        scene_ids: [sid],
        subject_refs: [{ ref: 'item', item_id: d.item_id }],
        lines,
        pass1: {
          descriptor: {
            speaker_label: d.speaker_label,
            line_start: d.line_start,
            line_end: d.line_end,
            quote: d.quote,
            speaking_style: d.speaking_style,
            target_addressed: d.target_addressed,
            contextual_clues: d.contextual_clues,
          },
        },
        context: contextRanges(store, lines.length ? lines : [{ scene_id: sid, line: d.line_start }]),
        crowd_hint: { flag: false, reason: null },
        _terms: termMap([
          ['descriptor_label', [d.speaker_label]],
          ['quoted', quotedTerms([...(d.contextual_clues ?? []), d.speaking_style])],
          ['scene_mention', sceneMentions(scene, new Set(spoken), d.contextual_clues ?? [])],
        ]),
      });
    }

    const author = scene.participants?.document_author;
    if (author) {
      if (!author.entity_id) {
        const cls = classifyAuthor(author.name, scene, genericLabels);
        if (cls.route === 'A2') {
          a2Authors.push({ scene_id: sid, item_id: author.item_id, name: author.name, reason: cls.reason });
        } else {
          const key = author.name ?? '(이름 없음)';
          let u = authorGroups.get(key);
          if (!u) {
            u = {
              unit_id: nextId(),
              unit_type: 'author',
              scene_ids: [],
              subject_refs: [],
              lines: [],
              pass1: { author: { title_id: titleDoc.title_id, name: author.name, route_reason: cls.reason, flag: cls.flag ?? null } },
              context: [],
              crowd_hint: { flag: false, reason: null },
              _terms: new Map(),
            };
            authorGroups.set(key, u);
            units.push(u);
          }
          u.scene_ids.push(sid);
          u.subject_refs.push({ ref: 'item', item_id: author.item_id });
          const total = (store.lines(sid)?.length ?? 1) - 1;
          u.context.push({ scene_id: sid, line_start: 1, line_end: total });
          for (const [t, src] of termMap([['clue_keyword', (scene.clues_and_hooks ?? []).map((c) => c.keyword)]])) {
            if (!u._terms.has(t)) u._terms.set(t, new Set());
            src.forEach((x) => u._terms.get(t).add(x));
          }
        }
      }
      (author.voices ?? []).forEach((v, i) => {
        units.push({
          unit_id: nextId(),
          unit_type: 'voice',
          scene_ids: [sid],
          subject_refs: [{ ref: 'item', item_id: author.item_id, voice_index: i }],
          lines: [],
          pass1: { voice: { voice_index: i, voice_text: v, author_name: author.name, author_entity_id: author.entity_id } },
          context: [{ scene_id: sid, line_start: 1, line_end: (store.lines(sid)?.length ?? 1) - 1 }],
          crowd_hint: { flag: false, reason: null },
          _terms: termMap([['quoted', quotedTerms([v])]]),
        });
      });
    }
  }

  for (const u of units) {
    if (u.unit_type === 'unknown_group' || u.unit_type === 'unknown_line' || u.unit_type === 'descriptor') {
      for (const [t] of termMap([['resolved_name', resolvedNames]])) {
        if (!u._terms.has(t)) u._terms.set(t, new Set());
        u._terms.get(t).add('resolved_name');
      }
    }
  }
  return { units, a2Authors, resolvedNames: [...resolvedNames] };
};

const storySummary = (titleDoc) =>
  titleDoc.scenes.map((s) => {
    const p = s.participants ?? {};
    const resolved = [];
    for (const u of s.unknown_speakers ?? []) {
      const r = u.resolved_in_same_scene_to;
      if (r) resolved.push({ kind: '???', unknown_id: u.unknown_id, surface_text: r.surface_text, entity_id: r.entity_id, line_start: r.line_start, line_end: r.line_end, quote: r.quote });
    }
    for (const d of s.descriptor_speakers ?? []) {
      const r = d.resolved_in_same_scene_to;
      if (r) resolved.push({ kind: 'descriptor', speaker_label: d.speaker_label, surface_text: r.surface_text, entity_id: r.entity_id, line_start: r.line_start, line_end: r.line_end, quote: r.quote });
    }
    return {
      scene_id: s.scene_id,
      chronology_type: s.chronology_type,
      summary: s.summary,
      speakers: [...(p.present_in_scene ?? []), ...(p.remote_or_voice_only ?? [])].map((x) => ({ label: x.speaker_label, entity_id: x.entity_id })),
      present_silent: (p.present_silent ?? []).map((x) => ({ name: x.name, entity_id: x.entity_id })),
      document_author: p.document_author ? { name: p.document_author.name, entity_id: p.document_author.entity_id } : null,
      resolved_identities: resolved,
      cross_scene_hints: s.cross_scene_hints ?? [],
    };
  });

const scriptFileText = (titleDoc, store) => {
  const parts = [];
  for (const s of titleDoc.scenes) {
    const meta = store.meta(s.scene_id);
    parts.push(`@@@ ${s.scene_id} | ${meta?.sub_title ?? ''}`);
    parts.push(store.numberedScript(s.scene_id) ?? '');
    parts.push('');
  }
  return parts.join('\n');
};

export const buildBundles = async ({ titleIds, run, skipEmpty = false, maxUnits = 20, waveSize = 20 }) => {
  if (!isPositiveInt(maxUnits) || !isPositiveInt(waveSize)) throw new Error('max-units・wave-size는 1 이상의 정수다');
  const P = pathsOf(run);
  const byTitle = loadByTitle();
  const store = new SceneStore();
  const registry = loadRegistry();
  const genericLabels = new Set(JSON.parse(fs.readFileSync(path.join(GRAPH_DATA_DIR, 'generic_roles.json'), 'utf8')).role_labels);

  const built = [];
  const allTerms = new Set();
  for (const tid of titleIds) {
    const doc = byTitle.get(tid);
    if (!doc) throw new Error(`by_title에 없는 이야기: ${tid}`);
    const { units, a2Authors } = buildUnitsForTitle(doc, store, { genericLabels, registry });
    if (skipEmpty && units.length === 0) continue;
    for (const u of units) for (const t of u._terms.keys()) allTerms.add(t);
    built.push({ doc, units, a2Authors });
  }

  const scan = scanTerms(store, [...allTerms]);
  await fsp.mkdir(P.bundles, { recursive: true });
  const planBundles = [];
  for (const { doc, units, a2Authors } of built) {
    const bundleId = bundleIdOf(doc.title_id);
    const hits = new Map(); // scene:line → hit (다른 이야기만)
    const terms = [];
    const dropped = [];
    const unitTermsIndex = new Map();
    for (const u of units) for (const [t, src] of u._terms) {
      if (!unitTermsIndex.has(t)) unitTermsIndex.set(t, { units: [], sources: new Set() });
      unitTermsIndex.get(t).units.push(u);
      src.forEach((x) => unitTermsIndex.get(t).sources.add(x));
    }
    // 묶음의 판정 대상 줄은 결과에서 뺀다
    const ownLines = new Set(units.flatMap((u) => u.lines.map((l) => `${l.scene_id}:${l.line}`)));
    for (const [term, { units: us, sources }] of [...unitTermsIndex].sort(([a], [b]) => a.localeCompare(b))) {
      const r = scan.get(term);
      const common = r.scene_count > SCAN_COMMON_MAX_SCENES;
      const isName = [...sources].some((x) => NAME_SOURCES.has(x));
      if (common && !isName) {
        dropped.push({ term, sources: [...sources].sort(), scene_count: r.scene_count, reason: `흔한 낱말(장면 ${r.scene_count}개 > ${SCAN_COMMON_MAX_SCENES})` });
        continue;
      }
      // 더 긴 검색어 안에만 든 결과는 뺀다(레비 ⊂ 레비아탄)
      const longer = [...unitTermsIndex.keys()].filter((t) => t !== term && t.includes(term));
      const onlyInsideLonger = (h) => {
        if (!longer.length) return false;
        let text = store.lines(h.scene_id)[h.line];
        for (const t of longer) text = text.split(t).join(' ');
        return !makeTermMatcher(term)(text);
      };
      const cand = r.hits.filter((h) => !ownLines.has(`${h.scene_id}:${h.line}`) && !onlyInsideLonger(h));
      // 같은 이야기 결과는 대본 파일에 있으므로 줄 번호만 적는다
      const sameTitle = new Map();
      for (const h of cand) {
        if (store.meta(h.scene_id).title_id !== doc.title_id || !h.in_utterance) continue;
        if (!sameTitle.has(h.scene_id)) sameTitle.set(h.scene_id, []);
        sameTitle.get(h.scene_id).push(h.line);
      }
      const other = cand.filter((h) => store.meta(h.scene_id).title_id !== doc.title_id);
      const kept = common ? [] : other.slice(0, SCAN_MAX_HITS_PER_TERM);
      const entry = {
        term,
        sources: [...sources].sort(),
        unit_ids: us.map((u) => u.unit_id),
        scene_count: r.scene_count,
        same_title_lines: [...sameTitle].map(([scene_id, lines]) => ({ scene_id, lines })),
        other_title_lines: other.length,
        kept: kept.length,
        omitted: other.length - kept.length,
      };
      if (common) {
        entry.common = true;
        dropped.push({ term, sources: [...sources].sort(), scene_count: r.scene_count, reason: `흔한 이름(장면 ${r.scene_count}개 > ${SCAN_COMMON_MAX_SCENES}): 같은 이야기 대사 줄만 남기고 다른 이야기 결과를 뺌` });
      }
      terms.push(entry);
      for (const h of kept) {
        const key = `${h.scene_id}:${h.line}`;
        if (!hits.has(key)) hits.set(key, { scene_id: h.scene_id, line: h.line, terms: new Set(), unit_ids: new Set() });
        const rec = hits.get(key);
        rec.terms.add(term);
        us.forEach((u) => rec.unit_ids.add(u.unit_id));
      }
    }
    const scanHits = [...hits.values()]
      .sort((a, b) => store.sceneOrder.get(a.scene_id) - store.sceneOrder.get(b.scene_id) || a.line - b.line)
      .map((h, i) => {
        const meta = store.meta(h.scene_id);
        const ex = excerpt(store.lines(h.scene_id), h.line);
        return {
          scan_id: `${bundleId}__S${pad(i + 1, 4)}`,
          scene_id: h.scene_id,
          title_id: meta.title_id,
          line: h.line,
          speaker: meta.mgt?.line_speaker?.[String(h.line)] ?? null,
          terms: [...h.terms],
          unit_ids: [...h.unit_ids],
          excerpt: ex,
        };
      });

    const bundle = {
      schema_version: PASS2_BUNDLE_SCHEMA_VERSION,
      bundle_id: bundleId,
      kind: 'B',
      title_id: doc.title_id,
      title: doc.title,
      category: doc.category,
      generated_at: new Date().toISOString(),
      script_file: relPath(path.join(P.bundles, `${bundleId}.script.txt`)),
      units: units.map(({ _terms, ...u }) => ({ ...u, scan_terms: [..._terms.keys()].filter((t) => terms.some((x) => x.term === t)).sort() })),
      story: storySummary(doc),
      scan: { terms, dropped_terms: dropped, hits: scanHits },
      routed_to_a2: a2Authors,
    };
    await fsp.writeFile(path.join(P.bundles, `${bundleId}.script.txt`), scriptFileText(doc, store), 'utf8');
    for (const part of splitBundle(bundle, maxUnits)) {
      const partId = part.bundle_id;
      const bundlePath = path.join(P.bundles, `${partId}.json`);
      await writeJsonAtomic(bundlePath, part);
      const count = (t) => part.units.filter((u) => u.unit_type === t).length;
      planBundles.push({
        bundle_id: partId,
        ...(part.parent_bundle_id ? { parent_bundle_id: part.parent_bundle_id, part_index: part.part_index, part_count: part.part_count } : {}),
        title_id: doc.title_id,
        title: doc.title,
        units: part.units.length,
        unit_types: {
          unknown_group: count('unknown_group'),
          unknown_line: count('unknown_line'),
          descriptor: count('descriptor'),
          author: count('author'),
          voice: count('voice'),
        },
        crowd_hints: part.units.filter((u) => u.crowd_hint.flag).length,
        scan_hits: part.scan.hits.length,
        routed_to_a2: part.part_index > 1 ? 0 : a2Authors.length,
        input: relPath(bundlePath),
        script: bundle.script_file,
        output: relPath(path.join(P.shards, `${partId}.json`)),
        validate: `node scripts/graph/pass2-b.mjs validate ${partId}${run === 'pilot' ? '' : ` --run=${run}`}`,
      });
    }
  }
  const plan = { run, generated_at: new Date().toISOString(), max_units: maxUnits, wave_size: waveSize, bundles: planWaves(planBundles, waveSize) };
  await writeJsonAtomic(P.plan, plan);
  return plan;
};

// ---------------------------------------------------------------------------
// 검증기(초안 7절, B 부분)

const LINK_KEYS = new Set([
  'link_id', 'link_type', 'subject', 'target', 'verdict', 'confidence', 'rationale',
  'supporting_evidence', 'contradicting_evidence', 'alternatives', 'search_hints',
]);
const MERGER_ONLY = new Set(['evidence_scenes', 'release_order']);
const C_ONLY = new Set(['roles']);

/** 단위를 넘어 한 연결로 합칠 수 있는 라벨(규칙 3.5). 묘사형·작성자만 값이 있다 */
const mergeLabelOf = (unit) => {
  if (unit.unit_type === 'descriptor') return `descriptor:${unit.pass1?.descriptor?.speaker_label}`;
  if (unit.unit_type === 'author') return `author:${unit.pass1?.author?.name ?? ''}`;
  return null;
};

/** 공개 줄에 나와야 할 후보의 이름과 등록 별칭 */
const targetNames = (target, ctx) => {
  const entity = ctx.registry.get(target?.entity_id) ?? ctx.pass2Entities.get(target?.entity_id);
  return [target?.name, entity?.canonical_name, ...(entity?.surface_labels ?? [])].filter(isNonEmptyString);
};

/** 지휘관의 선택지 자체에는 화자 이름이 없으므로, 실제 선택지 한 줄 전체 인용만 예외로 받는다. */
const isCommanderChoice = (ev, target, ctx) => {
  if (target?.entity_id !== 'char_지휘관' || !isNonEmptyString(ev.quote)) return false;
  const quote = normalizeWhitespaceOnly(ev.quote);
  return (ctx.store.lines(ev.scene_id) ?? []).slice(ev.line_start, ev.line_end + 1).some((line) => {
    const m = line.trim().match(/^\[OPTION TEXT="(.*)"\]$/);
    return m && (quote === normalizeWhitespaceOnly(m[0]) || quote === normalizeWhitespaceOnly(m[1]));
  });
};

/**
 * B 샤드 검증. ctx: { store(SceneStore 호환: has(), lines()), registry: Map, pass2Entities: Map }
 * 반환: { errors: [{code, path, message}], warnings: [...] }
 */
export const validateBShard = (shard, bundle, ctx) => {
  const errors = [];
  const warnings = [];
  const err = (code, p, message) => errors.push({ code, path: p, message });
  const warn = (code, p, message) => warnings.push({ code, path: p, message });

  if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
    err('SCHEMA', '$', '출력은 JSON 객체여야 한다');
    return { errors, warnings };
  }
  for (const k of Object.keys(shard)) {
    if (k === 'unlinked' || k === 'search_requests') err('FORBIDDEN_FIELD', k, `${k}는 C 묶음 전용이다. B에서는 모든 단위를 candidate_links에 적는다`);
    else if (!['schema_version', 'bundle_id', 'candidate_links'].includes(k)) err('SCHEMA', k, `알 수 없는 필드 ${k}`);
  }
  if (shard.schema_version !== PASS2_SCHEMA_VERSION) err('SCHEMA', 'schema_version', `schema_version은 "${PASS2_SCHEMA_VERSION}"이어야 한다`);
  if (shard.bundle_id !== bundle.bundle_id) err('SCHEMA', 'bundle_id', `bundle_id는 "${bundle.bundle_id}"이어야 한다`);
  if (!Array.isArray(shard.candidate_links)) {
    err('SCHEMA', 'candidate_links', 'candidate_links는 배열이어야 한다');
    return { errors, warnings };
  }

  const elements = new Map(); // key → unit_id
  for (const u of bundle.units) for (const r of u.subject_refs) elements.set(unitElementKey(r), u.unit_id);
  const unitLines = new Map(); // unit_id → Set(scene:line)
  for (const u of bundle.units) unitLines.set(u.unit_id, new Set(u.lines.map((l) => `${l.scene_id}:${l.line}`)));
  const covered = new Map();
  const linkIds = new Set();
  const idRe = new RegExp(`^${bundle.bundle_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}__\\d{3}$`);

  const checkEntityRef = (e, p, { requireName }) => {
    if (e.entity_id === null || e.entity_id === undefined) {
      if (!isNonEmptyString(e.name)) err('REFERENCE', `${p}.name`, 'entity_id가 null이면 name을 적어야 한다');
      return;
    }
    if (typeof e.entity_id !== 'string') return err('REFERENCE', `${p}.entity_id`, 'entity_id는 문자열 또는 null이다');
    const known = ctx.registry.has(e.entity_id) || ctx.pass2Entities.has(e.entity_id);
    if (!known) err('ENTITY_ID_NOT_IN_REGISTRY', `${p}.entity_id`, `${e.entity_id}는 레지스트리에 없다. 미등록 인물이면 entity_id: null과 name으로 적는다`);
    if (requireName && e.name !== null && e.name !== undefined && typeof e.name !== 'string') err('REFERENCE', `${p}.name`, 'name은 문자열 또는 null이다');
  };

  const checkEvidence = (ev, p, { allowReveal, requireReveal }) => {
    if (!ev || typeof ev !== 'object') return err('SCHEMA', p, '근거는 객체여야 한다');
    const allowed = new Set(['scene_id', 'line_start', 'line_end', 'quote', ...(allowReveal ? ['reveals_identity'] : [])]);
    for (const k of Object.keys(ev)) {
      if (k === 'reveals_identity' && !allowReveal) err('FORBIDDEN_FIELD', `${p}.reveals_identity`, 'reveals_identity는 identity 연결의 supporting_evidence에만 적는다');
      else if (!allowed.has(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    }
    if (requireReveal && typeof ev.reveals_identity !== 'boolean') err('SCHEMA', `${p}.reveals_identity`, 'identity 연결의 근거에는 reveals_identity(true/false)를 적는다');
    if (!isNonEmptyString(ev.scene_id) || !ctx.store.has(ev.scene_id)) return err('EVIDENCE_SCENE', `${p}.scene_id`, `등록 장면이 아니다: ${ev.scene_id}`);
    const why = checkQuote(ctx.store.lines(ev.scene_id), ev.line_start, ev.line_end, ev.quote);
    if (why) err('QUOTE_LOCATION', `${p}.quote`, `${ev.scene_id}: ${why}`);
  };

  shard.candidate_links.forEach((link, i) => {
    const p = `candidate_links[${i}]`;
    if (!link || typeof link !== 'object') return err('SCHEMA', p, '연결은 객체여야 한다');
    for (const k of Object.keys(link)) {
      if (MERGER_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, `${k}는 병합기가 붙인다. 쓰지 않는다`);
      else if (C_ONLY.has(k)) err('FORBIDDEN_FIELD', `${p}.${k}`, 'roles는 C(hook) 전용이다');
      else if (!LINK_KEYS.has(k)) err('SCHEMA', `${p}.${k}`, `알 수 없는 필드 ${k}`);
    }
    for (const k of LINK_KEYS) if (!(k in link)) err('SCHEMA', `${p}.${k}`, `필수 필드 ${k}가 없다`);

    if (!isNonEmptyString(link.link_id) || !idRe.test(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id는 "${bundle.bundle_id}__001" 형식이다`);
    else if (linkIds.has(link.link_id)) err('SCHEMA', `${p}.link_id`, `link_id 중복: ${link.link_id}`);
    else linkIds.add(link.link_id);

    if (!B_LINK_TYPES.has(link.link_type)) err('ENUM', `${p}.link_type`, 'B의 link_type은 identity 또는 crowd다');
    if (!B_VERDICTS.has(link.verdict)) err('ENUM', `${p}.verdict`, `verdict는 ${[...B_VERDICTS].join(' | ')} 중 하나다`);
    if (link.confidence === '확인된 사실') err('FORBIDDEN_CONFIDENCE', `${p}.confidence`, 'Pass 2에서는 확인된 사실을 쓰지 않는다(확정은 Pass 3)');
    else if (!CONFIDENCE_ENUM.has(link.confidence)) err('ENUM', `${p}.confidence`, `confidence는 ${[...CONFIDENCE_ENUM].join(' | ')} 중 하나다`);
    const isCrowd = link.link_type === 'crowd';
    if (isCrowd !== (link.verdict === '군중·엑스트라')) err('VERDICT', `${p}.verdict`, 'crowd 연결의 verdict는 군중·엑스트라이고, 군중·엑스트라는 crowd 연결에만 쓴다');
    if (link.verdict === '판단 보류' && link.confidence !== '판단 보류') err('VERDICT', `${p}.confidence`, 'verdict가 판단 보류이면 confidence도 판단 보류다');

    // subject
    if (!Array.isArray(link.subject) || link.subject.length === 0) err('SCHEMA', `${p}.subject`, 'subject는 판정 단위 참조가 하나 이상인 배열이다');
    else link.subject.forEach((r, j) => {
      const sp = `${p}.subject[${j}]`;
      if (!r || r.ref !== 'item' || !isNonEmptyString(r.item_id)) return err('REFERENCE', sp, 'subject는 {"ref": "item", "item_id": ...}이다(묶음 units의 subject_refs를 그대로 옮긴다)');
      for (const k of Object.keys(r)) if (!['ref', 'item_id', 'unknown_id', 'voice_index'].includes(k)) err('SCHEMA', `${sp}.${k}`, `알 수 없는 필드 ${k}`);
      const key = unitElementKey(r);
      const unitId = elements.get(key);
      if (!unitId) return err('SUBJECT_NOT_IN_BUNDLE', sp, `묶음의 판정 단위에 없는 참조: ${key}`);
      if (covered.has(key)) return err('SUBJECT_DUPLICATE', sp, `${key}가 ${covered.get(key)}에도 있다. 한 참조는 연결 하나에만 둔다(대안은 alternatives에)`);
      covered.set(key, link.link_id ?? p);
    });

    const linkedUnitIds = [...new Set((Array.isArray(link.subject) ? link.subject : []).map((r) => elements.get(unitElementKey(r ?? {}))).filter(Boolean))];
    if (linkedUnitIds.length > 1) {
      const labels = new Set(linkedUnitIds.map((id) => mergeLabelOf(bundle.units.find((u) => u.unit_id === id))));
      if (labels.has(null) || labels.size > 1) err('UNIT_MERGE', `${p}.subject`, `${linkedUnitIds.join(', ')}를 한 연결로 합칠 수 없다. 단위마다 연결을 따로 만든다(같은 라벨의 묘사형·작성자만 합칠 수 있다)`);
    }

    // target
    if (!Array.isArray(link.target)) err('SCHEMA', `${p}.target`, 'target은 배열이다');
    else {
      if (isCrowd && link.target.length) err('TARGET', `${p}.target`, 'crowd는 target: []이다');
      if (link.verdict === '정체 후보 있음' && link.target.length !== 1) err('TARGET', `${p}.target`, '정체 후보 있음이면 target에 가장 유력한 후보 하나를 적고, 나머지는 alternatives에 적는다');
      if (link.verdict === '판단 보류' && link.target.length > 1) err('TARGET', `${p}.target`, '판단 보류의 target은 비우거나 하나만 적는다. 나머지 후보는 alternatives에 적는다');
      link.target.forEach((t, j) => {
        const tp = `${p}.target[${j}]`;
        if (!t || t.ref !== 'entity') return err('REFERENCE', tp, 'B의 target은 {"ref": "entity", ...}이다');
        for (const k of Object.keys(t)) if (!['ref', 'entity_id', 'name', 'entity_type'].includes(k)) err('SCHEMA', `${tp}.${k}`, `알 수 없는 필드 ${k}`);
        if (!ENTITY_TYPE_ENUM.has(t.entity_type)) err('ENUM', `${tp}.entity_type`, `entity_type은 ${[...ENTITY_TYPE_ENUM].join(' | ')} 중 하나다`);
        checkEntityRef(t, tp, { requireName: true });
        if (link.verdict === '정체 후보 있음' && ['squad', 'organization'].includes(t.entity_type)) err('GROUP_TARGET', tp, '개인 정체가 집단으로만 좁혀졌으면 판단 보류로 두고 target에 그 집단을 적는다');
      });
    }

    // evidence
    const isIdentity = link.link_type === 'identity';
    if (!Array.isArray(link.supporting_evidence) || link.supporting_evidence.length === 0) {
      err('EVIDENCE', `${p}.supporting_evidence`, 'supporting_evidence는 비울 수 없다(군중·보류도 판정 근거 줄을 적는다)');
    } else {
      link.supporting_evidence.forEach((ev, j) =>
        checkEvidence(ev, `${p}.supporting_evidence[${j}]`, { allowReveal: isIdentity, requireReveal: isIdentity })
      );
      const reveals = link.supporting_evidence.filter((ev) => ev?.reveals_identity === true);
      if (reveals.length && link.verdict !== '정체 후보 있음') err('VERDICT', `${p}.supporting_evidence`, 'reveals_identity: true는 정체 후보 있음 연결에만 적는다');
      if (link.verdict === '정체 후보 있음') {
        const subjUnits = new Set((link.subject ?? []).map((r) => elements.get(unitElementKey(r ?? {}))).filter(Boolean));
        const own = new Set([...subjUnits].flatMap((u) => [...unitLines.get(u)]));
        const outside = link.supporting_evidence.some((ev) => {
          if (!ev || !isPositiveInt(ev.line_start) || !isPositiveInt(ev.line_end)) return false;
          for (let n = ev.line_start; n <= ev.line_end; n++) if (!own.has(`${ev.scene_id}:${n}`)) return true;
          return false;
        });
        if (!outside) warn('EVIDENCE_ONLY_SUBJECT_LINES', `${p}.supporting_evidence`, '근거가 판정 대상 줄뿐이다. 후보를 가리키는 다른 줄(호칭·행동·이후 장면)이 없으면 판단 보류를 검토한다');
        const names = targetNames(Array.isArray(link.target) ? link.target[0] : null, ctx);
        link.supporting_evidence.forEach((ev, j) => {
          if (ev?.reveals_identity !== true || !names.length) return;
          const text = String(ev.quote ?? '');
          if (!names.some((n) => makeTermMatcher(n)(text)) && !isCommanderChoice(ev, link.target?.[0], ctx)) warn('REVEAL_WITHOUT_NAME', `${p}.supporting_evidence[${j}]`, 'quote 자체에 후보의 이름이나 등록 별칭이 없는데 reveals_identity가 true다. 범위만 넓히지 말고 실제 공개 근거를 인용하거나 false로 고친다');
        });
      }
    }
    if (!Array.isArray(link.contradicting_evidence)) err('SCHEMA', `${p}.contradicting_evidence`, 'contradicting_evidence는 배열이다(없으면 [])');
    else link.contradicting_evidence.forEach((ev, j) => checkEvidence(ev, `${p}.contradicting_evidence[${j}]`, { allowReveal: false, requireReveal: false }));

    if (!Array.isArray(link.alternatives)) err('SCHEMA', `${p}.alternatives`, 'alternatives는 배열이다(없으면 [])');
    else {
      if (isCrowd && link.alternatives.length) err('TARGET', `${p}.alternatives`, 'crowd는 alternatives: []이다');
      link.alternatives.forEach((a, j) => {
        const ap = `${p}.alternatives[${j}]`;
        if (!a || typeof a !== 'object') return err('SCHEMA', ap, '대안은 객체다');
        for (const k of Object.keys(a)) if (!['entity_id', 'name', 'why', 'supporting_evidence'].includes(k)) err('SCHEMA', `${ap}.${k}`, `알 수 없는 필드 ${k}`);
        checkEntityRef(a, ap, { requireName: true });
        if (!isNonEmptyString(a.why)) err('SCHEMA', `${ap}.why`, '대안마다 why를 적는다');
        if (!Array.isArray(a.supporting_evidence) || a.supporting_evidence.length === 0) err('EVIDENCE', `${ap}.supporting_evidence`, '대안 후보의 원문 근거는 alternatives의 supporting_evidence에 따로 적는다');
        else a.supporting_evidence.forEach((ev, k) => checkEvidence(ev, `${ap}.supporting_evidence[${k}]`, { allowReveal: false, requireReveal: false }));
      });
    }
    if (!Array.isArray(link.search_hints) || link.search_hints.some((h) => typeof h !== 'string')) err('SCHEMA', `${p}.search_hints`, 'search_hints는 문자열 배열이다(없으면 [])');
    if (!isNonEmptyString(link.rationale)) err('SCHEMA', `${p}.rationale`, 'rationale에 판정 이유를 한두 문장으로 적는다(묶음을 나눴으면 나눈 이유도)');
  });

  for (const [key, unitId] of elements) {
    if (!covered.has(key)) err('UNIT_NOT_COVERED', unitId, `판정 단위 ${unitId}의 ${key}가 어느 연결의 subject에도 없다`);
  }
  return { errors, warnings };
};

// ---------------------------------------------------------------------------
// 병합기: evidence_scenes·release_order를 붙인다(초안 6절)

export const enrichLink = (link, bundle, { store, releaseDates }) => {
  const byKey = new Map();
  for (const u of bundle.units) for (const r of u.subject_refs) byKey.set(unitElementKey(r), u);
  const ranges = [];
  const subjectScenes = new Set();
  for (const r of link.subject) {
    const u = byKey.get(unitElementKey(r));
    if (!u) continue;
    if (r.unknown_id) {
      const l = u.lines.find((x) => x.unknown_id === r.unknown_id);
      ranges.push({ scene_id: u.scene_ids[0], line_start: l.line, line_end: l.line });
      subjectScenes.add(u.scene_ids[0]);
    } else if (u.unit_type === 'descriptor') {
      for (const l of u.lines) ranges.push({ scene_id: l.scene_id, line_start: l.line, line_end: l.line });
      subjectScenes.add(u.scene_ids[0]);
    } else {
      const sid = r.item_id.replace(/__dca_\d+$/, '');
      ranges.push({ scene_id: sid, line_start: null, line_end: null });
      subjectScenes.add(sid);
    }
  }
  for (const ev of [...link.supporting_evidence, ...link.contradicting_evidence, ...(link.alternatives ?? []).flatMap((a) => a.supporting_evidence ?? [])]) {
    ranges.push({ scene_id: ev.scene_id, line_start: ev.line_start, line_end: ev.line_end });
  }
  const seen = new Set();
  const evidenceScenes = ranges.filter((r) => {
    const k = `${r.scene_id}:${r.line_start}:${r.line_end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let releaseOrder;
  const reveals = link.link_type === 'identity' ? link.supporting_evidence.filter((ev) => ev.reveals_identity === true) : [];
  if (link.link_type !== 'identity') releaseOrder = null;
  else if (!reveals.length) releaseOrder = '공개 미확인';
  else {
    const clueScene = [...subjectScenes].sort((a, b) => store.sceneOrder.get(a) - store.sceneOrder.get(b))[0];
    const clueTitle = store.meta(clueScene).title_id;
    releaseOrder = reveals.map((ev) => {
      const revealTitle = store.meta(ev.scene_id).title_id;
      const cmp = compareRelease(releaseDates, clueTitle, revealTitle);
      if (cmp.result === '같은 이야기') {
        const a = store.meta(clueScene).index_in_title;
        const b = store.meta(ev.scene_id).index_in_title;
        cmp.scene_order = a === b ? '같은 장면' : a < b ? '단서 먼저' : '공개 먼저';
      }
      return { clue_scene: clueScene, reveal_scene: ev.scene_id, reveal_line_start: ev.line_start, ...cmp };
    });
  }
  return { ...link, evidence_scenes: evidenceScenes, release_order: releaseOrder };
};

// ---------------------------------------------------------------------------
// CLI

const loadPlan = (P) => {
  const plan = readJsonIfExists(P.plan);
  if (!plan) throw new Error(`계획 파일이 없다: ${relPath(P.plan)}. 먼저 build를 실행한다`);
  return plan;
};

const loadBundle = (P, bundleId) => {
  const b = readJsonIfExists(path.join(P.bundles, `${bundleId}.json`));
  if (!b) throw new Error(`묶음이 없다: ${bundleId}`);
  return b;
};

const loadShard = (P, bundleId) => {
  const p = path.join(P.shards, `${bundleId}.json`);
  if (!fs.existsSync(p)) return { missing: true };
  try {
    return { shard: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { parseError: e.message };
  }
};

const makeCtx = () => ({ store: new SceneStore(), registry: loadRegistry(), pass2Entities: loadPass2Entities() });

const validateOne = (P, bundleId, ctx) => {
  const bundle = loadBundle(P, bundleId);
  const s = loadShard(P, bundleId);
  if (s.missing) return { bundle, status: 'missing', errors: [{ code: 'NO_OUTPUT', path: '$', message: '출력 파일이 없다' }], warnings: [] };
  if (s.parseError) return { bundle, status: 'fail', errors: [{ code: 'JSON_PARSE', path: '$', message: s.parseError }], warnings: [] };
  const { errors, warnings } = validateBShard(s.shard, bundle, ctx);
  return { bundle, shard: s.shard, status: errors.length ? 'fail' : 'pass', errors, warnings };
};

const countBy = (list) => list.reduce((acc, x) => ((acc[x.code] = (acc[x.code] ?? 0) + 1), acc), {});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** 규칙·입력·출력의 해시. 묶음의 generated_at은 다시 빌드할 때마다 바뀌므로 뺀다 */
export const computeStamp = ({ rulesText, bundle, scriptText, shardText }) => {
  const { generated_at: _generatedAt, ...stableBundle } = bundle;
  return {
    rules_sha256: sha256(rulesText),
    input_sha256: sha256(`${JSON.stringify(stableBundle)}\n${scriptText}`),
    shard_sha256: sha256(shardText),
  };
};

/** 검증 통과 기록을 지금도 믿을 수 있는지. 믿을 수 없으면 이유를 돌려준다 */
export const staleReason = (recorded, current) => {
  if (!recorded) return '검증 기록이 없다';
  if (recorded.rules_sha256 !== current.rules_sha256) return '판정 규칙이 바뀌었다';
  if (recorded.input_sha256 !== current.input_sha256) return '묶음이나 대본이 바뀌었다';
  if (recorded.shard_sha256 !== current.shard_sha256) return '검증 뒤 출력이 바뀌었다';
  return null;
};

const stampPath = (P, bundleId) => path.join(P.stamps, `${bundleId}.json`);

const currentStamp = (P, bundleId, bundle) => computeStamp({
  rulesText: fs.readFileSync(RULES_PATH, 'utf8'),
  bundle,
  scriptText: fs.readFileSync(path.resolve(bundle.script_file), 'utf8'),
  shardText: fs.readFileSync(path.join(P.shards, `${bundleId}.json`), 'utf8'),
});

const staleReasonOf = (P, bundleId, bundle) => staleReason(readJsonIfExists(stampPath(P, bundleId)), currentStamp(P, bundleId, bundle));

const printResult = (bundleId, r) => {
  const tag = r.status === 'pass' ? (r.warnings.length ? '[WARN]' : '[PASS]') : '[FAIL]';
  console.log(`${tag} ${bundleId}: 오류 ${r.errors.length}건, 경고 ${r.warnings.length}건`);
  for (const e of r.errors) console.log(`  ERROR ${e.code} ${e.path}: ${e.message}`);
  for (const w of r.warnings) console.log(`  WARN  ${w.code} ${w.path}: ${w.message}`);
};

const argValue = (args, name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const run = argValue(args, 'run') ?? 'pilot';
  if (!RUNS.has(run)) throw new Error(`--run은 ${[...RUNS].join(' | ')} 중 하나다`);
  const P = pathsOf(run);

  if (cmd === 'build') {
    const titlesArg = argValue(args, 'titles');
    const all = args.includes('--all');
    const titleIds = titlesArg
      ? titlesArg.split(',').map((s) => s.trim()).filter(Boolean)
      : all
        ? [...loadByTitle().keys()]
        : args.includes('--pilot') || run === 'pilot'
          ? PILOT_TITLES
          : null;
    if (!titleIds) throw new Error(`${run} 실행은 --titles= 또는 --all을 지정한다`);
    const plan = await buildBundles({ titleIds, run, skipEmpty: all, maxUnits: Number(argValue(args, 'max-units') ?? 20), waveSize: Number(argValue(args, 'wave-size') ?? 20) });
    let total = 0;
    for (const b of plan.bundles) {
      total += b.units;
      const t = b.unit_types;
      console.log(`${b.bundle_id}: 단위 ${b.units}(???묶음 ${t.unknown_group}, ???한줄 ${t.unknown_line}, 묘사형 ${t.descriptor}, 작성자 ${t.author}, 목소리 ${t.voice}), 군중 힌트 ${b.crowd_hints}, 스캔 결과 ${b.scan_hits}줄, A-2로 보낸 작성자 ${b.routed_to_a2}`);
      console.log(`  input: ${b.input}\n  script: ${b.script}\n  output: ${b.output}\n  validate: ${b.validate}`);
    }
    console.log(`[build] 묶음 ${plan.bundles.length}개, 판정 단위 ${total}개, ${Math.max(0, ...plan.bundles.map((b) => b.wave))}회차 → ${relPath(P.plan)}`);
    return;
  }

  if (cmd === 'status') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    for (const b of selectWave(plan, argValue(args, 'wave') === null ? null : Number(argValue(args, 'wave')))) {
      const r = validateOne(P, b.bundle_id, ctx);
      const stale = r.status === 'pass' ? staleReasonOf(P, b.bundle_id, r.bundle) : null;
      const st = r.status === 'missing' ? '[new]' : r.status === 'pass' && !stale ? '[done]' : '[rerun]';
      console.log(`${st} ${b.bundle_id} (단위 ${b.units})${stale ? ` — ${stale}` : ''}`);
    }
    return;
  }

  if (cmd === 'validate') {
    const bundleId = args.find((a) => !a.startsWith('--'));
    if (!bundleId) throw new Error('validate <bundle_id>');
    const r = validateOne(P, bundleId, makeCtx());
    printResult(bundleId, r);
    await fsp.mkdir(P.root, { recursive: true });
    if (r.status === 'pass') {
      await writeJsonAtomic(stampPath(P, bundleId), { ...currentStamp(P, bundleId, r.bundle), validated_at: new Date().toISOString() });
    }
    await fsp.appendFile(
      P.log,
      `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundleId, status: r.status, errors: countBy(r.errors), warnings: countBy(r.warnings) })}\n`
    );
    if (r.status !== 'pass') process.exitCode = 1;
    return;
  }

  if (cmd === 'finish') {
    const plan = loadPlan(P);
    const ctx = makeCtx();
    const releaseDates = loadReleaseDates();
    const log = fs.existsSync(P.log) ? fs.readFileSync(P.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const progress = {};
    const merged = [];
    const reviewItems = [];
    for (const b of plan.bundles) {
      const r = validateOne(P, b.bundle_id, ctx);
      const attempts = log.filter((x) => x.bundle_id === b.bundle_id);
      const firstFail = attempts.length ? attempts[0].status !== 'pass' : null;
      const stale = r.status === 'pass' ? staleReasonOf(P, b.bundle_id, r.bundle) : null;
      progress[b.bundle_id] = { status: stale ? 'stale' : r.status === 'pass' ? 'merged' : r.status, stale_reason: stale, validations: attempts.length, first_validation_failed: firstFail, errors: countBy(r.errors), warnings: countBy(r.warnings) };
      console.log(`${b.bundle_id}: ${progress[b.bundle_id].status}${stale ? `(${stale})` : ''} (검증 ${attempts.length}회${firstFail ? ', 첫 검증 실패' : ''}, 남은 오류 ${r.errors.length}, 경고 ${r.warnings.length})`);
      for (const w of r.warnings) console.log(`  WARN ${w.code} ${w.path}: ${w.message}`);
      for (const e of r.errors) console.log(`  ERROR ${e.code} ${e.path}: ${e.message}`);
      if (r.status !== 'pass' || stale) continue;
      for (const link of r.shard.candidate_links) {
        const enriched = enrichLink(link, r.bundle, { store: ctx.store, releaseDates });
        merged.push({ bundle_id: b.bundle_id, title_id: b.title_id, ...enriched });
        const units = [...new Set(link.subject.map((s) => r.bundle.units.find((u) => u.subject_refs.some((x) => unitElementKey(x) === unitElementKey(s)))?.unit_id))];
        reviewItems.push({ link_id: link.link_id, bundle_id: b.bundle_id, units, script_file: r.bundle.script_file, link: enriched });
      }
    }
    const verdicts = merged.reduce((acc, l) => ((acc[l.verdict] = (acc[l.verdict] ?? 0) + 1), acc), {});
    await writeJsonAtomic(P.merged, { schema_version: PASS2_SCHEMA_VERSION, kind: 'B', run, generated_at: new Date().toISOString(), links: merged });
    await writeJsonAtomic(P.progress, { schema_version: PASS2_SCHEMA_VERSION, run, updated_at: new Date().toISOString(), bundles: progress });
    await writeJsonAtomic(P.reviewInput, {
      schema_version: 'pass2-review-input-0.1.0',
      run,
      generated_at: new Date().toISOString(),
      bundles: plan.bundles.filter((b) => progress[b.bundle_id].status === 'merged').map((b) => b.input),
      items: reviewItems,
    });
    const mergedCount = Object.values(progress).filter((x) => x.status === 'merged').length;
    console.log(`[finish] 병합 ${mergedCount}/${plan.bundles.length}묶음, 연결 ${merged.length}건 ${JSON.stringify(verdicts)} → ${relPath(P.merged)}`);
    console.log(`[finish] 독립 검토 입력 → ${relPath(P.reviewInput)}, 검토 출력은 ${relPath(P.reviewOutput)}에 쓴다`);
    return;
  }

  if (cmd === 'review-check') {
    const input = readJsonIfExists(P.reviewInput);
    const out = readJsonIfExists(P.reviewOutput);
    if (!input || !out) throw new Error('검토 입력 또는 출력이 없다');
    const r = checkReview(input, out, { store: new SceneStore() });
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    console.log(`${r.errors.length ? '[FAIL]' : '[PASS]'} 검토 ${r.reviewed}/${input.items.length}건, 판정 ${JSON.stringify(r.judgments)}`);
    if (r.errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'audit-input' || cmd === 'audit-check') {
    const wave = Number(argValue(args, 'wave'));
    const plan = loadPlan(P);
    const selected = selectWave(plan, wave);
    const ctx = makeCtx();
    const bundleStamps = [];
    const bundles = new Map();
    const links = [];
    for (const b of selected) {
      const r = validateOne(P, b.bundle_id, ctx);
      if (r.status !== 'pass') throw new Error(`${b.bundle_id}: 미완료 또는 검증 실패`);
      const stale = staleReasonOf(P, b.bundle_id, r.bundle);
      if (stale) throw new Error(`${b.bundle_id}: ${stale}`);
      bundleStamps.push({ bundle_id: b.bundle_id, ...currentStamp(P, b.bundle_id, r.bundle) });
      bundles.set(b.bundle_id, r.bundle);
      links.push(...r.shard.candidate_links.map((link) => ({ bundle_id: b.bundle_id, ...link })));
    }
    const auditDir = path.join(P.root, 'audit');
    const inputPath = path.join(auditDir, `wave_${pad(wave)}_input.json`);
    const outputPath = path.join(auditDir, `wave_${pad(wave)}_output.json`);
    if (cmd === 'audit-input') {
      const judgeFamily = argValue(args, 'judge-family') ?? 'gemini';
      if (!['gemini', 'gpt', 'claude'].includes(judgeFamily)) throw new Error('judge-family는 gemini | gpt | claude 중 하나다');
      const previous = readJsonIfExists(inputPath);
      const sample = sampleAuditCases({ planBundles: selected, bundles, links, rate: Number(argValue(args, 'rate') ?? 0.1), seed: `${run}/${wave}`, includeIds: previous?.items.map((x) => x.audit_id) ?? [] });
      const input = {
        schema_version: 'pass2-audit-input-0.1.0', run, wave,
        judge_family: judgeFamily,
        bundle_stamps: bundleStamps,
        ...sample,
      };
      input.source_sha256 = sha256(JSON.stringify(input));
      await writeJsonAtomic(inputPath, input);
      console.log(`[audit-input] 회차 ${wave}: ${sample.sampled_units}/${sample.population_units}단위 (${sample.strata.length}개 층, 각 층 최소 1개) → ${relPath(inputPath)}`);
      console.log(`[audit-input] 다른 모델의 감사 출력 → ${relPath(outputPath)}`);
    } else {
      const input = readJsonIfExists(inputPath);
      const out = readJsonIfExists(outputPath);
      if (!input || !out) throw new Error('감사 입력 또는 출력이 없다');
      const r = checkAudit(input, out, { store: ctx.store, bundleStamps });
      for (const e of r.errors) console.log(`  ERROR ${e}`);
      console.log(`${r.errors.length ? '[FAIL]' : '[PASS]'} 감사 ${r.reviewed}/${input.items.length}단위, 판정 ${JSON.stringify(r.judgments)}`);
      if (r.errors.length) process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'answers-template') {
    const out = argValue(args, 'out');
    if (!out || !isOutsideRepo(out)) throw new Error('--out은 저장소 밖 경로여야 한다(정답은 저장소 밖에 보관한다)');
    const plan = loadPlan(P);
    const lines = [];
    for (const b of plan.bundles) {
      const bundle = loadBundle(P, b.bundle_id);
      for (const u of bundle.units) {
        const first = u.lines[0];
        const sample = first ? `${first.scene_id} ${lineTag(first.line)} ${first.text}` : `${u.scene_ids.join(', ')} ${u.pass1.author?.name ?? u.pass1.voice?.voice_text ?? ''}`;
        lines.push(JSON.stringify({ bundle_id: b.bundle_id, unit_id: u.unit_id, unit_type: u.unit_type, sample: sample.slice(0, 120), answer: null, note: '' }));
      }
    }
    await fsp.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fsp.writeFile(out, `${lines.join('\n')}\n`, 'utf8');
    console.log(`[answers-template] 단위 ${lines.length}개 → ${out}`);
    console.log('answer: {"entity_id": "char_..."} 또는 {"name": "..."} 또는 "crowd" 또는 "hold"(보류가 맞는 단위). 모르는 단위는 줄을 지운다.');
    return;
  }

  if (cmd === 'score') {
    const ans = argValue(args, 'answers');
    if (!ans || !isOutsideRepo(ans)) throw new Error('--answers는 저장소 밖 경로여야 한다');
    const plan = loadPlan(P);
    const merged = readJsonIfExists(P.merged);
    if (!merged) throw new Error('병합 결과가 없다. finish를 먼저 실행한다');
    const bundles = new Map(plan.bundles.map((b) => [b.bundle_id, loadBundle(P, b.bundle_id)]));
    const allAnswers = fs.readFileSync(ans, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((a) => a.answer !== null);
    const scope = argValue(args, 'answers-scope');
    if (scope !== null && scope !== 'plan') throw new Error('--answers-scope은 plan만 지원한다');
    const bundleIds = new Set(plan.bundles.map((b) => b.bundle_id));
    const answers = scope === 'plan' ? allAnswers.filter((a) => bundleIds.has(a.bundle_id)) : allAnswers;
    const review = readJsonIfExists(P.reviewOutput);
    const s = scoreB({ plan, bundles, merged, answers, review });
    if (scope) s.answer_scope = { scope, excluded_answers: allAnswers.length - answers.length };
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  if (cmd === 'show') {
    // 등록 장면 원문을 줄 번호와 함께 출력한다(서브에이전트·검토자용)
    const [sceneId, from, to] = args.filter((a) => !a.startsWith('--'));
    const store = new SceneStore();
    const lines = store.lines(sceneId);
    if (!lines) throw new Error(`등록 장면이 아니다: ${sceneId}`);
    const a = Math.max(1, Number(from) || 1);
    const b = Math.min(lines.length - 1, Number(to) || lines.length - 1);
    const meta = store.meta(sceneId);
    console.log(`@@@ ${sceneId} | ${meta.title_id} | ${meta.sub_title ?? ''} | ${lines.length - 1}줄`);
    for (let i = a; i <= b; i++) console.log(`[${lineTag(i)}] ${lines[i]}`);
    return;
  }

  if (cmd === 'grep') {
    // 등록 원문 전체 검색. 사전 지식으로 떠올린 후보의 원문 근거를 찾을 때 쓴다. 쓸 때마다 기록한다(파일럿 평가)
    const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    if (term.length < 2) throw new Error('검색어는 2글자 이상이다');
    const bundle = argValue(args, 'bundle');
    const limit = Number(argValue(args, 'limit')) || 30;
    const offset = Math.max(0, Number(argValue(args, 'offset')) || 0);
    const store = new SceneStore();
    const r = scanTerms(store, [term]).get(term);
    const shown = r.hits.slice(offset, offset + limit);
    const end = offset + shown.length;
    const range = offset > 0 || end < r.hits.length ? ` (${shown.length ? `${offset + 1}~${end}번째 줄 표시` : '표시할 줄 없음'}${end < r.hits.length ? `, 이어 보기: --offset=${end}` : ''})` : '';
    console.log(`"${term}": 장면 ${r.scene_count}개, ${r.hits.length}줄${range}`);
    for (const h of shown) {
      const meta = store.meta(h.scene_id);
      console.log(`${h.scene_id} [${lineTag(h.line)}] (${meta.title_id}) ${store.lines(h.scene_id)[h.line]}`);
    }
    await fsp.mkdir(P.root, { recursive: true });
    await fsp.appendFile(path.join(P.root, 'search_log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), bundle_id: bundle, term, scenes: r.scene_count, lines: r.hits.length, limit, offset, shown: shown.length })}\n`);
    return;
  }

  if (cmd === 'entity') {
    // 레지스트리에서 이름·별칭으로 entity_id를 찾는다
    const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!q) throw new Error('entity <이름>');
    const hits = [...loadRegistry().values()].filter((e) => e.canonical_name.includes(q) || (e.surface_labels ?? []).some((l) => l.includes(q)));
    if (!hits.length) console.log(`"${q}": 레지스트리에 없다. 미등록 인물이면 entity_id: null과 name으로 적는다`);
    for (const e of hits.slice(0, 20)) console.log(`${e.entity_id}\t${e.canonical_name}\t별칭: ${(e.surface_labels ?? []).join(', ')}\t장면 ${e.scene_count}`);
    return;
  }

  console.log('사용법: build [--max-units=20 --wave-size=20] | status [--wave=N] | validate <bundle_id> | show <scene_id> [시작 끝] | grep <낱말> --bundle=<bundle_id> [--limit= --offset=] | entity <이름> | finish | review-check | audit-input --wave=N [--rate=0.1] | audit-check --wave=N | answers-template --out= | score --answers= [--answers-scope=plan]  [--run=pilot|probe|probe-retest|main]');
  process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// 독립 검토와 평가(초안 8절 평가)

export const REVIEW_JUDGMENTS = new Set(['맞음', '틀림', '판단 불가']);
export const REVIEW_PROBLEMS = new Set([
  'wrong_target', // 후보가 틀림
  'missed_candidate', // 원문에 후보가 드러나는데 판단 보류·군중으로 둠
  'should_be_crowd',
  'should_not_be_crowd',
  'subject_split', // 한 연결에 다른 사람이 섞임(같은 사람을 단위별로 나눈 것은 문제가 아니다)
  'evidence_not_support', // 근거 줄이 판정을 지지하지 않음
  'reveals_identity_wrong',
  'confidence_too_high',
  'prior_knowledge_as_evidence', // 사전 지식을 근거로 씀
  'other',
]);

const compactText = (text) => String(text ?? '').replace(/\s+/g, '');

/** 검토 인용 하나를 원문 한 줄과 대조한다. 화자 라벨까지 포함해 그 줄 전체가 같아야 한다 */
const citationProblem = (cite, store) => {
  if (!cite || typeof cite !== 'object' || Array.isArray(cite)) return '인용은 {scene_id, line, quote} 객체다';
  const unknown = Object.keys(cite).filter((k) => !['scene_id', 'line', 'quote'].includes(k));
  if (unknown.length) return `알 수 없는 필드 ${unknown.join(', ')}`;
  if (!isNonEmptyString(cite.scene_id) || !store.has(cite.scene_id)) return `등록 장면이 아니다: ${cite.scene_id}`;
  if (!isPositiveInt(cite.line)) return 'line은 1 이상의 정수다';
  if (!isNonEmptyString(cite.quote)) return 'quote가 비었다';
  const source = store.lines(cite.scene_id)[cite.line];
  if (source === undefined) return `${cite.scene_id}에 L${cite.line}이 없다`;
  if (compactText(source) !== compactText(cite.quote)) return `${cite.scene_id} L${cite.line}의 원문과 다르다. 원문: ${source.trim().slice(0, 60)}`;
  return null;
};

export const checkReview = (input, out, { store }) => {
  const errors = [];
  const ids = new Set(input.items.map((x) => x.link_id));
  const seen = new Set();
  const judgments = {};
  for (const [i, r] of (out.reviews ?? []).entries()) {
    if (!ids.has(r.link_id)) errors.push(`reviews[${i}] 검토 입력에 없는 link_id ${r.link_id}`);
    if (seen.has(r.link_id)) errors.push(`reviews[${i}] link_id 중복 ${r.link_id}`);
    seen.add(r.link_id);
    if (!REVIEW_JUDGMENTS.has(r.judgment)) errors.push(`reviews[${i}].judgment는 ${[...REVIEW_JUDGMENTS].join(' | ')}`);
    judgments[r.judgment] = (judgments[r.judgment] ?? 0) + 1;
    if (!Array.isArray(r.problems) || r.problems.some((p) => !REVIEW_PROBLEMS.has(p))) errors.push(`reviews[${i}].problems는 ${[...REVIEW_PROBLEMS].join(', ')} 중에서 고른 배열`);
    if (r.judgment === '틀림' && !(r.problems?.length)) errors.push(`reviews[${i}] 틀림이면 problems를 하나 이상 적는다`);
    if (!isNonEmptyString(r.reason)) errors.push(`reviews[${i}].reason이 비었다`);
    if (!Array.isArray(r.evidence) || r.evidence.length === 0) errors.push(`reviews[${i}].evidence에 원문 인용을 하나 이상 적는다`);
    else r.evidence.forEach((cite, j) => {
      const problem = citationProblem(cite, store);
      if (problem) errors.push(`reviews[${i}].evidence[${j}] ${problem}`);
    });
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`검토하지 않은 연결 ${id}`);
  return { errors, reviewed: seen.size, judgments };
};

/** 원문 인용 검사는 기계가, 의미 판단은 다른 모델이 한다. 표본 통과는 모집단 무오류의 증명이 아니다. */
export const checkAudit = (input, out, { store, bundleStamps }) => {
  const errors = [];
  const { source_sha256, ...source } = input;
  if (source_sha256 !== sha256(JSON.stringify(source))) errors.push('감사 입력의 해시가 맞지 않는다');
  if (JSON.stringify(input.bundle_stamps) !== JSON.stringify(bundleStamps)) errors.push('감사 이후 규칙·입력·출력 또는 회차 구성이 바뀌었다. 감사 입력을 다시 만든다');
  if (out.schema_version !== 'pass2-audit-0.1.0') errors.push('schema_version은 pass2-audit-0.1.0이다');
  if (out.input_sha256 !== source_sha256) errors.push('다른 감사 입력에 대한 출력이다');
  if (!['gemini', 'gpt', 'claude', 'human'].includes(out.auditor_family) || out.auditor_family === input.judge_family) errors.push('판정 모델과 다른 모델 계열(또는 사람)이 감사해야 한다');
  if (!isNonEmptyString(out.auditor_model) || !isNonEmptyString(out.auditor_session)) errors.push('감사 모델명과 별도 세션 ID를 적는다');
  if (!Array.isArray(out.reviews)) return { errors: [...errors, 'reviews는 배열이다'], reviewed: 0, judgments: {} };
  const reviewed = checkReview(
    { items: input.items.map((x) => ({ link_id: x.audit_id })) },
    { reviews: out.reviews.map((r) => ({ ...r, link_id: r?.audit_id })) },
    { store },
  );
  errors.push(...reviewed.errors);
  for (const r of out.reviews) {
    if (r?.judgment !== '맞음' || r.problems?.length) errors.push(`${r?.audit_id}: 감사 지적 또는 판단 불가가 남았다. 수정·재감사 뒤 다음 회차로 간다`);
  }
  return { ...reviewed, errors };
};

const normName = (s) => normalizeWhitespaceOnly(s ?? '').replace(/\s/g, '');
const SEARCH_BUDGET_TAG = '[검색 예산 소진]'; // 규칙 3.4. 충분히 찾아도 근거가 없는 보류와 구분한다

export const scoreB = ({ plan, bundles, merged, answers, review }) => {
  // 대상 누락률: 판정 단위 원소 중 병합된 연결에 없는 것
  let elementsTotal = 0;
  let elementsCovered = 0;
  const linkByElement = new Map();
  for (const l of merged.links) for (const s of l.subject) linkByElement.set(`${l.bundle_id}|${unitElementKey(s)}`, l);
  let unitsTotal = 0;
  let unitsCovered = 0;
  for (const b of plan.bundles) {
    for (const u of bundles.get(b.bundle_id).units) {
      unitsTotal += 1;
      let all = true;
      for (const r of u.subject_refs) {
        elementsTotal += 1;
        if (linkByElement.has(`${b.bundle_id}|${unitElementKey(r)}`)) elementsCovered += 1;
        else all = false;
      }
      if (all) unitsCovered += 1;
    }
  }
  // 정답 종류별 결과. 정체 정답은 '정체 후보 있음' 연결에서만 적중으로 친다(보류 연결의 target은 후보를 낸 것이 아니다)
  const answerKindOf = (answer) => (answer === 'crowd' ? 'crowd' : answer === 'hold' ? 'hold' : 'identity');
  const perAnswer = answers.map((a) => {
    const base = { bundle_id: a.bundle_id, unit_id: a.unit_id, answer_kind: answerKindOf(a.answer) };
    const u = bundles.get(a.bundle_id)?.units.find((x) => x.unit_id === a.unit_id);
    if (!u) return { ...base, result: 'unit_not_found' };
    const links = [...new Set(u.subject_refs.map((r) => linkByElement.get(`${a.bundle_id}|${unitElementKey(r)}`)).filter(Boolean))];
    if (!links.length) return { ...base, result: 'not_merged' };
    const match = (e) =>
      (a.answer?.entity_id && e.entity_id === a.answer.entity_id) || (a.answer?.name && normName(e.name) === normName(a.answer.name));
    let result = 'miss';
    if (a.answer === 'crowd') result = links.every((l) => l.link_type === 'crowd') ? 'correct' : 'miss';
    else if (a.answer === 'hold') result = links.every((l) => l.verdict === '판단 보류') ? 'correct' : 'miss';
    else {
      const named = links.filter((l) => l.verdict === '정체 후보 있음');
      const held = links.filter((l) => l.verdict === '판단 보류');
      const hitsTarget = (l) => l.target.some(match);
      if (named.length === links.length && named.every(hitsTarget)) result = 'target';
      else if (named.some(hitsTarget)) result = 'partial'; // 단위가 나뉘어 일부 연결만 맞음
      else if (named.some((l) => (l.alternatives ?? []).some(match))) result = 'alternative';
      else if (held.some((l) => hitsTarget(l) || (l.alternatives ?? []).some(match))) result = 'held_with_answer';
    }
    return { ...base, links: links.map((l) => l.link_id), verdicts: links.map((l) => l.verdict), result };
  });
  const byAnswerKind = {};
  for (const x of perAnswer) {
    const entry = (byAnswerKind[x.answer_kind] ??= { answers: 0, results: {} });
    entry.answers += 1;
    entry.results[x.result] = (entry.results[x.result] ?? 0) + 1;
  }
  const identityResults = byAnswerKind.identity?.results ?? {};
  const identityAnswers = byAnswerKind.identity?.answers ?? 0;
  const inTarget = identityResults.target ?? 0;
  const inAlternative = identityResults.alternative ?? 0;
  const held = merged.links.filter((l) => l.verdict === '판단 보류');
  let misLink = null;
  if (review?.reviews) {
    const judged = review.reviews.filter((r) => r.judgment !== '판단 불가');
    misLink = { wrong: judged.filter((r) => r.judgment === '틀림').length, judged: judged.length, unjudgeable: review.reviews.length - judged.length };
    misLink.rate = judged.length ? +(misLink.wrong / judged.length).toFixed(3) : null;
  }
  return {
    omission: {
      units: unitsTotal,
      units_covered: unitsCovered,
      unit_rate: unitsTotal ? +((unitsTotal - unitsCovered) / unitsTotal).toFixed(3) : 0,
      refs: elementsTotal,
      refs_covered: elementsCovered,
      rate: elementsTotal ? +((elementsTotal - elementsCovered) / elementsTotal).toFixed(3) : 0,
    },
    candidate_recall: {
      answers: identityAnswers,
      hit: inTarget + inAlternative,
      in_target: inTarget,
      in_alternative: inAlternative,
      rate: identityAnswers ? +((inTarget + inAlternative) / identityAnswers).toFixed(3) : null,
    },
    by_answer_kind: byAnswerKind,
    holds: { total: held.length, search_budget_exhausted: held.filter((l) => l.rationale.startsWith(SEARCH_BUDGET_TAG)).length },
    mislink: misLink,
    per_answer: perAnswer,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(`[pass2-b] ${e.message}`);
    process.exitCode = 1;
  });
}
