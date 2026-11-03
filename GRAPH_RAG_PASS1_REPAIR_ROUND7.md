# GraphRAG Pass 1 보수 7회차 지시서 (무관 오류 중 확인된 10건, 4장면)

보수 3·5·6회차 보수자·검토자가 "지적과 무관하게 본 오류"로 보고한 것 가운데, Claude가 원문과 지금 샤드로 다시 확인해 오류로 본 10건을 고치는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

## 이번 범위

- 대상은 지적 10건, 4장면, 4배치다. 목록은 `data/graph/pass1/repairs/round7_findings.json`에 있다.

| id | 장면 (배치) | 위치 | 내용 |
|---|---|---|---|
| `R7-1` | `ark_guardian_10` (`batch_0161`) | `clues_and_hooks[1].detail` L24~28 | 지휘관의 추측("모르긴 몰라도 무지하게 많겠지")을 "수많은 사람이 대피해 있다"로 단정함. "대피"는 장면에 없음 |
| `R7-2` | `ether_04` (`batch_0294`) | `events_and_claims[29].summary` L171~175 | "생체 실험"은 장면 원문과 제목에 없음 |
| `R7-3` | `ark_guardian_21` (`batch_0162`) | `events_and_claims[1]` L9~11 | 지휘관 주장에 릴리바이스 L10이 묶임 |
| `R7-4` | 〃 | `events_and_claims[5]` L18~23 | 지휘관 주장에 릴리바이스 L20·L22가 묶임 |
| `R7-5` | 〃 | `events_and_claims[11]` L38~48 | 라푼젤 사건에 지휘관 L38~39·L41, 홍련 L40이 묶임(요약에서 L40 빠짐) |
| `R7-6` | 〃 | `events_and_claims[14]` L55~58 | 지휘관 주장 하나에 라푼젤의 공격(L55~56)과 L57 주장이 묶임 |
| `R7-7` | 〃 | `events_and_claims[19]` L74~76 | 도로시 주장 가운데 지휘관 L75가 묶임 |
| `R7-8` | 〃 | `events_and_claims[20]` L77~80 | 홍련 주장 가운데 라푼젤 L79가 묶임 |
| `R7-9` | `chapter_50_14` (`batch_0423`) | `events_and_claims[18].actor_or_speaker` L91~92 | 라피·크라운이 맞이하는 사건인데 주체에 크라운만 있음 |
| `R7-10` | 〃 | `clues_and_hooks[7].detail` L547~564 | 범위 뒤쪽 줄(L572, L587~588)의 결과를 detail에 씀 |

- Claude가 10건 모두 원문과 지금 샤드(6회차 병합 뒤, `b930fdb`)로 확인했다. 묶인 줄마다 그 화자 자신의 항목이 없는 것도 확인했다.
  - `R7-1`·`R7-2`는 같은 장면의 모든 문자열 필드에서 "대피"·"생체"를 찾았다. 지적한 곳 말고는 없다.
- 고치는 방향: 이 장면이 말하거나 보여 준 대로 쓴다(명세 3절 6항). 다른 화자의 말은 그 화자의 항목으로 나눈다(3절 6항). 같은 장면 앞쪽 줄에서 대상을 풀어 쓰는 것(지시 대상 풀기)은 된다. 다른 장면의 말은 가져오지 않는다.
- 지적은 검토자와 Claude의 판단이다. 보수자는 원문으로 다시 확인하고, 지적이 틀렸으면 고치지 않고 이유를 보고한다.

