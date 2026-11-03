# GraphRAG Pass 1 보수 6회차 보고서 (2026-11-03)

## 0. 이번 범위와 미처리

- **이번 보수 범위**: [round6_findings.json](file:///home/vomirin/nikke-script-archive/data/graph/pass1/repairs/round6/round6_findings.json)에 수록된 `ark_guardian_21`([batch_0162.json](file:///home/vomirin/nikke-script-archive/data/graph/pass1/shards/batch_0162.json), 1배치 1장면)의 장면 밖 표현 지적 4건(`R5-1`~`R5-4`)과, 같은 장면의 다른 필드에 있는 같은 표현(보수자·검토자 확인 결과 `cross_scene_hints[0]` 외 추가 해당 필드 없음).
- **이번 범위 밖(미처리)**:
  - [pass1_open_issues.md](file:///home/vomirin/nikke-script-archive/data/graph/reports/pass1_open_issues.md)의 다른 미처리 지적(54절의 `ark_guardian_10`·`ether_04` 건 포함)
  - `batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 7건(과거 지휘관 라벨 → `char_엔더슨`, 보수 4회차에서 사용자 확인)
  - 6절에 기록한 보수자·검토자의 "지적과 무관하게 본 오류" 전체

---

## 1. `prepare` 출력 및 기대값 비교

### 사전 점검 (`0. 시작 전 확인`)
- `node scripts/graph/build-pass1-rules.mjs --check`: `[pass1-rules] GRAPH_RAG_PASS1_RULES.md is up to date`
- `git status --short data/graph/pass1/shards`: 빈 출력 확인(5회차 보수 샤드 커밋 후 재실행)

### `prepare` 실행 출력
```text
[repair] batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":4}
    input  data/graph/pass1/repairs/batch_0162.input.json
    output data/graph/pass1/repairs/batch_0162.output.json
[repair] job 1 (44KB): batch_0162
```

- **기대값 일치 여부**: [GRAPH_RAG_PASS1_REPAIR_ROUND6.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_REPAIR_ROUND6.md#L34-L36) 0절의 기대값(`batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":4}`, 작업 1개: job 1 `batch_0162`)과 정확히 일치함.

---

## 2. 보수 결과

- **보수 서브에이전트**: `639975e0-cb30-4b6f-980b-5a256d95f009`
- **배치 / 장면 수**: `batch_0162`, 장면 1개 (`ark_guardian_21`)
- **`check` 통과 여부**: 통과
- **재시도 횟수**: 0회
- **첫 시도 실패 규칙명별 건수**: 없음 (0건)
- **남은 경고**: `ENTITY_ID_SURFACE_MISMATCH` 1건 (`ark_guardian_21` 내)

### 지적 4건별 보수자 처리 및 이유
- **R5-1**: **고침** — `ark_guardian_21` `events_and_claims[7].summary`(L28~32)에서 장면 원문과 제목에 없는 `"새 장비 덕분에"`를 빼고 `"홍련이 몸이 가벼워 오늘의 자신은 릴리스 이상이라고 호언장담하고, 벌써 5번 이상 피격됐다는 지휘관의 말에 방어력이 두 배로 높아졌으니 2.5번 피격된 셈이라고 주장한다."`로 수정(L28~32)
- **R5-2**: **고침** — `ark_guardian_21` `events_and_claims[12].summary`(L49~52)에서 원문에 없는 `"새 장비의"`와 L52(`"이번에야말로."`) 뒤에 덧붙인 `"해낼 수 있다"`를 빼고, 앞 줄(L45~48)의 지시 대상을 풀어 `"라푼젤이 지팡이로 황금색 막을 펼쳐 미사일을 막아낸 뒤 이런 것까지 된다며 감탄하고, 마음에 드나 보다는 지휘관의 말에 그 정도가 아니라며 이 정도의 힘이라면 이번에야말로라고 말한다."`로 수정(L45~52)
- **R5-3**: **고침** — `ark_guardian_21` `events_and_claims[15].summary`(L59~61)에서 원문에 없는 `"장비를"`을 빼고 앞 줄(L58)의 지시 대상을 풀어 `"도로시가 스노우 화이트에게 자신부터 만들어 달라고 할 걸 그랬다고 아쉬워하자 지휘관이 평소에 친하게 지내지 그랬냐고 농담하고, 도로시는 친밀도로 우선순위가 정해지지 않았다는 것 정도는 안다고 답한다."`로 수정(L58~61)
- **R5-4**: **고침** — `ark_guardian_21` `clues_and_hooks[0].keyword`(L14~17)에서 원문에 없는 판정 `"릴리바이스의 신체 이상"`을 원문 표현인 `"얼굴에서 흐르는 미지근한 액체"`로 수정(L14~17)

### 지적 목록에 없지만 같은 표현이라 함께 고친 필드
- 없음

---

## 3. 독립 검토 결과 (적용 전 후보 대상)

- **독립 검토 서브에이전트**: `dfc0ff45-1b53-44d6-8eae-ba6ab85bba13`
- **검토 대상**: `ark_guardian_21` (`batch_0162`)

### 지적 4건 판정 표

| id | 판정 |
| --- | --- |
| R5-1 | 해결됨 |
| R5-2 | 해결됨 |
| R5-3 | 해결됨 |
| R5-4 | 해결됨 |

### 유형별 건수 표

| 구분 | 건수 | 비고 |
| --- | ---: | --- |
| 1. 보수 지적 사항 해결 | 4건 | 전체 4건 중 4건 해결됨 (미해결 0건) |
| 2. 새로 만들거나 고친 항목의 오류 | 0건 | 다른 필드에 `장비`·`신체 이상` 잔존 없음 (`cross_scene_hints` 제외) |
| 3. 보수하면서 잃은 것 | 0건 | - |
| 4. 보수와 무관하게 남아 있는 오류 (별도 집계) | 4건 | `present_in_scene[0]`, `events_and_claims[1]`, `[11]`, `[14]` |

### 지적 사항별 검토 상세 사례
1. **R5-1 (`events_and_claims[7].summary`, L28~32) — 해결됨**
   - 원문 인용: `[L0028] 지휘관: 홍련. 어때?` / `[L0029] 홍련: 말할 것도 없네. 이렇게나 몸이 가벼워다니, 오늘의 나는 릴리스 그 이상일 게 분명해.` / `[L0030] 지휘관: 너 벌써 5번 이상 피격된 건 알아?` / `[L0031] 홍련: 셈이 서툴군그래. 2.5번일세.` / `[L0032] 홍련: 왜냐하면 내 방어력이 두 배로 높아졌기 때문이지.`
   - 장면 원문과 제목에 없는 `"새 장비 덕분에"`를 제거하여 L28~32 원문 내용만 정확히 요약함.
2. **R5-2 (`events_and_claims[12].summary`, L49~52) — 해결됨**
   - 원문 인용: `[L0045] 기도와 같은 주문과 함께, 지팡이를 들어 올린다.` ~ `[L0048] 마치 비처럼 쏟아지던 미사일은, 황금색 막에 막혀 공중에서 폭발한다.` / `[L0049] 라푼젤: ···이런 것까지 되는군요.` / `[L0050] 지휘관: 마음에 드나 보네.` / `[L0051] 라푼젤: 그 정도가 아니에요. 이 정도의 힘이라면···.` / `[L0052] 라푼젤: 이번에야말로.`
   - 장면에 없는 `"새 장비"`를 빼고 L49의 `"이런 것"`을 같은 장면 앞쪽 줄(L45~48)에서 풀어 썼으며([GRAPH_RAG_PASS1_RULES.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_RULES.md) 3절 6항 지시 대상 풀기 준수), L52의 끊긴 대사(`"이번에야말로."`)를 임의로 채웠던 `"해낼 수 있다고 말한다"`도 원문 그대로 고침.
3. **R5-3 (`events_and_claims[15].summary`, L59~61) — 해결됨**
   - 원문 인용: `[L0058] 지휘관: ···스노우 화이트 녀석. 뭘 만든 거야 대체.` / `[L0059] 도로시: ···저부터 만들어 달라고 할 걸 그랬네요.` / `[L0060] 지휘관: 그러길래 평소에 좀 친하게 지내지 그랬어.` / `[L0061] 도로시: 친밀도로 우선순위가 정해지지 않았다는 것 정도는 알아요.`
   - 장면에 없는 `"장비를"`을 빼고, 같은 장면 바로 앞 줄(L58)에서 생략된 대상(`스노우 화이트에게`)만 풀어 씀([GRAPH_RAG_PASS1_RULES.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_RULES.md) 3절 6항 준수).
4. **R5-4 (`clues_and_hooks[0].keyword`, L14~17) — 해결됨**
   - 원문 인용: `[L0014] 릴리바이스는 얼굴 어딘가에서 흐르는 미지근한 액체를 닦는다.` / `[L0015] 확인하지는 않는다. 무엇인지는 보지 않아도 알 수 있다.` / `[L0016] 릴리바이스: ··· ···.` / `[L0017] 릴리바이스: 자, 조금만 더 버텨줘.`
   - 원문에 없는 판정 표현인 `"신체 이상"`을 제거하고 L14의 원문 표현(`"얼굴에서 흐르는 미지근한 액체"`)으로 바꿈.

### 적용 여부 판단
- 독립 검토에서 3번(보수하면서 잃은 것)이 **0건**이고 1번 미해결 및 2번 새 항목 오류도 **0건**이므로 [GRAPH_RAG_PASS1_REPAIR_ROUND6.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_REPAIR_ROUND6.md#L125-L130) 2~3절 기준에 따라 적용을 진행함.

---

## 4. 적용 뒤 검증 결과 및 병합기 출력

### `apply` 출력
```text
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[repair] batch_0162: applied (1 warning(s) left in repaired scenes)
```

### `validate-output.mjs batch_0162 --no-log` 출력 및 남은 경고 목록 전체
```text
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_18) $.scenes[0].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_20) $.scenes[2].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_22) $.scenes[4].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_23) $.scenes[5].participants.mentioned_only[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_24) $.scenes[6].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_25) $.scenes[7].participants.present_in_scene[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0162: mechanical validation succeeded (7 warning(s)).
```

- **보수 전 경고와 비교**: 보수 전(5회차 적용 뒤)과 동일하게 `batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 7건(`ark_guardian_18`, `ark_guardian_20`, `ark_guardian_21`, `ark_guardian_22`, `ark_guardian_23`, `ark_guardian_24`, `ark_guardian_25`)이며, 새로 생긴 경고는 없음(기대값과 일치).

### `merge-and-index.mjs` 출력
```text
[merge-and-index] Mode: main, Merged batches: 439, Merged scenes: 5560, Skipped batches: 0, Index: /home/vomirin/nikke-script-archive/data/graph/pass1_index.json
[merge-and-index] Stale scene skipped: over_zone_13 in batch_0066 (now in batch_0439)
[merge-and-index] Stale scene skipped: last_kingdom_21 in batch_0098 (now in batch_0439)
[merge-and-index] Stale scene skipped: lord_for_justice_13 in batch_0136 (now in batch_0439)
[merge-and-index] Stale scene skipped: reborn_evil_13 in batch_0150 (now in batch_0439)
[merge-and-index] Stale scene skipped: ark_guardian_13 in batch_0161 (now in batch_0439)
[merge-and-index] Stale scene skipped: ark_guardian_26 in batch_0163 (now in batch_0439)
[merge-and-index] Stale scene skipped: good_world_13 in batch_0188 (now in batch_0439)
[merge-and-index] Stale scene skipped: b-side_idol_13 in batch_0193 (now in batch_0439)
[merge-and-index] Stale scene skipped: bitter_spice_13 in batch_0194 (now in batch_0439)
[merge-and-index] Stale scene skipped: 문구점_00 in batch_0232 (now in batch_0431)
[merge-and-index] Stale scene skipped: theater_01 in batch_0252 (now in batch_0432)
[merge-and-index] Stale scene skipped: theater_02 in batch_0252 (now in batch_0432)
[merge-and-index] Stale scene skipped: theater_04 in batch_0252 (now in batch_0432)
[merge-and-index] Stale scene skipped: theater_06 in batch_0252 (now in batch_0432)
[merge-and-index] Stale scene skipped: theater_11 in batch_0253 (now in batch_0432)
[merge-and-index] Stale scene skipped: white_memory_00 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_01 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_02 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_03 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_04 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_05 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_06 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_07 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_08 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_09 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_10 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_11 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_12 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_13 in batch_0354 (now in batch_0433)
[merge-and-index] Stale scene skipped: white_memory_14 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_15 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_16 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_17 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_18 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_19 in batch_0354 (now in batch_0434)
[merge-and-index] Stale scene skipped: white_memory_20 in batch_0354 (now in batch_0434)
```

- **기대값 비교**: 병합 배치 439개, 병합 장면 5,560개로 기대값과 일치함.
- 병합 후 이번 회차 보수 입출력·후보·지적 파일을 `data/graph/pass1/repairs/round6/`로 이동 완료함.

---

## 5. 사용량과 소스 열람

실행 명령:
`node scripts/graph/agy-usage.mjs --supervisor f1456b46-8b38-4a68-8ad1-01292d64d1ac --from-request GRAPH_RAG_PASS1_REPAIR_ROUND6`

```text
감독관 f1456b46-8b38-4a68-8ad1-01292d64d1ac 스텝 8 초과 ~ 25 (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)

| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 | 진행 중 오류 | 긴 대기 |
|---|---|---:|---:|---:|---:|---|---|---|
| f1456b46 | supervisor | 9 | 26,403 | 279,264 | 6,253 | 0 | 0 | 0 |
| 639975e0 | repair batch_0162 | 7 | 79,523 | 306,081 | 18,770 | 0 | 0 | 0 |
| dfc0ff45 | review | 5 | 135,652 | 318,185 | 16,446 | 0 | 0 | 0 |
| **합계** | | 21 | 241,578 | 903,530 | 41,469 | | 0 | 0 |

thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.
scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.
진행 중 오류는 세션 안에서 이어져 복구된 것도 센다(출력 잘림·스트림 끊김은 실행 환경의 오류 메시지, 도구 실패는 실패한 도구 스텝).
긴 대기는 도구 스텝의 시작~완료 기록이 10분 이상인 것이다. 명령이 오래 걸렸는지 결과 전달이 늦었는지는 로그로 알 수 없다.
```

- `scripts/ 열람`이 0이 아닌 세션: 없음 (모든 세션 0건).

---

## 6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체 (고치지 않음)

### 보수자 보고 (`639975e0`)
1. `ark_guardian_21` `participants.present_in_scene[0]`(L9): 화자 `"지휘관"`의 `entity_id`가 `"char_엔더슨"`으로 연결되어 `ENTITY_ID_SURFACE_MISMATCH` 경고가 남음(이 장면 원문에 엔더슨이라는 근거 없음; 보수 4회차에서 사용자 확인된 건으로 지시서 [GRAPH_RAG_PASS1_REPAIR_ROUND6.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_REPAIR_ROUND6.md#L19) "이번 범위 밖" 항목).
2. `ark_guardian_21` `events_and_claims[1]`(L9~11)·`events_and_claims[5]`(L18~23)·`events_and_claims[14]`(L55~58)·`events_and_claims[19]`(L74~76)·`events_and_claims[20]`(L77~80): 주장 범위 안에 다른 화자의 대사·행동이 별도 항목 없이 함께 묶여 있음.
3. `ark_guardian_21` `relationship_and_lore_notes[1]`(L21~27): 전투 후 바다를 보러 가자는 일회성 약속이 관계 메모로 등재됨.

### 독립 검토자 보고 (`dfc0ff45`)
1. `ark_guardian_21` `participants.present_in_scene[0].entity_id`(L9~97 전반, 첫 발화 `[L0009] 지휘관: 너무 무리하는 거 아냐?`): 배치 입력 `mechanical_ground_truth.speakers`에서 `지휘관`의 `suggested_entity_id`는 `"char_지휘관"`이고 이 장면 원문 어디에도 `엔더슨`이라는 표기나 근거가 없는데 `"entity_id": "char_엔더슨"`으로 연결됨(보수 4회차에서 사용자 확인된 건으로 지시서 "이번 범위 밖" 항목).
2. `ark_guardian_21` `events_and_claims[1]`(L9~11, `[L0009]`~`[L0011]`): 지휘관의 `character_claim` 항목(`actor_or_speaker: "지휘관"`, `claim_line: 11`) 안에 릴리바이스가 자신의 행동 이유를 밝힌 독립 주장(`[L0010] 릴리바이스: 보여주는 거죠. 갓데스의 릴리바이스가 여기 있다고.`)이 함께 묶여 있고, 릴리바이스를 `actor_or_speaker`로 한 항목이 따로 없음([GRAPH_RAG_PASS1_RULES.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_RULES.md) 3절 6항 위반).
3. `ark_guardian_21` `events_and_claims[11]`(L38~48, `[L0038]`~`[L0041]` 포함): L38~48 전체를 `actor_or_speaker: "라푼젤"` 단독의 `established_event`로 묶으면서, 지휘관이 포격형 랩쳐들의 목표를 파악하는 주장(L38~39), 홍련이 나서겠다는 발화(`[L0040] 홍련: 내가 가서 몽땅 베어버리겠네.`, 요약에서도 빠짐), 지휘관이 홍련을 제지하며 라푼젤에게 맡기는 결정(L41)을 각 화자(`지휘관`, `홍련`)로 분리하거나 `actor_or_speaker`에 반영하지 않음([GRAPH_RAG_PASS1_RULES.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_RULES.md) 3절 6항 위반).
4. `ark_guardian_21` `events_and_claims[14]`(L55~58, `[L0055]`~`[L0058]`): 라푼젤이 지팡이에서 황금색 빛무리를 뿜어 랩쳐 무리를 폭파시키는 현장 전투 사건(L55~56, `established_event`)과 공격 출력이 크게 올랐다는 라푼젤의 주장(`[L0057] 라푼젤: 보, 보셨나요? 공격 쪽 출력도 엄청 올라갔어요!`, `character_claim`)을 따로 나누지 않고 지휘관의 `character_claim`(`actor_or_speaker: "지휘관"`, `claim_line: 58`, `refers_to_past: true`) 하나에 모두 묶어 라푼젤의 행동과 주장이 라푼젤에게 귀속되지 않음([GRAPH_RAG_PASS1_RULES.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_RULES.md) 3절 6항 위반).

---

## 7. 규칙·도구의 문제점 제안

1. **`prepare` 실행 시 같은 장면 내 금지 표현(장면 밖 표현) 전수 검색 보조**:
   - 5회차에서 장면 `summary`의 `"새 장비"`·`"릴리바이스의 신체 이상"`만 지적·수정되어 같은 장면의 `events_and_claims`와 `clues_and_hooks`에 있던 동일 표현 4건이 6회차로 이월되었다. 이번 6회차 지시서([GRAPH_RAG_PASS1_REPAIR_ROUND6.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_PASS1_REPAIR_ROUND6.md#L16))에는 "같은 장면의 다른 필드에 같은 표현이 있으면 함께 고친다"는 지시가 추가되어 해결되었으나, `repair-pass1.mjs prepare` 단계나 findings 작성 시 장면 밖 표현(`out_of_scope_term`) 유형 지적이 들어오면 같은 장면의 모든 문자열 필드(`cross_scene_hints` 제외)에서 해당 어구를 자동 검색해 함께 표시해 주면 누락을 예방할 수 있다.
2. **짧은 구간(1~2차례)의 앞쪽 타 화자 주장·사건 묶임**:
   - [GRAPH_RAG_SPEC.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_SPEC.md#L190-L198) 2.3절 23항(`CLAIM_OTHER_SPEAKERS`, 3차례 이상)과 [GRAPH_RAG_SPEC.md](file:///home/vomirin/nikke-script-archive/GRAPH_RAG_SPEC.md#L236-L240) 2.3절 26항(`CLAIM_ENDS_OTHER_SPEAKER`, 마지막 차례가 다른 화자)은 범위 앞쪽이나 중간에 1~2차례 끼어든 다른 화자의 독립 주장·사건(예: 6절의 `ark_guardian_21` L9~11 중 L10 릴리바이스 대사, L55~58 중 L55~57 라푼젤 전투 및 대사)을 기계 경고로 잡지 못하는 한계가 명세에 이미 적혀 있다. 향후 추가 보수 회차를 구성할 때 6절에 보고된 타 화자 묶임 건들을 findings에 포함할지 검토할 수 있다.
