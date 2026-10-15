import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const GENERATED_DIR = path.join(ROOT_DIR, '.generated-search-assets');
export const SCRIPTS_ROOT_DIR = path.join(ROOT_DIR, 'public', 'scripts');
export const GRAPH_DATA_DIR = path.join(ROOT_DIR, 'data', 'graph');

// Pass 1 샤드·배치 입력·병합 산출물의 스키마 버전 (4절)
export const PASS1_SCHEMA_VERSION = '1.3.0';

export const CATEGORY_NAMES = {
  main_story: '메인 스토리',
  event_stories: '이벤트 스토리',
  side_stories: '사이드 스토리',
  sub_quests: '서브 퀘스트',
  outpost_stories: '돌발 스토리',
  character_episodes: '니케 에피소드',
  lost_relics: '유실물',
  event_lost_relics: '이벤트 유실물',
  special_stories: '특별 스토리',
  blabla: '블라블라',
};

export const NARRATION_LABELS = new Set([
  'LOCATION',
  'SOUND',
  'NARRATION',
  '나래이션',
  '나레이션',
  'MUSIC',
  'EFFECTS',
  'ACTION',
  'TRANSITION',
  'FADE IN',
  'FADE OUT',
  'CUT TO',
  'INT',
  'EXT',
  'SYSTEM',
  '시스템',
  '알림',
]);

export const DOCUMENT_FIELD_LABELS = new Set([
  '제목',
  '내용',
  '장소',
  '시간',
  '용도',
  '서명자',
  '타겟',
  '부사령관실',
  '노이즈 게릴라 콘서트. 장소',
  '슈가 커피 레시피',
  '카페 서비스',
  '카페 신메뉴 맛',
  '미카의 서비스',
  '미카가 만든 신메뉴 맛',
  '결과',
  '이름',
  '성별',
  '나이',
  '특징',
  '성격',
  '사유',
  '비고',
  '날짜',
  'xttp',
  'http',
  'https',
  '댓글',
  'RE',
]);

/**
 * 줄바꿈을 \n으로 정규화한다 (1.2).
 */
export const normalizeNewlines = (text) => (
  String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
);

/**
 * 인용문 비교용 공백 정규화 (2.3.4):
 * 공백만 단일 스페이스로 정규화하며, ···와 ...는 서로 치환하지 않는다.
 */
export const normalizeWhitespaceOnly = (text) => (
  String(text ?? '').replace(/\s+/g, ' ').trim()
);

/**
 * SHA-256 해시 계산
 */
export const sha256 = (text) => (
  crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
);

/**
 * 원자적 JSON 파일 쓰기 (2.2):
 * 임시 파일에 쓰고 JSON 파싱 검증을 거친 뒤 rename으로 교체한다.
 */
export const writeJsonAtomic = async (targetPath, value) => {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(serialized);
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  await fs.writeFile(tmpPath, serialized, 'utf8');
  const readBack = await fs.readFile(tmpPath, 'utf8');
  JSON.parse(readBack);
  await fs.rename(tmpPath, targetPath);
};

/**
 * .generated-search-assets/data/newScripts.js에서 단일 등록 기준 newScriptsData를 로드한다 (1.1).
 */
