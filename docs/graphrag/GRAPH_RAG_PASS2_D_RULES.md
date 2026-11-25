# GraphRAG Pass 2 D(여러 장면 관계 정리) 판정 규칙

D 판정자는 이 규칙만 읽고 묶음 하나를 판정한다. 명세·설계·감독관 지시서·`scripts/` 소스·다른 묶음의 출력·감사 파일은 읽지 않는다.

## 1. 할 일

- 묶음의 **단위**는 엔티티 쌍 `{A, B}` 하나다. 단위마다 그 쌍의 Pass 1 **관계 메모**(`relationship_and_lore_notes`)가 모두 딸려 있다.
- 메모를 원문으로 읽고 두 대상의 관계를 **관계 기록**(`candidate_links`)으로 정리한다.
  - 기록마다 관계 종류, 사실인지 주장인지, 맥락, 작중 순서, 앞 기록과 이어지는지를 적는다.
  - 같은 상태를 되풀이하는 메모는 한 기록에 함께 묶는다.
- 관계가 아닌 메모는 `excluded_memos`로 뺀다.
- **메모를 하나도 빠뜨리지 않는다.** 모든 메모는 어떤 기록의 `memo_ids`나 `excluded_memos` 중 한쪽에 들어간다. 양쪽에 동시에 넣지 않는다.
- 메모의 끝(표기)이 엉뚱한 대상에 붙었으면 `endpoint_overrides`로 고친다(3.7절).
- 이름이 달라 따로 남은 같은 대상을 발견하면 `merge_suggestions`에 적는다(3.11절).

## 2. 입력

### 2.1 묶음 파일 `D1__<번호>.json`

- `units[]`: 단위(쌍)
  - `unit_id`
  - `node_a`·`node_b`: 쌍의 두 끝. `key`와 참조 `ref`가 있다.
    - `entity:<ID>`: 등록 인물·공식 엔티티
    - `term:<키>`: 공식 표기 묶음(장소·아이템·개념·사건·종족)
    - `gen:<표기>`: 그 장면 A-2 판정이 일반 낱말
    - `unres:<이야기>:<표기>`: 기계로 붙이지 못한 표기. 그 이야기 안에서만 같은 표기끼리 모인다.
    - 두 끝이 같은 노드면(예: 한 인물의 두 이름) 그 쌍은 한 대상 안의 관계(별칭 유래·작명 등)다.
  - `address_summary`: 두 대상 사이에 자주 쓴 호칭. **근거가 아니다.**
  - `prior_pass2_context`: 같은 장면의 앞 단계(B 정체 후보, C 단서↔공개) 판정 요약. **근거가 아니다.**
  - `ambiguous_endpoints`: 기계 대응이 불확실한 끝. `resolved_by`가 `title_unique`·`b_candidate`·`generic_term`·`unresolved`이거나 다른 후보(`candidates`)가 있는 메모다. 원문으로 확인한다(3.7절).
- `memos[]`: 메모. 한 줄에 하나다. 적지 않은 칸은 기본값이다.
  - 기본값: `refers_to_past: false`, `chronology_type: "present"`, `in_branch_option: null`, `claimant: null`, `history_order: null`, 끝 해소 방법 `participants`
  - 칸: `item_id`, `unit_id`, `scene_id`, `subject`·`target`(원문 표기), `subject_node`·`target_node`(기계가 붙인 노드), `relation_or_change`(Pass 1 요약, **근거 아님**), `epistemic_type`, `claimant`, `claim_line`, `line_start`·`line_end`, `refers_to_past`, `chronology_type`, `in_branch_option`(`choice_line`·`option_text`), `history_order`(공식 연표 번호. 없으면 연표에 없는 장면)
- `base_increment`: 이 묶음을 만들 때 반영된 마지막 대본 증분. 판정과는 상관없다.

### 2.2 발췌 파일 `D1__<번호>.excerpts.txt`

단위마다 `## <unit_id> <A> ↔ <B> (메모 n)` 머리 아래에 장면별 원문이 있다. 메모 범위 앞뒤 2줄을 넓혀 합친 것이다. 줄 앞의 `[L0012]`가 줄 번호다. 발췌 밖 원문은 `show`로 본다.

