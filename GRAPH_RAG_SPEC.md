# GRAPH_RAG_SPEC — 니케 스크립트 아카이브 GraphRAG 구축 명세

이 문서는 `nikke-script-archive`의 등록된 전체 스크립트를 분석해 니케 전용 GraphRAG 시스템(`data/graph/`)을 구축하기 위한 **단일 진실 공급원(Single Source of Truth)**이다.
감독관(메인 세션), 모든 서브에이전트, 재개(Resume)·증분 업데이트 작업은 이 문서 전체를 기준으로 삼는다. 이 문서를 임의로 수정하지 마라. 변경이 필요하면 사용자에게 제안하라.

- 스포일러 필터는 구현하지 않는다. (사용자는 스토리를 이미 다 아는 사람이라는 전제)
- 실행 순서: 8절의 1.3.0 전환 작업부터. Pass 2 이후는 사용자 승인 후에만 진행한다.

---

## 1. 레포지토리 데이터 기준 및 배치 규칙 (Ground Truth)

### 1.1 단일 등록 기준: `newScriptsData`
- 대본 원문은 `public/scripts/<분류>/...txt`에 있다. 블라블라는 하위 폴더가 있다(예: `blabla/group/777.txt`).
- 등록 기준은 앱과 동일하게 **`data/newScripts.ts`의 `newScriptsData` 하나뿐**이다. 메인 스토리도 여기에 포함되어 있다.
  - `data/mainStoryScripts.ts`는 앱이 쓰지 않는 옛 파일이다. 합치지 마라.
  - 폴더를 직접 훑지 마라. `event_stories/chocolate_please.txt`처럼 등록되지 않은 중복 파일이 섞여 있다.
- `newScriptsData`는 TypeScript다. Node 스크립트에서는 `npm run build:search-assets`가 만드는 컴파일 결과(`.generated-search-assets/data/newScripts.js`)를 `require`해서 읽어라. 기존 `scripts/buildSearchAssets.mjs`가 같은 방식을 쓴다.
- 각 항목의 원문 경로는 `public/scripts/<categoryKey>/<mainChapterFile>`이다.
- 분류·타이틀·장면 개수는 하드코딩하지 말고 실행 시 매니페스트(`data/graph/manifest.json`)에서 계산하라.

### 1.2 원문 형식 (정확히 이대로 파싱하라)
- 각 장면은 `@@@SCRIPT_ID: <id>` 줄로 시작하고, 바로 다음 줄에 `@@@SUB_TITLE: <부제>` 줄이 올 수 있다.
- **블록은 `@@@SCRIPT_ID:` 기준으로만 나눈다.** `@@@` 전체를 기준으로 나누면 `@@@SUB_TITLE`이 별도 블록이 되어 모든 장면 ID가 깨진다. 이 버그는 실제로 한 번 발생했다.
- 파일에 `\r\n`이 섞여 있을 수 있다. 줄바꿈을 `\n`으로 정규화한 뒤 파싱하라.
- **줄 번호**는 `@@@SCRIPT_ID`·`@@@SUB_TITLE` 줄을 제외한 장면 본문 기준으로 1부터 센다. 파일 절대 줄 번호가 아니므로 다른 장면이 수정되어도 ID가 바뀌지 않는다.
- 장면 ID는 숫자로 끝난다(예: `2x2_love_1ch_13`). `_A`, `_B`로 끝나는 ID는 없다.
- 일반 대사는 `화자: 대사` 형식이다. 화자 라벨은 줄 처음부터 첫 `:`까지다.
- 대괄호 태그:
  - `[SCENE START]`, `[SCENE END]`, `[NEXT_SUBCHAPTER_BUTTON TEXT=...]`
  - `[CHOICE_START]` 또는 `[CHOICE_START ID="..."]` 안에 `[OPTION TEXT="..."]` ... `[OPTION_END]` 블록들, 그리고 `[CHOICE_END]`
  - `[NEXT_ROUTE IF_CHOICE="<choice id>" OPTION="<option id>" TARGET="<scene id>"]`, `[NEXT_ROUTE DEFAULT TARGET=...]`
- 블라블라(메신저) 형식:
  - `[MESSENGER_START TITLE="..." PARTICIPANTS="a,b,지휘관"]` ... `[MESSENGER_END]`
  - 화자는 `[MSG SENDER="..."]` 태그에 있고, 메시지 본문은 그 다음 줄부터 `[MSG_END]` 전까지다.
  - 메시지 본문 줄은 `화자: 대사` 정규식으로 해석하지 마라.

### 1.3 분기 판별
- **병렬 갈래는 `[NEXT_ROUTE IF_CHOICE=... TARGET=...]` 태그로만 판별한다.** 같은 선택지에서 갈라진 TARGET 장면들은 서로 병렬 갈래다.
- 부제 끝의 `[A]`/`[B]`나 `: A`/`: B`는 **순서대로 이어지는 파트**다. 병렬 갈래가 아니다.
  - 예: `second_affection_08`(`9 [A]`)은 전투 중에 끝나고, `_09`(`9 [B]`)는 "클리어."로 시작한다.
  - 파일럿에서 확인한 사실이다. 이전 판의 "부제 루트" 규칙은 틀렸으므로 폐기한다.

### 1.4 용량 기준 배치와 샤드 단위 출력
- 장면 경계만 지키며 원문 약 40~80KB 단위로 배치를 나눈다. 타이틀 경계는 지키지 않아도 된다.
  - 예: `2x2_love_1ch.txt`는 한 파일이 568KB다.
  - 장면 하나가 80KB를 넘으면 그 장면만으로 배치 하나를 만든다.
- 배치 출력은 반드시 `data/graph/pass1/shards/<batch_id>.json`(예: `batch_0001.json`)이다. 타이틀별 뷰는 병합기가 만든다.

### 1.5 배치 입력: 줄 번호 태깅과 기계 추출
배치 생성 스크립트는 서브에이전트에게 장면마다 다음을 준다.
- `numbered_script`: 본문 각 줄 앞에 `[L0001]` 형식의 번호를 붙인 원문
- `mechanical_ground_truth`: 정규식으로 미리 뽑은 값
  - (a) `speakers`: 일반 대사 화자 라벨, 메신저 `SENDER` 값, `PARTICIPANTS` 값. 각각 출처 구분을 포함한다.
  - (b) `unknowns`: `???:` 대사 줄마다 `{ unknown_id: "unk_<scene_id>_L<4자리 줄번호>", line, text }`.
    **들여쓰기된 줄도 포함한다**(정규식 `^\s*\?\?\?:`). 선택지 블록 안에 들여쓰기된 `???:` 줄이 24개 있다.
  - (c) `choices`: `CHOICE_START`, `OPTION`, `NEXT_ROUTE` 태그의 줄 번호와 속성만 담는다. 선택지 내부 대사 줄 배열(`body_lines`)은 `numbered_script`와 중복이므로 넣지 않는다.
  - (d) `route`: 1.3의 `NEXT_ROUTE` 분기 정보(나가는 루트, 들어오는 루트, 병렬 장면). 부제 기반 병렬 판별은 하지 않는다.
  - (e) `line_speaker`: 줄 번호 → 그 줄의 화자 (대사 줄만). 메신저는 `[MSG SENDER]` 줄과 그 본문 줄 모두에 발신자가 들어간다. 지문·제어 태그 줄에는 없다.
    - `[OPTION TEXT="..."]` 줄의 화자는 `지휘관`이다. 선택지는 지휘관의 대사이기 때문이다(메신저 안의 선택지도 같다).
    - 따라서 선택지가 있는 장면에서는 `지휘관`이 `speakers`에 들어간다(출처 `option`).

### 1.6 화자 표기와 인물 정체(Entity ID) 분리
- `scripts/speakerAssets.mjs`는 같은 표기를 묶는 기능이다. 인물 정체 레지스트리로 그대로 쓰지 마라.
- `"???"`와 `"병사"`, `"연구원"`, `"양산형 니케"`, `"시민"` 같은 일반 역할 명사는 여러 인물일 수 있다. `is_generic_role: true`, `entity_id: null`로 둔다.
  - 일반 역할 목록은 `init-registry.mjs`가 휴리스틱으로 초안을 만들고, 사용자가 검토할 수 있게 별도 파일(`data/graph/generic_roles.json`)로 둔다.
- 다른 이름으로 불린 두 화자가 같은 인물이라는 연결에는 반드시 대본 근거가 필요하다.
- `검은 물을 덮은 소녀`(215줄), `양산을 든 여성`(52줄)처럼 묘사형 라벨로 발화하는 화자는 사실상 정체가 가려진 특정 인물일 수 있다.
  - `generic_roles.json`에서 `role_category: "descriptor_alias"`로 따로 표시한다.
  - 휴리스틱이 묘사형으로 분류한 라벨은 사용자가 검토한다. 결과는 `data/graph/descriptor_review.json`(`keep`, `drop`)에 두고, `init-registry.mjs`가 읽어 반영한다. `generic_roles.json`은 실행할 때마다 다시 만들어지므로 직접 고치지 않는다.
    - `keep`: 정체를 가린 인물로 추적한다(`descriptor_alias`).
    - `drop`: 묘사형 라벨이지만 추적하지 않는다(`descriptor_excluded`). 지나가는 엑스트라이거나, `인자해 보이는 남자`처럼 끝까지 같은 라벨로만 나와 밝혀질 정체가 없는 경우다. 대사는 일반 역할 화자로 그대로 추출된다.
    - 검토하지 않은 새 묘사형 라벨은 `descriptor_alias`로 두고 `review_status: "unreviewed"`로 표시한다. 새 대본을 추가하면 이 목록을 검토한다.
  - **다른 타이틀에 나오는 같은 묘사형 라벨을 같은 인물로 가정하지 마라.** `안경 쓴 여자`는 이야기마다 다른 인물일 수 있다. 추적 단위는 (라벨, 타이틀)이고, 타이틀을 넘는 연결에는 대본 근거가 필요하다.
  - Pass 2에서 `???`와 같은 방식으로 정체 후보를 찾는 대상에 포함한다.
  - Pass 1에서는 일반 역할과 똑같이 `entity_id: null`로 둔다. 대신 `descriptor_speakers`에 장면마다 라벨별로 말투·단서·같은 장면 내 정체 공개를 적는다(3절 3항). `???`와 달리 줄마다가 아니라 라벨마다 한 항목이다.
  - 배치 입력의 `speakers`에 `is_descriptor_alias: true`를 붙여 추출자가 대상을 알 수 있게 한다.
