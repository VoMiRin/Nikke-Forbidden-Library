import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_DATA_DIR,
  SCRIPTS_ROOT_DIR,
  loadNewScriptsData,
  parseChapterTextBlocks,
  extractSceneMechanicalGroundTruth,
  writeJsonAtomic,
  sha256,
  PASS1_SCHEMA_VERSION,
} from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);

const GENERIC_EXACT_LABELS = new Set([
  '???',
  '??',
  '?',
  '알 수 없음',
  'A',
  'B',
  'C',
  'ㅇㅇ',
  '사람들',
  '군중',
  '패닉한 군중',
  '부부',
  '모두',
  '일동',
  '전원',
  '홀로그램',
  '하위 홀로그램',
  '무전기',
  '광고',
  '강아지',
  '고양이',
  '대장 고양이',
  '곰인형',
  '인형',
  '안드로이드',
  '보구자',
  '협력자',
  '수집용 로봇',
  '안내 방송',
  '중앙 정부 특임대',
  '미실리스 연구팀',
  '펭군 부대',
  '나루 부대',
  '붉은 덤불의 보스',
  '화재 전문가',
]);

const GENERIC_ROLE_NOUN_RE =
  /(?:병사|연구원|양산형\s*니케|시민|주민|여자주민|남자주민|남자|여자|남성|여성|소년|소녀|아이|남자아이|여자아이|어린이|학생|여학생|남학생|신입생|선생|여선생|선생님|교수|교관|손님|점원|직원|종업원|웨이트리스|바리스타|기자|카메라맨|촬영\s*기사|촬영\s*스탭|스태프|스탭|심사위원|사회자|아나운서|앵커|방송인|게스트|가수|배우|여배우|영화\s*주인공|매니저|감독|경비원|경호원|경찰|형사|죄수|간부|임원|조직원|부하|대원|부대원|요원|팀원|회원|신도|교도|여사제|사제|의사|간호사|수리공|미케닉|선원|승무원|노숙자|난민|방주난민|귀빈|재력가|통신병|장교|소대장|팀장|리더|지배인|원장|할머니|할아버지|아버지|어머니|오퍼레이터|안내원|접수원|비서|사장|주인|타겟|소리|효과음|스피커|스태츄|관중|관객|방청객|관광객|승객|꼬마|남편|동료|친구|후보생|훈련생|훈련병|중독자|장수|팬|치어리더|개발자|관계자|인형|올빼미)(?:\s*[A-Z0-9\d호]+|\s*\d+)?$/;

const NAMED_CHARACTER_EXCEPTIONS = new Set([
  '지휘관',
  '리틀 머메이드',
  '스노우 화이트',
  '레드 후드',
  '레드 슈즈',
  '솔져 E.G.',
  '솔져 F.A.',
  '솔져 O.W.',
  '프로덕트 08',
  '프로덕트 12',
  '프로덕트 23',
  '아이돌 썬',
  '아이돌 오션',
  '아이돌 플라워',
  '거울 공주',
  '어린 슈엔',
  '어린 노아',
  '어린 노라',
  '중년 헤르민',
  '젊은 헤르민',
]);

const BARE_DEMOGRAPHIC_OR_ORG_RE =
  /^(?:양산형|남자|여자|남성|여성|젊은|중년|노인|어린|중앙\s*정부|인류연합군|아우터\s*림|아우터림|방주|엘리시온|미실리스|테트라|V\.T\.C\.|M\.M\.R\.|세이메이카이|모란회|포그\s*할로우|엔터\s*헤븐|사관학교|생산\s*라인|물자\s*분류|운송\s*담당|지상\s*탐색|정찰\s*부대|도반\s*부대|운영\s*본부(?:\s*남자|\s*여자)?|현장|응급\s*요원|치어리더|여자\s*치어리더|남자\s*손님|여자\s*손님|경비|뉴스|사탕|극장|담당|스쿼드|코인\s*러시|미트\s*미트|주인|고아원|클럽|역사|가게|거래소|옷가게|단골|선임|전임|신입)\s*(?:병사|연구원|양산형\s*니케|니케|시민|주민|여자주민|남자주민|피난민|난민|남자|여자|남성|여성|소년|소녀|아이|남자아이|여자아이|학생|여학생|남학생|선생|여선생|선생님|교수|교관|손님|점원|직원|스태프|스탭|아나운서|앵커|기자|의사|간호사|경비원|경호원|팀장|장교|소대장|간부|임원|조직원|여사제|사제|미케닉|부대원|목소리|배우|가수|수리공|감독|관계자|형사|리더|사장|할머니|원장|지배인|주인|장수|통신병|관객|팬|교도|중독자|지휘관)?(?:\s*[A-Z0-9\d호]+)?$/;

