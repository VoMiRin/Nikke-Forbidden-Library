# GraphRAG Pass 2 A-2(미등록 표기 해소) 판정 규칙

A-2 서브에이전트와 독립 검토자가 읽는 규칙이다. 이 문서가 전부다. `GRAPH_RAG_SPEC.md`·`GRAPH_RAG_PASS2_DRAFT.md`와 `scripts/` 아래 소스는 읽지 않는다.
스키마 버전은 `pass2-0.1.0`이다. 파일럿에서 고친다.

## 1. 할 일

묶음 하나에 **판정 단위**(`units`)가 여럿 있다. 단위 하나는 **표기 하나**다. 예: `방주`, `소피아`, `중앙 정부`.
Pass 1은 이 표기들을 등록 엔티티와 잇지 못했다. 단위마다 그 표기가 무엇을 가리키는지 다음 넷 중 하나로 판정한다.

| link_type | verdict | 뜻 |
|---|---|---|
| `alias` | `별칭` | 등록 인물의 다른 이름이다. target은 등록 ID다 |
| `new_entity` | `새 엔티티` | 특정한 대상(또는 이름 붙은 부류) 하나를 가리키는 이름인데, 등록되어 있지 않다 |
| `generic_term` | `일반 낱말` | 특정 대상을 가리키는 이름이 아니다(보통 낱말, 여러 사람에게 쓰이는 직함·호칭, 일반 역할) |
| `unresolved` | `판단 보류` | 근거가 모자라거나, 둘 이상의 판정이 비슷하게 가능하다 |

- 결과는 **후보**다. 확정은 다음 단계(원문 대조)가 한다. 그래서 `확인된 사실`은 쓰지 않는다.
- 단위마다 **기본 판정** 하나를 반드시 적는다. 같은 표기가 이야기·장면·출현에 따라 다른 대상을 가리키면 **예외 판정**을 더한다(3.6절).
- 단위는 하나도 빠뜨리지 않는다.

## 2. 입력

### 2.1 묶음 파일 `A2__<번호>.json`

- `units[]`: 판정 단위
  - `unit_id`: 출력의 `subject`에 옮길 ID
  - `surface`: 판정할 표기
  - `variant_key`: 공백·기호·대소문자를 지운 열쇠. 같은 열쇠의 단위(예: `중앙 정부`와 `중앙정부`)는 같은 묶음에 있다. **같은 대상인지는 네가 판정한다**
  - `registry_match`: 이 표기와 글자가 같은 등록 이름·별칭이 있으면 그 엔티티. **같은 대상이라는 뜻이 아니다**
  - `pass1_types`: Pass 1이 적은 유형의 수(`location`, `character`, `document_author` 등). **근거가 아니다**
  - `occurrence_total`, `titles[]`: 이 표기가 나온 곳 전부(이야기별 출현 수와 보여 준 수)
  - `sampled`: `true`면 **나온 곳이 많아 일부만 골라 보여 준 단위**다(3.6절)
  - `coverage`: 보여 준 범위. 이야기 수와 보여 준 이야기 수, Pass 1 유형×분류 조합 수와 보여 주지 못한 조합(`combos_not_shown`), 같은 장면 참여자 표시가 붙은 출현 수
  - `shown_occurrences[]`: 보여 준 출현. `occ_id`, `scene_id`, `title_id`, 줄, 항목 ID. `participant_match`가 있으면 **그 장면 참여자 중에 이 표기와 이름이 같은 등록 인물이 있다**는 뜻이다. 그 언급이 그 인물이라는 보장은 아니다
- `sample_max`: 골라 보여 주는 상한(40곳)

### 2.2 발췌 파일 `A2__<번호>.excerpts.txt`

단위마다 `### U001 「표기」` 아래에 보여 준 출현의 원문이 있다. 장면마다 `@@@ <scene_id> | <title_id> | <부제> | <출현 ID: 항목>` 아래 `[L0001] 원문` 형식이다. 출현 줄 앞뒤 2줄을 붙였다. 줄 번호는 장면마다 1부터 센다.

