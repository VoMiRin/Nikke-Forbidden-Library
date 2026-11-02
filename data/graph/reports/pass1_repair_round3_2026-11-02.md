# GraphRAG Pass 1 보수 3회차 보고서 (`2026-11-02`)

- **지시서**: `GRAPH_RAG_PASS1_REPAIR_ROUND3.md`
- **명세 기준**: `GRAPH_RAG_SPEC.md` (스키마 버전 `1.3.0`)
- **실행 환경 참고 사항**:
  - 감독관 세션 ID: `c337c319-0d1e-4a13-b6e8-3a10f8f89f83`
  - 서브에이전트 타입: `self` (`Model: inherit`, 맥락 미상속 — 새 독립 대화 컨텍스트에서 시작)
  - 보수 서브에이전트 3개(`5f4c674b`, `a1fe44c6`, `754d4dd1`), 후보 독립 표본 검토 서브에이전트 1개(`0c11db8a`)
  - `GRAPH_RAG_PASS1_REPAIR_ROUND3.md`와 `GRAPH_RAG_SPEC.md` 사이에 이번 실행 절차와 충돌하는 차이는 없었다.

---

## 0. 이번 범위와 미처리

- **이번 보수 범위**: 본 실행 42회차(`data/graph/reports/pass1_wave_0418-0427_2026-11-02.md` 5.2절)·44회차(`data/graph/reports/pass1_wave_0433-0439_2026-11-02.md` 5.2절) 독립 표본 검토가 짚은 의미 오류 **지적 13건(6장면, 4배치)** 만 고쳤다(`data/graph/pass1/repairs/round3/round3_findings.json`).
  - `batch_0423`: `chapter_50_14` (3건: `W42-1`~`W42-3`)
  - `batch_0427`: `maria-n_05` (3건: `W42-4`~`W42-6`)
  - `batch_0434`: `white_memory_20` (1건: `W44-7`)
  - `batch_0439`: `ark_guardian_26` (3건: `W44-1`~`W44-3`), `good_world_13` (1건: `W44-4`), `lord_for_justice_13` (2건: `W44-5`~`W44-6`)
  - (43회차 지적 `fading_affection_3121`, `white_memory_20`은 44회차 재추출로 다시 썼으므로 대상이 아니다.)
- **이번 범위 밖(미처리)**:
  1. 1·2회차 보수 때 남긴 "보수와 무관한 기존 오류" 및 분류별 10배치 의미 오류 후보
  2. 각 회차 독립 검토가 표본으로 보지 않은 장면
  3. 이번 3회차 보수에서 보수자·독립 검토자가 발견한 "새로 만들거나 고친 항목의 오류"(6건) 및 "지적과 무관하게 본 오류"(보수자 보고 1건, 검토자 보고 20건) — 본 보고서 3절·6절에 기록만 남기고 고치지 않았다.

---

## 1. 시작 전 확인 및 `prepare` 출력

### 1.1 규칙 파일 확인 (`build-pass1-rules.mjs --check`)

```text
[pass1-rules] GRAPH_RAG_PASS1_RULES.md is up to date
```

### 1.2 `prepare` 출력 (`repair-pass1.mjs prepare`)

실행 명령:
```bash
node scripts/graph/repair-pass1.mjs prepare batch_0423 batch_0427 batch_0434 batch_0439 --findings data/graph/pass1/repairs/round3_findings.json
```

출력 그대로:
```text
[repair] batch_0423: 1 scene(s) to repair {"REVIEW_FINDING":3}
    input  data/graph/pass1/repairs/batch_0423.input.json
    output data/graph/pass1/repairs/batch_0423.output.json
[repair] batch_0427: 1 scene(s) to repair {"REVIEW_FINDING":3}
    input  data/graph/pass1/repairs/batch_0427.input.json
    output data/graph/pass1/repairs/batch_0427.output.json
[repair] batch_0434: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0434.input.json
    output data/graph/pass1/repairs/batch_0434.output.json
[repair] batch_0439: 3 scene(s) to repair {"REVIEW_FINDING":6}
    input  data/graph/pass1/repairs/batch_0439.input.json
    output data/graph/pass1/repairs/batch_0439.output.json
[repair] job 1 (236KB): batch_0439
[repair] job 2 (213KB): batch_0423
[repair] job 3 (78KB): batch_0427, batch_0434
```

- **기대값 일치 여부**: `GRAPH_RAG_PASS1_REPAIR_ROUND3.md` 0절의 기대값(`batch_0423` 1장면 `{"REVIEW_FINDING":3}`, `batch_0427` 1장면 `{"REVIEW_FINDING":3}`, `batch_0434` 1장면 `{"REVIEW_FINDING":1}`, `batch_0439` 3장면 `{"REVIEW_FINDING":6}`, 작업 3개 구성)과 **정확히 일치**했다.

---

## 2. 보수 결과

### 2.1 작업별 `check` 통과 여부 요약

| 작업 | 서브에이전트 세션 | 담당 배치 | 장면 수 | `check` 통과 여부 | 재시도 횟수 | 첫 시도 실패 규칙명별 건수 | 남은 경고 |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| Job 1 | `5f4c674b-1466-40b9-9bcc-0a5662186492` | `batch_0439` | 3 | 통과 | 0회 | 없음 (0건) | 없음 (0건) |
| Job 2 | `a1fe44c6-d981-4693-b459-10c355071499` | `batch_0423` | 1 | 통과 | 0회 | 없음 (0건) | 없음 (0건) |
| Job 3 | `754d4dd1-221a-4551-97da-d0177568d756` | `batch_0427`, `batch_0434` | 2 | 통과 | 0회 | 없음 (0건) | 없음 (0건) |

### 2.2 지적 13건마다 보수자의 처리와 이유 한 줄

