# GraphRAG Pass 1 보수 5회차 보고서 (2026-11-03)

- **실행 환경 참고**: 감독관 모델 Gemini 4 Argon (High), 보수 서브에이전트 1개(`self`, 맥락 미상속, `2061e60e-72dd-49b6-8c00-0865165118f5`), 독립 검토 서브에이전트 1개(`self`, 맥락 미상속, `33ce8960-8bce-4a6d-ae4d-83a2f3834b24`)
- **사전 확인** (`GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 0절):
  - `node scripts/graph/build-pass1-rules.mjs --check` → `[pass1-rules] GRAPH_RAG_PASS1_RULES.md is up to date`
  - `git status --short data/graph/pass1/shards` → 출력 비어 있음

---

## 0. 이번 범위와 미처리

- **이번 보수 범위**: Pass 1 본 실행 44회차 독립 검토자가 "추출자가 보지 못한 경고"(`GRAPH_RAG_SPEC.md` 2.3절 25항 `TERM_NOT_IN_SCENE`) 중 **고쳐야 함**으로 판정했지만 고치지 않은 지적 3건(3장면, 3배치: `data/graph/pass1/repairs/round5/round5_findings.json`)만 고쳤다.
  - `W44-T1` `ark_guardian_10` (`batch_0161`): 사건 요약의 `"밀봉"`
  - `W44-T2` `ark_guardian_21` (`batch_0162`): 장면 요약의 `"3차 밀봉"`, `"새 장비"`
  - `W44-T3` `ether_04` (`batch_0294`): 사건 요약의 `"바이러스 투여"`
- **이번 범위 밖(미처리)**:
  - `data/graph/reports/pass1_open_issues.md`의 다른 미처리 지적(40·41회차 메신저 복수 호칭·관계 메모, 보수 3·4회차 보수자·검토자가 본 무관 오류 등)
  - 이 세 배치의 다른 경고(`batch_0161`·`batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 각 7건: 과거 지휘관 라벨 → `char_엔더슨`, 보수 4회차에서 사용자 확인)
  - 이번 5회차에서 보수자·검토자가 지적과 무관하게 본 오류(아래 6절에 전체 기록, 고치지 않음)

---

## 1. `prepare` 출력 및 기대값 대조

실행 명령:
```bash
node scripts/graph/repair-pass1.mjs prepare batch_0161 batch_0162 batch_0294 --findings data/graph/pass1/repairs/round5_findings.json
```

출력 그대로:
```text
[repair] batch_0161: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0161.input.json
    output data/graph/pass1/repairs/batch_0161.output.json
[repair] batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0162.input.json
    output data/graph/pass1/repairs/batch_0162.output.json
[repair] batch_0294: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0294.input.json
    output data/graph/pass1/repairs/batch_0294.output.json
[repair] job 1 (135KB): batch_0161, batch_0162, batch_0294
```

