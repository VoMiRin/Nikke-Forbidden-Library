# GraphRAG Pass 1 보수 7회차 보고서 (2026-11-03)

- 지시서: `GRAPH_RAG_PASS1_REPAIR_ROUND7.md`
- 명세(`GRAPH_RAG_SPEC.md`)와의 차이: 없음
- 실행 환경: 감독관 세션(`e9e4f1c9-828e-4805-9c02-75a344e93e1f`), 보수 서브에이전트 2개(`self`, 맥락 미상속), 독립 검토 서브에이전트 1개(`self`, 맥락 미상속)

---

## 0. 이번 범위와 미처리

- **이번에 고친 범위**: 보수 3·5·6회차 보수자·검토자가 "지적과 무관하게 본 오류"로 보고한 것 가운데 원문과 샤드로 확인된 **지적 10건(`R7-1` ~ `R7-10`, 4장면, 4배치: `batch_0161`, `batch_0162`, `batch_0294`, `batch_0423`)**과 그 수정 때문에 함께 바뀐 필드뿐이다(지적 목록에 없지만 함께 고친 다른 필드는 없음).
  - `R7-1`: `ark_guardian_10` (`batch_0161`) `clues_and_hooks[1].detail` L24~28
  - `R7-2`: `ether_04` (`batch_0294`) `events_and_claims[29].summary` L171~175
  - `R7-3` ~ `R7-8`: `ark_guardian_21` (`batch_0162`) `events_and_claims[1]`(L9~11), `[5]`(L18~23), `[11]`(L38~48), `[14]`(L55~58), `[19]`(L74~76), `[20]`(L77~80)
  - `R7-9` ~ `R7-10`: `chapter_50_14` (`batch_0423`) `events_and_claims[18].actor_or_speaker` L91~92, `clues_and_hooks[7].detail` L547~564
- **이번 범위 밖(미처리)**: `data/graph/reports/pass1_open_issues.md`의 다른 미처리 지적(56절 포함) 및 이번 7회차에서 보수자·검토자가 지적과 무관하게 본 오류는 고치지 않고 미처리로 두었다.
  - `maria-n_05` 지적 8건과 `chapter_50_14`의 `events_and_claims[112]`·`[116]`, `relationship_and_lore_notes[8]`·`[9]` (앞쪽 줄의 대상을 풀어 쓴 것 등)
  - `ark_guardian_10` `events_and_claims[4]`의 "양산형 니케들" (장면 제목 `최강의 니케 : A`에 "니케" 있음)
  - `batch_0161`·`batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 14건 (과거 지휘관 라벨 → `char_엔더슨`, 보수 4회차에서 사용자 확인)

---

## 1. 시작 전 확인 및 `prepare` 출력

- `node scripts/graph/build-pass1-rules.mjs --check`: `[pass1-rules] GRAPH_RAG_PASS1_RULES.md is up to date`
- `git status --short data/graph/pass1/shards`: 빈 출력 확인
- `prepare` 실행 결과 (`GRAPH_RAG_PASS1_REPAIR_ROUND7.md` 0절의 기대값과 완전히 일치):

```text
[repair] batch_0161: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0161.input.json
    output data/graph/pass1/repairs/batch_0161.output.json
[repair] batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":6}
    input  data/graph/pass1/repairs/batch_0162.input.json
    output data/graph/pass1/repairs/batch_0162.output.json
[repair] batch_0294: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0294.input.json
    output data/graph/pass1/repairs/batch_0294.output.json
[repair] batch_0423: 1 scene(s) to repair {"REVIEW_FINDING":2}
    input  data/graph/pass1/repairs/batch_0423.input.json
    output data/graph/pass1/repairs/batch_0423.output.json
[repair] job 1 (214KB): batch_0423
[repair] job 2 (140KB): batch_0161, batch_0162, batch_0294
```

---

## 2. 보수 결과

### 2.1 배치별 `check` 결과 요약

| 배치 | 작업(세션) | 대상 장면 수 | `check` 통과 여부 | 재시도 횟수 | 첫 시도 실패 규칙명별 건수 | 남은 경고 (보수 대상 장면 기준) |
|---|---|---:|---|---:|---|---|
| `batch_0161` | Job 2 (`1a4e5910`) | 1 (`ark_guardian_10`) | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH`: 1건 (`"지휘관"` → `char_엔더슨`) |
| `batch_0162` | Job 2 (`1a4e5910`) | 1 (`ark_guardian_21`) | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH`: 1건 (`"지휘관"` → `char_엔더슨`) |
| `batch_0294` | Job 2 (`1a4e5910`) | 1 (`ether_04`) | 통과 | 0회 | 없음 | 없음 (0건) |
| `batch_0423` | Job 1 (`18f17484`) | 1 (`chapter_50_14`) | 통과 | 0회 | 없음 | 없음 (0건) |

### 2.2 지적 10건별 보수자 처리 내역

- **`R7-1` (`ark_guardian_10`, `batch_0161`)**: **고침** — `clues_and_hooks[1].detail`(L24~28)에서 원문에 없는 `"대피"`와 단정 표현(`"내부에 수많은 사람이 대피해 있다"`)을 지우고, L28 원문(`"저 안에 몇 명의 사람이 있는지 모른다. 모르긴 몰라도 무지하게 많겠지."`)대로 `"지휘관은 그 안에 몇 명의 사람이 있는지는 모르지만 무지하게 많을 것이라고 추측한다"`로 수정함 (L24~28).
- **`R7-2` (`ether_04`, `batch_0294`)**: **고침** — `events_and_claims[29].summary`(L171~175)에서 장면 원문과 제목에 없는 `"니케 생체 실험"`을 지우고, 같은 장면 앞쪽 L31(`"니케들은 계속해서 실험재료가 되고"`)과 L171~172(`"비밀이 아니게 된다고 하더라도. 인간들이 이 일에 조금이라도 관심을 가질까?"`)의 표현으로 풀어서 `"니케들이 실험재료가 되는 일이 비밀이 아니게 되더라도 인간들은 이 일에 관심을 갖지 않고..."`로 수정함 (L171~175).
- **`R7-3` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[1]`, L9~11)에서 릴리바이스의 L10 주장과 지휘관의 L11 주장을 화자별로 2개 항목으로 분리함 (L9~11).
  - `릴리바이스` · `character_claim` · L9~10 (`claim_line: 10`): 지휘관의 무리하는 것 아니냐는 물음(L9)을 문맥으로 포함해 갓데스의 릴리바이스가 여기 있다고 보여주는 것이라는 답을 기록
  - `지휘관` · `character_claim` · L11~11 (`claim_line: 11`): 랩쳐들은 무식해서 그런 것을 모르고 사기라는 게 존재하지 않는다는 지적을 기록