### 2.3 명령

```sh
node scripts/graph/pass2-d.mjs cand <bundle_id> [<unit_id>] --run=<run>      # 단위·메모 요약, 호칭·앞 단계 요약, 끝점 확인 목록
node scripts/graph/pass2-d.mjs show <scene_id> [시작 끝] --run=<run>          # 원문. 머리말에 이야기 안 순번·연표 번호·병렬 루트·다음 경로
node scripts/graph/pass2-d.mjs entity <이름> --run=<run>                      # 등록 인물·공식 엔티티·표기 묶음 조회(합쳐진 ID 표시)
node scripts/graph/pass2-d.mjs grep <낱말> --bundle=<id> --unit=<unit_id> [--title=<title_id>[,…]] [--offset=N] --run=<run>
node scripts/graph/pass2-d.mjs append-shard <bundle_id> --from=<부분 파일> --run=<run>   # 출력이 길 때 나눠 덧붙이기(4절)
node scripts/graph/pass2-d.mjs validate <bundle_id> --run=<run>
```

`cand`·`show`·`entity`는 검색 예산에 들지 않는다. `grep`만 든다(3.12절).

## 3. 판정 기준

### 3.1 근거

- 근거는 **원문 줄**뿐이다. `supporting_evidence`·`contradicting_evidence`·`anchor.evidence`에는 원문을 그대로 인용한다.
- 다음은 근거가 아니다.
  - Pass 1 요약(`relation_or_change`)
  - 호칭 요약, 앞 단계 맥락, 기계가 붙인 노드
  - 연표 태그
  - 사전 지식. 사전 지식은 `search_hints`에만 적는다.
- 관계는 그 메모의 장면 원문으로 판단한다. 다른 장면은 순서·반박·성립 시점을 확인할 때 쓴다.

### 3.2 관계 기록 만들기

- 기록 하나는 **한 방향(또는 쌍방)의 한 관계 상태**다. `subject`가 `target`에 대해 갖는 관계다.
  - 두 사람이 서로 같은 관계(동료, 연인, 적)를 확인했으면 `bidirectional: true`로 한 기록에 적는다.
  - 한쪽만의 감정·평가·선언이면 `false`로 둔다.
- `subject`·`target`은 쌍의 두 끝(보정했으면 보정 뒤 끝)과 같은 대상이어야 한다.
  - 참조는 묶음의 `node_a.ref`·`node_b.ref`를 그대로 옮긴다.
  - 표기 노드(`gen:`·`unres:`)는 `{"ref": "surface", "name": "<원문 표기>", "entity_type": null}`로 적는다.
- **같은 상태가 여러 장면에서 되풀이되면 한 기록의 `memo_ids`에 모두 넣는다.** 예: 지휘관을 지키겠다는 다짐이 여러 이야기에 나옴.
  - 상태가 바뀌거나 맥락·주장 화자가 다르면 기록을 나눈다.
  - 다른 장면의 반복 메모를 중복 사유로 빼지 않는다(3.9절).
- 한 메모가 두 관계를 함께 말하면(예: 상관이면서 신뢰한다) 같은 메모를 두 기록의 `memo_ids`에 넣어도 된다.
- 기록마다 귀속 메모 장면의 원문 인용이 하나 이상 있어야 한다.

### 3.3 관계 종류 (`relation_type`)

| 값 | 뜻 |
|---|---|
| `affiliation` | 스쿼드·조직·세력·종족 소속, 가입·탈퇴·제명 |
| `command_or_hierarchy` | 지휘·명령권, 상관·부하, 관리·감독 |
| `status_or_rank` | 칭호·등급·직위·자격(서술어로 쓰인 등급 포함) |
| `kinship_or_creation` | 혈연·가족·입양, 제작자·창조물, 스승·제자 |
| `origin_or_transformation` | 융합·흡수·코어 계승·변이·분화 전후의 **서로 다른 두 개체** 관계 |
| `identity_or_naming` | 이름 지어 주기·개명·특별 호칭 합의, 한 대상 안 별칭의 유래 |
| `affinity_or_trust` | 우호·신뢰·애정·보호·동맹·협력 |
| `conflict_or_hostility` | 적대·교전·갈등·불신·배신·처벌·감시 |
| `lore_or_management` | 장소·시설·함선·아이템의 관할·소유·거주·운용·설정 |