- 등록되지 않은 신규 엔티티는 `unregistered_entity_candidates`에 원문 표기 그대로 적는다. 정식 ID는 병합 단계에서 부여한다.

---

## 2. 감독관(메인 세션) 절대 수칙 — 컨텍스트 보호와 동시성 제어

### 2.1 원문과 대량 카드를 직접 읽지 않는다
- 감독관은 대본 원문이나 수백 개의 추출 카드를 자기 컨텍스트에서 직접 읽지 마라.
- 추출(Pass 1), 샤드별 후보 매칭(Pass 2), 원문 대조 검증(Pass 3)은 서브에이전트에게 배치 단위로 맡긴다.
- 집계·역색인·병합은 Node.js 스크립트로 처리한다.
- 서브에이전트는 결과를 파일로 저장하고, 감독관에게는 `[완료] batch_0001: 장면 N개, ??? M건, 검증 통과(재시도 K회)` 같은 1~2줄만 보고한다.

### 2.2 공용 파일 동시 수정 금지
- 서브에이전트는 `progress.json`, `entity_registry.json`, `manifest.json`, `pass1_index.json`, `verified_edges.json` 등 공용 파일을 절대 직접 수정하지 않는다.
- 서브에이전트는 자기 몫의 샤드 파일만 쓴다: `pass1/shards/<batch_id>.json`, `pass2/shards/<task_id>.json`, `pass3/shards/<task_id>.json`
- 공용 파일은 단일 병합 스크립트만 갱신한다.
  - 새 버전을 임시 파일에 모두 쓰고 검증한 뒤 `rename`으로 원자적으로 교체한다.

### 2.3 기계 검증기(`validate-output.mjs`) 필수 검사
하나라도 실패하면 Exit Code 1이다. 작업 완료는 에이전트의 보고가 아니라 검증기 통과로만 판정한다.

**장면·참여자**
1. **장면 완전성**: 배치의 모든 `scene_id`가 결과에 빠짐없이 있어야 한다. 배치에 없는 `scene_id`가 있어도 오류다.
2. **화자 실존과 완전성**: `present_in_scene`과 `remote_or_voice_only`의 `speaker_label`은 반드시 그 장면의 `mechanical_ground_truth.speakers` 안에 있어야 한다. 반대로 `speakers`의 라벨(`???` 제외)은 모두 둘 중 한 곳에 있어야 한다. 1.2.0에서는 799개 장면 중 1개에서 화자가 빠졌다(`main_08_05`의 `지휘관`).
   - 본문 아무 곳에 이름이 있다는 이유로 통과시키지 마라. 그러면 언급만 된 인물이 등장 인물로 통과한다.
3. **`???` 완전성**: 원문의 모든 `???:` 줄이 `unknown_speakers`에 정확한 `unknown_id`로 있어야 한다. 없는 ID를 지어내도 오류다. (메신저 `[MSG SENDER="???"]`는 현재 원문에 0건이다. 생기면 같은 규칙을 적용한다.)
4. **묘사형 화자**: 장면의 `speakers` 중 `is_descriptor_alias: true`인 라벨마다 `descriptor_speakers`에 항목이 정확히 하나 있어야 한다. 그 외 라벨이 있으면 실패다. 대표 대사 범위(`line_start`~`line_end`)의 대사 줄은 모두 그 라벨의 줄이어야 한다.
5. **기록물 작성자**: `document_author`가 `null`이 아니면 `name`이 있거나 `voices`가 1개 이상이어야 한다.

**인용과 귀속**

6. **인용 위치**: 모든 `quote`는 해당 항목의 `line_start`~`line_end` 범위 원문 안에 있어야 한다.
   - **최소 길이**: 공백 정규화 후 4자 이상이어야 한다. 단, 범위 원문의 대사 전체가 4자 미만이면 그 대사 전체와 같아야 한다. `다` 같은 한 글자 인용이 아무 줄에나 통과하는 것을 막기 위함이다.
   - 비교 전에 공백만 정규화한다. `···`와 `...`는 같은 것으로 보지 않는다.
   - 여러 줄 인용에서는 두 형태를 모두 허용한다.
     - 범위 원문을 그대로 이은 문자열
     - 각 줄에서 `화자:` 라벨과 제어 태그를 뗀 대사만 이은 문자열
   - 중간을 생략한 인용(`...`로 건너뛰기)은 허용하지 않는다. 이어지지 않는 부분은 항목을 나눠라.
   - 비교할 때 인용문 쪽에서도 줄 앞의 `화자:` 라벨을 떼고 비교한다. 라벨을 붙인 줄과 뗀 줄이 섞인 인용도 통과시키기 위함이다.
   - 대사 사이에 낀 지문·효과음 줄은 건너뛸 수 없다. 포함하거나 항목을 나눈다.
   - 장면 어딘가에만 있고 지정 범위에 없으면 실패다.
   - `unknown_speakers[].quote`는 그 `???` 줄 안에 있어야 한다.
7. **주장 화자** (`events_and_claims`의 `actor_or_speaker`, 관계 메모의 `claimant`): `epistemic_type`이 `character_claim`이면 다음을 검사한다.
   - `claim_line`이 필수이고 `line_start`~`line_end` 안에 있어야 한다.
   - 화자는 한 명이다. `,` `、` `/` `·`가 있으면 실패다.
   - `claim_line` 줄의 `line_speaker`와 같아야 한다. 메신저는 `[MSG SENDER]` 줄과 본문 줄 모두 `line_speaker`에 발신자가 들어 있다.
   - `claim_line`이 지문 줄이면(`line_speaker` 없음) 주장 화자는 그 줄에 이름이 나온 전달자이거나, 전달자가 없으면 `"지문"`이어야 한다. 예: "크로우는 방주의 선택을 보고 싶다고 했다"(`main_24_02`) → `크로우`. "내부 공간은 편안하고 따뜻했다고 했다"(`main_42_15`) → `"지문"`. 이런 간접화법 지문은 등록 원문 전체에 28줄 있다.
   - `quote`가 실제로 걸치는 줄에 `claim_line`이 들어 있어야 한다. 범위에 질문이나 지문을 문맥으로 포함하는 것은 괜찮지만, 인용이 다른 사람의 말만 담고 있으면 실패다.
   - 예외: 화자 라벨 없는 기록물 장면에서는 `line_speaker`가 없으므로 `document_author.name`이나 `document_author.voices` 중 하나와 같으면 된다.
   - `character_claim`이 아니면 `claim_line`은 `null`이다. `established_event`의 `actor_or_speaker`는 여러 명이 함께 한 행동일 수 있으므로 이 검사를 하지 않는다.
   - 1.2.0에서는 한 명이 한 주장 704건 중 137건(19%)이 지문 줄에서 시작했다. 그래서 `line_start`가 아니라 `claim_line`으로 검사한다.
8. **호칭**: `forms_of_address`의 `address_term`은 `quote` 안에 있어야 하고, 범위 안에서 `address_term`이 들어 있는 줄의 `line_speaker`가 `from_speaker`여야 한다. 누구를 부르는지 보여 주는 앞 지문이나 대사를 범위에 넣어도 된다. 화자 라벨 없는 기록물 장면에서는 `document_author.name`이나 `voices` 중 하나면 된다. 남의 호칭을 전하는 말은 호칭이 아니다(3절 10항). 이건 검증기로 못 막으므로 표본 검토로 막는다.
9. **언급 표기**: `mentioned_only[].surface_text`는 그 항목의 `quote` 안에 있어야 한다. 조사가 붙은 형태(`라피가`)는 부분 문자열로 통과한다.
10. **정체 공개 표기**: `resolved_in_same_scene_to`가 `null`이 아니면 `surface_text`가 그 `quote` 안에 있거나 그 장면 `speakers`의 라벨 중 하나여야 한다. 원문에 나오지 않은 이름을 사전 지식으로 적는 것을 막기 위함이다.

**분기·시점**

11. **선택지**: `is_branching: true`인 선택지 블록마다 `choice_branches` 항목이 하나 있고, 그 블록의 옵션이 모두 있어야 한다. `option_text`는 원문 `OPTION TEXT` 값과 정확히 같아야 한다. 옵션 본문 줄이 없는 옵션(`body_line_count: 0`)은 `continuation_summary`가 `null`이어야 한다. 분기 블록 2,804개 중 856개는 옵션이 둘 이상이지만 어느 옵션에도 본문이 없다(지휘관 대사만 갈림).
12. **분기 경계**: 아래 **근거 항목**은 서로 다른 분기 옵션 두 개 이상에 걸치면 실패다. 옵션 범위는 `[OPTION TEXT=...]` 줄부터 `[OPTION_END]` 줄까지다(`is_branching: true`인 블록만).
    - 근거 항목: `events_and_claims`, `relationship_and_lore_notes`, `clues_and_hooks`, `forms_of_address`, `mentioned_only`, `present_silent`, `resolved_in_same_scene_to`
    - 옵션 하나와 옵션 밖 공통 줄을 함께 범위에 넣는 것은 된다. 선택지 앞의 질문과 옵션 안의 답을 함께 인용하는 경우다. 이 항목은 그 옵션 소속이 된다(3절 4항).
    - 서로 다른 옵션의 줄은 양립할 수 없는 갈래이므로 한 항목에 섞지 않는다. 1.2.0에서는 항목 9,942건 중 104건(1%)이 두 옵션 이상에 걸쳤다. 대부분 선택지 블록 전체를 감싼 넓은 범위였다.
    - `remote_or_voice_only`, `descriptor_speakers`, `chronology_segments`는 근거 항목이 아니므로 이 검사를 하지 않는다. 앞의 둘은 장면당 라벨마다 한 항목인 요약이고, 마지막은 구간 정의다.
13. **시점 구간**: 장면 `chronology_type`이 `mixed`면 `chronology_segments`가 1개 이상 있어야 하고, `mixed`가 아니면 빈 배열이어야 한다. 구간은 장면 줄 범위 안에서 서로 겹치지 않아야 한다. 구간은 선택지 블록을 포함해도 된다.
    - 근거 항목이 시점 구간 경계를 걸치면, `character_claim`은 통과하고 `claim_line`의 시점을 따른다. 회상 속 말을 현재 장면에서 부정하는 경우처럼 다른 시점의 말을 문맥으로 인용할 수 있기 때문이다.
    - `character_claim`이 아닌 근거 항목이 경계를 걸치면 실패다. 어느 시점의 일인지 정할 수 없다.