**이번 범위 밖(미처리):** `data/graph/reports/pass1_open_issues.md`의 다른 미처리 지적. 아래는 Claude가 다시 보고 이번에 넣지 않은 것이다(미처리 목록 56절).
- `maria-n_05` 지적 8건과 `chapter_50_14`의 `events_and_claims[112]`·`[116]`, `relationship_and_lore_notes[8]`·`[9]`. 대부분 앞쪽 줄의 대상을 풀어 쓴 것(3절 6항)이라 오류가 아니다. 남은 것도 판단이 갈리거나 검색에 주는 영향이 작다.
- `ark_guardian_10` `events_and_claims[4]`의 "양산형 니케들". 이 장면 제목(`최강의 니케 : A`)에 "니케"가 있다.
- `batch_0161`·`batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 14건(과거 지휘관 라벨 → `char_엔더슨`, 보수 4회차에서 사용자 확인).

순서: 보수 입력 만들기 → 보수(작업 2개) → `check`(후보 생성) → 후보 독립 검토 → 적용 → 검증·병합 → 정리·보고

## 0. 시작 전 확인

- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다. 아니면 멈추고 보고한다.
- `git status --short data/graph/pass1/shards`의 출력이 비어 있어야 한다(샤드가 커밋된 상태). 아니면 멈추고 보고한다.
- 감독관 세션 ID(이 대화의 `brain/<ID>` 폴더 이름)를 확인해 둔다. 5절 사용량 집계에 쓴다.
- 아래를 실행한다.

```
node scripts/graph/repair-pass1.mjs prepare batch_0161 batch_0162 batch_0294 batch_0423 --findings data/graph/pass1/repairs/round7_findings.json
```

  - 기대값(다르면 멈추고 보고한다):
    - `batch_0161: 1 scene(s) to repair {"REVIEW_FINDING":1}`
    - `batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":6}`
    - `batch_0294: 1 scene(s) to repair {"REVIEW_FINDING":1}`
    - `batch_0423: 1 scene(s) to repair {"REVIEW_FINDING":2}`
    - 작업 2개: job 1 `batch_0423`(약 214KB), job 2 `batch_0161, batch_0162, batch_0294`(약 140KB)
  - 이전 회차의 보수 출력·후보가 남아 있으면 `prepare`가 멈춘다. 그러면 멈추고 보고한다.
  - `prepare`는 처음 손대기 전의 배치 입력과 샤드를 `data/graph/pass1/repairs/original/`에 남기지만, 이미 있으면 덮어쓰지 않는다. 네 배치 모두 이전 회차 것이 이미 있다. 이번 보수 전 상태는 git 마지막 커밋에 있다.

## 1. 보수

작업마다 서브에이전트 1개로 한다(감독관과 같은 모델, 맥락 미상속 `self`). 두 작업은 배치가 겹치지 않으므로 동시에 돌려도 된다. 감독관은 원문, 샤드, 보수 입력·출력을 직접 읽지 않는다(명세 2.1).
아래 지시의 `<BATCH_IDS>`에 작업의 배치를 넣는다(job 1: `batch_0423`, job 2: `batch_0161 batch_0162 batch_0294`).