- **기대값 대조**: `GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 0절의 기대값(`batch_0161`·`batch_0162`·`batch_0294` 각 `1 scene(s) to repair {"REVIEW_FINDING":1}`, 작업 1개 `job 1: batch_0161, batch_0162, batch_0294`)과 정확히 일치했다.

---

## 2. 보수 결과

- **`check` 통과 여부**: 세 배치(`batch_0161`, `batch_0162`, `batch_0294`, 총 3장면) 모두 통과
- **재시도 횟수**: 0회
- **첫 시도 실패 규칙명별 건수**: 없음 (0건)
- **남은 경고 (보수 대상 장면 기준)**: `ENTITY_ID_SURFACE_MISMATCH` 2건 (`ark_guardian_10` 1건, `ark_guardian_21` 1건 — 기존 `participants.present_in_scene`에서 화자 `"지휘관"`이 `"char_엔더슨"`에 연결된 경고로 이번 범위 밖이라 건드리지 않음)

### 지적 3건별 보수자 처리와 이유

- **`W44-T1`** (`ark_guardian_10`, `batch_0161`): **고침** — `ark_guardian_10`(L2~6) 원문과 제목에 `"밀봉"`이 없음을 확인하고, `events_and_claims[0].summary`를 L2~6 원문 표현에 맞춰 `"지축을 울리는 굉음과 함께 문을 닫는 작업이 시작되자, 라푼젤과 홍련이 소리가 너무 크다고 반응한다."`로 고쳤으며, 다른 ARK GUARDIAN 장면의 방주 밀봉 작업과의 연결은 `cross_scene_hints`에 추가함
- **`W44-T2`** (`ark_guardian_21`, `batch_0162`): **고침** — `ark_guardian_21`(L1~103) 원문과 제목에 `"3차"`, `"밀봉"`, `"새 장비"`가 없음을 확인하고, 장면 `summary`를 원문 표현(L7 `"랩쳐들로 가득한, 넓게 전개된 전장"`, L14~17 얼굴의 액체를 닦으며 버팀, L29~32·L46~58 스노우 화이트가 만든 것으로 높아진 방어력과 공격 출력)에 맞춰 다시 썼으며, 다른 장면의 3차 밀봉 전장 및 새 장비와의 연결은 `cross_scene_hints`에 추가함
- **`W44-T3`** (`ether_04`, `batch_0294`): **고침** — `ether_04`(L2~10) 원문과 제목에 `"바이러스"`, `"투여"`가 없음을 확인하고, `events_and_claims[0].summary`를 L2~10 원문 표현에 맞춰 `"그동안 치료받았던 것이 없던 일처럼 지휘관의 목이 타들어가는 듯하며 기침과 열이 다시 심해지고, 에테르는 끊임없이 주사를 놓고 약을 먹인다."`로 고쳤으며, 앞 장면 `ether_03`의 바이러스 실험과의 연결은 `cross_scene_hints`에 추가함

---

## 3. 독립 검토 결과 (적용 전 후보 대상)

### 3.1 지적 3건 판정 표

| id | 장면 ID (`path`) | 판정 | 비고 |
| --- | --- | :---: | --- |
| `W44-T1` | `ark_guardian_10` (`events_and_claims[0].summary`) | **해결됨** | `"방주 통로 밀봉 작업"`을 `"문을 닫는 작업"`으로 고치고 `cross_scene_hints`로 분리함 |
| `W44-T2` | `ark_guardian_21` (`summary`) | **해결됨** | 장면 `summary`의 `"3차 밀봉"`, `"새 장비"`는 해결 및 `cross_scene_hints` 분리 완료 (단, `events_and_claims[7, 12, 15]`에는 `"새 장비"`/`"장비"` 잔존) |
| `W44-T3` | `ether_04` (`events_and_claims[0].summary`) | **해결됨** | `"바이러스 투여 후"`를 L2~3 원문 표현으로 고치고 `cross_scene_hints`로 분리함 |

### 3.2 장면별·유형별 건수 표

| 장면 ID | 배치 | 1. 지적 미해결 / 잘못된 보수 | 2. 새로 만들거나 고친 항목의 오류 | 3. 보수하면서 잃은 것 | 4. 보수와 무관하게 남아 있는 오류 (별도) |
| --- | --- | :---: | :---: | :---: | :---: |
| `ark_guardian_10` | `batch_0161` | 0건 | 0건 | 0건 | 2건 |
| `ark_guardian_21` | `batch_0162` | 0건 | 0건 | 0건 | 5건 |
| `ether_04` | `batch_0294` | 0건 | 0건 | 0건 | 2건 |
| **합계** | - | **0건** | **0건** | **0건** | **9건** |

### 3.3 장면별 검토 사례 (`1~3번` 항목)

- **`ark_guardian_10` (`batch_0161`)**
  - **지적 판정 (`W44-T1`)**: 해결됨
    - 원문 인용:
      - `[L0002] 쿠구구구···!!`
      - `[L0003] 지축이 울리며 굉음이 울려 퍼진다.`
      - `[L0004] 릴리바이스: 시작됐네.`
      - `[L0005] 라푼젤: 굉장한 소리네요.`
      - `[L0006] 홍련: 기껏해야 문 닫는 소리일 텐데 너무 큰 것 아닌가.`
    - 근거: 보수 전 요약(`"지축을 울리는 굉음과 함께 방주 통로 밀봉 작업이 시작된다."`)에 있던 범위 밖·타 장면 용어 `"방주 통로 밀봉 작업"`을 삭제하고, L2~6 원문에 부합하는 `"지축을 울리는 굉음과 함께 문을 닫는 작업이 시작되자, 라푼젤과 홍련이 소리가 너무 크다고 반응한다."`로 수정했으며, 다른 장면의 `'방주 밀봉 작업'`과 이어진다는 점은 `cross_scene_hints[0]`(`"물자용 통로를 몇 중으로 잠그는 작업(L4~9)은 다른 ARK GUARDIAN 장면에서 언급되는 방주 밀봉 작업과 이어진다."`)으로 분리해 `GRAPH_RAG_PASS1_RULES.md` 3절 6항을 준수함.
  - **새로 만들거나 고친 항목의 오류 / 보수하면서 잃은 것**: 없음 (0건)
- **`ark_guardian_21` (`batch_0162`)**
  - **지적 판정 (`W44-T2`)**: 해결됨
    - 원문 인용:
      - `[L0007] 랩쳐들로 가득한, 넓게 전개된 전장이었지만 그 이질적인 광경은 전장 어디에서든 확인할 수 있었다.`
      - `[L0014] 릴리바이스는 얼굴 어딘가에서 흐르는 미지근한 액체를 닦는다.`
      - `[L0017] 릴리바이스: 자, 조금만 더 버텨줘.`
      - `[L0029] 홍련: 말할 것도 없네. 이렇게나 몸이 가볍다니, 오늘의 나는 릴리스 그 이상일 게 분명해.`
      - `[L0032] 홍련: 왜냐하면 내 방어력이 두 배로 높아졌기 때문이지.`
      - `[L0049] 라푼젤: ···이런 것까지 되는군요.`
      - `[L0057] 라푼젤: 보, 보셨나요? 공격 쪽 출력도 엄청 올라갔어요!`
      - `[L0058] 지휘관: ···스노우 화이트 녀석. 뭘 만든 거야 대체.`
    - 근거: 보수 전 장면 `summary`에 있던 범위 밖 표현 `"3차 밀봉 전장에서"`, `"신체 이상을 숨긴 채"`, `"새 장비로 활약"`을 모두 제거하고, 이 장면 원문에 있는 표현(`"랩쳐들로 가득한 전장에서"`, `"얼굴에서 흐르는 액체를 닦으며 버티고"`, `"스노우 화이트가 만들어 준 것으로 높아진 방어력과 공격 출력을 발휘해 활약하던 중"`)으로 수정했으며, 다른 장면의 `'3차 밀봉 전장'` 및 `'새 장비'`와의 연결은 `cross_scene_hints[0]`에 적음.
  - **새로 만들거나 고친 항목의 오류 / 보수하면서 잃은 것**: 없음 (0건)
- **`ether_04` (`batch_0294`)**
  - **지적 판정 (`W44-T3`)**: 해결됨
    - 원문 인용:
      - `[L0002] 목이 타들어가는 것 같다.`
      - `[L0003] 그동안 치료받았던 것들이 없었던 일이었던 것처럼.`
      - `[L0008] 기침은 다시 심해졌고 머릿속은 열로 가득 찼다.`
      - `[L0009] 에테르는 끊임없이 주사를 놓았고.`
      - `[L0010] 약을 먹였다.`
    - 근거: 보수 전 요약(`"바이러스 투여 후 지휘관의 기침과 고열이 다시 심해지고, 에테르는 끊임없이 주사를 놓고 약을 먹인다."`)에 있던 앞 장면(`ether_03`) 용어 `"바이러스 투여 후"`를 삭제하고, L2~10 원문 표현을 따른 `"그동안 치료받았던 것이 없던 일처럼 지휘관의 목이 타들어가는 듯하며 기침과 열이 다시 심해지고, 에테르는 끊임없이 주사를 놓고 약을 먹인다."`로 수정했으며, 앞 장면의 바이러스 실험과 이어진다는 점은 `cross_scene_hints[1]`으로 분리함.
  - **새로 만들거나 고친 항목의 오류 / 보수하면서 잃은 것**: 없음 (0건)

### 3.4 적용 여부 판단

- 독립 검토에서 1번(미해결·그대로 둔 것이 틀림), 2번(새로 만들거나 고친 항목의 오류), 3번(보수하면서 잃은 것) 모두 **0건**이므로 `GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 2절·3절 및 `GRAPH_RAG_SPEC.md` 5절 보수 기준에 따라 후보를 적용했다.