- **`R7-4` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[5]`, L18~23)에서 지휘관과 릴리바이스의 발화를 화자 및 행위/내용 기준(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)으로 4개 항목으로 분리함 (L18~23).
  - `릴리바이스` · `character_claim` · L18~20 (`claim_line: 20`): 지휘관이 릴리스라고 부르자(L18~19) 왜 그러냐며 갑자기 느끼하게 부른다고 반응함
  - `지휘관` · `established_event` · L21~21: 이번 전투가 끝나면 어디 놀러나 갈까 하고 제안함(말한 행위)
  - `릴리바이스` · `character_claim` · L22~22 (`claim_line: 22`): 전투가 끝나면 놀러 가자는 말에 죽이려고 작정했냐며 전투 중에 그런 말을 한다고 핀잔을 줌
  - `지휘관` · `character_claim` · L23~23 (`claim_line: 23`): 클리셰는 부수라고 있는 것이라고 답함
- **`R7-5` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[11]`, L38~48)에서 지휘관·홍련의 대사(L38~41)와 라푼젤의 방패 막 전개 사건(L42~48)을 화자별로 4개 항목으로 분리함 (L38~48).
  - `지휘관` · `character_claim` · L38~39 (`claim_line: 39`): 포격형 랩쳐들이 자리를 잡고 양산형 니케들을 노리는 것 같다고 판단함
  - `홍련` · `character_claim` · L40~40 (`claim_line: 40`): 자신이 가서 포격형 랩쳐들을 몽땅 베어버리겠다고 나섬
  - `지휘관` · `established_event` · L41~41: 라푼젤이 있다며 나서려는 홍련을 만류함(말한 행위)
  - `라푼젤` · `established_event` · L42~48: 다수의 포격형 랩쳐들이 양산형 니케들의 전장을 노리고 미사일 포격을 쏟아내자 라푼젤이 황금색 방패 막을 펼쳐 공중에서 막아냄
- **`R7-6` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[14]`, L55~58)에서 지문의 라푼젤 공격 묘사, 라푼젤의 주장, 지휘관의 주장을 3개 항목으로 분리함 (L55~58).
  - `라푼젤` · `established_event` · L55~56: 라푼젤의 지팡이에서 황금색 빛무리가 뻗어나가 랩쳐 무리를 스쳐 지나며 폭발을 일으킴
  - `라푼젤` · `character_claim` · L57~57 (`claim_line: 57`): 지휘관에게 자신의 공격 쪽 출력도 엄청 올라갔다고 기뻐하며 말함
  - `지휘관` · `character_claim` · L58~58 (`claim_line: 58`): 라푼젤의 강화된 공격 출력을 보고 스노우 화이트가 대체 무엇을 만든 거냐며 놀람
- **`R7-7` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[19]`, L74~76)에서 도로시와 지휘관의 주장을 화자별로 3개 항목으로 분리함 (L74~76).
  - `도로시` · `character_claim` · L74~74 (`claim_line: 74`): 아군의 수적 열세가 너무 심하다고 말함
  - `지휘관` · `character_claim` · L75~75 (`claim_line: 75`): 수적 열세가 심하다는 말에 그래서 큰 거 한 방을 노려야 한다고 답함
  - `도로시` · `character_claim` · L76~76 (`claim_line: 76`): 큰 거 한 방을 노려야 한다는 말에 스노우 화이트가 늦지 않기를 바라야겠다고 말함
- **`R7-8` (`ark_guardian_21`, `batch_0162`)**: **고침** — `events_and_claims`(원래 `[20]`, L77~80)에서 홍련과 라푼젤의 주장을 화자별로 3개 항목으로 분리함 (L77~80).
  - `홍련` · `character_claim` · L77~78 (`claim_line: 78`): 처음부터 보이지 않던 스노우 화이트가 뭘 하러 간 것이냐며 어린 것이 벌써부터 농땡이를 피우는 것이냐고 투덜거림
  - `라푼젤` · `character_claim` · L79~79 (`claim_line: 79`): 스노우 화이트가 무엇을 하러 갔는지 묻는 홍련에게 작전 회의 때 듣지 않았냐고 짚음
  - `홍련` · `character_claim` · L80~80 (`claim_line: 80`): 작전 회의 때 듣지 않았냐는 말에 그렇다고 인정하며 자신보다 약한 이의 말은 듣지 않는다고 답함
