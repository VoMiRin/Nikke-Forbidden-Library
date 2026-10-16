# GraphRAG Pass 1 분류별 10배치 보수 2회차 지시서

1회차(`GRAPH_RAG_PASS1_REPAIR.md`, 보고서 `data/graph/reports/pass1_repair_2026-10-16.md`)에 이어지는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

## 1회차 뒤 바뀐 것

- 1회차 후보 10배치는 사용자 승인으로 적용·병합했다. 1회차 보수 입력·출력·후보는 `data/graph/pass1/repairs/round1/`에 있다.
- 1회차 독립 검토에서 `wordless_03`이 긴 주장 항목은 그대로 두고, 질문 여러 개를 상대의 답까지 덮는 넓은 항목 하나로 덧씌워 `CLAIM_OTHER_SPEAKERS` 경고를 피한 것이 확인됐다.
  - 검증기 2.3의 23항을 조였다: 그 화자 자신의 항목이라도 주장 화자의 말을 두 차례 이상 함께 덮으면 자기 항목으로 치지 않는다.
  - 규칙 3절 6항에 두 가지를 보탰다: 질문을 덧씌우지 말고 원래 항목을 문답·주제 단위로 나눌 것, 앞 말을 받는 한 줄짜리 동의·부정은 범위를 앞 말부터 잡을 것.
- 조인 검증기로 다시 검증하면 대상은 4장면이다: `batch_0215`의 `wordless_00`, `wordless_03`, `wordless_06`(`CLAIM_OTHER_SPEAKERS` 7건)과 `batch_0273`의 `vesti_04`(2건, 1회차 대상이 아니었고 원래부터 있던 묶음).

**이번 범위 밖(미처리):** 지난 분류별 10배치 독립 검토의 의미 오류 후보 87건과, 1회차 독립 검토가 따로 적은 "보수와 무관한 기존 오류" 11건은 이번 대상이 아니다.

순서: 보수 출력 1개 → `check`(후보 생성) → 후보 독립 검토 → 적용 → 전체 검증 → 병합·보고

## 0. 시작 전 확인

- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다.
- 아래를 실행한다. 이미 한 번 실행해 두었고, 다시 실행해도 같은 결과가 나온다.

```
node scripts/graph/repair-pass1.mjs prepare batch_0215 batch_0273
```

  - 기대값: `batch_0215` 3장면(`CLAIM_OTHER_SPEAKERS` 7건), `batch_0273` 1장면(2건), 작업 1개. 다르면 멈추고 보고한다.
  - 이전 회차의 보수 출력·후보가 남아 있으면 `prepare`가 멈춘다. 그러면 멈추고 보고한다.

## 1. 보수

서브에이전트 1개에게 맡긴다(감독관과 같은 모델, 맥락 미상속 `self`). 감독관은 원문, 샤드, 보수 입력·출력을 직접 읽지 않는다(명세 2.1).

