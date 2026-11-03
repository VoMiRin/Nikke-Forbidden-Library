# GraphRAG Pass 1 보수 4회차 결과 보고서 (2026-11-02)

## 0. 이번 범위와 미처리

- **이번 범위**: 24개 배치(`batch_0065`, `batch_0081`, `batch_0082`, `batch_0083`, `batch_0114`, `batch_0116`, `batch_0160`, `batch_0161`, `batch_0162`, `batch_0209`, `batch_0236`, `batch_0316`, `batch_0317`, `batch_0330`, `batch_0354`, `batch_0355`, `batch_0360`, `batch_0433`, `batch_0434`, `batch_0435`, `batch_0436`, `batch_0437`, `batch_0438`, `batch_0439`), 210장면
  - **묶음 A (텍스트 어드벤처 선택지)**: WHITE MEMORY·FADING AFFECTION 140장면(`batch_0433`~`0438`), 검증 오류 `SPEAKER_EXISTENCE` 140건, `CLAIM_SPEAKER` 11건
  - **묶음 B (과거 지휘관 라벨)**: ARK GUARDIAN 22, RED ASH 17, RED ASH 돌발 12, 스노우 화이트 이노센트 데이즈 3, 라푼젤 퓨어 그레이스 4, OLD TALES 2, NONSENSE RED 4장면 (총 64건, `round4_findings.json`의 `B-…`)
  - **묶음 C (개별 건)**: 카네이션 → `char_머스탱` 1건(`C-01`), `"지휘관"` 언급인데 `entity_id`가 `null`인 5건(`C-02`~`C-06`) (총 6건)
- **이번 범위 밖(미처리)**:
  - 기록물 작성자의 정체(Pass 2 몫)
  - 회차별 미처리 의미 오류 목록(`data/graph/reports/pass1_open_issues.md`)
  - 기계적 연결에서 건너뛴 이야기 밖 언급 102건(`repairs/round4/mechanical_changes.json`의 `skip_local_entity_other_title`)
  - 표기 정리(조사가 붙은 표기 등)
  - 이번 회차 보수자·검토자가 "지적과 무관하게 본 오류"로 보고한 기존 오류

---

## 1. 시작 전 확인, `prepare` 출력, 타이틀 판정 결과

### 1.1 시작 전 확인 및 `prepare` 출력

- `node scripts/graph/build-pass1-rules.mjs --check`: `[pass1-rules] GRAPH_RAG_PASS1_RULES.md is up to date`
- `git status --short data/graph/pass1/shards`: 비어 있음 확인
- `prepare` 실행 결과 (`GRAPH_RAG_PASS1_REPAIR_ROUND4.md` 0절 기대값과 24개 배치·210장면·17개 작업 모두 일치, `refreshed batch input` 문구 없음):

```text
[repair] batch_0065: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0065.input.json
    output data/graph/pass1/repairs/batch_0065.output.json
[repair] batch_0081: 5 scene(s) to repair {"REVIEW_FINDING":5}
    input  data/graph/pass1/repairs/batch_0081.input.json
    output data/graph/pass1/repairs/batch_0081.output.json
[repair] batch_0082: 10 scene(s) to repair {"REVIEW_FINDING":10}
    input  data/graph/pass1/repairs/batch_0082.input.json
    output data/graph/pass1/repairs/batch_0082.output.json
[repair] batch_0083: 2 scene(s) to repair {"REVIEW_FINDING":2}
    input  data/graph/pass1/repairs/batch_0083.input.json
    output data/graph/pass1/repairs/batch_0083.output.json
[repair] batch_0114: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0114.input.json
    output data/graph/pass1/repairs/batch_0114.output.json
[repair] batch_0116: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0116.input.json
    output data/graph/pass1/repairs/batch_0116.output.json
[repair] batch_0160: 6 scene(s) to repair {"REVIEW_FINDING":6}
    input  data/graph/pass1/repairs/batch_0160.input.json
    output data/graph/pass1/repairs/batch_0160.output.json
[repair] batch_0161: 7 scene(s) to repair {"REVIEW_FINDING":7}
    input  data/graph/pass1/repairs/batch_0161.input.json
    output data/graph/pass1/repairs/batch_0161.output.json
[repair] batch_0162: 7 scene(s) to repair {"REVIEW_FINDING":7}
    input  data/graph/pass1/repairs/batch_0162.input.json
    output data/graph/pass1/repairs/batch_0162.output.json
[repair] batch_0209: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0209.input.json
    output data/graph/pass1/repairs/batch_0209.output.json
[repair] batch_0236: 4 scene(s) to repair {"REVIEW_FINDING":4}
    input  data/graph/pass1/repairs/batch_0236.input.json
    output data/graph/pass1/repairs/batch_0236.output.json
[repair] batch_0316: 2 scene(s) to repair {"REVIEW_FINDING":2}
    input  data/graph/pass1/repairs/batch_0316.input.json
    output data/graph/pass1/repairs/batch_0316.output.json
[repair] batch_0317: 1 scene(s) to repair {"REVIEW_FINDING":1}
    input  data/graph/pass1/repairs/batch_0317.input.json
    output data/graph/pass1/repairs/batch_0317.output.json
[repair] batch_0330: 4 scene(s) to repair {"REVIEW_FINDING":4}
    input  data/graph/pass1/repairs/batch_0330.input.json
    output data/graph/pass1/repairs/batch_0330.output.json
[repair] batch_0354: 4 scene(s) to repair {"REVIEW_FINDING":4}
    input  data/graph/pass1/repairs/batch_0354.input.json
    output data/graph/pass1/repairs/batch_0354.output.json
[repair] batch_0355: 8 scene(s) to repair {"REVIEW_FINDING":8}
    input  data/graph/pass1/repairs/batch_0355.input.json
    output data/graph/pass1/repairs/batch_0355.output.json
[repair] batch_0360: 4 scene(s) to repair {"REVIEW_FINDING":4}
    input  data/graph/pass1/repairs/batch_0360.input.json
    output data/graph/pass1/repairs/batch_0360.output.json
[repair] batch_0433: 12 scene(s) to repair {"SPEAKER_EXISTENCE":12}
    input  data/graph/pass1/repairs/batch_0433.input.json
    output data/graph/pass1/repairs/batch_0433.output.json
[repair] batch_0434: 20 scene(s) to repair {"SPEAKER_EXISTENCE":20}
    input  data/graph/pass1/repairs/batch_0434.input.json
    output data/graph/pass1/repairs/batch_0434.output.json
[repair] batch_0435: 33 scene(s) to repair {"SPEAKER_EXISTENCE":33}
    input  data/graph/pass1/repairs/batch_0435.input.json
    output data/graph/pass1/repairs/batch_0435.output.json
[repair] batch_0436: 34 scene(s) to repair {"SPEAKER_EXISTENCE":34}
    input  data/graph/pass1/repairs/batch_0436.input.json
    output data/graph/pass1/repairs/batch_0436.output.json
[repair] batch_0437: 29 scene(s) to repair {"SPEAKER_EXISTENCE":29,"CLAIM_SPEAKER":4}
    input  data/graph/pass1/repairs/batch_0437.input.json
    output data/graph/pass1/repairs/batch_0437.output.json
[repair] batch_0438: 12 scene(s) to repair {"SPEAKER_EXISTENCE":12,"CLAIM_SPEAKER":7}
    input  data/graph/pass1/repairs/batch_0438.input.json
    output data/graph/pass1/repairs/batch_0438.output.json
[repair] batch_0439: 2 scene(s) to repair {"REVIEW_FINDING":2}
    input  data/graph/pass1/repairs/batch_0439.input.json
    output data/graph/pass1/repairs/batch_0439.output.json
[repair] job 1 (395KB): batch_0082
[repair] job 2 (339KB): batch_0161
[repair] job 3 (333KB): batch_0436
[repair] job 4 (323KB): batch_0162
[repair] job 5 (322KB): batch_0435
[repair] job 6 (286KB): batch_0437
[repair] job 7 (215KB): batch_0434
[repair] job 8 (215KB): batch_0081
[repair] job 9 (212KB): batch_0160
[repair] job 10 (196KB): batch_0355
[repair] job 11 (189KB): batch_0438
[repair] job 12 (170KB): batch_0330
[repair] job 13 (179KB): batch_0116, batch_0439
[repair] job 14 (191KB): batch_0114, batch_0354
[repair] job 15 (172KB): batch_0317, batch_0433
[repair] job 16 (177KB): batch_0065, batch_0083, batch_0360
[repair] job 17 (183KB): batch_0209, batch_0236, batch_0316
```

### 1.2 타이틀 판정 결과 (묶음 B, 사용자 확인 완료)

- 타이틀 판정 서브에이전트(`ad40073f`)가 `data/graph/pass1/repairs/round4/round4_title_verdicts.json`을 작성했으며, 사용자에게 전문을 제시하고 **확인(승인)을 받은 뒤** 2절 보수를 시작했다.