- **`R7-9` (`chapter_50_14`, `batch_0423`)**: **고침** — `events_and_claims[18].actor_or_speaker`(L91~92)에서 라피(L91)와 크라운(L92)이 함께 지휘관을 맞이하는 `established_event`이므로 `"크라운"`을 `"라피, 크라운"`으로 수정함 (L91~92).
- **`R7-10` (`chapter_50_14`, `batch_0423`)**: **고침** — `clues_and_hooks[7].detail`(L547~564) 끝부분에 있던 범위 밖 뒤쪽 줄(L572, L587~588)의 결과(`"모든 랩쳐와 여신상의 움직임·수복을 멈춘다"`)를 제거하고, L547~564 범위 안의 내용(`"과거 글러트니 안에서 만들어 올려보낸 물거품을 전장의 랩쳐들에게 붙이고 얼굴 앞까지 연결한 물거품 길을 통해 \"[정지.]\"라며 목소리의 힘을 사용한다."`)으로 수정함 (L547~564).

### 2.3 지적 목록에 없지만 함께 고친 필드

- 없음

---

## 3. 독립 검토 결과 (적용 전 후보 대상)

독립 검토 서브에이전트(`94c8f64d-df78-454a-bedd-ba2eb5487af2`)가 4장면 후보 전체를 원문·보수 전 샤드·보수 후 후보와 대조했다.

### 3.1 지적 10건의 판정 표

| id | 장면 ID | 대상 경로 (줄 범위) | 판정 |
|---|---|---|---|
| `R7-1` | `ark_guardian_10` | `clues_and_hooks[1].detail` (`L24~28`) | 해결됨 |
| `R7-2` | `ether_04` | `events_and_claims[29].summary` (`L171~175`) | 해결됨 |
| `R7-3` | `ark_guardian_21` | `events_and_claims[1]` → `[1]~[2]` (`L9~11`) | 해결됨 |
| `R7-4` | `ark_guardian_21` | `events_and_claims[5]` → `[6]~[9]` (`L18~23`) | 해결됨 |
| `R7-5` | `ark_guardian_21` | `events_and_claims[11]` → `[15]~[18]` (`L38~48`) | 해결됨 |
| `R7-6` | `ark_guardian_21` | `events_and_claims[14]` → `[21]~[23]` (`L55~58`) | 해결됨 |
| `R7-7` | `ark_guardian_21` | `events_and_claims[19]` → `[28]~[30]` (`L74~76`) | 해결됨 |
| `R7-8` | `ark_guardian_21` | `events_and_claims[20]` → `[31]~[33]` (`L77~80`) | 해결됨 |
| `R7-9` | `chapter_50_14` | `events_and_claims[18].actor_or_speaker` (`L91~92`) | 해결됨 |
| `R7-10` | `chapter_50_14` | `clues_and_hooks[7].detail` (`L547~564`) | 해결됨 |

### 3.2 장면별·유형별 건수 표

| 장면 ID (`batch_id`) | 지적 건수 | 1. 지적 해결 | 1. 지적 미해결 | 2. 새로 만들거나 고친 항목의 오류 | 3. 보수하면서 잃은 것 | 4. 보수와 무관하게 남아 있는 오류 (별도 집계) |
|---|---:|---:|---:|---:|---:|---:|
| `ark_guardian_10` (`batch_0161`) | 1 | 1 | 0 | 0 | 0 | 2 |
| `ark_guardian_21` (`batch_0162`) | 6 | 6 | 0 | 0 | 0 | 5 |
| `ether_04` (`batch_0294`) | 1 | 1 | 0 | 0 | 0 | 1 |
| `chapter_50_14` (`batch_0423`) | 2 | 2 | 0 | 0 | 0 | 11 |
| **합계** | **10** | **10** | **0** | **0** | **0** | **19** |

### 3.3 사례 및 적용 여부 판단

- **1번(지적 미해결 / 그대로 둔 것이 틀림)**: 0건 (10건 모두 해결됨. `ark_guardian_10`에서 `"대피"`, `ether_04`에서 `"생체 실험"`이 같은 장면의 다른 문자열 필드에 남아 있지 않은 것도 확인됨)
- **2번(새로 만들거나 고친 항목의 오류)**: 0건
- **3번(보수하면서 잃은 것)**: 0건 (`ark_guardian_21` `R7-5`에서 보수 전 요약에 빠져 있던 L40 홍련의 말까지 분리 항목 `events_and_claims[16]`으로 복원됨)
- **적용 여부 판단**: 3번(보수하면서 잃은 것)이 0건이고 미해결·새 오류도 0건이므로 `GRAPH_RAG_PASS1_REPAIR_ROUND7.md` 2절·3절에 따라 적용(`apply`)을 진행했다.

---

## 4. 적용 뒤 검증 결과와 병합기 출력

### 4.1 `apply` 및 `validate-output.mjs` 출력 전체

보수 전 경고(6회차 적용 뒤: `batch_0161` `ENTITY_ID_SURFACE_MISMATCH` 7건, `batch_0162` 같은 규칙 7건, `batch_0294`·`batch_0423` 0건)와 완전히 같고, 화자를 나누면서 새로 생긴 경고는 없다.