```
너는 GraphRAG Pass 1 보수 서브에이전트다. 이미 추출이 끝난 결과에서 문제가 지적된 장면만 고친다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 단, 검증 실패 후 재시도는 5번대로 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라. 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
   검증기와 scripts/ 아래 소스는 읽지 마라(규칙 5절 Pass 1). 검사 기준은 규칙 2.3절에, 고칠 곳은 issues와 검증 출력 메시지에 있다.
   특히 규칙 3절 6항과 2.3절 23항을 다시 읽어라. 이번 보수를 위해 고친 부분이다.
2. 맡은 배치: batch_0215, batch_0273
   배치마다 보수 입력: data/graph/pass1/repairs/<BATCH_ID>.input.json
   - scenes[]가 고칠 장면이다. 장면마다 numbered_script, mechanical_ground_truth, current_output(지금 추출 결과), issues가 있다.
3. 장면마다 CLAIM_OTHER_SPEAKERS(경고)를 고친다.
   - 그 항목의 범위를 원문에서 다시 읽어라. 한 사람의 긴 주장 항목이 여러 문답·주제를 담고 있으면
     원래 항목을 문답·주제 단위로 나눠라. 주장과 무관한 앞뒤 줄(감탄사, 퇴장 연출 등)은 범위에서 뺀다.
   - 다른 화자의 질문·동의·반박·평가는 그 화자의 항목으로 적되, 그 항목의 범위에는 그 화자의 말과
     앞뒤 문맥 한 차례까지만 넣어라. 질문 여러 개를 상대의 답까지 덮는 넓은 항목 하나로 묶지 마라.
     이렇게 묶으면 경고는 다시 난다(2.3절 23항).
   - 질문을 따로 떼어도 답의 요약에는 무엇에 대한 답인지(대상)를 남겨라.
   - 앞 말을 받는 한 줄짜리 동의·부정은 요약에 앞 말의 대상을 쓰려면 범위를 앞 말부터 잡아라(3절 6항).
   - 정말 그 주장의 문맥일 뿐이면 그대로 두고, 이유를 보고하라.
   - wordless_03은 1회차 검토에서 이런 지적도 받았다. 같이 고쳐라.
     a. L63~75 마나의 답 요약에서 "유니의 처벌 이전 기억"에 대한 답이라는 대상이 빠졌다.
     b. L2~9 항목이 지문이 직접 보여 준 유니의 외형(L3~6, L8)까지 미하라의 주장 하나로 묶었다.
        지문이 보여 준 외형은 established_event로 따로 적는다.
   - 고친 뒤 장면 원문을 처음부터 다시 훑어라(규칙 5절 Pass 1의 확인 목록). 보수 입력에 없는 장면은 고치지 마라.
4. 출력 파일: data/graph/pass1/repairs/<BATCH_ID>.output.json
   {"schema_version": "1.3.0", "batch_id": "<BATCH_ID>", "scenes": [{"scene_id": "...", <바꾼 최상위 필드>}]}
   - 보수 입력의 모든 장면을 빠짐없이 넣는다. 바꾼 것이 없는 장면은 {"scene_id": "..."}만 넣는다.
   - 바꾼 최상위 필드는 값 전체를 다시 쓴다. 필드는 통째로 교체되므로, events_and_claims를 쓰면
     고치지 않은 항목도 모두 포함해야 한다. 기존의 맞는 항목을 빠뜨리지 마라.
   - 규칙 4절 스키마를 따르고, 2.3절 18항의 병합기 전용 필드는 쓰지 않는다.
5. 다 쓰면 배치마다 검증한다:
     node scripts/graph/repair-pass1.mjs check <BATCH_ID>
   - 통과하면 후보가 data/graph/pass1/repairs/<BATCH_ID>.candidate.json에 남는다.
   - [FAIL]이면 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [WARN] CLAIM_OTHER_SPEAKERS가 남으면 위 3번대로 다시 나눈다. 정말 문맥이면 그대로 둔다.
6. 네 출력 파일 말고는 아무것도 수정하지 마라.
   data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
   data/graph/pass1/repairs/original/, data/graph/pass1/repairs/round1/ 아래 파일은 읽지도 마라.
7. 끝나면 아래 형식으로만 보고하라:
   [완료] 배치 batch_0215, batch_0273, 장면 4개, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>,
   CLAIM_OTHER_SPEAKERS 처음 W건 → 나눔 X건·그대로 둠 Y건(그대로 둔 것마다 장면·항목 경로·이유 한 줄),
   wordless_03 추가 지적 a·b 처리 결과 한 줄씩
   또는
   [실패] <BATCH_ID>, 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

## 2. 후보에 대한 독립 표본 검토

`check`가 두 배치 모두 통과하면 적용 전에 후보를 검토한다. 실패하면 멈추고 보고한다.
보수에 참여하지 않은 서브에이전트 1개에게 맡긴다(같은 모델, 맥락 미상속). 대상은 4장면 전부다.

```
너는 GraphRAG Pass 1 보수 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
GRAPH_RAG_PASS1_RULES.md의 3절과 4절, 2.3절 22·23항을 읽어라. 검증기와 scripts/ 소스는 읽지 마라.
data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/ 아래 파일은 읽지 마라.

아래 장면마다 세 가지를 대조하라.
- 원문: data/graph/pass1/batches/<배치>.json의 numbered_script
- 보수 전: data/graph/pass1/shards/<배치>.json의 같은 scene_id (아직 적용 전이므로 지금 샤드가 보수 전이다)
- 보수 후: data/graph/pass1/repairs/<배치>.candidate.json의 같은 scene_id
보수 사유는 data/graph/pass1/repairs/<배치>.input.json의 같은 장면 issues에 있다.