여러 종류에 걸치면 가장 직접 드러난 것 하나를 고르고, 필요하면 기록을 나눈다. 세부는 `rationale`에 적는다.

### 3.4 사실과 주장, 선언과 성립 (`epistemic_status`, `claimants`)

- `established`: 지문·연출·절차·상호 수락·일방 결별 행위로 작중에서 성립이 확인된 관계다. `claimants`는 빈 배열이다.
- `claimed`: 대사로 말한 관계다. 진술·회고·소문·제3자 평가, 그리고 **상대가 받아들였는지 확인되지 않은 일방 선언**이 여기에 든다.
  - `claimants`에 말한 화자를 적는다. 참조는 묶음 노드나 `entity`로 찾은 ID를 쓰고, 없으면 `surface`로 적는다.
- **제3자의 말은 그 제3자의 주장이다.** 당사자의 확립된 관계나 다른 화자의 주장과 한 기록에 합치지 않는다.
  - 지어낸 예: 친구가 "둘이 사귀지?"라고 놀렸고 당사자는 부인했다. 이 경우 친구의 주장 기록과 당사자의 부정 기록(`contradicts`)이 따로 생긴다.
- 지어낸 예: A "오늘부터 우리는 동맹이다", B "동의한 적 없어". A의 선언은 `claimed`(화자 A)다. 동맹은 성립하지 않았다.

### 3.5 맥락 (`context_scope`)과 배타 갈래

- `canon`: 정사 맥락의 실제 관계다(본편·이벤트·에피소드 등).
- `branch`: 선택지 한 갈래나 병렬 루트 한쪽에서만 성립하는 관계다.
- `roleplay_or_sim`: 상황극·연극·시뮬레이션 배역으로 연기한 임시 관계다. 예: 학생과 선생 역할극.
  - 시뮬레이션 속 인물이 실제 인물을 본뜬 것이면 그 인물 자체는 실제 대상이다. 배역 안 관계만 이 맥락으로 둔다.
- `dream_or_hypothetical`: 꿈·환상·상상·가정 속 관계다.
- **서로 배타적인 갈래는 섞지 않는다.** 다음 두 경우가 배타적이다.
  - 같은 장면·같은 선택지(`in_branch_option.choice_line`)의 서로 다른 옵션에서 나온 메모들
  - 한 번의 진행 경로에서 함께 지나갈 수 없는 장면들(`show` 머리말의 병렬 루트·다음 경로로 확인한다)
  - 배타 갈래의 메모는 한 기록에 함께 넣지 않는다. `prev_link_ids`로도 잇지 않는다.
  - 각 갈래는 따로 `initial`이나 `standalone`으로 둔다.
  - 갈래가 다시 합쳐진 뒤의 공통 상태는 갈래 밖(분기 전·합류 뒤) 메모로 잇는다.
- 같은 경로에서 연달아 지나갈 수 있는 장면은 배타가 아니다. 병렬로 표시돼 있어도 한쪽에서 다른 쪽으로 가는 경로가 있으면 이어도 된다.

### 3.6 작중 순서와 전환

- **공개 날짜·장면 공개 순서로 관계의 앞뒤를 정하지 않는다.** 나중에 공개된 이야기가 작중으로는 앞일 수 있다.
- `order_basis`: 이 기록을 앞 기록(`prev_link_ids`) 뒤에 놓은 근거다.
  - `script`: 원문의 시간 표현·사건 언급·호칭 변화, 또는 **선형으로 이어지는 같은 이야기 안의 장면 진행**이다. 병렬 루트, 수집형 기록(유실물 슬롯 번호), 회상 구간은 장면 번호만으로 앞뒤를 정하지 않는다.
  - `official_timeline`: 공식 연표 번호(`history_order`)가 서로 다르고 앞 기록이 더 앞이다. **번호가 같으면(같은 연표 단위) `official_timeline`으로 잇지 않는다.** 같은 이야기 안이면 `script`를 쓴다.
  - `unknown`: 여러 기록이 있으나 원문·연표 어느 쪽으로도 앞뒤를 알 수 없다.
  - `not_applicable`: 앞 기록이 없다(`initial`, 홀로인 `standalone`).
