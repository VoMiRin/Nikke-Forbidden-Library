# GraphRAG 1.3.0 파일럿 2차 실행 지시서 (8절 3~4단계)

이 문서는 `GRAPH_RAG_SPEC.md` 8절의 3단계(파일럿 실행)와 4단계(보고)를 **2차로** 실행하는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

1차 파일럿(2026-10-16) 뒤 다음을 바꿨다. 2차의 목적은 같은 네 배치로 이 변경의 효과를 재는 것이다.
- 3절 6항: 서로 다른 화자의 독립된 주장은 화자마다 항목을 나눈다.
- 3절 9항: 일회성 상호작용 예시(경고·말다툼·반발·사과·인솔), 대사로만 밝힌 평가·의도는 `character_claim`, `relation_or_change`의 범위·유보 표현, 제3자의 말로 드러난 소속, 여러 조직이면 항목을 나눔.
- 3절 10항: 제3자를 가리킨 3인칭 지칭은 호칭이 아니다.
- 5절 Pass 1: 품질 우선, 장면마다 원문을 다시 훑기, 서브에이전트 한 번에 장면 20개 이하.
- 2.3의 21항(`COVERAGE_GAP`)과 4절 `reviewed_gaps`.

## 0. 시작 전 확인

- `GRAPH_RAG_SPEC.md` 전체를 읽는다. 특히 2절(감독관 수칙·검증기, 21항 포함), 3절(추출 규칙), 4절(스키마 1.3.0), 5절 Pass 1, 8절.
- 묘사형 화자 목록은 확정되어 배치 입력에 반영되어 있다(`data/graph/descriptor_review.json`, 추적 대상 3개: `검은 물을 덮은 소녀`, `양산을 든 여성`, `벙커의 아이`). 배치 입력의 `speakers`에서 `is_descriptor_alias: true`인 라벨만 `descriptor_speakers` 대상이다.
- 다음 파일이 있어야 한다.
  - `data/graph/pass1/batches/pilot_0001.json`, `pilot_0002.json`, `pilot_full_0025.json`, `batch_0001.json`
  - `data/graph/progress.json` (`schema_version: "1.3.0"`)
- `data/graph/pass1/shards/`는 비어 있어야 한다. `data/graph/pass1/parts/`는 없거나 비어 있어야 한다.
- 이전 결과는 비교용으로만 쓴다. 고치거나 지우지 않는다.
  - 1.2.0: `data/graph/pass1/shards_1.2.0/`
  - 1.3.0 1차: `data/graph/pass1/shards_1.3.0_run1/`, `data/graph/pilot/run1/` (1차 집계, 밀도 보고, 감독관 보고)
  - **추출·검토 서브에이전트에게는 이 폴더들을 읽지 말라고 지시한다.** 이전 결과를 보면 베끼거나 그 결과에 끌려간다.

## 1. 실행할 배치

| 배치 | 장면 | 서브에이전트 호출 | 목적 |
|---|---|---|---|
| `pilot_0001` | 8개 (분기·루트, 부제 파트, `???` 정체 공개) | 1회 | 특수 사례 |
| `pilot_0002` | 7개 (원격·녹음, 시점·주장, 들여쓰기 `???`, 묘사형 화자와 같은 장면 정체 공개, 메신저, 화자 없는 문서) | 1회 | 특수 사례 |
| `pilot_full_0025` | 15개, 약 59KB | 1회 | 실제 크기 |
| `batch_0001` | 30개, 메인 스토리 서두 | **2회 (15개씩)** | 장면이 많은 배치. 1차에서 뒤쪽 추출량이 떨어졌다 |

`batch_0001`은 본 실행 배치다. 2차 결과가 승인되면 그대로 본 실행 결과로 쓴다.

배치마다 먼저 나눌 필요가 있는지 확인한다.

```
node scripts/graph/batch-parts.mjs plan <BATCH_ID>
```

