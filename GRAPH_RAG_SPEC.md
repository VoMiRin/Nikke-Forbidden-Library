# GRAPH_RAG_SPEC — 니케 스크립트 아카이브 GraphRAG 구축 명세

이 문서는 `nikke-script-archive`의 등록된 전체 스크립트를 분석해 니케 전용 GraphRAG 시스템(`data/graph/`)을 구축하기 위한 **단일 진실 공급원(Single Source of Truth)**이다.
감독관(메인 세션), 모든 서브에이전트, 재개(Resume)·증분 업데이트 작업은 이 문서 전체를 기준으로 삼는다. 이 문서를 임의로 수정하지 마라. 변경이 필요하면 사용자에게 제안하라.

- 스포일러 필터는 구현하지 않는다. (사용자는 스토리를 이미 다 아는 사람이라는 전제)
- 실행 순서: 7절의 파일럿부터. Pass 2 이후는 사용자 승인 후에만 진행한다.

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
  - (e) `line_speaker`: 줄 번호 → 그 줄의 화자 (대사 줄만).
    - `[OPTION TEXT="..."]` 줄의 화자는 `지휘관`이다. 선택지는 지휘관의 대사이기 때문이다(메신저 안의 선택지도 같다).
    - 따라서 선택지가 있는 장면에서는 `지휘관`이 `speakers`에 들어간다(출처 `option`).

### 1.6 화자 표기와 인물 정체(Entity ID) 분리
- `scripts/speakerAssets.mjs`는 같은 표기를 묶는 기능이다. 인물 정체 레지스트리로 그대로 쓰지 마라.
- `"???"`와 `"병사"`, `"연구원"`, `"양산형 니케"`, `"시민"` 같은 일반 역할 명사는 여러 인물일 수 있다. `is_generic_role: true`, `entity_id: null`로 둔다.
  - 일반 역할 목록은 `init-registry.mjs`가 휴리스틱으로 초안을 만들고, 사용자가 검토할 수 있게 별도 파일(`data/graph/generic_roles.json`)로 둔다.
- 다른 이름으로 불린 두 화자가 같은 인물이라는 연결에는 반드시 대본 근거가 필요하다.
- `인자해 보이는 남자`(274줄), `검은 물을 덮은 소녀`(215줄)처럼 묘사형 라벨로 많이 발화하는 화자는 사실상 정체가 가려진 특정 인물일 수 있다.
  - `generic_roles.json`에서 `role_category: "descriptor_alias"`로 따로 표시한다.
  - Pass 2에서 `???`와 같은 방식으로 정체 후보를 찾는 대상에 포함한다.
  - Pass 1에서는 일반 역할과 똑같이 `entity_id: null`로 둔다.
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
1. **장면 완전성**: 배치의 모든 `scene_id`가 결과에 빠짐없이 있어야 한다. 배치에 없는 `scene_id`가 있어도 오류다.
2. **화자 실존**: `present_in_scene`과 `remote_or_voice_only`의 `speaker_label`은 반드시 그 장면의 `mechanical_ground_truth.speakers` 안에 있어야 한다.
   - 본문 아무 곳에 이름이 있다는 이유로 통과시키지 마라. 그러면 언급만 된 인물이 등장 인물로 통과한다.
3. **`???` 완전성**: 원문의 모든 `???:` 줄이 `unknown_speakers`에 정확한 `unknown_id`로 있어야 한다. 없는 ID를 지어내도 오류다.
4. **인용 위치**: 모든 `quote`는 해당 항목의 `line_start`~`line_end` 범위 원문 안에 있어야 한다.
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
5. **호칭**: `forms_of_address`의 `from_speaker`는 `line_start` 줄의 실제 화자(`line_speaker`)여야 하고, `address_term`은 `quote` 안에 있어야 한다.
6. **선택지**: `choice_branches[].options[].option_text`는 원문 `OPTION TEXT` 값과 정확히 같아야 한다.
6-1. **언급 표기**: `mentioned_only[].surface_text`는 그 항목의 `quote` 안에 있어야 한다. 조사가 붙은 형태(`라피가`)는 부분 문자열로 통과한다.
7. **스키마**: 필수 필드 누락, enum 위반, 타입 오류는 오류다. 병합기가 누락 필드 때문에 죽지 않게 하기 위함이다.
8. **모델이 쓰면 안 되는 필드**: `title_id`, `category`, `source_file`, `source_sha256`, 분기 정보, `mechanical_validated`, `item_id`. 이 값들은 병합기가 매니페스트에서 채운다. 모델 출력에 있으면 무시하고 경고한다.