---

## 4. 적용 뒤 검증 결과 및 병합기 출력

### 4.1 `apply` 출력

```text
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_10) $.scenes[1].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[repair] batch_0161: applied (1 warning(s) left in repaired scenes)
[repair] batch_0162: applied (1 warning(s) left in repaired scenes)
[repair] batch_0294: applied (0 warning(s) left in repaired scenes)
```

### 4.2 세 배치 검증(`validate-output.mjs --no-log`) 결과 및 남은 경고 목록 전체

```text
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_09) $.scenes[0].participants.mentioned_only[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_10) $.scenes[1].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_11) $.scenes[2].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_12) $.scenes[3].participants.present_in_scene[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_15) $.scenes[6].participants.mentioned_only[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_16) $.scenes[7].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_17) $.scenes[8].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0161: mechanical validation succeeded (7 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_18) $.scenes[0].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_20) $.scenes[2].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_22) $.scenes[4].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_23) $.scenes[5].participants.mentioned_only[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_24) $.scenes[6].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_25) $.scenes[7].participants.present_in_scene[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0162: mechanical validation succeeded (7 warning(s)).
[PASS] batch_0294: mechanical validation succeeded (0 warning(s)).
```

- **보수 전 경고와 비교**:
  - `batch_0161`: 보수 전 `ENTITY_ID_SURFACE_MISMATCH` 7건·`TERM_NOT_IN_SCENE` 1건 → 보수 후 `ENTITY_ID_SURFACE_MISMATCH` 7건 (`TERM_NOT_IN_SCENE` 1건 해소, 새 경고 없음)
  - `batch_0162`: 보수 전 `ENTITY_ID_SURFACE_MISMATCH` 7건·`TERM_NOT_IN_SCENE` 1건 → 보수 후 `ENTITY_ID_SURFACE_MISMATCH` 7건 (`TERM_NOT_IN_SCENE` 1건 해소, 새 경고 없음)
  - `batch_0294`: 보수 전 `TERM_NOT_IN_SCENE` 1건 → 보수 후 경고 0건 (`TERM_NOT_IN_SCENE` 1건 해소, 새 경고 없음)
  - 지시서(`GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 3절)의 기대값과 정확히 일치한다.

### 4.3 병합기(`merge-and-index.mjs`) 출력

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

- 병합 배치 수 439배치, 병합 장면 수 5,560장면으로 기대값(`GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 3절)과 일치한다.
- 병합 후 이번 회차의 보수 파일(`batch_0*.input.json`, `batch_0*.output.json`, `batch_0*.candidate.json`, `round5_findings.json`)은 모두 `data/graph/pass1/repairs/round5/`로 옮겼다.

