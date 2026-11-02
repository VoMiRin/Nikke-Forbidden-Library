# GraphRAG Pass 1 보수 4회차 지시서 (진단·측정 게이트 결과)

Pass 1 진단 대조(`data/graph/reports/diag/compare.md`)와 측정 게이트(`GRAPH_RAG_PASS1_GATE.md` 7·7.1절)에서 나온 오류를 고치는 감독관용 지시서다. 감독관은 Gemini다.
규칙의 기준은 언제나 `GRAPH_RAG_SPEC.md`다. 이 문서와 명세가 다르면 명세를 따르고, 다른 점을 보고서에 적는다.

## 이번 범위

0단계(Claude, 2026-11-02)는 끝났다. 기계적인 수정은 모두 반영돼 있다(아래 "0단계 결과"). Gemini가 할 일은 원문을 읽고 판단해야 하는 다음 세 묶음이다.

| 묶음 | 대상 | 보수 입력에 들어가는 방식 |
|---|---|---|
| A. 텍스트 어드벤처 선택지 | WHITE MEMORY·FADING AFFECTION 140장면(`batch_0433`~`0438`) | 검증 오류 `SPEAKER_EXISTENCE`(지휘관이 화자 목록에 없는데 참여자에 있음)와 `CLAIM_SPEAKER`(선택지를 지휘관의 주장으로 적음). 지적 파일 없이 `prepare`가 잡는다 |
| B. 과거 지휘관 라벨 | ARK GUARDIAN 22, RED ASH 17, RED ASH 돌발 12, 스노우 화이트 이노센트 데이즈 3, 라푼젤 퓨어 그레이스 4, OLD TALES 2, NONSENSE RED 4장면 | 지적 `B-…`(`round4_findings.json`) |
| C. 개별 건 | 카네이션 → `char_머스탱` 1건, "지휘관" 언급인데 `entity_id`가 null인 5건 | 지적 `C-01`~`C-06` |

- 지적 파일: `data/graph/pass1/repairs/round4_findings.json`(70건)
- **규칙 근거**
  - A: 명세 1.5 (e) 예외와 3절 2항. 텍스트 어드벤처의 선택지는 시점 인물의 선택이다. 지휘관이 라벨 없는 대사·지문으로 실제로 현장에 있으면 `present_silent`에 넣고 대사는 `voices`에 넣는다.
  - B·C: 3절 2항(인물 연결), 1.6(대본 근거)

**범위 밖(미처리)**

- 기록물 작성자의 정체(Pass 2 몫)
- 회차별 미처리 의미 오류 목록(`data/graph/reports/pass1_open_issues.md`)
- 기계적 연결에서 건너뛴 이야기 밖 언급 102건(`repairs/round4/mechanical_changes.json`의 `skip_local_entity_other_title`)
- 표기 정리(조사가 붙은 표기 등)

순서: 시작 전 확인 → 보수 입력 만들기 → 타이틀 판정(B) → 보수(작업 17개) → `check` → 후보 독립 검토 → 적용 → 전체 검증·병합 → 정리·보고

## 0단계 결과 (Claude, 이미 끝남)

- 레지스트리를 다시 만들었다. 엔티티 416개, 일반 역할 521개다.
  - 사용자 분류에 따라 일반 역할로 바꾼 라벨: 진행자·기계음·집단·사물 라벨 17개, 1호~6호
  - 사용자 확인 별칭 17개를 정식 인물에 묶었다. `alias_kinds`에 종류를 적었다.
  - 2026-10-16 이후 추가된 대본의 화자(MARIA-n 마리아들, 뷰티 등)를 새로 등록했다.
