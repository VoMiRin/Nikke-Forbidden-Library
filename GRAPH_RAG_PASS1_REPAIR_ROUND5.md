# GraphRAG Pass 1 보수 5회차 지시서 (장면에 없는 이름 3건)

Pass 1 본 실행 44회차 독립 검토자가 "추출자가 보지 못한 경고" 중 **고쳐야 함**으로 판정했지만 고치지 않은 3건을 고치는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

## 이번 범위

- 대상은 지적 3건, 3장면, 3배치다. 목록은 `data/graph/pass1/repairs/round5_findings.json`에 있다.
  - `W44-T1` `ark_guardian_10`(batch_0161): 사건 요약의 "밀봉"
  - `W44-T2` `ark_guardian_21`(batch_0162): 장면 요약의 "3차 밀봉", "새 장비"
  - `W44-T3` `ether_04`(batch_0294): 사건 요약의 "바이러스 투여"
- 셋 다 검증기 2.3의 25항(`TERM_NOT_IN_SCENE`) 경고가 난 곳이다. 그 이름은 다른 장면의 말이고 이 장면 원문과 제목에는 없다(Claude가 원문으로 확인함). 사실이 틀린 것이 아니라 장면 밖 이름을 쓴 것이다.
- 고치는 방향: 요약은 이 장면이 말하거나 보여 준 대로 쓰고, 다른 장면과 이어진다는 것은 `cross_scene_hints`에 적는다(명세 3절 6항).
  - 3절 6항의 지시 대상 풀기는 **같은 장면 앞쪽 줄**에서만 한다. 다른 장면의 이름을 가져오는 근거가 되지 않는다.
- 지적은 검토자의 판단이다. 보수자는 원문으로 다시 확인하고, 지적이 틀렸으면 고치지 않고 이유를 보고한다.

**이번 범위 밖(미처리):** `data/graph/reports/pass1_open_issues.md`의 다른 미처리 지적(40·41회차 메신저 복수 호칭·관계 메모, 보수 3·4회차 보수자·검토자가 본 무관 오류 등). 이 세 배치의 다른 경고(`batch_0161`·`batch_0162`의 `ENTITY_ID_SURFACE_MISMATCH` 각 7건: 과거 지휘관 라벨 → `char_엔더슨`, 보수 4회차에서 사용자 확인)도 고치지 않는다.

순서: 보수 입력 만들기 → 보수(작업 1개) → `check`(후보 생성) → 후보 독립 검토 → 적용 → 검증·병합 → 정리·보고

## 0. 시작 전 확인

- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다. 아니면 멈추고 보고한다.
- `git status --short data/graph/pass1/shards`의 출력이 비어 있어야 한다(샤드가 커밋된 상태). 아니면 멈추고 보고한다.
- 감독관 세션 ID(이 대화의 `brain/<ID>` 폴더 이름)를 확인해 둔다. 5절 사용량 집계에 쓴다.
- 아래를 실행한다.

```
node scripts/graph/repair-pass1.mjs prepare batch_0161 batch_0162 batch_0294 --findings data/graph/pass1/repairs/round5_findings.json
```

  - 기대값(다르면 멈추고 보고한다):
    - `batch_0161: 1 scene(s) to repair {"REVIEW_FINDING":1}`
    - `batch_0162: 1 scene(s) to repair {"REVIEW_FINDING":1}`
    - `batch_0294: 1 scene(s) to repair {"REVIEW_FINDING":1}`
    - 작업 1개: job 1 `batch_0161, batch_0162, batch_0294`
  - 이전 회차의 보수 출력·후보가 남아 있으면 `prepare`가 멈춘다. 그러면 멈추고 보고한다.
  - `prepare`는 처음 손대기 전의 배치 입력과 샤드를 `data/graph/pass1/repairs/original/`에 남기지만, 이미 있으면 덮어쓰지 않는다. `batch_0161`·`batch_0162`는 보수 4회차 전 것이 이미 있다. 이번 보수 전 상태는 git 커밋(`fd75a79`)에 있다.

