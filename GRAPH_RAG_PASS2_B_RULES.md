# GraphRAG Pass 2 B(정체 후보) 판정 규칙

B 서브에이전트와 독립 검토자가 읽는 규칙이다. 이 문서가 전부다. `GRAPH_RAG_SPEC.md`·`GRAPH_RAG_PASS2_DRAFT.md`와 `scripts/` 아래 소스는 읽지 않는다.
스키마 버전은 `pass2-0.1.0`이다. 파일럿에서 고친다.

## 1. 할 일

묶음 하나는 이야기 하나 또는 큰 이야기를 최대 20단위씩 나눈 부분이다. 부분 묶음도 이야기 전체 대본을 읽을 수 있다. 묶음의 **판정 단위**마다 다음 셋 중 하나로 판정한다.

| verdict | link_type | 뜻 |
|---|---|---|
| `정체 후보 있음` | `identity` | 원문 근거로 누구인지 후보를 낼 수 있다 |
| `군중·엑스트라` | `crowd` | 이름 없는 여럿 중 하나, 장면을 채우는 목소리다. 누구인지 찾지 않는다 |
| `판단 보류` | `identity` | 후보가 없거나, 근거가 약하거나, 후보 여럿이 비슷하다 |

- 결과는 **후보**다. 확정은 다음 단계(원문 대조)가 한다. 그래서 `확인된 사실`은 쓰지 않는다.
- 판정 단위는 묶음의 `units`에 있다. 하나도 빠뜨리지 않는다.

## 2. 입력

### 2.1 묶음 파일 `B1__<title_id>.json`

- `units[]`: 판정 단위
  - `unit_type`
    - `unknown_group`: 같은 장면에서 한 인물로 묶인 `???` 줄 여럿(Pass 1의 `same_scene_speaker_groups`)
    - `unknown_line`: 묶이지 않은 `???` 한 줄
    - `descriptor`: 묘사형 화자 라벨(예: `검은 물을 덮은 소녀`). 그 라벨의 대사 줄 전부가 `lines`에 있다
    - `author`: 정체가 가려진 기록물 작성자. 같은 이야기에서 같은 이름으로 적힌 장면을 한 단위로 묶었다
    - `voice`: 기록물 안의 라벨 없는 목소리 하나(`voice_index`). 작성자와 같은 사람인지부터 판정 대상이다
  - `subject_refs`: 출력의 `subject`에 **그대로 옮길** 참조
  - `lines`: 판정 대상 줄(`???` 줄, 묘사형 화자 대사 줄)
  - `pass1`: Pass 1이 적은 말투·호칭·단서. **근거가 아니다.** 원문으로 확인한 것만 쓴다
  - `context`: 먼저 읽을 범위. 판정에 필요하면 장면 전체와 다른 장면도 읽는다
  - `crowd_hint`: 기계 힌트(묶이지 않은 짧은 `???` 줄이 한 장면에 많음). 판정은 네가 한다
  - `scan_terms`: 이 단위에 쓴 검색어
- `story.scenes[]`: 이 이야기 모든 장면의 요약, 화자와 `entity_id`, 같은 장면에서 풀린 정체(`resolved_identities`), 장면 간 힌트
- `scan`: 역방향 원문 스캔 결과
  - `terms[]`: 검색어, 출처(`sources`), 같은 이야기 안의 대사 줄 번호(`same_title_lines`), 다른 이야기 결과 수
  - `hits[]`: 다른 이야기에서 찾은 줄과 앞뒤 2줄(`excerpt`). `scan_id`가 있다
  - `dropped_terms`: 너무 흔해서 다른 이야기 결과를 뺀 검색어
- `routed_to_a2`: 이름이 있는 미등록 작성자. 이 묶음에서 판정하지 않는다(A-2 몫)

### 2.2 대본 파일 `B1__<title_id>.script.txt`

이 이야기 모든 장면의 원문이다. 장면마다 `@@@ <scene_id> | <부제>` 아래에 `[L0001] 원문` 형식으로 있다. 줄 번호는 장면마다 1부터 센다.

### 2.3 명령

```
node scripts/graph/pass2-b.mjs show <scene_id> [시작줄 끝줄]          # 등록 장면 원문
node scripts/graph/pass2-b.mjs grep <낱말> --bundle=<bundle_id> [--offset=N] [--limit=N]   # 등록 원문 전체 검색(기록이 남는다)
node scripts/graph/pass2-b.mjs entity <이름>                         # 레지스트리에서 entity_id 찾기
```