`batch_0001`은 부분 2개(각 15장면)로 나온다. 출력에 나온 장면 ID 목록을 부분마다 서브에이전트에게 그대로 준다.

## 2. 서브에이전트에게 맡길 일

감독관은 원문이나 샤드 내용을 직접 읽지 않는다(2.1). 호출마다 서브에이전트 하나에게 아래 지시를 준다.

- 서브에이전트는 감독관과 같은 모델로 돌리되, 감독관의 대화 맥락을 물려받지 않는 새 에이전트로 만든다. 모델을 따로 지정하지 않으면 감독관 모델을 물려받는 타입을 쓴다(예: Claude Code는 `general-purpose`, `fork`는 맥락을 물려받으므로 쓰지 않는다). 다른 모델로 바꾸지 않는다. 4절의 검토 서브에이전트도 같다. 어떤 타입을 썼고 맥락을 물려받는지 보고서에 적는다.
- 여러 호출을 동시에 돌려도 된다. 서로 다른 파일만 쓰기 때문이다.

```
너는 GraphRAG Pass 1 추출 서브에이전트다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 다시 읽는 데 드는 시간과 토큰을 아끼지 마라. 단, 검증 실패 후 재시도는 4번대로 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라(명세의 1.2절, 1.5절, 1.6절, 2.3절, 3절, 4절, 5절 "Pass 1" 부분). 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
2. 입력 파일: data/graph/pass1/batches/<BATCH_ID>.json
   - 장면마다 numbered_script(줄 번호가 붙은 원문)와 mechanical_ground_truth(기계 추출값)가 있다.
   - [부분 실행일 때만] 네가 맡은 장면은 다음뿐이다: <장면 ID 목록>. 다른 장면은 쓰지 마라.
3. 출력 파일:
   - 전체 실행: data/graph/pass1/shards/<BATCH_ID>.json
   - [부분 실행] data/graph/pass1/parts/<BATCH_ID>.part<N>.json
   - 4절 스키마 1.3.0을 정확히 따른다. "schema_version": "1.3.0", "batch_id": "<BATCH_ID>".
   - 맡은 장면을 빠짐없이 같은 scene_id로 출력한다.
   - 2.3절 18항의 병합기 전용 필드(항목별 chronology_type, in_branch_option, item_id 등)는 쓰지 않는다.
   - 사전 지식으로 채우지 말고 그 장면 원문에 있는 것만 적는다.
   - 장면마다 다 쓴 뒤 원문을 처음부터 다시 훑어라. 어느 항목에도 걸리지 않은 대사 구간, 빠뜨린 짧은 행위 대사(질문·요청·거절·결정·반박), 9항 기준에 안 맞는 관계 메모가 있는지 확인하고 고친 뒤 다음 장면으로 넘어간다(명세 5절 Pass 1).
4. 다 쓰면 검증기를 실행한다:
     전체 실행: node scripts/graph/validate-output.mjs <BATCH_ID>
     [부분 실행] node scripts/graph/validate-output.mjs <BATCH_ID> --part <N>
   - [FAIL]이면 오류 목록을 보고 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [FAIL] 중 COVERAGE_GAP은 그 구간을 원문에서 다시 읽어라. 추출할 것이 있으면 추출하고, 정말 없으면 그 장면의 reviewed_gaps에 구간과 구체적인 이유를 적는다(명세 2.3의 21항, 4절). 검증을 통과하려고 내용 없는 항목을 지어내지 마라.
   - [WARN] 중 DENSITY(대사가 많은데 사건이 0건)는 해당 장면을 다시 확인한다. 내용이 정말 없으면 그대로 둔다.
5. 네 출력 파일 말고는 아무것도 수정하지 마라(progress.json, manifest.json 등 공용 파일, 다른 배치·부분의 샤드).
   data/graph/pass1/shards_1.2.0/, data/graph/pass1/shards_1.3.0_run1/, data/graph/pilot/ 아래 파일은 읽지도 마라.
6. 끝나면 아래 형식으로만 보고하라:
   [완료] <BATCH_ID>[ part N]: 장면 N개, ??? M건, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>, reviewed_gaps R건
   또는
   [실패] <BATCH_ID>[ part N]: 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

`batch_0001`은 두 부분이 모두 통과하면 감독관이 합치고 전체를 다시 검증한다.

```
node scripts/graph/batch-parts.mjs combine batch_0001
node scripts/graph/validate-output.mjs batch_0001
```

감독관은 호출마다 다음을 기록한다(보고서에 쓴다).
- 검증 실패 규칙명별 건수(첫 시도 기준과 전체 재시도 합계). 규칙명은 검증기 출력의 `[...]` 안 이름이다. 예: `COVERAGE_GAP`, `CLAIM_SPEAKER`, `BRANCH_BOUNDARY`, `CHRONOLOGY_BOUNDARY`.
- 재시도 횟수, `reviewed_gaps` 건수
- 입력·출력 토큰 사용량

## 3. 병합과 집계

네 배치가 모두 검증을 통과하면 실행한다.

```
node scripts/graph/merge-and-index.mjs --pilot   # pilot_ 샤드 3개 → data/graph/pilot/
node scripts/graph/merge-and-index.mjs           # batch_0001 → data/graph/ (본 실행 결과)
node scripts/graph/pilot-report.mjs --out pilot_report_1.3.0_run2.json
node scripts/graph/pilot-report.mjs --baseline-dir shards_1.3.0_run1 --same-batch-ids --out pilot_report_1.3.0_run2_vs_run1.json
```

두 집계 파일은 `data/graph/pilot/`에 생긴다.
- `pilot_report_1.3.0_run2.json`: 1.2.0 대비. 1차 때와 같은 비교다(`pilot_full_0025`는 1.2.0 `batch_0025`와). 1차 수치는 `pilot/run1/pilot_report_1.3.0.json`에 있다.
- `pilot_report_1.3.0_run2_vs_run1.json`: 1차 대비. 같은 배치 ID끼리 비교한다.

`pilot-report.mjs`가 세는 것:
- 배치별 관계 메모 수, `epistemic_type` 분포, 유형별 예시 5건
- 기준 대비 관계 메모 수 증감, 비교 장면의 `events_and_claims` 수(`events_and_claims_in_compared_scenes`, `events_and_claims_baseline`)
- 기준에 있었는데 지금 대응하는 메모가 없는 것 목록(`dropped_baseline_notes`). 같은 장면에서 줄 범위가 겹치는 메모가 없는 기준 메모다.
- `???`·`지문`이 주장 화자인 주장 수, `descriptor_speakers`·`trait` 단서 수, `mixed` 장면 수
- `reviewed_gaps` 목록(장면, 줄 범위, 이유)
- 배치 안 위치별 사건 밀도(1.2.0 기준값 5.7 / 4.7 / 4.5와 함께). 1차 밀도는 `pilot/run1/pass1_density_report_*.json`에 있다.

## 4. 독립 표본 검토

추출에 참여하지 않은 별도 서브에이전트에게 맡긴다(감독관과 같은 모델, 2절 참고). 검증기는 인용 위치만 보기 때문에, 이 검토만 의미 오류를 잡을 수 있다.
1차와 비교하려고 **1차와 같은 7개 장면**을 검토한다.

```
너는 GraphRAG Pass 1 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
data/graph/pass1/shards_1.2.0/, data/graph/pass1/shards_1.3.0_run1/, data/graph/pilot/ 아래 파일은 읽지 마라.

