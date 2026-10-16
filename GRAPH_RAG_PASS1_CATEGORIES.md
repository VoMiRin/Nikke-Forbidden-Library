# GraphRAG Pass 1 본 실행 1단계: 분류별 10배치 지시서

이 문서는 `GRAPH_RAG_SPEC.md` 5절 "Pass 1 본 실행 순서"의 첫 단계(분류별 1개 배치, 총 10배치)를 실행하는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

이번 결과는 파일럿이 아니다. 승인되면 그대로 본 실행 결과로 쓴다. 다만 형식이 다른 분류(블라블라, 유실물, 메신저, 문서형 등)에서 생기는 체계적 오류를 나머지 배치에 퍼뜨리기 전에 잡으려고, 이 10배치를 마치면 보고하고 멈춘다.

파일럿 2차(2026-10-16) 뒤 다음을 바꿨다. 이번 실행은 이 변경이 처음 적용되는 실행이다.
- 3절 6항: 넓은 범위로 묶은 항목 안에 다른 화자의 주장·반박이 있으면 따로 항목을 만든다.
- 3절 9항: 말로 직접 밝힌 감정·의지·평가는 관계 메모(`character_claim`), 지휘관 배정·지휘권 변경은 관계 메모, 뒤에 가서 뜻이 드러나는 대화는 `clues_and_hooks`(`foreshadowing`), 같은 장면 앞뒤 줄의 이름·설명을 관계 메모에 끌어오지 않음.
- 3절 10항: 이름만 부른 호칭은 적지 않음(예외: 부른 사람이 `???`·묘사형 화자, 또는 부른 이름이 상대 화자 라벨과 다름).
- 2.3 22항 `WIDE_RANGE` 경고: 대사 20줄 이상·화자 둘 이상을 덮는 항목.
- 서브에이전트는 명세 대신 `GRAPH_RAG_PASS1_RULES.md`(명세에서 Pass 1 부분만 옮긴 파일)를 읽는다.

## 0. 시작 전 확인

- `GRAPH_RAG_SPEC.md` 전체를 읽는다. 특히 2절(감독관 수칙·검증기), 5절, 8절.
- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다. 아니면 멈추고 보고한다.
- `data/graph/pass1/shards/`에는 `pilot_*.json`만 있고 `batch_*.json`은 없어야 한다. `data/graph/pass1/parts/`는 비어 있어야 한다.
- `data/graph/progress.json`에서 아래 10개 배치가 `pending`이어야 한다.
- 이전 결과는 비교용으로만 쓴다. 고치거나 지우지 않는다.
  - 1.2.0: `data/graph/pass1/shards_1.2.0/` (아래 10개 배치 모두 같은 배치 ID로 있다)
  - 파일럿 1차·2차: `data/graph/pass1/shards_1.3.0_run1/`, `data/graph/pass1/shards_1.3.0_run2/`(2차 `batch_0001`과 부분 샤드), `data/graph/pilot/`
  - **추출·검토 서브에이전트에게는 이 폴더들을 읽지 말라고 지시한다.** 이전 결과를 보면 베끼거나 그 결과에 끌려간다.

## 1. 실행할 배치

1.2.0 때 분류별 단계에서 쓴 배치와 같다. 그래서 모든 배치에 1.2.0 비교 기준이 있다.

| 배치 | 분류 | 장면 | 서브에이전트 호출 | 특징 |
|---|---|---|---|---|
| `batch_0001` | 메인 스토리 | 30 | 2회 (15·15) | 2차 파일럿 결과를 승인하지 않고 바뀐 규칙으로 다시 추출 |
| `batch_0125` | 이벤트 스토리 | 8 | 1회 | `???` 34줄, 선택지 많음 |
| `batch_0215` | 사이드 스토리 | 17 | 1회 | `???` 10줄 |
| `batch_0226` | 서브 퀘스트 | 8 | 1회 | 메신저 |
| `batch_0236` | 유실물 | 117 | **6회 (20개 이하씩)** | 대부분 화자 없는 문서 |
| `batch_0238` | 돌발 스토리 | 11 | 1회 | `???` 10줄 |
| `batch_0273` | 니케 에피소드 | 8 | 1회 | `???` 17줄, 메신저 |
| `batch_0355` | 이벤트 유실물 | 22 | 2회 (11·11) | `???` 44줄 |
| `batch_0359` | 스페셜 스토리 | 13 | 1회 | 화자 많은 장면 |
| `batch_0395` | 블라블라 | 18 | 1회 | 메신저 전용 |

추출 호출은 모두 17회다. 배치마다 먼저 나눌 필요가 있는지 확인하고, 나뉘면 출력에 나온 장면 ID 목록을 부분마다 서브에이전트에게 그대로 준다.