| 이야기(`title`) | 기본 판정(`default`) | 장면 예외(`scene_exceptions`) | 대표 근거 |
|---|---|---|---|
| ARK GUARDIAN | `char_엔더슨` | `ark_guardian_00`: `char_지휘관` (L33, L44~45, L49 퀸 공략전 이후 현재 에덴으로 오고 있는 주인공 지휘관) | `ark_guardian_26` L25~28 (`[L0027] 릴리바이스: 엔더슨!!` / `[L0028] 엔더슨: !!`), `ark_guardian_17` L15~18 (`[L0016] 지휘관: 나 갓데스의 지휘관이야.`) |
| RED ASH | `char_엔더슨` | 없음 | `red_ash_00` L76~84, L103~104 (`[L0104] 지휘관: 갓데스 스쿼드 브리핑을 시작하겠다.`), `red_ash_23` L12~20 |
| RED ASH 돌발 | `char_엔더슨` | 없음 | `red_ash_lost_06` L2~7, L95~96 (`[L0095] 지휘관: 우리 갓데스 스쿼드에 온 걸 환영한다!! 도로시!!`) |
| 스노우 화이트 이노센트 데이즈 | `char_엔더슨` | 없음 | `snowwhite_young_00` L4~13, `snowwhite_young_04` L163~175 (`[L0175] 지휘관: 땅 파지 말라고. 너도 갓데스니까.`) |
| 라푼젤 퓨어 그레이스 | `char_엔더슨` | 없음 | `rapunzel_puregrace_04` L100~110 (`[L0100] 지휘관: 갓데스 스쿼드, 다 모였지?`) |
| OLD TALES | `char_엔더슨` | 없음 | `old_tales_00` L26~31, L69~74, L81~84 (`[L0083] 신데렐라: 갓데스와 처음 만났던 날의 꿈을 꿨어.`), `old_tales_16` L21~28, L49~51 (`[L0049] 신데렐라: 갓데스의··· 꿈을 꿨어.`) |
| NONSENSE RED | `char_엔더슨` | 없음 | `nonsense_red_03` L2~12, `nonsense_red_06` L8~10 (`[L0010] 라푼젤: 지휘관이 그걸 보고, 이런 오합지졸들이 승리의 여신이라 불린다며 웃고···.`) |

---

## 2. 보수 결과

### 2.1 작업별 `check` 결과 요약

| 작업 | 세션 | 배치 | 장면 수 | 통과 여부 | 재시도 | 첫 시도 실패 규칙 | 남은 경고(보수 대상 장면) |
|---|---|---|---:|---|---:|---|---|
| job 1 | `3ef6b2fb` | `batch_0082` | 10 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 10 |
| job 2 | `ebc98571` | `batch_0161` | 7 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 7 |
| job 3 | `6e29bb1b` | `batch_0436` | 34 | 통과 | 0회 | 없음 | 없음 |
| job 4 | `f5adc9e0` | `batch_0162` | 7 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 7 |
| job 5 | `984d8270` | `batch_0435` | 33 | 통과 | 0회 | 없음 | 없음 |
| job 6 | `ec84d171` | `batch_0437` | 29 | 통과 | 0회 | 없음 | 없음 |
| job 7 | `1d927a93` | `batch_0434` | 20 | 통과 | 0회 | 없음 | 없음 |
| job 8 | `08890b4b` | `batch_0081` | 5 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 5 |
| job 9 | `d8a2e4df` | `batch_0160` | 6 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 5 |
| job 10 | `47c6ae47` | `batch_0355` | 8 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 8, `CLAIM_ENDS_OTHER_SPEAKER` 3 |
| job 11 | `0d507fe2` | `batch_0438` | 12 | 통과 | 0회 | 없음 | 없음 |
| job 12 | `c770e85e` | `batch_0330` | 4 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 4 |
| job 13 | `65359774` | `batch_0116`, `batch_0439` | 3 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 3 (`batch_0116` 1, `batch_0439` 2) |
| job 14 | `a9341613` | `batch_0114`, `batch_0354` | 5 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 5 (`batch_0114` 1, `batch_0354` 4) |
| job 15 | `2c9259cd` | `batch_0317`, `batch_0433` | 13 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 1 (`batch_0317` 1, `batch_0433` 0) |
| job 16 | `940cb089` | `batch_0065`, `batch_0083`, `batch_0360` | 7 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 7 (`batch_0065` 1, `batch_0083` 2, `batch_0360` 4) |
| job 17 | `613848a8` | `batch_0209`, `batch_0236`, `batch_0316` | 7 | 통과 | 0회 | 없음 | `ENTITY_ID_SURFACE_MISMATCH` 3 (`batch_0209` 1, `batch_0236` 0, `batch_0316` 2) |
| **합계** | | **24배치** | **210** | **전원 통과** | **0회** | **없음** | `ENTITY_ID_SURFACE_MISMATCH` 65, `CLAIM_ENDS_OTHER_SPEAKER` 3 |

### 2.2 묶음별 처리 건수 요약

- **묶음 A (텍스트 어드벤처 선택지, 140장면: `batch_0433`~`0438`)**:
  - 지휘관을 참여자에서 뺀 장면: **93장면** (`batch_0433` 12, `batch_0434` 20, `batch_0435` 32, `batch_0436` 4, `batch_0437` 15, `batch_0438` 10)
  - `present_silent`로 옮긴 장면: **43장면** (`batch_0435` 1, `batch_0436` 29, `batch_0437` 13)
  - `mentioned_only`로 옮긴 장면: **4장면** (`batch_0436` 1, `batch_0437` 1, `batch_0438` 2)
  - 고친 사건·관계 수: **109건** (`batch_0433` 19, `batch_0434` 37, `batch_0435` 9, `batch_0436` 16, `batch_0437` 12, `batch_0438` 16)
- **묶음 B (과거 지휘관 라벨, 64건)**:
  - `char_엔더슨`으로 바꾼 항목: **63건**
  - 그대로 둔 항목: **1건** (`B-ark_guardian-01`, `ark_guardian_00`: `char_지휘관`)
- **묶음 C (개별 건, 6건)**:
  - 고침: **1건** (`C-02`, `over_zone_00`: `entity_id: null` → `char_엔더슨`)
  - 그대로 둠: **5건** (`C-01` `coin_rush_show_down_02`는 원문 L87~92에서 마나가 머스탱 CEO라고 직접 밝혀 진단 쪽 지적이 틀렸으므로 `char_머스탱` 유지, `C-03`~`C-06`은 별개의 미상·사망 인간 지휘관이므로 `entity_id: null` 유지)

### 2.3 묶음 A 장면별 처리 내역 (140장면)

- **`batch_0433` (12장면)**:
  - `white_memory_start` 지휘관: 뺌, 고친 사건·관계 6건
  - `white_memory_page_1001101` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001104` 지휘관: 뺌, 고친 사건·관계 3건
  - `white_memory_page_1001108` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001113` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001114` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001116` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001125` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001129` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001201` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001204` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001206` 지휘관: 뺌, 고친 사건·관계 0건
- **`batch_0434` (20장면)**:
  - `white_memory_page_1001211` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001219` 지휘관: 뺌, 고친 사건·관계 0건
  - `white_memory_page_1001302` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001304` 지휘관: 뺌, 고친 사건·관계 3건
  - `white_memory_page_1001305` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001306` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001307` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001308` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001314` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001316` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001319` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001320` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001321` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001322` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001325` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001328` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001331` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_page_1001401` 지휘관: 뺌, 고친 사건·관계 4건
  - `white_memory_page_1001404` 지휘관: 뺌, 고친 사건·관계 2건
  - `white_memory_endings` 지휘관: 뺌, 고친 사건·관계 0건
- **`batch_0435` (33장면)**:
  - `fading_affection_start` 지휘관: 뺌, 고친 사건·관계 6건 (독립 검토 후 `established_event` / `지문` / `claim_line: null`로 복원)
  - `fading_affection_route_11` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_route_12` 지휘관: `present_silent`, 고친 사건·관계 3건
  - `fading_affection_route_13` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_1101`~`fading_affection_1213` (29장면 모두): 지휘관: 뺌, 고친 사건·관계 0건
- **`batch_0436` (34장면)**:
  - `fading_affection_2102` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_2107` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2108` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2112` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2114` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2118` 지휘관: `mentioned_only`, 고친 사건·관계 2건
  - `fading_affection_2119` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_2121` 지휘관: `present_silent`, 고친 사건·관계 1건
  - `fading_affection_2202` 지휘관: `present_silent`, 고친 사건·관계 3건
  - `fading_affection_2207` 지휘관: `present_silent`, 고친 사건·관계 2건
  - `fading_affection_2210` 지휘관: `present_silent`, 고친 사건·관계 3건
  - `fading_affection_2214` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2218` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2219` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2221` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2222` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2223` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_2226` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2231` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2233` 지휘관: `present_silent`, 고친 사건·관계 1건
  - `fading_affection_2234` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2236` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2238` 지휘관: `present_silent`, 고친 사건·관계 3건
  - `fading_affection_2241` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2245` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2248` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2249` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2250` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2255` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2256` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2258` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2259` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_2261` 지휘관: `present_silent`, 고친 사건·관계 1건
  - `fading_affection_2263` 지휘관: `present_silent`, 고친 사건·관계 0건
- **`batch_0437` (29장면)**:
  - `fading_affection_2266` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2268` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2270` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2271` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2301` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2304` 지휘관: `mentioned_only`, 고친 사건·관계 0건
  - `fading_affection_2305` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2307` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2308` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2311` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2313` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2314` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_2315` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_2317` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_3101` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3104` 지휘관: `present_silent`, 고친 사건·관계 0건
  - `fading_affection_3107` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3109` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3110` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3113` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3115` 지휘관: 뺌, 고친 사건·관계 0건
  - `fading_affection_3117` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3118` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3120` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3121` 지휘관: 뺌, 고친 사건·관계 3건
  - `fading_affection_3122` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3124` 지휘관: 뺌, 고친 사건·관계 2건
  - `fading_affection_3127` 지휘관: 뺌, 고친 사건·관계 2건
  - `fading_affection_3130` 지휘관: 뺌, 고친 사건·관계 1건
- **`batch_0438` (12장면)**:
  - `fading_affection_3132` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3134` 지휘관: 뺌, 고친 사건·관계 3건
  - `fading_affection_3135` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3136` 지휘관: 뺌, 고친 사건·관계 3건
  - `fading_affection_3138` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3141` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3142` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3143` 지휘관: 뺌, 고친 사건·관계 1건
  - `fading_affection_3144` 지휘관: `mentioned_only`, 고친 사건·관계 3건
  - `fading_affection_3145` 지휘관: 뺌, 고친 사건·관계 2건
  - `fading_affection_memory` 지휘관: `mentioned_only`, 고친 사건·관계 0건
  - `fading_affection_endings` 지휘관: 뺌, 고친 사건·관계 0건