- 스캔 결과 밖의 장면은 `show`로 읽는다.
- 사전 지식으로 떠올린 후보가 있으면 `grep`으로 그 후보의 이름·말버릇·소품이 나오는 원문을 찾는다. 찾은 원문 줄만 근거가 된다.
- `grep`은 한 번에 30줄씩 보여 준다. 결과가 잘리면 출력에 `이어 보기: --offset=N`이 나온다. 뒤쪽 근거를 놓치지 않도록 필요하면 그대로 이어 본다. 검색 횟수 제한은 3.8절이다.

## 3. 판정 기준

### 3.1 근거

- `supporting_evidence`·`contradicting_evidence`에는 **원문 줄만** 적는다. 사전 지식, 게임 밖 정보, Pass 1 요약은 근거가 아니다.
- 사전 지식으로 떠올린 것은 `search_hints`에 적는다(예: "말투가 인물 A와 같다고 알고 있음. grep으로 A의 말버릇을 찾아 <scene_id> L<줄>에서 확인함").
- 원문 근거 없이 사전 지식에만 기댄 후보는 `판단 보류`다.
- 반대되는 원문(다른 인물로 보이게 하는 줄, 시간·장소가 안 맞는 줄)이 있으면 `contradicting_evidence`에 적는다. 숨기지 않는다.
- 연결의 `supporting_evidence`는 **target을 지지하는 근거**다. 대안 후보만 지지하는 줄은 `alternatives[].supporting_evidence`로 따로 옮기고, `why`에 대안으로 남긴 이유를 적는다. 대안 근거에는 `reveals_identity`를 쓰지 않는다. target에 반대되는 줄이면 `contradicting_evidence`에도 적을 수 있다.

### 3.2 정체 후보 있음

- `target`에는 가장 유력한 후보 **하나**를 적는다. 다른 후보는 `alternatives`에 이유와 함께 적는다.
- 등록 인물이면 `entity_id`를 적는다(`entity` 명령으로 찾는다). 등록되지 않은 인물이면 `entity_id: null`과 원문 표기 `name`을 적는다.
- `confidence`:
  - `유력한 해석`: 원문이 **판정 대상과 이름 사이의 연결**을 거의 직접 보여 준다. 이름을 밝힘, 그 이름으로 불림, 같은 사건을 이름 붙은 화자로 다시 보여 줌
  - `가능성`: 간접 단서(같은 말버릇, 같은 소품, 같은 호칭, 같은 장소·시점, 같은 역할)가 여럿 맞는다. 제3자가 후보의 이름과 역할을 설명한 줄이 있어도, 그 후보가 판정 대상이라는 연결은 추론이면 여기에 든다
- **`reveals_identity`**: identity 연결의 `supporting_evidence`마다 적는다.
  - `true`: **quote 자체**에 후보의 이름이나 등록 별칭이 화자 표기·대사·지문으로 나오고, **그 이름이 판정 대상 화자를 가리킨다는 연결이 인용에서 드러나는** 줄. 이름을 밝히는 줄, 다른 인물이 그 이름으로 부르는 줄, 같은 장면·사건을 이름 붙은 화자로 보여 주는 줄이 여기에 든다. 이름이 범위 안에만 있고 quote에는 없으면 안 된다
    - 예외: `target.entity_id`가 `char_지휘관`이고, 같은 사건의 지휘관 대사로 확인되는 **선택지 한 줄 전체**를 인용했다면 이름이 없어도 true로 적을 수 있다. `[OPTION TEXT="..."]` 전체 또는 그 안의 대사 전체를 복사한다. 선택지라는 이유만으로 다른 장면의 비슷한 말을 공개로 치지는 않는다
  - `false`: 그 밖의 모든 줄
    - 판정 대상 `???` 줄 자체
    - 말버릇·소품·호칭이 같은 다른 장면 줄(예: 다른 장면에서 이름 붙은 화자가 같은 어구를 씀)
    - 이름은 나오지만 그 이름이 화자를 가리키지 않는 줄(예: `???: 그레이브를 찾아라`)
    - 이름은 안 나오고 사건만 겹치는 회상·독백 줄
    - 제3자가 이름 붙은 후보의 역할을 설명하지만, 그 사람이 판정 대상이라고 직접 연결하지 않는 줄