```
node scripts/graph/batch-parts.mjs plan <BATCH_ID>
```

## 2. 서브에이전트에게 맡길 일

감독관은 원문이나 샤드 내용을 직접 읽지 않는다(2.1). 호출마다 서브에이전트 하나에게 아래 지시를 준다.

- 서브에이전트는 감독관과 같은 모델로 돌리되, 감독관의 대화 맥락을 물려받지 않는 새 에이전트로 만든다. 다른 모델로 바꾸지 않는다. 4절의 검토 서브에이전트도 같다. 어떤 타입을 썼고 맥락을 물려받는지 보고서에 적는다.
- 추출 호출 17회는 가능한 한 **모두 동시에** 시작한다. 서로 다른 파일만 쓰기 때문이다. 실행 환경이 동시 실행 수를 제한하거나 속도 제한 오류가 나면, 돌릴 수 있는 만큼씩 나눠 돌리고 끝나는 대로 다음 호출을 시작한다. 실제로 몇 개씩 동시에 돌렸는지와 오류가 있었는지 보고서에 적는다.
- 오류로 중단된 호출은 그 배치(또는 부분)만 처음부터 다시 돌린다. 이미 검증을 통과한 다른 배치는 다시 돌리지 않는다.

```
너는 GraphRAG Pass 1 추출 서브에이전트다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 단, 검증 실패 후 재시도는 4번대로 최대 3회다.
1. GRAPH_RAG_PASS1_RULES.md를 읽어라. 이 규칙이 전부다. GRAPH_RAG_SPEC.md는 읽지 마라.
2. 입력 파일: data/graph/pass1/batches/<BATCH_ID>.json
   - 장면마다 numbered_script(줄 번호가 붙은 원문)와 mechanical_ground_truth(기계 추출값)가 있다.
   - [부분 실행일 때만] 네가 맡은 장면은 다음뿐이다: <장면 ID 목록>. 다른 장면은 쓰지 마라.
3. 출력 파일:
   - 전체 실행: data/graph/pass1/shards/<BATCH_ID>.json
   - [부분 실행] data/graph/pass1/parts/<BATCH_ID>.part<N>.json
   - 4절 스키마 1.3.0을 정확히 따른다. "schema_version": "1.3.0", "batch_id": "<BATCH_ID>".
   - 맡은 장면을 빠짐없이 같은 scene_id로 출력한다.
   - 2.3절 18항의 병합기 전용 필드는 쓰지 않는다.
   - 사전 지식으로 채우지 말고 그 장면 원문에 있는 것만 적는다.
   - 장면마다 다 쓴 뒤 원문을 처음부터 다시 훑어라(5절 Pass 1의 확인 목록 전부). 특히:
     - 넓은 범위로 묶은 항목 안에 다른 화자의 주장·반박이 묻혀 있지 않은가(3절 6항)
     - 상대에 대한 감정·의지를 말로 밝힌 대사나 지휘·소속 변화를 사건으로만 적고 관계 메모에서 빠뜨리지 않았는가(3절 9항)
     - 이름만 부른 호칭을 적지 않았는가, 예외(???·묘사형 화자, 라벨과 다른 이름)는 적었는가(3절 10항)
4. 다 쓰면 검증기를 실행한다:
     전체 실행: node scripts/graph/validate-output.mjs <BATCH_ID>
     [부분 실행] node scripts/graph/validate-output.mjs <BATCH_ID> --part <N>
   - [FAIL]이면 오류 목록을 보고 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [FAIL] 중 COVERAGE_GAP은 그 구간을 원문에서 다시 읽어라. 추출할 것이 있으면 추출하고, 정말 없으면 reviewed_gaps에 구간과 구체적인 이유를 적는다. 범위를 넓혀 덮거나 내용 없는 항목을 지어내 통과시키지 마라.
   - [WARN] WIDE_RANGE는 그 항목을 원문에서 다시 읽어라. 다른 화자의 주장이나 따로 적을 사건이 묻혀 있으면 나눈다. 정말 한 사건이면 그대로 둔다.
   - [WARN] DENSITY는 해당 장면을 다시 확인한다. 내용이 정말 없으면 그대로 둔다.
5. 네 출력 파일 말고는 아무것도 수정하지 마라(progress.json, manifest.json 등 공용 파일, 다른 배치·부분의 샤드).
   data/graph/pass1/shards_1.2.0/, data/graph/pass1/shards_1.3.0_run1/, data/graph/pass1/shards_1.3.0_run2/, data/graph/pilot/ 아래 파일은 읽지도 마라.
6. 끝나면 아래 형식으로만 보고하라:
   [완료] <BATCH_ID>[ part N]: 장면 N개, ??? M건, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>, reviewed_gaps R건, WIDE_RANGE 첫 경고 W건 → 나눔 X건·그대로 둠 Y건(그대로 둔 이유 한 줄씩)
   또는
   [실패] <BATCH_ID>[ part N]: 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

나뉜 배치는 모든 부분이 통과하면 감독관이 합치고 전체를 다시 검증한다.

```
node scripts/graph/batch-parts.mjs combine <BATCH_ID>
node scripts/graph/validate-output.mjs <BATCH_ID>
```

감독관은 호출마다 다음을 기록한다(보고서에 쓴다).
- 검증 실패 규칙명별 건수(첫 시도 기준과 전체 재시도 합계), 재시도 횟수, `reviewed_gaps` 건수
- `WIDE_RANGE` 첫 경고 건수, 나눈 건수, 그대로 둔 건수와 이유. 합친 뒤 최종 검증에 남은 `WIDE_RANGE` 경고 목록
- 입력·출력 토큰 사용량. 확인할 수 있으면 이 실행으로 쓴 할당량 비율도

## 3. 병합과 집계

10개 배치가 모두 검증을 통과하면 실행한다.

```
node scripts/graph/merge-and-index.mjs
node scripts/graph/pilot-report.mjs --batches batch_0001,batch_0125,batch_0215,batch_0226,batch_0236,batch_0238,batch_0273,batch_0355,batch_0359,batch_0395 --out-dir reports --out pass1_categories_vs_1.2.0.json
node scripts/graph/pilot-report.mjs --batches batch_0001 --baseline-dir shards_1.3.0_run2 --out-dir reports --out pass1_categories_batch_0001_vs_run2.json
```

- 병합 결과는 `data/graph/`(`pass1_index.json`, `pass1_density_report.json`, `pass1/by_title/`, `progress.json`)에 생긴다.
- 집계 두 파일은 `data/graph/reports/`에 생긴다.
  - `pass1_categories_vs_1.2.0.json`: 배치마다 1.2.0 같은 배치와 비교
  - `pass1_categories_batch_0001_vs_run2.json`: `batch_0001`을 파일럿 2차 결과와 비교. 규칙 변경으로 관계 메모가 어떻게 바뀌었는지 본다.
- 집계가 세는 것은 `GRAPH_RAG_PILOT_1.3.0.md` 3절과 같다(관계 메모 수와 `epistemic_type` 분포, 기준 대비 증감, `dropped_baseline_notes`, `???`·`지문` 주장 수, `reviewed_gaps` 목록 등).

## 4. 독립 표본 검토

추출에 참여하지 않은 별도 서브에이전트 2개에게 나눠 맡긴다(감독관과 같은 모델, 2절 참고). 검증기는 인용 위치만 보기 때문에, 이 검토만 의미 오류를 잡을 수 있다.

- 검토 A (7장면): `main_00_00`, `main_01_10` (`batch_0001`), `wisdom_spring_12` (`batch_0125`), `wordless_08` (`batch_0215`), `세르반_01` (`batch_0226`), `모바일_보이스피싱_광고_모음.zip_01`, `긴급뉴스대본_FB_3_final_2.pdf_00` (`batch_0236`)
- 검토 B (6장면): `elevator_00` (`batch_0238`), `emma_04` (`batch_0273`), `red_ash_lost_14` (`batch_0355`), `anniversary_02` (`batch_0359`), `blabla_helm_005` (`batch_0395`), `정갈하게쓴기록_00` (`batch_0236`)

장면은 기계적으로 골랐다: 배치마다 `???` 줄이 가장 많은 장면, 없으면 대사 줄이 가장 많은 장면. 유실물은 대사가 거의 없어 줄 수가 가장 많은 문서와 대사가 있는 문서를 함께 넣었다. `main_00_00`, `main_01_10`은 이번 9항 변경의 대상 장면이다.

```
너는 GraphRAG Pass 1 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.
data/graph/pass1/shards_1.2.0/, data/graph/pass1/shards_1.3.0_run1/, data/graph/pass1/shards_1.3.0_run2/, data/graph/pilot/ 아래 파일은 읽지 마라.