const DESCRIPTOR_CLAUSE_RE =
  /(?:보이는|덮은|입은|쓴|든|맨|찬|탄|낀|묶은|두른|닮은|흉내낸|불린|인상의|머리의|얼굴의|표정의|체격의|수수께끼의|익숙한|또 다른 익숙한)/;

const isDescriptorAliasLabel = (label, dialogueLineCount = 0) => {
  if (!label.includes(' ')) return false;
  if (/(?:소리|효과음|스피커|스태츄|타겟)$/.test(label)) return false;
  if (BARE_DEMOGRAPHIC_OR_ORG_RE.test(label)) return false;
  if (DESCRIPTOR_CLAUSE_RE.test(label)) return true;
  if (dialogueLineCount >= 10) return true;
  return false;
};

/**
 * 화자 표기가 일반 역할 명사(또는 미상 화자, 묘사형 별칭)인지 휴리스틱으로 판별한다 (1.6).
 */
export const classifyGenericRole = (
  speakerLabel,
  knownNamedSet = new Set(),
  dialogueLineCount = 0
) => {
  const label = String(speakerLabel ?? '').normalize('NFKC').trim();

  if (/^\?+$/.test(label) || label === '알 수 없음') {
    return {
      is_generic_role: true,
      category: 'unknown_placeholder',
      reason: '미상 화자 표기',
    };
  }

  if (knownNamedSet.has(label) || NAMED_CHARACTER_EXCEPTIONS.has(label)) {
    return {
      is_generic_role: false,
      category: null,
      reason: null,
    };
  }

  if (GENERIC_EXACT_LABELS.has(label)) {
    return {
      is_generic_role: true,
      category: 'generic_role_or_device',
      reason: '일반 역할·익명·장치 기본 목록 일치',
    };
  }

  if (label.endsWith('들')) {
    return {
      is_generic_role: true,
      category: 'plural_group',
      reason: '복수형 집단 명사(~들)',
    };
  }

  if (/^(?:나루|펭군|훈련생)\s*\d+호$/.test(label)) {
    return {
      is_generic_role: true,
      category: 'numbered_unit',
      reason: '번호가 붙은 일반 개체/훈련생 표기',
    };
  }

  if (GENERIC_ROLE_NOUN_RE.test(label)) {
    if (isDescriptorAliasLabel(label, dialogueLineCount)) {
      return {
        is_generic_role: true,
        category: 'descriptor_alias',
        reason: '외양·특징 묘사형 라벨 (정체가 가려진 특정 인물 후보 가능성, 1.6)',
      };
    }
    return {
      is_generic_role: true,
      category: 'generic_role_noun',
      reason: '일반 역할/직업/인물 묘사 명사로 끝남',
    };
  }

  if (/(?:(?:\s|^)니케|(?:\s|^)지휘관|(?:\s|^)목소리|(?:\s|^)메이드)(?:\s*[A-Z0-9\d호]+)?$/.test(label)) {
    if (
      /^(?:익숙한|또 다른 익숙한|녹음된|여자\s*손님의|남자\s*손님의|남자의|여자의|소녀의|소년의|아이의|노인의|낯선|의문의|차가운|다정한|기계적인)\s*목소리$/.test(
        label
      )
    ) {
      if (/^(?:익숙한|또 다른 익숙한|낯선|의문의|차가운|다정한)\s*목소리$/.test(label)) {
        return {
          is_generic_role: true,
          category: 'descriptor_alias',
          reason: '묘사형 목소리 라벨 (정체가 가려진 특정 인물 후보 가능성, 1.6)',
        };
      }
      return {
        is_generic_role: true,
        category: 'unidentified_voice',
        reason: '특정 인물이 명시되지 않은 목소리 표기',
      };
    }
    if (label.endsWith('니케') || label.endsWith('지휘관') || label.endsWith('메이드')) {
      if (isDescriptorAliasLabel(label, dialogueLineCount)) {
        return {
          is_generic_role: true,
          category: 'descriptor_alias',
          reason: '외양·특징 묘사형 라벨 (정체가 가려진 특정 인물 후보 가능성, 1.6)',
        };
      }
      return {
        is_generic_role: true,
        category: 'generic_role_noun',
        reason: '일반 니케/지휘관/메이드 역할 표기',
      };
    }
  }

  return {
    is_generic_role: false,
    category: null,
    reason: null,
  };
};