---

## 5. 사용량과 소스 열람

실행 명령:
```bash
node scripts/graph/agy-usage.mjs --supervisor 9c482cc5-8e11-4dc7-a219-0efd2800a321 --from-request GRAPH_RAG_PASS1_REPAIR_ROUND5
```

출력 그대로:
```text
감독관 9c482cc5-8e11-4dc7-a219-0efd2800a321 스텝 0 초과 ~ 27 (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)

| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 | 진행 중 오류 | 긴 대기 |
|---|---|---:|---:|---:|---:|---|---|---|
| 9c482cc5 | supervisor | 14 | 92,047 | 713,923 | 6,990 | 0 | 0 | 0 |
| 2061e60e | repair batch_0161+batch_0162+batch_0294 | 8 | 122,491 | 592,230 | 24,114 | 0 | 0 | 0 |
| 33ce8960 | review | 8 | 290,523 | 391,200 | 26,726 | 0 | 0 | 0 |
| **합계** | | 30 | 505,061 | 1,697,353 | 57,830 | | 0 | 0 |

thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.
scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.
진행 중 오류는 세션 안에서 이어져 복구된 것도 센다(출력 잘림·스트림 끊김은 실행 환경의 오류 메시지, 도구 실패는 실패한 도구 스텝).
긴 대기는 도구 스텝의 시작~완료 기록이 10분 이상인 것이다. 명령이 오래 걸렸는지 결과 전달이 늦었는지는 로그로 알 수 없다.
```