**필드**

14. **스키마**: 필수 필드 누락, enum 위반, 타입 오류는 오류다. 병합기가 누락 필드 때문에 죽지 않게 하기 위함이다.
15. **`confidence`** (`events_and_claims`): `interpretation`이면 `유력한 해석` | `가능성` | `판단 보류` 중 하나가 필수다. `interpretation`이 아니면 생략하거나 `null`이어야 한다. `확인된 사실`을 적으면 실패다.
16. **관계 메모** (3절 9항)
    - `subject`와 `target`에 `,` `、` `/` `·`가 있으면 실패다. 여러 엔티티를 한 칸에 나열한 것으로 본다. `&`는 `헨젤 & 그레텔`처럼 실제 이름에 쓰이므로 허용한다. 괄호도 `퀸(마코토)`처럼 실제 이름에 쓰이므로 검증기는 막지 않는다(추출 규칙으로 막는다).
    - `epistemic_type`은 `established_event`나 `character_claim`만 된다. `interpretation`이면 실패다.
    - `character_claim`이면 `claimant`가 필수다(7항). 아니면 `claimant`는 `null`이다.
17. **특징 단서**: `clues_and_hooks`의 `category`가 `trait`이면 `subject`가 필수이고, 엔티티 하나여야 한다(16항과 같은 구분자 금지). `trait`이 아니면 `subject`는 `null`이다.
18. **모델이 쓰면 안 되는 필드**: `title_id`, `category`, `source_file`, `source_sha256`, `route`, `in_branch_option`, 근거 항목·`unknown_speakers`의 `chronology_type`(`chronology_segments[].chronology_type`은 모델이 쓴다), `mechanical_validated`, `item_id`, `claimant_unknown_id`. 이 값들은 병합기가 매니페스트와 줄 위치로 채운다. 모델 출력에 있으면 무시하고 경고한다.
19. **스키마 버전**: `schema_version`이 `"1.3.0"`이 아니면 실패다. 이전 버전 샤드는 받지 않는다.

**경고 (실패 아님)**

20. **밀도 경고**: 대사 줄이 60줄 이상인데 `events_and_claims`가 비어 있는 장면은 경고로 보고한다. 실패로 만들면 검증을 통과하려고 내용 없는 항목을 채울 수 있으므로 경고만 한다. 병합기는 배치 안 장면 위치(앞·중간·뒤 3등분)별 `events_and_claims` 밀도를 보고서에 남긴다.

**공백 구간 (실패)**

21. **공백 구간 (`COVERAGE_GAP`)**: `events_and_claims`, `clues_and_hooks`, `relationship_and_lore_notes` 중 어느 항목의 줄 범위에도 들어가지 않은 대사 줄(`line_speaker`가 있는 줄)이 **연속 10줄 이상**이면, 그 구간 전체를 덮는 `reviewed_gaps` 항목이 있어야 한다. 없으면 실패다.
    - 목적은 빠진 구간을 다시 읽게 하는 것이다. 실패하면 그 구간을 원문에서 다시 읽고, 추출할 것이 있으면 추출한다. 정말 없을 때만 `reviewed_gaps`에 이유를 적는다(4절).
    - `reviewed_gaps` 항목의 범위에 이미 다른 항목이 덮은 대사 줄이 있거나, `reason`이 비어 있으면 실패다.
    - 기준 10줄은 1.3.0 파일럿에서 정했다. 독립 표본 검토가 찾은 누락(`gingerbreadhouse_02` L54~66, `main_31_00` L42~55)이 이 기준에 걸린다. 1.3.0 파일럿 4개 배치에서는 60장면 중 19곳이 걸렸다.
    - 20항과 달리 실패로 두는 이유: 경고는 무시되기 쉽다. 대신 `reviewed_gaps`라는 정당한 탈출구가 있으므로 빈 항목을 지어낼 이유가 없다.

검증 상태는 두 가지로 분리해 보관한다.
- `mechanical_validated`: 검증기가 기록한다.
- `semantic_validated`: Pass 3이 기록한다.

인용이 원문에 실존한다고 해서 해석까지 맞은 것은 아니다. 부정을 뒤집은 요약, 전해 들은 호칭, 현장에 없는 인물의 `present_silent` 분류 같은 오류는 검증기가 잡지 못한다. 8절의 독립 표본 검토가 이 몫이다.

### 2.4 테스트
- 기초 스크립트마다 `node --test` 테스트를 작성한다. 실제 대본 파일을 쓴다.
- 테스트 파일 위치는 `scripts/graph-*.test.mjs`처럼 `scripts/` 바로 아래다. `npm test`는 `node --test scripts/*.test.mjs`만 실행하므로 `scripts/graph/` 안에 두면 실행되지 않는다.
- 최소 테스트 항목:
  - 등록된 각 파일의 파싱 장면 ID 목록이 `newScriptsData`의 해당 파일 항목과 정확히 일치한다.
  - 전체 `???:` 줄 수가 원문 `grep -cE '^\s*\?\?\?:'` 합계(현재 1,071)와 일치한다. 들여쓰기 포함이다.
  - `second_affection_08`/`_09`가 병렬 갈래로 판별되지 **않는다**.
  - 선택지가 있는 장면에서 `[OPTION TEXT]` 줄의 `line_speaker`가 `지휘관`이다.
  - `2x2_love_1ch_13`에서 `NEXT_ROUTE` 3개(TARGET `_16`, `_17`, `_18`)가 추출된다.
  - 메신저 장면에서 `SENDER`가 화자로 잡히고, 본문 줄은 화자로 잡히지 않는다. 본문 줄의 `line_speaker`는 발신자다.
  - 검증기 실패 사례별 테스트 (2.3의 항 번호):
    - 1·2항: 장면 누락, 언급만 된 인물을 `present_in_scene`에 넣음, `speakers`의 라벨 하나를 참여자에서 빠뜨림
    - 3항: `???` 누락, 들여쓰기된 `???` 줄 누락
    - 4항: `gingerbreadhouse_02`에서 묘사형 라벨(`양산을 든 여성`)의 `descriptor_speakers` 항목 누락, 대표 대사에 다른 화자의 줄을 씀. 검토로 제외된 라벨(`coins_in_rush_09`의 `인자해 보이는 남자`)은 대상이 아니다.
    - 6항: 인용 줄 범위가 틀림, 4자 미만 인용(단, 범위의 대사 전체가 4자 미만이고 그 전체를 인용한 `라피: 응.`의 `"응."`은 통과)
    - 7항: `actor_or_speaker`에 `라피, 아니스`처럼 여러 명, `claim_line`의 화자가 아닌 사람을 주장 화자로 적음, `claim_line`은 맞지만 `quote`가 다른 사람의 대사만 담음
    - 9·10항: `surface_text`가 인용에 없음, 정체 공개의 `surface_text`가 인용과 화자 라벨 어디에도 없음
    - 11항: 분기 블록이나 옵션 하나를 `choice_branches`에서 빠뜨림
    - 8항: `address_term`이 든 줄의 화자가 `from_speaker`가 아님
    - 11항: 본문 없는 옵션에 `continuation_summary`를 지어냄
    - 12·13항: 두 옵션을 걸친 범위, `character_claim`이 아닌 항목이 시점 구간 경계를 걸침, `mixed` 장면에 구간이 없거나 `mixed`가 아닌 장면에 구간이 있음
    - 15항: `interpretation`에 `confidence`가 없음, `established_event`에 `confidence: "확인된 사실"`을 적음
    - 16·17항: 관계 메모 `subject`에 `아니스, 네온`이나 `아니스·네온`, 관계 메모에 `interpretation`, `character_claim`에 `claimant` 없음, `character_claim`이 아닌데 `claimant` 있음, `trait`에 `subject` 없음
    - 19항: `schema_version`이 `1.2.0`인 샤드
    - 21항: 대사 10줄 이상 공백에 `reviewed_gaps` 없음, 공백 일부만 덮는 `reviewed_gaps`, 빈 `reason`, 이미 항목이 덮은 줄을 포함한 `reviewed_gaps`. 통과: 이유를 적은 `reviewed_gaps`, 항목이 앞을 덮어 공백이 9줄로 줄어든 경우
  - 검증기 통과 사례 테스트:
    - 7항: 질문(L10, 다른 화자)과 답(L11)을 범위로 잡고 `claim_line: 11`, 답의 화자를 주장 화자로 적음. 지문 줄에서 시작하는 범위. `???` 줄의 주장에 `"???"`. 메신저 본문 줄의 주장에 발신자. 간접화법 지문(`main_24_02`)의 주장에 `크로우`.
    - 8항: 앞 지문 줄부터 시작하는 호칭 범위.
    - 12·13항: 선택지 앞 질문과 옵션 안 답을 함께 인용(옵션 소속이 됨). 회상 구간의 말과 현재의 부정을 함께 인용한 `character_claim`(`claim_line`의 시점). 선택지 블록을 포함하는 회상 구간.
    - 16항: `헨젤 & 그레텔`, `퀸(마코토)`처럼 `&`나 괄호가 들어간 이름
    - 12항: 같은 문구의 선택지가 여러 블록에 있는 장면(`bunny_x_777_08`)에서 병합기가 줄 위치로 블록을 구분한다.
- 기존 `npm test`가 계속 전부 통과해야 한다.

---

## 3. 대본 독해 및 세계관 추출 규칙

1. **전 장면 기본 색인 필수**
   - 평범한 일상 대사의 호칭·말버릇·소품이 수십 챕터 뒤 정체를 밝히는 단서가 된다.
   - 따라서 모든 장면(100%)에 기본 색인을 남긴다: 화자 분리, 호칭, 특징적 발언, 소품·단서, 분기, 원문 위치.
   - `is_plot_critical`은 Pass 2에서 우선순위를 정할 때 쓰는 표시일 뿐이다. 추출 범위와 깊이는 모든 장면이 같다. `false`인 장면도 똑같이 꼼꼼히 추출한다.
   - **Pass 1은 장면 단위다.** 그 장면만 보고 판단할 수 있는 기준으로 추출한다. "나중에 중요해질지", "작품 전체에서 이 인물만 쓰는 표현인지"처럼 다른 장면을 알아야 하는 판단은 하지 마라.