export const loadNewScriptsData = () => {
  const compiledPath = path.join(GENERATED_DIR, 'data', 'newScripts.js');
  const pkgPath = path.join(GENERATED_DIR, 'package.json');

  if (!fsSync.existsSync(compiledPath)) {
    fsSync.mkdirSync(GENERATED_DIR, { recursive: true });
    fsSync.writeFileSync(pkgPath, JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8');
    execSync('npx tsc -p tsconfig.search-assets.json', { cwd: ROOT_DIR, stdio: 'inherit' });
  } else if (!fsSync.existsSync(pkgPath)) {
    fsSync.writeFileSync(pkgPath, JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8');
  }

  const require = createRequire(import.meta.url);
  const { newScriptsData } = require(compiledPath);
  if (!Array.isArray(newScriptsData)) {
    throw new Error('Failed to load newScriptsData array from .generated-search-assets/data/newScripts.js');
  }
  return newScriptsData;
};

/**
 * (categoryKey, mainChapterFile)로부터 고유한 title_id를 생성한다.
 */
export const makeTitleId = (categoryKey, mainChapterFile) => {
  const withoutTxt = String(mainChapterFile)
    .replace(/\.txt$/i, '')
    .replace(/\.txt$/i, '');
  const slug = withoutTxt
    .replace(/[\/\\]+/g, '__')
    .replace(/[^0-9A-Za-z가-힣_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${categoryKey}__${slug}`;
};

/**
 * 원문 챕터 텍스트를 @@@SCRIPT_ID: 기준으로만 분리한다 (1.2).
 * @@@ 전체로 분리하면 @@@SUB_TITLE이 별도 블록이 되므로 반드시 @@@SCRIPT_ID:만 사용한다.
 */
export const parseChapterTextBlocks = (rawChapterText) => {
  const normalized = normalizeNewlines(rawChapterText);
  const rawBlocks = normalized.split(/^@@@SCRIPT_ID:\s*/m).slice(1);
  const blocks = [];

  for (const rawBlock of rawBlocks) {
    if (!rawBlock.trim()) continue;
    const newlineIdx = rawBlock.indexOf('\n');
    const sceneId = (newlineIdx >= 0 ? rawBlock.slice(0, newlineIdx) : rawBlock).trim();
    if (!sceneId) {
      throw new Error('Encountered empty @@@SCRIPT_ID block');
    }

    let afterId = newlineIdx >= 0 ? rawBlock.slice(newlineIdx + 1) : '';
    let subTitleInFile = null;
    const subTitleMatch = afterId.match(/^@@@SUB_TITLE:\s*([^\n]*)\n?/i);
    if (subTitleMatch) {
      subTitleInFile = subTitleMatch[1].trim();
      afterId = afterId.slice(subTitleMatch[0].length);
    }

    // 블록 끝의 구분용 빈 줄만 제거하고 본문 내부 줄은 그대로 보존한다 (1.2).
    const bodyText = afterId.replace(/\n+$/, '');
    const bodyLines = bodyText.length > 0 ? bodyText.split('\n') : [];
    const rawFullBlock = `@@@SCRIPT_ID: ${rawBlock.replace(/\n+$/, '')}`;

    blocks.push({
      scene_id: sceneId,
      sub_title_in_file: subTitleInFile,
      body_text: bodyText,
      body_lines: bodyLines,
      body_bytes: Buffer.byteLength(bodyText, 'utf8'),
      raw_bytes: Buffer.byteLength(rawFullBlock, 'utf8'),
      source_sha256: sha256(bodyText),
    });
  }

  return blocks;
};

/**
 * 본문 각 줄 앞에 [L0001] 형식의 줄 번호를 붙인 원문을 만든다 (1.5).
 */
export const buildNumberedScript = (bodyLines) => (
  bodyLines
    .map((line, index) => `[L${String(index + 1).padStart(4, '0')}] ${line}`)
    .join('\n')
);

/**
 * 일반 대사 줄에서 화자 라벨과 대사 텍스트를 판별한다 (1.2).
 * 메신저 블록 외부 줄에만 사용한다.
 */
export const parseDialogueLine = (rawLine, options = {}) => {
  const trimmed = String(rawLine ?? '').trim();
  if (!trimmed) return null;

  // 제어 태그 줄 제외
  if (/^\[(?:SCENE\s+(?:START|END)|CHOICE_START|CHOICE_END|CHOICE_PROMPT|OPTION(?:\s|_END)|NEXT_SUBCHAPTER_BUTTON|NEXT_ROUTE|NEXT_TARGET|MESSENGER_START|MESSENGER_END|MSG(?:\s|_END)|IMAGE:|STICKER:)/i.test(trimmed)) {
    return null;
  }

  // 괄호 지문 (예: "(화면: 점검 중)") 제외
  if (/^\(.*\)$/.test(trimmed)) return null;

  // 별표 강조 제거 (*[시스템 : ...]* 등)
  const plain = trimmed.replace(/^\*{1,3}(.+?)\*{1,3}$/, '$1').trim();

  // 줄 전체가 단일 대괄호로 감싸진 공지/상태 태그 (예: "[시스템 : ...]", "[주의 : ...]") 제외
  // 단, "[블랙로즈] : 대사"나 "[파피용] [오후 1:31] 대사"는 화자 대사이므로 유지한다.
  if (/^\[[^\[\]]*:[^\[\]]*\]$/.test(plain)) return null;
  if (/^\[[^\[\]]+\]\s*\[[^\[\]]+\]\s*\[[^\[\]]+\]$/.test(plain)) return null;

  // 시각/비율/날짜 표기 줄 제외
  if (/^(?:(?:다음날\s*)?(?:오전|오후|AM|PM)|현재\s*시각|평일\s*\/|휴대폰에 뜬 숫자가|입력\s*XX년)\s*[\d?]/i.test(plain)) {
    return null;
  }
  if (/^\d{1,2}\s*:\s*\d{2}(?:\D|$)/.test(plain) || /^[^:]*\d+\s*:\s*\d+\s*(?:로|사이즈|비율)/.test(plain)) {
    return null;
  }

  // 문서 목록 기호로 시작하는 줄 제외 (예: "- 모집기간 : ...", "*대상자 자격 : ...")
  if (/^[-*]/.test(plain)) return null;

  // 1) 타임스탬프 채팅 형식: [파피용] [오후 1:31] 대사
  const timestampedChat = plain.match(
    /^\[([^\[\]]+)\]\s*\[(?:(?:오전|오후|AM|PM)\s*)?[\d?]{1,2}\s*:\s*[\d?]{2}(?::[\d?]{2})?\]\s*(.+)$/i
  );
  if (timestampedChat) {
    const speaker = timestampedChat[1].trim();
    const text = timestampedChat[2].trim();
    if (isValidSpeakerLabel(speaker, text, options)) {
      return { speaker, text, is_unknown: speaker === '???' };
    }
  }

  // 2) 캐릭터[ACTION]: 대사 (예: "제이드[ACTION]: 구조를 요청한다") vs 엔딩 카드 ("Over Zone [ACTION]: END")
  const actionMatch = plain.match(/^([^\[\]:]+)\[ACTION\]:\s*(.+)$/i);
  if (actionMatch) {
    const candidateSpeaker = actionMatch[1].trim();
    const rhs = actionMatch[2].trim();
    if (!isEndCardLine(candidateSpeaker, rhs, options.title) && isValidSpeakerLabel(candidateSpeaker, rhs, options)) {
      return { speaker: candidateSpeaker, text: rhs, is_unknown: candidateSpeaker === '???' };
    }
    return null;
  }

  // 3) 일반 대사: 화자: 대사 (줄 처음부터 첫 :까지가 화자 라벨, 단 [닉네임] : 대사 허용)
  const colonMatch = plain.match(/^(\[[^\[\]:]+\]|[^:\[\]]+?)\s*:\s*(.*)$/);
  if (!colonMatch) return null;

  const speaker = colonMatch[1].trim();
  const text = colonMatch[2].trim();

  if (isEndCardLine(speaker, text, options.title)) {
    return null;
  }

  if (!isValidSpeakerLabel(speaker, text, options)) {
    return null;
  }

  return {
    speaker,
    text,
    is_unknown: speaker === '???',
  };
};

const isEndCardLine = (speakerLabel, rhsText, storyTitle) => {
  if (!rhsText) return false;
  if (/^(?:END|AND|BEGIN|TO BE CONTINUED|THE END|COMPLETE|FALL|DASH|CONTINUED|REWRITE)\b[.·…?!\s]*$/i.test(rhsText)) {
    if (/^[A-Z0-9\s.,!'"■?-]+$/i.test(speakerLabel)) return true;
    if (storyTitle) {
      const normLabel = speakerLabel.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const normTitle = String(storyTitle).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      if (normLabel === normTitle || normTitle.startsWith(normLabel) || normLabel.endsWith(normTitle)) {
        return true;
      }
    }
  }
  if (/^(?:Privaty|Arcana|Hidden)\s+(?:Normal|True|Real)?\s*Ending/i.test(rhsText) && /^2X2 LOVE$/i.test(speakerLabel)) {
    return true;
  }
  return false;
};

export const isValidSpeakerLabel = (rawSpeaker, rhsText = '', _options = {}) => {
  const label = String(rawSpeaker ?? '').normalize('NFKC').trim();
  if (!label || label.length >= 40) return false;
  const unwrapped = label.replace(/^\[([^\[\]]+)\]$/, '$1').trim();
  if (!unwrapped || /[\[\]]/.test(unwrapped)) return false;

  const upper = unwrapped.toUpperCase().replace(/\.$/, '');
  if (NARRATION_LABELS.has(upper) || NARRATION_LABELS.has(unwrapped)) return false;
  if (DOCUMENT_FIELD_LABELS.has(unwrapped)) return false;

  // 순수 숫자로만 된 라벨(예: "1: ...")은 번호 매기기이므로 제외 (단, #000000, N102 등은 허용)
  if (/^\d+$/.test(unwrapped)) return false;

  // 문장형 줄(마침표로 끝나는 긴 구절) 제외
  if (unwrapped.length > 20 && unwrapped.endsWith('.')) return false;

  return true;
};

/**
 * 장면 본문(bodyLines)에서 기계적 사실(1.5 mechanical_ground_truth)을 추출한다.
 */
export const extractSceneMechanicalGroundTruth = (scene, options = {}) => {
  const { scene_id: sceneId, body_lines: bodyLines } = scene;
  const speakerLookup = options.speakerLookup ?? null;

  // speaker_label -> { sources: Set, line_count, first_line }
  const speakerMap = new Map();
  const ensureSpeaker = (label, sourceType, lineNo, incrementDialogue = false) => {
    const clean = String(label ?? '').trim();
    if (!clean) return;
    if (!speakerMap.has(clean)) {
      speakerMap.set(clean, {
        speaker_label: clean,
        sources: new Set(),
        line_count: 0,
        first_line: lineNo,
      });
    }
    const entry = speakerMap.get(clean);
    entry.sources.add(sourceType);
    if (incrementDialogue) {
      entry.line_count += 1;
    }
    if (lineNo < entry.first_line) {
      entry.first_line = lineNo;
    }
  };

  const unknowns = [];
  const lineSpeaker = {};
  const rawChoiceTags = [];
  const choiceBlocks = [];
  const choiceStack = [];
  const nextRoutes = [];

  let inMessengerBlock = 0;
  let inMessageBubble = false;
  let currentMessengerSender = null;
  let currentMessengerIsSystem = false;
  const messengerStack = [];

  for (let idx = 0; idx < bodyLines.length; idx++) {
    const lineNo = idx + 1;
    const rawLine = bodyLines[idx];
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    // 1. 원문 줄이 공백 포함 "???:" 로 시작하는지 검사 (1.5.b & 2.4: grep -cE '^\s*\?\?\?:' 와 정확히 일치)
    if (/^\s*\?\?\?:/.test(rawLine)) {
      const unkId = `unk_${sceneId}_L${String(lineNo).padStart(4, '0')}`;
      const unkText = trimmed.slice(4).trim();
      unknowns.push({
        unknown_id: unkId,
        line: lineNo,
        text: unkText,
      });
    }

    // 2. 선택지 및 라우트 태그 추출 (메신저 안/밖 공통)
    const choiceStartMatch = trimmed.match(/^\[CHOICE_START(?:\s+ID="([^"]+)")?\]$/i);
    if (choiceStartMatch) {
      const choiceId = choiceStartMatch[1] ? choiceStartMatch[1].trim() : null;
      rawChoiceTags.push({
        tag: 'CHOICE_START',
        line: lineNo,
        choice_id: choiceId,
        in_messenger: inMessengerBlock > 0,
      });
      const block = {
        choice_line: lineNo,
        end_line: null,
        choice_id: choiceId,
        in_messenger: inMessengerBlock > 0,
        options: [],
        _currentOpt: null,
      };
      choiceBlocks.push(block);
      choiceStack.push(block);
      continue;
    }

    const optionMatch = trimmed.match(/^\[OPTION\s+TEXT="(.+?)"(?:\s+VALUE="([^"\]]+)"?)?\]$/i);
    if (optionMatch) {
      const optionText = optionMatch[1];
      const optionValue = optionMatch[2] ? optionMatch[2].trim() : null;
      rawChoiceTags.push({
        tag: 'OPTION',
        line: lineNo,
        option_text: optionText,
        option_value: optionValue,
        in_messenger: inMessengerBlock > 0,
      });
      if (choiceStack.length > 0) {
        const topChoice = choiceStack[choiceStack.length - 1];
        const optObj = {
          line: lineNo,
          end_line: null,
          option_text: optionText,
          option_value: optionValue,
          body_line_count: 0,
        };
        topChoice.options.push(optObj);
        topChoice._currentOpt = optObj;
      }
      // 1.5 (e): [OPTION TEXT="..."] 줄의 화자는 지휘관이다 (메신저 안의 선택지도 동일, 출처 option)
      ensureSpeaker('지휘관', 'option', lineNo, true);
      lineSpeaker[lineNo] = '지휘관';
      continue;
    }

    if (/^\[OPTION_END\]$/i.test(trimmed)) {
      rawChoiceTags.push({
        tag: 'OPTION_END',
        line: lineNo,
        in_messenger: inMessengerBlock > 0,
      });
      if (choiceStack.length > 0 && choiceStack[choiceStack.length - 1]._currentOpt) {
        choiceStack[choiceStack.length - 1]._currentOpt.end_line = lineNo;
        choiceStack[choiceStack.length - 1]._currentOpt = null;
      }
      continue;
    }

    if (/^\[CHOICE_END\]$/i.test(trimmed)) {
      rawChoiceTags.push({
        tag: 'CHOICE_END',
        line: lineNo,
        in_messenger: inMessengerBlock > 0,
      });
      if (choiceStack.length > 0) {
        const finished = choiceStack.pop();
        finished.end_line = lineNo;
        delete finished._currentOpt;
        if (choiceStack.length > 0 && choiceStack[choiceStack.length - 1]._currentOpt) {
          choiceStack[choiceStack.length - 1]._currentOpt.body_line_count += 1;
        }
      }
      continue;
    }

    const nextRouteIfMatch = trimmed.match(
      /^\[NEXT_ROUTE\s+IF_CHOICE="([^"]+)"\s+OPTION="([^"]+)"\s+TARGET="([^"]+)"\]$/i
    );
    if (nextRouteIfMatch) {
      const routeEntry = {
        line: lineNo,
        if_choice: nextRouteIfMatch[1].trim(),
        option: nextRouteIfMatch[2].trim(),
        target: nextRouteIfMatch[3].trim(),
        is_default: false,
      };
      nextRoutes.push(routeEntry);
      rawChoiceTags.push({
        tag: 'NEXT_ROUTE',
        ...routeEntry,
      });
      continue;
    }

    const nextRouteDefaultMatch = trimmed.match(/^\[NEXT_ROUTE\s+DEFAULT\s+TARGET="([^"]+)"\]$/i);
    if (nextRouteDefaultMatch) {
      const routeEntry = {
        line: lineNo,
        if_choice: null,
        option: null,
        target: nextRouteDefaultMatch[1].trim(),
        is_default: true,
      };
      nextRoutes.push(routeEntry);
      rawChoiceTags.push({
        tag: 'NEXT_ROUTE',
        ...routeEntry,
      });
      continue;
    }

    // 선택지 내부 줄 수 카운트
    if (choiceStack.length > 0 && choiceStack[choiceStack.length - 1]._currentOpt) {
      choiceStack[choiceStack.length - 1]._currentOpt.body_line_count += 1;
    }

    // 3. 메신저 블록 처리 (1.2: 메시지 본문 줄은 화자: 대사 정규식으로 해석하지 않음)
    const messengerStartMatch = trimmed.match(
      /^\[MESSENGER_START(?:\s+TITLE="([^"]*)")?(?:\s+PARTICIPANTS="([^"]*)")?\]$/i
    );
    if (messengerStartMatch) {
      inMessengerBlock += 1;
      const participantsRaw = messengerStartMatch[2];
      if (participantsRaw) {
        const participants = participantsRaw
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of participants) {
          if (!NARRATION_LABELS.has(p.toUpperCase())) {
            ensureSpeaker(p, 'messenger_participant', lineNo, false);
          }
        }
      }
      continue;
    }

    if (/^\[MESSENGER_END\]$/i.test(trimmed)) {
      inMessengerBlock = Math.max(0, inMessengerBlock - 1);
      if (inMessengerBlock === 0) {
        messengerStack.length = 0;
        inMessageBubble = false;
        currentMessengerSender = null;
        currentMessengerIsSystem = false;
      }
      continue;
    }

    if (inMessengerBlock > 0) {
      const msgStartMatch = trimmed.match(
        /^\[MSG\s+SENDER="([^"]*)"(?:\s+IS_SENDER="(true|false)")?(?:\s+IS_SYSTEM="(true|false)")?\]$/i
      );
      if (msgStartMatch) {
        if (inMessageBubble) {
          messengerStack.push({
            sender: currentMessengerSender,
            isSystem: currentMessengerIsSystem,
          });
        }
        inMessageBubble = true;
        const sender = msgStartMatch[1].trim();
        const isSysAttr = msgStartMatch[3]?.toLowerCase() === 'true';
        const isSysLabel = NARRATION_LABELS.has(sender.toUpperCase());
        currentMessengerSender = sender || null;
        currentMessengerIsSystem = isSysAttr || isSysLabel;
        if (currentMessengerSender && !currentMessengerIsSystem) {
          ensureSpeaker(currentMessengerSender, 'messenger_sender', lineNo, false);
          lineSpeaker[lineNo] = currentMessengerSender;
        }
        continue;
      }

      if (/^\[MSG_END\]$/i.test(trimmed)) {
        const prev = messengerStack.pop();
        inMessageBubble = Boolean(prev);
        currentMessengerSender = prev?.sender ?? null;
        currentMessengerIsSystem = prev?.isSystem ?? false;
        continue;
      }

      if (inMessageBubble) {
        if (/^\[(?:SCENE\s|NEXT_SUBCHAPTER_BUTTON|IMAGE:|STICKER:)/i.test(trimmed)) {
          continue;
        }
        if (currentMessengerSender && !currentMessengerIsSystem) {
          ensureSpeaker(currentMessengerSender, 'messenger_sender', lineNo, true);
          lineSpeaker[lineNo] = currentMessengerSender;
        }
      }
      continue;
    }

    // 4. 일반 대사 줄 처리 (메신저 블록 외부)
    const parsedDialogue = parseDialogueLine(rawLine, {
      categoryKey: scene.category,
      title: scene.title,
    });
    if (parsedDialogue) {
      ensureSpeaker(parsedDialogue.speaker, 'dialogue', lineNo, true);
      lineSpeaker[lineNo] = parsedDialogue.speaker;
    } else if (/^\s*\?\?\?:/.test(rawLine)) {
      // 대사 내용이 비어 있는 "???:" 줄이라도 미상 화자로 기록
      ensureSpeaker('???', 'dialogue', lineNo, true);
      lineSpeaker[lineNo] = '???';
    }
  }

  // 닫히지 않은 choiceStack 정리
  for (const leftover of choiceStack) {
    delete leftover._currentOpt;
  }

  const formattedChoiceBlocks = choiceBlocks.map((block) => {
    const isBranching =
      block.options.length >= 2 ||
      Boolean(block.choice_id) ||
      block.options.some((opt) => opt.body_line_count > 0);
    return {
      choice_line: block.choice_line,
      end_line: block.end_line,
      choice_id: block.choice_id,
      in_messenger: block.in_messenger,
      is_branching: isBranching,
      options: block.options,
    };
  });

  const speakersList = [...speakerMap.values()].map((entry) => {
    const lookup = speakerLookup ? speakerLookup[entry.speaker_label] : null;
    return {
      speaker_label: entry.speaker_label,
      sources: [...entry.sources],
      dialogue_line_count: entry.line_count,
      first_line: entry.first_line,
      // 1.6: 묘사형 화자는 descriptor_speakers 작성 대상이다 (2.3의 4항)
      is_descriptor_alias: lookup?.role_category === 'descriptor_alias',
      ...(lookup
        ? {
            suggested_entity_id: lookup.entity_id,
            is_generic_role: lookup.is_generic_role,
          }
        : {}),
    };
  });

  return {
    speakers: speakersList,
    unknowns,
    choices: {
      choice_blocks: formattedChoiceBlocks,
      next_routes: nextRoutes,
    },
    route: {
      is_branch_point: nextRoutes.some((r) => !r.is_default),
      next_routes: nextRoutes,
      incoming_routes: [],
      parallel_scene_ids: [],
    },
    line_speaker: lineSpeaker,
  };
};

/**
 * 장면의 묘사형 화자 라벨 목록 (정렬). 장면 재사용 기준의 일부다 (8절 1단계).
 */
export const descriptorLabelsOf = (mgt) =>
  (mgt?.speakers ?? [])
    .filter((s) => s && typeof s === 'object' && s.is_descriptor_alias === true)
    .map((s) => s.speaker_label)
    .sort();

/**
 * progress.json 기본 형태: 배치 요약(batches)과 본 실행 장면 단위 상태(scenes) (6절, 8절 1단계).
 */
export const emptyProgressDoc = () => ({
  schema_version: PASS1_SCHEMA_VERSION,
  updated_at: new Date().toISOString(),
  scenes: {},
  batches: {},
});

/**
 * 장면을 다시 추출하지 않아도 되는지 판정한다 (8절 1단계):
 * 본문 해시, 추출 스키마 버전, 묘사형 화자 라벨 목록이 모두 같고 이미 병합된 장면만 재사용한다.
 */
export const isSceneReusable = (progressEntry, scene) =>
  Boolean(progressEntry) &&
  progressEntry.status === 'merged' &&
  progressEntry.source_sha256 === scene.source_sha256 &&
  progressEntry.extraction_schema_version === PASS1_SCHEMA_VERSION &&
  JSON.stringify(progressEntry.descriptor_labels ?? []) ===
    JSON.stringify(descriptorLabelsOf(scene.mechanical_ground_truth));

/**
 * line_speaker 맵에서 줄 번호의 화자를 읽는다 (JSON 키는 문자열, 메모리 객체는 숫자일 수 있음).
 */
export const lineSpeakerAt = (mgt, line) => {
  const map = mgt?.line_speaker ?? {};
  return map[String(line)] ?? map[line] ?? null;
};

/**
 * is_branching 선택지 블록의 옵션 범위 목록 (2.3의 12항: [OPTION TEXT] 줄부터 [OPTION_END] 줄까지).
 */
export const getBranchingOptionRanges = (mgt) => {
  const ranges = [];
  for (const block of mgt?.choices?.choice_blocks ?? []) {
    if (!block.is_branching) continue;
    for (const opt of block.options ?? []) {
      const start = opt.line;
      const end = opt.end_line ?? block.end_line ?? start;
      ranges.push({ choice_line: block.choice_line, option_text: opt.option_text, start, end });
    }
  }
  return ranges;
};

const rangeContains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;

/**
 * 줄 범위가 닿는 분기 옵션을 판정한다 (2.3의 12항, 3절 4항).
 * - 서로 겹치지 않는 옵션 둘 이상에 닿으면 ok: false (양립할 수 없는 갈래)
 * - 중첩 선택지처럼 한 옵션이 다른 옵션을 감싸면 가장 안쪽 옵션 소속
 * - 옵션 하나와 공통 줄에 걸치면 그 옵션 소속
 */
export const resolveBranchOption = (optionRanges, lineStart, lineEnd) => {
  const touched = optionRanges.filter((r) => lineStart <= r.end && lineEnd >= r.start);
  for (let i = 0; i < touched.length; i++) {
    for (let j = i + 1; j < touched.length; j++) {
      if (!rangeContains(touched[i], touched[j]) && !rangeContains(touched[j], touched[i])) {
        return { ok: false, option: null, touched };
      }
    }
  }
  if (touched.length === 0) {
    return { ok: true, option: null, touched };
  }
  const innermost = touched.reduce((best, r) => (r.end - r.start < best.end - best.start ? r : best));
  return {
    ok: true,
    option: { choice_line: innermost.choice_line, option_text: innermost.option_text },
    touched,
  };
};

/**
 * 장면 시점과 chronology_segments로 한 줄의 연출 시점을 구한다 (3절 2항: 구간 밖은 present).
 */
export const chronologyAtLine = (sceneChronology, segments, line) => {
  if (sceneChronology !== 'mixed') return sceneChronology;
  const seg = (segments ?? []).find((s) => line >= s.line_start && line <= s.line_end);
  return seg ? seg.chronology_type : 'present';
};

/**
 * 줄 범위 안에 나타나는 연출 시점 집합 (2.3의 13항 경계 검사용).
 */
export const chronologiesInRange = (sceneChronology, segments, lineStart, lineEnd) => {
  const found = new Set();
  for (let line = lineStart; line <= lineEnd; line++) {
    found.add(chronologyAtLine(sceneChronology, segments, line));
  }
  return found;
};

/**
 * 전체 장면 배열에 대해 1.3의 NEXT_ROUTE 분기 정보(나가는 루트, 들어오는 루트, 병렬 장면)를 계산해 연결한다.
 * 부제 끝의 [A]/[B]는 순서대로 이어지는 파트이므로 병렬 갈래로 판별하지 않는다 (1.3 & 1.5.d).
 */
export const computeCorpusRoutes = (scenes) => {
  const sceneById = new Map(scenes.map((s) => [s.scene_id, s]));

  // 장면 간 루트: NEXT_ROUTE IF_CHOICE=... TARGET=... (1.3)
  // 같은 (scene_id, if_choice)에서 갈라진 TARGET 장면들은 서로 병렬 갈래다.
  for (const scene of scenes) {
    const nextRoutes = scene.mechanical_ground_truth.route.next_routes;
    const byChoice = new Map();

    for (const route of nextRoutes) {
      if (!route.is_default && route.if_choice) {
        if (!byChoice.has(route.if_choice)) {
          byChoice.set(route.if_choice, []);
        }
        byChoice.get(route.if_choice).push(route);
      } else {
        const targetScene = sceneById.get(route.target);
        if (targetScene) {
          targetScene.mechanical_ground_truth.route.incoming_routes.push({
            from_scene_id: scene.scene_id,
            choice_id: null,
            option: null,
            is_default: true,
            parallel_scene_ids: [],
          });
        }
      }
    }

    for (const [choiceId, routesForChoice] of byChoice.entries()) {
      const allTargets = [...new Set(routesForChoice.map((r) => r.target))];
      for (const route of routesForChoice) {
        const targetScene = sceneById.get(route.target);
        if (!targetScene) continue;
        const parallelTargets = allTargets.filter((t) => t !== route.target);
        targetScene.mechanical_ground_truth.route.incoming_routes.push({
          from_scene_id: scene.scene_id,
          choice_id: choiceId,
          option: route.option,
          is_default: false,
          parallel_scene_ids: parallelTargets,
        });
      }
    }
  }

  // parallel_scene_ids 통합 (오직 NEXT_ROUTE 분기만 반영)
  for (const scene of scenes) {
    const routeObj = scene.mechanical_ground_truth.route;
    const parallelSet = new Set();
    for (const inc of routeObj.incoming_routes) {
      for (const pid of inc.parallel_scene_ids) {
        parallelSet.add(pid);
      }
    }
    routeObj.parallel_scene_ids = [...parallelSet];
  }
};