### 2.4 묶음 B 지적별 처리 내역 (64건)

- `B-ark_guardian-01` (`ark_guardian_00`, `batch_0160`): **그대로 둠** — `round4_title_verdicts.json` 예외 판정(`char_지휘관`)에 따라 현재 시점 에덴에서 세실이 퀸 공략전(L49) 이후 방주에 니케 제작 기술 양도를 요구하기 위해 에덴으로 오고 있는 현재 주인공 지휘관을 언급한 것(L33, L44~45)이므로 `participants.mentioned_only[11].entity_id`를 `char_지휘관`으로 유지
- `B-ark_guardian-02` (`ark_guardian_01`, `batch_0160`): **고침** — `participants.mentioned_only[1]`(`"지휘관"`, L2)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (`ark_guardian_26` L25~28, `ark_guardian_17` L15~18, 본 장면 L2~5 근거)
- `B-ark_guardian-03` (`ark_guardian_03`, `batch_0160`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`, L3~69)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~5, L34 근거)
- `B-ark_guardian-04` (`ark_guardian_04`, `batch_0160`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`, L6~72)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L34~35 근거)
- `B-ark_guardian-05` (`ark_guardian_07`, `batch_0160`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`, L3~94)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~8 근거)
- `B-ark_guardian-06` (`ark_guardian_08`, `batch_0160`): **고침** — `participants.mentioned_only[1]`(`"지휘관"`, L33)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L33~34 근거)
- `B-ark_guardian-07` (`ark_guardian_09`, `batch_0161`): **고침** — `participants.mentioned_only[1]`(`"지휘관"`, L50)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L50~51 근거)
- `B-ark_guardian-08` (`ark_guardian_10`, `batch_0161`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`, L12~48)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L47~48 근거)
- `B-ark_guardian-09` (`ark_guardian_11`, `batch_0161`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`, L11~195)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L11~14 근거)
- `B-ark_guardian-10` (`ark_guardian_12`, `batch_0161`): **고침** — `participants.present_in_scene[4]`(`"지휘관"`, L13~160)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L13~15 근거)
- `B-ark_guardian-11` (`ark_guardian_13`, `batch_0439`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L22~24 근거)
- `B-ark_guardian-12` (`ark_guardian_15`, `batch_0161`): **고침** — `participants.mentioned_only[0]`(`"지휘관"`, L26~28)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L26~28 근거)
- `B-ark_guardian-13` (`ark_guardian_16`, `batch_0161`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`, L2~110)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L10~12 근거)
- `B-ark_guardian-14` (`ark_guardian_17`, `batch_0161`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`, L4~142)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L15~18 근거)
- `B-ark_guardian-15` (`ark_guardian_18`, `batch_0162`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~8 근거)
- `B-ark_guardian-16` (`ark_guardian_20`, `batch_0162`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L147~148 근거)
- `B-ark_guardian-17` (`ark_guardian_21`, `batch_0162`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L9~10 근거)
- `B-ark_guardian-18` (`ark_guardian_22`, `batch_0162`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L27~32 근거)
- `B-ark_guardian-19` (`ark_guardian_23`, `batch_0162`): **고침** — `participants.mentioned_only[3]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L49~52 근거)
- `B-ark_guardian-20` (`ark_guardian_24`, `batch_0162`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L107~108 근거)
- `B-ark_guardian-21` (`ark_guardian_25`, `batch_0162`): **고침** — `participants.present_in_scene[3]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L115~122 근거)
- `B-ark_guardian-22` (`ark_guardian_26`, `batch_0439`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L25~28 근거)
- `B-red_ash-01` (`red_ash_00`, `batch_0081`): **고침** — `participants.present_in_scene[6]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L76~84, L103~104 근거)
- `B-red_ash-02` (`red_ash_01`, `batch_0081`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~7 근거)
- `B-red_ash-03` (`red_ash_02`, `batch_0081`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L4~5 근거)
- `B-red_ash-04` (`red_ash_03`, `batch_0081`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L27~30 근거)
- `B-red_ash-05` (`red_ash_05`, `batch_0081`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L48~54 근거)
- `B-red_ash-06` (`red_ash_06`, `batch_0082`): **고침** — `participants.remote_or_voice_only[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L55~59 근거)
- `B-red_ash-07` (`red_ash_07`, `batch_0082`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~10 근거)
- `B-red_ash-08` (`red_ash_08`, `batch_0082`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L18~23 근거)
- `B-red_ash-09` (`red_ash_09`, `batch_0082`): **고침** — `participants.present_in_scene[4]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L21~27 근거)
- `B-red_ash-10` (`red_ash_10`, `batch_0082`): **고침** — `participants.present_in_scene[6]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L48~52 근거)
- `B-red_ash-11` (`red_ash_11`, `batch_0082`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~8 근거)
- `B-red_ash-12` (`red_ash_12`, `batch_0082`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L7~10 근거)
- `B-red_ash-13` (`red_ash_13`, `batch_0082`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L157~162 근거)
- `B-red_ash-14` (`red_ash_14`, `batch_0082`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L28~29 근거)
- `B-red_ash-15` (`red_ash_16`, `batch_0082`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L34~35 근거)
- `B-red_ash-16` (`red_ash_21`, `batch_0083`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~5 근거)
- `B-red_ash-17` (`red_ash_23`, `batch_0083`): **고침** — `participants.mentioned_only[4]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L12~20 근거)
- `B-red_ash_lost-01` (`red_ash_lost_03`, `batch_0354`): **고침** — `participants.mentioned_only[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L56~59 근거)
- `B-red_ash_lost-02` (`red_ash_lost_04`, `batch_0354`): **고침** — `participants.mentioned_only[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L3~5 근거)
- `B-red_ash_lost-03` (`red_ash_lost_06`, `batch_0354`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~7, L95~96 근거)
- `B-red_ash_lost-04` (`red_ash_lost_07`, `batch_0354`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L3~6 근거)
- `B-red_ash_lost-05` (`red_ash_lost_08`, `batch_0355`): **고침** — `participants.present_in_scene[3]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L22~32 근거)
- `B-red_ash_lost-06` (`red_ash_lost_09`, `batch_0355`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L40~43 근거)
- `B-red_ash_lost-07` (`red_ash_lost_10`, `batch_0355`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L19~22 근거)
- `B-red_ash_lost-08` (`red_ash_lost_11`, `batch_0355`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L4~8 근거)
- `B-red_ash_lost-09` (`red_ash_lost_15`, `batch_0355`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L3~6 근거)
- `B-red_ash_lost-10` (`red_ash_lost_16`, `batch_0355`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L35~38 근거)
- `B-red_ash_lost-11` (`red_ash_lost_19`, `batch_0355`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L8~17 근거)
- `B-red_ash_lost-12` (`red_ash_lost_20`, `batch_0355`): **고침** — `participants.present_in_scene[1]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L42~44 근거)
- `B-스노우_화이트_이노센트-01` (`snowwhite_young_00`, `batch_0316`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L4~13 근거)
- `B-스노우_화이트_이노센트-02` (`snowwhite_young_01`, `batch_0316`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~11 근거)
- `B-스노우_화이트_이노센트-03` (`snowwhite_young_04`, `batch_0317`): **고침** — `participants.present_in_scene[2]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L163~175, L185~188 근거)
- `B-라푼젤_퓨어_그레이스-01` (`rapunzel_puregrace_00`, `batch_0330`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L19~24 근거)
- `B-라푼젤_퓨어_그레이스-02` (`rapunzel_puregrace_02`, `batch_0330`): **고침** — `participants.present_in_scene[4]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L23~27 근거)
- `B-라푼젤_퓨어_그레이스-03` (`rapunzel_puregrace_03`, `batch_0330`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L26~30 근거)
- `B-라푼젤_퓨어_그레이스-04` (`rapunzel_puregrace_04`, `batch_0330`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L100~110 근거)
- `B-old_tales-01` (`old_tales_00`, `batch_0114`): **고침** — `participants.present_in_scene[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L26~31, L69~74, L81~84 근거)
- `B-old_tales-02` (`old_tales_16`, `batch_0116`): **고침** — `participants.present_in_scene[7]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L21~28, L49~51 근거)
- `B-nonsense_red-01` (`nonsense_red_03`, `batch_0360`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~12 근거)
- `B-nonsense_red-02` (`nonsense_red_04`, `batch_0360`): **고침** — `participants.present_in_scene[4]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L20~26 근거)
- `B-nonsense_red-03` (`nonsense_red_05`, `batch_0360`): **고침** — `participants.present_in_scene[0]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L2~5 근거)
- `B-nonsense_red-04` (`nonsense_red_06`, `batch_0360`): **고침** — `participants.mentioned_only[5]`(`"지휘관"`)의 `entity_id`를 `char_지휘관` → `char_엔더슨`으로 변경 (본 장면 L8~10 근거)

### 2.5 묶음 C 지적별 처리 내역 (6건)