- 매니페스트를 다시 만들었다. 다시 추출할 배치는 0이다.
- 배치 입력 80개(325장면)를 새 기계 추출값으로 고쳤다(`scripts/graph/refresh-batch-inputs.mjs`). 원본은 `repairs/round4/batches_original/`에 있다.
- 기계적 수정(`scripts/graph/repair-round4-mechanical.mjs`, 176배치). 원본은 `repairs/round4/shards_original/`, 내역은 `repairs/round4/mechanical_changes.json`에 있다.
  - 별칭 엔티티로 합치기 118건
  - 레지스트리에서 빠진 엔티티 → null 65건
  - 언급이 현장 인물과 겹쳐 null로 바꾼 것 12건
  - 표기가 같은 null 연결 363건
  - 파서가 잘못 잡은 화자 항목 삭제 10건
  - 옛 결과(`batch_0232`의 `문구점_00`) 1건
- 전체 439배치 검증: 실패 6배치(`batch_0433`~`0438`). 오류는 `SPEAKER_EXISTENCE` 140, `CLAIM_SPEAKER` 11뿐이다(묶음 A).
- `repair-pass1.mjs`의 배치 입력 갱신이 옛 결과 장면(다른 배치로 다시 추출된 장면)에서 멈추던 문제를 고쳤다.

## 0. 시작 전 확인

- `node scripts/graph/build-pass1-rules.mjs --check`가 `up to date`를 출력해야 한다. 아니면 멈추고 보고한다.
- `git status --short data/graph/pass1/shards`가 비어 있어야 한다. 0단계 결과를 커밋한 뒤 시작하기 때문이다. 비어 있지 않으면 멈추고 보고한다.
- 감독관 세션 ID(이 대화의 `brain/<ID>` 폴더 이름)를 확인해 둔다. 6절 사용량 집계에 쓴다.
- 아래를 실행한다.

```
node scripts/graph/repair-pass1.mjs prepare batch_0065 batch_0081 batch_0082 batch_0083 batch_0114 batch_0116 batch_0160 batch_0161 batch_0162 batch_0209 batch_0236 batch_0316 batch_0317 batch_0330 batch_0354 batch_0355 batch_0360 batch_0433 batch_0434 batch_0435 batch_0436 batch_0437 batch_0438 batch_0439 --findings data/graph/pass1/repairs/round4_findings.json
```

- 기대값(다르면 멈추고 보고한다)

  ```
  batch_0065: 1 scene(s) to repair {"REVIEW_FINDING":1}
  batch_0081: 5 scene(s) to repair {"REVIEW_FINDING":5}
  batch_0082: 10 scene(s) to repair {"REVIEW_FINDING":10}
  batch_0083: 2 scene(s) to repair {"REVIEW_FINDING":2}
  batch_0114: 1 scene(s) to repair {"REVIEW_FINDING":1}
  batch_0116: 1 scene(s) to repair {"REVIEW_FINDING":1}
  batch_0160: 6 scene(s) to repair {"REVIEW_FINDING":6}
  batch_0161: 7 scene(s) to repair {"REVIEW_FINDING":7}
  batch_0162: 7 scene(s) to repair {"REVIEW_FINDING":7}
  batch_0209: 1 scene(s) to repair {"REVIEW_FINDING":1}
  batch_0236: 4 scene(s) to repair {"REVIEW_FINDING":4}
  batch_0316: 2 scene(s) to repair {"REVIEW_FINDING":2}
  batch_0317: 1 scene(s) to repair {"REVIEW_FINDING":1}
  batch_0330: 4 scene(s) to repair {"REVIEW_FINDING":4}
  batch_0354: 4 scene(s) to repair {"REVIEW_FINDING":4}
  batch_0355: 8 scene(s) to repair {"REVIEW_FINDING":8}
  batch_0360: 4 scene(s) to repair {"REVIEW_FINDING":4}
  batch_0433: 12 scene(s) to repair {"SPEAKER_EXISTENCE":12}
  batch_0434: 20 scene(s) to repair {"SPEAKER_EXISTENCE":20}
  batch_0435: 33 scene(s) to repair {"SPEAKER_EXISTENCE":33}
  batch_0436: 34 scene(s) to repair {"SPEAKER_EXISTENCE":34}
  batch_0437: 29 scene(s) to repair {"SPEAKER_EXISTENCE":29,"CLAIM_SPEAKER":4}
  batch_0438: 12 scene(s) to repair {"SPEAKER_EXISTENCE":12,"CLAIM_SPEAKER":7}
  batch_0439: 2 scene(s) to repair {"REVIEW_FINDING":2}
  ```

  - 모두 210장면이다.
  - 작업 17개: job 1 `batch_0082` / 2 `batch_0161` / 3 `batch_0436` / 4 `batch_0162` / 5 `batch_0435` / 6 `batch_0437` / 7 `batch_0434` / 8 `batch_0081` / 9 `batch_0160` / 10 `batch_0355` / 11 `batch_0438` / 12 `batch_0330` / 13 `batch_0116, batch_0439` / 14 `batch_0114, batch_0354` / 15 `batch_0317, batch_0433` / 16 `batch_0065, batch_0083, batch_0360` / 17 `batch_0209, batch_0236, batch_0316`
  - `refreshed batch input` 문구는 나오지 않아야 한다(0단계에서 이미 맞췄다).
