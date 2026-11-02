// Claude·GPT 진단 결과 대조 (GRAPH_RAG_PASS1_DIAGNOSIS.md 6절)
// 사용법: node compare.mjs  → compare.json
// 판정은 셋으로 묶어 비교한다: 문제(오류 의심·연결 누락 의심), 정상, 보류
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const load = (who) => fs.readFileSync(path.join(DIR, who, 'findings.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const C = load('claude');
const G = load('gpt');
const cls = (v) => (v === '오류 의심' || v === '연결 누락 의심' ? '문제' : v === '정상' ? '정상' : '보류');
const key = (f) => `${f.question}\t${f.target_key}`;
const mapOf = (arr) => new Map(arr.map((f) => [key(f), f]));
const cm = mapOf(C);
const gm = mapOf(G);
const tkC = new Map();
for (const f of C) tkC.set(f.target_key, [...(tkC.get(f.target_key) ?? []), f]);
const tkG = new Map();
for (const f of G) tkG.set(f.target_key, [...(tkG.get(f.target_key) ?? []), f]);

const out = { counts: {}, by_question: {}, cross_question: [], problem_disagreements: [], problem_only_claude: [], problem_only_gpt: [] };
out.counts = { claude: C.length, gpt: G.length };
const qs = [...new Set([...C, ...G].map((f) => f.question))].sort();
for (const q of qs) {
  const r = { claude: 0, gpt: 0, both: 0, same_class: 0, diff_class: {}, only_claude: {}, only_gpt: {} };
  for (const f of C.filter((x) => x.question === q)) {
    r.claude += 1;
    const g = gm.get(key(f));
    if (g) {
      r.both += 1;
      if (cls(f.verdict) === cls(g.verdict)) r.same_class += 1;
      else {
        const k = `claude ${cls(f.verdict)} / gpt ${cls(g.verdict)}`;
        r.diff_class[k] = (r.diff_class[k] || 0) + 1;
        if (cls(f.verdict) === '문제' || cls(g.verdict) === '문제') out.problem_disagreements.push({ q, target_key: f.target_key, claude: f.verdict, gpt: g.verdict, claude_reason: f.reason, gpt_reason: g.reason });
      }
    } else {
      r.only_claude[cls(f.verdict)] = (r.only_claude[cls(f.verdict)] || 0) + 1;
      // 같은 target_key가 다른 질문에 있는지
      const other = (tkG.get(f.target_key) ?? []).filter((x) => x.question !== q);
      if (other.length) out.cross_question.push({ target_key: f.target_key, claude: `${q} ${f.verdict}`, gpt: other.map((x) => `${x.question} ${x.verdict}`) });
      else if (cls(f.verdict) === '문제') out.problem_only_claude.push({ q, target_key: f.target_key, verdict: f.verdict, reason: f.reason, source_checked: f.source_checked.length > 0 });
    }
  }
  for (const g of G.filter((x) => x.question === q)) {
    r.gpt += 1;
    if (!cm.has(key(g))) {
      r.only_gpt[cls(g.verdict)] = (r.only_gpt[cls(g.verdict)] || 0) + 1;
      const other = (tkC.get(g.target_key) ?? []).filter((x) => x.question !== q);
      if (!other.length && cls(g.verdict) === '문제') out.problem_only_gpt.push({ q, target_key: g.target_key, verdict: g.verdict, reason: g.reason, source_checked: g.source_checked.length > 0 });
    }
  }
  out.by_question[q] = r;
}
fs.writeFileSync(path.join(DIR, 'compare.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ counts: out.counts, by_question: out.by_question, cross_question: out.cross_question.length, problem_disagreements: out.problem_disagreements.length, problem_only_claude: out.problem_only_claude.length, problem_only_gpt: out.problem_only_gpt.length }, null, 1));