GRAPH_RAG_PASS1_RULES.md의 3절과 4절, 2.3절 21·22항을 읽어라.
아래 장면마다 원문(data/graph/pass1/batches/<배치>.json의 numbered_script)과
추출 결과(data/graph/pass1/shards/<배치>.json의 같은 scene_id)를 대조하라.

검토 장면: <위 목록>

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
1. 빠진 것: 원문에 있는데 추출되지 않은 사건·주장·관계 변화·호칭·단서·정체 공개
2. 잘못 분류된 참여자: 현장에 없는 인물을 present_silent에 넣음, 통신 화자를 현장 화자로 넣음, 문서 작성자 처리 등
3. 사실·주장 혼동: 인물의 말을 established_event로, 대본이 보여 준 일을 character_claim으로 적음. 대사로만 밝힌 평가·의도를 관계 메모에 established_event로 적은 것도 포함
4. 관계 메모 기준 위반(3절 9항), 두 방향 모두:
   a. 관계 메모가 아닌 것을 관계 메모로 적음: 행동에서 추론한 관계, 일회성 상호작용, 그 순간의 칭찬·핀잔, 뒤에 가서 뜻이 드러나는 떡밥성 대화
   b. 관계 메모여야 하는데 빠짐: 상대에 대한 감정·의지·평가를 말로 직접 밝힘, 지휘관 배정·지휘권 변경, 소속 변화