- **`W42-1`** (`chapter_50_14`, `batch_0423`): **고침** — 지휘관 일행이 떠오르는 승리의 날개 호 위에서 아래를 내려다보는 상황(L612, L630)에서 은화는 아래쪽 전장의 베히모스 머리 위에 탑승한 채(L636) 통신으로만 발화하므로(L638~645), `participants.present_in_scene`에서 `은화`를 제거하고 `participants.remote_or_voice_only`(`medium: "comm"`, L638~645)로 옮김
- **`W42-2`** (`chapter_50_14`, `batch_0423`): **고침** — 마리안이 유일하게 남은 퀸이 되어 사람과 니케들을 공격하지 않도록 랩쳐들을 통솔하겠다고 직접 밝힌 대사(L385~388)를 바탕으로 `relationship_and_lore_notes`에 `마리안` → `랩쳐` 관계 메모(`character_claim`, `claimant: "마리안"`, `claim_line: 386`)를 추가함
- **`W42-3`** (`chapter_50_14`, `batch_0423`): **고침** — `events_and_claims`의 기존 L572~578 항목을 나누어, 모든 랩쳐의 움직임이 갑자기 멈추는 지문 서술(L572~573)은 `랩쳐`의 `established_event`로, 라피가 당황하자 지휘관이 세이렌의 힘임을 알아보는 대사(L574~578, `claim_line: 576`)는 `지휘관`의 `character_claim`으로 분리함
- **`W42-4`** (`maria-n_05`, `batch_0427`): **고침** — `maria-n_05` L12~16의 닥터 마리아 `character_claim` 항목을 L12~14(닥터 마리아, `claim_line: 14`, 아무것도 온 게 없다고 부인), L15(에닉, `claim_line: 15`, 텍스트를 확인한 이력을 확인했다고 반박), L16(닥터 마리아, `claim_line: 16`, 자동화 때문이라고 둘러댐) 세 항목으로 분리함(L12~16)
- **`W42-5`** (`maria-n_05`, `batch_0427`): **고침** — `maria-n_05` L21~24의 `established_event` 항목을 L21~22 범위의 닥터 마리아 `character_claim`(`claim_line: 22`, 에닉이 우연으로 연락을 받은 것으로 이해해도 되겠느냐고 묻자 닥터 마리아가 그렇다고 동의함)으로 수정함(L21~22)
- **`W42-6`** (`maria-n_05`, `batch_0427`): **고침** — `maria-n_05`의 `relationship_and_lore_notes`에 실버건 스쿼드가 최초·최강 니케 릴리바이스의 재현을 목적으로 기획된 스쿼드라는 에닉의 추정(`실버건 스쿼드` → `릴리바이스`, `character_claim`, `claimant: 에닉`, `claim_line: 34`, L33~36), 닥터 마리아가 자신의 뇌 정보를 복사·개조한 NIMPH를 불특정 다수 여성의 뇌에 덮어씌워 실버건 스쿼드 니케를 양성한다는 에닉의 추정(`닥터 마리아` → `실버건 스쿼드`, `character_claim`, `claimant: 에닉`, `claim_line: 41`, L38~45), 그리고 이를 반복 투입·갱신하며 양성하고 있다는 닥터 마리아의 확인(`닥터 마리아` → `실버건 스쿼드`, `character_claim`, `claimant: 닥터 마리아`, `claim_line: 73`, L64~73) 항목을 추가함(L33~45, L64~73)
- **`W44-7`** (`white_memory_20`, `batch_0434`): **고침** — `white_memory_20` L3~5에서 스노우 화이트가 독백 속에서 릴리바이스를 3인칭으로 가리킨 표현(`언니`)은 직접 부른 호칭이 아니므로 `forms_of_address[0]`을 제거함(L3~5)
- **`W44-1`** (`ark_guardian_26`, `batch_0439`): **고침** — `ark_guardian_26` L130에서 라푼젤이 릴리바이스를 부른 호칭 `릴리스`(`라푼젤 → 릴리바이스`, L130)를 `forms_of_address`에 추가함
- **`W44-2`** (`ark_guardian_26`, `batch_0439`): **고침** — `ark_guardian_26` L88에서 먼 곳의 벽에 기대앉은 릴리바이스가 혼잣말로 중얼거린 `내 동생들`은 상대를 직접 부른 호칭이 아니므로 `forms_of_address`에서 삭제함
- **`W44-3`** (`ark_guardian_26`, `batch_0439`): **고침** — `ark_guardian_26` L190~192를 도로시의 경고 주장(`actor_or_speaker: "도로시"`, L190, `claim_line: 190`)과 홍련의 반박 주장(`actor_or_speaker: "홍련"`, L191~192, `claim_line: 192`) 두 항목으로 분리함
- **`W44-4`** (`good_world_13`, `batch_0439`): **고침** — `good_world_13` L22~23에서 총사령관이 후원한 대상은 지휘관이 아니라 복수의 `아이들`·`직접 후원하는 친구들`이므로 `events_and_claims[1]`(L15~23)과 `clues_and_hooks[0]`(L16~31)의 설명을 원문대로 고치고, 근거 없는 `총사령관 → 지휘관` 관계 메모(L16~31)를 삭제함
- **`W44-5`** (`lord_for_justice_13`, `batch_0439`): **고침** — L87~93(K가 저울과 고개 기울이기를 말한 뒤 "간다. 다음에 또 보자."로 인사하는 과거 장면)을 `chronology_segments`의 `flashback` 구간으로 추가하고, `events_and_claims[8]`(L87~93) 요약을 해당 구간의 현재 발화 시점과 L93 작별 인사를 반영해 수정함(`refers_to_past: false`)
- **`W44-6`** (`lord_for_justice_13`, `batch_0439`): **고침** — 회상 속 D와 K의 일회성 말다툼(L102~107)은 이미 `events_and_claims`에 기록되어 있고 관계 상태를 직접 말하거나 바꾸지 않으므로 `relationship_and_lore_notes`의 `K → D`(L102~107) 항목을 삭제함

---

## 3. 독립 검토 결과 (적용 전 후보 대상, 세션 `0c11db8a`)

### 3.1 지적 13건의 판정 표