- `C-01` (`coin_rush_show_down_02`, `batch_0209`): **그대로 둠 (진단 쪽 지적이 틀림)** — 진단 쪽 지적은 원문에서 카네이션이 머스탱이라는 근거를 찾지 못했다고 했으나, 같은 장면 L87~92에서 플로라가 `"카네이션 님과 거래를 트기 위해서예요."`(L87)라고 말한 뒤 지휘관의 선택지 `"카네이션···?"`(L89)에 마나가 `"머스탱 CEO를 뜻합니다."`(L92)라고 같은 장면 안에서 직접 밝히므로 `participants.mentioned_only[15]`(`"카네이션"`)의 `entity_id`를 `char_머스탱`으로 유지함
- `C-02` (`over_zone_00`, `batch_0065`): **고침** — L3~30에서 릴리바이스가 갓데스 스쿼드 동생들에게 남긴 유언 영상 속에서 `"지휘관을 만나 인류를 위해 싸웠고"`(L11)라고 언급한 `"지휘관"`은 갓데스 시절 지휘관이므로 `participants.mentioned_only[0].entity_id`를 `null` → `char_엔더슨`으로 바꾸고 `unregistered_entity_candidates`에서 `"지휘관"`(L11)을 제거함
- `C-03` (`특이랩쳐보고서-후_00`, `batch_0236`): **그대로 둠** — L5(`"저 멀리서 다가오고 있는 지휘관과 니케 스쿼드 역시 환각이다."`)의 `"지휘관"`은 익명의 보고서 작성자가 지상에서 구조 신호를 보낸 뒤 멀리서 다가오는 것으로 본 미상의 지휘관으로, 원문에서 주인공(`char_지휘관`)이나 갓데스 지휘관(`char_엔더슨`)이라고 특정할 근거가 없으므로 `entity_id`를 `null`로 유지함
- `C-04` (`조난일지_02`, `batch_0236`): **그대로 둠** — L4(`"지휘관 도주."`)의 `"지휘관"`은 수정 침식 상황에서 도주했다가 후속 기록(`조난일지_03` L4)에서 사망 상태로 발견되는 조난 스쿼드의 별도 인간 지휘관이므로 `entity_id`를 `null`로 유지함
- `C-05` (`조난일지_03`, `batch_0236`): **그대로 둠** — L4(`"지휘관 발견. 사망 상태. 외상은 보이지 않음."`)의 `"지휘관"`은 `조난일지_02` L4에서 도주한 뒤 외상 없이 사망한 채 발견된 조난 스쿼드의 별도 인간 지휘관이므로 `entity_id`를 `null`로 유지함
- `C-06` (`반드시사수하라_01`, `batch_0236`): **그대로 둠** — L5~6(`"지휘관은! / 노, 녹았다고? 하여간 이래서 인간은···!"`)의 `"지휘관"`은 고래에 의해 방주 후보군에 도달했다가 녹아서 사망한 별도 인간 지휘관이므로 `entity_id`를 `null`로 유지함

---

## 3. 후보 독립 표본 검토 결과 및 정지·수정 내역

### 3.1 적용 전 정지 및 수정 내역 (`fading_affection_start`, `batch_0435`)

- **독립 검토 결과(`84241c60`)**: 검토 대상 26장면 중 25장면에서는 2번(새로 만들거나 고친 항목의 오류) 0건, 3번(보수하면서 잃은 것) 0건이었으나, `fading_affection_start` (`batch_0435`) 1장면에서 **2번(보수 오류) 6건·3번(보수하면서 잃은 것) 6건**이 보고되었다.
  - 대상 항목: `fading_affection_start`의 `events_and_claims[0]~[5]` (L2 `[L0002] 오래된 프로젝트의 기록을 열람하기로 했다.`, L4~5 `[OPTION TEXT="마리아의 기록"]`, L7~8 `[OPTION TEXT="마리안의 기록"]`, L10~11 `[OPTION TEXT="7호의 기록"]`, L13 `[OPTION TEXT="메모리"]`, L15 `[OPTION TEXT="엔딩 회상"]`)
  - 원인: 보수 전에는 위 6개 항목이 `epistemic_type: "established_event"`, `claim_line: null`로 적혀 있었으나, 수정 전 `GRAPH_RAG_PASS1_REPAIR_ROUND4.md` 2절 3.a의 `"시점 인물이 없으면 '지문'의 주장으로 둔다"` 문구를 따른 보수 서브에이전트가 6개 모두 `epistemic_type: "character_claim"`, `actor_or_speaker: "지문"`으로 바꾸면서 기록 열람 개시와 메뉴 선택 행동(사건)이 주장으로 잘못 바뀌었다(`GRAPH_RAG_PASS1_RULES.md` 3절 2항·6항 위반).
- **정지 및 수정 조치**:
  - `GRAPH_RAG_PASS1_REPAIR_ROUND4.md` 3절 지시(`"검토의 3번('보수하면서 잃은 것')이 1건이라도 있으면 적용하지 말고 멈춰서 보고한다"`)에 따라 `apply`를 실행하지 않고 멈추어 사용자에게 보고했다.
  - 사용자가 지시서 2절 3.a 문구를 `"시점 인물이 없으면 행위자·화자를 '지문'으로 바꾸되, 기록 선택·메뉴 선택 같은 행동은 사건(established_event)으로 두고, 독백의 추론·판단·다짐만 '지문'의 주장(character_claim)으로 둔다(규칙 3절 6항)"`으로 수정하고, `batch_0435.output.json`의 `fading_affection_start` `events_and_claims[0]~[5]`를 `epistemic_type: "established_event"`, `actor_or_speaker: "지문"`, `claim_line: null`로 되돌린 뒤 재검증하여 진행하도록 지시했다.
  - 지시대로 `batch_0435.output.json`의 6개 항목을 되돌린 뒤 `node scripts/graph/repair-pass1.mjs check batch_0435`를 다시 실행하여 `[PASS] batch_0435 repair: mechanical validation succeeded (0 warning(s) in repaired scenes)`를 확인하고, 3번("보수하면서 잃은 것")이 0건으로 해소된 상태에서 4절 적용을 진행했다.

### 3.2 검토 대상 26장면 판정 및 건수 표

| # | 묶음 | 장면 ID | 지적/오류 ID | 배치 | 판정 | 2. 보수 오류 (초기 → 수정 후) | 3. 보수 손실 (초기 → 수정 후) | 4. 보수 무관 잔존 오류 (별도 집계) | 비고 |
|---:|---|---|---|---|---|---:|---:|---:|---|
| 1 | A | `white_memory_start` | `SPEAKER_EXISTENCE` | `batch_0433` | **해결됨** | 0 | 0 | 0 | 유령 `지휘관` 제거, `ev[1]~[6]` 화자 `스노우 화이트`로 수정 |
| 2 | A | `white_memory_page_1001101` | `SPEAKER_EXISTENCE` | `batch_0433` | **해결됨** | 0 | 0 | 0 | 유령 `지휘관` 제거, `ev[1]~[2]` 화자 `스노우 화이트`로 수정 |
| 3 | A | `white_memory_page_1001211` | `SPEAKER_EXISTENCE` | `batch_0434` | **해결됨** | 0 | 0 | 1 | 유령 `지휘관` 제거 |
| 4 | A | `white_memory_endings` | `SPEAKER_EXISTENCE` | `batch_0434` | **해결됨** | 0 | 0 | 0 | 유령 `지휘관` 제거 |
| 5 | A | `fading_affection_start` | `SPEAKER_EXISTENCE` | `batch_0435` | **해결됨** | 6 → **0** | 6 → **0** | 0 | 정지 보고 후 `ev[0]~[5]`를 `established_event`/`지문`/`null`로 복원 |
| 6 | A | `fading_affection_1101` | `SPEAKER_EXISTENCE` | `batch_0435` | **해결됨** | 0 | 0 | 0 | 유령 `지휘관` 제거 |
| 7 | A | `fading_affection_2108` | `SPEAKER_EXISTENCE` | `batch_0436` | **해결됨** | 0 | 0 | 0 | L2 지문 근거로 `present_silent`에 `char_지휘관` 이동 |
| 8 | A | `fading_affection_2249` | `SPEAKER_EXISTENCE` | `batch_0436` | **해결됨** | 0 | 0 | 1 | L2 지문 근거로 `present_silent`에 `char_지휘관` 이동 |
| 9 | A | `fading_affection_3124` | `SPEAKER_EXISTENCE`, `CLAIM_SPEAKER`(2) | `batch_0437` | **해결됨** | 0 | 0 | 0 | 유령 `지휘관` 제거, `ev[2]~[3]` 화자 `7호`로 수정 |
| 10 | A | `fading_affection_3134` | `SPEAKER_EXISTENCE`, `CLAIM_SPEAKER`(3) | `batch_0438` | **해결됨** | 0 | 0 | 4 | 유령 `지휘관` 제거, `ev[1]~[3]` 화자 `지문`으로 수정 |
| 11 | B | `ark_guardian_00` | `B-ark_guardian-01` | `batch_0160` | **그대로 둔 것이 맞음** | 0 | 0 | 2 | L44~49 퀸 공략전 직후 에덴으로 오고 있는 현재 주인공 지휘관(`char_지휘관`) |
| 12 | B | `ark_guardian_08` | `B-ark_guardian-06` | `batch_0160` | **해결됨** | 0 | 0 | 6 | L33 릴리스와 함께 언급된 갓데스 지휘관 → `char_엔더슨` |
| 13 | B | `ark_guardian_26` | `B-ark_guardian-22` | `batch_0439` | **해결됨** | 0 | 0 | 22 | L26~28에서 `엔더슨`임이 직접 드러남 → `char_엔더슨` |
| 14 | B | `red_ash_00` | `B-red_ash-01` | `batch_0081` | **해결됨** | 0 | 0 | 7 | L104 갓데스 스쿼드 브리핑 지휘관 → `char_엔더슨` |
| 15 | B | `red_ash_lost_03` | `B-red_ash_lost-01` | `batch_0354` | **해결됨** | 0 | 0 | 10 | L58 릴리스와 함께 언급된 갓데스 지휘관 → `char_엔더슨` |
| 16 | B | `snowwhite_young_00` | `B-스노우_화이트_이노센트-01` | `batch_0316` | **해결됨** | 0 | 0 | 5 | L4~13 어린 스노우 화이트·릴리스 시절 지휘관 → `char_엔더슨` |
| 17 | B | `rapunzel_puregrace_04` | `B-라푼젤_퓨어_그레이스-04` | `batch_0330` | **해결됨** | 0 | 0 | 10 | L100~107 갓데스 스쿼드 지휘관 → `char_엔더슨` |
| 18 | B | `old_tales_00` | `B-old_tales-01` | `batch_0114` | **해결됨** | 0 | 0 | 11 | L26~71, L83 갓데스와 처음 만난 날의 꿈 속 지휘관 → `char_엔더슨` |
| 19 | B | `old_tales_16` | `B-old_tales-02` | `batch_0116` | **해결됨** | 0 | 0 | 6 | L22~36, L49 궤도 엘리베이터 공략전 당시 갓데스 악몽 속 지휘관 → `char_엔더슨` |
| 20 | B | `nonsense_red_03` | `B-nonsense_red-01` | `batch_0360` | **해결됨** | 0 | 0 | 7 | L2~71 갓데스 스쿼드 지휘관 → `char_엔더슨` |
| 21 | C | `coin_rush_show_down_02` | `C-01` | `batch_0209` | **그대로 둔 것이 맞음 (지적 틀림)** | 0 | 0 | 9 | L87~92에서 마나가 카네이션이 머스탱 CEO라고 직접 밝힘(`char_머스탱` 유지 적정) |
| 22 | C | `over_zone_00` | `C-02` | `batch_0065` | **해결됨** | 0 | 0 | 3 | L11 릴리바이스 유언 영상 속 갓데스 지휘관 → `char_엔더슨` 및 미등록 후보에서 제거 |
| 23 | C | `특이랩쳐보고서-후_00` | `C-03` | `batch_0236` | **그대로 둔 것이 맞음** | 0 | 0 | 0 | L5 보고서 작성자가 환각으로 여기는 미상 지휘관(`entity_id: null` 유지 적정) |
| 24 | C | `조난일지_02` | `C-04` | `batch_0236` | **그대로 둔 것이 맞음** | 0 | 0 | 0 | L4 수정 침식 현장에서 도주한 조난 스쿼드 지휘관(`entity_id: null` 유지 적정) |
| 25 | C | `조난일지_03` | `C-05` | `batch_0236` | **그대로 둔 것이 맞음** | 0 | 0 | 0 | L4 사망 상태로 발견된 조난 스쿼드 지휘관(`entity_id: null` 유지 적정) |
| 26 | C | `반드시사수하라_01` | `C-06` | `batch_0236` | **그대로 둔 것이 맞음** | 0 | 0 | 3 | L5~6 방주 후보군에서 녹아 사망한 인간 지휘관(`entity_id: null` 유지 적정) |
| **합계** | | **26장면** | | | | **6 → 0** | **6 → 0** | **107** | |