검증 상태는 두 가지로 분리해 보관한다.
- `mechanical_validated`: 검증기가 기록한다.
- `semantic_validated`: Pass 3이 기록한다.

인용이 원문에 실존한다고 해서 해석까지 맞은 것은 아니다.

### 2.4 테스트
- 기초 스크립트마다 `node --test` 테스트를 작성한다. 실제 대본 파일을 쓴다.
- 테스트 파일 위치는 `scripts/graph-*.test.mjs`처럼 `scripts/` 바로 아래다. `npm test`는 `node --test scripts/*.test.mjs`만 실행하므로 `scripts/graph/` 안에 두면 실행되지 않는다.
- 최소 테스트 항목:
  - 등록된 각 파일의 파싱 장면 ID 목록이 `newScriptsData`의 해당 파일 항목과 정확히 일치한다.
  - 전체 `???:` 줄 수가 원문 `grep -cE '^\s*\?\?\?:'` 합계(현재 1,071)와 일치한다. 들여쓰기 포함이다.
  - `second_affection_08`/`_09`가 병렬 갈래로 판별되지 **않는다**.
  - 선택지가 있는 장면에서 `[OPTION TEXT]` 줄의 `line_speaker`가 `지휘관`이다.
  - `2x2_love_1ch_13`에서 `NEXT_ROUTE` 3개(TARGET `_16`, `_17`, `_18`)가 추출된다.
  - 메신저 장면에서 `SENDER`가 화자로 잡히고, 본문 줄은 화자로 잡히지 않는다.
  - 검증기 실패 사례별 테스트: 언급만 된 인물을 `present_in_scene`에 넣은 경우, 인용 줄 범위가 틀린 경우, `???` 누락, 장면 누락, 1~3자 인용, `surface_text`가 인용에 없는 경우, 들여쓰기된 `???` 줄 누락.
- 기존 `npm test`가 계속 전부 통과해야 한다.

---

## 3. 대본 독해 및 세계관 추출 규칙

1. **전 장면 기본 색인 필수**
   - 평범한 일상 대사의 호칭·말버릇·소품이 수십 챕터 뒤 정체를 밝히는 단서가 된다.
   - 따라서 모든 장면(100%)에 기본 색인을 남긴다: 화자 분리, 호칭, 특징적 발언, 소품·단서, 분기, 원문 위치.
   - `is_plot_critical`은 기본 색인을 생략하는 용도가 아니다. 추가 심층 분석의 깊이만 조절한다.

2. **시점 맥락과 참여 상태 분리**
   - 모든 장면과 사건에 `chronology_type`을 기록한다. 꿈·회상·가정에서 묘사된 일을 현재 사건으로 오인하지 마라.
     - 장면: `present` | `flashback` | `dream` | `hypothetical` | `mixed`
     - 사건: `mixed`를 제외한 네 값
   - **`chronology_type`은 "그 일이 언제 일어났나"가 아니라 "대본이 그 일을 어떤 방식으로 보여 주나"다.**
     - `flashback`/`dream`은 대본이 과거나 꿈을 **직접 장면으로 연출할 때만** 쓴다. 회상 연출이 시작되고 끝나는 구간이 있다.
     - 인물이 현재 장면에서 과거 일을 **말로 이야기하는 것**은 `present`다. 그 내용은 `character_claim`으로 기록하고 `refers_to_past: true`를 붙인다.
     - 녹음·메시지·문서가 과거 일을 전하는 것도 같다. 화자나 출처의 진술로 기록한다.
     - `mixed`는 한 장면 안에 현재와 회상·꿈 연출이 함께 있을 때만 쓴다.
   - 인물 참여는 네 갈래로 나눈다.
     - `present_in_scene`: 현장에서 발화한 인물. 화자 목록에 있어야 한다. `???`는 여기에 넣지 않는다(`unknown_speakers`에서만 다룬다).
     - `present_silent`: 현장에 있지만 발화하지 않은 인물. 현장에 있음을 보여주는 원문 근거가 필수다.
     - `remote_or_voice_only`: 통신·녹음·메신저·회상 목소리로만 발화한 인물. 화자 목록에 있어야 한다.
     - `mentioned_only`: 이름·별칭만 언급된 인물·조직·장소·개념·아이템·사건
   - 블라블라 메신저의 참여자와 발신자는 `remote_or_voice_only`(`medium: "messenger"`)로 넣는다.
   - **한 인물은 한 장면에서 한 갈래에만 넣는다.** 같은 장면에서 메신저·통신으로도 말하고 현장에도 나오면 `present_in_scene`에만 넣는다. 메신저·통신으로만 말했을 때만 `remote_or_voice_only`에 넣는다(예: 메신저로 의뢰한 뒤 현장에서 만나는 서브 퀘스트 의뢰인은 `present_in_scene`). 검증기는 같은 `speaker_label`이 `present_in_scene`과 `remote_or_voice_only`에 함께 있으면 실패 처리한다.
   - 화자 라벨 없이 대사만 적힌 음성·영상 유실물(`.wav`, `.mp4` 등)은 기록물로 보고 `document_author`에 넣는다(`name`에 원문 지칭, 예: `녹음 속 남자`).
   - 화자 라벨이 없는 문서·일기·수기의 작성자는 `document_author`에 넣는다. 정체가 없으면 `name`에 원문의 지칭(예: `수기 작성자`)을 쓰고 `entity_id`는 `null`로 둔다.