- 이전 회차의 보수 출력·후보가 남아 있으면 `prepare`가 멈춘다. 그러면 멈추고 보고한다.

## 1. 타이틀 판정 (묶음 B, 보수 전에 한 번)

같은 이야기가 여러 작업에 나뉘어 들어간다(예: RED ASH는 `batch_0081`~`0083`). 작업마다 따로 판정하면 결론이 엇갈릴 수 있다. 그래서 보수 전에 서브에이전트 1개가 이야기마다 먼저 판정한다(같은 모델, 맥락 미상속 `self`).

```
너는 GraphRAG Pass 1 보수 4회차의 타이틀 판정 서브에이전트다. 데이터를 고치지 말고 판정 파일 하나만 쓴다.
GRAPH_RAG_PASS1_RULES.md의 3절을 읽어라. 검증기와 scripts/ 아래 소스는 읽지 마라.
원문은 data/graph/pass1/repairs/<배치>.input.json의 numbered_script로 본다(배치 목록과 장면은 round4_findings.json의 B- 지적에 있다).

이야기 7개(ARK GUARDIAN, RED ASH, RED ASH 돌발, 스노우 화이트 이노센트 데이즈, 라푼젤 퓨어 그레이스, OLD TALES, NONSENSE RED)마다
"지휘관" 라벨·언급이 주인공(char_지휘관)인지, 갓데스 스쿼드 시절 지휘관(엔더슨, char_엔더슨)인지 원문으로 판정하라.
- 판정의 근거 줄을 [Lnnnn] 형식으로 인용한다. 원문에 근거가 없으면 "판정 불가"로 둔다. 니케 사전 지식으로 정하지 마라.
- 같은 이야기 안에서도 현재 시점 장면(예: ark_guardian_00처럼 현재 인물이 과거를 언급)은 주인공일 수 있다. 장면마다 다르면 장면별로 적는다.
- 지적 message에 적힌 근거(예: ark_guardian_26 L25~28)를 먼저 확인하라. 그 근거가 틀렸으면 그렇게 적는다.

출력: data/graph/pass1/repairs/round4_title_verdicts.json
{"verdicts": [{"title": "<이야기>", "default": "char_엔더슨 | char_지휘관 | 판정 불가",
  "evidence": [{"scene_id": "...", "lines": "Lnnnn~Lnnnn", "quote": "[Lnnnn] ..."}],
  "scene_exceptions": [{"scene_id": "...", "verdict": "...", "reason": "...", "evidence": "[Lnnnn] ..."}]}]}
끝나면 이야기마다 한 줄로 판정과 대표 근거를 보고하라.
```

- 감독관은 판정 파일을 그대로 사용자에게 보여 주고, **사용자 확인을 받은 뒤** 보수를 시작한다. 판정 불가인 이야기는 보수하지 않는다(그 B 지적은 "그대로 둠"이 된다).