---

## 4. 적용 뒤 24개 배치 검증 결과 및 병합기 출력

### 4.1 `validate-output.mjs` 결과 및 남은 경고 목록 전체

```text
[WARN][TERM_NOT_IN_SCENE] (license_to_kill_07) $.scenes[4].events_and_claims[2]: uses "윗선" (organization name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (license_to_kill_10) $.scenes[7].summary: uses "로비" (location name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (license_to_kill_10) $.scenes[7].clues_and_hooks[0]: uses "로비" (location name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (over_zone_00) $.scenes[12].participants.mentioned_only[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0065: mechanical validation succeeded (4 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_00) $.scenes[5].participants.present_in_scene[6].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_01) $.scenes[6].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_02) $.scenes[7].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_03) $.scenes[8].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_05) $.scenes[10].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0081: mechanical validation succeeded (5 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_06) $.scenes[0].participants.remote_or_voice_only[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_07) $.scenes[1].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_08) $.scenes[2].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_09) $.scenes[3].participants.present_in_scene[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_10) $.scenes[4].participants.present_in_scene[6].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_11) $.scenes[5].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_12) $.scenes[6].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_13) $.scenes[7].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_14) $.scenes[8].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_16) $.scenes[10].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0082: mechanical validation succeeded (10 warning(s)).
[WARN][TERM_NOT_IN_SCENE] (red_ash_19) $.scenes[2].summary: uses "부모님" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (red_ash_19) $.scenes[2].events_and_claims[12]: uses "부모님" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_21) $.scenes[4].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_23) $.scenes[6].participants.mentioned_only[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0083: mechanical validation succeeded (4 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (old_tales_00) $.scenes[8].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0114: mechanical validation succeeded (1 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (old_tales_16) $.scenes[2].participants.present_in_scene[7].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0116: mechanical validation succeeded (1 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_01) $.scenes[3].participants.mentioned_only[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_03) $.scenes[5].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_04) $.scenes[6].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_07) $.scenes[9].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_08) $.scenes[10].participants.mentioned_only[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0160: mechanical validation succeeded (5 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_09) $.scenes[0].participants.mentioned_only[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (ark_guardian_10) $.scenes[1].events_and_claims[0]: uses "밀봉" (event name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_10) $.scenes[1].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_11) $.scenes[2].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_12) $.scenes[3].participants.present_in_scene[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_15) $.scenes[6].participants.mentioned_only[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_16) $.scenes[7].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_17) $.scenes[8].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0161: mechanical validation succeeded (8 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_18) $.scenes[0].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_20) $.scenes[2].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (ark_guardian_21) $.scenes[3].summary: uses "밀봉" (event name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_21) $.scenes[3].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_22) $.scenes[4].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_23) $.scenes[5].participants.mentioned_only[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_24) $.scenes[6].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_25) $.scenes[7].participants.present_in_scene[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0162: mechanical validation succeeded (8 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (coin_rush_show_down_02) $.scenes[3].participants.mentioned_only[15].entity_id: "카네이션" is linked to "char_머스탱", but it contains none of that entity's registered names (머스탱). Re-read it: if only prior knowledge links them, set entity_id to null and add "카네이션" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (coin_rush_show_down_04) $.scenes[5].summary: uses "가짜" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (coin_rush_show_down_04) $.scenes[5].events_and_claims[19]: uses "가짜" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (coin_rush_show_down_05) $.scenes[6].events_and_claims[15]: uses "바니걸 복장" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[PASS] batch_0209: mechanical validation succeeded (4 warning(s)).
[WARN][TERM_NOT_IN_SCENE] (장보기목록_03) $.scenes[0].summary: uses "식량" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (장보기목록_03) $.scenes[0].clues_and_hooks[0]: uses "식량" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (반드시사수하라_02) $.scenes[64].clues_and_hooks[0]: uses "하모니 큐브" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (반드시사수하라_02) $.scenes[64].clues_and_hooks[0]: uses "방주 후보군" (location name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (반드시사수하라_04) $.scenes[66].clues_and_hooks[0]: uses "하모니 큐브" (item name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (정갈하게쓴기록_01) $.scenes[104].clues_and_hooks[0]: uses "상위 개체" (faction_or_species name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[PASS] batch_0236: mechanical validation succeeded (6 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (redhood_04) $.scenes[7].participants.mentioned_only[2].entity_id: "스노우" is linked to "char_스노우_화이트", but it contains none of that entity's registered names (스노우화이트). Re-read it: if only prior knowledge links them, set entity_id to null and add "스노우" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (snowwhite_young_00) $.scenes[8].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (snowwhite_young_01) $.scenes[9].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0316: mechanical validation succeeded (3 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (snowwhite_young_04) $.scenes[1].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ludmilla_winterowner_00) $.scenes[7].unknown_speakers[0].resolved_in_same_scene_to.entity_id: "시종" is linked to "char_지휘관", but it contains none of that entity's registered names (지휘관). Re-read it: if only prior knowledge links them, set entity_id to null and add "시종" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ludmilla_winterowner_00) $.scenes[7].unknown_speakers[1].resolved_in_same_scene_to.entity_id: "시종" is linked to "char_지휘관", but it contains none of that entity's registered names (지휘관). Re-read it: if only prior knowledge links them, set entity_id to null and add "시종" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0317: mechanical validation succeeded (3 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (rapunzel_puregrace_00) $.scenes[5].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (rapunzel_puregrace_02) $.scenes[7].participants.present_in_scene[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (rapunzel_puregrace_03) $.scenes[8].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (rapunzel_puregrace_04) $.scenes[9].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0330: mechanical validation succeeded (4 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_03) $.scenes[28].participants.mentioned_only[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_04) $.scenes[29].participants.mentioned_only[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_06) $.scenes[31].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_07) $.scenes[32].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0354: mechanical validation succeeded (4 warning(s)).
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_lost_08) $.scenes[0].events_and_claims[1]: character_claim by "라푼젤" (L8~L9) ends with 릴리바이스 L9, and no item of 릴리바이스's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 릴리바이스's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_08) $.scenes[0].participants.present_in_scene[3].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_lost_09) $.scenes[1].events_and_claims[3]: character_claim by "지휘관" (L19~L20) ends with 릴리바이스 L20, and no item of 릴리바이스's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 릴리바이스's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_09) $.scenes[1].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_10) $.scenes[2].participants.present_in_scene[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_11) $.scenes[3].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_lost_13) $.scenes[5].events_and_claims[2]: character_claim by "레드 후드" (L29~L33) ends with 도로시 L33, and no item of 도로시's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 도로시's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_15) $.scenes[7].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_16) $.scenes[8].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_19) $.scenes[11].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_lost_20) $.scenes[12].relationship_and_lore_notes[3]: character_claim by "지휘관" (L43~L44) ends with 릴리바이스 L44, and no item of 릴리바이스's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 릴리바이스's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][ENTITY_ID_SURFACE_MISMATCH] (red_ash_lost_20) $.scenes[12].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_mini_00) $.scenes[13].events_and_claims[1]: character_claim by "스노우 화이트" (L6~L10) ends with 레드 후드 L10, and no item of 레드 후드's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 레드 후드's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_mini_00) $.scenes[13].events_and_claims[3]: character_claim by "스노우 화이트" (L15~L17) ends with 레드 후드 L17, and no item of 레드 후드's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 레드 후드's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_mini_00) $.scenes[13].events_and_claims[5]: character_claim by "레드 후드" (L23~L27) ends with 스노우 화이트 L27, and no item of 스노우 화이트's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 스노우 화이트's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[WARN][CLAIM_ENDS_OTHER_SPEAKER] (red_ash_mini_04) $.scenes[17].events_and_claims[2]: character_claim by "도로시" (L14~L19) ends with 스노우 화이트 L19, and no item of 스노우 화이트's own covers it. Re-read it: give that reply its own item (agreement, confirmation or rebuttal is 스노우 화이트's character_claim; an action only is an established_event), or end this range before it. Leave it if it adds nothing to the scene
[PASS] batch_0355: mechanical validation succeeded (16 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (nonsense_red_03) $.scenes[10].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (nonsense_red_04) $.scenes[11].participants.present_in_scene[4].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (nonsense_red_05) $.scenes[12].participants.present_in_scene[0].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (nonsense_red_06) $.scenes[13].participants.mentioned_only[5].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0360: mechanical validation succeeded (4 warning(s)).
[PASS] batch_0433: mechanical validation succeeded (0 warning(s)).
[WARN][TERM_NOT_IN_SCENE] (white_memory_page_1001216) $.scenes[7].relationship_and_lore_notes[0]: uses "홍련의 언니" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[WARN][TERM_NOT_IN_SCENE] (white_memory_page_1001216) $.scenes[7].clues_and_hooks[1]: uses "홍련의 언니" (character name), which appears in other scenes but not in this scene's text or title. Re-read it: if it comes from another scene or prior knowledge, write only what this scene says (links to other scenes go in cross_scene_hints). If this scene says it in other words, keep it and report the line
[PASS] batch_0434: mechanical validation succeeded (2 warning(s)).
[PASS] batch_0435: mechanical validation succeeded (0 warning(s)).
[PASS] batch_0436: mechanical validation succeeded (0 warning(s)).
[PASS] batch_0437: mechanical validation succeeded (0 warning(s)).
[PASS] batch_0438: mechanical validation succeeded (0 warning(s)).
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_13) $.scenes[4].participants.present_in_scene[2].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[WARN][ENTITY_ID_SURFACE_MISMATCH] (ark_guardian_26) $.scenes[5].participants.present_in_scene[1].entity_id: "지휘관" is linked to "char_엔더슨", but it contains none of that entity's registered names (엔더슨). Re-read it: if only prior knowledge links them, set entity_id to null and add "지휘관" to unregistered_entity_candidates. If this scene shows they are the same, keep it and report the line
[PASS] batch_0439: mechanical validation succeeded (2 warning(s)).
```