5. 뜻이 뒤집힌 요약: 부정·조건·전언·시간·추측·유보 표현이 빠짐, relation_or_change에 범위 밖 내용(같은 장면 앞뒤 줄의 이름·설명 포함)이 섞임
6. 호칭(3절 10항): 전해 들은 호칭이나 제3자를 가리킨 3인칭 지칭을 직접 호칭으로 적음, 이름만 부른 호칭을 적음(예외 제외), 예외에 해당하는데 빠뜨림
7. 주장 화자(actor_or_speaker, claimant)나 claim_line이 틀림. 넓은 범위 안의 다른 화자 주장을 한 항목에 묶은 것도 포함
8. reviewed_gaps: 항목마다 그 구간을 원문에서 읽고, 정말 추출할 것이 없는지 판정하라. 추출할 것이 있었으면 1번으로도 센다.
9. 분류 형식 문제: 문서·메신저·선택지·??? 등 그 분류의 형식 때문에 생긴 것으로 보이는 오류가 있으면 따로 적어라. 같은 형식의 다른 장면에도 퍼질 수 있는 오류인지 판단을 붙여라.

마지막에 유형별 건수 표를 붙여라.
```

## 5. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.
보고한 내용은 그대로 `data/graph/reports/pass1_categories_<YYYY-MM-DD>.md`에도 저장한다(실행한 날짜). 실행 환경 관련 참고 사항(서브에이전트 타입, 맥락을 물려받는지 등)도 함께 적는다.

**보고서의 수치와 사례는 검증기 출력, 집계 파일, 서브에이전트 보고에서만 가져온다.** 감독관은 샤드를 직접 읽지 않으므로, 확인하지 않은 원인이나 설명을 지어내지 마라. 원인을 모르면 "확인 안 됨"이라고 적는다. 파일럿 2차 보고서에는 집계 파일과 맞지 않는 설명이 있었다.

1. 호출별 결과 (표): 검증 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수, `reviewed_gaps` 건수, `WIDE_RANGE` 첫 경고·나눔·그대로 둠. 나뉜 배치는 부분별과 합친 뒤 검증 결과를 함께
2. 호출별 입력·출력 토큰 사용량과 합계. `batch_0001`은 파일럿 2차(입력 4,249,197, 출력 253,929, `data/graph/pilot/supervisor_report_1.3.0_run2.md` 3절)와 나란히. 할당량 비율을 알 수 있으면 함께
3. 분류별 표 (`pass1_categories_vs_1.2.0.json`과 `pass1_density_report.json`에서)
   - `events_and_claims` 수, 1.2.0 대비 배율
   - 관계 메모 수와 `epistemic_type` 분포, 1.2.0 대비 증감
   - `reviewed_gaps` 수, `???`·`지문` 주장 수
   - 배치 안 위치별 밀도(앞·중간·뒤)
4. `batch_0001` 파일럿 2차 대비 (`pass1_categories_batch_0001_vs_run2.json`): 관계 메모 수·분포 변화, `main_00_00`·`main_01_10`의 관계 메모가 생겼는지(검토 A 결과로 확인)
5. 독립 표본 검토 결과: 유형별 건수(검토 A·B 합계와 장면별), 사례, 9번(분류 형식 문제) 전체
6. `reviewed_gaps` 전체 목록과, 그중 이유가 구체적이지 않은 것
7. 사람이 확인할 목록 (그대로 보여 준다)
   - `pass1_categories_vs_1.2.0.json`의 배치별 `dropped_baseline_notes`
   - `pass1_categories_batch_0001_vs_run2.json`의 `dropped_baseline_notes`
8. 규칙의 문제점 제안. 특히 분류 형식 때문에 생기는 체계적 오류

나머지 407개 배치는 사용자 승인 전에는 시작하지 않는다.