| id | 장면 ID | 판정 | 비고 |
| :--- | :--- | :--- | :--- |
| `W42-1` | `chapter_50_14` | 해결됨 | `은화`를 `remote_or_voice_only`(`comm`, L638~645)로 이동 완료 |
| `W42-2` | `chapter_50_14` | 해결됨 | `마리안 → 랩쳐` 관계 노트 추가 완료 (단, 신규 항목에 L380 범위 밖 조건 혼입 오류 있음) |
| `W42-3` | `chapter_50_14` | 해결됨 | L572~573(`established_event`)과 L574~578(`character_claim`) 분리 완료 (단, `[116]` 요약에 L572~573 범위 밖 내용 잔류) |
| `W42-4` | `maria-n_05` | 해결됨 | L12~14, L15, L16 3개 항목으로 화자별 분리 완료 (단, `[3]` 요약에 L15 범위 밖 내용 혼입) |
| `W42-5` | `maria-n_05` | 해결됨 | `닥터 마리아`의 `character_claim`(`claim_line: 22`)으로 변경 완료 |
| `W42-6` | `maria-n_05` | 해결됨 | `실버건 스쿼드 → 릴리바이스`, `닥터 마리아 → 실버건 스쿼드` 관계 노트 추가 완료 (단, 신규 `[1]`, `[5]`에 범위 밖 내용 혼입 오류 있음) |
| `W44-7` | `white_memory_20` | 해결됨 | 독백 내 3인칭 지칭(`언니`, L3~5) `forms_of_address`에서 제거 완료 |
| `W44-1` | `ark_guardian_26` | 해결됨 | `라푼젤 → 릴리바이스`의 `"릴리스"`(L130) 호칭 추가 완료 |
| `W44-2` | `ark_guardian_26` | 해결됨 | 독백(`내 동생들`, L88) `forms_of_address`에서 제거 완료 |
| `W44-3` | `ark_guardian_26` | 해결됨 | 도로시(L190)와 홍련(L191~192) 주장 분리 완료 (단, `[30]` 요약에 L190 범위 밖 단어 혼입) |
| `W44-4` | `good_world_13` | 해결됨 | 지휘관 후원 단정 문구 수정 및 `총사령관 → 지휘관` 관계 노트 삭제 완료 |
| `W44-5` | `lord_for_justice_13` | 해결됨 | `chronology_segments`에 L87~93 `flashback` 추가 및 `events_and_claims[8]` 수정 완료 |
| `W44-6` | `lord_for_justice_13` | 해결됨 | 일회성 언쟁 관계 노트(`K → D`, L102~107) 삭제 완료 |

### 3.2 장면별·유형별 건수 표

| 장면 ID (`배치`) | 지적 건수 | 해결됨 | 미해결 / 기타 | (2) 새로 만들거나 고친 항목의 오류 | (3) 보수하면서 잃은 것 | (4) 보수와 무관하게 남아 있는 오류 (별도 집계) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `chapter_50_14` (`batch_0423`) | 3 | 3 | 0 | 2 | 0 | 3 |
| `maria-n_05` (`batch_0427`) | 3 | 3 | 0 | 3 | 0 | 5 |
| `white_memory_20` (`batch_0434`) | 1 | 1 | 0 | 0 | 0 | 2 |
| `ark_guardian_26` (`batch_0439`) | 3 | 3 | 0 | 1 | 0 | 6 |
| `good_world_13` (`batch_0439`) | 1 | 1 | 0 | 0 | 0 | 1 |
| `lord_for_justice_13` (`batch_0439`) | 2 | 2 | 0 | 0 | 0 | 3 |
| **합계** | **13** | **13** | **0** | **6** | **0** | **20** |

### 3.3 새로 만들거나 고친 항목의 오류 사례 (6건)

1. **`chapter_50_14`, `relationship_and_lore_notes[8]`, L385~388 (근거 밖 줄: L380) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0380]   [OPTION TEXT="모든게 잘 풀렸을 때, 마리안은 어떻게 돼?"]`
     - `[L0385] 마리안: 저는 유일하게 남은 퀸이 되어.`
     - `[L0386] 마리안: 랩쳐들을 통솔할 거예요.`
     - `[L0387] 마리안: 더는, 사람과 니케 분들을 공격하지 않는 랩쳐들이 되겠죠.`
     - `[L0388] 마리안: 누구도 죽지 않는 세계가 될 거예요.`
   - 무엇이 왜 틀렸는가: 새로 추가한 `relationship_and_lore_notes[8]`의 `line_start~line_end`는 `385~388`인데, `relation_or_change`에는 `"모든 일이 잘 풀리면 유일하게 남은 퀸이 되어 더는 사람과 니케들을 공격하지 않도록 랩쳐들을 통솔하겠다고 밝힘"`이라고 적어 범위 밖인 `[L0380]`의 조건절(`"모든게 잘 풀렸을 때"`)을 혼입했다. 조건절까지 반영하려면 `line_start`를 `379`로 잡았어야 하며, `385~388`만 잡을 경우 그 범위 안의 내용만 적어야 한다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).
2. **`chapter_50_14`, `events_and_claims[116]`, L574~578 (근거 밖 줄: L572~573) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0572] ···모든 랩쳐의 움직임이 멈춘다.`
     - `[L0573] 갑자기, 멈춘다.`
     - `[L0574] 라피: ···지휘관. 이건.`
     - `[L0575] [CHOICE_START]`
     - `[L0576]   [OPTION TEXT="···세이렌."]`
     - `[L0577]   [OPTION_END]`
     - `[L0578] [CHOICE_END]`
   - 무엇이 왜 틀렸는가: 기존 `events_and_claims[115]`(L572~578)를 `[115]`(L572~573)와 `[116]`(L574~578)으로 나누면서 `[116]`의 `line_start`를 `574`로 좁혔으나, `[116]`의 `summary`(`"모든 랩쳐의 움직임이 멈추고 라피가 당황하자, 지휘관이 세이렌의 힘임을 알아본다."`)에 분리되어 나간 `[L0572]~[L0573]`의 내용(`"모든 랩쳐의 움직임이 멈추고"`)을 그대로 남겨 두었다. 바로 앞 줄이라도 `line_start~line_end` 밖의 내용은 `summary`에 넣지 않아야 한다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).