## 2. 보수

작업마다 서브에이전트 1개씩 둔다(같은 모델, 맥락 미상속 `self`). 작업이 17개이므로 한 번에 최대 6개씩 시작한다. 감독관은 원문, 샤드, 보수 입력·출력을 직접 읽지 않는다(명세 2.1).

지시문은 3회차 지시서(`GRAPH_RAG_PASS1_REPAIR_ROUND3.md`) 1절의 서브에이전트 지시문을 그대로 쓴다. 다만 3번을 아래로 바꾸고, 6번의 "읽지도 마라" 목록에 `round3/`, `round4/`를 더한다.

```
3. 장면의 issues마다 다음 순서로 처리한다.
   a. rule이 SPEAKER_EXISTENCE·CLAIM_SPEAKER인 것(텍스트 어드벤처, 규칙 1.5 (e) 예외와 3절 2항):
      - 선택지([OPTION])는 시점 인물(document_author.name)의 선택이다. 지휘관의 대사·행동·주장으로 적지 않는다.
      - 지휘관이 라벨 없는 대사나 지문으로 현장에 실제로 있으면 present_silent에 원문 근거와 함께 넣고, 그 대사는
        document_author.voices에 적는다. 현장에 없으면 참여자에서 뺀다. 이름만 나오면 mentioned_only에 넣는다.
      - 선택지를 지휘관의 사건·주장·관계로 적은 항목은 시점 인물의 것으로 고친다. 시점 인물이 없으면 "지문"의 주장으로 둔다.
   b. rule이 REVIEW_FINDING이고 id가 B-로 시작하는 것(과거 지휘관 라벨):
      - data/graph/pass1/repairs/round4_title_verdicts.json의 판정을 따른다. 장면마다 다시 판정하지 마라.
      - 판정이 char_엔더슨이면 지적 path의 지휘관 항목 entity_id를 char_엔더슨으로 바꾼다. 라벨·표기는 바꾸지 않는다.
        같은 장면에 엔더슨이 이미 다른 갈래에 있으면 규칙 3절 2항("한 인물은 한 갈래에만")대로 정리한다.
      - 판정이 char_지휘관이거나 판정 불가이면 고치지 않는다.
      - 원문이 판정과 다르게 보이는 장면은 고치지 말고 줄 번호와 함께 보고한다.
      - 검증기 28항 경고(ENTITY_ID_SURFACE_MISMATCH: "지휘관" 표기가 엔더슨의 이름을 담지 않음)는 예상된 것이다.
        판정 파일의 근거를 보고에 적는다.
   c. rule이 REVIEW_FINDING이고 id가 C-로 시작하는 것: 3회차 지시문의 3번(a~c)대로 원문을 보고 판단한다.
   - 고친 뒤 장면 원문을 처음부터 다시 훑어라. 보수 입력에 없는 장면은 고치지 마라.
     issues와 무관한 다른 오류를 보면 고치지 말고 보고에만 적어라.
```

- 보고 형식은 3회차와 같다. 지적이 없는 텍스트 어드벤처 장면은 장면마다 한 줄로 쓴다: `<scene_id> 지휘관: 뺌 | present_silent | mentioned_only, 고친 사건·관계 N건`
- 서브에이전트가 멈추거나 보고 없이 끝나면 그 작업만 새 서브에이전트로 다시 시작한다.

## 3. 후보에 대한 독립 표본 검토

`check`가 24개 배치 모두 통과하면 적용 전에 검토한다. 하나라도 실패하면 멈추고 보고한다.