/**
 * 화자 라벨로부터 결정적이고 읽기 쉬운 entity_id를 생성한다.
 * 다른 이름으로 불린 두 화자는 대본 근거 없이 임의로 합치지 않는다 (1.6).
 */
export const makeEntityId = (speakerLabel, usedIds = new Set()) => {
  const label = String(speakerLabel ?? '').normalize('NFKC').trim();
  const isBracketed = /^\[([^\[\]]+)\]$/.test(label);
  const clean = label
    .replace(/^\[([^\[\]]+)\]$/, '$1')
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-z가-힣_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const prefix = isBracketed ? 'char_handle_' : 'char_';
  const baseId = `${prefix}${clean || sha256(label).slice(0, 8)}`;

  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  const dedupedId = `${baseId}_${sha256(label).slice(0, 6)}`;
  usedIds.add(dedupedId);
  return dedupedId;
};

/**
 * 등록된 전체 대본을 스캔하여 generic_roles.json과 entity_registry.json 데이터를 생성한다.
 */
export const buildInitialRegistry = async (options = {}) => {
  const newScriptsData = options.newScriptsData ?? loadNewScriptsData();
  const scriptsRootDir = options.scriptsRootDir ?? SCRIPTS_ROOT_DIR;

  // 니케 에피소드 및 블라블라 개인방 타이틀은 고유 캐릭터 이름으로 보장
  const knownNamedSet = new Set([
    ...newScriptsData
      .filter((s) => s.categoryKey === 'character_episodes')
      .map((s) => s.title.normalize('NFKC').trim()),
    ...newScriptsData
      .filter((s) => s.categoryKey === 'blabla' && !String(s.mainChapterFile).startsWith('group/'))
      .map((s) => s.title.normalize('NFKC').trim()),
    ...NAMED_CHARACTER_EXCEPTIONS,
  ]);

  const byFile = new Map();
  for (const script of newScriptsData) {
    const fileKey = `${script.categoryKey}/${script.mainChapterFile}`;
    if (!byFile.has(fileKey)) {
      byFile.set(fileKey, []);
    }
    byFile.get(fileKey).push(script);
  }

  // speaker_label -> stats
  const speakerStats = new Map();

  for (const [fileKey, scripts] of byFile.entries()) {
    const filePath = path.join(scriptsRootDir, fileKey);
    const rawText = await fs.readFile(filePath, 'utf8');
    const blocks = parseChapterTextBlocks(rawText);
    const blockById = new Map(blocks.map((b) => [b.scene_id, b]));

    for (const scriptMeta of scripts) {
      const block = blockById.get(scriptMeta.id);
      if (!block) continue;

      const mgt = extractSceneMechanicalGroundTruth({
        scene_id: block.scene_id,
        body_lines: block.body_lines,
        category: scriptMeta.categoryKey,
        title: scriptMeta.title,
      });

      for (const spk of mgt.speakers) {
        const label = spk.speaker_label.normalize('NFKC').trim();
        if (!speakerStats.has(label)) {
          speakerStats.set(label, {
            speaker_label: label,
            scene_count: 0,
            dialogue_line_count: 0,
            sources: new Set(),
            categories: new Set(),
            sample_scenes: [],
          });
        }
        const st = speakerStats.get(label);
        st.scene_count += 1;
        st.dialogue_line_count += spk.dialogue_line_count;
        for (const src of spk.sources) st.sources.add(src);
        st.categories.add(scriptMeta.categoryKey);
        if (st.sample_scenes.length < 5) {
          st.sample_scenes.push(scriptMeta.id);
        }
      }
    }
  }

  // 기본 일반 역할 명사가 혹시 대본 화자에 없더라도 항상 포함되도록 보장 (1.6)
  for (const baselineRole of ['???', '병사', '연구원', '양산형 니케', '시민']) {
    if (!speakerStats.has(baselineRole)) {
      speakerStats.set(baselineRole, {
        speaker_label: baselineRole,
        scene_count: 0,
        dialogue_line_count: 0,
        sources: new Set(['dialogue']),
        categories: new Set(),
        sample_scenes: [],
      });
    }
  }

  const sortedLabels = [...speakerStats.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const genericRoles = [];
  const entities = [];
  const speakerLookup = {};
  const usedEntityIds = new Set();

  for (const label of sortedLabels) {
    const st = speakerStats.get(label);
    const classification = classifyGenericRole(label, knownNamedSet, st.dialogue_line_count);

    if (classification.is_generic_role) {
      genericRoles.push({
        speaker_label: label,
        is_generic_role: true,
        entity_id: null,
        role_category: classification.category,
        heuristic_reason: classification.reason,
        scene_count: st.scene_count,
        dialogue_line_count: st.dialogue_line_count,
        sources: [...st.sources].sort(),
        categories: [...st.categories].sort(),
        sample_scenes: st.sample_scenes,
      });
      speakerLookup[label] = {
        entity_id: null,
        is_generic_role: true,
        role_category: classification.category,
      };
    } else {
      const entityId = makeEntityId(label, usedEntityIds);
      const isVoiceVariant = /\s*의\s*목소리$/.test(label);
      entities.push({
        entity_id: entityId,
        canonical_name: label,
        entity_type: 'character',
        surface_labels: [label],
        is_generic_role: false,
        is_episode_or_blabla_hero: knownNamedSet.has(label),
        is_voice_or_handle_variant: isVoiceVariant || /^\[.+\]$/.test(label),
        scene_count: st.scene_count,
        dialogue_line_count: st.dialogue_line_count,
        sources: [...st.sources].sort(),
        categories: [...st.categories].sort(),
        sample_scenes: st.sample_scenes,
      });
      speakerLookup[label] = {
        entity_id: entityId,
        is_generic_role: false,
        role_category: null,
      };
    }
  }

  const descriptorAliases = genericRoles
    .filter((r) => r.role_category === 'descriptor_alias')
    .map((r) => r.speaker_label);

  const genericRolesDoc = {
    schema_version: PASS1_SCHEMA_VERSION,
    description:
      '일반 역할 명사, 묘사형 별칭(descriptor_alias) 및 미상 화자(???) 초안. Pass 1에서는 is_generic_role: true, entity_id: null로 두며 descriptor_alias는 Pass 2 정체 후보 탐색 대상에 포함한다 (1.6).',
    total_roles: genericRoles.length,
    descriptor_alias_count: descriptorAliases.length,
    descriptor_alias_labels: descriptorAliases,
    role_labels: genericRoles.map((r) => r.speaker_label),
    roles: genericRoles,
  };

  const entityRegistryDoc = {
    schema_version: PASS1_SCHEMA_VERSION,
    description:
      '등록 대본 화자 기반 인물 정체 레지스트리 초안. 다른 이름으로 불린 두 화자의 병합은 반드시 대본 근거 검증(Pass 2/3)을 거쳐 수행한다 (1.6).',
    total_entities: entities.length,
    entities,
    speaker_lookup: speakerLookup,
  };

  return {
    genericRolesDoc,
    entityRegistryDoc,
  };
};

export const runInitRegistryCli = async (options = {}) => {
  const outDir = options.outDir ?? GRAPH_DATA_DIR;
  const { genericRolesDoc, entityRegistryDoc } = await buildInitialRegistry(options);

  const genericRolesPath = path.join(outDir, 'generic_roles.json');
  const entityRegistryPath = path.join(outDir, 'entity_registry.json');

  await writeJsonAtomic(genericRolesPath, genericRolesDoc);
  await writeJsonAtomic(entityRegistryPath, entityRegistryDoc);

  return {
    genericRolesPath,
    entityRegistryPath,
    genericRolesCount: genericRolesDoc.total_roles,
    entitiesCount: entityRegistryDoc.total_entities,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runInitRegistryCli()
    .then((res) => {
      console.log(
        `[init-registry] Generated ${res.entitiesCount} entities (${res.entityRegistryPath}) and ${res.genericRolesCount} generic roles (${res.genericRolesPath}).`
      );
    })
    .catch((err) => {
      console.error('[init-registry] Error:', err);
      process.exitCode = 1;
    });
}