```
너는 GraphRAG Pass 1 보수 서브에이전트다. 이미 추출이 끝난 결과에서 독립 검토가 짚은 장면만 고친다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 단, 검증 실패 후 재시도는 5번대로 배치마다 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라. 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
   검증기와 scripts/ 아래 소스는 읽지 마라(규칙 5절 Pass 1). 검사 기준은 규칙 2.3절에, 고칠 곳은 issues와 검증 출력 메시지에 있다.
2. 맡은 배치: <BATCH_IDS>
   배치마다 보수 입력: data/graph/pass1/repairs/<BATCH_ID>.input.json
   - scenes[]가 고칠 장면이다. 장면마다 numbered_script, mechanical_ground_truth, current_output(지금 추출 결과), issues가 있다.
   - issues의 rule이 "REVIEW_FINDING"인 것은 독립 검토자가 짚은 의미 오류다. id, type(오류 유형), lines(줄 범위),
     path(항목 위치, 없으면 null), message(무엇이 왜 틀렸는지), source(근거 보고서)가 있다.
3. 지적마다 다음 순서로 처리한다.
   a. lines 범위와 장면 전체를 원문에서 다시 읽고, 지적이 맞는지 확인한다.
      path의 배열 번호는 틀릴 수 있다. 번호보다 줄 범위와 내용으로 항목을 찾아라.
   b. 맞으면 고친다.
      - 요약·detail: 이 장면이 말하거나 보여 준 표현으로 다시 쓴다. 추측·유보("모르긴 몰라도")는 추측으로 남긴다.
        다른 장면의 이름이나 사전 지식으로 바꿔 쓰지 마라. 3절 6항의 지시 대상 풀기는 같은 장면 앞쪽 줄에서만 한다.
        범위 밖 뒤쪽 줄의 결과를 쓰려면 범위와 quote를 그 줄까지 넓히고, 아니면 범위 안의 내용만 쓴다.
      - 다른 화자의 말이 묶인 항목: 3절 6항대로 화자마다 항목을 나눈다. 묶여 있던 화자의 말은 그 화자의 항목으로 새로 적고,
        원래 항목은 그 화자의 말로 범위·quote·claim_line·summary를 함께 고친다. 질문이나 지문을 문맥으로 넣는 것은 된다.
        말한 행위(제안·지시·결정·선언)와 말한 내용(주장·평가·핀잔)은 3절 6항 "말한 행위와 말한 내용을 구분하라"로 나눈다.
        지문이 보여 준 행동은 행동한 사람의 established_event다. established_event의 actor_or_speaker는 여러 명일 수 있다(2.3의 7항).
        새 항목의 quote는 범위 원문 안에 있어야 하고(2.3의 6항), 나눈 뒤 사건·주장 항목이 비는 줄이 생기지 않게 한다(2.3의 21항).
      - 지적이 짚은 필드와, 그 수정 때문에 함께 바뀌어야 하는 필드만 바꾼다.
      - 같은 장면의 다른 필드(summary, events_and_claims, clues_and_hooks, relationship_and_lore_notes 등)에
        같은 표현이 있으면 함께 고치고 보고한다. cross_scene_hints는 다른 장면과의 연결이므로 그대로 둔다.
   c. 지적이 틀렸으면 고치지 말고, 원문 줄 번호와 함께 이유를 보고한다.
   - 고친 뒤 장면 원문을 처음부터 다시 훑어라(규칙 5절 Pass 1의 확인 목록). 보수 입력에 없는 장면은 고치지 마라.
     확인 중 지적과 무관한 다른 오류를 보면 고치지 말고 보고에만 적어라.
4. 출력 파일: 배치마다 data/graph/pass1/repairs/<BATCH_ID>.output.json
   {"schema_version": "1.3.0", "batch_id": "<BATCH_ID>", "scenes": [{"scene_id": "...", <바꾼 최상위 필드>}]}
   - 보수 입력의 모든 장면을 빠짐없이 넣는다. 바꾼 것이 없는 장면은 {"scene_id": "..."}만 넣는다.
   - 바꾼 최상위 필드는 값 전체를 다시 쓴다. 필드는 통째로 교체되므로, events_and_claims를 쓰면
     고치지 않은 항목도 모두 포함해야 한다. current_output의 맞는 항목을 빠뜨리거나 바꾸지 마라.
   - 규칙 4절 스키마를 따르고, 2.3절 18항의 병합기 전용 필드는 쓰지 않는다.
5. 다 쓰면 배치마다 검증한다:
     node scripts/graph/repair-pass1.mjs check <BATCH_ID>
   - 통과하면 후보가 data/graph/pass1/repairs/<BATCH_ID>.candidate.json에 남는다.
   - [FAIL]이면 고친 뒤 다시 실행한다. 배치마다 최대 3회까지 다시 시도한다.
   - [WARN]이 남으면 메시지대로 원문을 다시 보고, 고칠 것이면 고치고 아니면 이유를 보고한다.
     ENTITY_ID_SURFACE_MISMATCH("지휘관" → char_엔더슨)는 사용자가 확인한 연결이므로 고치지 않는다.
6. 자기 배치의 출력 파일 말고는 아무것도 수정하지 마라.
   data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
   data/graph/pass1/repairs/original/, round1/ ~ round6/ 아래 파일은 읽지도 마라.
7. 끝나면 아래 형식으로만 보고하라:
   배치마다 한 줄: [완료] <BATCH_ID>, 장면 N개, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>, 남은 경고: <규칙명별 건수>
   지적마다 한 줄: <id> 고침 | 일부 고침 | 그대로 둠 — 무엇을 어떻게 바꿨는지 또는 그대로 둔 이유(원문 줄 번호)
     화자를 나눈 지적은 새로 만든 항목마다 화자·epistemic_type·줄 범위를 적는다
   지적 목록에 없지만 함께 고친 필드: 필드 경로·한 줄 설명(없으면 "없음")
   지적과 무관하게 본 오류: 장면·줄·한 줄 설명(없으면 "없음")
   또는
   [실패] <BATCH_ID>, 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

- 서브에이전트가 멈추거나 보고 없이 끝나면 새 서브에이전트로 다시 시작한다. 이미 쓴 출력 파일은 다시 시작하는 서브에이전트가 처음부터 새로 쓴다.

## 2. 후보에 대한 독립 표본 검토

네 배치가 모두 `check`를 통과하면 적용 전에 후보를 검토한다. 하나라도 실패하면 멈추고 보고한다.
보수에 참여하지 않은 서브에이전트 1개에게 맡긴다(같은 모델, 맥락 미상속). 대상은 4장면 전부다.
아래 판정 기준은 명세 5절 보수 항목의 "회차 지시서의 독립 검토 프롬프트에는 아래 판정 기준을 직접 적는다"를 그대로 옮긴 것이다.

```
너는 GraphRAG Pass 1 보수 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
GRAPH_RAG_PASS1_RULES.md의 2.3절, 3절, 4절을 읽어라. 검증기와 scripts/ 소스는 읽지 마라.
data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
data/graph/pass1/repairs/original/, round1/ ~ round6/ 아래 파일은 읽지 마라.