GRAPH_RAG_PASS1_RULES.md의 3절과 4절, 2.3절 21항을 읽어라.
아래 장면마다 원문(data/graph/pass1/batches/<배치>.json의 numbered_script)과
추출 결과(data/graph/pass1/shards/<배치>.json의 같은 scene_id)를 대조하라.

검토 장면:
- main_30_07, main_30_08 (pilot_0001): ??? 정체 공개
- main_31_00 (pilot_0002): 사실·주장 구분, 회상
- gingerbreadhouse_02 (pilot_0002): 묘사형 화자 '양산을 든 여성'과 같은 장면 안의 정체 공개('베르누이아')
- 어느남자의수기_00 (pilot_0002): 화자 없는 문서
- main_00_03, main_01_09 (batch_0001): 관계 메모가 많은 장면

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
1. 빠진 것: 원문에 있는데 추출되지 않은 사건·주장·관계 변화·호칭·단서·정체 공개
2. 잘못 분류된 참여자: 현장에 없는 인물을 present_silent에 넣음, 통신 화자를 현장 화자로 넣음 등
3. 사실·주장 혼동: 인물의 말을 established_event로, 대본이 보여 준 일을 character_claim으로 적음. 대사로만 밝힌 평가·의도를 관계 메모에 established_event로 적은 것도 포함
4. 관계 메모가 아닌 것을 관계 메모로 적음: 행동에서 추론한 관계, 일회성 상호작용(경고·말다툼·반발·사과·인솔 등) (3절 9항)
5. 뜻이 뒤집힌 요약: 부정·조건·전언·시간·추측·유보 표현이 빠짐, relation_or_change에 범위 밖 내용이 섞임
6. 전해 들은 호칭이나 제3자를 가리킨 3인칭 지칭을 직접 호칭으로 적음
7. 주장 화자(actor_or_speaker, claimant)나 claim_line이 틀림. 서로 다른 화자의 주장을 한 항목에 묶은 것도 포함
8. reviewed_gaps: 항목마다 그 구간을 원문에서 읽고, 정말 추출할 것이 없는지 판정하라. 추출할 것이 있었으면 1번(빠진 것)으로도 센다.