- 보수에 참여하지 않은 서브에이전트 1개에게 맡긴다. 지시문은 3회차 2절과 같고, 검토 장면만 아래로 바꾼다.
- 판정 대조에는 `round4_title_verdicts.json`도 읽게 한다.
- 검토 장면 26개
  - A 10장면: `white_memory_start`, `white_memory_page_1001101`, `white_memory_page_1001211`, `white_memory_endings` (batch_0433·0434), `fading_affection_start`, `fading_affection_1101` (batch_0435), `fading_affection_2108`, `fading_affection_2249` (batch_0436), `fading_affection_3124` (batch_0437), `fading_affection_3134` (batch_0438)
  - B 10장면: `ark_guardian_00`, `ark_guardian_08` (batch_0160), `ark_guardian_26` (batch_0439), `red_ash_00` (batch_0081), `red_ash_lost_03` (batch_0354), `snowwhite_young_00` (batch_0316), `rapunzel_puregrace_04` (batch_0330), `old_tales_00` (batch_0114), `old_tales_16` (batch_0116), `nonsense_red_03` (batch_0360)
  - C 6장면: 지적 `C-01`~`C-06`의 장면 전부
- 검토의 3번("보수하면서 잃은 것")이 1건이라도 있으면 **적용하지 말고 멈춰서 보고한다.**

## 4. 적용, 검증, 병합

```
node scripts/graph/repair-pass1.mjs apply <prepare의 24개 배치>
for b in <24개 배치>; do node scripts/graph/validate-output.mjs $b; done
node scripts/graph/merge-and-index.mjs
```

- `apply`는 모든 배치의 `check`를 다시 하고, 하나라도 실패하면 아무것도 쓰지 않는다. 실패하면 멈추고 보고한다.
- `validate-output.mjs`의 결과와 경고 목록을 보고서에 그대로 옮긴다.
- 병합기 출력의 병합 배치 수와 장면 수를 옮긴다.
  - 기대값은 439배치, 5,560장면이다.
  - 0단계 수정은 아직 병합되지 않았다. 이번 병합에서 함께 반영된다.

병합까지 끝나면 보수 파일을 옮겨 둔다.

```
mv data/graph/pass1/repairs/batch_0*.input.json data/graph/pass1/repairs/batch_0*.output.json data/graph/pass1/repairs/batch_0*.candidate.json data/graph/pass1/repairs/round4_findings.json data/graph/pass1/repairs/round4_title_verdicts.json data/graph/pass1/repairs/round4/
```

## 5. 보고하고 멈춘다

- 보고서는 `data/graph/reports/pass1_repair_round4_<YYYY-MM-DD>.md`에 저장한다. 형식과 원칙은 3회차 4절과 같다(수치는 도구 출력에서만 가져오고, 확인하지 않은 원인은 "확인 안 됨"이라고 적는다).
- 3회차 보고 항목에 아래를 더한다.
  - 타이틀 판정 결과(이야기별 판정, 근거, 장면 예외)와 사용자 확인 여부
  - 묶음별 처리 건수
    - A: 지휘관을 뺀 장면, `present_silent`로 옮긴 장면, `mentioned_only`로 옮긴 장면, 고친 사건·관계 수
    - B: 엔더슨으로 바꾼 항목, 그대로 둔 항목
    - C: 판정
- 사용량은 `node scripts/graph/agy-usage.mjs --supervisor <감독관 세션 ID> --from-request GRAPH_RAG_PASS1_REPAIR_ROUND4`로 집계한다.
- Pass 2는 사용자 승인 전에는 시작하지 않는다. 측정 게이트 재측정은 Claude가 한다.

## 6. 그다음 (Claude 몫)

```sh
node scripts/graph/gate-run.mjs data/graph/gate/questions.jsonl data/graph/gate/runs/<날짜>_after_v1.1.json
node scripts/graph/gate-run.mjs data/graph/gate/questions_supp.jsonl data/graph/gate/runs/<날짜>_supp_after.json
```

- 채점은 보수 전과 같은 정답 파일로 한다.
- 질문별로 필수 장면 순위 변화를 보고한다. 특히 `GRAPH_RAG_PASS1_GATE.md` 7.1절에서 원인을 짚은 장면들이다.