- 같은 이야기의 다른 장면에서 공개되면 그 장면 줄을, 다른 이야기에서 공개되면 그 이야기 줄을 근거로 적는다. 공개가 먼저인지 나중인지는 병합기가 계산한다. 네가 정하지 않는다.
- 지어낸 예: `???`가 "나는 도서관의 관리 프로그램이다"라고 말하고, 다른 이야기에서 제3자가 "도서관 관리 프로그램의 이름은 인물 A다"라고 설명하면 인물 A를 후보로 낼 수 있다. 하지만 그 설명이 `???`를 직접 가리킨 것은 아니므로 `가능성`이고, 설명 줄은 `reveals_identity: false`다.

### 3.3 군중·엑스트라

- 병사·관중·행인·직원처럼 이름 없는 여럿 중 하나이고, 이 이야기나 다른 이야기에서 그 목소리를 특정 인물로 받는 말이 없을 때다.
- 누구인지 찾지 않는다. `target: []`, `alternatives: []`.
- `supporting_evidence`에는 그 `???` 줄과, 군중으로 본 근거가 된 앞뒤 줄(예: "병사들이 웅성거린다" 지문)을 적는다. `reveals_identity`는 쓰지 않는다.
- 한 장면의 `???`가 여럿이어도, 이름 붙은 화자가 대답하거나 이름 붙은 화자와 대화를 주고받는 목소리는 군중으로 몰지 않는다.
- 이름 없는 목소리끼리만 짧게 주고받는 대화(예: 행인이나 구경꾼끼리 나누는 말)는 대답이 있어도 군중이다. 그 목소리가 이 이야기나 다른 이야기에서 특정 인물로 이어지면 군중이 아니다.

### 3.4 판단 보류

- `confidence`도 `판단 보류`다.
- 후보가 하나 떠오르면 `target`에 하나까지 적을 수 있다. 없으면 `target: []`.
- **개인은 모르고 소속 집단만 좁혀졌으면 보류다.** `target`에는 그 집단 하나를 적을 수 있다(조직은 `entity_type: "organization"`, 스쿼드는 `"squad"`). `name`은 원문이 그 집단을 가리킨 표기 그대로 적는다(예: "OO 관계자들"). 관계자·직원을 그들이 속하거나 담당하는 스쿼드·회사 자체로 바꿔 적지 않고, 이때 `entity_type`은 `"organization"`으로 적는다. 집단의 이름을 알았다고 개인의 정체 후보를 냈다고 하지 않는다. 개인이 밝혀진 것처럼 `reveals_identity: true`를 적지 않는다.
- 지어낸 예: 협박 전화를 건 `???`가 "운송 회사 직원들"까지 좁혀지지만 직원이 여럿이고 누구인지 나오지 않으면 `판단 보류`이며, "운송 회사 직원들"을 target에 남길 수 있다. 이는 `가능성`으로 개인 후보를 낸 경우와 다르다.
- `supporting_evidence`에는 판정에 쓴 원문 줄(대상 줄과 앞뒤)을 적는다. 비워 두지 않는다.
- 보류 이유(무엇이 있으면 정할 수 있는지)를 `rationale`에 적는다.
- 3.8절의 검색 예산을 다 써서 멈췄으면 `rationale`을 `[검색 예산 소진]`으로 시작하고 쓴 검색어를 적는다. 예산 안에서 찾을 곳을 다 봤는데 근거가 없는 경우에는 붙이지 않는다.

### 3.5 단위를 나누거나 합칠 때

- `unknown_group`이나 `author` 단위 안에 다른 사람이 섞였으면 **나눈다**. `subject`를 나눠 연결을 따로 만들고, `rationale`에 나눈 이유와 나눈 줄을 적는다(예: 기침 소리와 말소리가 다른 인물).
- **판정 단위마다 연결을 하나씩 만드는 것이 기본이다.** 같은 인물로 보여도 단위가 다르면 연결을 따로 만든다. 한 연결이 틀렸을 때 다른 단위까지 함께 버려지지 않게 하기 위함이다.
- 예외: 같은 라벨의 `descriptor` 단위끼리, 또는 같은 이름의 `author` 단위끼리는 **라벨이 같고 같은 인물이라는 원문 근거가 있을 때만** 한 연결에 합칠 수 있다. `rationale`에 그 근거를 적고, 근거 줄은 단위마다 하나 이상 있어야 한다.
- 한 참조(`subject_refs`의 항목 하나)는 연결 **하나에만** 넣는다. 다른 가능성은 `alternatives`에 적는다.