### 4.2 `merge-and-index.mjs` 병합기 출력

- 병합 배치 수: **439배치**, 병합 장면 수: **5,560장면** (기대값과 일치)

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

- `node scripts/graph/agy-usage.mjs --supervisor 1365cf7a-0188-4279-8f27-57654e49c810 --from-request GRAPH_RAG_PASS1_REPAIR_ROUND4` 출력(스텝 117):
- `scripts/ 열람`은 감독관과 19개 서브에이전트 전원 **0건**이다.

```text
감독관 1365cf7a-0188-4279-8f27-57654e49c810 스텝 0 초과 ~ 116 (집계 시각까지의 중간 합계: 이 뒤의 감독관 스텝, 예를 들어 보고서 작성은 빠져 있다)

| 세션 | 역할 | 응답 | 비캐시 입력 | 캐시 읽기 | 출력 | scripts/ 열람 | 진행 중 오류 | 긴 대기 |
|---|---|---:|---:|---:|---:|---|---|---|
| 1365cf7a | supervisor | 47 | 859,779 | 3,897,099 | 66,935 | 0 | 스트림 끊김 2, 기타 7 | 0 |
| ad40073f | other | 25 | 276,797 | 3,331,437 | 39,840 | 0 | 0 | 0 |
| 3ef6b2fb | repair batch_0082 | 9 | 225,378 | 1,058,839 | 10,875 | 0 | 0 | 0 |
| ebc98571 | repair batch_0161 | 12 | 199,225 | 1,325,771 | 13,689 | 0 | 기타 1 | 0 |
| 6e29bb1b | repair batch_0436 | 10 | 226,834 | 974,555 | 40,569 | 0 | 0 | 0 |
| f5adc9e0 | repair batch_0162 | 9 | 200,555 | 1,006,788 | 17,746 | 0 | 0 | 0 |
| 984d8270 | repair batch_0435 | 13 | 212,651 | 1,633,387 | 21,384 | 0 | 0 | 0 |
| ec84d171 | repair batch_0437 | 11 | 371,061 | 1,016,279 | 34,350 | 0 | 0 | 0 |
| 1d927a93 | repair batch_0434 | 8 | 189,222 | 723,125 | 52,785 | 0 | 0 | 0 |
| 08890b4b | repair batch_0081 | 10 | 153,967 | 922,135 | 11,970 | 0 | 0 | 0 |
| d8a2e4df | repair batch_0160 | 8 | 153,309 | 679,983 | 12,307 | 0 | 0 | 0 |
| 47c6ae47 | repair batch_0355 | 8 | 148,376 | 665,110 | 13,228 | 0 | 0 | 0 |
| 0d507fe2 | repair batch_0438 | 9 | 165,845 | 747,369 | 38,455 | 0 | 0 | 0 |
| c770e85e | repair batch_0330 | 10 | 139,521 | 861,551 | 10,067 | 0 | 도구 실패 1 | 0 |
| 65359774 | repair batch_0116+batch_0439 | 8 | 139,889 | 666,111 | 13,955 | 0 | 0 | 0 |
| a9341613 | repair batch_0114+batch_0354 | 9 | 147,750 | 798,731 | 13,906 | 0 | 도구 실패 1 | 0 |
| 2c9259cd | repair batch_0317+batch_0433 | 8 | 151,593 | 665,026 | 22,578 | 0 | 0 | 0 |
| 940cb089 | repair batch_0065+batch_0083+batch_0360 | 7 | 143,042 | 586,557 | 15,271 | 0 | 0 | 0 |
| 613848a8 | repair batch_0209+batch_0236+batch_0316 | 7 | 142,872 | 601,685 | 13,646 | 0 | 0 | 0 |
| 84241c60 | review | 50 | 727,549 | 5,091,831 | 82,480 | 0 | 0 | 0 |
| **합계** | | 278 | 4,975,215 | 27,253,369 | 546,036 | | 스트림 끊김 2, 도구 실패 2, 기타 8 | 0 |

thinking 토큰 수는 로그에 없다. output_tokens에 포함되는지는 확인 안 됨.
scripts/ 열람은 파일 열람 도구 기록과, cat·sed 등 셸 명령에 scripts/ 경로가 들어간 경우를 센다. 다른 방법으로 읽은 것은 잡지 못한다.
진행 중 오류는 세션 안에서 이어져 복구된 것도 센다(출력 잘림·스트림 끊김은 실행 환경의 오류 메시지, 도구 실패는 실패한 도구 스텝).
긴 대기는 도구 스텝의 시작~완료 기록이 10분 이상인 것이다. 명령이 오래 걸렸는지 결과 전달이 늦었는지는 로그로 알 수 없다.
```

---

## 6. 보수자·검토자가 "지적과 무관하게 본 오류"로 적은 것 전체 (고치지 않음)

### 6.1 보수 서브에이전트가 보고한 무관 오류

- **`batch_0081` (`08890b4b`)**:
  - `red_ash_00` L53, L55: `forms_of_address`에서 복수 호칭 `"두 분"`의 `to_target`을 `"레드 후드, 스노우 화이트"` 한 항목으로 묶지 않고 인물별 두 항목으로 나누어 기록함(`GRAPH_RAG_PASS1_RULES.md` 3절 10항)
  - `red_ash_03` L30~31, L35~36, L68~71: `forms_of_address`에서 복수 호칭 `"너희"`, `"자네들"`의 `to_target`에 현장의 대상 전원 대신 직후 반응한 한 명(라푼젤, 도로시, 릴리바이스)만 기록함(`GRAPH_RAG_PASS1_RULES.md` 3절 10항)