마지막에 유형별 건수 표를 붙여라.
```

## 4-1. 사람이 확인할 것

두 목록을 사용자에게 그대로 보여 준다. 빠지면 안 되는 관계가 있는지는 사람이 판단한다.
- `pilot_report_1.3.0_run2.json`의 `dropped_baseline_notes`: 1.2.0에는 있었는데 2차에서 빠진 관계 메모
- `pilot_report_1.3.0_run2_vs_run1.json`의 `dropped_baseline_notes`: 1차에는 있었는데 2차에서 빠진 관계 메모

## 5. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/pilot/supervisor_report_1.3.0_run2.md`에도 저장한다. 실행 환경 관련 참고 사항(서브에이전트 타입, 맥락을 물려받는지 등)도 함께 적는다.
1차 수치는 `data/graph/pilot/run1/`(집계·밀도·감독관 보고)에서 가져온다. 감독관 보고는 원문이 아니므로 감독관이 읽어도 된다.

1. 호출별 결과: 검증 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, `reviewed_gaps` 건수. `batch_0001`은 부분별과 합친 뒤 검증 결과를 함께
2. `COVERAGE_GAP` 첫 시도 건수와, 그 뒤 추출로 채운 구간과 `reviewed_gaps`로 남긴 구간의 비율
3. 호출별 입력·출력 토큰 사용량. 1차와 함께
4. 1차 대비 변화 (표로)
   - 배치별 관계 메모 수와 `epistemic_type` 분포
   - 배치별 `events_and_claims` 수
   - 위치별 밀도(앞·중간·뒤). 특히 `batch_0001` 뒤쪽 3분의 1
5. 두 집계의 유형별 관계 메모 예시
6. 독립 표본 검토 결과: 유형별 건수와 사례, 1차 검토 건수(빠진 것 14, 사실·주장 혼동 3, 뜻이 뒤집힌 요약 3, 호칭 1, 주장 화자 3, 합계 24)와 나란히
7. `reviewed_gaps` 전체 목록과, 그중 이유가 구체적이지 않은 것
8. 4-1의 두 목록
9. 규칙의 문제점 제안

Pass 1 본 실행(나머지 416개 배치)은 사용자 승인 전에는 시작하지 않는다.