3. **`maria-n_05`, `events_and_claims[3]`, L16 (근거 밖 줄: L15) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0015] 에닉: 텍스트를 확인한 이력을 확인했습니다.`
     - `[L0016] 닥터 마리아: 아, 그건··· 자동화를 그렇게 해놔서 그럴거야.`
   - 무엇이 왜 틀렸는가: `events_and_claims[3]`의 `line_start~line_end`를 `16~16`으로 잡았는데, `summary`에는 `"닥터 마리아는 텍스트 확인 이력이 자동화를 그렇게 해놓아서 생긴 것일 거라고 둘러댄다."`라고 적어 범위 밖인 `[L0015]`의 `"텍스트 확인 이력"`을 포함했다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).
4. **`maria-n_05`, `relationship_and_lore_notes[1]`, L38~45 (근거 밖 줄: L33~34) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0033] 에닉: 실버건 스쿼드.`
     - `[L0034] 에닉: 목적은 최초이자 최강의 니케로 지칭되던 릴리바이스의 재현.`
     - `[L0038] 에닉: 릴리바이스의 바디는 재현할 수 없기에, 대량의 전투 경험을 축적한 니케를 양성하여`
     - `[L0039] 에닉: 지상 탈환의 주력으로 사용할 목적으로 추정됩니다.`
   - 무엇이 왜 틀렸는가: `relationship_and_lore_notes[1]`의 `line_start~line_end`를 `38~45`로 잡았으나, `38~45` 범위 안에는 `"실버건 스쿼드"`라는 명칭이 전혀 등장하지 않는데도 `target`을 `"실버건 스쿼드"`로 두고 `relation_or_change`에 `"릴리바이스를 재현한 지상 탈환 주력으로 실버건 스쿼드를 양성하기 위해..."`라고 적어 범위 밖인 `[L0033]~[L0034]`의 내용을 혼입했다(`line_start`를 `33`으로 잡았어야 함, `GRAPH_RAG_PASS1_RULES.md` 3절 6항).
5. **`maria-n_05`, `relationship_and_lore_notes[5]`, L64~73 (근거 밖 줄: L33, L41~44) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0033] 에닉: 실버건 스쿼드.`
     - `[L0041] 에닉: 1. 닥터 마리아의 뇌에 NIMPH를 안착시켜, 뇌의 정보를 복사후 추출.`
     - `[L0044] 에닉: 4. 기존의 뇌에 있던 정보를 모두 삭제한 후, 안착시킨 NIMPH의 정보로 완전히 덮어씀.`
     - `[L0064] 에닉: 위의 프로세스로 생산된 니케를 지상에 투입.`
     - `[L0073] 닥터 마리아: ···맞아.`
   - 무엇이 왜 틀렸는가: 새로 추가된 `relationship_and_lore_notes[5]`의 `line_start~line_end`는 `64~73`으로, `[L0064]`에는 `"위의 프로세스로 생산된 니케"`라고만 되어 있다. 그럼에도 `relation_or_change`에 `"자신의 뇌 정보를 덮어씌운 NIMPH로 생산한 실버건 스쿼드 니케를..."`이라고 적어 범위 밖인 `[L0033]`(`실버건 스쿼드`) 및 `[L0041]~[L0044]`(`뇌 정보를 덮어씌운 NIMPH`)의 내용을 혼입했다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).
6. **`ark_guardian_26`, `events_and_claims[30]`, L191~192 (근거 밖 줄: L190) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0190] 도로시: 양산형 헬레틱이라도 오면 끝이에요.`
     - `[L0191] 홍련: 이미 두 달이나 모습이 보이지 않네.`
     - `[L0192] 홍련: 우리가 잡은 게 끝일 수도 있지 않은가.`
   - 무엇이 왜 틀렸는가: 기존 `events_and_claims[29]`(L190~192)를 `[29]`(L190)와 `[30]`(L191~192)으로 분리하면서 `[30]`의 `line_start`를 `191`로 줄였는데, `[30]`의 `summary`(`"홍련은 양산형 헬레틱이 이미 두 달이나 모습이 보이지 않으니 자신들이 잡은 게 끝일 수도 있지 않느냐고 말한다."`)에 범위 밖인 `[L0190]`의 `"양산형 헬레틱"`을 넣었다(`GRAPH_RAG_PASS1_RULES.md` 3절 6항).

### 3.4 적용 여부 판단

- **판단**: **적용 진행**
- **근거**: `GRAPH_RAG_PASS1_REPAIR_ROUND3.md` 2절("검토의 3번(보수하면서 잃은 것)이 1건이라도 있으면 적용하지 말고 멈춰서 보고한다. 1번의 미해결·그대로 둔 것이 틀림, 2번(새 항목 오류)만 있으면 적용을 진행하고 보고서에 모두 적는다.") 및 `GRAPH_RAG_SPEC.md` 5절 Pass 1 보수 규칙에 따라, 3번(보수하면서 잃은 것)이 **0건**이고 지적 13건이 모두 해결되었으며 2번(새로 만들거나 고친 항목의 오류) 6건만 있으므로 적용을 진행하고 보고서에 기록했다.

---

## 4. 적용 뒤 네 배치 검증 결과와 병합기 출력

### 4.1 `apply` 출력 (`repair-pass1.mjs apply`)

```text
[repair] batch_0423: applied (0 warning(s) left in repaired scenes)
[repair] batch_0427: applied (0 warning(s) left in repaired scenes)
[repair] batch_0434: applied (0 warning(s) left in repaired scenes)
[repair] batch_0439: applied (0 warning(s) left in repaired scenes)
```

### 4.2 네 배치 검증 결과 및 남은 경고 목록 전체 (`validate-output.mjs`)

```text
[PASS] batch_0423: mechanical validation succeeded (0 warning(s)).
[WARN][TERM_NOT_IN_SCENE] (maria-n_04) $.scenes[5].events_and_claims[24]: uses "술잔" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[PASS] batch_0427: mechanical validation succeeded (1 warning(s)).
[WARN][TERM_NOT_IN_SCENE] (white_memory_page_1001216) $.scenes[7].relationship_and_lore_notes[0]: uses "홍련의 언니" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (white_memory_page_1001216) $.scenes[7].clues_and_hooks[1]: uses "홍련의 언니" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[PASS] batch_0434: mechanical validation succeeded (2 warning(s)).
[PASS] batch_0439: mechanical validation succeeded (0 warning(s)).
```

남은 경고 요약 표(모두 이번 보수 대상이 아닌 다른 장면의 기존 `TERM_NOT_IN_SCENE` 경고):

| 배치 | 장면 ID | 경로 | 규칙 |
| :--- | :--- | :--- | :--- |
| `batch_0423` | (없음) | - | 0건 |
| `batch_0427` | `maria-n_04` | `$.scenes[5].events_and_claims[24]` (`"술잔"`) | `TERM_NOT_IN_SCENE` |
| `batch_0434` | `white_memory_page_1001216` | `$.scenes[7].relationship_and_lore_notes[0]` (`"홍련의 언니"`) | `TERM_NOT_IN_SCENE` |
| `batch_0434` | `white_memory_page_1001216` | `$.scenes[7].clues_and_hooks[1]` (`"홍련의 언니"`) | `TERM_NOT_IN_SCENE` |
| `batch_0439` | (없음) | - | 0건 |