판정 전에 다음 기준을 확인하라. 이것을 놓치고 오류로 센 적이 있다.
- 범위 안 대명사·생략 대상을 같은 장면 앞쪽 줄에서 찾아 풀어 쓴 것은 범위 밖 내용이 아니다(3절 6항 지시 대상 풀기).
- established_event의 actor_or_speaker는 여러 명일 수 있다(2.3의 7항). 여러 명을 적은 것만으로는 오류가 아니다.
- 지문 없는 대사라도 지금 그 자리에서 하는 질문·요청·지시·결정·선언·약속·인사는 established_event다
  (3절 6항 "말한 행위와 말한 내용을 구분하라"). 과거에 그렇게 했다는 진술, 다른 인물·상황에 대한 평가·추측·전언,
  감정·관계를 밝힌 말이면 그 화자의 character_claim이다. 대사만으로 된 사건이라는 이유만으로 사실·주장 혼동으로 세지 마라.
- 한 장면에서 같은 화자·대상 쌍의 호칭을 줄이나 꼴(너·네가·네)이 다르게 여러 번 적은 것은 중복이 아니다
  (3절 10항은 원문에 쓰인 꼴을 적게 하고, 4절의 중복은 같은 배열에 같은 내용을 두 번 적는 것만 말한다).
- 기계 추출값이 is_branching: true인 선택지 블록에는 choice_branches가 있어야 한다(2.3의 11항).
- 항목은 줄 범위로 먼저 가리켜라. 배열 번호(events_and_claims[N])를 적으려면 다시 세어 확인하라.
- 장면에 없는 표현을 짚으면 같은 장면의 다른 문자열 필드에 같은 표현이 남았는지도 찾아 적어라(cross_scene_hints는 제외).

아래 장면마다 세 가지를 대조하라.
- 원문: data/graph/pass1/batches/<배치>.json의 numbered_script
- 보수 전: data/graph/pass1/shards/<배치>.json의 같은 scene_id (아직 적용 전이므로 지금 샤드가 보수 전이다)
- 보수 후: data/graph/pass1/repairs/<배치>.candidate.json의 같은 scene_id
보수 사유(지적)는 data/graph/pass1/repairs/<배치>.input.json의 같은 장면 issues에 있다.

검토 장면: ark_guardian_10 (batch_0161), ark_guardian_21 (batch_0162), ether_04 (batch_0294), chapter_50_14 (batch_0423)

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
원문 인용은 numbered_script의 줄을 한 줄에 하나씩 통째로 복사하라: [L0012] 아니스: 와···.
1. 지적마다 판정: 해결됨 / 미해결 / 그대로 둔 것이 맞음 / 그대로 둔 것이 틀림. 지적 자체가 틀렸다고 보면 그 이유도 적는다
2. 새로 만들거나 고친 항목의 오류: 주장 화자·claim_line, 사실·주장 구분, 요약의 부정·조건·전언·추측·시제 누락,
   범위 밖 내용 혼입, 장면에 없는 표현, 끊긴 말을 채운 것, cross_scene_hints를 근거처럼 쓴 것,
   화자를 나눈 뒤에도 다른 화자의 독립된 말이 남은 것