- **`batch_0082` (`3ef6b2fb`)**:
  - `red_ash_07` L67~75: `events_and_claims`의 L67~69, L70~73, L74~75 세 항목 요약이 각 줄 범위 원문과 어긋나며 L70~73 요약에 장면 원문에 없는 내용(`"갓데스 스쿼드가 반격을 시작했지만 전황을 뒤집기엔 한참 부족해"`)이 섞여 있음
  - `red_ash_08` L39: `events_and_claims[11]` 원문은 `"그럼 지금은 성숙미가 있겠군."`인데 요약이 `"지금도 야성적인 매력이 있지 않냐고 묻는다"`로 잘못 적힘
  - `red_ash_09` L32~37, L93~97: `events_and_claims[3]`(L32~37) 요약에 원문에 없는 `"홍련이 작전을 묻자"`가 들어가 있고, `events_and_claims[12]` 및 `relationship_and_lore_notes[1]`(L93~97) 요약이 앞 구간(L89~91)의 내용을 중복 요약함
  - `red_ash_10` L72~74: `events_and_claims[10]` 원문은 유품을 주려고 부른 것이냐는 도로시의 물음과 레드 후드의 긍정인데 요약이 `"필요한 것이 있으면 말하라고 권하자 도로시와 홍련이 침묵한다"`로 잘못 적힘
  - `red_ash_12` L6, L8 / `red_ash_14` L34 / `red_ash_16` L43: 복수 인물을 가리키는 호칭(`"너희"`, `"둘"`)의 `to_target`에 대상 인물 일부만 적힘
- **`batch_0083`, `batch_0360` (`940cb089`)**:
  - `red_ash_23` L15: `mentioned_only[3]`에서 `"릴리스"`를 등록 엔티티 `char_릴리바이스`로 연결했음에도 `unregistered_entity_candidates`에 `"릴리스"`를 중복 기재함
  - `red_ash_23` L18~21: `relationship_and_lore_notes[1]`·`[2]`(`claimant: "홍련"`, `claim_line: 21`)의 `relation_or_change`에 도로시의 대사(L19~20 `"현재 연락이 두절된 상태"`) 내용을 함께 섞어 적음
  - `nonsense_red_06` L9: `mentioned_only[4]`에서 `"릴리스"`를 등록 엔티티 `char_릴리바이스`로 연결했음에도 `unregistered_entity_candidates`에 `"릴리스"`를 중복 기재함
  - `nonsense_red_06` L18, L27: 라푼젤이 부재 중인 현재 지휘관을 독백에서 3인칭으로 가리킨 `"형제님"`(`"형제님의 방에서"`, `"형제님이 오실 때까지"`)을 직접 부른 호칭(`forms_of_address`)으로 적고 `mentioned_only`에서는 누락했으며, 장면 `summary`에 원문에 없는 `"지휘관의 방"`·`"지휘관이 올 때까지"`로 표기함
- **`batch_0116`, `batch_0439` (`65359774`)**:
  - `old_tales_16` L6: `events_and_claims[2]`(범위 L6~6)의 `summary`에 범위 밖인 L7 도로시의 질문 내용(`"도로시가 누구를 말하는 것이냐고 묻는다"`)이 포함됨(L7은 `events_and_claims[3]`에 별도 추출됨)
  - `ark_guardian_26` L1~336: L1~314는 과거 아크 가디언 시점이고 L315~336은 현재 바디에 적응해 깨어난 스노우 화이트와 세실의 대화이나 장면 `chronology_type`이 `mixed`가 아닌 `present`로 기록됨
- **`batch_0161` (`ebc98571`)**:
  - `ark_guardian_11` L11~195: 지휘관이 전장을 달리는 릴리바이스에게 통신으로 연락하며 대화하는데(L16 `"안 그래도 그거 때문에 연락했어."`, L194 `"그쪽으로 갈게요 그냥."`) `remote_or_voice_only`가 아닌 `present_in_scene`으로 분류되어 있음