3. **미상 화자(`???`)**
   - 노드 ID는 기계 추출된 `unk_<scene_id>_L<줄번호>`를 그대로 쓴다. 줄 하나가 노드 하나다.
   - 같은 장면의 다른 `???` 줄과 같은 인물인지(`SAME_SPEAKER_IN_SCENE`), 특정 인물과 연결되는지(`CANDIDATE_IDENTITY`)는 노드를 합치지 말고 별도 관계와 근거로 표현한다.
   - Pass 1에서는 같은 인물로 보이는 `???` 줄들을 쌍이 아니라 **묶음**(`same_scene_speaker_groups`)으로 기록한다. 쌍으로 적으면 n개 줄에 n-1개 이상의 항목이 생겨 출력이 불필요하게 커진다.
   - **Pass 1은 장면 단위다.** `contextual_clues`와 `summary`에는 그 장면 안의 정보만 쓴다.
     - 같은 배치에 다른 장면이 있어도, 다른 장면에서 알게 된 정체나 사실을 섞지 마라.
     - 다른 장면과의 연결이 보이면 `cross_scene_hints`에만 적는다. 이 필드는 Pass 2 후보 탐색용 힌트일 뿐 근거가 아니다.
   - 후속 정체 공개가 반드시 있다고 가정하지 마라.

4. **분기**
   - 장면 내 선택지와 장면 간 루트(1.3)를 모두 병렬 갈래로 기록한다. 병렬 갈래의 장면들을 시간순으로 이어진 사건으로 읽지 마라.
   - 특정 분기에만 있는 사실은 `branch_specific: true`와 선택지 텍스트를 함께 적는다.
   - `choice_branches`에는 `is_branching: true`인 선택지 블록만 기록한다. 선택지가 하나뿐이고 뒤에 이어지는 대사가 없는 블록은 지휘관의 대사일 뿐이다. 이런 블록은 전체 코퍼스에 약 3만 8천 개 있다.
   - 모든 분기에서 공통으로 지지되거나 인물·설정 특성을 보여주는 사실은 일반 근거로 쓸 수 있다.

5. **세계관 엔티티와 관계 변화**
   - `???`와 떡밥뿐 아니라 다음도 추출한다.
     - 조직: 방주, 중앙정부, 기업, 스쿼드 등
     - 장소
     - 핵심 개념
     - 주요 사건의 참여자와 결과
     - 인물 간 관계 변화
   - 사전 지식으로 채우지 말고 그 장면에 나온 것만 적는다.