3. 보수하면서 잃은 것: 보수 전에 맞게 적혀 있었는데 보수 후 빠지거나 틀려진 내용
   (항목을 나누면서 원래 요약에 있던 내용이 어느 항목에도 남지 않은 것 포함)
4. 보수와 무관하게 남아 있는 오류는 따로 적어라(건수만 별도로 센다).

마지막에 장면별·유형별 건수 표와, 지적 10건의 판정 표(id, 판정)를 붙여라.
```

- 검토의 3번(보수하면서 잃은 것)이 1건이라도 있으면 **적용하지 말고 멈춰서 보고한다.**
- 1번의 미해결·그대로 둔 것이 틀림, 2번(새 항목 오류)만 있으면 적용을 진행하고 보고서에 모두 적는다.

## 3. 적용, 검증, 병합

독립 검토에서 3번이 0건이면 실행한다.

```
node scripts/graph/repair-pass1.mjs apply batch_0161 batch_0162 batch_0294 batch_0423
for b in batch_0161 batch_0162 batch_0294 batch_0423; do node scripts/graph/validate-output.mjs $b --no-log; done
node scripts/graph/merge-and-index.mjs
```

- `apply`는 `check`를 다시 하고, 하나라도 실패하면 아무것도 쓰지 않는다. 실패하면 멈추고 보고한다.
- `validate-output.mjs`의 결과와 경고 목록(배치·장면·규칙)을 보고서에 그대로 옮긴다.
  - 보수 전 경고(6회차 적용 뒤): `batch_0161` `ENTITY_ID_SURFACE_MISMATCH` 7건, `batch_0162` 같은 규칙 7건, `batch_0294`·`batch_0423` 0건.
  - 기대값: 그대로다. 화자를 나누면서 새 경고가 생기면 보고서에 따로 적는다.
- `merge-and-index.mjs` 출력의 병합 배치 수와 장면 수를 보고서에 옮긴다. 기대값은 439배치, 5,560장면이다.

병합까지 끝나면 이번 회차의 보수 파일을 옮겨 둔다(다음 회차 `prepare`가 남은 파일 때문에 멈추지 않게 한다).

```
mkdir -p data/graph/pass1/repairs/round7
mv data/graph/pass1/repairs/batch_0*.input.json data/graph/pass1/repairs/batch_0*.output.json data/graph/pass1/repairs/batch_0*.candidate.json data/graph/pass1/repairs/round7_findings.json data/graph/pass1/repairs/round7/
```

## 4. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/reports/pass1_repair_round7_<YYYY-MM-DD>.md`에도 저장한다(실행한 날짜).

**보고서의 수치와 사례는 검증기·`repair-pass1.mjs`·병합기 출력, 서브에이전트 보고에서만 가져온다.** 확인하지 않은 원인을 지어내지 마라. 원인을 모르면 "확인 안 됨"이라고 적는다. 규칙이나 지시를 인용할 때는 어느 파일의 어느 절인지 정확히 적는다(명세 5절과 회차 지시서를 섞지 마라).

0. 이번 범위와 미처리(맨 앞): 고친 것은 지적 10건(4장면)과 함께 고친 필드뿐이고, 위 "이번 범위 밖" 목록은 미처리라는 점
1. `prepare` 출력 그대로, 기대값과 같았는지
2. 보수 결과: 배치마다 `check` 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, 남은 경고. 지적 10건마다 보수자의 처리(고침·일부 고침·그대로 둠)와 이유 한 줄, 화자를 나눈 지적은 새 항목 목록, 함께 고친 필드
3. 독립 검토 결과(적용 전 후보 대상): 지적 10건 판정 표, 장면별·유형별 건수, 사례, 적용 여부 판단
4. 적용 뒤 검증 결과와 남은 경고 목록 전체(보수 전 경고와 비교), 병합기 출력
5. 사용량과 소스 열람: 보고서를 쓰기 직전에 `node scripts/graph/agy-usage.mjs --supervisor <감독관 세션 ID> --from-request GRAPH_RAG_PASS1_REPAIR_ROUND7`를 실행하고 출력 표를 그대로 옮긴다. `scripts/ 열람`이 0이 아닌 세션이 있으면 그때 무엇을 하려 했는지 적는다
6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체(고치지 않음)
7. 규칙·도구의 문제점 제안

Pass 2는 사용자 승인 전에는 시작하지 않는다.