## 1. 보수

서브에이전트 1개로 한다(감독관과 같은 모델, 맥락 미상속 `self`). 감독관은 원문, 샤드, 보수 입력·출력을 직접 읽지 않는다(명세 2.1).

```
너는 GraphRAG Pass 1 보수 서브에이전트다. 이미 추출이 끝난 결과에서 독립 검토가 짚은 장면만 고친다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 단, 검증 실패 후 재시도는 5번대로 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라. 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
   검증기와 scripts/ 아래 소스는 읽지 마라(규칙 5절 Pass 1). 검사 기준은 규칙 2.3절에, 고칠 곳은 issues와 검증 출력 메시지에 있다.
2. 맡은 배치: batch_0161, batch_0162, batch_0294
   배치마다 보수 입력: data/graph/pass1/repairs/<BATCH_ID>.input.json
   - scenes[]가 고칠 장면이다. 장면마다 numbered_script, mechanical_ground_truth, current_output(지금 추출 결과), issues가 있다.
   - issues의 rule이 "REVIEW_FINDING"인 것은 독립 검토자가 짚은 의미 오류다. id, type(오류 유형), lines(줄 범위),
     path(항목 위치, 없으면 null), message(무엇이 왜 틀렸는지), source(근거 보고서)가 있다.
   - 이번 지적 3건은 모두 "장면 원문과 제목에 없는 이름을 요약에 썼다"는 것이다(규칙 2.3절 25항, 3절 6항).
3. 지적마다 다음 순서로 처리한다.
   a. lines 범위와 장면 전체를 원문에서 다시 읽고, 지적한 이름이 이 장면 원문이나 제목에 정말 없는지 확인한다.
      path의 배열 번호는 틀릴 수 있다. 번호보다 줄 범위와 내용으로 항목을 찾아라.
   b. 없으면 고친다. 요약을 이 장면이 말하거나 보여 준 표현으로 다시 쓴다.
      - 다른 장면의 이름이나 사전 지식으로 바꿔 쓰지 마라. 3절 6항의 지시 대상 풀기는 같은 장면 앞쪽 줄에서만 한다.
      - 다른 장면과 이어진다는 것은 cross_scene_hints에 적는다(근거가 아니다). related_scene_ids는 확실할 때만 적는다.
      - 지적이 짚은 필드와, 그 수정 때문에 함께 바뀌어야 하는 필드만 바꾼다.
   c. 이 장면 원문에 그 이름이 있으면 고치지 말고, 원문 줄 번호와 함께 이유를 보고한다.
   - 고친 뒤 장면 원문을 처음부터 다시 훑어라(규칙 5절 Pass 1의 확인 목록). 보수 입력에 없는 장면은 고치지 마라.
     확인 중 지적과 무관한 다른 오류를 보면 고치지 말고 보고에만 적어라.
4. 출력 파일: data/graph/pass1/repairs/<BATCH_ID>.output.json
   {"schema_version": "1.3.0", "batch_id": "<BATCH_ID>", "scenes": [{"scene_id": "...", <바꾼 최상위 필드>}]}
   - 보수 입력의 모든 장면을 빠짐없이 넣는다. 바꾼 것이 없는 장면은 {"scene_id": "..."}만 넣는다.
   - 바꾼 최상위 필드는 값 전체를 다시 쓴다. 필드는 통째로 교체되므로, events_and_claims를 쓰면
     고치지 않은 항목도 모두 포함해야 한다. current_output의 맞는 항목을 빠뜨리거나 바꾸지 마라.
   - 규칙 4절 스키마를 따르고, 2.3절 18항의 병합기 전용 필드는 쓰지 않는다.
5. 다 쓰면 배치마다 검증한다:
     node scripts/graph/repair-pass1.mjs check <BATCH_ID>
   - 통과하면 후보가 data/graph/pass1/repairs/<BATCH_ID>.candidate.json에 남는다.
   - [FAIL]이면 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [WARN]이 남으면 메시지대로 원문을 다시 보고, 고칠 것이면 고치고 아니면 이유를 보고한다.
6. 네 출력 파일 말고는 아무것도 수정하지 마라.
   data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
   data/graph/pass1/repairs/original/, round1/, round2/, round3/, round4/ 아래 파일은 읽지도 마라.
7. 끝나면 아래 형식으로만 보고하라:
   [완료] 배치 batch_0161, batch_0162, batch_0294, 장면 N개, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>, 남은 경고: <규칙명별 건수>
   지적마다 한 줄: <id> 고침 | 일부 고침 | 그대로 둠 — 무엇을 어떻게 바꿨는지 또는 그대로 둔 이유(원문 줄 번호)
   지적과 무관하게 본 오류: 장면·줄·한 줄 설명(없으면 "없음")
   또는
   [실패] <BATCH_ID>, 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

- 서브에이전트가 멈추거나 보고 없이 끝나면 새 서브에이전트로 다시 시작한다. 이미 쓴 출력 파일은 다시 시작하는 서브에이전트가 처음부터 새로 쓴다.

## 2. 후보에 대한 독립 표본 검토

`check`가 세 배치 모두 통과하면 적용 전에 후보를 검토한다. 하나라도 실패하면 멈추고 보고한다.
보수에 참여하지 않은 서브에이전트 1개에게 맡긴다(같은 모델, 맥락 미상속). 대상은 3장면 전부다.

```
너는 GraphRAG Pass 1 보수 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
GRAPH_RAG_PASS1_RULES.md의 2.3절, 3절, 4절을 읽어라. 검증기와 scripts/ 소스는 읽지 마라.
판정 전에 특히 다음 규칙을 확인하라.
- 3절 6항의 지시 대상 풀기: 범위 안 대명사·생략 대상을 같은 장면 앞쪽 줄에서 찾아 밝혀 쓰는 것은 범위 밖 내용이 아니다.
- 2.3절 7항: established_event의 actor_or_speaker는 여러 명일 수 있다.
data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
data/graph/pass1/repairs/original/, round1/, round2/, round3/, round4/ 아래 파일은 읽지 마라.