- `progression`
  - `initial`: 그 맥락에서 처음 확인된 상태다(`prev_link_ids: []`).
  - `continues`: 앞 기록과 같은 방향의 상태가 유지되거나 깊어진다.
  - `changes_from`: 다른 상태로 실제로 바뀌었다. `order_basis`는 `script`나 `official_timeline`만 쓴다.
  - `contradicts`: 앞 주장·상태와 내용이 부딪힌다. 예: 본인 부정, 오해 반박, 원문과 연표의 어긋남.
  - `reinterprets`: 정체·진상이 드러나 앞 관계의 실제 대상·뜻이 다시 읽힌다. 가명·변장 상태로 맺은 앞 관계는 덮어쓰지 않는다. 앞 시점 상태를 그대로 두고 이 기록으로 잇는다. 태도까지 바뀌었으면 `changes_from`이다.
  - `standalone`: 다른 기록과 앞뒤 근거가 없거나 비정사·배타 갈래라 사슬 밖에 둔다(`prev_link_ids: []`).
  - `prev_link_ids`는 **같은 단위 안** 기록만 가리킨다. 순환을 만들지 않는다.
- **회고·회상(`temporal_anchor`, `anchor`)**
  - `scene_present`: 근거 장면의 진행 시점에 성립·유지되는 상태다.
  - `past_before_scene`: 근거 장면에서 그보다 앞선 과거의 관계를 말한 것이다.
  - 과거를 말하는 기록은 다음 셋 중 하나다: `past_before_scene`, `refers_to_past: true`인 메모가 있는 기록, `flashback` 메모가 있는 기록.
    - 이런 기록을 순서에 쓰려면 **관계가 실제로 성립한 시점**을 `anchor`로 적는다. 순서에 쓴다는 것은 스스로 `script`·`official_timeline`을 쓰거나, 다른 기록이 이 기록 뒤에 `script`·`official_timeline`·`changes_from`으로 잇는 경우다.
    - `{"kind": "timeline", "scene_id": "<그 일이 일어난 장면>", "evidence": [인용]}`: 연표 비교는 이 장면의 연표 위치로 한다.
    - `{"kind": "script", "evidence": [인용]}`: 원문이 직접 앞뒤를 말하는 경우다.
  - **말한 장면의 위치를 그 일의 위치로 쓰지 않는다.** `anchor` 장면은 말한 장면보다 앞이어야 한다. 같은 연표 단위 안이면 같은 이야기의 장면 순서로 앞이어야 한다.
  - 성립 시점을 특정할 수 없으면 `anchor` 없이 "말한 장면 이전"까지만 둔다. 그 기록은 `order_basis: unknown`이고, `changes_from`의 앞뒤로 쓰지 않는다.
- 원문 근거와 공식 연표가 어긋나면 한쪽을 버리지 않는다. 둘 다 적고 `contradicting_evidence`에 남긴다.

### 3.7 끝점 확인과 보정 (`endpoint_overrides`)

- 기계는 각 메모의 `subject`·`target` 표기를 그 장면 참여자·A-2 판정·정체 후보·같은 이야기 유일 표기로 대상에 붙였다.
- `ambiguous_endpoints`와, 이름이 직책·일반 낱말인 끝은 원문으로 확인한다. 예: 다른 시대의 지휘관, 같은 이름의 다른 인물, 장소 이름과 조직 이름.
- 원문이 가리키는 실제 대상이 다르면 보정을 적는다.
  - `memo_ids`: 고친 메모(하나 이상, 이 단위의 메모)
  - `side`: 그 메모 **원래의** `subject`/`target` 칸 중 고친 쪽(쌍의 A/B가 아니다)
  - `from`: 기계가 붙인 원래 끝의 참조(묶음 노드 `ref` 그대로)
  - `to`: 바로잡은 대상
  - `confidence`, `rationale`, `supporting_evidence`