2. **시점 맥락과 참여 상태 분리**
   - 장면마다 `chronology_type`을 기록한다. 꿈·회상·가정에서 묘사된 일을 현재 사건으로 오인하지 마라.
     - 값: `present` | `flashback` | `dream` | `hypothetical` | `mixed`
     - `mixed`는 한 장면에 연출 시점이 **둘 이상** 있을 때 쓴다. 현재와 회상, 현재와 가정, 회상과 꿈 등 모든 조합이 해당한다.
     - `mixed` 장면은 `present`가 아닌 구간을 `chronology_segments`에 줄 범위로 적는다. 구간 밖은 `present`다. 현재 구간이 없는 장면이면 구간이 장면 전체를 덮는다.
     - **항목별 시점은 모델이 적지 않는다.** 병합기가 장면 시점과 구간으로, 줄 범위가 있는 항목마다 붙인다. 1.2.0에서 모델이 항목에 적은 시점은 `mixed`가 아닌 장면에서 장면 시점과 모두 같았다.
   - **`chronology_type`은 "그 일이 언제 일어났나"가 아니라 "대본이 그 일을 어떤 방식으로 보여 주나"다.**
     - `flashback`/`dream`은 대본이 과거나 꿈을 **직접 장면으로 연출할 때만** 쓴다. 회상 연출이 시작되고 끝나는 구간이 있다.
     - 타이틀 전체가 과거 시대를 다루는 독립 스토리(예: `OVER ZONE`)는 그 안에 회상 연출 구간이 따로 없으면 `present`다. 그 스토리가 메인 시간선의 어느 시점인지는 장면 판정이 아니라 타이틀 정보로 다룬다.
     - 인물이 현재 장면에서 과거 일을 **말로 이야기하는 것**은 `present`다. 그 내용은 `character_claim`으로 기록하고 `refers_to_past: true`를 붙인다.
     - 녹음·메시지·문서가 과거 일을 전하는 것도 같다. 화자나 출처의 진술로 기록한다.
   - 인물 참여는 네 갈래로 나눈다.
     - `present_in_scene`: 현장에서 발화한 인물. 화자 목록에 있어야 한다. `???`는 여기에 넣지 않는다(`unknown_speakers`에서만 다룬다).
     - `present_silent`: 현장에 있지만 발화하지 않은 인물. 현장에 있음을 보여주는 원문 근거가 필수다. 대사 속에서 이름이 나왔다는 것만으로는 근거가 아니다.
     - `remote_or_voice_only`: 통신·녹음·메신저·회상 목소리로만 발화한 인물. 화자 목록에 있어야 한다.
     - `mentioned_only`: **위 세 갈래에 들어가지 않은** 엔티티(인물·조직·장소·개념·아이템·사건)가 이름·별칭으로 언급된 경우
   - 블라블라 메신저의 참여자와 발신자는 `remote_or_voice_only`(`medium: "messenger"`)로 넣는다.
   - **한 인물은 한 장면에서 한 갈래에만 넣는다.** 같은 장면에서 메신저·통신으로도 말하고 현장에도 나오면 `present_in_scene`에만 넣는다. 메신저·통신으로만 말했을 때만 `remote_or_voice_only`에 넣는다(예: 메신저로 의뢰한 뒤 현장에서 만나는 서브 퀘스트 의뢰인은 `present_in_scene`). 통신으로 말한 인물의 이름이 다른 대사에 나와도 `mentioned_only`에 또 넣지 않는다. 검증기는 같은 `speaker_label`이 `present_in_scene`과 `remote_or_voice_only`에 함께 있으면 실패 처리한다.
   - **화자 라벨 없는 기록물**(문서·일기·수기, 음성·영상 유실물 `.wav`·`.mp4` 등)은 `document_author`에 넣는다.
     - 작성자나 목소리가 하나면 `name`에 원문 지칭을 쓴다(예: `수기 작성자`, `녹음 속 남자`). 정체가 없으면 `entity_id`는 `null`이다.
     - 라벨 없는 목소리가 여럿이면 `voices`에 원문 지칭을 하나씩 적는다(예: `남자의 목소리`, `여자의 목소리`). 기록물 전체의 작성자가 따로 없으면 `name`은 `null`이다.
     - 이런 장면에서 주장 화자(`claimant`, `actor_or_speaker`)와 호칭의 `from_speaker`는 `name`이나 `voices` 중 하나를 쓴다.

3. **미상 화자(`???`)와 묘사형 화자**
   - 노드 ID는 기계 추출된 `unk_<scene_id>_L<줄번호>`를 그대로 쓴다. 줄 하나가 노드 하나다.
   - 같은 장면의 다른 `???` 줄과 같은 인물인지(`SAME_SPEAKER_IN_SCENE`), 특정 인물과 연결되는지(`CANDIDATE_IDENTITY`)는 노드를 합치지 말고 별도 관계와 근거로 표현한다.
   - Pass 1에서는 같은 인물로 보이는 `???` 줄들을 쌍이 아니라 **묶음**(`same_scene_speaker_groups`)으로 기록한다. 쌍으로 적으면 n개 줄에 n-1개 이상의 항목이 생겨 출력이 불필요하게 커진다.
   - `contextual_clues`와 `summary`에는 그 장면 안의 정보만 쓴다.
     - 같은 배치에 다른 장면이 있어도, 다른 장면에서 알게 된 정체나 사실을 섞지 마라.
     - 다른 장면과의 연결이 보이면 `cross_scene_hints`에만 적는다. 이 필드는 Pass 2 후보 탐색용 힌트일 뿐 근거가 아니다.
   - 후속 정체 공개가 반드시 있다고 가정하지 마라.
   - **묘사형 화자**(1.6, `is_descriptor_alias: true`)도 정체 추적 대상이다. `descriptor_speakers`에 라벨마다 한 항목을 적는다: 대표 대사, 말투, 대화 상대, 정체 단서, 같은 장면 안의 정체 공개. 규칙은 `unknown_speakers`와 같다.
   - **같은 장면 안의 정체 공개**는 `resolved_in_same_scene_to`에 적는다(`unknown_speakers`, `descriptor_speakers` 공통).
     - 밝혀진 이름의 원문 표기를 `surface_text`에 적는다. 원문에 나온 이름만 쓴다. 사전 지식으로 알고 있는 정체를 적지 마라.
     - 레지스트리에 있는 인물이면 `entity_id`를 적고, 없으면 `null`로 두고 `unregistered_entity_candidates`에도 같은 표기를 적는다.
     - 정체가 밝혀지지 않았을 때만 `resolved_in_same_scene_to` 전체가 `null`이다.
     - `???`나 묘사형 화자의 정체 공개는 여기에만 적는다. 관계 메모의 "동일 인물" 항목(9항)으로 또 적지 않는다.

4. **분기**
   - 장면 내 선택지와 장면 간 루트(1.3)를 모두 병렬 갈래로 기록한다. 병렬 갈래의 장면들을 시간순으로 이어진 사건으로 읽지 마라.
   - **분기 소속은 모델이 적지 않는다.** 병합기가 항목의 줄 범위로 어느 선택지 블록의 어느 옵션 안인지(`in_branch_option`) 붙인다. 장면 자체가 다른 장면 선택지의 갈래(`NEXT_ROUTE` TARGET)인 경우는 매니페스트의 `route`로 붙인다.
     - 항목 범위가 옵션 하나에 닿으면 그 옵션 소속이다. 선택지 앞의 공통 질문을 문맥으로 함께 인용해도 답이 옵션 안에 있으면 그 옵션 소속이다. 서로 다른 옵션의 줄을 한 항목에 섞지는 마라(2.3의 12항).
     - 한 장면 안의 여러 선택지 블록에 같은 문구가 나와도(예: `bunny_x_777_08`의 가위바위보) 줄 위치로 구분된다.
   - 선택지 안의 대사가 인물·설정 특성을 보여 줘도, 그 항목은 그 옵션 소속으로 남는다. 여러 갈래에서 공통으로 지지되는 사실을 분기 없는 일반 사실로 합치는 일은 Pass 2가 각 갈래의 근거를 모아서 한다.
   - `choice_branches`에는 `is_branching: true`인 선택지 블록만 기록한다. 선택지가 하나뿐이고 뒤에 이어지는 대사가 없는 블록은 지휘관의 대사일 뿐이다. 이런 블록은 전체 코퍼스에 약 3만 8천 개 있다.
   - `choice_branches`에는 갈래 요약(`continuation_summary`)만 적는다. 옵션 본문이 없으면(지휘관 대사만 다르고 바로 공통 대사로 이어지면) `null`이다. 선택지별 사실은 `events_and_claims`·관계 메모에 그 옵션의 줄을 포함한 범위로 적는다.

5. **세계관 엔티티와 관계 변화**
   - `???`와 떡밥뿐 아니라 다음도 추출한다.
     - 조직: 방주, 중앙정부, 기업, 스쿼드 등
     - 장소
     - 핵심 개념
     - 주요 사건의 참여자와 결과
     - 인물 간 관계 변화 (9항의 관계 메모 규칙을 따른다)
   - 사전 지식으로 채우지 말고 그 장면에 나온 것만 적는다.