```text
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_10) $.scenes[1].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[repair] batch_0161: applied (1 warning(s) left in repaired scenes)
[repair] batch_0162: applied (1 warning(s) left in repaired scenes)
[repair] batch_0294: applied (0 warning(s) left in repaired scenes)
[repair] batch_0423: applied (0 warning(s) left in repaired scenes)
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
[PASS] batch_0423: mechanical validation succeeded (0 warning(s)).
```

### 4.2 `merge-and-index.mjs` 출력

병합 배치 수 439개, 병합 장면 수 5,560개로 기대값과 일치한다. 보수 파일은 모두 `data/graph/pass1/repairs/round7/`로 옮겼다.

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

---

## 5. 사용량과 소스 열람

`node scripts/graph/agy-usage.mjs --supervisor e9e4f1c9-828e-4805-9c02-75a344e93e1f --from-request GRAPH_RAG_PASS1_REPAIR_ROUND7` 실행 결과 (`scripts/ 열람`이 0이 아닌 세션은 없음):

```text
감독관 e9e4f1c9-828e-4805-9c02-75a344e93e1f 스텝 0 초과 ~ 36 (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)

| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 | 진행 중 오류 | 긴 대기 |
|---|---|---:|---:|---:|---:|---|---|---|
| e9e4f1c9 | supervisor | 18 | 219,887 | 1,117,968 | 8,348 | 0 | 0 | 0 |
| 18f17484 | repair batch_0423 | 7 | 134,673 | 500,791 | 9,788 | 0 | 0 | 0 |
| 1a4e5910 | repair batch_0161+batch_0162+batch_0294 | 7 | 196,620 | 451,389 | 35,806 | 0 | 0 | 0 |
| 94c8f64d | review | 10 | 665,782 | 762,419 | 39,202 | 0 | 0 | 0 |
| **합계** | | 42 | 1,216,962 | 2,832,567 | 93,144 | | 0 | 0 |

thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.
scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.
진행 중 오류는 세션 안에서 이어져 복구된 것도 센다(출력 잘림·스트림 끊김은 실행 환경의 오류 메시지, 도구 실패는 실패한 도구 스텝).
긴 대기는 도구 스텝의 시작~완료 기록이 10분 이상인 것이다. 명령이 오래 걸렸는지 결과 전달이 늦었는지는 로그로 알 수 없다.
```

---

## 6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체 (고치지 않음)

### 6.1 보수 서브에이전트 보고분

- **Job 1 (`batch_0423`, `18f17484`)**:
  - `chapter_50_14` L94~100: `events_and_claims[20]`(`established_event`) 요약은 스노우 화이트, 라푼젤, 홍련, 도로시, 엔더슨, 나유타가 지휘관을 맞이하고 지휘관이 답하는 내용이나 `actor_or_speaker`에 `"지휘관"`만 기재됨
  - `chapter_50_14` L140~142, L169~174, L337~346, L609~614, L638~642: 복수 인물의 발화·행동을 묶은 `established_event` 항목들(`events_and_claims[29]`, `[35]`, `[60]`, `[89]`, `[94]`)에서 `actor_or_speaker`에 일부 행동 주체만 기재됨
  - `chapter_50_14` L576: 사용자 확인 별칭인 `세이렌`(`char_리틀_머메이드`, 현장 참여자 `리틀 머메이드`와 동일 인물)이 `mentioned_only`(`entity_id: null`) 및 `unregistered_entity_candidates`에 중복 등재됨
- **Job 2 (`batch_0161`, `batch_0162`, `batch_0294`, `1a4e5910`)**:
  - `ark_guardian_10` · L2~6 · `events_and_claims[0]`(`established_event`, `actor_or_speaker: "릴리바이스"`)에 라푼젤(L5)과 홍련(L6)의 반응 대사가 함께 묶여 있고 `actor_or_speaker`에 릴리바이스만 적혀 있음
  - `ark_guardian_10` · L10~14 · `events_and_claims[3]`(`established_event`, `actor_or_speaker: "지휘관"`)에 스노우 화이트의 L11 대사와 지휘관의 L12~14 판단 대사가 함께 묶여 있음
  - `ark_guardian_21` · L28~32, L49~52, L59~61, L62~66 · 홍련·라푼젤·도로시의 `character_claim` 범위 가운데에 낀 상대 화자(지휘관 L30, L50, L60, 릴리바이스 L65)의 대사가 별도 항목 없이 문맥으로만 묶여 있음
  - `ether_04` · L208~218 · `events_and_claims[32]`는 현재 장면에서 쪽지 두 장을 펼쳐 이어 보는 행동(`established_event`)인데 `refers_to_past: true`로 표기되어 있음

### 6.2 독립 검토 서브에이전트 보고분 (총 19건)