6. **사실·주장·추정 분리와 양면 근거**
   - `established_event`: 대본에서 직접 서술·시연된 사건. `chronology_type`을 함께 적는다.
   - `character_claim`: 인물의 의심·소문·거짓말·불완전한 지식. 인물의 주장은 자동으로 사실이 되지 않는다.
   - `interpretation`: **추출자(모델)**가 간접 단서로 내린 추정. 확신도 라벨이 필수다.
   - 등장인물이 스스로 추측하거나 느끼거나 경험했다고 말하는 것은 `interpretation`이 아니라 `character_claim`이다.
     - 예: 라피가 "레드 후드와 아나키오르가 조우했던 것 같습니다"라고 말함 → `character_claim`
     - 예: 라피가 "기억이 머릿속에 흘러들어왔다"고 말함 → `character_claim`. 대본이 그 현상을 직접 연출하지 않았다면 `established_event`가 아니다.
   - `established_event`는 대본이 지문·연출로 직접 보여 준 일, 또는 여러 인물이 현장에서 함께 겪어 장면 안에서 의심의 여지가 없는 일에만 쓴다.
   - **말한 행위와 말한 내용을 구분하라.** 현장에서 누가 무엇을 말했다는 사실 자체는 대본이 직접 보여 준 것이다.
     - 행위가 핵심인 대사 → `established_event`
       - 질문·추궁, 요청·지시, 결정·선언, 약속, 고백, 거절, 작명
       - 예: "지휘관이 왜 그레이브를 먼저 공격했는지 묻는다"
       - 예: "지휘관이 작전 목표를 그레이브 추적으로 한정한다"
       - 예: "음성 파일이 세 가지 임무를 요청한다"
     - 내용이 핵심인 대사 → `character_claim`. 세상에 대한 사실 주장인데 대본이 그 사실을 직접 보여 주지 않은 경우다.
       - 예: "아나키오르는 최초의 헬레틱이다"
       - 예: "방주가 보상을 준비해 두었다"
     - 한 대사에 둘 다 있어도 항목을 둘로 쪼개지 마라. 기록할 가치가 있는 쪽 하나만 적는다. 대개 사실 주장이 담긴 쪽이 더 중요하다.
     - 파일럿 2차에서 모든 대사가 `character_claim`으로 쏠리는 경향이 확인되었다. 이 규칙은 그것을 바로잡기 위함이다.
   - Pass 2·3의 모든 관계에는 다음을 함께 기록한다: 지지 근거(`supporting_evidence`), 반박 근거(`contradicting_evidence`), 대안 후보.
   - 같은 장면의 중복 발췌는 독립된 교차 검증이 아니다.
   - 사전 지식 사용 범위:
     - Pass 2 후보 탐색에서는 니케 사전 지식을 검색 힌트로 써도 된다.
     - Pass 3 최종 판정의 근거는 대본 원문뿐이다.

7. **확신도 라벨** (수치 점수 금지, 아래 4개만 사용)
   - `확인된 사실`: 대본 근거로 직접 확립된 사실. 인물 정체에는 명시적 확인이나 의심의 여지가 없는 공개가 있을 때만 쓴다.
   - `유력한 해석`: 구체적이고 독립적인 간접 단서 여럿이 강하게 지지한다.
   - `가능성`: 개연성은 있으나 단서가 제한적이거나 배타적이지 않다.
   - `판단 보류`: 근거가 부족하거나 상충한다.

8. **출처 기록**
   - 모든 관계·정체 후보·별명·요약에는 근거가 된 `scene_id`와 줄 범위(`evidence_scenes`)를 기록한다.
   - 이는 원문 수정 시 재검증 대상을 찾기 위한 용도다. 스포일러 필터는 구현하지 않는다.

---

## 4. Pass 1 샤드 스키마 (`schema_version: "1.2.0"`)

서브에이전트가 쓰는 `data/graph/pass1/shards/<batch_id>.json`의 형식이다. 모든 `line_start`/`line_end`는 1.2의 장면 본문 기준 줄 번호다.

