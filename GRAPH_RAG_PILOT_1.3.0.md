# GraphRAG 1.3.0 파일럿 실행 지시서 (8절 3~4단계)

이 문서는 `GRAPH_RAG_SPEC.md` 8절의 3단계(파일럿 실행)와 4단계(보고)를 실행하는 감독관용 지시서다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

## 0. 시작 전 확인

- `GRAPH_RAG_SPEC.md` 전체를 읽는다. 특히 2절(감독관 수칙·검증기), 3절(추출 규칙), 4절(스키마 1.3.0), 8절.
- 묘사형 화자 목록은 확정되어 배치 입력에 반영되어 있다(`data/graph/descriptor_review.json`, 추적 대상 3개: `검은 물을 덮은 소녀`, `양산을 든 여성`, `벙커의 아이`). 배치 입력의 `speakers`에서 `is_descriptor_alias: true`인 라벨만 `descriptor_speakers` 대상이다.
- 다음 파일이 있어야 한다.
  - `data/graph/pass1/batches/pilot_0001.json`, `pilot_0002.json`, `pilot_full_0025.json`, `batch_0001.json`
  - `data/graph/progress.json` (`schema_version: "1.3.0"`)
- `data/graph/pass1/shards/`는 비어 있어야 한다. 1.2.0 결과는 `data/graph/pass1/shards_1.2.0/`에 있다. 그 폴더는 읽기만 한다.

## 1. 실행할 배치

| 배치 | 장면 | 목적 |
|---|---|---|
| `pilot_0001` | 8개 (분기·루트, 부제 파트, `???` 정체 공개) | 특수 사례 |
| `pilot_0002` | 7개 (원격·녹음, 시점·주장, 들여쓰기 `???`, 묘사형 화자와 같은 장면 정체 공개, 메신저, 화자 없는 문서) | 특수 사례 |
| `pilot_full_0025` | 15개, 약 59KB | 실제 크기. 1.2.0 `batch_0025`와 비교 |
| `batch_0001` | 30개, 메인 스토리 서두 | 관계 메모가 가장 많던 배치. 1.2.0 `batch_0001`과 비교 |

`batch_0001`은 본 실행 배치다. 파일럿 결과가 승인되면 그대로 본 실행 결과로 쓴다.

## 2. 배치마다 서브에이전트에게 맡길 일

감독관은 원문이나 샤드 내용을 직접 읽지 않는다(2.1). 배치마다 서브에이전트 하나에게 아래 지시를 준다.

- 서브에이전트는 감독관과 같은 모델로 돌리되, 감독관의 대화 맥락을 물려받지 않는 새 에이전트로 만든다. 모델을 따로 지정하지 않으면 감독관 모델을 물려받는 타입을 쓴다(예: Claude Code는 `general-purpose`, `fork`는 맥락을 물려받으므로 쓰지 않는다). 다른 모델로 바꾸지 않는다. 4절의 검토 서브에이전트도 같다. 어떤 타입을 썼고 맥락을 물려받는지 보고서에 적는다.

```
너는 GraphRAG Pass 1 추출 서브에이전트다.

0. 속도보다 품질이 우선이다. 원문은 언제든 몇 번이든 다시 읽어도 된다. 다시 읽는 데 드는 시간과 토큰을 아끼지 마라. 단, 검증 실패 후 재시도는 4번대로 최대 3회다.
1. GRAPH_RAG_SPEC.md의 1.2절, 1.5절, 1.6절, 2.3절, 3절, 4절을 읽어라. 이 규칙이 전부다.
2. 입력 파일: data/graph/pass1/batches/<BATCH_ID>.json
   - 장면마다 numbered_script(줄 번호가 붙은 원문)와 mechanical_ground_truth(기계 추출값)가 있다.
3. 출력 파일: data/graph/pass1/shards/<BATCH_ID>.json
   - 4절 스키마 1.3.0을 정확히 따른다. "schema_version": "1.3.0", "batch_id": "<BATCH_ID>".
   - 입력의 모든 장면을 빠짐없이 같은 scene_id로 출력한다.
   - 2.3절 18항의 병합기 전용 필드(항목별 chronology_type, in_branch_option, item_id 등)는 쓰지 않는다.
   - 사전 지식으로 채우지 말고 그 장면 원문에 있는 것만 적는다.
   - 장면마다 다 쓴 뒤 원문을 처음부터 다시 훑어라. 어느 항목에도 걸리지 않은 대사 구간, 빠뜨린 짧은 행위 대사(질문·요청·거절·결정·반박), 9항 기준에 안 맞는 관계 메모가 있는지 확인하고 고친 뒤 다음 장면으로 넘어간다(명세 5절 Pass 1).
4. 다 쓰면 검증기를 실행한다:
     node scripts/graph/validate-output.mjs <BATCH_ID>
   - [FAIL]이면 오류 목록을 보고 샤드를 고친 뒤 다시 실행한다. 최대 3회까지 다시 시도한다.
   - [WARN] 중 DENSITY(대사가 많은데 사건이 0건)는 해당 장면을 다시 확인한다. 내용이 정말 없으면 그대로 둔다. 빈 항목을 지어내지 마라.
   - [FAIL] 중 COVERAGE_GAP은 그 구간을 원문에서 다시 읽어라. 추출할 것이 있으면 추출하고, 정말 없으면 그 장면의 reviewed_gaps에 구간과 구체적인 이유를 적는다(명세 2.3의 21항, 4절).
5. 다른 파일(progress.json, manifest.json 등 공용 파일, 다른 배치의 샤드)은 절대 수정하지 마라.
6. 끝나면 아래 형식으로만 보고하라:
   [완료] <BATCH_ID>: 장면 N개, ??? M건, 검증 통과(재시도 K회), 첫 시도 실패 규칙: <규칙명별 건수>
   또는
   [실패] <BATCH_ID>: 3회 재시도 후 실패, 남은 오류: <규칙명별 건수>
```

