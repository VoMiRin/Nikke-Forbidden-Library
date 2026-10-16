# GraphRAG Pass 1 분류별 10배치 보수 지시서

이 문서는 분류별 10배치(`GRAPH_RAG_PASS1_CATEGORIES.md`, 보고서 `data/graph/reports/pass1_categories_2026-10-16.md`)의 결과 중 **문제가 지적된 장면만** 고치는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

10배치 실행 뒤 명세와 도구가 바뀌었다(명세 8절 마지막 항목).
- 검증기 2.3의 23항 `CLAIM_OTHER_SPEAKERS` 경고 추가: 한 사람의 주장 항목 범위에 다른 화자의 말이 3차례 이상 묻혀 있음
- 문서 속 `FB :`를 화자로 읽지 않음: `긴급뉴스대본_FB_3_final_2.pdf` 5장면의 기계 추출값이 바뀜
- 추출·보수 서브에이전트는 검증기와 `scripts/` 소스를 읽지 않음(명세 5절 Pass 1)

바뀐 검증기로 10배치를 다시 검증하면 오류는 `FB` 5장면뿐이고, 새 경고 `CLAIM_OTHER_SPEAKERS`가 39장면에 58건 있다. 이 44장면만 고친다. 10배치를 다시 추출하지 않는다.

**이번 범위 밖(미처리):** 지난 독립 표본 검토가 13장면에서 찾은 의미 오류 후보 87건(보고서 5절)은 이번 보수의 대상이 아니다. 그중 이번 경고와 겹치는 일부만 함께 고쳐질 수 있다. 이번 보수가 끝나도 그 목록은 미처리로 남으며, 보수 성공을 기존 의미 오류의 해결로 보고하지 않는다.

순서: 보수 출력 6개 → 전체 `check`(후보 생성) → 후보에 대한 독립 검토 → 적용(원본이 바뀌지 않았는지 확인) → 전체 검증 → 병합·보고

## 0. 시작 전 확인

- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다. 아니면 멈추고 보고한다.
- 아래를 실행한다. 이미 한 번 실행해 두었고, 다시 실행해도 같은 결과가 나온다.

```
node scripts/graph/repair-pass1.mjs prepare batch_0001 batch_0125 batch_0215 batch_0226 batch_0236 batch_0238 batch_0273 batch_0355 batch_0359 batch_0395
```

  - 배치마다 보수 대상 장면 수와 사유, 보수 입력·출력 경로를 출력하고, 마지막에 작업 묶음(`job 1` ~ `job 6`)을 출력한다.
  - 기대값: 대상 44장면(`CLAIM_OTHER_SPEAKERS` 58건, `SPEAKER_EXISTENCE` 5건), 작업 6개. 다르면 멈추고 보고한다.
  - 이 명령이 하는 일: 처음 실행할 때 원래 배치 입력과 샤드를 `data/graph/pass1/repairs/original/`에 보관하고, `batch_0236` 배치 입력의 `FB` 5장면 기계 추출값을 지금 매니페스트로 고친 뒤, 장면별 보수 입력 `data/graph/pass1/repairs/<BATCH_ID>.input.json`을 만든다.
- `data/graph/pass1/repairs/`에 `*.output.json`과 `*.candidate.json`이 없어야 한다. 있으면 멈추고 보고한다.

## 1. 작업

`prepare`가 출력한 작업 묶음대로 서브에이전트 6개에게 맡긴다. 보수 입력 크기(약 200~250KB)로 고르게 나눈 것이다.

| 작업 | 배치 | 대상 장면 |
|---|---|---|
| job 1 | `batch_0125` | 4 |
| job 2 | `batch_0238` | 6 |
| job 3 | `batch_0215` | 8 |
| job 4 | `batch_0001`, `batch_0236` | 8 + 5(`FB`) |
| job 5 | `batch_0226`, `batch_0273`, `batch_0395` | 1 + 3 + 1 |
| job 6 | `batch_0355`, `batch_0359` | 5 + 3 |