### 3.6 작성자와 목소리

- `author` 단위는 기록물을 쓴(녹음한) 사람이다. 기록 안의 말투·사건·장소·날짜와, 같은 내용이 나오는 다른 이야기(스캔 결과, `grep`)를 대조한다.
- **서명·바이라인에 작성자의 실명이 직접 적혔으면 그 이름을 후보로 적는다.** 미등록이라는 이유만으로 보류하지 않는다. `entity`로 조회한 뒤 미등록이면 `entity_id: null`, `name`은 원문 실명에서 기자·박사 같은 직함을 뺀 이름, `entity_type: "character"`, `confidence: "유력한 해석"`이다. 서명 줄을 직접 인용하고 `reveals_identity: true`로 적는다. 문서 제목이나 일반 역할을 실명으로 간주하지 않는다.
- 지어낸 예: `(어느 신문) 홍길동 기자 = ...`의 작성자는 `name: "홍길동"`이다. A-2로 이미 빠진 작성자는 판정하지 않지만, B의 units에 남아 있는 실명 작성자는 이 규칙으로 처리한다. A-2 뒤 ID 연결은 병합기가 맡는다.
- `voice` 단위는 작성자와 같은 사람이면 작성자와 같은 후보로 판정한다. 그 경우에도 작성자와 합치지 않고 연결과 근거 줄을 따로 적는다.

### 3.7 시점

- 회상·꿈·가정 장면에서 나온 이름은 그 장면의 시점에서 판단한다. 다른 시대의 같은 직함(예: 과거의 `지휘관`)을 지금 인물로 잇지 않는다.

### 3.8 검색 예산

- 판정 단위 하나에 **서로 다른 검색어를 5개까지** 쓴다. 잘린 결과를 `--offset`으로 이어 보는 것은 세지 않는다.
- 같은 검색어를 같은 `--offset`으로 다시 실행하지 않는다.
- 5개를 쓰고도 후보를 정할 수 없으면 더 찾지 않고 `판단 보류`로 둔다(3.4절의 표시를 붙인다).

## 4. 출력

`<plan의 output 경로>`(예: `data/graph/pass2/pilot/shards/B1__<title_id>.json`)에 JSON으로 쓴다. 아래 예시의 ID와 대사는 형식을 보이기 위해 지어낸 것이다.

```json
{
  "schema_version": "pass2-0.1.0",
  "bundle_id": "B1__event_stories__example",
  "candidate_links": [
    {
      "link_id": "B1__event_stories__example__001",
      "link_type": "identity",
      "subject": [
        { "ref": "item", "item_id": "example_03__unk_001", "unknown_id": "unk_example_03_L0040" }
      ],
      "target": [
        { "ref": "entity", "entity_id": "char_...", "name": "원문 표기", "entity_type": "character" }
      ],
      "verdict": "정체 후보 있음",
      "confidence": "가능성",
      "rationale": "판정 이유 한두 문장. 나눴으면 나눈 이유.",
      "supporting_evidence": [
        { "scene_id": "example_03", "line_start": 40, "line_end": 40, "quote": "???: 거기, 멈춰.", "reveals_identity": false },
        { "scene_id": "example_09", "line_start": 12, "line_end": 13, "quote": "인물 B: 너였구나, 인물 A.", "reveals_identity": true }
      ],
      "contradicting_evidence": [],
      "alternatives": [],
      "search_hints": []
    }
  ]
}
```