검토 장면: wordless_00, wordless_03, wordless_06 (batch_0215), vesti_04 (batch_0273)

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
1. 보수 사유가 해결됐는가: 긴 주장 항목이 문답·주제 단위로 나뉘었는가. 다른 화자의 질문·반박이 그 화자의 항목으로 나왔는가.
   질문 여러 개를 상대의 답까지 덮는 넓은 항목 하나로 덧씌운 것은 미해결로 센다. 그대로 둔 것은 정말 문맥인가
2. 새로 만든 항목의 오류: 주장 화자·claim_line, 사실·주장 구분, 요약의 부정·조건·전언 누락, 범위 밖 내용 혼입
   (한 줄 범위인데 요약에 앞 줄의 대상을 쓴 것 포함)
3. 보수하면서 잃은 것: 보수 전에 맞게 적혀 있었는데 보수 후 빠지거나 틀려진 내용. 답의 요약에서 대상이 빠진 것 포함
4. wordless_03: L63~75 답의 대상("유니의 처벌 이전 기억")과 L2~9 지문이 보여 준 유니의 외형 처리가 고쳐졌는가
5. 보수와 무관하게 남아 있는 오류는 따로 적어라(건수만 별도로 센다).

마지막에 장면별·유형별 건수 표를 붙여라.
```

- 검토의 3번(보수하면서 잃은 것)이 1건이라도 있으면 **적용하지 말고 멈춰서 보고한다.**
- 1번(미해결)이나 2번(새 항목 오류)만 있으면 적용을 진행하고 보고서에 모두 적는다.

## 3. 적용과 병합

독립 검토에서 3번이 0건이면 실행한다.

```
node scripts/graph/repair-pass1.mjs apply batch_0215 batch_0273
for b in batch_0001 batch_0125 batch_0215 batch_0226 batch_0236 batch_0238 batch_0273 batch_0355 batch_0359 batch_0395; do node scripts/graph/validate-output.mjs $b; done
node scripts/graph/merge-and-index.mjs
node scripts/graph/pilot-report.mjs --batches batch_0001,batch_0125,batch_0215,batch_0226,batch_0236,batch_0238,batch_0273,batch_0355,batch_0359,batch_0395 --out-dir reports --out pass1_repaired_vs_1.2.0.json
```

- `apply`는 두 배치의 `check`를 다시 하고, 하나라도 실패하면 아무것도 쓰지 않는다.
- `validate-output.mjs`의 경고 목록(배치·장면·규칙)을 보고서에 그대로 옮긴다. `batch_0395`의 `blabla_harran_001` `WIDE_RANGE` 1건은 분류별 10배치 때 그대로 두기로 한 것이다.

## 4. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/reports/pass1_repair_round2_<YYYY-MM-DD>.md`에도 저장한다(실행한 날짜).

**보고서의 수치와 사례는 검증기·`repair-pass1.mjs` 출력, 집계 파일, 서브에이전트 보고에서만 가져온다.** 확인하지 않은 원인을 지어내지 마라. 원인을 모르면 "확인 안 됨"이라고 적는다.

0. 이번 범위와 미처리(맨 앞): 고친 것은 4장면뿐이고, 위 "이번 범위 밖" 목록은 미처리라는 점
1. 보수 결과: `check` 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, `CLAIM_OTHER_SPEAKERS` 처음·나눔·그대로 둠(그대로 둔 것은 이유와 함께), `wordless_03` 추가 지적 처리
2. 독립 검토 결과(적용 전 후보 대상): 유형별 건수(장면별), 사례, 적용 여부 판단
3. 적용 뒤 10배치 검증 결과와 남은 경고 목록 전체
4. `pass1_repaired_vs_1.2.0.json`(2회차 적용 뒤)과 `pass1_repaired_round1_vs_1.2.0.json`(1회차 적용 직후), `pass1_categories_vs_1.2.0.json`(보수 전)의 배치별 `events_and_claims` 수, 관계 메모 수와 `epistemic_type` 분포 비교
5. 사용량과 소스 열람: 보고서를 쓰기 직전에 `node scripts/graph/agy-usage.mjs --supervisor <감독관 세션 ID>`를 실행하고 출력 표를 그대로 옮긴다. `scripts/ 열람`이 0이 아닌 세션이 있으면 그때 무엇을 하려 했는지 적는다
6. 규칙·도구의 문제점 제안

나머지 407개 배치는 사용자 승인 전에는 시작하지 않는다.