- `(작성자 항목: …)`은 기록물 작성자 이름으로 나온 출현이다. 그 장면의 기록물을 누가 썼는지가 판정 대상이다.
- 메신저·선택지에서는 항목 줄이 태그 줄(`[MSG SENDER=…]`)을 가리키고 표기가 바로 다음 줄에 있을 수 있다. 앞뒤 줄을 함께 본다.

### 2.3 명령

```
node scripts/graph/pass2-a2.mjs occ <bundle_id> <unit_id> [--title=<title_id>] [--offset=N] [--limit=N] --run=<run>       # 단위의 출현 전부(보여 주지 않은 출현 포함)의 위치와 줄
node scripts/graph/pass2-a2.mjs show <scene_id> [시작줄 끝줄]                                                               # 등록 장면 원문
node scripts/graph/pass2-a2.mjs grep <낱말> --bundle=<bundle_id> --unit=<unit_id> [--title=<title_id>] [--offset=N] --run=<run>   # 등록 원문 검색(기록이 남는다)
node scripts/graph/pass2-a2.mjs entity <이름>                                                                               # 레지스트리에서 entity_id 찾기
```

- 발췌가 짧아 판단이 어려우면 `show`로 그 장면을 더 읽는다.
- 보여 주지 않은 출현은 `occ`로 위치(`[미제시]`)를 보고 `show`로 읽는다. `--title`로 이야기 하나만 볼 수 있다.
- `grep`은 한 번에 30줄씩 보여 준다. 잘리면 출력의 `이어 보기: --offset=N`대로 이어 본다. 한 글자 검색어(`퀸`, `신`)는 `--title`로 이야기를 정할 때만 쓸 수 있다. 횟수 제한은 3.8절이다.

## 3. 판정 기준

### 3.1 근거

- `supporting_evidence`·`contradicting_evidence`에는 **원문 줄만** 적는다. 사전 지식, 게임 밖 정보, Pass 1의 유형·요약은 근거가 아니다.
- 사전 지식으로 떠올린 것은 `search_hints`에 적는다(예: "인물 A의 별명으로 알고 있음. grep으로 확인한 <scene_id> L<줄>").
- 원문 근거 없이 사전 지식에만 기댄 판정은 `unresolved`다.
- 반대되는 원문(다른 대상으로 보이게 하는 줄)이 있으면 `contradicting_evidence`에 적는다. 숨기지 않는다.

### 3.2 판정 순서

출현(또는 같은 대상으로 보이는 출현 묶음)마다 다음 순서로 묻는다.

1. **특정 대상을 가리키는가?** 이 표기가 그 자리에서 특정 인물·집단·장소·물건·개념·사건 하나, 또는 이름 붙은 종족·부류 하나를 가리키는가. 아니면 `generic_term`(3.5절).
2. **그 대상이 등록 인물인가?** `entity`로 찾고, 같은 대상이라는 원문 근거가 있으면 `alias`(3.3절).
3. **아니면 `new_entity`**이고, 유형을 정한다(3.4절).
4. 둘 이상의 답이 원문으로 비슷하게 뒷받침되면(예: 고유 이름과 보통 낱말, 등록 인물과 다른 인물) 단정하지 않고 `unresolved`로 두고, 나머지를 `target`·`alternatives`에 적는다(3.6절).

경계 사례:
- **직함·호칭**(`사장님`, `원장`): 여러 이야기에서 여러 사람에게 쓰이면 `generic_term`. 어떤 이야기에서 그 직함이 특정 한 사람을 가리키면 그 이야기만 예외로 나눈다. 그 사람이 등록 인물이면 `alias`, 등록되지 않았고 다른 이름이 없으면 `new_entity`(`name`은 그 직함, `qualifier`에 이야기·역할)다.
- **종족·부류**(`랩쳐`, `니케`): 세계관에서 여럿을 묶어 부르는 고유한 이름이면 `new_entity`, `entity_type: "faction_or_species"`다. 보통 낱말(`사람`, `병사`)은 `generic_term`이다.
- **가린 표기**(`XX 중학교`, `■휘■`): 원문 문맥으로 가린 대상이 드러나면 그 대상으로 판정한다. 드러나지 않지만 특정 대상 하나를 가리키면 표기 그대로 `new_entity`다. 무엇을 가리키는지 모르면 `unresolved`다.
- **작중 작품**(영화·오페라·책·게임) 속 인물·장소도 고유한 이름이면 `new_entity`다. `qualifier`에 작품을 적는다.

