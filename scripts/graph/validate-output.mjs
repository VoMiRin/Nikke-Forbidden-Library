import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_DATA_DIR, normalizeWhitespaceOnly } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

export const SCENE_CHRONOLOGY_ENUM = new Set([
  'present',
  'flashback',
  'dream',
  'hypothetical',
  'mixed',
]);

export const EVENT_CHRONOLOGY_ENUM = new Set([
  'present',
  'flashback',
  'dream',
  'hypothetical',
]);

export const REMOTE_MEDIUM_ENUM = new Set([
  'comm',
  'recording',
  'messenger',
  'memory_voice',
  'other',
]);

export const MENTIONED_ENTITY_TYPE_ENUM = new Set([
  'character',
  'squad',
  'organization',
  'faction_or_species',
  'location',
  'concept',
  'item',
  'event',
]);

export const CONFIDENCE_ENUM = new Set([
  '확인된 사실',
  '유력한 해석',
  '가능성',
  '판단 보류',
]);

export const INTERPRETATION_CONFIDENCE_ENUM = new Set([
  '유력한 해석',
  '가능성',
  '판단 보류',
]);

export const EPISTEMIC_TYPE_ENUM = new Set([
  'established_event',
  'character_claim',
  'interpretation',
]);

export const CLUE_CATEGORY_ENUM = new Set([
  'item',
  'code_or_number',
  'past_incident',
  'foreshadowing',
  'lore_concept',
  'location',
  'organization',
]);

export const UNREGISTERED_ENTITY_TYPE_ENUM = new Set([
  'character',
  'alias',
  'squad',
  'organization',
  'location',
  'concept',
  'item',
]);

export const FORBIDDEN_SCENE_FIELDS = [
  'title_id',
  'category',
  'source_file',
  'source_sha256',
  'route',
  'mechanical_validated',
  'item_id',
];

export const REQUIRED_SCENE_FIELDS = [
  'scene_id',
  'chronology_type',
  'is_plot_critical',
  'summary',
  'participants',
  'forms_of_address',
  'unknown_speakers',
  'same_scene_speaker_groups',
  'cross_scene_hints',
  'choice_branches',
  'events_and_claims',
  'clues_and_hooks',
  'relationship_and_lore_notes',
  'unregistered_entity_candidates',
];

export const REQUIRED_PARTICIPANT_ARRAY_KEYS = [
  'present_in_scene',
  'present_silent',
  'remote_or_voice_only',
  'mentioned_only',
];

/**
 * numbered_script("[L0001] 원문줄")에서 줄 번호 프리픽스를 제거해 1-indexed 원문 줄 배열을 복원한다.
 */
export const extractRawLinesFromNumberedScript = (numberedScript) => {
  if (typeof numberedScript !== 'string' || !numberedScript.length) {
    return [];
  }
  return numberedScript
    .split('\n')
    .map((line) => line.replace(/^\[L\d+\]\s?/, ''));
};

const isNonEmptyString = (val) => typeof val === 'string' && val.trim().length > 0;
const isNullableString = (val) => val === null || typeof val === 'string';
const isPositiveInt = (val) => Number.isInteger(val) && val >= 1;

/**
 * 원문 한 줄에서 화자: 라벨과 제어 태그를 뗀 순수 대사/문장 텍스트를 추출한다 (2.3.4).
 */