6. **사실·주장·추정 분리와 양면 근거**
   - `established_event`: 대본에서 직접 서술·시연된 사건.
   - `character_claim`: 인물의 의심·소문·거짓말·불완전한 지식. 인물의 주장은 자동으로 사실이 되지 않는다.
   - `interpretation`: **추출자(모델)**가 간접 단서로 내린 추정. 확신도 라벨이 필수다.
   - 등장인물이 스스로 추측하거나 느끼거나 경험했다고 말하는 것은 `interpretation`이 아니라 `character_claim`이다.
     - 예: 라피가 "레드 후드와 아나키오르가 조우했던 것 같습니다"라고 말함 → `character_claim`
     - 예: 라피가 "기억이 머릿속에 흘러들어왔다"고 말함 → `character_claim`. 대본이 그 현상을 직접 연출하지 않았다면 `established_event`가 아니다.
   - `established_event`는 대본이 지문·연출로 직접 보여 준 일, 또는 여러 인물이 현장에서 함께 겪어 장면 안에서 의심의 여지가 없는 일에만 쓴다.
   - `actor_or_speaker`는 `character_claim`이면 **그 말을 한 화자**, `established_event`면 **행동한 사람**이다. "A: B가 C를 구했어"를 주장으로 적으면 `actor_or_speaker`는 A이고, 구한 사람 B는 `summary`에 쓴다.
   - `character_claim`에는 주장한 대사의 줄을 `claim_line`에 적는다. 이해에 필요한 질문이나 지문은 `line_start`~`line_end` 범위에 함께 넣어도 된다.
     - 예: L10 지휘관 "둘이 무슨 사이야?" / L11 라피 "레드 후드와는 같은 스쿼드였습니다." → `line_start: 10`, `line_end: 11`, `claim_line: 11`, `actor_or_speaker: 라피`
     - 짧은 답("네, 맞습니다")으로 주장이 성립하면 질문부터 답까지 범위를 잡고, 사이의 지문까지 포함해 이어서 인용한다(2.3의 6항).
     - **서로 다른 화자가 각자 독립된 주장을 하면 화자마다 항목을 나눈다.** 질문이나 지문을 문맥으로 범위에 넣는 것은 되지만, A의 주장과 B의 반박·덧붙임을 한 항목에 묶어 한쪽 화자에게만 귀속시키지 마라.
       - 예: 신데렐라 "모습이 조금 달라졌지만, 에이브야" / 그레이브 "과거는 기억하지 못한다" → 두 항목(`actor_or_speaker`가 각각 `신데렐라`, `그레이브`)
       - 예: 양산을 든 여성의 지적 / 신데렐라 "난 아니야. 전부 극복해냈어." → 두 항목
     - 지문이 남의 말을 전하는 경우(간접화법, 예: "크로우는 방주의 선택을 보고 싶다고 했다")도 `character_claim`이다. `claim_line`은 그 지문 줄, 주장 화자는 지문에 나온 전달자다. 전달자가 없으면 `"지문"`이라고 적는다.
   - `summary`와 `relation_or_change`에서 부정·조건·전언·시간 표현을 빼지 마라.
     - 예: "A가 B의 부하라는 소문은 사실이 아니다" → "A가 B의 부하라는 소문을 부정한다". "A는 B의 부하다"로 적으면 뜻이 뒤집힌다.
     - 예: "지난달 재가입했다", "3년 전 탈퇴했다"의 시간 표현은 그대로 남긴다. `refers_to_past`만으로는 순서를 알 수 없다.
   - **말한 행위와 말한 내용을 구분하라.** 현장에서 누가 무엇을 말했다는 사실 자체는 대본이 직접 보여 준 것이다.
     - 행위가 핵심인 대사 → `established_event`
       - 질문·추궁, 요청·지시, 결정·선언, 약속, 고백, 거절, 작명
       - 예: "지휘관이 왜 그레이브를 먼저 공격했는지 묻는다"
       - 예: "지휘관이 작전 목표를 그레이브 추적으로 한정한다"
       - 예: "음성 파일이 세 가지 임무를 요청한다"
     - 내용이 핵심인 대사 → `character_claim`. 세상에 대한 사실 주장인데 대본이 그 사실을 직접 보여 주지 않은 경우다.
       - 예: "아나키오르는 최초의 헬레틱이다"
       - 예: "방주가 보상을 준비해 두었다"
     - 한 대사에 **서로 독립된 의미**가 둘 있으면(예: 정체에 대한 주장과 약속, 사실 주장과 지시) 두 항목으로 나눈다. 두 항목은 같은 `quote`를 써도 된다. 한쪽이 다른 쪽의 수식이나 이유일 뿐이면 하나로 적는다.
       - 예: "상부가 우리 스쿼드를 폐기하기로 했어. 지금 당장 통신기를 끄고 탈출해!" → 폐기 결정(`character_claim`)과 탈출 지시(`established_event`) 두 항목
       - 예: "나는 실험체 07호야. 너를 끝까지 지키겠다고 약속해." → 정체 주장(`character_claim`)과 약속(`established_event`) 두 항목
     - 파일럿 2차에서 모든 대사가 `character_claim`으로 쏠리는 경향이 확인되었다. 이 규칙은 그것을 바로잡기 위함이다.
   - Pass 2·3의 모든 관계에는 다음을 함께 기록한다: 지지 근거(`supporting_evidence`), 반박 근거(`contradicting_evidence`), 대안 후보.
   - 같은 장면의 중복 발췌는 독립된 교차 검증이 아니다.
   - 사전 지식 사용 범위:
     - Pass 1 추출에서는 쓰지 않는다. 원문에 나온 것만 적는다.
     - Pass 2 후보 탐색에서는 니케 사전 지식을 검색 힌트로 써도 된다.
     - Pass 3 최종 판정의 근거는 대본 원문뿐이다.

7. **확신도 라벨** (수치 점수 금지, 아래 4개만 사용)
   - `확인된 사실`: 대본 근거로 직접 확립된 사실. 인물 정체에는 명시적 확인이나 의심의 여지가 없는 공개가 있을 때만 쓴다.
   - `유력한 해석`: 구체적이고 독립적인 간접 단서 여럿이 강하게 지지한다.
   - `가능성`: 개연성은 있으나 단서가 제한적이거나 배타적이지 않다.
   - `판단 보류`: 근거가 부족하거나 상충한다.

8. **출처 기록**
   - Pass 1에서는 항목마다 `line_start`~`line_end`와 `quote`가 출처다. `scene_id`는 상위 장면에서 물려받는다. 장면 `summary`는 장면 전체가 출처다.
   - Pass 2·3의 모든 관계·정체 후보·별명·요약에는 근거가 된 `scene_id`와 줄 범위를 `evidence_scenes`로 기록한다.
   - 이는 원문 수정 시 재검증 대상을 찾기 위한 용도다. 스포일러 필터는 구현하지 않는다.
   - 병합기가 붙이는 시점(`chronology_type`)과 분기 소속(`in_branch_option`)은 **근거 항목**(2.3의 12항 목록)과 `unknown_speakers`(`unknown_id`의 줄 기준)에만 붙인다.
     - `character_claim`의 시점은 `claim_line` 기준이다.
     - `remote_or_voice_only`, `descriptor_speakers`, `same_scene_speaker_groups`, `present_in_scene`처럼 장면 안 여러 발화를 요약하는 항목에는 붙이지 않는다. 이런 화자가 어느 갈래·시점에서 말했는지는 Pass 2가 `line_speaker`로 계산한다.

9. **관계 메모 (`relationship_and_lore_notes`)**
   - 관계 메모는 **관계 상태가 명시적으로 드러나거나 바뀔 때**만 적는다. 그 상태가 앞으로 얼마나 갈지는 예측하지 마라. 조건이나 기한이 있으면 `relation_or_change`에 그대로 적는다.
     - 소속·직책·상하관계가 드러나거나 바뀜
       - 당사자가 아닌 인물의 말로 드러나도 적는다. 예: 네온 "해머링이랑 같은 스쿼드라고 생각하니" → 해머링의 소속 관계 메모(`character_claim`, `claimant: 네온`)
     - 신뢰·우호·애정·갈등·적대가 생기거나 바뀌거나 끝남
     - 과거 인연·혈연·창조 관계가 드러남
     - 조직·스쿼드·세력 사이의 동맹·견제·적대
     - 엔티티 사이의 설정 관계 (예: 조직 A가 조직 B 산하다, 장소 X를 조직 Y가 관리한다)
     - **동일 인물·별칭·개명·작명**: 이름이 있는 두 표기가 같은 존재임이 드러나거나, 새 이름이 붙음. `subject`에 이전(또는 다른) 이름, `target`에 새 이름을 쓴다. `???`나 묘사형 화자의 정체 공개는 여기에 적지 않는다(3항).
       - 예: 그레이브가 아나키오르에게 "오늘부터 네 이름은 신데렐라다"라고 함 → `subject: 아나키오르`, `target: 신데렐라`, `established_event`. 작명 행위는 `events_and_claims`에도 적는다.
   - **장면 안의 일회성 상호작용은 관계 메모에 적지 않는다.** 부축, 인사, 칭찬, 농담, 한 번의 전투 협력, 경고, 말다툼, 반발, 사과, 인솔·안내 등은 `events_and_claims`에만 적는다.
     - 판단 기준: "두 엔티티 사이의 상태(소속·지휘·신뢰·적대 등)를 대사나 지문이 직접 말하거나 바꾸는가." 행동만 있고 상태를 말하지 않으면 적지 않는다.
     - 예: "이번 작전이 끝날 때까지만 네 지휘를 따르겠다" → 관계 메모. `relation_or_change`에 "이번 작전 동안 지휘를 따르기로 함"처럼 기한을 남긴다.
     - 예: "같이 저 랩처를 막자"며 함께 싸움 → 관계 메모 아님(한 번의 전투 협력)
     - 예: "마리안이 지휘관을 업어주겠다고 제안함" → 관계 메모 아님
     - 예: 마리안이 라피에게 "한 번만 더 그런 발언을 한다면 가만있지 않겠다"고 경고하고 라피가 사과함 → 관계 메모 아님(경고와 사과는 사건)
     - 예: 동료를 버리고 왔느냐며 말다툼하다가 오해를 풀고 서로 사과함 → 관계 메모 아님
     - 예: 지휘관의 작전에 "사지로 내모는 것"이라며 반발함 → 관계 메모 아님
     - 예: "라피가 지휘관을 스쿼드 04-F의 명령권자로 등록함" → 관계 메모
   - 엔티티 하나에만 걸리는 설정(예: "랩처는 X다")은 관계 메모가 아니다. `events_and_claims`나 `clues_and_hooks`에 적는다.
   - **`subject`와 `target`에는 엔티티 하나씩만 넣는다.** 여러 인물·조직·세력이면 생략하지 말고 엔티티마다 항목을 나눈다. 스쿼드 전체를 가리키면 스쿼드 이름 하나를 쓴다.
     - 예: 중앙 정부가 필그림과 헬레틱을 각각 어떻게 대하고 규정하는지 나옴 → `중앙 정부→필그림`, `중앙 정부→헬레틱` 두 항목
     - 이름만 적고 괄호 설명을 붙이지 마라. 예: `라피 (카운터스)`가 아니라 `라피`, `메티스 (맥스웰, 라플라스, 드레이크)`가 아니라 `메티스`. 이름 자체에 괄호가 있는 화자 라벨(예: `퀸(마코토)`)은 그대로 쓴다.
   - `relation_or_change`는 자유 서술로 둔다. 관계 종류 분류는 Pass 2 이후에 한다.
     - 그 항목의 줄 범위 안에 있는 내용만 쓴다. 범위 밖 대사나 다른 화자의 말을 섞지 마라.
     - 짧게 줄이더라도 대사의 추측·유보·전제 표현("~인 것 같다", "아직", "~을 바탕으로 생각해 보면")을 빼지 마라(6항). 예: "레드 후드와 아나키오르가 조우했던 것 같다고 말함"이지 "과거에 조우한 관계"가 아니다.
   - `epistemic_type`은 6항의 기준을 관계에 맞춰 적용한다.
     - `established_event`: 대본이 관계를 직접 확립한 경우다. 지문·연출로 보여 줌, 명령권 등록이나 입대 같은 절차, 양쪽이 받아들인 관계 선언·약속, 결별처럼 한쪽 행위로 성립하는 변화가 해당한다.
       - **선언한 것과 관계가 성립한 것은 다르다.** 한쪽만 선언하고 상대가 받아들이지 않았으면, 관계 메모는 선언한 사람을 `claimant`로 한 `character_claim`이다. 선언과 거절은 각각 `events_and_claims`에 사건으로 적는다.
       - 예: A "오늘부로 우리는 동맹이다" / B "난 동의한 적 없어" → 관계 메모 `A→B 동맹 선언`(`character_claim`, `claimant: A`). 사건: A의 선언, B의 거절.
     - `character_claim`: 인물이 관계에 대해 말했지만 대본이 직접 보여 주지 않은 경우다. 제3자가 두 인물의 관계를 말함, 당사자가 과거 관계를 회고함, 소문이 해당한다.
       - 인물이 대사로만 밝힌 주관적 평가·관계 규정·의도도 여기에 해당한다. 대본이 그 상태를 따로 보여 주지 않았으면 `established_event`로 적지 않는다.
         - 예: 그레이브 "너. 아직, 인간, 아니다." → `character_claim`, `claimant: 그레이브`, "아직"을 남긴다.
         - 예: 엔더슨 "뭐, 그러자고 전초 기지로 올린 것 아닌가." → `character_claim`, `claimant: 엔더슨`
       - 그 말을 한 화자를 `claimant`에, 그 대사의 줄을 `claim_line`에 적는다(6항과 같은 방식). `???` 줄이면 `claimant`에 `"???"`라고 적는다. `unknown_id`는 적지 않는다. 병합기가 `claim_line`으로 연결한다.
     - **`interpretation`은 관계 메모에 쓰지 않는다.** 행동·태도에서 관계를 추론해 적지 마라. 그 행동은 `events_and_claims`에 사건으로 적고, 여러 장면의 행동을 모아 관계를 추론하는 일은 Pass 2가 한다.
       - 예: 지휘관을 챙기는 행동을 보고 "마리안이 지휘관을 각별히 아낀다"고 적지 않는다. "업어주겠다고 제안함"을 사건으로만 적는다.
       - 이유: 한 장면의 행동에서 관계를 일반화할지, 일회성 상호작용으로 보고 넘길지는 추출자마다 갈린다. 여러 장면의 근거를 보는 Pass 2가 더 정확하다.
   - `refers_to_past`는 `events_and_claims`와 같은 뜻으로 쓴다.
     - 예: 현재 장면에서 라피가 "레드 후드와 스노우 화이트는 예전에 같은 스쿼드였다"고 말함 → `epistemic_type: character_claim`, `claimant: 라피`, `refers_to_past: true`