### 3.3 별칭 (`alias`)

- 이 표기가 **등록 인물 하나**를 가리킨다는 원문 근거가 있을 때다. 예: 같은 장면에서 그 인물이 그 이름으로 불리고 대답함, 같은 인물이 그 이름을 자기 이름으로 밝힘, 지문이 두 이름을 같은 인물로 서술함.
- target은 `entity`로 찾은 등록 ID 하나다. `entity_type`은 `character`다(레지스트리는 인물만 담는다).
- `registry_match`나 `participant_match`가 있어도 같은 대상인지 원문으로 확인한다. 같은 장면에 그 인물이 있어도, 그 언급이 다른 대상(같은 이름의 장소·종족, 다른 시대의 인물)일 수 있다.
- `confidence`: 두 이름이 같은 인물이라는 연결을 원문이 거의 직접 보여 주면 `유력한 해석`, 간접 단서(같은 소속·사건·말투)가 여럿 맞으면 `가능성`.

### 3.4 새 엔티티 (`new_entity`)

- target은 `{"ref": "entity", "entity_id": null, "name": "대표 이름", "entity_type": "...", "entity_key": "E1"}`이다. ID는 병합기가 붙인다. 네가 만들지 않는다.
- **`entity_key`**: 이 묶음 안에서 대상을 구별하는 표시다. `"E1"`, `"E2"` …로 쓴다.
  - **같은 대상이면 같은 `entity_key`**다. 같은 대상의 다른 표기 단위(예: `중앙 정부`와 `중앙정부`), 같은 단위의 기본 판정과 예외가 같은 대상일 때가 그렇다. 같은 `entity_key`는 `name`·`entity_type`·`qualifier`가 모두 같아야 한다.
  - **다른 대상이면 다른 `entity_key`**다. 이름·유형이 같은 다른 대상(동명이인)은 `qualifier`로 구별해야 한다.
  - 병합기는 같은 묶음의 같은 `entity_key`만 한 엔티티로 합친다. 다른 묶음의 같은 이름은 합치지 않고 검토 목록에 올린다.
- `name`은 원문에 나온 가장 온전한 표기다.
- **`qualifier`**: 짧은 구별 설명(예: `"2호 쉘터 관리자"`). 같은 이름의 다른 대상을 나눌 때는 반드시 적는다. 구별이 필요 없으면 쓰지 않는다.
- `entity_type`:

| 값 | 쓰는 곳 |
|---|---|
| `character` | 개인 |
| `squad` | 스쿼드(부대 단위 팀) |
| `organization` | 회사·기관·단체·세력처럼 구성원이 있는 이름 붙은 집단 |
| `faction_or_species` | 종족·부류·등급처럼 여럿을 묶어 부르는 이름(이름 붙은 개별 집단이 아님) |
| `location` | 장소·시설·지역 |
| `item` | 물건·무기·함선·탈것·제품 |
| `concept` | 개념·현상·기술·작전명 |
| `event` | 사건·전투·행사 |

- 정해진 구성원이 있는 이름 붙은 집단은 `organization`이나 `squad`다. 그 집단의 구성원이 누구인지는 A-2에서 잇지 않는다.
- `confidence`: 고유한 이름이고 같은 대상임이 분명하면 `유력한 해석`, 여러 출현이 같은 대상이라는 근거가 간접적이면 `가능성`. 고유 이름인지 보통 낱말인지 양쪽 근거가 비슷하면 `unresolved`다(3.2절 4번).

### 3.5 일반 낱말 (`generic_term`)