```json
{
  "schema_version": "1.2.0",
  "batch_id": "batch_0001",
  "scenes": [
    {
      "scene_id": "string (@@@SCRIPT_ID 그대로)",
      "chronology_type": "present | flashback | dream | hypothetical | mixed",
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
        "document_author": { "name": "string", "entity_id": "string | null" }
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
          "resolved_in_same_scene_to": { "entity_id": "string", "line_start": 1, "line_end": 1, "quote": "string" }
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
            { "option_text": "string (원문 OPTION TEXT 그대로)", "continuation_summary": "string", "branch_specific_facts": ["string"] }
          ]
        }
      ],
      "events_and_claims": [
        {
          "epistemic_type": "established_event | character_claim | interpretation",
          "chronology_type": "present | flashback | dream | hypothetical",
          "confidence": "interpretation일 때만 필수: 유력한 해석 | 가능성 | 판단 보류",
          "actor_or_speaker": "string",
          "summary": "string",
          "line_start": 1,
          "line_end": 1,
          "quote": "string",
          "branch_specific": false,
          "branch_option_text": "string | null",
          "refers_to_past": false
        }
      ],
      "clues_and_hooks": [
        { "keyword": "string", "category": "item | code_or_number | past_incident | foreshadowing | lore_concept | location | organization", "detail": "string", "line_start": 1, "line_end": 1, "quote": "string" }
      ],
      "relationship_and_lore_notes": [
        { "subject": "string", "target": "string", "relation_or_change": "string", "line_start": 1, "line_end": 1, "quote": "string" }
      ],
      "unregistered_entity_candidates": [
        { "surface_text": "string", "suggested_type": "character | alias | squad | organization | location | concept | item", "line_start": 1 }
      ]
    }
  ]
}
```

필드 규칙:
- `resolved_in_same_scene_to`는 같은 장면에서 정체가 밝혀지지 않았으면 `null`이다.
- `document_author`는 화자 없는 문서·일기 장면에서만 쓰고, 그 외에는 `null`이다.
- 병합기는 `events_and_claims[].confidence`가 없으면 `null`로 채워 키 구조를 통일한다.
- `same_scene_speaker_groups`: 한 `unknown_id`는 최대 한 묶음에만 속한다. 혼자인 `???` 줄은 묶음에 넣지 않는다. 검증기는 그룹의 모든 ID가 이 장면의 `unknowns`에 있는지 확인한다.
- `cross_scene_hints`는 비어 있어도 된다. 검증기는 형식만 본다.
- 1.1.0 샤드(파일럿 1차)는 1.2.0으로 다시 추출한다. 변환하지 않는다.
- 빈 배열은 허용한다. 하지만 필드 자체를 생략하면 안 된다.
- 병합기는 장면마다 매니페스트에서 다음 값을 덧붙인다: `title_id`, `category`, `source_file`, `source_sha256`(장면 본문 해시), `route`, `mechanical_validated`. 항목마다 `item_id`도 붙인다.

---

## 5. 파이프라인

### Pass 1: 배치 추출 → 기계 검증 → 병합·역색인
- 서브에이전트가 배치 입력(`numbered_script` + `mechanical_ground_truth`)을 받아 샤드를 쓴다.
- 이어서 검증기를 실행한다. 실패하면 오류 목록을 보고 수정하며, 최대 3회까지 재시도한다. 3회 실패한 배치는 `progress.json`에 `failed`로 남기고 감독관에게 보고한다.
- 병합기(`merge-and-index.mjs`)가 통과한 샤드만 모아 다음을 만든다.
  - `pass1_index.json`: 엔티티별 등장/조용한 등장/원격/언급, `???`, 호칭, 단서 키워드 역색인
  - 타이틀별 뷰
  - `progress.json` 갱신
- 병합기는 `unregistered_entity_candidates`를 집계해 검토용 목록을 만든다. 정식 ID 부여는 사용자 검토 후에 한다.

### Pass 1 본 실행 순서
- 파일 순서대로 돌리지 마라. 먼저 분류별로 배치를 하나씩 돌린다(10개 분류 각 1개, 총 10배치). 그 결과를 사용자에게 보고하고 승인을 받은 뒤 나머지를 진행한다.
- 이유: 형식이 다른 분류(블라블라, 유실물 등)에서 생기는 체계적 오류는 검증기를 통과한 채 그 분류 전체에 퍼질 수 있다.
- 장면이 40개를 넘는 배치(유실물처럼 장면이 아주 짧은 구간)는 매니페스트를 다시 만들지 말고, 서브에이전트 호출만 장면 40개 이하 단위로 나눠 돌린 뒤 하나의 샤드로 합쳐 검증한다. 배치 ID와 진행 기록은 그대로 둔다.

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
- `progress.json`은 배치별로 다음을 기록한다.
  - 상태: `pending` | `in_progress` | `validated` | `merged` | `failed`
  - 포함된 `scene_id`와 장면 해시
  - 재시도 횟수

---

## 7. 지금 실행할 작업 (기초 도구 + 파일럿 Pass 1까지만)

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