- 보정한 메모의 기록은 보정 뒤 쌍으로 적는다. 보정 뒤 쌍이 이 묶음의 다른 단위와 같아지면 검증기가 경고한다. 두 단위의 기록이 서로 맞는지 확인한다.
- 실제 관계 대상이 따로 없이 비유·관용구를 끝으로 잘못 잡은 메모는 보정하지 않는다. `excluded_memos`(`끝점 오추출`)로 뺀다.

### 3.8 경계 사례

- **집단과 구성원:** 인물↔조직·스쿼드의 소속은 `affiliation`이다. 집단과 구성원을 같은 대상으로 합치지 않는다.
- **칭호·등급·지위:** "X가 Y 등급이다"처럼 서술어로 쓰인 칭호·등급은 `status_or_rank`로 기록한다. 그 칭호를 이름으로 가진 다른 개체와 합치지 않는다.
- **융합·흡수·계승·변이:** 서로 다른 두 개체가 하나로 합쳐지거나 한쪽의 힘·코어를 이어받았으면 두 개체 사이의 `origin_or_transformation`이다. 합치자고 제안하지 않는다.
  - 현실에 따로 남은 옛 몸체·복제 바디·분신도 별개 개체다.
- **같은 개인의 변화:** 인간에서 니케가 된 같은 개인, 변이 뒤 돌아온 같은 개인, 기억을 잃은 같은 개인은 **같은 대상**이다.
  - 쌍의 두 끝이 같은 노드면 그 사람 안의 변화(이름이 바뀐 경위 등)를 기록한다.
  - 다른 노드로 남아 있으면 `merge_suggestions`로 올린다.
- **시뮬레이션 속 인물:** 실제 인물을 본뜬 것이면 실제 대상이다. 다른 노드로 남아 있으면 `merge_suggestions`로 올린다. 작중 허구의 극중극 인물은 이 경우가 아니다.
- **이름 없는 부류 개체:** "양산형 니케 1기"처럼 이름 없는 부류 개체는 부류로 둔다. 화자명으로 이어 쓰여 특정 개인임이 확인될 때만 개인이다.
- **과거·다른 소속의 직책:** "지휘관" 같은 직책 표기가 주인공이 아닌 과거·다른 소속 인물을 가리키면 끝점을 확인하고 필요하면 보정한다(3.7절).

### 3.9 관계가 아닌 메모 (`excluded_memos`)

| `reason` | 뜻 |
|---|---|
| `일회성 행동` | 인사·일시 동행·단발 동작에 그쳐 지속되는 관계 상태나 변화가 없다 |
| `관계 아님` | 두 대상 사이 관계가 아니라 한쪽 사물·장비·장소·설정만 설명한다 |
| `같은 쌍 다른 메모와 중복` | **같은 장면**에서 같은 대사·사건이 중복 추출됐다(다른 장면의 반복은 이 사유로 빼지 않고 3.2절대로 묶는다) |
| `끝점 오추출` | 비유·관용구·무관한 낱말을 끝으로 잡아 관계 자체가 없다 |

- `note`는 필수다. 원문 인용(`supporting_evidence`)은 적으면 검사한다.
- 말로 밝힌 감정·태도·의지(예: "고맙다", "지켜 주겠다")는 일회성이 아니다. 관계 상태로 기록한다.

### 3.10 확신도 (`confidence`)

- `유력한 해석`: 원문이 관계를 직접 말하거나 보여 준다.
- `가능성`: 다음처럼 연결이 간접적이다.
  - 관계를 보이려면 여러 장면을 결합해야 한다.
  - 정체 후보(가능성)를 거쳐야 대상이 정해진다.
  - 말투·행동에서 추론해야 한다.
- `판단 보류`: 원문이 상충하거나 근거가 모자라 관계를 정할 수 없다.
- `확인된 사실`은 쓰지 않는다.
- 원문에 없는 동기·감정을 지어내서 관계를 만들지 않는다.

### 3.11 병합 제안 (`merge_suggestions`)