- **`batch_0162` (`f5adc9e0`)**:
  - `ark_guardian_18` L92~93: 라푼젤의 `character_claim` 항목 범위에 스노우 화이트의 동의 대사(L92 `"예."`)가 함께 묶여 있고 스노우 화이트의 항목이 따로 없음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_18` L94~95: 홍련의 `character_claim` 항목 범위에 도로시의 평가 대사(L94 `"요약을 잘하시네요."`)가 함께 묶여 있고 도로시의 항목이 따로 없음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_20` L12~15: 도로시의 `character_claim` 항목 범위에 릴리바이스의 이름 유래 주장(L14 `"응. 내 이름, 이 꽃에서 따왔대."`)이 묶여 있고 릴리바이스의 항목이 따로 없음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_20` L16~19: 라푼젤의 `character_claim` 항목 범위에 스노우 화이트(L16)와 홍련(L17)의 평가 대사가 묶여 있음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_20` L122~124: 릴리바이스의 `character_claim` 항목 범위에 홍련(L122)과 라푼젤(L123)의 신규 장비 수령 및 전력 상승 주장이 묶여 있음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_20` L131~133: 릴리바이스의 `character_claim` 항목 범위에 스노우 화이트의 사과(L131)와 도로시의 답(L132)이 묶여 있음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_21` L9~11, L55~58, L59~61, L74~76, L77~80: 각 `character_claim` 항목 범위 안에 다른 화자(릴리바이스 L10, 라푼젤 L57, 지휘관 L60·L75, 라푼젤 L79)의 주장·지적이 함께 묶여 있음(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
  - `ark_guardian_22` L58, L79: `forms_of_address`에서 지휘관이 릴리바이스를 부른 `릴리스`(L58)와 스쿼드원들을 가리킨 2인칭 `너희들`(L79) 호칭 누락(`GRAPH_RAG_PASS1_RULES.md` 3절 10항)
  - `ark_guardian_23` L64~65: 스노우 화이트의 대사 `"무섭다. 언니. 레드 후드."`(L64)에서 `언니`는 릴리바이스를 부른 호칭이나 `forms_of_address[1]`·`events_and_claims[7]`·`relationship_and_lore_notes[0]`에서 레드 후드를 언니라고 부른 것으로 잘못 기술됨
  - `ark_guardian_24` L98, `ark_guardian_25` L86: `릴리스` 별칭 지칭이 나오나 `relationship_and_lore_notes`(릴리바이스→릴리스 동일 인물) 및 `unregistered_entity_candidates`에서 누락됨
- **`batch_0354` (`a9341613`)**:
  - `red_ash_lost_07` L70: 릴리바이스가 라푼젤을 부른 2인칭 대명사 호칭 `"너"`(`"응? 너 맨몸으로 온 거야? 짐 없어?"`)가 `forms_of_address`에서 누락됨
- **`batch_0355` (`47c6ae47`)**:
  - `red_ash_lost_08` L30~31: `relationship_and_lore_notes[0]`의 범위(L30~31)에는 지휘관이 `'릴리스'`라고 부른 대사만 있는데 `relation_or_change`에 범위를 벗어난 스노우 화이트(L55, L63)까지 함께 적음
  - `red_ash_lost_08` L70~71: `events_and_claims[16]`에서 라푼젤의 말에 대한 도로시의 1줄 동의(`"그렇네요."`)를 `character_claim`이 아닌 `established_event`로 기록함
  - `red_ash_lost_11` L10~15: `relationship_and_lore_notes[0]`의 범위(L10~15)에는 지휘관과 릴리스만 언급되는데 `relation_or_change`에 회상 구간(L64)의 스노우 화이트까지 함께 적음
  - `red_ash_lost_19` L16: `mentioned_only`에서 `char_릴리바이스`로 연결된 등록 별칭 `릴리스`가 `unregistered_entity_candidates`에도 중복 기재됨
- **`batch_0434` (`1d927a93`)**:
  - `white_memory_page_1001306` L3: `"일종의 창고의 용도로 쓰였던 것 같다고 판단한"` 추측이 `character_claim`으로 분리되지 않고 L2~3 `established_event`에만 묶여 있음
  - `white_memory_page_1001307` L8: `"떠나간 분들을 애도하는 곳이었나 보네요."` 추측 대사가 `character_claim`으로 분리되지 않고 L8~10 `established_event`로만 기록됨
  - `white_memory_page_1001404` L5: `"[네가 스노우 화이트지?]"`의 2인칭 대명사 호칭 `'네'`가 `forms_of_address`에서 누락됨
- **`batch_0436` (`6e29bb1b`)**:
  - `fading_affection_2248` L5, `fading_affection_2256` L11, `fading_affection_2261` L6, `fading_affection_2263` L9: 마리안이 지휘관을 부른 직책 호칭(`"지휘··· 관"`, `"지휘관"`)이 `forms_of_address`에서 누락됨
  - `fading_affection_2259` L5: 현장에서 마리안과 눈을 마주치고 대화하는 `"남자"`가 `document_author.voices`에만 있고 `present_silent`에서 누락됨
- **`batch_0437` (`ec84d171`)**:
  - `fading_affection_2270` L3~14: 원문에 `"두 사람"`과 라벨 없는 대사만 있고 `"지휘관"` 표기가 없으나, 기존 출력의 `summary`·`voices`·`events_and_claims`에 앞 장면 지식으로 `"지휘관"`이 쓰임
  - `fading_affection_2308` L2~4: 원문에 라벨 없는 대사와 표정 묘사만 있고 `"지휘관"` 표기가 없으나, 기존 출력의 `summary`·`voices`·`events_and_claims`·`clues_and_hooks`에 앞 장면 지식으로 `"지휘관"`이 쓰임
  - `fading_affection_2315` L4: `mentioned_only`의 `"마리아 박사"`가 `entity_id: null` 및 `unregistered_entity_candidates`로 적혀 있으나, `USER_CONFIRMED_ALIASES`의 `char_마리안` 별칭임

### 6.2 독립 검토자(`84241c60`)가 보고한 무관 잔존 오류 (검토 26장면 중 107건)

- **`white_memory_page_1001211` (`batch_0434`) — 1건**:
  - `events_and_claims[0]` (L2): `actor_or_speaker`를 `"스노우 화이트, 홍련"`으로 복수 기재(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
- **`fading_affection_2249` (`batch_0436`) — 1건**:
  - `events_and_claims[2]` (L6, `[L0006] "어떻게··· 너를···!"`): 지문 묘사 없는 따옴표 대사인데 `established_event`로 기록(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
- **`fading_affection_3134` (`batch_0438`) — 4건**:
  - `events_and_claims[0]~[3]` (L2~3, L5, L7, L9): 과거의 이름을 회상하는 항목인데 `refers_to_past: false`로 기록(`GRAPH_RAG_PASS1_RULES.md` 3절 6항)
- **`ark_guardian_00` (`batch_0160`) — 2건**:
  - `events_and_claims[6]` (L19~24): `actor_or_speaker` 복수 기재(`"세실, 스노우 화이트"`) 및 지문 없는 대사 구간을 `established_event`로 기록
  - `events_and_claims[15]` (L71~82): `actor_or_speaker` 복수 기재(`"스노우 화이트, 세실"`)
- **`ark_guardian_08` (`batch_0160`) — 6건**:
  - `unregistered_entity_candidates[1]` (L33): `mentioned_only[2]`에서 `char_릴리바이스`가 부여된 `"릴리스"`를 미등록 후보에 중복 등재(`GRAPH_RAG_PASS1_RULES.md` 3절 5항)
  - `events_and_claims[0]` (L2~6): 복수 주체(`"홍련, 도로시"`)
  - `events_and_claims[2]` (L9), `events_and_claims[19]` (L62~63): 지문 없는 대사를 `established_event`로 기록
  - `events_and_claims[9]` (L37~38), `events_and_claims[14]` (L49~55): 복수 주체(`"홍련, 도로시"`) 및 지문 없는 대사를 `established_event`로 기록
- **`ark_guardian_26` (`batch_0439`) — 22건**:
  - `same_scene_speaker_groups` 누락 (L26~28): 같은 장면 안의 `"지휘관"`과 `"엔더슨"` 화자 라벨 동일 인물 묶음 누락(`GRAPH_RAG_PASS1_RULES.md` 3절 1항)
  - `unregistered_entity_candidates[12]`(L285 `"레드 슈즈"`), `[14]`(L287 `"에닉"`): `mentioned_only`에 `entity_id`가 부여된 등록 인물을 미등록 후보에 중복 등재(`GRAPH_RAG_PASS1_RULES.md` 3절 5항)
  - 복수 주체(`actor_or_speaker` 쉼표 병기) 7건: `ev[0]`(L7~12), `ev[6]`(L40~53), `ev[12]`(L79~85), `ev[14]`(L97~116), `ev[16]`(L123~129), `ev[28]`(L183~189), `ev[45]`(L315~336)
  - 복수 주체 + 지문 없는 대사 `established_event` 8건: `ev[1]`(L13~18), `ev[9]`(L68~71), `ev[17]`(L130~137), `ev[27]`(L178~182), `ev[33]`(L197~200), `ev[34]`(L201~206), `ev[36]`(L210~216), `ev[39]`(L223~231)
  - 단일 주체 지문 없는 대사 `established_event` 3건: `ev[3]`(L26), `ev[22]`(L164), `ev[41]`(L249~254)
  - 시제(`refers_to_past`) 누락 1건: `ev[42]`(L255~268, L263 과거 설계 사실 포함)
- **`red_ash_00` (`batch_0081`) — 7건**:
  - `forms_of_address` 누락 1건 (L39, 레드 후드의 `"대장"`)
  - `events_and_claims[19]` (L59~61) 요약 왜곡 1건: 원문 `"오래전 영상 자료"`를 `"오래전 프로레슬링 영상 자료"`로 단정
  - 지문 없는 순수 대사 `established_event` 5건: `ev[6]`(L32~34), `ev[22]`(L64~66), `ev[25]`(L71~75), `ev[27]`(L85~88), `ev[37]`(L108~110)
- **`red_ash_lost_03` (`batch_0354`) — 10건**:
  - `unregistered_entity_candidates[0]` (L58 `"릴리스"`): `mentioned_only[0]`에서 `char_릴리바이스`가 부여된 항목 중복 등재
  - 복수 주체 4건: `ev[0]`(L2~7), `ev[7]`(L19~24), `ev[19]`(L49~50), `ev[22]`(L56~60)
  - 지문 없는 순수 대사 `established_event` 5건: `ev[1]`(L8), `ev[2]`(L9~11), `ev[3]`(L12~13), `ev[18]`(L46~48), `ev[21]`(L54~55)
- **`snowwhite_young_00` (`batch_0316`) — 5건**:
  - `forms_of_address` 누락 1건 (L7 `"릴리스 언니"`, L18 `"언니"`)
  - 지문 없는 순수 대사 `established_event` 4건: `ev[1]`(L4~11), `ev[8]`(L22~25), `ev[11]`(L40~44), `ev[16]`(L69~77)
- **`rapunzel_puregrace_04` (`batch_0330`) — 10건**:
  - 복수 주체 1건: `ev[21]`(L64~72)
  - 복수 주체 + 지문 없는 대사 `established_event` 6건: `ev[10]`(L31~35), `ev[11]`(L36~39), `ev[22]`(L73~77), `ev[23]`(L78~80), `ev[32]`(L100~111), `ev[34]`(L114~116)
  - 단일 주체 지문 없는 대사 `established_event` 3건: `ev[8]`(L27~28), `ev[13]`(L42~43), `ev[36]`(L118)
- **`old_tales_00` (`batch_0114`) — 11건**:
  - `participants` / `same_scene_speaker_groups` 누락 1건 (L116 `그레텔`, L131~135 `헨젤 & 그레텔`)
  - 지문 없는 순수 대사 `established_event` 9건: `ev[2]`(L21~22), `ev[4]`(L26), `ev[5]`(L27~32), `ev[8]`(L39), `ev[10]`(L41), `ev[14]`(L51~55), `ev[15]`(L56~62), `ev[17]`(L72~75), `ev[34]`(L128~135)
  - 시제(`refers_to_past`) 누락 1건: `ev[21]`(L86~89)
- **`old_tales_16` (`batch_0116`) — 6건**:
  - `events_and_claims[2]` (L6) 범위 밖 내용 혼입 1건 (L7 도로시의 질문 포함)
  - 지문 없는 순수 대사 `established_event` 5건: `ev[3]`(L7), `ev[4]`(L8~12), `ev[5]`(L13~14), `ev[9]`(L21~25), `ev[10]`(L26~33)
- **`nonsense_red_03` (`batch_0360`) — 7건**:
  - 복수 주체 + 지문 없는 대사 `established_event` 4건: `ev[0]`(L2~7), `ev[3]`(L11~12), `ev[4]`(L13~18), `ev[24]`(L57~59)
  - 단일 주체 지문 없는 대사 `established_event` 3건: `ev[17]`(L40~42), `ev[27]`(L65~67), `ev[30]`(L70~71)
- **`coin_rush_show_down_02` (`batch_0209`) — 9건**:
  - 복수 주체 + 지문 없는 대사 `established_event` 1건: `ev[11]`(L59~60)
  - 복수 주체 6건: `ev[28]`(L125~129), `ev[32]`(L135~144), `ev[33]`(L145~150), `ev[39]`(L172~177), `ev[46]`(L199~216), `ev[48]`(L223~234)
  - 단일 주체 지문 없는 대사 `established_event` 2건: `ev[34]`(L151~153), `ev[35]`(L154)
- **`over_zone_00` (`batch_0065`) — 3건**:
  - `relationship_and_lore_notes[1]` (L21~30): 범위 밖 내용(L8, L16) 혼입 및 `refers_to_past: false`
  - `events_and_claims[0]`(L3~6), `events_and_claims[2]`(L20~30): 시제(`refers_to_past`) 누락
- **`반드시사수하라_01` (`batch_0236`) — 3건**:
  - `events_and_claims[0]`(L2), `[2]`(L5), `[4]`(L7~10): 지문 묘사 없는 녹음 음성 대사인데 `established_event`로 기록

---

## 7. 규칙·도구의 문제점 제안

1. **0단계 기계적 별칭 치환 시 `unregistered_entity_candidates` 동기화**:
   - 0단계 기계적 수정(`repair-round4-mechanical.mjs`)에서 `mentioned_only`의 `"릴리스"` 등에 등록 엔티티(`char_릴리바이스`)를 연결할 때, 같은 장면의 `unregistered_entity_candidates`에 남아 있던 동일 표기(`"릴리스"`, `"레드 슈즈"`, `"에닉"`)가 함께 정리되지 않아 보수자·검토자가 중복 등재로 반복 지적했다. 기계적 연결 스크립트나 검증기에서 `mentioned_only`에 비-`null` `entity_id`가 부여된 표기가 `unregistered_entity_candidates`에 남아 있으면 경고/자동 제거하도록 개선할 것을 제안한다.
2. **같은 장면 안의 복수 화자 라벨이 동일 `entity_id`를 가질 때 `same_scene_speaker_groups` 검사**:
   - `ark_guardian_26`처럼 보수를 통해 `"지휘관"`과 `"엔더슨"` 두 화자 라벨이 모두 `char_엔더슨`을 가리키게 되었을 때, `same_scene_speaker_groups`가 비어 있어도 기계 검증기가 경고하지 않는다. `present_in_scene` / `remote_or_voice_only` 내에 동일한 `entity_id`를 가진 서로 다른 `speaker_label`이 2개 이상 존재하면 `same_scene_speaker_groups` 누락 경고를 내도록 검증 규칙을 보완할 것을 제안한다.