#### `ark_guardian_10` (`batch_0161`) — 2건
1. **`ark_guardian_10`, `L2~6` (`events_and_claims[0]`) — 사건 주체 누락 및 다른 화자의 말을 한 항목에 묶음(사실·주장 혼동)**
   - 원문 인용:
     ```text
     [L0002] 쿠구구구···!!
     [L0003] 지축이 울리며 굉음이 울려 퍼진다.
     [L0004] 릴리바이스: 시작됐네.
     [L0005] 라푼젤: 굉장한 소리네요.
     [L0006] 홍련: 기껏해야 문 닫는 소리일 텐데 너무 큰 것 아닌가.
     ```
   - 내용: `epistemic_type: "established_event"`, `actor_or_speaker: "릴리바이스"`로 적혀 있으나, 요약(`"지축을 울리는 굉음과 함께 문을 닫는 작업이 시작되자, 라푼젤과 홍련이 소리가 너무 크다고 반응한다."`)의 반응 주체인 라푼젤과 홍련이 `actor_or_speaker`에서 누락되었다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항). 또한 지문의 굉음 발생(L2~3)과 릴리바이스(L4)·라푼젤(L5)·홍련(L6) 세 화자의 판단·평가를 `릴리바이스` 단독의 `established_event` 하나에 묶었다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

2. **`ark_guardian_10`, `L10~14` (`events_and_claims[3]`) — 다른 화자의 말을 한 항목에 묶음 및 사실·주장 혼동**
   - 원문 인용:
     ```text
     [L0010] 릴리바이스의 말이 끝나기가 무섭게, 저편에서 먼지구름이 다가오기 시작한다.
     [L0011] 스노우 화이트: ···오네요. 엄청 많은데요.
     [L0012] 지휘관: 빌어먹을 랩쳐놈들. 꾸역꾸역 잘도 기어 오는군.
     [L0013] 지휘관: 다수의 타일런트 급이 확인된다.
     [L0014] 지휘관: 잔챙이들은 아니야.
     ```
   - 내용: 지문에는 먼지구름이 다가온다는 내용(L10)만 있고 많은 수가 온다는 스노우 화이트의 말(L11)과 다수의 타일런트 급이 확인되며 잔챙이들이 아니라는 지휘관의 말·평가(L12~14)는 대사로만 나오는데, 이를 `actor_or_speaker: "지휘관"` 단독의 `established_event`(`"저편에서 먼지구름과 함께 많은 수의 랩쳐가 다가오자 지휘관이 다수의 타일런트 급을 확인한다."`) 하나로 묶어 스노우 화이트의 말을 흡수하고 대사로만 전해진 관측·평가를 사건으로 확정했다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

#### `ark_guardian_21` (`batch_0162`) — 5건
1. **`ark_guardian_21`, `L28~32` (`events_and_claims[11]`) — 다른 화자의 주장을 한 항목에 묶음**
   - 원문 인용:
     ```text
     [L0028] 지휘관: 홍련. 어때?
     [L0029] 홍련: 말할 것도 없네. 이렇게나 몸이 가볍다니, 오늘의 나는 릴리스 그 이상일 게 분명해.
     [L0030] 지휘관: 너 벌써 5번 이상 피격된 건 알아?
     [L0031] 홍련: 셈이 서툴군그래. 2.5번일세.
     [L0032] 홍련: 왜냐하면 내 방어력이 두 배로 높아졌기 때문이지.
     ```
   - 내용: 홍련의 `character_claim`(L28~32, `claim_line: 29`) 가운데에 지휘관의 L30(`"너 벌써 5번 이상 피격된 건 알아?"`, 홍련이 이미 5번 이상 피격되었다는 지적·진술)이 묶여 있고, L30을 다루는 지휘관 자신의 항목이 없다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

2. **`ark_guardian_21`, `L49~52` (`events_and_claims[19]`) — 다른 화자의 주장을 한 항목에 묶음**
   - 원문 인용:
     ```text
     [L0049] 라푼젤: ···이런 것까지 되는군요.
     [L0050] 지휘관: 마음에 드나 보네.
     [L0051] 라푼젤: 그 정도가 아니에요. 이 정도의 힘이라면···.
     [L0052] 라푼젤: 이번에야말로.
     ```
   - 내용: 라푼젤의 `character_claim`(L49~52, `claim_line: 51`) 가운데에 지휘관의 L50(`"마음에 드나 보네."`, 라푼젤의 반응을 보고 한 지휘관의 추측·평가)이 묶여 있고, L50을 다루는 지휘관 자신의 항목이 없다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

3. **`ark_guardian_21`, `L59~61` (`events_and_claims[24]`) — 다른 화자의 주장을 한 항목에 묶음**
   - 원문 인용:
     ```text
     [L0059] 도로시: ···저부터 만들어 달라고 할 걸 그랬네요.
     [L0060] 지휘관: 그러길래 평소에 좀 친하게 지내지 그랬어.
     [L0061] 도로시: 친밀도로 우선순위가 정해지지 않았다는 것 정도는 알아요.
     ```
   - 내용: 도로시의 `character_claim`(L59~61, `claim_line: 61`) 가운데에 지휘관의 L60(`"그러길래 평소에 좀 친하게 지내지 그랬어."`, 도로시에게 한 지휘관의 핀잔·농담)이 묶여 있고, L60을 다루는 지휘관 자신의 항목이 없다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