10. **호칭과 특징 단서**
   - `forms_of_address`에는 화자가 상대를 **직접 부른** 호칭만 적는다. "아니스는 네온을 꼬맹이라고 불렀어"처럼 남의 호칭을 전하는 말은 호칭이 아니다. 필요하면 `events_and_claims`에 주장으로 적는다.
     - 다른 사람에게 말하면서 제3자를 3인칭으로 가리킨 표현도 호칭이 아니다. 예: 베르누이아가 손님들에게 "내 두 노예의 요란한 손님들이니"라고 함 → 헨젤·그레텔에 대한 호칭으로 적지 않는다.
   - `clues_and_hooks`의 `trait`에는 기명 인물에 대해 **그 장면에서 확인되는** 다음을 적는다. `subject`에 그 인물을 적는다.
     - 지문이나 대사가 직접 묘사한 신체 특징(흉터, 문신, 의수 등)
     - 지문이 강조하거나 장면 안에서 반복되는 특이 행동(왼손을 계속 가림 등)
     - 대사에서 눈에 띄는 고유 표현(독특한 어미, 구호, 자기 지칭)
     - 평범한 말투나 성격 묘사는 적지 않는다. 작품 전체에서 그 인물만의 특징이라고 단정하지 않는다.

---

## 4. Pass 1 샤드 스키마 (`schema_version: "1.3.0"`)

서브에이전트가 쓰는 `data/graph/pass1/shards/<batch_id>.json`의 형식이다. 모든 `line_start`/`line_end`/`claim_line`은 1.2의 장면 본문 기준 줄 번호다.

```json
{
  "schema_version": "1.3.0",
  "batch_id": "batch_0001",
  "scenes": [
    {
      "scene_id": "string (@@@SCRIPT_ID 그대로)",
      "chronology_type": "present | flashback | dream | hypothetical | mixed",
      "chronology_segments": [
        { "line_start": 1, "line_end": 1, "chronology_type": "flashback | dream | hypothetical" }
      ],
      "is_plot_critical": true,
      "summary": "string (1~2문장)",
      "participants": {
        "present_in_scene": [
          { "speaker_label": "string (기계 추출 화자 중 하나)", "entity_id": "string | null", "is_generic_role": false }
        ],
        "present_silent": [
          { "name": "string", "entity_id": "string | null", "line_start": 1, "line_end": 1, "quote": "string (현장에 있음을 보여주는 원문)" }
        ],
        "remote_or_voice_only": [
          { "speaker_label": "string (기계 추출 화자 중 하나)", "entity_id": "string | null", "medium": "comm | recording | messenger | memory_voice | other", "line_start": 1, "line_end": 1, "quote": "string" }
        ],
        "mentioned_only": [
          { "surface_text": "string", "entity_id": "string | null", "entity_type": "character | squad | organization | faction_or_species | location | concept | item | event", "line_start": 1, "line_end": 1, "quote": "string" }
        ],
        "document_author": { "name": "string | null", "entity_id": "string | null", "voices": ["string (기록물 속 라벨 없는 목소리의 원문 지칭)"] }
      },
      "forms_of_address": [
        { "from_speaker": "string", "to_target": "string", "address_term": "string", "line_start": 1, "line_end": 1, "quote": "string" }
      ],
      "unknown_speakers": [
        {
          "unknown_id": "unk_<scene_id>_L0000 (기계 추출 ID 그대로)",
          "quote": "string (그 ??? 줄의 대사 일부 또는 전체)",
          "speaking_style": "string",
          "target_addressed": "string | null",
          "contextual_clues": ["string"],
          "resolved_in_same_scene_to": { "surface_text": "string (밝혀진 이름 원문 표기)", "entity_id": "string | null", "line_start": 1, "line_end": 1, "quote": "string" }
        }
      ],
      "descriptor_speakers": [
        {
          "speaker_label": "string (is_descriptor_alias인 화자 라벨 그대로)",
          "line_start": 1,
          "line_end": 1,
          "quote": "string (그 화자의 대표 대사)",
          "speaking_style": "string",
          "target_addressed": "string | null",
          "contextual_clues": ["string"],
          "resolved_in_same_scene_to": { "surface_text": "string", "entity_id": "string | null", "line_start": 1, "line_end": 1, "quote": "string" }
        }
      ],
      "same_scene_speaker_groups": [
        { "unknown_ids": ["unk_..._L0001", "unk_..._L0003"], "confidence": "확인된 사실 | 유력한 해석 | 가능성 | 판단 보류", "reason": "string" }
      ],
      "cross_scene_hints": [
        { "text": "string (다른 장면과의 연결 힌트. 근거 아님)", "related_scene_ids": ["string"] }
      ],
      "choice_branches": [
        {
          "choice_line": 1,
          "options": [
            { "option_text": "string (원문 OPTION TEXT 그대로)", "continuation_summary": "string | null (옵션 본문이 없으면 null)" }
          ]
        }
      ],
      "events_and_claims": [
        {
          "epistemic_type": "established_event | character_claim | interpretation",
          "confidence": "interpretation일 때만 필수: 유력한 해석 | 가능성 | 판단 보류",
          "actor_or_speaker": "string (character_claim이면 말한 화자 한 명, established_event면 행동한 사람)",
          "summary": "string",
          "line_start": 1,
          "line_end": 1,
          "claim_line": "number | null (character_claim일 때만 필수: 주장한 대사의 줄)",
          "quote": "string",
          "refers_to_past": false
        }
      ],
      "clues_and_hooks": [
        { "keyword": "string", "category": "item | code_or_number | past_incident | foreshadowing | lore_concept | location | organization | trait", "subject": "string | null (trait일 때 그 특징을 가진 인물)", "detail": "string", "line_start": 1, "line_end": 1, "quote": "string" }
      ],
      "relationship_and_lore_notes": [
        {
          "subject": "string (엔티티 하나)",
          "target": "string (엔티티 하나)",
          "relation_or_change": "string",
          "epistemic_type": "established_event | character_claim",
          "claimant": "string | null (character_claim일 때만 필수: 그 말을 한 화자, 간접화법 지문에 전달자가 없으면 \"지문\")",
          "line_start": 1,
          "line_end": 1,
          "claim_line": "number | null (character_claim일 때만 필수: 주장한 대사의 줄)",
          "quote": "string",
          "refers_to_past": false
        }
      ],
      "unregistered_entity_candidates": [
        { "surface_text": "string", "suggested_type": "character | alias | squad | organization | faction_or_species | location | concept | item | event", "line_start": 1 }
      ],
      "reviewed_gaps": [
        { "line_start": 1, "line_end": 1, "reason": "string (다시 읽었는데도 이 구간에서 추출할 것이 없는 이유)" }
      ]
    }
  ]
}
```