### 4.3 병합기 출력 (`merge-and-index.mjs`)

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

- 병합 배치 수: **439배치**, 병합 장면 수: **5,560장면** (기대값 5,560장면과 일치, 건너뛴 배치 0개)
- 병합 후 이번 회차의 보수 파일(`batch_04*.input.json`, `batch_04*.output.json`, `batch_04*.candidate.json`, `round3_findings.json`)을 모두 `data/graph/pass1/repairs/round3/`으로 이동 완료했다.

---

## 5. 사용량과 소스 열람 (`agy-usage.mjs`)

실행 명령:
```bash
node scripts/graph/agy-usage.mjs --supervisor c337c319-0d1e-4a13-b6e8-3a10f8f89f83 --from-request GRAPH_RAG_PASS1_REPAIR_ROUND3
```

출력 그대로:
```text
감독관 c337c319-0d1e-4a13-b6e8-3a10f8f89f83 스텝 0 초과 ~ 26 (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)

| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 | 진행 중 오류 | 긴 대기 |
|---|---|---:|---:|---:|---:|---|---|---|
| c337c319 | supervisor | 12 | 153,770 | 349,824 | 8,687 | 0 | 0 | 스텝 8 13분 |
| 5f4c674b | review | 8 | 319,271 | 587,469 | 39,093 | 0 | 0 | 스텝 18 27분 |
| a1fe44c6 | review | 8 | 264,375 | 482,946 | 8,667 | 0 | 0 | 스텝 18 31분 |
| 754d4dd1 | review | 7 | 169,035 | 301,221 | 26,938 | 0 | 0 | 스텝 12 28분, 스텝 13 28분 |
| 0c11db8a | review | 34 | 473,759 | 3,252,350 | 56,040 | 0 | 도구 실패 1 | 0 |
| **합계** | | 69 | 1,380,210 | 4,973,810 | 139,425 | | 도구 실패 1 | 5회 |

thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.
scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.
진행 중 오류는 세션 안에서 이어져 복구된 것도 센다(출력 잘림·스트림 끊김은 실행 환경의 오류 메시지, 도구 실패는 실패한 도구 스텝).
긴 대기는 도구 스텝의 시작~완료 기록이 10분 이상인 것이다. 명령이 오래 걸렸는지 결과 전달이 늦었는지는 로그로 알 수 없다.
```

- **`scripts/ 열람`**: 감독관 및 서브에이전트 모든 세션에서 `0`건이다.

---

## 6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체 (고치지 않음)

### 6.1 보수 서브에이전트가 보고한 오류 (1건)

1. **`chapter_50_14` (`batch_0423`), L91~92 (Job 2 보수자 `a1fe44c6` 보고)**
   - 내용: 라피와 크라운이 각각 지휘관을 맞이하는 대사를 한 항목(`established_event`)으로 묶으면서 요약에는 두 사람을 모두 쓰고 `actor_or_speaker`에는 `크라운`만 적음.
   - (Job 1 `5f4c674b`, Job 3 `754d4dd1`은 "없음"으로 보고함.)

### 6.2 독립 검토 서브에이전트가 보고한 오류 (20건)

*(참고: 규칙 번호 표기는 독립 검토 서브에이전트 `0c11db8a`의 보고 원문 그대로 옮겼다.)*

#### `chapter_50_14` (`batch_0423`) — 3건
1. **`chapter_50_14`, `events_and_claims[112]`, L546~555 — `refers_to_past` 시제 누락**
   - 원문 인용:
     - `[L0547] 과거. 우주를 떠도는 퀸의 눈을 가리기 위해`
     - `[L0548] 글러트니의 안에서 만들어 올려보냈던`
     - `[L0549] 수많은 물거품의 반응이 느껴진다.`
     - `[L0550] 에덴의 창에 의해 산산이 부서졌지만`
   - 설명: 지문과 `summary`(`"과거 우주의 퀸의 눈을 가리기 위해 글러트니 안에서 만들어 올려보냈다 에덴의 창에 부서지고 살아남은 수많은 물거품들을 감지해..."`)가 장면 이전의 과거 사건을 명시적으로 가리키는데도 `refers_to_past`가 `false`로 적혀 있다(`true`여야 함).
2. **`chapter_50_14`, `clues_and_hooks[7]`, L547~564 (근거 밖 줄: L572, L587~588) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0563] 리틀 머메이드: [정지.]`
     - `[L0564] 리틀 머메이드: 카학--!!`
     - `[L0572] ···모든 랩쳐의 움직임이 멈춘다.`
     - `[L0587] 여신상도 움직임을 멈췄다.`
     - `[L0588] 수복이 되지 않는다.`
   - 설명: `clues_and_hooks[7]`의 `line_start~line_end`는 `547~564`인데, `detail`에는 `"모든 랩쳐와 여신상의 움직임·수복을 멈춘다"`라고 적어 범위 밖인 `[L0572]` 및 `[L0587]~[L0588]`의 결과까지 포함했다.
3. **`chapter_50_14`, `relationship_and_lore_notes[9]`, L407~408 (근거 밖 줄: L404) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0404]   [OPTION TEXT="그렇게 모두가 행복한 결말을 맞이할 수 있는거지?"]`
     - `[L0407] 마리안: 그럼요.`
     - `[L0408] 마리안: 저를 믿어요. 지휘관.`
   - 설명: `line_start~line_end`가 `407~408`인데 `relation_or_change`에 `"모두가 행복한 결말을 맞이할 수 있다며 자신을 믿어 달라고 말함"`이라고 적어 범위 밖인 `[L0404]`의 내용을 넣었다.