- 서브에이전트는 감독관과 같은 모델로, 감독관의 대화 맥락을 물려받지 않는 새 에이전트로 만든다(10배치 때와 같은 `self` 타입). 어떤 타입을 썼는지 보고서에 적는다.
- 6개를 가능한 한 동시에 시작한다. 서로 다른 파일만 쓴다. 실제로 몇 개씩 돌렸는지와 오류가 있었는지 보고서에 적는다.
- 감독관은 원문, 샤드, 보수 입력·출력을 직접 읽지 않는다(명세 2.1).

```
너는 GraphRAG Pass 1 보수 서브에이전트다. 이미 추출이 끝난 결과에서 문제가 지적된 장면만 고친다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 단, 검증 실패 후 재시도는 5번대로 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라. 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
   검증기와 scripts/ 아래 소스는 읽지 마라(규칙 5절 Pass 1). 검사 기준은 규칙 2.3절에, 고칠 곳은 issues와 검증 출력 메시지에 있다.
2. 맡은 배치: <BATCH_ID 목록>
   배치마다 보수 입력: data/graph/pass1/repairs/<BATCH_ID>.input.json
   - scenes[]가 고칠 장면이다. 장면마다 numbered_script(줄 번호가 붙은 원문), mechanical_ground_truth(기계 추출값),
     current_output(지금 추출 결과), issues(고칠 이유: 검증기 오류·경고)가 있다.
3. 장면마다 issues를 고친다.
   - CLAIM_OTHER_SPEAKERS(경고): 그 항목의 범위를 원문에서 다시 읽어라. 경고에 나온 다른 화자의 차례마다
     주장·질문·요청·반박·동의·평가가 있으면 그 화자의 항목으로 따로 적어라(규칙 3절 6항).
     원래 항목의 요약은 주장 화자가 한 말만 담게 고친다. 다른 화자의 말을 요약에 섞지 마라.
     상대에 대한 감정·의지·평가를 말로 밝힌 대사면 관계 메모도 확인하라(3절 9항).
     정말 그 주장의 문맥일 뿐이면 그대로 두고, 이유를 보고하라.
   - SPEAKER_EXISTENCE(오류): 기계 추출값이 바뀐 장면이다. 이번에는 긴급뉴스대본 5장면이고,
     `FB :` 줄의 FB는 이제 화자가 아니라 문서 항목명이다. 장면을 화자 라벨 없는 기록물로 다뤄라(3절 2항).
     participants, document_author, 주장 화자(actor_or_speaker, claimant), 호칭을 장면 전체에서 다시 맞춘다.
   - 한 항목을 고치면 같은 장면의 다른 배열(호칭, 단서, 언급, 관계 메모)이 영향을 받을 수 있다.
     고친 뒤 장면 원문을 처음부터 다시 훑어라(규칙 5절 Pass 1의 확인 목록).
   - issues에 없는 문제를 찾았더라도 그 장면 안이면 고쳐도 된다. 보수 입력에 없는 장면은 고치지 마라.
4. 출력 파일: data/graph/pass1/repairs/<BATCH_ID>.output.json
   {"schema_version": "1.3.0", "batch_id": "<BATCH_ID>", "scenes": [{"scene_id": "...", <바꾼 최상위 필드>}]}
   - 보수 입력의 모든 장면을 빠짐없이 넣는다. 바꾼 것이 없는 장면은 {"scene_id": "..."}만 넣는다.
   - 바꾼 최상위 필드(예: events_and_claims, relationship_and_lore_notes, participants)는 값 전체를 다시 쓴다.
     필드는 통째로 교체되므로, events_and_claims를 쓰면 고치지 않은 항목도 모두 포함해야 한다.
     쓰지 않은 필드는 current_output 그대로 남는다.
   - 규칙 4절 스키마를 따르고, 2.3절 18항의 병합기 전용 필드는 쓰지 않는다.
   - 사전 지식으로 채우지 말고 그 장면 원문에 있는 것만 적는다.
5. 다 쓰면 배치마다 검증한다:
     node scripts/graph/repair-pass1.mjs check <BATCH_ID>
   - 통과하면 보수 후 장면이 data/graph/pass1/repairs/<BATCH_ID>.candidate.json에 남는다. 샤드는 아직 바뀌지 않는다.
   - [FAIL]이면 오류 목록을 보고 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [WARN] CLAIM_OTHER_SPEAKERS가 남으면 그 항목을 원문에서 다시 읽는다. 묻힌 말이 있으면 나누고, 정말 문맥이면 그대로 둔다.
   - [WARN] WIDE_RANGE, DENSITY는 명세대로 다시 확인한다.
6. 네 출력 파일 말고는 아무것도 수정하지 마라(샤드, 배치 입력, 보수 입력, progress.json 등).
   data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/,
   data/graph/pass1/repairs/original/ 아래 파일은 읽지도 마라.
7. 끝나면 아래 형식으로만 보고하라:
   [완료] job <N>: 배치 <BATCH_ID 목록>, 장면 S개, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>,
   CLAIM_OTHER_SPEAKERS 처음 W건 → 나눔 X건·그대로 둠 Y건(그대로 둔 것마다 장면·항목 경로·이유 한 줄), 새로 만든 항목 N건
   또는
   [실패] job <N>: <BATCH_ID>, 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

## 2. 후보에 대한 독립 표본 검토

6개 작업이 모두 `check`를 통과하면, 적용하기 전에 후보(`*.candidate.json`)를 검토한다. 하나라도 실패하면 검토·적용하지 말고 멈춰서 보고한다.
필드를 통째로 다시 쓰는 방식이라 기존의 올바른 항목을 빠뜨릴 수 있고, 검증기는 이것을 잡지 못한다.

보수에 참여하지 않은 서브에이전트 1개에게 맡긴다(같은 모델, 맥락 미상속). 장면은 작업마다 보수 사유가 가장 많은 장면(같으면 배치 안에서 먼저 나온 장면)과 `FB` 장면 하나다.

- `wisdom_spring_14` (`batch_0125`), `command_center_09` (`batch_0238`), `wordless_03` (`batch_0215`), `main_01_07` (`batch_0001`), `랩칠리언_01` (`batch_0226`), `anniversary_06` (`batch_0359`), `긴급뉴스대본_FB_3_final_2.pdf_00` (`batch_0236`)

```
너는 GraphRAG Pass 1 보수 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
GRAPH_RAG_PASS1_RULES.md의 3절과 4절, 2.3절 22·23항을 읽어라. 검증기와 scripts/ 소스는 읽지 마라.
data/graph/pass1/shards_1.2.0/, shards_1.3.0_run1/, shards_1.3.0_run2/, data/graph/pilot/ 아래 파일은 읽지 마라.