- `scripts/ 열람`이 0이 아닌 세션은 없다(감독관·보수자·검토자 모두 0회).

---

## 6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체 (미처리)

### 6.1 보수 서브에이전트(`2061e60e`)가 보고한 무관 오류

1. `ark_guardian_10` · L12~48 · `participants.present_in_scene[5]`에서 화자 `"지휘관"`의 `entity_id`가 장면 내 원문 근거 없이 `"char_엔더슨"`으로 연결됨(`ENTITY_ID_SURFACE_MISMATCH` 경고; 보수 4회차에서 사용자 확인된 건)
2. `ark_guardian_10` · L34~48 · `events_and_claims[7]`(`established_event`) 범위 안에 지휘관의 주장(L36~37 `"저것들은 우릴 싫어한다"`, L40~41 `"막을 건 우리밖에 없다"`)이 분리되지 않고 함께 묶여 있음
3. `ark_guardian_21` · L9~97 · `participants.present_in_scene[0]`에서 화자 `"지휘관"`의 `entity_id`가 장면 내 원문 근거 없이 `"char_엔더슨"`으로 연결됨(`ENTITY_ID_SURFACE_MISMATCH` 경고; 보수 4회차에서 사용자 확인된 건)
4. `ark_guardian_21` · L28~32, L49~52, L59~61 · `events_and_claims[7]`·`[12]`·`[15]`의 `summary`에도 이 장면 원문에 없는 `"새 장비"`·`"장비"` 표현이 쓰여 있음
5. `ether_04` · L85~95 · `events_and_claims[13]`의 `summary`에 에테르의 침묵(L94 `"··· ···."`)이 빠져 있음
6. `ether_04` · L209~218 · `clues_and_hooks[0]`의 `detail`에 원문에 직접 없는 `"유인"`·`"설계"` 해석 표현이 포함되어 있음

### 6.2 독립 검토 서브에이전트(`33ce8960`)가 보고한 무관 오류 (9건)