#### `maria-n_05` (`batch_0427`) — 5건
4. **`maria-n_05`, `events_and_claims[13]`, L57 (근거 밖 줄: L55~56) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0055] 에닉: NIMPH는 인간에게는 사용할 수 없습니다.`
     - `[L0057] 닥터 마리아: ···나는 가능해. 그렇게 태어났으니까.`
   - 설명: `line_start~line_end`가 `57~57`인데 `summary`에 `"인간 상태에서 NIMPH를 사용하는 것이 가능하다고 밝힌다"`라고 적어 범위 밖인 `[L0055]~[L0056]`의 내용을 넣었다.
5. **`maria-n_05`, `events_and_claims[16]`, L73 (근거 밖 줄: L64~72) — 범위 밖 내용 혼입 및 `refers_to_past` 누락**
   - 원문 인용:
     - `[L0064] 에닉: 위의 프로세스로 생산된 니케를 지상에 투입.`
     - `[L0066] 에닉: 사망 이전까지의 전투 데이터를 기존의 NIMPH에 갱신.`
     - `[L0073] 닥터 마리아: ···맞아.`
   - 설명: `line_start~line_end`가 `73~73`인데 `summary`에 `[L0064]~[L0072]`의 `"에닉이 설명한 반복 생산·데이터 갱신 방식"`을 넣었고, 과거부터 반복해 온 양성 과정을 인정하는 대사임에도 `refers_to_past`를 `false`로 두었다(동일 대사를 인용한 `relationship_and_lore_notes[5]`는 `refers_to_past: true`).
6. **`maria-n_05`, `events_and_claims[18]`, L76 (근거 밖 줄: L74~75) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0074] 에닉: 이 부분에서 의문이 있었습니다만, NIMPH의 데이터화가 가능하다는 것을 인지하여 의문이 해소되었습니다.`
     - `[L0075] 에닉: 얼마든지 복사와 편집이 가능하겠군요.`
     - `[L0076] 닥터 마리아: 그것도, 맞아.`
   - 설명: `line_start~line_end`가 `76~76`인데 `summary`에 범위 밖인 `[L0074]~[L0075]`의 `"NIMPH의 데이터화 및 복사·편집이 가능하다는 점"`을 넣었다.