아래 장면마다 세 가지를 대조하라.
- 원문: data/graph/pass1/batches/<배치>.json의 numbered_script
- 보수 전: data/graph/pass1/repairs/original/<배치>.shard.json의 같은 scene_id
- 보수 후: data/graph/pass1/repairs/<배치>.candidate.json의 같은 scene_id
보수 사유는 data/graph/pass1/repairs/<배치>.input.json의 같은 장면 issues에 있다.

검토 장면: <위 목록>

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
1. 보수 사유가 해결됐는가: 묻혀 있던 다른 화자의 주장·질문·반박이 그 화자의 항목으로 나왔는가. 그대로 둔 것은 정말 문맥인가
2. 새로 만든 항목의 오류: 주장 화자·claim_line, 사실·주장 구분, 요약의 부정·조건·전언 누락, 범위 밖 내용 혼입
3. 보수하면서 잃은 것: 보수 전에 맞게 적혀 있었는데 보수 후 빠지거나 틀려진 내용
4. 긴급뉴스대본 장면: FB 줄이 문서의 일부로 처리됐는가, document_author·주장 화자가 원문에 맞는가
5. 보수와 무관하게 남아 있는 오류는 따로 적어라(이번 보수 범위 밖이므로 건수만 별도로 센다).

마지막에 장면별·유형별 건수 표를 붙여라.
```

- 검토의 3번(보수하면서 잃은 것)이 1건이라도 있으면 **적용하지 말고 멈춰서 보고한다.** 사용자가 고칠지 정한다.
- 2번(새로 만든 항목의 오류)만 있으면 적용을 진행하고 보고서에 모두 적는다. 추출 때와 같은 종류의 오류이며, 보수 전보다 나빠진 것은 아니기 때문이다.

## 3. 적용과 병합

독립 검토에서 3번이 0건이면 실행한다.

```
node scripts/graph/repair-pass1.mjs apply batch_0001 batch_0125 batch_0215 batch_0226 batch_0236 batch_0238 batch_0273 batch_0355 batch_0359 batch_0395
for b in batch_0001 batch_0125 batch_0215 batch_0226 batch_0236 batch_0238 batch_0273 batch_0355 batch_0359 batch_0395; do node scripts/graph/validate-output.mjs $b; done
node scripts/graph/merge-and-index.mjs
node scripts/graph/pilot-report.mjs --batches batch_0001,batch_0125,batch_0215,batch_0226,batch_0236,batch_0238,batch_0273,batch_0355,batch_0359,batch_0395 --out-dir reports --out pass1_repaired_vs_1.2.0.json
```

- `apply`는 모든 배치의 `check`를 다시 하고, 하나라도 실패하면 아무것도 쓰지 않는다. 모두 통과하면 대상 장면에만 보수 출력을 덮어써 `data/graph/pass1/shards/<BATCH_ID>.json`을 바꾼다. 대상이 아닌 장면은 바뀌지 않는다. 원래 샤드는 `repairs/original/`에 남아 있다.
- `prepare` 뒤 대상 장면의 샤드나 배치 입력이 바뀌었으면 `check`·`apply`가 실패한다(옛 보수 출력이 최신 내용을 덮어쓰지 않게). 이 경우 멈추고 보고한다.
- `validate-output.mjs`의 경고 목록(배치·장면·규칙)을 보고서에 그대로 옮긴다.

## 4. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/reports/pass1_repair_<YYYY-MM-DD>.md`에도 저장한다(실행한 날짜). 실행 환경 관련 참고 사항도 함께 적는다.