- 장면이 40개를 넘는 배치는 없다. 나눠 돌릴 필요가 없다.
- 감독관은 배치마다 다음을 기록한다(보고서에 쓴다).
  - 검증 실패 규칙명별 건수(첫 시도 기준과 전체 재시도 합계). 규칙명은 검증기 출력의 `[...]` 안 이름이다. 예: `CLAIM_SPEAKER`, `BRANCH_BOUNDARY`, `CHRONOLOGY_BOUNDARY`, `DESCRIPTOR_SPEAKERS`.
  - 재시도 횟수
  - 입력·출력 토큰 사용량

## 3. 병합과 집계

네 배치가 모두 검증을 통과하면 실행한다.

```
node scripts/graph/merge-and-index.mjs --pilot   # pilot_ 샤드 3개 → data/graph/pilot/
node scripts/graph/merge-and-index.mjs           # batch_0001 → data/graph/ (본 실행 결과)
node scripts/graph/pilot-report.mjs              # 비교 집계 → data/graph/pilot/pilot_report_1.3.0.json
```

`pilot-report.mjs`가 세는 것:
- 배치별 관계 메모 수, `epistemic_type` 분포, 유형별 예시 5건
- 1.2.0 대비 관계 메모 수 증감. 네 배치 모두 `shards_1.2.0`의 1.2.0 결과와 비교한다(`pilot_full_0025`는 `batch_0025`와). 양쪽에 다 있는 장면만 비교하므로 `pilot_0002`의 `gingerbreadhouse_02`는 비교에서 빠진다.
- 1.2.0에 있었는데 1.3.0에 대응하는 메모가 없는 것 목록(`dropped_1_2_0_notes`). 같은 장면에서 줄 범위가 겹치는 1.3.0 메모가 없는 1.2.0 메모다.
- `???`·`지문`이 주장 화자인 주장 수, `descriptor_speakers`·`trait` 단서 수, `mixed` 장면 수
- 배치 안 위치별 사건 밀도(1.2.0 기준값 5.7 / 4.7 / 4.5와 함께)

## 4. 독립 표본 검토

추출에 참여하지 않은 별도 서브에이전트에게 맡긴다(감독관과 같은 모델, 2절 참고). 검증기는 인용 위치만 보기 때문에, 이 검토만 의미 오류를 잡을 수 있다.

```
너는 GraphRAG Pass 1 결과의 독립 검토자다. 결과를 고치지 말고 보고만 한다.

GRAPH_RAG_SPEC.md의 3절과 4절을 읽어라.
아래 장면마다 원문(data/graph/pass1/batches/<배치>.json의 numbered_script)과
추출 결과(data/graph/pass1/shards/<배치>.json의 같은 scene_id)를 대조하라.

검토 장면:
- main_30_07, main_30_08 (pilot_0001): ??? 정체 공개
- main_31_00 (pilot_0002): 사실·주장 구분, 회상
- gingerbreadhouse_02 (pilot_0002): 묘사형 화자 '양산을 든 여성'과 같은 장면 안의 정체 공개('베르누이아')
- 어느남자의수기_00 (pilot_0002): 화자 없는 문서
- batch_0001에서 관계 메모가 가장 많은 장면 2개

장면마다 다음을 찾아라. 찾은 것마다 장면 ID, 줄 번호, 원문 인용, 무엇이 왜 틀렸는지 적어라.
1. 빠진 것: 원문에 있는데 추출되지 않은 사건·주장·관계 변화·호칭·단서·정체 공개
2. 잘못 분류된 참여자: 현장에 없는 인물을 present_silent에 넣음, 통신 화자를 현장 화자로 넣음 등
3. 사실·주장 혼동: 인물의 말을 established_event로, 대본이 보여 준 일을 character_claim으로 적음
4. 행동에서 추론한 관계를 관계 메모에 established_event로 적음 (3절 9항 위반)
5. 뜻이 뒤집힌 요약: 부정·조건·전언·시간 표현이 빠짐
6. 전해 들은 호칭을 직접 호칭으로 적음
7. 주장 화자(actor_or_speaker, claimant)나 claim_line이 틀림

마지막에 유형별 건수 표를 붙여라.
```

## 4-1. 사람이 확인할 것

`pilot_report_1.3.0.json`의 `dropped_1_2_0_notes`를 사용자에게 그대로 보여 준다. 1.2.0에는 있었는데 1.3.0에서 빠진 관계 메모 중, 관계 상태를 담고 있어 빠지면 안 되는 것이 있는지는 사람이 판단한다.

## 5. 보고하고 멈춘다

아래 내용을 사용자에게 보고하고 멈춘다. 명세는 고치지 말고, 문제점은 제안으로만 적는다.

1. 배치별 결과: 검증 통과 여부, 재시도 횟수, 첫 시도 실패 규칙명별 건수
2. 분기·시점 경계 규칙(`BRANCH_BOUNDARY`, `CHRONOLOGY_BOUNDARY`) 때문에 생긴 재시도 건수
3. 배치별 입력·출력 토큰 사용량. 1.2.0 때 기록이 있으면 함께
4. `pilot_report_1.3.0.json` 요약: 관계 메모 수와 1.2.0 대비 증감, `epistemic_type` 분포와 유형별 예시, 밀도
5. 독립 표본 검토 결과(유형별 건수와 사례)
6. `dropped_1_2_0_notes` 목록
7. 규칙의 문제점 제안

Pass 1 본 실행(나머지 416개 배치)은 사용자 승인 전에는 시작하지 않는다.