- 특정 대상을 가리키는 이름이 아닐 때다. 보통 낱말(`병원`, `오므라이스`), 여러 사람에게 쓰이는 직함·호칭, 일반 역할, 수식어가 붙은 보통 표현.
- `target: []`. `alternatives`는 특정 대상 후보가 있을 때만 적는다.
- `confidence`: 분명하면 `유력한 해석`, 간접 근거면 `가능성`.

### 3.6 기본 판정과 예외 (`scope`)

- 연결마다 `scope`를 적는다.
  - 기본 판정: `"scope": {"default": true}`. 단위마다 **정확히 하나**다. 예외에 들지 않은 **모든 출현**(보여 주지 않은 출현 포함)에 적용된다.
  - 예외 판정: `"scope": {"title_ids": [...], "scene_ids": [...], "occ_ids": [...]}`(하나 이상). 적은 이야기·장면·출현의 **합집합**에 적용된다.
  - 우선순위: 출현 예외 > 장면 예외 > 이야기 예외 > 기본.
  - `occ_ids`는 같은 장면 안에서 출현마다 대상이 다를 때(예: 작성자 이름과 본문 속 동명이인, 한 장면에서 같은 이름이 장소와 조직을 각각 가리킴) 쓴다. 출현 ID는 발췌 머리말과 `occ`에 있다.
- 이야기·장면·출현 하나는 한 단위의 예외 **하나에만** 넣는다. 그 표기가 나오지 않는 곳은 넣지 않는다.
- **예외로 적은 이야기·장면·출현마다** 그 안의 원문 근거가 하나 이상 있어야 한다. 확인하지 않은 곳을 짐작으로 예외에 넣지 않는다.
- **기본 판정의 근거**는 기본 판정이 실제로 적용되는 출현(예외 밖)의 줄이나 그 앞뒤 2줄이어야 한다.
- **판정은 같고 확신도만 다르면 예외로 나누지 않는다.** 보여 준 곳과 못 본 곳의 구분은 병합기가 기록한다.
- **대상이 섞였을 때의 기본 판정:**
  - 보여 준 출현에 서로 다른 대상이 섞였고, 못 본 출현이 어느 쪽인지 가를 근거(이야기·분류·문맥)가 없으면, **기본 판정은 `unresolved`**로 두고 확인한 대상들을 각각 예외로 적는다.
  - 못 본 출현도 대부분 한쪽이라는 근거(예: 확인한 이야기 밖 출현이 모두 같은 용례)가 있으면 그쪽을 기본으로 둔다. 그 근거를 `rationale`에 적는다.
- **골라 보여 준 단위(`sampled: true`)**: 너는 일부만 본다. 기본 판정은 못 본 출현에도 적용된다.
  - `titles[]`에서 `shown`이 0인 이야기, `coverage.combos_not_shown`의 조합이 다른 대상일 것 같으면 `occ`·`show`로 확인하고, 다르면 예외로 나눈다.
  - 보여 준 이야기 안에도 못 본 출현이 있다. 이야기 하나에서 쓰임이 갈릴 것 같으면 그 이야기의 `occ`를 본다.

### 3.7 동명이인과 시점

- 같은 이름이 다른 이야기에서 다른 인물·대상을 가리킬 수 있다. 같은 소속·사건·관계가 원문으로 이어질 때만 같은 대상으로 본다.
- 등록 인물과 이름이 같아도 다른 대상이면 별칭으로 잇지 않는다. `new_entity`로 적고 `qualifier`로 구별하거나, 일반 낱말이면 일반 낱말로 적는다. `rationale`에 다르다고 본 원문 근거를 적는다.
- 회상·꿈·가정 장면의 이름은 그 장면의 시점에서 판단한다. 다른 시대의 같은 직함을 지금 인물로 잇지 않는다.

### 3.8 검색 예산

- 판정 단위 하나에 **서로 다른 `grep` 검색어를 3개까지** 쓴다. 같은 검색어를 `--title`만 바꿔 쓰는 것도 하나로 센다. 잘린 결과를 `--offset`으로 이어 보는 것은 세지 않는다. `--unit`에는 그 단위 ID를 적는다.
- 같은 검색어를 같은 `--title`·`--offset`으로 다시 실행하지 않는다.
- `occ`와 `show`는 세지 않는다. 판정에 필요한 만큼만 읽는다.
- 예산을 다 써서 멈춘 보류는 `rationale`을 `[검색 예산 소진]`으로 시작한다.