필드 규칙:
- `document_author`는 화자 라벨 없는 기록물 장면(3절 2항)에서만 쓰고, 그 외에는 `null`이다. `voices`는 라벨 없는 목소리가 여럿일 때만 채우고, 아니면 빈 배열이다.
- `resolved_in_same_scene_to`는 3절 3항을 따른다(`unknown_speakers`, `descriptor_speakers` 공통).
- `claim_line`과 `claimant`는 `character_claim`이 아니면 `null`이다.
- 병합기는 `events_and_claims[].confidence`가 없으면 `null`로 채워 키 구조를 통일한다. 관계 메모에는 `confidence`가 없다(`interpretation`을 쓰지 않으므로).
- `clues_and_hooks`의 `subject`는 `trait`일 때만 쓰고(3절 10항), 아니면 `null`이다.
- **배열마다 기록 기준이 다르다.** 같은 줄이 여러 배열에 들어가는 것은 중복이 아니다. 예: 작명 장면은 `events_and_claims`(작명 행위)와 관계 메모(두 이름의 대응)에 모두 들어간다. 중복은 **같은 배열 안에서 같은 내용을 두 번 적는 것**만 말한다.
  - `mentioned_only`: 다른 참여 갈래에 없는 엔티티의 이름이 나오면 빠짐없이 적는다. 언급 색인이다.
  - `events_and_claims`: 일어난 일과 인물의 주장. 단순히 이름이 나온 것만으로는 적지 않는다.
  - `clues_and_hooks`: 정체·진상·과거 사건과 연결될 수 있는 구체적 단서(소품, 코드·숫자, 과거 사건 언급, 복선, 특징)만 적는다. 이름이 나왔다고 모두 적지 않는다.
- `same_scene_speaker_groups`: 한 `unknown_id`는 최대 한 묶음에만 속한다. 혼자인 `???` 줄은 묶음에 넣지 않는다. 검증기는 그룹의 모든 ID가 이 장면의 `unknowns`에 있는지 확인한다.
- `cross_scene_hints`는 비어 있어도 된다. 검증기는 형식만 본다.
- 이전 버전 샤드(1.1.0, 1.2.0)는 1.3.0으로 다시 추출한다. 변환하거나 백필하지 않는다.
- 빈 배열은 허용한다. 하지만 필드 자체를 생략하면 안 된다. 예외로 `reviewed_gaps`는 비어 있으면 생략해도 된다.
- `reviewed_gaps`는 2.3의 21항 공백 구간을 다시 읽은 기록이다. 구간마다 줄 범위와 이유를 적는다.
  - 범위는 공백 구간 그대로 잡는다. 다른 항목이 이미 덮은 대사 줄을 넣으면 실패다.
  - 이유는 구체적으로 쓴다. 예: "전투 효과음과 짧은 감탄사만 이어지고 사건·주장·관계가 없다". "특이사항 없음"처럼 내용 없는 이유는 독립 표본 검토에서 누락으로 센다.
  - 검증을 통과하려고 내용 없는 항목을 지어내지 마라. 추출할 것이 정말 없으면 여기에 적는 것이 맞다.
- 병합기가 덧붙이는 값:
  - 장면마다: `title_id`, `category`, `source_file`, `source_sha256`(장면 본문 해시), `route`, `mechanical_validated`
  - 근거 항목(2.3의 12항 목록)과 `unknown_speakers`마다: `item_id`, `chronology_type`(장면 시점과 `chronology_segments`로, `character_claim`은 `claim_line` 기준, `unknown_speakers`는 그 `???` 줄 기준), `in_branch_option`(`{ choice_line, option_text }` 또는 `null`)
  - `claimant`나 `actor_or_speaker`가 `"???"`인 `character_claim`: `claim_line` 줄의 `unknown_id`를 `claimant_unknown_id`로

---

## 5. 파이프라인

### Pass 1: 배치 추출 → 기계 검증 → 병합·역색인
- 서브에이전트가 배치 입력(`numbered_script` + `mechanical_ground_truth`)을 받아 샤드를 쓴다.
- 속도보다 품질이 우선이다. 서브에이전트는 원문을 언제든 몇 번이든 다시 읽어도 된다. 다시 읽는 데 드는 시간과 토큰을 아끼지 마라. 단, 검증 실패 후 재시도는 아래대로 최대 3회다.
- 서브에이전트는 장면마다 다 쓴 뒤 **원문을 처음부터 다시 훑으며** 다음을 확인하고, 빠진 것을 채운 다음 다음 장면으로 넘어간다.
  - 어느 항목에도 걸리지 않은 대사 구간이 있는가. 있으면 그 구간에 사건·주장·관계·호칭·단서가 정말 없는지 본다.
  - 질문, 요청, 거절, 결정, 반박처럼 짧지만 행위인 대사를 빠뜨리지 않았는가(3절 6항).
  - 관계 메모마다 9항의 판단 기준("상태를 직접 말하거나 바꾸는가")을 다시 적용했는가.
  - 이 확인은 검증기가 대신하지 않는다. 21항은 10줄 이상 공백만 잡으므로 그보다 짧은 누락은 이 확인으로만 잡힌다.
- 이어서 검증기를 실행한다. 실패하면 오류 목록을 보고 수정하며, 최대 3회까지 재시도한다. 3회 실패한 배치는 `progress.json`에 `failed`로 남기고 감독관에게 보고한다.
- 병합기(`merge-and-index.mjs`)가 통과한 샤드만 모아 다음을 만든다.
  - `pass1_index.json`: 엔티티별 등장/조용한 등장/원격/언급, `???`, 호칭, 단서 키워드 역색인
  - 타이틀별 뷰
  - `progress.json` 갱신
- 병합기는 `unregistered_entity_candidates`를 집계해 검토용 목록을 만든다. 정식 ID 부여는 사용자 검토 후에 한다.

### Pass 1 본 실행 순서
- 파일 순서대로 돌리지 마라. 먼저 분류별로 배치를 하나씩 돌린다(10개 분류 각 1개, 총 10배치). 그 결과를 사용자에게 보고하고 승인을 받은 뒤 나머지를 진행한다.
- 이유: 형식이 다른 분류(블라블라, 유실물 등)에서 생기는 체계적 오류는 검증기를 통과한 채 그 분류 전체에 퍼질 수 있다.
- 장면이 20개를 넘는 배치(장면이 짧은 구간)는 매니페스트를 다시 만들지 말고, 서브에이전트 호출만 장면 20개 이하 단위로 나눠 돌린 뒤 하나의 샤드로 합쳐 검증한다. 배치 ID와 진행 기록은 그대로 둔다.
  - 이유: 1.3.0 파일럿에서 용량이 같은(약 60KB) 배치라도 장면 30개인 `batch_0001`은 뒤쪽 10장면의 사건 수가 1.2.0 대비 1.40배로, 앞·중간(1.86배, 1.83배)보다 크게 덜 늘었다. 장면 15개인 `pilot_full_0025`는 1.58배, 1.36배, 1.36배였다.

### [측정 게이트] Pass 1 직후
- Pass 1 결과만으로 고난도 질문(미상 화자 정체, 떡밥 연결)의 근거 장면을 얼마나 정확히 찾는지 측정해 보고한다.
- Pass 2 이후 진행 여부는 사용자가 이 결과를 보고 결정한다.

### Pass 2: 역색인 기반 후보 생성 (`data/graph/pass2/shards/`)
- 전체 카드를 한꺼번에 읽지 말고, 역색인으로 관련 카드 묶음만 골라 서브에이전트에게 배분한다. 결과는 `candidate_links`다.
- **역방향 원문 스캔**: 정체·진상이 밝혀지는 장면의 핵심 어구·소품·호칭·코드명으로 등록 원문 전체를 로컬 텍스트 검색해, 초반 장면이나 유실물의 스쳐 지나간 단서까지 후보에 넣는다.
- 미해결 단서는 `unresolved_hooks.json`에 둔다.

### Pass 3: 원문 1:1 의미 검증 (`data/graph/pass3/shards/`)
- 후보 쌍의 양쪽 실제 원문(`@@@SCRIPT_ID` 블록)을 직접 읽고 대조한다.
- 다음을 확정한다: 지지 근거, 반박 근거, 대안 후보, 확신도 라벨, `evidence_scenes`.
- 결과에 `semantic_validated: true`를 기록한다. 인용은 2.3 규칙으로 기계 검증한다.
- `semantic_validated: true`는 "원문과 대조해 검토했다"는 표시일 뿐이다. 검토를 통과했다고 `character_claim`이나 `interpretation`이 `established_event`로 바뀌거나 확신도가 올라가지 않는다. 바꾸려면 그 근거를 따로 적는다.

### Pass 4: 최종 병합과 dev 전용 조회 연결 (`data/graph/nikke_knowledge_graph.json`)
- 단일 병합기가 최종 그래프와 조회 인덱스를 원자적으로 교체한다.
- 런타임 연동은 `--dev` 환경 전용이다. 질문이 들어오면 그래프·역색인 탐색으로 관련 지식과 핵심 원문 장면만 소량 추출해 모델에 전달한다.

### 증분 업데이트와 철회
- 장면 본문 해시가 바뀌거나 장면이 삭제되면 다음 순서로 다시 돈다: 그 장면 Pass 1 재추출 → 역색인 갱신 → 관련 후보 재생성(Pass 2) → 원문 재검증(Pass 3) → 병합(Pass 4)
- 지지 근거든 반박 근거든, 바뀐 장면을 `evidence_scenes`로 쓰는 관계는 `needs_revalidation: true`가 된다. `확인된 사실`이었던 관계도 예외가 아니다.
- 재검증 대기 중이거나 철회된 관계와 거기서 파생된 요약은 조회 대상에서 즉시 제외한다.
- 신규 대본 추가 시에는 새 장면만 Pass 1을 돌린다. 이후 역색인·`unresolved_hooks.json`·역방향 원문 스캔으로 과거 `???`/떡밥과의 연결 후보를 찾는다.

---

## 5-1. 저장소 관리
- `manifest.json`과 `pass1/batches/`는 재생성 가능한 대용량 산출물이다(현재 수십~백 MB). `.gitignore`에 추가한다.
- 모델 출력인 `pass1/shards/`, `pass2/shards/`, `pass3/shards/`와 `progress.json`은 재생성 비용이 크므로 커밋 대상이다.

---

## 6. 재개(Resume) 프로토콜
- 세션이 끊긴 뒤 다시 시작하면, 감독관은 이 문서와 `data/graph/progress.json`을 먼저 읽는다.
- 2절 수칙(원문 직접 열람 금지, 공용 파일 동시 수정 금지, 기계 검증 후 단일 병합)을 지키며 미완료·실패 배치부터 이어서 실행한다.
- `progress.json`은 장면별로 다음을 기록한다(8절 1단계에서 배치 단위에서 장면 단위로 바뀐다).
  - 상태: `pending` | `in_progress` | `validated` | `merged` | `failed`
  - 장면 본문 해시와 추출 스키마 버전
  - 결과가 담긴 샤드 파일(배치 ID)
  - 재시도 횟수