4. **`ark_guardian_21`, `L85~92` (`events_and_claims[35]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0085] 홍련: ···뭐?
     [L0086] 쿠우우우우---
     [L0087] 거대한 엔진음이 들려온다.
     [L0088] 홍련은 하늘을 올려다보았다.
     [L0089] 홍련: ···승리의 날개 호···!
     [L0090] 스노우 화이트: 스노우 화이트! 승리의 날개 호! 합류합니다!
     [L0091] 지휘관: 몽땅 쓸어버려.
     [L0092] 스노우 화이트: 예!
     ```
   - 내용: `established_event`의 요약(`"홍련이 비행기를 훔치러 갔다는 말에 놀라는 순간 거대한 엔진음과 함께 스노우 화이트가 승리의 날개 호를 타고 나타나 합류하고, 지휘관이 몽땅 쓸어버리라고 명령한다."`)과 원문(L85, L88~89)에 홍련의 반응·행동이 포함되어 있는데 `actor_or_speaker`에는 `"스노우 화이트, 지휘관"`만 적고 `"홍련"`을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

5. **`ark_guardian_21`, `L21~27` (`relationship_and_lore_notes[1]`) — 관계·설정 메모 부적격(일회성 상호작용 중복 기록 및 주장 대사 혼입)**
   - 원문 인용:
     ```text
     [L0021] 지휘관: 이번에 끝나면 어디 놀러나 갈까.
     [L0022] 릴리바이스: 세상에. 저 죽이려고 작정했어요? 전투 중에 그런 말을 하다니.
     [L0023] 지휘관: 클리셰는 부수라고 있는 거야.
     [L0024] 릴리바이스: 뭐, 좋아요. 어디 갈 건데요?
     [L0025] 지휘관: 글쎄. 바다나 보러 가자고.
     [L0026] 릴리바이스: ··· ···.
     [L0027] 릴리바이스: 그래요. 가요.
     ```
   - 내용: `GRAPH_RAG_PASS1_RULES.md` 3절 9항에 따라 `relationship_and_lore_notes`는 소속·지휘·가족·신뢰·적대·별칭 등 관계 상태가 말로 밝혀지거나 바뀔 때만 적고 일회성 상호작용은 `events_and_claims`에만 적어야 하는데, 전투 후 바다를 보러 가자고 제안·승낙한 일회성 약속(`events_and_claims[7]`, `events_and_claims[10]`에 이미 기록됨)을 `relationship_and_lore_notes`에 중복 기록했으며, 범위(L21~27) 안에 릴리바이스와 지휘관의 `character_claim`(L22~23)까지 섞어 `established_event`로 적었다.

#### `ether_04` (`batch_0294`) — 1건
1. **`ether_04`, `L209~218` (`clues_and_hooks[0].detail` 및 장면 `summary`) — 범위 밖 내용 혼입(이전 장면 맥락을 끌어온 해석)**
   - 원문 인용:
     ```text
     [L0209] 쪽지를 펼치자, 앞부분이 찢어진 종이에 글자가 쓰여있었다.
     [L0210] [P. 7호. 내 실험체가 되어줄 거지? 넌 정의로우니까.]
     [L0211] [CHOICE_START]
     [L0212]   [OPTION TEXT="···?!"]
     [L0213]   [OPTION_END]
     [L0214] [CHOICE_END]
     [L0215] 이전에 받았던 쪽지를 다시 펼쳐보았다.
     [L0216] [PM 11. 오른쪽 끝. CASE01. HEL]
     [L0217] 두 쪽지를 연결해 보았다.
     [L0218] [PM 11. 오른쪽 끝. CASE01. HELP. 7호. 내 실험체가 되어줄 거지? 넌 정의로우니까.]
     ```
   - 내용: `clues_and_hooks[0].detail`은 `"이전에 받은 쪽지 '[PM 11. 오른쪽 끝. CASE01. HEL]'과 마지막에 에테르가 던져준 쪽지 '[P. 7호. 내 실험체가 되어줄 거지? 넌 정의로우니까.]'를 합치면 에테르가 처음부터 지휘관을 CASE01로 유인해 자발적 실험체가 되도록 설계했음이 드러난다."`라고 적었고, 장면 상단 `summary`도 `"처음부터 지휘관의 정의감을 이용해 스스로 실험체가 되도록 유도했음을 드러낸다."`라고 적었다. 그러나 이 장면(L209~218) 안에서는 두 쪽지를 이어 붙였을 때의 전체 문장만 나올 뿐, 앞선 장면(`ether_02`, `ether_03`)에서 지휘관이 첫 쪽지를 보고 CASE01로 찾아가 스스로 실험체가 되었다는 경위는 이 장면 원문에 없다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항·8항).

#### `chapter_50_14` (`batch_0423`) — 11건
1. **`chapter_50_14`, `L7~11` (`events_and_claims[1]`) — 끊긴 말을 채운 것(뒤쪽 줄 내용 혼입)**
   - 원문 인용:
     ```text
     [L0007] 굉장한 수다. 하지만···.
     [L0008] [CHOICE_START]
     [L0009]   [OPTION TEXT="부사령관님. 저 무장으로는···!"]
     [L0010]   [OPTION_END]
     [L0011] [CHOICE_END]
     ```
   - 내용: 원문 L7과 L9는 끝까지 말하지 않고 끊긴 문장인데, 요약(`"지휘관이 양산형 니케들의 수가 굉장하지만 그 무장으로는 여신상에 통하지 않는다며 버닝엄에게 우려를 표한다."`)에서 뒤쪽 줄(L12 버닝엄 `"알고 있어. 유의미한 피해는 줄 수 없겠지."`)을 근거로 `"그 무장으로는 여신상에 통하지 않는다며"`라고 끊긴 뒷말을 채워 적었다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