## 4. 출력

`<plan의 output 경로>`(예: `data/graph/pass2/a2-pilot/shards/A2__001.json`)에 JSON으로 쓴다. 아래 예시의 ID와 대사는 형식을 보이기 위해 지어낸 것이다.

```json
{
  "schema_version": "pass2-0.1.0",
  "bundle_id": "A2__001",
  "candidate_links": [
    {
      "link_id": "A2__001__001",
      "link_type": "new_entity",
      "subject": [{ "ref": "unit", "unit_id": "U001" }],
      "scope": { "default": true },
      "target": [{ "ref": "entity", "entity_id": null, "name": "예시 쉼터", "entity_type": "location", "entity_key": "E1" }],
      "verdict": "새 엔티티",
      "confidence": "유력한 해석",
      "rationale": "여러 이야기에서 같은 시설을 가리키는 고유한 이름이다.",
      "supporting_evidence": [
        { "scene_id": "example_03", "line_start": 12, "line_end": 12, "quote": "인물 A: 예시 쉼터로 돌아가자." }
      ],
      "contradicting_evidence": [],
      "alternatives": [],
      "search_hints": []
    },
    {
      "link_id": "A2__001__002",
      "link_type": "generic_term",
      "subject": [{ "ref": "unit", "unit_id": "U001" }],
      "scope": { "title_ids": ["event_stories__example"] },
      "target": [],
      "verdict": "일반 낱말",
      "confidence": "가능성",
      "rationale": "이 이야기에서는 특정 시설이 아니라 쉴 곳 일반을 말한다.",
      "supporting_evidence": [
        { "scene_id": "example_event_02", "line_start": 5, "line_end": 5, "quote": "인물 B: 어디든 예시 쉼터 같은 데 없을까?" }
      ],
      "contradicting_evidence": [],
      "alternatives": [],
      "search_hints": []
    }
  ]
}
```

- `link_id`: `<bundle_id>__001`부터 순서대로.
- `subject`: 단위 하나 `[{"ref": "unit", "unit_id": "U001"}]`. 한 연결에 단위 둘을 넣지 않는다. 같은 대상의 변형 표기도 단위마다 연결을 따로 만들고 같은 `entity_key`를 쓴다.
- `target`: `alias`·`new_entity`는 정확히 하나, `generic_term`은 `[]`, `unresolved`는 하나까지. 필드는 `ref`, `entity_id`, `name`, `entity_type`, 그리고 미등록 대상이면 `entity_key`(`new_entity`는 필수), 필요하면 `qualifier`.
- `quote`: 원문을 그대로 복사한다. 화자 라벨은 붙여도 떼도 된다. 범위(`line_start`~`line_end`) 안에 있어야 하고 4글자보다 짧으면 안 된다(한 줄 전체가 그보다 짧으면 그 줄 전체).
- 근거마다 `scene_id`는 등록 장면이어야 한다. 근거에는 `scene_id`, `line_start`, `line_end`, `quote`만 적는다.
- `alternatives`의 각 항목: `link_type`(`alias`·`new_entity`·`generic_term`), `entity_id`, `name`, `entity_type`, `qualifier`(필요할 때), `why`, `supporting_evidence`(원문 근거 하나 이상). `generic_term` 대안은 `link_type`·`why`·`supporting_evidence`만 적는다.
- 쓰지 않는 필드: `reveals_identity`(B 전용), `roles`·`unlinked`·`search_requests`(C 전용), `evidence_scenes`·`release_order`·`assigned_entity_id`(병합기가 붙인다).
- `contradicting_evidence`·`alternatives`·`search_hints`는 없으면 `[]`.

## 5. 검증

```
node scripts/graph/pass2-a2.mjs validate <bundle_id> --run=<run>
```

- plan의 `validate` 명령을 그대로 실행한다. 실행할 때마다 기록이 남는다.
- `[FAIL]`이면 고친 뒤 다시 실행한다. 최대 3회 다시 시도한다.

