import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// 측정 게이트 채점. gate-run.mjs 결과(고정된 run.json)와 정답 파일(저장소 밖)을 맞춘다.
// 검색 결과를 고정한 뒤에만 실행한다(GRAPH_RAG_PASS1_GATE.md 2절).
// 질문마다 필수 근거 장면(required: true)이 상위 10·20·50위와 전체 후보에 몇 개 들었는지 센다.
// 출력에는 장면 ID와 순위만 쓰고 answer 문장은 쓰지 않는다.

export const CUTOFFS = [10, 20, 50];

export const scoreRun = (run, answers) => {
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  const rows = [];
  for (const r of run.results) {
    const a = byId.get(r.question_id);
    if (!a) {
      rows.push({ question_id: r.question_id, type: r.type, missing_answer: true });
      continue;
    }
    const required = [...new Set(a.evidence.filter((e) => e.required).map((e) => e.scene_id))];
    const rank = new Map(r.top.map((t, i) => [t.scene_id, i + 1]));
    const ranks = required.map((s) => ({ scene_id: s, rank: rank.get(s) ?? null }));
    const row = { question_id: r.question_id, type: r.type, required: required.length, candidate_count: r.candidate_count, ranks };
    for (const k of CUTOFFS) {
      const hit = ranks.filter((x) => x.rank !== null && x.rank <= k).length;
      row[`hit@${k}`] = hit;
      row[`all@${k}`] = hit === required.length;
    }
    rows.push(row);
  }
  const scored = rows.filter((r) => !r.missing_answer);
  const summarize = (list) => {
    const s = { questions: list.length };
    const req = list.reduce((n, r) => n + r.required, 0);
    for (const k of CUTOFFS) {
      s[`scene_recall@${k}`] = req ? Number((list.reduce((n, r) => n + r[`hit@${k}`], 0) / req).toFixed(3)) : null;
      s[`question_all@${k}`] = list.filter((r) => r[`all@${k}`]).length;
    }
    s.median_candidates = list.length ? [...list.map((r) => r.candidate_count)].sort((x, y) => x - y)[Math.floor(list.length / 2)] : null;
    return s;
  };
  const byType = {};
  for (const t of [...new Set(scored.map((r) => r.type))].sort()) byType[t] = summarize(scored.filter((r) => r.type === t));
  return { overall: summarize(scored), by_type: byType, missing_answers: rows.filter((r) => r.missing_answer).map((r) => r.question_id), rows };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [runPath, answersPath, outPath] = process.argv.slice(2);
  if (!runPath || !answersPath) {
    console.error('사용법: node scripts/graph/gate-score.mjs <run.json> <answers.jsonl> [출력 score.json]');
    process.exit(2);
  }
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  const answers = fs.readFileSync(answersPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const score = scoreRun(run, answers);
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(score, null, 1));
  console.log(JSON.stringify({ overall: score.overall, by_type: score.by_type, missing_answers: score.missing_answers }, null, 1));
}