- 이 묶음 단위의 원문이 두 노드가 같은 대상임을 직접 보여 줄 때만 적는다. 예: 정체가 밝혀짐, 이름을 바꿈, 계정이 본인임을 인정함.
- 3.8절의 별개 개체(융합 전후, 옛 몸체·분신, 집단과 구성원, 칭호를 가진 다른 개체)는 올리지 않는다.
- 형식: `suggestion_id`(`<bundle_id>__M01`), `unit_ids`, `targets`(참조 둘 이상), `confidence`(`유력한 해석` | `가능성`), `rationale`, `supporting_evidence`
- 병합 자체는 하지 않는다. 쌍의 기록은 지금 노드대로 적는다.

### 3.12 검색 예산

- `grep`은 쌍(`--unit`)당 고유 검색어 최대 3개, 묶음 전체 40개다.
- 같은 검색어·title·offset으로 다시 실행하지 않는다. 잘린 결과는 `--offset`으로 이어 본다.
- 한 글자 검색어는 `--title`을 정할 때만 쓴다.
- 예산을 다 써서 판단을 보류했으면 그 기록의 `rationale`에 `[검색 예산 소진]`을 적는다.
- 보고의 grep 목록에는 실제로 실행한 검색어를 빠짐없이 적는다.

## 4. 출력

출력 파일 `<run root>/shards/<bundle_id>.json` 하나만 쓴다.

```json
{
  "schema_version": "pass2-0.1.0",
  "bundle_id": "D1__001",
  "endpoint_overrides": [],
  "candidate_links": [
    {
      "link_id": "D1__001__001",
      "unit_id": "U001",
      "link_type": "relation",
      "subject": [{ "ref": "entity", "entity_id": "char_가", "name": "가", "entity_type": "character" }],
      "target": [{ "ref": "entity", "entity_id": "char_나", "name": "나", "entity_type": "character" }],
      "bidirectional": false,
      "relation_type": "affinity_or_trust",
      "epistemic_status": "claimed",
      "claimants": [{ "ref": "entity", "entity_id": "char_가", "name": "가", "entity_type": "character" }],
      "context_scope": "canon",
      "temporal_anchor": "scene_present",
      "anchor": null,
      "progression": "initial",
      "prev_link_ids": [],
      "order_basis": "not_applicable",
      "memo_ids": ["example_01__rln_001", "example_05__rln_002"],
      "confidence": "유력한 해석",
      "rationale": "상태: 가가 나를 끝까지 지키겠다고 거듭 말한다 / 선후·근거: 01장면에서 처음 밝히고 05장면에서 되풀이한다",
      "supporting_evidence": [{ "scene_id": "example_01", "line_start": 12, "line_end": 12, "quote": "원문 그대로" }],
      "contradicting_evidence": [],
      "search_hints": []
    }
  ],
  "excluded_memos": [
    { "unit_id": "U001", "item_id": "example_03__rln_001", "reason": "일회성 행동", "note": "길에서 인사만 나눈다" }
  ],
  "merge_suggestions": []
}
```

- `link_id`는 `<bundle_id>__001`부터 겹치지 않게 매긴다.
- `rationale`은 `상태: … / 선후·근거: …` 형식이다.
- `supporting_evidence`·`contradicting_evidence`·`search_hints`는 배열이다(없으면 `[]`). 인용 하나는 15줄까지다.
- `evidence_scenes`·`timeline_info`·`release_dates`·`verdict`는 쓰지 않는다. 앞의 셋은 병합기가 붙이고, `verdict`는 D에서 쓰지 않는 칸이다.
- **출력이 너무 길면 나눠 쓴다.**
  - 부분 파일 하나에 위 형식의 배열 일부를 적는다. `link_id`는 임시 이름(`P1`, `P2` …)을 써도 된다. 같은 파일 안의 `prev_link_ids`도 임시 이름으로 가리킬 수 있다.
  - `append-shard <bundle_id> --from=<부분 파일>`로 덧붙이면 도구가 이어지는 번호로 바꾸고, 남은 메모 수를 알려 준다.
  - 앞 부분의 기록은 이미 바뀐 실제 `link_id`로 가리킨다.
  - 남은 메모가 0이 되면 `validate`한다.