2. **`chapter_50_14`, `L84~90` (`events_and_claims[17]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0084] 그는 나를 똑바로 바라본다.
     [L0085] 경례한다.
     [L0086] 힘겹게 몸을 일으킨 후, 경례로 답한다.
     [L0087] 그는 씨익 웃은 후, 뒤돌아 달려간다.
     [L0088] ··· ···.
     [L0089] 나는 모두가 정비를 받고 있는 곳으로 향한다.
     [L0090] 모두의 시선이 나를 향한다.
     ```
   - 내용: `established_event`의 요약(`"신입 지휘관이 경례하자 지휘관이 힘겹게 몸을 일으켜 경례로 답하고, 신입 지휘관이 웃으며 달려간 뒤 지휘관은 모두가 정비받는 곳으로 향한다."`)에서 신입 지휘관이 경례하고 웃으며 달려가는 행동의 주체로 함께 서술되어 있는데, `actor_or_speaker`에는 `"지휘관"`만 적고 `"신입 지휘관"`을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

3. **`chapter_50_14`, `L94~100` (`events_and_claims[20]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0094] 스노우 화이트: 일어났나.
     [L0095] 라푼젤: 형제님.
     [L0096] 홍련: 도령.
     [L0097] 도로시: 귀하.
     [L0098] 엔더슨: 자네.
     [L0099] 고개를 끄덕인다. 옆을 본다.
     [L0100] 나유타: ···대협.
     ```
   - 내용: `established_event`의 요약(`"스노우 화이트, 라푼젤, 홍련, 도로시, 엔더슨이 지휘관을 맞이하자 지휘관이 고개를 끄덕이고 옆의 나유타와 인사를 나눈다."`)에서 스노우 화이트, 라푼젤, 홍련, 도로시, 엔더슨, 나유타가 모두 인사·맞이 행위의 주체로 적혀 있는데, `actor_or_speaker`에는 `"지휘관"`만 적고 나머지 6명을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

4. **`chapter_50_14`, `L140~142` (`events_and_claims[29]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0140] 도로시: 하지 말라니까요.
     [L0141] 나유타: 아··· 미안하오.
     [L0142] 도로시: ···정말.
     ```
   - 내용: `established_event`의 요약(`"도로시가 사과하지 말라고 다그치자 나유타가 또다시 사과하고 도로시가 한탄한다."`)에서 나유타가 사과하는 행위(L141)가 함께 서술되어 있는데 `actor_or_speaker`에는 `"도로시"`만 적고 `"나유타"`를 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

5. **`chapter_50_14`, `L169~174` (`events_and_claims[35]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0169] [CHOICE_START]
     [L0170]   [OPTION TEXT="···공멸···?"]
     [L0171]   [OPTION_END]
     [L0172] [CHOICE_END]
     [L0173] 엔더슨: 같이··· 죽는다는 얘기인가?
     [L0174] 나유타가 말없이 고개를 끄덕인다.
     ```
   - 내용: `established_event`의 요약(`"지휘관과 엔더슨이 공멸이란 같이 죽는다는 얘기냐고 되묻자 나유타가 말없이 고개를 끄덕인다."`)에서 되묻는 주체인 지휘관(L170)과 엔더슨(L173)이 함께 서술되어 있는데 `actor_or_speaker`에는 `"나유타"`만 적고 `"지휘관, 엔더슨"`을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

6. **`chapter_50_14`, `L337~346` (`events_and_claims[68]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0337] 마리안: 빼앗아야죠.
     [L0338] 고개를 돌린다.
     [L0339] 마리안이 눈을 뜨고 나를 바라보고 있다.
     [L0340] [CHOICE_START]
     [L0341]   [OPTION TEXT="···마리안."]
     [L0342]   [OPTION_END]
     [L0343] [CHOICE_END]
     [L0344] 마리안: ···지휘관.
     [L0345] 마리안이 나를 보고 웃는다.
     [L0346] 마주보고, 웃는다.
     ```
   - 내용: `established_event`의 요약(`"마리안이 빼앗아야 한다고 말하며 눈을 뜨고, 지휘관과 서로 이름을 부르며 마주 보고 웃는다."`)에서 지휘관이 고개를 돌려 이름을 부르고(L338, L341) 마주 보고 웃는(L346) 행위의 주체로 함께 서술되어 있는데 `actor_or_speaker`에는 `"마리안"`만 적고 `"지휘관"`을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

7. **`chapter_50_14`, `L370` (`events_and_claims[73]`) — 끊긴 말을 채운 것**
   - 원문 인용:
     ```text
     [L0370] 스노우 화이트: 언니를··· 다시···.
     ```
   - 내용: 원문 L370은 `"언니를··· 다시···."`로 끝이 끊긴 말인데, 요약(`"스노우 화이트가 언니인 릴리스를 다시 되찾을 수 있다는 말을 되뇐다."`)에서 `"되찾을 수 있다는 말을"`이라고 끊긴 뒷말을 채워 적었다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

8. **`chapter_50_14`, `L393~406` (`events_and_claims[81]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0393] [CHOICE_START]
     [L0394]   [OPTION TEXT="··· ···."]
     [L0395]   [OPTION_END]
     [L0396] [CHOICE_END]
     [L0397] 마리안: ···지휘관. 왜 그래요?
     [L0398] [CHOICE_START]
     [L0399]   [OPTION TEXT="정말 그게 전부지?"]
     [L0400]   [OPTION_END]
     [L0401] [CHOICE_END]
     [L0402] 마리안: ··· ···.
     [L0403] [CHOICE_START]
     [L0404]   [OPTION TEXT="그렇게 모두가 행복한 결말을 맞이할 수 있는거지?"]
     [L0405]   [OPTION_END]
     [L0406] [CHOICE_END]
     ```
   - 내용: `established_event`의 요약(`"지휘관이 침묵하자 마리안이 왜 그러냐고 묻고, 지휘관은 정말 그게 전부인지 물은 뒤 마리안이 침묵하자 그렇게 모두가 행복한 결말을 맞이할 수 있는 것인지 거듭 확인한다."`)에서 마리안이 묻고(L397) 침묵하는(L402) 행위가 함께 서술되어 있는데 `actor_or_speaker`에는 `"지휘관"`만 적고 `"마리안"`을 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

9. **`chapter_50_14`, `L609~614` (`events_and_claims[122]`) — 사건 주체(`actor_or_speaker`) 누락**
   - 원문 인용:
     ```text
     [L0609] 버닝엄: 좋다! 가라!
     [L0610] 스카이: 예썰!!
     [L0611] 쿠우우우우우---!!
     [L0612] 굉음을 내며 승리의 날개 호가 떠오른다.
     [L0613] ···굉장한 진동이다. 상태가 좋지 않다는 건 알 수 있다.
     [L0614] 하지만 올라간다.
     ```
   - 내용: `established_event`의 요약(`"버닝엄이 출격을 명령하자 스카이가 응답하고, 상태가 좋지 않은 승리의 날개 호가 굉음과 진동을 내며 떠오른다."`)에서 스카이가 응답하는 행위(L610)가 함께 서술되어 있는데 `actor_or_speaker`에는 `"버닝엄"`만 적고 `"스카이"`를 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

10. **`chapter_50_14`, `L629~637` (`events_and_claims[127]`) — 사건 주체(`actor_or_speaker`) 누락**
    - 원문 인용:
      ```text
      [L0629] 여신상은 아직까지 움직이지 않는다.
      [L0630] 아래를 바라본다.
      [L0631] 랩쳐는 모두 전멸. 양산형 니케들이 여신상을 향해 공격을 시작한다.
      [L0632] 그리고
      [L0633] 바하무트: 포비스트! 거대화!
      [L0634] 사방에서 터져나오는 검은 빛.
      [L0635] 칠흑을 두른 소, 악어, 새가 여신상을 덮친다.
      [L0636] ···베히모스의 머리 위엔 은화가, 레비아탄의 머리 위엔 베스티가, 지즈에는 엠마가 탑승하고 있다.
      [L0637] 솔직히 장관이다. 현실성이 떨어지는 모습이다.
      ```
    - 내용: `established_event`의 요약(`"랩쳐가 전멸하고 양산형 니케들이 여신상을 공격하는 가운데, 바하무트가 포비스트 거대화를 외치자 칠흑을 두른 소(베히모스), 악어(레비아탄), 새(지즈)가 거대화하여 각기 은화, 베스티, 엠마를 태운 채 여신상을 덮친다."`)에서 공격·거대화·탑승의 주체인 `양산형 니케들`, `베히모스`, `레비아탄`, `지즈`, `은화`, `베스티`, `엠마`가 서술되어 있는데 `actor_or_speaker`에는 `"바하무트"`만 적혀 있다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

11. **`chapter_50_14`, `L638~642` (`events_and_claims[128]`) — 사건 주체(`actor_or_speaker`) 누락**
    - 원문 인용:
      ```text
      [L0638] 은화: 꼴통 후배. 들리나?
      [L0639] [CHOICE_START]
      [L0640]   [OPTION TEXT="응. 들려. 은화."]
      [L0641]   [OPTION_END]
      [L0642] [CHOICE_END]
      ```
    - 내용: `established_event`의 요약(`"은화가 지휘관에게 통신이 들리는지 묻자 지휘관이 잘 들린다고 답한다."`)에서 은화가 묻는 행위(L638)가 함께 서술되어 있는데 `actor_or_speaker`에는 `"지휘관"`만 적고 `"은화"`를 누락했다(`GRAPH_RAG_PASS1_RULES.md` 2.3절 7항).

---

## 7. 규칙·도구의 문제점 제안

- 이번 7회차에서는 `prepare --findings` 및 보수·독립 검토 지시서의 공통 판정 기준(`GRAPH_RAG_SPEC.md` 5절 보수 항목)이 의도대로 작동하여, 보수 재시도 0회 및 독립 검토 오판·누락 0건으로 마무리되었다.
- 다만 보수자·검토자가 지적과 무관하게 본 오류 중 `chapter_50_14`와 `ark_guardian_21`에서 **여러 화자가 발화하거나 행동한 `established_event` 항목에 `actor_or_speaker`가 한 명만 적힌 사례**(검토자 보고 기준 10건)와 **`character_claim` 범위 한가운데에 낀 다른 화자의 1줄 발화가 분리되지 않은 사례**(`ark_guardian_21` L30, L50, L60 등, `GRAPH_RAG_SPEC.md` 5절의 시험 중인 진단 3 대상)가 반복해서 관찰되었다. 향후 추가 보수를 진행할 경우, 시험 중인 진단 3(`claim_middle_other_speaker`)이나 복수 화자 `established_event`의 `actor_or_speaker` 누락 여부를 기계적으로 후보 추출해 볼 수 있다.