1. **`ark_guardian_10` | `events_and_claims[4].summary` | L15~16 | 장면에 없는 용어('니케') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0015] 릴리바이스: 라푼젤. 상황은 어때?`
     - `[L0016] 라푼젤: 양산형 분들도 모두 준비 완료 상태에요.`
   - 오류 내용: 원문 L16은 `"양산형 분들도"`라고만 말하며, `ark_guardian_10` 전체(L1~49)와 제목 어디에도 `"니케"`라는 단어가 등장하지 않는다. 요약에서 `"양산형 니케들도 모두 준비 완료 상태라고 보고한다"`라고 적어 장면에 없는 용어를 혼입했다.
2. **`ark_guardian_10` | `clues_and_hooks[1].detail` | L24~28 | 추측·불확실성 누락 및 확정 사실화 (`GRAPH_RAG_PASS1_RULES.md` 3절 3항·4항)**
   - 원문 인용:
     - `[L0024] 지휘관이 뒤로 돌아 방주 입구 근처의 건물들을 가리킨다.`
     - `[L0025] 지휘관: 보이나? 임시 벙커다.`
     - `[L0027] 지휘관: 소총탄에도 뻥뻥 뚫리는 열악하기 짝이 없는 벙커란 말이다.`
     - `[L0028] 지휘관: 저 안에 몇 명의 사람이 있는지 모른다. 모르긴 몰라도 무지하게 많겠지.`
   - 오류 내용: L28에서 지휘관은 벙커 안에 몇 명이 있는지 **모른다**고 밝힌 뒤 무지하게 많을 것이라고 **추측(`모르긴 몰라도 ~겠지`)**하고 있다(`events_and_claims[6]`에서는 `"무지하게 많은 사람이 있을 것이라고 설명한다"`로 바르게 적음). 그러나 `clues_and_hooks[1].detail`에서는 `"내부에 수많은 사람이 대피해 있다"`라고 추측·부정(`모른다`)을 누락한 채 확정 사실처럼 서술했다(원문에 `"대피"`라는 단어도 없다).
3. **`ark_guardian_21` | `events_and_claims[7].summary` | L28~32 | 범위 밖 내용('새 장비') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0028] 지휘관: 홍련. 어때?`
     - `[L0029] 홍련: 말할 것도 없네. 이렇게나 몸이 가볍다니, 오늘의 나는 릴리스 그 이상일 게 분명해.`
     - `[L0030] 지휘관: 너 벌써 5번 이상 피격된 건 알아?`
     - `[L0031] 홍련: 셈이 서툴군그래. 2.5번일세.`
     - `[L0032] 홍련: 왜냐하면 내 방어력이 두 배로 높아졌기 때문이지.`
   - 오류 내용: 장면 `summary`에서는 `"새 장비"`를 뺐으나, `events_and_claims[7].summary`에는 `"홍련이 새 장비 덕분에 몸이 가벼워..."`가 그대로 남아 있다. `"새 장비"`는 이 장면 원문(103줄)과 제목 어디에도 없는 다른 장면의 내용이다.
4. **`ark_guardian_21` | `events_and_claims[12].summary` | L49~52 | 범위 밖 내용('새 장비') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0049] 라푼젤: ···이런 것까지 되는군요.`
     - `[L0050] 지휘관: 마음에 드나 보네.`
     - `[L0051] 라푼젤: 그 정도가 아니에요. 이 정도의 힘이라면···.`
     - `[L0052] 라푼젤: 이번에야말로.`
   - 오류 내용: `events_and_claims[12].summary`에 `"라푼젤이 새 장비의 방어막 성능에 감탄하며..."`라고 적혀 있으나, 앞줄(L45~48 `"지팡이를 들어 올린다"`, `"황금색 막이 드리워진다"`)을 포함해 이 장면 전체에 `"새 장비"`라는 표현은 없다.
5. **`ark_guardian_21` | `events_and_claims[15].summary` | L59~61 | 범위 밖 내용('장비') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0058] 지휘관: ···스노우 화이트 녀석. 뭘 만든 거야 대체.`
     - `[L0059] 도로시: ···저부터 만들어 달라고 할 걸 그랬네요.`
     - `[L0060] 지휘관: 그러길래 평소에 좀 친하게 지내지 그랬어.`
     - `[L0061] 도로시: 친밀도로 우선순위가 정해지지 않았다는 것 정도는 알아요.`
   - 오류 내용: 바로 앞줄(L58)의 지시 대상을 풀더라도 원문은 `"뭘 만든 거야"`라고만 할 뿐 이 장면에 `"장비"`라는 단어는 등장하지 않는다. 요약에 `"도로시가 자신부터 장비를 만들어 달라고 할 걸 그랬다고..."`라고 적어 범위 밖 용어를 혼입했다.