---

## 7. 기초 도구 + 파일럿 Pass 1 (완료, 1.2.0 기준)

이 절은 1.2.0 파일럿 때의 작업 기록이다. 지금 할 작업은 8절이다.

1. 기초 스크립트 4종을 작성하고 2.4의 테스트를 통과시켜라.
   - `scripts/graph/build-manifest.mjs`: 매니페스트, 배치 생성, 1.5 배치 입력 생성
   - `scripts/graph/init-registry.mjs`: `entity_registry.json`, `generic_roles.json` 초안
   - `scripts/graph/validate-output.mjs`
   - `scripts/graph/merge-and-index.mjs`
2. 매니페스트를 만든 뒤 전체 규모를 보고하라: 분류별 타이틀 수, 장면 수, 원문 용량, `???` 줄 수, 예상 배치 수.
3. 아래 파일럿 범위로만 배치를 만들어라. 파일럿 배치는 `pilot_` 접두사를 쓰고, 본 실행 배치와 섞지 마라.
   - **장면 간 루트**: `2x2_love_1ch_13` (분기점, 선택지 `route_sxp7`) + TARGET 장면 `2x2_love_1ch_16`, `_17`, `_18`
   - **부제 파트(병렬 아님)**: `second_affection_08` (`9 [A]`), `second_affection_09` (`9 [B]`)
   - **`???` → 정체 공개**: `main_30_07`, `main_30_08`
   - **원격·녹음 화자**: `over_zone_14`
   - **시점·주장 구분**: `main_31_00`
   - **들여쓰기된 `???`**: `hotel_02`, `hotel_03`
   - **묘사형 화자**: `coins_in_rush_09`
   - **메신저(블라블라)**: `blabla_onemoretime_001`
   - **화자 없는 문서(유실물)**: `어느남자의수기_00`
   - 위 장면은 총 15개다. 크기에 맞춰 파일럿 배치 1~2개로 묶어라.
   - **실제 크기 배치**: 본 실행 배치 `batch_0025`와 같은 장면 구성으로 파일럿 배치를 하나 더 만든다(`pilot_full_0025`). 실제 크기(약 60KB)에서의 누락률, 품질, 토큰 사용량을 재기 위함이다.
   - 이 목록 외의 장면을 추가하지 마라.
4. 파일럿에 대해 Pass 1 추출 → 기계 검증 → 병합·역색인까지만 실행하고 멈춰서 보고하라. 보고 내용:
   - 샘플 샤드 JSON 1개 (전문)
   - 검증 실패 유형별 건수와 배치별 재시도 횟수
   - 배치당 입력·출력 토큰 사용량
   - 파일럿 결과로 본 스키마·규칙의 문제점 제안 (이 문서를 직접 고치지 말고 제안만)
5. Pass 1 전체 실행과 Pass 2 이후는 사용자 승인 후에 진행한다.

---

## 8. 지금 실행할 작업: 1.3.0 전환

관계 메모(3절 9항), 주장 화자 귀속(`claim_line`), 묘사형 화자, 기계로 정해지는 시점·분기의 병합기 이관 등을 반영해 스키마를 1.3.0으로 올리고 Pass 1을 처음부터 다시 돈다.
1.2.0으로 끝낸 배치 46개도 다시 추출한다. 아직 Pass 2를 시작하지 않아서 `item_id`를 참조하는 곳이 없으므로, 지금 다시 추출해도 깨지는 것이 없다.

1. 도구를 1.3.0으로 고치고 2.4의 테스트를 통과시켜라.
   - `validate-output.mjs`: 2.3의 1~20항을 1.3.0 기준으로 맞춘다. 새로 생기거나 바뀐 검사는 2(화자 완전성), 4(묘사형 화자), 5(기록물 작성자), 7(주장 화자), 8(기록물 호칭), 10(정체 공개 표기), 11(선택지 완전성), 12·13(분기·시점 경계), 15(`confidence`), 16(관계 메모), 17(특징 단서), 18(병합기 전용 필드), 19(스키마 버전), 20(밀도 경고)항이다.
   - `merge-and-index.mjs`: 4절 "병합기가 덧붙이는 값"을 채운다. 관계 메모의 새 필드를 병합 결과와 역색인에 반영한다. 2.3의 20항 밀도 보고를 만든다.
   - `build-manifest.mjs`: `speakers`에 `is_descriptor_alias`를 붙인다(`generic_roles.json`의 `role_category` 기준).
   - `build-manifest.mjs`, `init-registry.mjs`: 출력의 `schema_version`을 `1.3.0`으로 바꾼다.
   - 진행 상태를 **장면 단위**로 바꾼다. 지금은 `progress.json`이 배치 번호별로 장면 목록과 해시가 모두 같아야 상태를 유지한다(`build-manifest.mjs`의 `sameScenes`). 그래서 중간에 타이틀이 추가되면 뒤쪽 배치 경계가 전부 밀려, 바뀌지 않은 장면까지 다시 추출하게 된다.
     - 장면마다 `scene_id`, 본문 해시, 추출 스키마 버전, 상태, 결과가 담긴 샤드 파일을 기록한다.
     - 세 값(`scene_id`, 본문 해시, 스키마 버전)이 같은 장면은 다시 추출하지 않는다.
     - 배치는 추출이 필요한 장면만 모아 호출을 묶는 단위로만 쓴다. 새로 만드는 배치 번호는 기존 번호를 재사용하지 않는다.
     - 레지스트리의 엔티티 ID 변경은 다시 추출할 이유가 아니다. ID 연결은 병합기가 다시 한다.
     - 단, **추출 대상 분류가 바뀌면** 그 장면은 다시 추출한다. 그래서 재사용 기준에 장면의 묘사형 화자 라벨 목록(`is_descriptor_alias: true`인 라벨)도 넣는다. 예: `검은 외투의 여자`를 일반 역할에서 묘사형 화자로 바꾸면, 그 라벨이 나오는 장면만 다시 추출되어 `descriptor_speakers`가 생긴다.
2. 기존 산출물을 정리하라.
   - 1.2.0 샤드 46개는 `pass1/shards_1.2.0/`으로 옮겨 보관한다. 파일럿 비교용이다. 병합기는 이 폴더를 읽지 않는다.
   - `progress.json`을 장면 단위 형식으로 새로 만든다. 1.2.0 결과는 스키마 버전이 달라 재사용 대상이 아니므로 모든 장면이 `pending`이 된다.
   - 배치 입력(`pass1/batches/`)을 다시 만든다.
3. 파일럿을 돌려라. 배치 구성은 기존과 같다.
   - `pilot_0001`, `pilot_0002`: 7절의 특수 사례 15개 장면 (분기, `???`, 메신저, 문서, 시점·주장 구분 포함)
     - 단, 묘사형 화자 장면은 `coins_in_rush_09` 대신 `gingerbreadhouse_02`를 쓴다. `인자해 보이는 남자`가 검토에서 제외되었기 때문이다. 이 장면에서는 `양산을 든 여성`이 말하다가 91행부터 `베르누이아` 라벨로 바뀌므로, 같은 장면 안의 정체 공개도 함께 시험한다.
   - `pilot_full_0025`: 실제 크기 배치. 1.2.0 `batch_0025`와 비교한다.
   - `batch_0001`: 1.2.0에서 관계 메모가 가장 많았던 배치(30건, 메인 스토리 서두). 1.2.0 결과와 비교한다.
4. 파일럿 결과를 보고하고 멈춰라. 보고 내용:
   - 검증 실패 유형별 건수와 배치별 재시도 횟수
   - 배치당 입력·출력 토큰 사용량, 1.2.0 대비 증감
   - 관계 메모 건수: 1.2.0 대비 증감 (`batch_0001`, `pilot_full_0025`)
   - 관계 메모의 `epistemic_type` 분포와, 유형별 실제 메모 예시 각 5건 이상
     - 관계 메모에는 `interpretation`이 없으므로, 행동에서 추론한 관계가 `established_event`로 둔갑해 들어오지 않았는지 특히 확인한다.
   - 밀도 보고(2.3의 20항): 배치 안 위치별 `events_and_claims` 밀도. 1.2.0에서는 앞·중간·뒤가 대사 100줄당 5.7, 4.7, 4.5건으로 뒤로 갈수록 낮았다. 1.3.0에서도 차이가 크면 배치 크기를 줄일지 검토한다.
   - **독립 표본 검토**: 추출과 별개의 서브에이전트가 파일럿 장면 일부를 원문과 대조해 빠진 항목, 잘못 분류된 참여자(예: 현장에 없는 인물을 `present_silent`에 넣음), 틀린 사실·주장 구분을 보고한다. 검증기는 인용 위치만 보므로 이런 오류를 잡지 못한다.
   - `character_claim`의 `claimant`·`actor_or_speaker`와 `claim_line`이 맞게 적혔는지 표본 확인 결과
   - 분기·시점 경계(2.3의 12·13항) 때문에 생긴 재시도 건수. 많으면 규칙이 추출을 지나치게 쪼개는지 검토한다.
   - 1.2.0에는 있었는데 1.3.0에서 빠진 관계 메모 중, 관계 상태를 담고 있어 빠지면 안 되는 것이 있는지
   - 규칙의 문제점 제안 (이 문서를 직접 고치지 말고 제안만)
5. 사용자 승인 후 Pass 1 전체를 5절 "Pass 1 본 실행 순서"대로 처음부터 실행한다.
   - 파일럿 뒤 3절 6·9·10항, 장면 수 상한(20개), 서브에이전트의 장면별 재확인(5절 Pass 1), 검증기 21항(공백 구간)과 `reviewed_gaps`를 추가했다. 파일럿 샤드는 21항이 생기기 전에 만들어져 지금 검증기로는 실패한다. 파일럿 결과이므로 다시 돌리지 않는다. `batch_0001`은 고치기 전 규칙으로 30장면을 한 번에 돌렸으므로, `progress.json`에서 이 배치 장면을 `pending`으로 되돌리고 장면 20개 이하로 나눠 다시 추출한다. 분류별 1개 배치를 먼저 돌리고 보고하는 단계도 다시 거친다.