| 코드 | 고칠 것 |
|---|---|
| `UNIT_NOT_COVERED` | 기본 판정(`{"default": true}`)이 없는 단위 |
| `SCOPE` | 기본 판정이 둘 이상, 표기가 나오지 않는 이야기·장면·출현, 같은 곳을 두 예외에 넣음 |
| `EVIDENCE_OUT_OF_SCOPE` | 예외로 적은 이야기·장면·출현 중 근거가 없는 곳 |
| `DEFAULT_EVIDENCE_NOT_APPLIED` | 기본 판정의 근거가 예외에 덮인 곳뿐이다. 기본이 적용되는 출현의 근거를 찾고, 없으면 기본을 `unresolved`로(3.6절) |
| `ENTITY_KEY` | `new_entity`의 `entity_key` 누락, 같은 키에 다른 이름·유형·qualifier, 다른 키에 같은 이름·유형·qualifier |
| `SUBJECT_NOT_IN_BUNDLE`, `REFERENCE` | `subject`는 묶음의 `unit_id` 하나 |
| `ALIAS_TARGET`, `NEW_ENTITY_ID`, `ENTITY_ID_NOT_IN_REGISTRY` | 별칭은 `entity`로 찾은 등록 ID와 `character`, 새 엔티티는 `entity_id: null` |
| `TARGET`, `VERDICT` | 3.3~3.6절과 4절의 target·verdict·confidence 조합 |
| `QUOTE_LOCATION`, `EVIDENCE_SCENE` | 인용이 그 장면 그 줄 범위에 있는지. `show`로 다시 확인한다 |
| `FORBIDDEN_FIELD`, `FORBIDDEN_CONFIDENCE`, `SCHEMA`, `ENUM`, `EVIDENCE` | 4절 형식 |

- `[WARN] NEW_ENTITY_SAME_AS_REGISTRY`: 새 엔티티 이름이 `registry_match`의 등록 이름과 같다. 같은 대상이면 `alias`로 고친다. 다른 대상이면 `qualifier`로 구별하고 `rationale`에 다른 이유를 적는다.
- `[WARN] DEFAULT_NOT_APPLIED`: 출현이 모두 예외에 들어 기본 판정이 적용되는 곳이 없다. 가장 넓은 범위의 판정을 기본으로 바꾸는 것을 검토한다.
- `[WARN] DEFAULT_EVIDENCE_NOT_APPLIED`(기본이 보류일 때): 보류 근거로 기본이 적용되는 출현 줄을 하나 넣을 수 있으면 넣는다.
- 검증을 통과하려고 근거를 지어내거나 판정을 바꾸지 않는다.

## 6. 하지 않는 것

- 네 출력 파일 말고는 아무것도 쓰지 않는다. 다른 묶음의 출력도 쓰지 않는다.
- `data/graph/pass1/shards*/`, `data/graph/pass1/repairs/`, `data/graph/pilot/`, `data/graph/pass2/` 아래의 다른 묶음 출력·검토 파일·병합 결과는 읽지 않는다. 네 묶음 파일·발췌 파일은 읽는다(출현 파일은 `occ`로 본다).
- 정답 파일을 찾거나 읽지 않는다.

## 7. 보고

끝나면 아래 형식으로만 보고한다.

```
[완료] <bundle_id>: 단위 N개 → 기본 판정 별칭 a / 새 엔티티 b / 일반 낱말 c / 보류 d (연결 M건, 예외 E건)
예외: <unit_id> 「표기」 — 무엇을 왜 나눴는지 (있을 때만)
골라 보여 준 단위 확인: <unit_id> 「표기」 — occ·show로 더 확인한 이야기·장면 (있을 때만)
그대로 둔 경고: <코드> <link_id> — 이유 (있을 때만)
grep: <unit_id> <검색어> [--title] — 찾은 것 (쓴 것마다 한 줄)
```

또는

```
[실패] <bundle_id>: 3회 재시도 후 실패, 남은 오류: <코드별 건수>
```