아래 장면마다 세 가지를 대조하라.
- 원문: data/graph/pass1/batches/<배치>.json의 numbered_script
- 보수 전: data/graph/pass1/shards/<배치>.json의 같은 scene_id (아직 적용 전이므로 지금 샤드가 보수 전이다)
- 보수 후: data/graph/pass1/repairs/<배치>.candidate.json의 같은 scene_id
보수 사유(지적)는 data/graph/pass1/repairs/<배치>.input.json의 같은 장면 issues에 있다.

검토 장면: ark_guardian_10 (batch_0161), ark_guardian_21 (batch_0162), ether_04 (batch_0294)

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용([Lnnnn] 형식), 무엇이 왜 틀렸는지 적어라.
1. 지적마다 판정: 해결됨 / 미해결 / 그대로 둔 것이 맞음 / 그대로 둔 것이 틀림. 지적 자체가 틀렸다고 보면 그 이유도 적는다
2. 새로 만들거나 고친 항목의 오류: 요약의 부정·조건·전언·시제 누락, 범위 밖 내용 혼입, 장면에 없는 이름, cross_scene_hints를 근거처럼 쓴 것
3. 보수하면서 잃은 것: 보수 전에 맞게 적혀 있었는데 보수 후 빠지거나 틀려진 내용
4. 보수와 무관하게 남아 있는 오류는 따로 적어라(건수만 별도로 센다).