7. **`maria-n_05`, `clues_and_hooks[1]`, L90~93 (근거 밖 줄: L66~80) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0066] 에닉: 사망 이전까지의 전투 데이터를 기존의 NIMPH에 갱신.`
     - `[L0080] 에닉: 그렇게 죽음과 부활을 반복하여 얻은 전투 지식으로, 포스트 릴리바이스를 만드는 것입니까?`
     - `[L0090] 에닉: 양산이 가능하겠군요.`
     - `[L0092] 닥터 마리아: 포스트 릴리바이스를 만들어, 그 NIMPH를 마구마구 복사해 수백 수천의 포스트 릴리바이스를 양산하는거야.`
   - 설명: `line_start~line_end`가 `90~93`인데 `detail`에 `"전투 데이터를 반복 갱신해 완성한 포스트 릴리바이스의 NIMPH"`라고 적어 범위 밖인 `[L0066]~[L0080]`의 내용을 넣었다.
8. **`maria-n_05`, `relationship_and_lore_notes[3]`, L57~58 (근거 밖 줄: L55~56) — 범위 밖 내용 혼입**
   - 원문 인용:
     - `[L0055] 에닉: NIMPH는 인간에게는 사용할 수 없습니다.`
     - `[L0056] 에닉: 자아가 남아있는 상태에서 NIMPH가 투입될 경우 뇌는 정보량을 감당할 수 없어 치명적인 피해를 입습니다.`
     - `[L0057] 닥터 마리아: ···나는 가능해. 그렇게 태어났으니까.`
     - `[L0058] 에닉: 과연. 모친인 에블라 박사의 역작이라는 겁니까.`
   - 설명: `line_start~line_end`가 `57~58`인데 `relation_or_change`에 `"인간 상태에서 NIMPH를 감당할 수 있도록 태어나게 한"`이라고 적어 범위 밖인 `[L0055]~[L0056]`의 내용을 넣었다.

#### `white_memory_20` (`batch_0434`) — 2건
9. **`white_memory_20`, `events_and_claims[1]`, L10~21 (근거 밖 줄: L7~8) — 범위 밖 내용 혼입 및 `refers_to_past` 누락**
   - 원문 인용:
     - `[L0007] 스노우 화이트는 주변을 샅샅이 뒤졌다.`
     - `[L0008] 필사적으로 찾았다.`
     - `[L0013] 언니의 얼굴이 보이지 않아.`
     - `[L0016] 언니의 위대함을, 업적을, 소원을, 난 아무것도 이루어주지 못했는데?`
   - 설명: `line_start~line_end`가 `10~21`인데 `summary` 첫머리에 범위 밖인 `[L0007]~[L0008]`의 `"아무리 찾아도"`를 넣었고, `[L0016]`에서 과거부터 지금까지 언니의 소원을 이루어주지 못했다는 과거 사실을 언급하는데도 `refers_to_past`가 `false`로 되어 있다.
10. **`white_memory_20`, `unregistered_entity_candidates`, L28 — 미등록 엔티티 후보 누락**
    - 원문 인용:
      - `[L0028] [랩쳐].`
    - 설명: `participants.mentioned_only[0]`에 `"surface_text": "랩쳐", "entity_id": null, "entity_type": "faction_or_species", "line_start": 28`이 기록되어 있으나, `unregistered_entity_candidates`가 빈 배열(`[]`)로 비어 있어 `"랩쳐"` 후보가 누락되었다.

#### `ark_guardian_26` (`batch_0439`) — 6건
11. **`ark_guardian_26`, `chronology_type` 및 `chronology_segments`, L2~314 / L315~336 — 시점 구분(`mixed`) 누락**
    - 원문 인용:
      - `[L0315] 스노우 화이트가 눈을 뜬다.`
      - `[L0317] 아무래도 지금의 바디에 제대로 적응한 모양이다.`
      - `[L0319] 세실: 일어났나요?`
      - `[L0328] 스노우 화이트: ···눈물 자국.`
    - 설명: L2~314는 과거 아크 가디언 작전 및 방주 밀봉 시점(회상/꿈)이고, L315~336은 스노우 화이트가 눈물 자국이 남은 채 잠에서 깨어나 세실과 통신하는 현재 시점이다. 한 장면에 과거 회상과 현재가 섞여 있으므로 `chronology_type: "mixed"` 및 `chronology_segments`로 구분해야 하는데 장면 전체가 `chronology_type: "present"`, `chronology_segments: []`로 잘못 기록되어 있다.
12. **`ark_guardian_26`, `participants.present_in_scene[1]`, L10~26 — 동명이인(다른 인물) 엔티티 오연결**
    - 원문 인용:
      - `[L0026] 지휘관: 나는! 너희들을 두고 갈 수 없다!`
      - `[L0027] 릴리바이스: 엔더슨!!`
      - `[L0028] 엔더슨: !!`
    - 설명: L10~26의 화자 `"지휘관"`은 주인공 지휘관(`char_지휘관`)이 아니라 갓데스 스쿼드의 지휘관인 엔더슨(`char_엔더슨`)이다(`relationship_and_lore_notes[0]`에서도 동일 인물임을 명시함). 그런데 `participants.present_in_scene[1]`에서 `"speaker_label": "지휘관"`의 `entity_id`를 주인공인 `"char_지휘관"`으로 잘못 연결했다.
13. **`ark_guardian_26`, `same_scene_speaker_groups`, L10~48 — 동일 인물 화자 라벨 묶기 누락**
    - 원문 인용:
      - `[L0026] 지휘관: 나는! 너희들을 두고 갈 수 없다!`
      - `[L0027] 릴리바이스: 엔더슨!!`
      - `[L0028] 엔더슨: !!`
    - 설명: 같은 장면 안에서 화자 라벨 `"지휘관"`(L10~26)과 `"엔더슨"`(L28~48)이 실제로는 같은 인물을 가리키는데도 `same_scene_speaker_groups`가 빈 배열(`[]`)로 비어 있다. *(참고: `GRAPH_RAG_PASS1_RULES.md` 4절 스키마상 `same_scene_speaker_groups`는 `unknown_ids` 배열만 받으며 일반 화자 라벨 간 매핑은 받지 않는다. 아래 7절에 별도 정리함.)*
14. **`ark_guardian_26`, `forms_of_address[8]`, L333 — 대화 상대 없는 독백의 3인칭 언급을 호칭으로 오기록**
    - 원문 인용:
      - `[L0331] 격납고 앞에 멈춰 선다.`
      - `[L0333] 스노우 화이트: ···언니.`
      - `[L0335] 스노우 화이트: 이번에야말로···.`
      - `[L0336] 스노우 화이트: 언니에게 진정한 안식을.`
    - 설명: L333의 `"···언니."`는 격납고 문 앞에 홀로 선 스노우 화이트가 이미 사망해 현장에 없는 릴리바이스를 떠올리며 혼잣말로 읊조린 독백(`언니에게 진정한 안식을`)이지 대화 상대를 직접 부른 호칭이 아니다(`W44-2`, `W44-7`과 동일한 오류).
15. **`ark_guardian_26`, `events_and_claims[36]`(L269~299) 및 `relationship_and_lore_notes[5]`(L276~299), `[6]`(L289~291) — 회의록 지문의 화자·`claim_line` 오귀속**
    - 원문 인용:
      - `[L0270] 오스왈드는 회의록을 수십번 다시 본다.`
      - `[L0271] 아크 가디언 작전 및 방주 밀봉에 대한 후속 조치에 대한 회의록이다.`
      - `[L0281] 현 중앙 정부의 영향력을 아득히 초월할 것으로 추정.`
      - `[L0290] 갓데스 스쿼드의 지휘관은 현재 V.T.C.에 의해 혼수상태 유지 중.`
    - 설명: 오스왈드가 읽는 회의록 문구(L272~299)를 `actor_or_speaker: "지문"` / `claimant: "지문"`의 `character_claim`으로 적고, 특히 `events_and_claims[36]`은 순수 3인칭 객관 서술인 `[L0271]`을 `claim_line: 271`로 지정했다.
16. **`ark_guardian_26`, `events_and_claims[31]`(L193~194) 및 `[32]`(L195~196) (근거 밖 줄: L190~192, L194) — 범위 밖 내용 혼입**
    - 원문 인용:
      - `[L0190] 도로시: 양산형 헬레틱이라도 오면 끝이에요.`
      - `[L0192] 홍련: 우리가 잡은 게 끝일 수도 있지 않은가.`
      - `[L0193] 도로시: 그럴 거라는 생각은 들지 않는데요.`
      - `[L0194] 도로시: 너무 낙관적이에요.`
      - `[L0196] 홍련: 올지도 모른다는 불안감을 계속 끌어안고 있는 것보단 낫지 않겠나.`
    - 설명: `[31]`(L193~194)의 `summary`에 범위 밖인 L190~192의 `"양산형 헬레틱이 끝일 거라는"`을 넣었고, `[32]`(L195~196)의 `summary`에도 범위 밖인 L190의 `"양산형 헬레틱이"`와 L194의 `"낙관적으로 생각하는 편이"`를 넣었다.

#### `good_world_13` (`batch_0439`) — 1건
17. **`good_world_13`, `events_and_claims[14]`, L248~256 — 인물의 평가 대사를 `established_event`로 오분류**
    - 원문 인용:
      - `[L0248] 백학: 제가 지하에만 있었던 게 신경 쓰였어요?`
      - `[L0253] 백학: ···정말 좋은 사람이라니까요, 우리 친구는.`
      - `[L0256] 백학이 내 볼을 쓰다듬었다.`
    - 설명: `[L0253]`에서 백학이 지휘관을 `"정말 좋은 사람"`이라고 평가하는 대사가 `summary`(`"백학이 자신이 지하에만 있었던 게 신경 쓰였냐고 물으며 지휘관은 정말 좋은 사람이라고 볼을 쓰다듬는다."`)의 핵심 내용으로 들어가 있는데, `character_claim`으로 분리하지 않고 `established_event` 하나로 묶었다.

#### `lord_for_justice_13` (`batch_0439`) — 3건
18. **`lord_for_justice_13`, `choice_branches[0]`(L30), `choice_branches[1]`(L184) — 분기 없는 선택지를 `choice_branches`에 오기록**
    - 원문 인용:
      - `[L0030] [CHOICE_START]`
      - `[L0031]   [OPTION TEXT="···아무것도 선택하지 않는다."]`
      - `[L0032]   [OPTION_END]`
      - `[L0033]   [OPTION TEXT="···아무것도 선택하지 않는다."]`
      - `[L0034]   [OPTION_END]`
      - `[L0035] [CHOICE_END]`
      - `[L0036] K: ··· ···.`
      - `[L0184] [CHOICE_START]`
      - `[L0185]   [OPTION TEXT="그렇구나."]`
      - `[L0186]   [OPTION_END]`
      - `[L0187]   [OPTION TEXT="그랬었지."]`
      - `[L0188]   [OPTION_END]`
      - `[L0189] [CHOICE_END]`
    - 설명: 검토자는 L30~35와 L184~189가 선택지 내부에 후속 대사가 전혀 없고(`continuation_summary: null`) 즉시 같은 대사(L36, L190)로 합류하므로 `choice_branches`가 빈 배열이어야 한다고 지적했다. *(참고: `GRAPH_RAG_SPEC.md` 2.3절 11항은 "`is_branching: true`인 선택지 블록마다 `choice_branches` 항목이 하나 있고, 그 블록의 옵션이 모두 있어야 한다... 옵션 본문 줄이 없는 옵션(`body_line_count: 0`)은 `continuation_summary`가 `null`이어야 한다"고 규정하여 기계 검증기는 본문 없는 2옵션 선택지도 필수 기록 대상으로 검사한다. 아래 7절에 제안으로 정리함.)*
19. **`lord_for_justice_13`, `events_and_claims[12]`, L103~107 — 인물의 반박 주장 대사를 `established_event`로 오분류**
    - 원문 인용:
      - `[L0103] K: 또 저러네. 그러다가 날 샌다고.`
      - `[L0106] K: 아 그러셔. 댁은 계속 그렇게 깨끗하게 해.`
      - `[L0107] K: 난 내 방식대로 할 테니까.`
    - 설명: L103~107에는 서술 지문이 한 줄도 없으며, 수단이 깨끗해야 한다는 D의 주장(`events_and_claims[11]`, `character_claim`)에 맞서 K가 그렇게 하면 날 샌다며 자기 방식대로 하겠다고 반박하는 주장 대사인데도 `established_event`(`claim_line: null`)로 잘못 분류되어 있다(`character_claim`이어야 함).
20. **`lord_for_justice_13`, `relationship_and_lore_notes[1]`, L124~148 — `refers_to_past` 시제 누락**
    - 원문 인용:
      - `[L0138]   [OPTION TEXT="남들이 범죄 조직이라고 손가락질해도, 포그 할로우 일이 있었어도."]`
    - 설명: `relation_or_change`(`"지휘관이 남들이 범죄 조직이라 손가락질하고 포그 할로우 일이 있었어도 정의를 향해 계속 나아가는 목단이 정의롭다고 생각한다고 밝힌다."`)와 인용문에 과거 사건인 `[L0138]`의 `"포그 할로우 일이 있었어도"`가 포함되어 있는데(`events_and_claims[15]`에서는 `refers_to_past: true`), `relationship_and_lore_notes[1]`에서는 `refers_to_past`가 `false`로 잘못 적혀 있다.

---

## 7. 규칙·도구의 문제점 제안

1. **항목 분리 보수 시 앞 줄 문맥이 요약에 남는 문제 (`GRAPH_RAG_PASS1_REPAIR_ROUND3.md` 1절 3-b항 / `GRAPH_RAG_SPEC.md` 3절 6항)**
   - **현상**: 이번 보수에서 새로 만들거나 고친 항목의 오류 6건이 **전부** `line_start~line_end` 범위 밖(바로 앞 질문·지문·전제 대사)의 단어나 조건을 요약(`summary`, `relation_or_change`)에 포함시킨 것이었다. 특히 기존 항목을 화자별로 쪼갤 때(`W42-3`, `W42-4`, `W44-3`) 줄 범위는 좁혔지만 분할 전 요약의 앞부분 문맥을 완전히 지우지 않거나, 응답 대사만 줄 범위로 잡으면서 앞 질문의 핵심어를 요약에 넣는 일이 반복되었다.
   - **제안**: 보수 지시서(`1절 3-b항`)에 "항목을 나눌 때 뒤쪽 항목의 `line_start`를 앞 항목 뒤로 좁혔다면, 앞 항목 줄에 있던 주어·사건·조건어를 뒤쪽 항목 요약에서 완전히 빼거나, 문맥으로 꼭 필요하면(`character_claim`인 경우) 앞 줄까지 `line_start`와 `quote`에 포함하라"고 구체적인 체크포인트를 명시하면 같은 유형의 실수를 줄일 수 있다.
2. **독립 검토 프롬프트의 읽을 절 지정과 절 번호 인용 혼선 (`GRAPH_RAG_PASS1_REPAIR_ROUND3.md` 2절)**
   - **현상**: `GRAPH_RAG_PASS1_REPAIR_ROUND3.md` 2절 검토자 프롬프트는 `"GRAPH_RAG_PASS1_RULES.md의 3절과 4절을 읽어라"`라고 지시한다. 그 결과 검토자(`0c11db8a`)는 2.3절(검증기 필수 검사 11항: `body_line_count: 0`인 옵션도 `is_branching: true`면 `choice_branches`에 `continuation_summary: null`로 기록해야 함)을 읽지 못해 `lord_for_justice_13`의 정상적인 `choice_branches` 항목을 오류로 오판했고, `same_scene_speaker_groups`도 `unknown_ids` 전용 필드임을 놓쳐 일반 화자(`지휘관`·`엔더슨`) 묶기 누락으로 지적했다. 또한 줄 번호로 부분 열람하면서 규칙 항 번호를 `규칙 3.1`, `규칙 3.4`, `규칙 4.6`처럼 임의 번호로 인용했다.
   - **제안**: 검토자 프롬프트에서도 보수자와 마찬가지로 `GRAPH_RAG_PASS1_RULES.md` 전체(특히 `2.3절` 포함)를 읽게 하고, 규칙 인용 시 실제 문서의 절·항 번호(`3절 6항`, `2.3절 11항` 등)를 그대로 쓰도록 안내하는 것을 제안한다.
3. **`agy-usage.mjs`의 보수 서브에이전트 역할(`role`) 분류 표시 (`scripts/graph/agy-usage.mjs`)**
   - **현상**: `agy-usage.mjs` 출력 표에서 보수 서브에이전트(`5f4c674b`, `a1fe44c6`, `754d4dd1`)와 독립 검토 서브에이전트(`0c11db8a`)의 역할이 모두 `review`로 표시된다.
   - **제안**: 보수 출력 파일(`pass1/repairs/<batch_id>.output.json`)을 쓰거나 `repair-pass1.mjs check`를 실행하는 보수 서브에이전트는 `repair`로 구분해 표시하면 보수 세션과 독립 검토 세션의 토큰 사용량을 표에서 바로 구분할 수 있다.