export const extractUtteranceTextFromRawLine = (rawLine) => {
  const trimmed = String(rawLine ?? '').trim();
  if (!trimmed) return '';

  // [OPTION TEXT="..."] 줄은 선택지 대사 텍스트를 반환
  const optMatch = trimmed.match(/^\[OPTION\s+TEXT="(.+?)"(?:\s+VALUE="([^"\]]+)"?)?\]$/i);
  if (optMatch) return optMatch[1].trim();

  // 그 외 대괄호 제어 태그는 빈 문자열로 제거
  if (
    /^\[(?:SCENE\s+(?:START|END)|CHOICE_START|CHOICE_END|CHOICE_PROMPT|OPTION_END|NEXT_SUBCHAPTER_BUTTON|NEXT_ROUTE|NEXT_TARGET|MESSENGER_START|MESSENGER_END|MSG(?:\s|_END)|IMAGE:|STICKER:)/i.test(
      trimmed
    )
  ) {
    return '';
  }

  // 타임스탬프 채팅 형식: [파피용] [오후 1:31] 대사
  const timestampedChat = trimmed.match(
    /^\[([^\[\]]+)\]\s*\[(?:(?:오전|오후|AM|PM)\s*)?[\d?]{1,2}\s*:\s*[\d?]{2}(?::[\d?]{2})?\]\s*(.+)$/i
  );
  if (timestampedChat) {
    return timestampedChat[2].trim();
  }

  // 화자[ACTION]: 대사
  const actionMatch = trimmed.match(/^([^\[\]:]+)\[ACTION\]:\s*(.+)$/i);
  if (actionMatch) {
    return actionMatch[2].trim();
  }

  // 일반 화자: 대사
  const colonMatch = trimmed.match(/^(?:\[[^\[\]:]+\]|[^:\[\]]+?)\s*:\s*(.*)$/);
  if (colonMatch) {
    return colonMatch[1].trim();
  }

  return trimmed;
};

/**
 * 인용문(quote) 쪽에서도 줄 앞의 화자: 라벨과 제어 태그를 떼어 정규화한다 (2.3.4).
 * 라벨을 붙인 줄과 뗀 줄이 섞인 인용도 통과시키기 위함이다.
 */
export const normalizeQuoteUtterance = (quote, rawSliceLines = []) => {
  const lineStripped = String(quote ?? '')
    .split(/\r?\n/)
    .map((qLine) => extractUtteranceTextFromRawLine(qLine))
    .filter((txt) => txt.length > 0)
    .join(' ');
  let normalized = normalizeWhitespaceOnly(lineStripped);

  for (const rawLine of rawSliceLines) {
    const trimmed = String(rawLine ?? '').trim();
    const utt = extractUtteranceTextFromRawLine(trimmed);
    if (utt.length > 0 && trimmed.endsWith(utt) && trimmed.length > utt.length) {
      const prefix = normalizeWhitespaceOnly(trimmed.slice(0, trimmed.length - utt.length));
      if (prefix.length > 0) {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        normalized = normalizeWhitespaceOnly(
          normalized.replace(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ')
        );
      }
    }
  }
  return normalized;
};


/**
 * 단일 배치 샤드 JSON을 해당 배치 입력 데이터(batchInput)와 대조해 2.3의 8가지 규칙을 모두 검증한다.
 */
export const validateShard = (shardData, batchInput) => {
  const errors = [];
  const warnings = [];

  const addError = (rule, sceneId, fieldPath, message) => {
    errors.push({ rule, scene_id: sceneId ?? null, path: fieldPath, message });
  };

  const addWarning = (rule, sceneId, fieldPath, message) => {
    warnings.push({ rule, scene_id: sceneId ?? null, path: fieldPath, message });
  };

  // Top-level schema check
  if (!shardData || typeof shardData !== 'object' || Array.isArray(shardData)) {
    addError('SCHEMA_VALIDATION', null, '$', 'Shard root must be a JSON object');
    return { valid: false, errors, warnings };
  }

  if (shardData.schema_version !== '1.2.0') {
    addError(
      'SCHEMA_VALIDATION',
      null,
      '$.schema_version',
      `Expected schema_version "1.2.0", got ${JSON.stringify(shardData.schema_version)}`
    );
  }

  if (!isNonEmptyString(shardData.batch_id)) {
    addError('SCHEMA_VALIDATION', null, '$.batch_id', 'batch_id must be a non-empty string');
  } else if (batchInput?.batch_id && shardData.batch_id !== batchInput.batch_id) {
    addError(
      'SCHEMA_VALIDATION',
      null,
      '$.batch_id',
      `batch_id mismatch: expected "${batchInput.batch_id}", got "${shardData.batch_id}"`
    );
  }

  for (const forbidden of FORBIDDEN_SCENE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(shardData, forbidden)) {
      addWarning(
        'FORBIDDEN_MODEL_FIELD',
        null,
        `$.${forbidden}`,
        `Forbidden field "${forbidden}" at root will be ignored by merger`
      );
    }
  }

  if (!Array.isArray(shardData.scenes)) {
    addError('SCHEMA_VALIDATION', null, '$.scenes', 'scenes must be an array');
    return { valid: false, errors, warnings };
  }

  const expectedScenesById = new Map(
    (batchInput?.scenes ?? []).map((s) => [s.scene_id, s])
  );

  // 1. 장면 완전성 검사 (SCENE_COMPLETENESS)
  const seenSceneIds = new Set();
  for (let i = 0; i < shardData.scenes.length; i++) {
    const scene = shardData.scenes[i];
    const sid = scene?.scene_id;
    if (!isNonEmptyString(sid)) {
      addError('SCHEMA_VALIDATION', null, `$.scenes[${i}].scene_id`, 'scene_id must be a non-empty string');
      continue;
    }
    if (seenSceneIds.has(sid)) {
      addError('SCENE_COMPLETENESS', sid, `$.scenes[${i}].scene_id`, `Duplicate scene_id "${sid}" in shard`);
    }
    seenSceneIds.add(sid);
    if (!expectedScenesById.has(sid)) {
      addError(
        'SCENE_COMPLETENESS',
        sid,
        `$.scenes[${i}].scene_id`,
        `Unexpected scene_id "${sid}" is not part of batch "${batchInput?.batch_id}"`
      );
    }
  }

  for (const expectedSid of expectedScenesById.keys()) {
    if (!seenSceneIds.has(expectedSid)) {
      addError(
        'SCENE_COMPLETENESS',
        expectedSid,
        '$.scenes',
        `Missing required scene_id "${expectedSid}" from batch "${batchInput?.batch_id}"`
      );
    }
  }

  // 각 장면 상세 검증
  for (let sIdx = 0; sIdx < shardData.scenes.length; sIdx++) {
    const scene = shardData.scenes[sIdx];
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      addError('SCHEMA_VALIDATION', null, `$.scenes[${sIdx}]`, 'Scene entry must be an object');
      continue;
    }

    const sid = scene.scene_id;
    const sceneBasePath = `$.scenes[${sIdx}]`;

    // 8. 모델이 쓰면 안 되는 필드 경고 (FORBIDDEN_MODEL_FIELD)
    for (const forbidden of FORBIDDEN_SCENE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(scene, forbidden)) {
        addWarning(
          'FORBIDDEN_MODEL_FIELD',
          sid,
          `${sceneBasePath}.${forbidden}`,
          `Forbidden model field "${forbidden}" present on scene "${sid}"; will be ignored and overwritten by merger`
        );
      }
    }

    // 7. 스키마 필수 필드 존재 검사 (SCHEMA_VALIDATION)
    for (const reqField of REQUIRED_SCENE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(scene, reqField) || scene[reqField] === undefined) {
        addError(
          'SCHEMA_VALIDATION',
          sid,
          `${sceneBasePath}.${reqField}`,
          `Missing required field "${reqField}" in scene "${sid}"`
        );
      }
    }

    if (!SCENE_CHRONOLOGY_ENUM.has(scene.chronology_type)) {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.chronology_type`,
        `Invalid chronology_type ${JSON.stringify(scene.chronology_type)}`
      );
    }

    if (typeof scene.is_plot_critical !== 'boolean') {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.is_plot_critical`,
        'is_plot_critical must be a boolean'
      );
    }

    if (!isNonEmptyString(scene.summary)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.summary`, 'summary must be a non-empty string');
    }

    const gtScene = expectedScenesById.get(sid);
    if (!gtScene) {
      continue;
    }

    const rawLines = Array.isArray(gtScene.body_lines)
      ? gtScene.body_lines
      : extractRawLinesFromNumberedScript(gtScene.numbered_script);
    const totalLines = rawLines.length;
    const mgt = gtScene.mechanical_ground_truth ?? {};

    // 화자 집합 구성
    const validSpeakers = new Set(
      (mgt.speakers ?? []).map((spk) =>
        typeof spk === 'string' ? spk : spk.speaker_label
      )
    );

    const isShortQuoteAllowed = (normQuote, normFullLineOrSlice, normUtteranceOnly) => {
      if (normQuote.length >= 4) return true;
      if (normFullLineOrSlice.length > 0 && normFullLineOrSlice.length < 4 && normQuote === normFullLineOrSlice) {
        return true;
      }
      if (normUtteranceOnly.length > 0 && normUtteranceOnly.length < 4 && normQuote === normUtteranceOnly) {
        return true;
      }
      return false;
    };

    // 줄 범위 및 인용문 검사 헬퍼 (2.3.4)
    // 여러 줄 인용에서는 (1) 범위 원문을 그대로 이은 문자열(normSlice)과
    // (2) 각 줄에서 화자: 라벨과 제어 태그를 뗀 대사만 이은 문자열(normUtteranceSlice)을 모두 허용한다.
    const verifyQuoteInRange = (item, itemPath) => {
      if (Object.prototype.hasOwnProperty.call(item, 'item_id')) {
        addWarning(
          'FORBIDDEN_MODEL_FIELD',
          sid,
          `${itemPath}.item_id`,
          'Forbidden model field "item_id" present; will be ignored by merger'
        );
      }

      const { line_start: ls, line_end: le, quote } = item;
      if (!isPositiveInt(ls) || !isPositiveInt(le)) {
        addError(
          'SCHEMA_VALIDATION',
          sid,
          itemPath,
          `line_start (${ls}) and line_end (${le}) must be positive integers`
        );
        return false;
      }
      if (ls > le || le > totalLines) {
        addError(
          'QUOTE_LOCATION',
          sid,
          itemPath,
          `Invalid line range ${ls}~${le} (scene has ${totalLines} lines)`
        );
        return false;
      }
      if (!isNonEmptyString(quote)) {
        addError('SCHEMA_VALIDATION', sid, `${itemPath}.quote`, 'quote must be a non-empty string');
        return false;
      }

      const normQuote = normalizeWhitespaceOnly(quote);
      const rawSliceLines = rawLines.slice(ls - 1, le);
      const normSlice = normalizeWhitespaceOnly(rawSliceLines.join(' '));
      const normUtteranceSlice = normalizeWhitespaceOnly(
        rawSliceLines
          .map(extractUtteranceTextFromRawLine)
          .filter((txt) => txt.length > 0)
          .join(' ')
      );
      const normQuoteUtterance = normalizeQuoteUtterance(quote, rawSliceLines);

      const matchesRawSlice = normSlice.includes(normQuote);
      const matchesUtteranceSlice =
        normUtteranceSlice.includes(normQuote) ||
        (normQuoteUtterance.length > 0 && normUtteranceSlice.includes(normQuoteUtterance));

      if (!matchesRawSlice && !matchesUtteranceSlice) {
        addError(
          'QUOTE_LOCATION',
          sid,
          `${itemPath}.quote`,
          `Quote "${normQuote}" not found within lines ${ls}~${le} of scene "${sid}"`
        );
        return false;
      }

      const effectiveQuoteForLength =
        normQuoteUtterance.length > 0 && normQuoteUtterance.length < normQuote.length
          ? normQuoteUtterance
          : normQuote;

      if (!isShortQuoteAllowed(effectiveQuoteForLength, normSlice, normUtteranceSlice)) {
        addError(
          'QUOTE_LOCATION',
          sid,
          `${itemPath}.quote`,
          `Quote "${normQuote}" is shorter than 4 chars (${effectiveQuoteForLength.length} chars) while the range utterance is ${normUtteranceSlice.length} chars`
        );
        return false;
      }

      return true;
    };

    // participants 검증
    if (!scene.participants || typeof scene.participants !== 'object' || Array.isArray(scene.participants)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.participants`, 'participants must be an object');
    } else {
      for (const pKey of REQUIRED_PARTICIPANT_ARRAY_KEYS) {
        if (!Array.isArray(scene.participants[pKey])) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${sceneBasePath}.participants.${pKey}`,
            `participants.${pKey} must be an array`
          );
        }
      }

      // document_author (3.2 & 4절: 화자 없는 문서·일기 장면에서만 쓰고 그 외에는 null)
      if (!Object.prototype.hasOwnProperty.call(scene.participants, 'document_author')) {
        addError(
          'SCHEMA_VALIDATION',
          sid,
          `${sceneBasePath}.participants.document_author`,
          'participants.document_author is required (object or null)'
        );
      } else if (scene.participants.document_author !== null) {
        const da = scene.participants.document_author;
        const daPath = `${sceneBasePath}.participants.document_author`;
        if (!da || typeof da !== 'object' || Array.isArray(da)) {
          addError('SCHEMA_VALIDATION', sid, daPath, 'document_author must be null or an object');
        } else {
          if (!isNonEmptyString(da.name)) {
            addError('SCHEMA_VALIDATION', sid, `${daPath}.name`, 'document_author.name must be a non-empty string');
          }
          if (!isNullableString(da.entity_id)) {
            addError('SCHEMA_VALIDATION', sid, `${daPath}.entity_id`, 'document_author.entity_id must be string or null');
          }
        }
      }

      const presentSpeakerLabels = new Set();

      // present_in_scene (2.3.2 화자 실존 + 3.2 ??? 제외 + 스키마)
      if (Array.isArray(scene.participants.present_in_scene)) {
        scene.participants.present_in_scene.forEach((p, idx) => {
          const pPath = `${sceneBasePath}.participants.present_in_scene[${idx}]`;
          if (!p || typeof p !== 'object') {
            addError('SCHEMA_VALIDATION', sid, pPath, 'Item must be an object');
            return;
          }
          if (Object.prototype.hasOwnProperty.call(p, 'item_id')) {
            addWarning('FORBIDDEN_MODEL_FIELD', sid, `${pPath}.item_id`, 'item_id is forbidden in model output');
          }
          if (!isNonEmptyString(p.speaker_label)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.speaker_label`, 'speaker_label is required');
          } else {
            presentSpeakerLabels.add(p.speaker_label);
            if (p.speaker_label === '???') {
              addError(
                'SPEAKER_EXISTENCE',
                sid,
                `${pPath}.speaker_label`,
                '"???" must not be placed in present_in_scene (record in unknown_speakers only, 3.2)'
              );
            } else if (!validSpeakers.has(p.speaker_label)) {
              addError(
                'SPEAKER_EXISTENCE',
                sid,
                `${pPath}.speaker_label`,
                `Speaker "${p.speaker_label}" in present_in_scene does not exist in mechanical_ground_truth.speakers`
              );
            }
          }
          if (!isNullableString(p.entity_id)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.entity_id`, 'entity_id must be string or null');
          }
          if (typeof p.is_generic_role !== 'boolean') {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.is_generic_role`, 'is_generic_role must be boolean');
          }
        });
      }

      // present_silent
      if (Array.isArray(scene.participants.present_silent)) {
        scene.participants.present_silent.forEach((p, idx) => {
          const pPath = `${sceneBasePath}.participants.present_silent[${idx}]`;
          if (!p || typeof p !== 'object') {
            addError('SCHEMA_VALIDATION', sid, pPath, 'Item must be an object');
            return;
          }
          if (!isNonEmptyString(p.name)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.name`, 'name is required');
          }
          if (!isNullableString(p.entity_id)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.entity_id`, 'entity_id must be string or null');
          }
          verifyQuoteInRange(p, pPath);
        });
      }

      // remote_or_voice_only (2.3.2 화자 실존 + 3.2 한 인물은 한 갈래에만 + 2.3.4 인용 위치 + 스키마)
      if (Array.isArray(scene.participants.remote_or_voice_only)) {
        scene.participants.remote_or_voice_only.forEach((p, idx) => {
          const pPath = `${sceneBasePath}.participants.remote_or_voice_only[${idx}]`;
          if (!p || typeof p !== 'object') {
            addError('SCHEMA_VALIDATION', sid, pPath, 'Item must be an object');
            return;
          }
          if (!isNonEmptyString(p.speaker_label)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.speaker_label`, 'speaker_label is required');
          } else {
            if (!validSpeakers.has(p.speaker_label)) {
              addError(
                'SPEAKER_EXISTENCE',
                sid,
                `${pPath}.speaker_label`,
                `Speaker "${p.speaker_label}" in remote_or_voice_only does not exist in mechanical_ground_truth.speakers`
              );
            }
            if (presentSpeakerLabels.has(p.speaker_label)) {
              addError(
                'PARTICIPANT_BRANCH_EXCLUSIVITY',
                sid,
                `${pPath}.speaker_label`,
                `Speaker "${p.speaker_label}" is already in present_in_scene; a character must appear in only one participant branch per scene (3.2)`
              );
            }
          }
          if (!isNullableString(p.entity_id)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.entity_id`, 'entity_id must be string or null');
          }
          if (!REMOTE_MEDIUM_ENUM.has(p.medium)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.medium`, `Invalid medium ${JSON.stringify(p.medium)}`);
          }
          verifyQuoteInRange(p, pPath);
        });
      }

      // mentioned_only (2.3.6-1 언급 표기 + 2.3.4 인용 위치 + 스키마)
      if (Array.isArray(scene.participants.mentioned_only)) {
        scene.participants.mentioned_only.forEach((p, idx) => {
          const pPath = `${sceneBasePath}.participants.mentioned_only[${idx}]`;
          if (!p || typeof p !== 'object') {
            addError('SCHEMA_VALIDATION', sid, pPath, 'Item must be an object');
            return;
          }
          if (!isNonEmptyString(p.surface_text)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.surface_text`, 'surface_text is required');
          }
          if (!isNullableString(p.entity_id)) {
            addError('SCHEMA_VALIDATION', sid, `${pPath}.entity_id`, 'entity_id must be string or null');
          }
          if (!MENTIONED_ENTITY_TYPE_ENUM.has(p.entity_type)) {
            addError(
              'SCHEMA_VALIDATION',
              sid,
              `${pPath}.entity_type`,
              `Invalid entity_type ${JSON.stringify(p.entity_type)}`
            );
          }
          verifyQuoteInRange(p, pPath);
          if (isNonEmptyString(p.surface_text) && isNonEmptyString(p.quote)) {
            const normSurface = normalizeWhitespaceOnly(p.surface_text);
            const normQuote = normalizeWhitespaceOnly(p.quote);
            if (!normQuote.includes(normSurface)) {
              addError(
                'MENTIONED_SURFACE_TEXT',
                sid,
                `${pPath}.surface_text`,
                `surface_text "${normSurface}" is not contained within quote "${normQuote}"`
              );
            }
          }
        });
      }
    }

    // 5. 호칭 검증 (FORMS_OF_ADDRESS)
    if (!Array.isArray(scene.forms_of_address)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.forms_of_address`, 'forms_of_address must be an array');
    } else {
      const lineSpeakerMap = mgt.line_speaker ?? {};
      scene.forms_of_address.forEach((fa, idx) => {
        const faPath = `${sceneBasePath}.forms_of_address[${idx}]`;
        if (!fa || typeof fa !== 'object') {
          addError('SCHEMA_VALIDATION', sid, faPath, 'Item must be an object');
          return;
        }
        if (!isNonEmptyString(fa.from_speaker)) {
          addError('SCHEMA_VALIDATION', sid, `${faPath}.from_speaker`, 'from_speaker is required');
        }
        if (!isNonEmptyString(fa.to_target)) {
          addError('SCHEMA_VALIDATION', sid, `${faPath}.to_target`, 'to_target is required');
        }
        if (!isNonEmptyString(fa.address_term)) {
          addError('SCHEMA_VALIDATION', sid, `${faPath}.address_term`, 'address_term is required');
        }

        verifyQuoteInRange(fa, faPath);

        if (isPositiveInt(fa.line_start)) {
          const actualSpeaker = lineSpeakerMap[String(fa.line_start)] ?? lineSpeakerMap[fa.line_start];
          if (!actualSpeaker || actualSpeaker !== fa.from_speaker) {
            addError(
              'FORMS_OF_ADDRESS',
              sid,
              `${faPath}.from_speaker`,
              `from_speaker "${fa.from_speaker}" does not match line_speaker "${actualSpeaker ?? 'none'}" at line_start ${fa.line_start}`
            );
          }
        }

        if (isNonEmptyString(fa.address_term) && isNonEmptyString(fa.quote)) {
          const normTerm = normalizeWhitespaceOnly(fa.address_term);
          const normQuote = normalizeWhitespaceOnly(fa.quote);
          if (!normQuote.includes(normTerm)) {
            addError(
              'FORMS_OF_ADDRESS',
              sid,
              `${faPath}.address_term`,
              `address_term "${normTerm}" is not contained within quote "${normQuote}"`
            );
          }
        }
      });
    }

    // 3. ??? 완전성 검증 (UNKNOWN_SPEAKER_COMPLETENESS) + 4. ??? 줄 내 인용 검사
    const expectedUnknownsById = new Map(
      (mgt.unknowns ?? []).map((u) => [u.unknown_id, u])
    );

    if (!Array.isArray(scene.unknown_speakers)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.unknown_speakers`, 'unknown_speakers must be an array');
    } else {
      const seenUnknownIds = new Set();

      scene.unknown_speakers.forEach((unk, idx) => {
        const uPath = `${sceneBasePath}.unknown_speakers[${idx}]`;
        if (!unk || typeof unk !== 'object') {
          addError('SCHEMA_VALIDATION', sid, uPath, 'Item must be an object');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(unk, 'item_id')) {
          addWarning('FORBIDDEN_MODEL_FIELD', sid, `${uPath}.item_id`, 'item_id is forbidden in model output');
        }

        const uid = unk.unknown_id;
        if (!isNonEmptyString(uid)) {
          addError('SCHEMA_VALIDATION', sid, `${uPath}.unknown_id`, 'unknown_id must be a non-empty string');
          return;
        }
        if (seenUnknownIds.has(uid)) {
          addError(
            'UNKNOWN_SPEAKER_COMPLETENESS',
            sid,
            `${uPath}.unknown_id`,
            `Duplicate unknown_id "${uid}" in scene "${sid}"`
          );
        }
        seenUnknownIds.add(uid);

        const gtUnk = expectedUnknownsById.get(uid);
        if (!gtUnk) {
          addError(
            'UNKNOWN_SPEAKER_COMPLETENESS',
            sid,
            `${uPath}.unknown_id`,
            `Unknown speaker ID "${uid}" does not exist in mechanical_ground_truth.unknowns`
          );
        } else {
          // 2.3.4: unknown_speakers[].quote는 그 ??? 줄 안에 있어야 하며 최소 길이 규칙을 만족해야 한다
          if (!isNonEmptyString(unk.quote)) {
            addError('SCHEMA_VALIDATION', sid, `${uPath}.quote`, 'quote must be a non-empty string');
          } else {
            const rawUnkLine = rawLines[gtUnk.line - 1] ?? '';
            const normUnkLine = normalizeWhitespaceOnly(rawUnkLine);
            const normUnkUtterance = normalizeWhitespaceOnly(
              gtUnk.text ?? extractUtteranceTextFromRawLine(rawUnkLine)
            );
            const normUnkQuote = normalizeWhitespaceOnly(unk.quote);
            const normUnkQuoteUtterance = normalizeQuoteUtterance(unk.quote, [rawUnkLine]);
            const unkMatches =
              normUnkLine.includes(normUnkQuote) ||
              normUnkUtterance.includes(normUnkQuote) ||
              (normUnkQuoteUtterance.length > 0 && normUnkUtterance.includes(normUnkQuoteUtterance));
            const effectiveUnkQuote =
              normUnkQuoteUtterance.length > 0 && normUnkQuoteUtterance.length < normUnkQuote.length
                ? normUnkQuoteUtterance
                : normUnkQuote;
            if (!unkMatches) {
              addError(
                'QUOTE_LOCATION',
                sid,
                `${uPath}.quote`,
                `unknown_speakers quote "${normUnkQuote}" is not inside its ??? line L${String(gtUnk.line).padStart(4, '0')} ("${normUnkLine}")`
              );
            } else if (!isShortQuoteAllowed(effectiveUnkQuote, normUnkLine, normUnkUtterance)) {
              addError(
                'QUOTE_LOCATION',
                sid,
                `${uPath}.quote`,
                `unknown_speakers quote "${normUnkQuote}" is shorter than 4 chars (${effectiveUnkQuote.length} chars) while the ??? utterance is ${normUnkUtterance.length} chars`
              );
            }
          }
        }

        if (!isNonEmptyString(unk.speaking_style)) {
          addError('SCHEMA_VALIDATION', sid, `${uPath}.speaking_style`, 'speaking_style must be a non-empty string');
        }
        if (!isNullableString(unk.target_addressed)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${uPath}.target_addressed`,
            'target_addressed must be string or null'
          );
        }
        if (!Array.isArray(unk.contextual_clues) || !unk.contextual_clues.every((c) => typeof c === 'string')) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${uPath}.contextual_clues`,
            'contextual_clues must be an array of strings'
          );
        }

        if (unk.resolved_in_same_scene_to !== null) {
          const res = unk.resolved_in_same_scene_to;
          if (!res || typeof res !== 'object' || Array.isArray(res)) {
            addError(
              'SCHEMA_VALIDATION',
              sid,
              `${uPath}.resolved_in_same_scene_to`,
              'resolved_in_same_scene_to must be null or an object'
            );
          } else {
            if (!isNonEmptyString(res.entity_id)) {
              addError(
                'SCHEMA_VALIDATION',
                sid,
                `${uPath}.resolved_in_same_scene_to.entity_id`,
                'entity_id must be a non-empty string'
              );
            }
            verifyQuoteInRange(res, `${uPath}.resolved_in_same_scene_to`);
          }
        }
      });

      for (const expectedUid of expectedUnknownsById.keys()) {
        if (!seenUnknownIds.has(expectedUid)) {
          addError(
            'UNKNOWN_SPEAKER_COMPLETENESS',
            sid,
            `${sceneBasePath}.unknown_speakers`,
            `Missing required unknown_id "${expectedUid}" in scene "${sid}"`
          );
        }
      }
    }

    // same_scene_speaker_groups 검증 (3.3 & 4절)
    if (!Array.isArray(scene.same_scene_speaker_groups)) {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.same_scene_speaker_groups`,
        'same_scene_speaker_groups must be an array'
      );
    } else {
      const seenInGroups = new Set();
      scene.same_scene_speaker_groups.forEach((grp, idx) => {
        const gPath = `${sceneBasePath}.same_scene_speaker_groups[${idx}]`;
        if (!grp || typeof grp !== 'object' || Array.isArray(grp)) {
          addError('SCHEMA_VALIDATION', sid, gPath, 'Item must be an object');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(grp, 'item_id')) {
          addWarning('FORBIDDEN_MODEL_FIELD', sid, `${gPath}.item_id`, 'item_id is forbidden in model output');
        }
        if (!Array.isArray(grp.unknown_ids) || grp.unknown_ids.length < 2) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${gPath}.unknown_ids`,
            'unknown_ids must be an array of at least 2 unknown_ids (single ??? lines must not be grouped)'
          );
        } else {
          grp.unknown_ids.forEach((uid, uIdx) => {
            if (!isNonEmptyString(uid) || !expectedUnknownsById.has(uid)) {
              addError(
                'SCHEMA_VALIDATION',
                sid,
                `${gPath}.unknown_ids[${uIdx}]`,
                `Invalid unknown_id "${uid}" in same_scene_speaker_groups (not found in scene unknowns)`
              );
            } else if (seenInGroups.has(uid)) {
              addError(
                'SCHEMA_VALIDATION',
                sid,
                `${gPath}.unknown_ids[${uIdx}]`,
                `unknown_id "${uid}" belongs to multiple groups or is duplicated (each unknown_id may belong to at most one group)`
              );
            } else {
              seenInGroups.add(uid);
            }
          });
        }
        if (!CONFIDENCE_ENUM.has(grp.confidence)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${gPath}.confidence`,
            `Invalid confidence ${JSON.stringify(grp.confidence)}`
          );
        }
        if (!isNonEmptyString(grp.reason)) {
          addError('SCHEMA_VALIDATION', sid, `${gPath}.reason`, 'reason must be a non-empty string');
        }
      });
    }

    // cross_scene_hints 검증 (3.3 & 4절)
    if (!Array.isArray(scene.cross_scene_hints)) {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.cross_scene_hints`,
        'cross_scene_hints must be an array'
      );
    } else {
      scene.cross_scene_hints.forEach((hint, idx) => {
        const hPath = `${sceneBasePath}.cross_scene_hints[${idx}]`;
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) {
          addError('SCHEMA_VALIDATION', sid, hPath, 'Item must be an object');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(hint, 'item_id')) {
          addWarning('FORBIDDEN_MODEL_FIELD', sid, `${hPath}.item_id`, 'item_id is forbidden in model output');
        }
        if (!isNonEmptyString(hint.text)) {
          addError('SCHEMA_VALIDATION', sid, `${hPath}.text`, 'text must be a non-empty string');
        }
        if (
          !Array.isArray(hint.related_scene_ids) ||
          !hint.related_scene_ids.every((id) => isNonEmptyString(id))
        ) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${hPath}.related_scene_ids`,
            'related_scene_ids must be an array of non-empty strings'
          );
        }
      });
    }

    // 6. 선택지 검증 (CHOICE_BRANCHES: 3.4절에 따라 is_branching: true 블록만 기록)
    const gtChoiceBlocks = mgt.choices?.choice_blocks ?? [];
    const gtChoiceByLine = new Map(gtChoiceBlocks.map((cb) => [cb.choice_line, cb]));
    const allSceneOptionTexts = new Set(
      gtChoiceBlocks.flatMap((cb) => cb.options.map((o) => o.option_text))
    );

    if (!Array.isArray(scene.choice_branches)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.choice_branches`, 'choice_branches must be an array');
    } else {
      scene.choice_branches.forEach((cb, idx) => {
        const cbPath = `${sceneBasePath}.choice_branches[${idx}]`;
        if (!cb || typeof cb !== 'object') {
          addError('SCHEMA_VALIDATION', sid, cbPath, 'Item must be an object');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(cb, 'item_id')) {
          addWarning('FORBIDDEN_MODEL_FIELD', sid, `${cbPath}.item_id`, 'item_id is forbidden in model output');
        }
        if (!isPositiveInt(cb.choice_line)) {
          addError('SCHEMA_VALIDATION', sid, `${cbPath}.choice_line`, 'choice_line must be a positive integer');
        }
        if (!Array.isArray(cb.options) || cb.options.length === 0) {
          addError('SCHEMA_VALIDATION', sid, `${cbPath}.options`, 'options must be a non-empty array');
          return;
        }

        const matchedGtBlock = gtChoiceByLine.get(cb.choice_line);
        const validOptionTextsForBlock = matchedGtBlock
          ? new Set(matchedGtBlock.options.map((o) => o.option_text))
          : allSceneOptionTexts;

        if (!matchedGtBlock && gtChoiceBlocks.length > 0 && !gtChoiceByLine.has(cb.choice_line)) {
          addError(
            'CHOICE_BRANCHES',
            sid,
            `${cbPath}.choice_line`,
            `choice_line ${cb.choice_line} does not match any CHOICE_START line in scene "${sid}"`
          );
        } else if (matchedGtBlock && matchedGtBlock.is_branching === false) {
          addError(
            'CHOICE_BRANCHES',
            sid,
            `${cbPath}.choice_line`,
            `choice_line ${cb.choice_line} has is_branching=false (single choice with no branch body); only is_branching=true blocks may be recorded in choice_branches (3.4)`
          );
        }

        cb.options.forEach((opt, oIdx) => {
          const oPath = `${cbPath}.options[${oIdx}]`;
          if (!opt || typeof opt !== 'object') {
            addError('SCHEMA_VALIDATION', sid, oPath, 'Option must be an object');
            return;
          }
          if (typeof opt.option_text !== 'string' || !opt.option_text.length) {
            addError('SCHEMA_VALIDATION', sid, `${oPath}.option_text`, 'option_text must be a non-empty string');
          } else if (!validOptionTextsForBlock.has(opt.option_text)) {
            addError(
              'CHOICE_BRANCHES',
              sid,
              `${oPath}.option_text`,
              `option_text ${JSON.stringify(opt.option_text)} does not exactly match original OPTION TEXT`
            );
          }
          if (typeof opt.continuation_summary !== 'string') {
            addError(
              'SCHEMA_VALIDATION',
              sid,
              `${oPath}.continuation_summary`,
              'continuation_summary must be a string'
            );
          }
          if (
            !Array.isArray(opt.branch_specific_facts) ||
            !opt.branch_specific_facts.every((f) => typeof f === 'string')
          ) {
            addError(
              'SCHEMA_VALIDATION',
              sid,
              `${oPath}.branch_specific_facts`,
              'branch_specific_facts must be an array of strings'
            );
          }
        });
      });
    }

    // events_and_claims 검증
    if (!Array.isArray(scene.events_and_claims)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.events_and_claims`, 'events_and_claims must be an array');
    } else {
      scene.events_and_claims.forEach((ev, idx) => {
        const evPath = `${sceneBasePath}.events_and_claims[${idx}]`;
        if (!ev || typeof ev !== 'object') {
          addError('SCHEMA_VALIDATION', sid, evPath, 'Item must be an object');
          return;
        }
        if (!EPISTEMIC_TYPE_ENUM.has(ev.epistemic_type)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${evPath}.epistemic_type`,
            `Invalid epistemic_type ${JSON.stringify(ev.epistemic_type)}`
          );
        }
        if (!EVENT_CHRONOLOGY_ENUM.has(ev.chronology_type)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${evPath}.chronology_type`,
            `Invalid event chronology_type ${JSON.stringify(ev.chronology_type)} (mixed is not allowed on events)`
          );
        }
        if (ev.epistemic_type === 'interpretation') {
          if (!INTERPRETATION_CONFIDENCE_ENUM.has(ev.confidence)) {
            addError(
              'SCHEMA_VALIDATION',
              sid,
              `${evPath}.confidence`,
              `interpretation requires confidence in [유력한 해석, 가능성, 판단 보류], got ${JSON.stringify(ev.confidence)}`
            );
          }
        } else if (
          ev.confidence !== undefined &&
          ev.confidence !== null &&
          !CONFIDENCE_ENUM.has(ev.confidence)
        ) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${evPath}.confidence`,
            `Invalid confidence ${JSON.stringify(ev.confidence)}`
          );
        }
        if (!isNonEmptyString(ev.actor_or_speaker)) {
          addError('SCHEMA_VALIDATION', sid, `${evPath}.actor_or_speaker`, 'actor_or_speaker is required');
        }
        if (!isNonEmptyString(ev.summary)) {
          addError('SCHEMA_VALIDATION', sid, `${evPath}.summary`, 'summary is required');
        }
        if (typeof ev.branch_specific !== 'boolean') {
          addError('SCHEMA_VALIDATION', sid, `${evPath}.branch_specific`, 'branch_specific must be boolean');
        }
        if (!isNullableString(ev.branch_option_text)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${evPath}.branch_option_text`,
            'branch_option_text must be string or null'
          );
        }
        if (ev.branch_specific === true && !isNonEmptyString(ev.branch_option_text)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${evPath}.branch_option_text`,
            'branch_option_text is required when branch_specific is true'
          );
        }
        if (typeof ev.refers_to_past !== 'boolean') {
          addError('SCHEMA_VALIDATION', sid, `${evPath}.refers_to_past`, 'refers_to_past must be boolean');
        }
        verifyQuoteInRange(ev, evPath);
      });
    }

    // clues_and_hooks 검증
    if (!Array.isArray(scene.clues_and_hooks)) {
      addError('SCHEMA_VALIDATION', sid, `${sceneBasePath}.clues_and_hooks`, 'clues_and_hooks must be an array');
    } else {
      scene.clues_and_hooks.forEach((clue, idx) => {
        const cPath = `${sceneBasePath}.clues_and_hooks[${idx}]`;
        if (!clue || typeof clue !== 'object') {
          addError('SCHEMA_VALIDATION', sid, cPath, 'Item must be an object');
          return;
        }
        if (!isNonEmptyString(clue.keyword)) {
          addError('SCHEMA_VALIDATION', sid, `${cPath}.keyword`, 'keyword is required');
        }
        if (!CLUE_CATEGORY_ENUM.has(clue.category)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${cPath}.category`,
            `Invalid clue category ${JSON.stringify(clue.category)}`
          );
        }
        if (!isNonEmptyString(clue.detail)) {
          addError('SCHEMA_VALIDATION', sid, `${cPath}.detail`, 'detail is required');
        }
        verifyQuoteInRange(clue, cPath);
      });
    }

    // relationship_and_lore_notes 검증
    if (!Array.isArray(scene.relationship_and_lore_notes)) {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.relationship_and_lore_notes`,
        'relationship_and_lore_notes must be an array'
      );
    } else {
      scene.relationship_and_lore_notes.forEach((rel, idx) => {
        const rPath = `${sceneBasePath}.relationship_and_lore_notes[${idx}]`;
        if (!rel || typeof rel !== 'object') {
          addError('SCHEMA_VALIDATION', sid, rPath, 'Item must be an object');
          return;
        }
        if (!isNonEmptyString(rel.subject)) {
          addError('SCHEMA_VALIDATION', sid, `${rPath}.subject`, 'subject is required');
        }
        if (!isNonEmptyString(rel.target)) {
          addError('SCHEMA_VALIDATION', sid, `${rPath}.target`, 'target is required');
        }
        if (!isNonEmptyString(rel.relation_or_change)) {
          addError('SCHEMA_VALIDATION', sid, `${rPath}.relation_or_change`, 'relation_or_change is required');
        }
        verifyQuoteInRange(rel, rPath);
      });
    }

    // unregistered_entity_candidates 검증
    if (!Array.isArray(scene.unregistered_entity_candidates)) {
      addError(
        'SCHEMA_VALIDATION',
        sid,
        `${sceneBasePath}.unregistered_entity_candidates`,
        'unregistered_entity_candidates must be an array'
      );
    } else {
      scene.unregistered_entity_candidates.forEach((cand, idx) => {
        const uPath = `${sceneBasePath}.unregistered_entity_candidates[${idx}]`;
        if (!cand || typeof cand !== 'object') {
          addError('SCHEMA_VALIDATION', sid, uPath, 'Item must be an object');
          return;
        }
        if (Object.prototype.hasOwnProperty.call(cand, 'item_id')) {
          addWarning('FORBIDDEN_MODEL_FIELD', sid, `${uPath}.item_id`, 'item_id is forbidden in model output');
        }
        if (!isNonEmptyString(cand.surface_text)) {
          addError('SCHEMA_VALIDATION', sid, `${uPath}.surface_text`, 'surface_text is required');
        }
        if (!UNREGISTERED_ENTITY_TYPE_ENUM.has(cand.suggested_type)) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${uPath}.suggested_type`,
            `Invalid suggested_type ${JSON.stringify(cand.suggested_type)}`
          );
        }
        if (!isPositiveInt(cand.line_start) || cand.line_start > totalLines) {
          addError(
            'SCHEMA_VALIDATION',
            sid,
            `${uPath}.line_start`,
            `Invalid line_start ${cand.line_start} (scene has ${totalLines} lines)`
          );
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * CLI 실행: 샤드 파일 경로 또는 배치 ID를 받아 검증한다.
 * 하나라도 실패하면 Exit Code 1을 반환한다 (2.3).
 */
export const validateShardFile = async (shardArg, options = {}) => {
  const graphDir = options.graphDir ?? GRAPH_DATA_DIR;
  let shardPath = shardArg;

  if (!shardArg.endsWith('.json') && !fsSync.existsSync(shardArg)) {
    shardPath = path.join(graphDir, 'pass1', 'shards', `${shardArg}.json`);
  } else {
    shardPath = path.resolve(shardArg);
  }

  const shardRaw = await fs.readFile(shardPath, 'utf8');
  const shardData = JSON.parse(shardRaw);

  const batchId = shardData.batch_id || path.basename(shardPath, '.json');
  const batchInputPath =
    options.batchInputPath ?? path.join(graphDir, 'pass1', 'batches', `${batchId}.json`);

  if (!fsSync.existsSync(batchInputPath)) {
    throw new Error(`Batch input file not found for validation: ${batchInputPath}`);
  }

  const batchInput = JSON.parse(await fs.readFile(batchInputPath, 'utf8'));
  const result = validateShard(shardData, batchInput);

  return {
    shardPath,
    batchInputPath,
    batchId,
    ...result,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/graph/validate-output.mjs <shard-json-path-or-batch-id>');
    process.exit(1);
  }

  validateShardFile(target)
    .then((res) => {
      if (res.warnings.length > 0) {
        for (const w of res.warnings) {
          console.warn(`[WARN][${w.rule}] (${w.scene_id ?? 'batch'}) ${w.path}: ${w.message}`);
        }
      }
      if (!res.valid) {
        console.error(
          `[FAIL] ${res.batchId}: ${res.errors.length} validation error(s) found (${res.warnings.length} warning(s)).`
        );
        for (const err of res.errors) {
          console.error(`  - [${err.rule}] (${err.scene_id ?? 'batch'}) ${err.path}: ${err.message}`);
        }
        process.exit(1);
      }
      console.log(
        `[PASS] ${res.batchId}: mechanical validation succeeded (${res.warnings.length} warning(s)).`
      );
    })
    .catch((err) => {
      console.error('[validate-output] Fatal error:', err.message || err);
      process.exit(1);
    });
}