마지막에 장면별·유형별 건수 표와, 지적 3건의 판정 표(id, 판정)를 붙여라.
```

- 검토의 3번(보수하면서 잃은 것)이 1건이라도 있으면 **적용하지 말고 멈춰서 보고한다.**
- 1번의 미해결·그대로 둔 것이 틀림, 2번(새 항목 오류)만 있으면 적용을 진행하고 보고서에 모두 적는다.

## 3. 적용, 검증, 병합

독립 검토에서 3번이 0건이면 실행한다.

```
node scripts/graph/repair-pass1.mjs apply batch_0161 batch_0162 batch_0294
for b in batch_0161 batch_0162 batch_0294; do node scripts/graph/validate-output.mjs $b --no-log; done
node scripts/graph/merge-and-index.mjs
```

- `apply`는 세 배치의 `check`를 다시 하고, 하나라도 실패하면 아무것도 쓰지 않는다. 실패하면 멈추고 보고한다.
- `validate-output.mjs`의 결과와 경고 목록(배치·장면·규칙)을 보고서에 그대로 옮긴다.
  - 보수 전 경고(Claude 확인, 2026-11-03): `batch_0161` `ENTITY_ID_SURFACE_MISMATCH` 7·`TERM_NOT_IN_SCENE` 1, `batch_0162` `ENTITY_ID_SURFACE_MISMATCH` 7·`TERM_NOT_IN_SCENE` 1, `batch_0294` `TERM_NOT_IN_SCENE` 1.
  - 기대값: 세 `TERM_NOT_IN_SCENE`이 없어지고 `ENTITY_ID_SURFACE_MISMATCH` 14건은 그대로다. 새 경고가 생기면 보고서에 따로 적는다.
- `merge-and-index.mjs` 출력의 병합 배치 수와 장면 수를 보고서에 옮긴다. 기대값은 439배치, 5,560장면이다.

병합까지 끝나면 이번 회차의 보수 파일을 옮겨 둔다(다음 회차 `prepare`가 남은 파일 때문에 멈추지 않게 한다).

```
mkdir -p data/graph/pass1/repairs/round5
mv data/graph/pass1/repairs/batch_0*.input.json data/graph/pass1/repairs/batch_0*.output.json data/graph/pass1/repairs/batch_0*.candidate.json data/graph/pass1/repairs/round5_findings.json data/graph/pass1/repairs/round5/
```

## 4. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/reports/pass1_repair_round5_<YYYY-MM-DD>.md`에도 저장한다(실행한 날짜).

**보고서의 수치와 사례는 검증기·`repair-pass1.mjs`·병합기 출력, 서브에이전트 보고에서만 가져온다.** 확인하지 않은 원인을 지어내지 마라. 원인을 모르면 "확인 안 됨"이라고 적는다. 규칙이나 지시를 인용할 때는 어느 파일의 어느 절인지 정확히 적는다(명세 5절과 회차 지시서를 섞지 마라).

0. 이번 범위와 미처리(맨 앞): 고친 것은 지적 3건(3장면)뿐이고, 위 "이번 범위 밖" 목록은 미처리라는 점
1. `prepare` 출력 그대로, 기대값과 같았는지
2. 보수 결과: `check` 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, 남은 경고. 지적 3건마다 보수자의 처리(고침·일부 고침·그대로 둠)와 이유 한 줄
3. 독립 검토 결과(적용 전 후보 대상): 지적 3건 판정 표, 유형별 건수(장면별), 사례, 적용 여부 판단
4. 적용 뒤 세 배치 검증 결과와 남은 경고 목록 전체(보수 전 경고와 비교), 병합기 출력
5. 사용량과 소스 열람: 보고서를 쓰기 직전에 `node scripts/graph/agy-usage.mjs --supervisor <감독관 세션 ID> --from-request GRAPH_RAG_PASS1_REPAIR_ROUND5`를 실행하고 출력 표를 그대로 옮긴다. `scripts/ 열람`이 0이 아닌 세션이 있으면 그때 무엇을 하려 했는지 적는다
6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체(고치지 않음)
7. 규칙·도구의 문제점 제안

Pass 2는 사용자 승인 전에는 시작하지 않는다.