- `link_id`: `<bundle_id>__001`부터 순서대로.
- `subject`: 묶음 `subject_refs`의 항목을 그대로 옮긴다. 지어내지 않는다.
- `target[].entity_type`: `character | squad | organization | location | item | concept | event`. 보통 `character`다.
- `quote`: 원문을 그대로 복사한다. 화자 라벨(`???: `)은 붙여도 떼도 된다. 범위(`line_start`~`line_end`) 안에 있어야 하고, 4글자보다 짧으면 안 된다(한 줄 전체가 그보다 짧으면 그 줄 전체).
- 근거마다 `scene_id`는 등록 장면이어야 한다. 대본 파일·스캔 결과·`show`로 본 장면이면 된다.
- 쓰지 않는 필드: `roles`·`unlinked`·`search_requests`(C 전용), `evidence_scenes`·`release_order`(병합기가 붙인다).
- `contradicting_evidence`·`alternatives`·`search_hints`는 없으면 `[]`.
- 대안이 있으면 `alternatives`의 각 항목에 `entity_id`, `name`, `why`, `supporting_evidence`(원문 근거 하나 이상)를 적는다. 근거 형식은 `scene_id`, `line_start`, `line_end`, `quote`이며 `reveals_identity`는 없다.

## 5. 검증

```
node scripts/graph/pass2-b.mjs validate <bundle_id>
```

- 명령을 바꾸지 않고 그대로 실행한다. 실행할 때마다 기록이 남는다.
- `[FAIL]`이면 고친 뒤 다시 실행한다. 최대 3회 다시 시도한다.

| 코드 | 고칠 것 |
|---|---|
| `UNIT_NOT_COVERED` | 빠진 판정 단위. 군중·보류여도 연결로 적는다 |
| `SUBJECT_NOT_IN_BUNDLE`, `SUBJECT_DUPLICATE` | `subject_refs`를 그대로 옮겼는지, 한 참조를 두 연결에 넣지 않았는지 |
| `QUOTE_LOCATION`, `EVIDENCE_SCENE` | 인용이 그 장면 그 줄 범위에 있는지. `show`로 다시 확인한다 |
| `ENTITY_ID_NOT_IN_REGISTRY` | `entity`로 찾은 정식 ID로 고치거나, `entity_id: null`과 `name`으로 적는다 |
| `TARGET`, `VERDICT` | 3.2~3.4의 target·confidence·reveals_identity 규칙 |
| `GROUP_TARGET` | 집단만 좁혀졌으면 정체 후보 있음이 아니라 판단 보류다 |
| `UNIT_MERGE` | 3.5. 단위마다 연결을 따로 만든다 |
| `FORBIDDEN_FIELD`, `FORBIDDEN_CONFIDENCE`, `SCHEMA`, `ENUM`, `EVIDENCE` | 4절 형식 |

- `[WARN] EVIDENCE_ONLY_SUBJECT_LINES`: 정체 후보의 근거가 판정 대상 줄뿐이다. 후보를 가리키는 다른 줄(호칭, 행동, 다른 장면)을 찾는다. 없으면 `판단 보류`로 바꾼다. 그래도 후보로 두면 보고에 이유를 적는다.
- `[WARN] REVEAL_WITHOUT_NAME`: `reveals_identity: true`인 **quote 자체**에 후보의 이름이나 등록 별칭이 없다. 간접 근거라면 false로 고친다. 실제 공개가 다른 줄에 있으면 그 공개 내용을 quote에 정확히 옮기고 줄 범위를 맞춘다. **범위만 넓혀 경고를 피하지 않는다.** 3.2절의 지휘관 선택지 전체 인용은 예외다. 레지스트리에 없는 별칭이라면 보고에 이유를 적는다.
- 검증을 통과하려고 근거를 지어내거나 판정을 바꾸지 않는다.

## 6. 하지 않는 것

- 네 출력 파일 말고는 아무것도 쓰지 않는다. 다른 묶음의 출력도 쓰지 않는다.
- `data/graph/pass1/shards*/`, `data/graph/pass1/repairs/`, `data/graph/pilot/`, `data/graph/pass2/` 아래의 다른 묶음 출력·검토 파일·병합 결과는 읽지 않는다.
- 정답 파일을 찾거나 읽지 않는다.

## 7. 보고

끝나면 아래 형식으로만 보고한다.

```
[완료] <bundle_id>: 단위 N개 → 정체 후보 a / 군중 b / 보류 c (연결 M건)
나눔·합침: <link_id> — 무엇을 왜 (있을 때만)
그대로 둔 경고: <코드> <link_id> — 이유 (있을 때만)
grep: <검색어> — 찾은 것 (쓴 것마다 한 줄)
```

또는

```
[실패] <bundle_id>: 3회 재시도 후 실패, 남은 오류: <코드별 건수>
```
