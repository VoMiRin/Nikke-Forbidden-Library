import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

// 5절 Pass 1: 추출 서브에이전트는 명세 전체 대신 Pass 1에 필요한 절만 모은 규칙 파일을 읽는다.
// 서브에이전트는 스텝마다 읽은 내용을 다시 보내므로, 읽는 분량이 곧 입력 토큰이다.
// 규칙 파일은 명세에서 그대로 잘라 만들고 직접 고치지 않는다. 명세를 고치면 다시 만든다.

export const SPEC_PATH = path.join(ROOT_DIR, 'GRAPH_RAG_SPEC.md');
export const PASS1_RULES_PATH = path.join(ROOT_DIR, 'GRAPH_RAG_PASS1_RULES.md');

// 명세의 제목 줄 앞부분. 제목부터 다음 제목(수준 무관) 전까지가 한 절이다.
// 3절·4절은 하위 제목이 없으므로 절 전체가 들어간다.
export const PASS1_RULE_SECTIONS = [
  '### 1.2 ',
  '### 1.5 ',
  '### 1.6 ',
  '### 2.3 ',
  '## 3. ',
  '## 4. ',
  '### Pass 1: ',
];

const HEADING_RE = /^#{1,6} /;

export const splitSections = (markdown) => {
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && HEADING_RE.test(line)) {
      current = { heading: line, lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trimEnd() }));
};

export const buildPass1Rules = (specMarkdown) => {
  const sections = splitSections(specMarkdown);
  const picked = PASS1_RULE_SECTIONS.map((prefix) => {
    const matches = sections.filter((s) => s.heading.startsWith(prefix));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one spec section starting with "${prefix}", found ${matches.length}`);
    }
    return matches[0].text;
  });
  const header = [
    '# GraphRAG Pass 1 추출 규칙',
    '',
    '> 이 파일은 `GRAPH_RAG_SPEC.md`에서 Pass 1 추출에 필요한 절만 그대로 옮긴 것이다.',
    '> 직접 고치지 마라. 명세를 고친 뒤 `node scripts/graph/build-pass1-rules.mjs`로 다시 만든다.',
    '> 절 번호와 항 번호는 명세와 같다. 여기 없는 절(2.1, 5절의 다른 부분, 8절 등)을 가리키는 문장은 감독관의 일이므로 추출자는 무시해도 된다.',
  ].join('\n');
  return `${header}\n\n${picked.join('\n\n')}\n`;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const check = process.argv.includes('--check');
  const run = async () => {
    const rules = buildPass1Rules(await fs.readFile(SPEC_PATH, 'utf8'));
    const rel = path.relative(process.cwd(), PASS1_RULES_PATH);
    if (check) {
      const current = await fs.readFile(PASS1_RULES_PATH, 'utf8').catch(() => null);
      if (current !== rules) {
        console.error(`[pass1-rules] ${rel} is out of date. Run: node scripts/graph/build-pass1-rules.mjs`);
        process.exit(1);
      }
      console.log(`[pass1-rules] ${rel} is up to date`);
      return;
    }
    await fs.writeFile(PASS1_RULES_PATH, rules);
    const specBytes = Buffer.byteLength(await fs.readFile(SPEC_PATH, 'utf8'));
    const rulesBytes = Buffer.byteLength(rules);
    console.log(`[pass1-rules] wrote ${rel} (${rulesBytes} bytes, ${((100 * rulesBytes) / specBytes).toFixed(0)}% of spec)`);
  };
  run().catch((err) => {
    console.error('[pass1-rules]', err.message || err);
    process.exit(1);
  });
}