**보고서의 수치와 사례는 검증기·`repair-pass1.mjs` 출력, 집계 파일, 서브에이전트 보고에서만 가져온다.** 확인하지 않은 원인을 지어내지 마라. 원인을 모르면 "확인 안 됨"이라고 적는다. 지난 보고서에는 근거 없는 인과 설명("그 여파로")이 있었다.

0. 이번 범위와 미처리: 고친 것은 `FB` 5장면과 `CLAIM_OTHER_SPEAKERS` 39장면뿐이고, 지난 독립 검토의 의미 오류 후보는 미처리라는 점을 맨 앞에 적는다
1. 작업별 결과 (표): `check` 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, `CLAIM_OTHER_SPEAKERS` 처음·나눔·그대로 둠, 새로 만든 항목 수. 그대로 둔 항목은 이유와 함께 모두
2. 적용 뒤 10배치 검증 결과와 남은 경고 목록 전체
3. `pass1_repaired_vs_1.2.0.json`과 지난 `pass1_categories_vs_1.2.0.json`의 배치별 `events_and_claims` 수, 관계 메모 수와 `epistemic_type` 분포 비교
4. 독립 표본 검토 결과(적용 전 후보 대상): 유형별 건수(장면별), 사례, 적용 여부 판단
5. 사용량과 소스 열람: 보고서를 쓰기 직전에 아래를 실행하고 출력 표를 그대로 옮긴다. 손으로 세지 않는다.
   ```
   node scripts/graph/agy-usage.mjs --supervisor <감독관 세션 ID>
   ```
   - 감독관 세션은 이번 요청 다음 스텝부터, 서브에이전트는 이번 요청에서 만든 세션(보수 6, 검토 1)만 센다. 감독관 세션 ID는 이 대화의 `brain/<ID>` 폴더 이름이다.
   - 표의 `scripts/ 열람`이 0이 아닌 서브에이전트가 있으면, 그때 무엇을 하려 했는지(그 세션 로그의 직전 스텝 내용) 적는다. 이번 보수는 소스 열람 금지 규칙(명세 5절)이 지켜지는지 처음 확인하는 실행이다
7. 규칙·도구의 문제점 제안

나머지 407개 배치는 사용자 승인 전에는 시작하지 않는다.