## 5. 검증

`validate`를 실행한다. 실패하면 고쳐서 최대 3회 다시 한다. 경고는 원문으로 확인하고, 남기면 이유를 보고한다. 통과하려고 근거를 지어내거나 규칙을 고치지 않는다.

| 코드 | 뜻 |
|---|---|
| `UNIT_NOT_COVERED` / `MEMO_NOT_COVERED` | 단위·메모를 빠뜨림 |
| `MEMO_CONFLICT` / `FOREIGN_MEMO` | 메모를 기록과 제외에 둘 다 넣음 / 다른 단위·묶음의 메모 |
| `UNKNOWN_UNIT` | 묶음에 없는 단위 |
| `ENDPOINT_OVERRIDE_INVALID` | 보정의 메모·`from`·중복 오류 |
| `ENDPOINT_MISMATCH` | 기록 끝이 귀속 메모의 (보정 뒤) 쌍과 다름, 다른 쌍끼리 이음 |
| `EXCLUSIVE_BRANCH_CHAINED` | 배타 갈래를 한 기록에 섞거나 사슬로 이음 |
| `CLAIMANT_REQUIRED` | `claimed`에 화자 없음, `established`에 화자 있음 |
| `PROGRESSION_AND_PREV` | 이어지는 전환에 앞 기록 없음, 처음·독립에 앞 기록 있음, 다른 단위·없는 기록, 순환 |
| `ANCHOR_REQUIRED` | 과거 기록을 순서에 쓰는데 성립 시점 없음, `anchor`가 말한 장면 이후 |
| `ORDER_BASIS_INVALID` | `changes_from`을 미상·순서 없음으로 이음, 연표 순서가 앞서지 않음(같은 번호 포함) |
| `RATIONALE_FORM` | `상태:`·`선후·근거:` 형식 아님 |
| `QUOTE_LOCATION` / `EVIDENCE_TOO_WIDE` / `MEMO_SCENE_EVIDENCE` | 인용이 원문과 다름 / 15줄 넘음 / 귀속 메모 장면의 인용 없음 |
| `ENUM` / `REFERENCE` / `SCHEMA` / `FORBIDDEN_FIELD` / `FORBIDDEN_CONFIDENCE` / `MERGE_SUGGESTION` | 허용 값·참조·형식 오류 |
| 경고 `SAME_BUNDLE_PAIR_OVERLAP` | 보정 뒤 쌍이 같은 묶음의 다른 단위와 같음 |
| 경고 `ESTABLISHED_FROM_CLAIM_ONLY` | 메모가 모두 주장인데 `established` |
| 경고 `TIMELINE_CONFLICTS_WITH_SCRIPT` | `script`로 이었는데 연표는 반대 |
| 경고 `MERGE_SAME_ID` / `BUDGET_TAG_MISSING` | 이미 같은 대상을 병합 제안 / 예산 소진 표시 없음 |

## 6. 하지 않는 것

- 다른 묶음의 출력, 감사 파일, 설계·지시서, `scripts/` 소스를 읽지 않는다.
- 묶음·발췌·검증 기록을 고치지 않는다. 자기 출력 파일(과 부분 파일) 말고는 쓰지 않는다.
- 공개 날짜로 작중 순서를 정하지 않는다.
- 사전 지식을 근거 칸에 쓰지 않는다.

## 7. 보고

끝나면 아래 형식으로만, **최종 응답 한 번에** 보고한다.

```
[완료] <bundle_id>: 단위 N개, 메모 M개 → 관계 기록 K건(established a / claimed b; 전환 changes_from c / contradicts d / reinterprets e), 제외 메모 x건, 끝점 보정 y건, 병합 제안 z건
부분 덧붙이기: append-shard n회 (썼을 때만)
병합 제안: <suggestion_id> 이름 A ↔ 이름 B (있을 때만)
그대로 둔 경고: <코드> <경로> — 이유 (있을 때만)
grep: <unit_id> <검색어> [--title] — 찾은 것 (쓴 것마다 한 줄)
```

또는

```
[실패] <bundle_id>: 3회 재시도 후 실패, 남은 오류: <코드별 건수>
```