6. **`ark_guardian_21` | `clues_and_hooks[0].keyword` | L14~17 | 범위 밖 판정('신체 이상') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0014] 릴리바이스는 얼굴 어딘가에서 흐르는 미지근한 액체를 닦는다.`
     - `[L0015] 확인하지는 않는다. 무엇인지는 보지 않아도 알 수 있다.`
     - `[L0016] 릴리바이스: ··· ···.`
     - `[L0017] 릴리바이스: 자, 조금만 더 버텨줘.`
   - 오류 내용: 원문 L14~17은 얼굴 어딘가에서 흐르는 미지근한 액체를 닦으며 조금만 더 버텨달라고 독백하는 묘사뿐이며, 보수 시 장면 `summary`에서는 `"신체 이상"`이라는 판정어를 제거했으나 `clues_and_hooks[0].keyword`에는 `"릴리바이스의 신체 이상"`이 그대로 남아 있다.
7. **`ark_guardian_21` | `forms_of_address[2]` | L37 | 동일 발화자·대상·호칭 조합 중복 기록 (`GRAPH_RAG_PASS1_RULES.md` 3절 10항)**
   - 원문 인용:
     - `[L0030] 지휘관: 너 벌써 5번 이상 피격된 건 알아?`
     - `[L0037] 지휘관: 그래그래. 너 혼자 다 해 먹어라.`
   - 오류 내용: 같은 발화자·대상·호칭 조합(`지휘관` → `홍련`, `"너"`)을 L30(`forms_of_address[1]`)과 L37(`forms_of_address[2]`)에 중복 기록했다.
8. **`ether_04` | `events_and_claims[25].summary` | L171~175 | 범위 밖 내용(장면에 없는 용어 '생체 실험') 혼입 (`GRAPH_RAG_PASS1_RULES.md` 3절 6항)**
   - 원문 인용:
     - `[L0171] 에테르: 글쎄. 비밀이 아니게 된다고 하더라도.`
     - `[L0172] 에테르: 인간들이 이 일에 조금이라도 관심을 가질까?`
     - `[L0173] 에테르: 그저 지상으로 보내는 니케를 지하로 보내는 것뿐이라고 생각할걸?`
     - `[L0174] 에테르: 설령 윤리적으로 문제가 된다고 생각하더라도 [필요악]이라 부르며.`
     - `[L0175] 에테르: 이 평화로움을 누리고 싶어서 발밑의 진창을 모르는 척할 거야.`
   - 오류 내용: L172의 `"이 일"`을 같은 장면 앞쪽 줄(`[L0030] 에테르: 네가 애써서 이번 실험을 끝낸다고 해도.`, `[L0031] 에테르: 니케들은 계속해서 실험재료가 되고`)에서 찾아 `"니케 실험"` 등으로 푸는 것은 3절 6항의 지시 대상 풀기에 해당하지만, 요약에 쓰인 `"생체 실험"`(`"니케 생체 실험이 비밀이 아니게 되더라도"`)은 `ether_04` 원문(233줄)과 제목에는 없고 앞 장면(`ether_03` L83, L90, L92)에만 나오는 용어다.
9. **`ether_04` | `forms_of_address[2], [4]` | L30, L187 | 대명사 조사·관형격 변형 중복 기록 (`GRAPH_RAG_PASS1_RULES.md` 3절 10항)**
   - 원문 인용:
     - `[L0029] 에테르: 너 혼자 이런다고 뭐가 조금이라도 바뀔 거 같아?`
     - `[L0030] 에테르: 네가 애써서 이번 실험을 끝낸다고 해도.`
     - `[L0187] 에테르: 지금보다 네 목숨이 중요하지 않게 되었을 때. 더는 협박의 수단으로 네 목을 걸 수 없게 되었을 때.`
   - 오류 내용: L29(`forms_of_address[1]`)에서 이미 `에테르` → `지휘관`의 2인칭 대명사 호칭 `"너"`를 기록했는데, L30(`forms_of_address[2]`)에서 주격 조사 결합형 `"네가"`를, L187(`forms_of_address[4]`)에서 관형격 형태 `"네"`를 별도 호칭으로 중복 기록했다.

---

## 7. 규칙·도구의 문제점 제안

1. **한 장면 내 여러 필드에 걸친 동일 범위 밖 표현(`"새 장비"`)의 보수 범위 지정**:
   - `W44-T2` 지적(`round5_findings.json`)은 검증기 25항(`TERM_NOT_IN_SCENE`)이 잡은 장면 `summary`의 `"3차 밀봉"`(후보 이름 목록에 있는 용어)에서 출발해 장면 `summary`의 `"3차 밀봉"`, `"새 장비"`를 고치도록 지정했다.
   - 보수자는 지시서(`GRAPH_RAG_PASS1_REPAIR_ROUND5.md` 1절 3-b항 "지적이 짚은 필드와, 그 수정 때문에 함께 바뀌어야 하는 필드만 바꾼다")를 엄격히 지켜 장면 `summary`와 `cross_scene_hints`만 고치고, 같은 장면의 `events_and_claims[7]`, `[12]`, `[15]`에 들어 있던 `"새 장비"`·`"장비"`는 무관 오류로만 보고했다(`"새 장비"`는 미등록 엔티티 후보에 없어 검증기 25항 경고 대상이 아니었음).
   - **제안**: "장면에 없는 이름/용어" 보수 시, 지적된 용어가 같은 장면의 다른 요약 필드(`events_and_claims[].summary`, `clues_and_hooks[].detail` 등)에도 똑같이 쓰였으면 함께 고치도록 보수 지시 문구를 명확히 하면 한 장면 안에서 장면 `summary`와 개별 사건 `summary`의 용어가 엇갈리는 일을 줄일 수 있다.
2. **2인칭 대명사 호칭(`너` / `네가` / `네`) 중복 여부에 대한 기준 명확화**:
   - `GRAPH_RAG_SPEC.md` 3절 10항은 `"대화 상대를 가리키는 2인칭 대명사는 문장 성분으로 쓰였어도 적는다(너·네가·네 힘·넌·널·너희·당신·여러분). address_term에는 원문에 쓰인 꼴(네, 넌, 널)을 적는다"`라고 규정하고, 4절은 `"중복은 같은 배열 안에서 같은 내용을 두 번 적는 것만 말한다"`고 규정한다.
   - 독립 검토자는 `ether_04`에서 `"너"`, `"네가"`, `"네"`를 모두 적는 것을 중복으로 보았으나, 추출자 입장에서는 원문에 쓰인 꼴(`너` vs `네`)이 달라 각각 적었을 수 있다(또한 주격 조사 결합형 `"네가"`를 `"네"`로 적을지 `"네가"`로 적을지도 예시의 `네가`와 `원문에 쓰인 꼴(네, 넌, 널)` 설명 사이에 해석 여지가 있음).
   - **제안**: 향후 호칭 보수나 재추출이 있을 경우, 한 장면에서 같은 화자·대상 사이에 `너`/`네`/`넌`/`널`이 여러 번 나올 때 대표 1건만 적는지(형태별로 1건인지, 2인칭 반말 대명사 전체로 1건인지) `GRAPH_RAG_SPEC.md` 3절 10항에 한 줄로 명시하는 것을 제안한다.
