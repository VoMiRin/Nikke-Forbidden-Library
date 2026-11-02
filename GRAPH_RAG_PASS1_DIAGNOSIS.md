# GRAPH_RAG_PASS1_DIAGNOSIS — Pass 1 결과 진단 (공통 질문지)

작성일: 2026-11-02. 상태: 진단 대기.

Claude와 GPT가 이 문서를 똑같이 받아 Pass 1 결과를 **각자 독립적으로** 진단한다. 두 보고서가 모두 끝나면 결과를 대조한다.

- 이 문서가 맞추는 것: 입력, 질문, 결과 형식
- 이 문서가 맞추지 않는 것: **판정 기준.** 각 질문을 어떤 기준으로 판정할지는 진단하는 쪽이 정하고, 보고서에 적는다.
  - 이유: 기준까지 맞추면 두 진단이 같은 가정을 공유하게 되어 상호검증의 의미가 줄어든다. 결과가 달랐을 때 기준이 달라서인지 버그 때문인지는 보고서에 적힌 기준으로 가린다.

## 1. 목적

Pass 2는 Pass 1의 역색인으로 후보 장면을 고른다. Pass 3은 원문을 다시 읽으므로 요약 문구나 사실·주장 구분 같은 오류는 상당 부분 거기서 걸러진다. 하지만 **후보에서 아예 빠진 장면은 Pass 3까지 가지 못한다.**

이번 진단은 이렇게 후보를 놓치게 만드는 오류가 어떤 유형으로, 얼마나 있는지 찾는다. 결과를 보고 측정 게이트(명세 5절)를 설계하고, 보수할 유형을 고른다.

## 2. 입력 고정

- 기준 커밋: `0dee599`
- 읽는 파일:
  - 샤드: `data/graph/pass1/shards/batch_*.json`. 같은 폴더의 `pilot_*.json`(파일럿 3개)은 병합 대상이 아니므로 읽지 않는다.
  - 병합 결과: `data/graph/pass1_index.json`, `data/graph/progress.json`, `data/graph/pass1/by_title/*.json`
  - 레지스트리: `data/graph/entity_registry.json`, `data/graph/generic_roles.json`, `data/graph/descriptor_review.json`, `data/graph/unregistered_entity_candidates.json`
  - 매니페스트: `data/graph/manifest.json`. 장면마다 원문 경로(`source_file`), 배치, 기계 추출값(`mechanical_ground_truth`)이 들어 있다.
  - 원문: `public/scripts/**`, 등록 기준 `data/newScripts.ts`
  - 규칙: `GRAPH_RAG_SPEC.md`, `GRAPH_RAG_PASS1_RULES.md`
  - 병합기와 검증기 코드(무엇을 어떻게 색인하는지 확인용): `scripts/graph/`
- 읽지 않는 것: `data/graph/reports/`(기존 회차 보고서와 미처리 목록), `data/graph/pass1/shards_*` 같은 옛 버전 백업, `data/graph/pass1/repairs/`, `data/graph/pilot/`. 이전 판정을 보면 독립 진단이 되지 않는다.
- **작업 폴더의 파일을 읽지 않는다.** 위 파일을 각자의 입력 폴더로 꺼내 그것만 읽는다.

  ```sh
  mkdir -p <입력 폴더>/data/graph
  git archive 0dee599 -- \
    data/graph/pass1/shards data/graph/pass1/by_title \
    data/graph/pass1_index.json data/graph/progress.json \
    data/graph/entity_registry.json data/graph/generic_roles.json \
    data/graph/descriptor_review.json data/graph/unregistered_entity_candidates.json \
    public/scripts data/newScripts.ts scripts/graph \
    GRAPH_RAG_SPEC.md GRAPH_RAG_PASS1_RULES.md \
    | tar -x -C <입력 폴더>
  cp data/graph/manifest.json <입력 폴더>/data/graph/manifest.json
  sha256sum <입력 폴더>/data/graph/manifest.json
  ```

  - **매니페스트는 커밋에 없다.** `.gitignore`가 다시 만들 수 있는 산출물로 빼 두었기 때문이다. 그래서 작업 폴더의 파일을 복사한다.
    - 복사한 파일의 SHA-256은 `335ccf60b510e5a31797944cf915446853871f26b76db7a9e0e360119f5e134a`여야 한다. 이 값은 0dee599의 병합에 쓰인 매니페스트(`generated_at` 2026-11-01T16:36:17.579Z)의 해시다. 다르면 진단하지 말고 멈춘다.
    - 매니페스트를 다시 만들지 않는다(`build-manifest.mjs` 실행 금지).
  - 원문 경로는 매니페스트의 `source_file`로 찾는다. `scripts/graph/lib.mjs`의 `loadNewScriptsData`는 부르지 않는다. 입력 폴더에는 TypeScript 컴파일 결과와 `node_modules`가 없어서 실패한다.
  - 입력 폴더는 저장소 밖(각자의 임시 폴더)에 둔다. 저장소 안에 두면 진단 결과와 섞인다.
  - 이유: 작업 폴더를 `git diff`로 확인하는 방식은 커밋되지 않은 새 파일을 놓친다. 또 진단 보고서가 `data/graph/` 아래에 생기면 그것도 입력 변경으로 잡힌다.
  - 진단 스크립트는 입력 폴더 경로를 인자로 받는다. 다른 쪽이 자기 입력 폴더로 그대로 다시 돌려 볼 수 있어야 한다.
  - 보고서에 입력 폴더를 만든 명령, 시각, 매니페스트 해시를 적는다.
- **진단 대상 장면:** 병합된 5,560장면이다. 장면마다 매니페스트의 `batch_id`와 같은 배치의 샤드에 있는 것을 쓴다.
  - 본문이 바뀌어 다른 배치로 다시 추출된 장면은 옛 배치 샤드에도 옛 결과가 남아 있다. 병합기는 이것을 건너뛴다(`merge-and-index.mjs`의 `staleScenes`). Q1~Q5에서는 세지 않는다. 옛 결과가 인덱스에 섞였는지는 Q6에서 본다.
  - 샤드 원본에는 `item_id`가 없다. 병합기가 `by_title/*.json`과 인덱스에 붙인다. `item_id`가 필요하면 `by_title`에서 가져온다.

## 3. 범위

**하는 것**

- 아래 4절의 질문에 답하는 스크립트를 쓰고 실행한다.
- 판정에 필요하면 원문의 해당 줄을 읽는다. 원문을 확인한 항목은 결과에 표시한다(5절 `source_checked`).
- **원문 확인 상한: 질문마다 30건.** 진단자(모델)가 원문을 직접 읽고 판정한 `findings.jsonl` 줄이 질문마다 30줄을 넘지 않게 한다.
  - 스크립트가 원문을 문자열로 대조하는 것은 세지 않는다. 모델이 원문을 읽는 것만 센다.
  - 상한을 넘는 의심 후보는 원문을 보지 않고 `판단 보류`로 적고, 건수를 보고서에 적는다.
  - 30건을 어떻게 골랐는지(무작위, 유형별 대표, 빈도순 등) 보고서에 적는다.
  - 이유: 진단의 목적은 오류의 유형과 규모를 파악하는 것이다. 하나하나 확정하는 일은 보수할 때 한다. 상한이 없으면 후보가 수천 건인 질문에서 비용이 크게 늘고, 두 진단의 확인량도 크게 달라진다.

**하지 않는 것**

- 데이터 수정. 샤드, 인덱스, 레지스트리, 원문을 포함해 2절의 입력 파일은 하나도 바꾸지 않는다.
- 전체 배치 기계 검증(`validate-output.mjs`를 모든 배치에 돌리는 것)
- 보수, Pass 2 실행
- 모델에게 장면을 통째로 다시 읽혀 의미를 검수하는 것
- `scripts/graph/`의 도구 수정. 진단 스크립트는 5절의 각자 폴더에 둔다.

## 4. 질문

각 질문마다 무엇을 찾을지만 적었다. 어떻게 판정할지는 정하지 않았다.

**Q1. 화자 라벨이 다른 인물의 엔티티에 연결된 경우**

같은 화자 라벨이 이야기에 따라 다른 인물을 가리키는데, 엔티티가 한쪽으로만 연결된 장면을 찾는다.

- 알려진 사례: ARK GUARDIAN은 과거 이야기이고, 화자 라벨 "지휘관"은 갓데스 스쿼드의 지휘관(엔더슨)이다. `ark_guardian_26` L26~28에서 드러난다. 그런데 이 이야기의 15장면에서 이 라벨이 `char_지휘관`(주인공)에 연결돼 있다. 진단 결과에 이 사례가 들어가는지로 탐지가 제대로 됐는지 확인할 수 있다.
- "지휘관"만 보지 말고 다른 라벨도 본다.

**Q2. 같은 인물이 여러 엔티티로 나뉘었거나, 다른 인물이 한 엔티티로 묶인 경우**

Q1처럼 이야기 맥락 때문에 생긴 것 말고, 표기 차이나 연결 실수로 생긴 것을 찾는다. 예를 들면 별명, 띄어쓰기 차이, `char_...`와 `surface:...`처럼 같은 인물이 두 갈래로 나뉜 것이다.

**Q3. `entity_id`가 null인 항목**

`entity_id`를 가지는 모든 필드의 null 현황을 센다. 필드는 `present_in_scene`, `present_silent`, `remote_or_voice_only`, `mentioned_only`, `document_author`, `resolved_in_same_scene_to` 등이다.

- 설계상 null이 맞는 경우가 있다.
  - `???`, 일반 역할 명사, 묘사형 라벨은 명세 1.6에 따라 null이다.
  - 레지스트리는 인물만 담는다. 그래서 `mentioned_only`의 인물이 아닌 대상(`entity_type`이 `character`가 아닌 것)은 언제나 null이다(명세 2.3의 27항).
- 이런 정상적인 null과 연결이 빠진 것으로 보이는 null을 나눈다. 나누는 기준은 보고서에 적는다.
- 분모는 아래처럼 필드별로 따로 센다. 어떤 기준으로 걸렀든 이 분모는 공통이다.
  - `present_in_scene`, `present_silent`, `remote_or_voice_only`, `mentioned_only`: 항목 수. `mentioned_only`는 인물과 인물이 아닌 대상을 나눠서도 센다.
  - `document_author`: 객체가 null이 아닌 장면 수
  - `resolved_in_same_scene_to`: 객체가 null이 아닌 항목 수. `unknown_speakers`와 `descriptor_speakers`를 따로 센다.

**Q4. 미등록 엔티티 후보**

`unregistered_entity_candidates`와 `unregistered_entity_candidates.json`을 본다.

병합기는 `entity_id`가 null인 대상도 `surface:<표기>` 키로 인덱스에 넣는다(`scripts/graph/merge-and-index.mjs`). 그래서 미등록이라는 사실만으로 검색에서 빠지지는 않는다. 다음 둘을 나눠서 본다.

- **등장 빈도:** 어떤 후보가 몇 장면에 나오는지. 빈도가 높아도 표기가 하나로 일정하면 `surface:` 키로 모두 찾을 수 있다.
- **실제 탐색 누락 가능성:** 같은 대상이 등록 엔티티와 `surface:` 키로 나뉘었거나, 여러 표기의 `surface:` 키로 흩어져서 한 키로 찾으면 일부 장면이 빠지는 경우. 예를 들면 이미 등록된 엔티티가 후보로 올라온 것, 같은 대상이 다른 표기로 여러 번 올라온 것이다.

**Q5. 원문에는 있는데 Pass 1에 흔적이 없는 대상**

장면 원문에 나오는 인물·대상이 그 장면의 **색인되는 필드**에 없는 경우를 찾는다. 예를 들면 기계 추출 화자나 원문에 나온 등록 엔티티 이름이다.

- 색인되는 필드가 무엇인지는 병합기 코드(`merge-and-index.mjs`)로 확인하고 보고서에 적는다.
- `summary`나 `events_and_claims[].quote`처럼 색인되지 않는 곳에만 이름이 있어도 Pass 2 후보 탐색에서는 빠진다. 그래서 이것도 찾는다. 다만 결과 어디에도 없는 경우와 색인되지 않는 곳에만 있는 경우를 나눠 세고, 어디에 있었는지 `observed`에 적는다.
- `???` 줄과 묘사형 화자가 `unknown_speakers`, `descriptor_speakers`에서 빠진 경우도 포함한다.
- Q6의 "설계상 사각지대"와 겹치는 부분이 있다. Q5는 장면별 대상 하나하나를 적고, Q6은 필드 단위로 집계한다.

**Q6. 역색인과 샤드의 일치**

Pass 2가 직접 읽는 것은 `pass1_index.json`이다. 인덱스는 샤드 전체를 담지 않고, 정해진 필드만 색인한다. 다음 둘을 나눠서 본다.

- **반영 누락:** 병합기가 색인하도록 돼 있는 내용 중 인덱스에 빠졌거나 지금 샤드와 맞지 않는 것. `progress.json`, 매니페스트, 인덱스가 집계한 배치·장면 수가 서로 맞는지도 여기에 넣는다.
- **설계상 사각지대:** 색인하지 않는 필드에만 있어서, 인덱스로 후보를 고르면 찾을 수 없는 정보. 어떤 필드가 그런지, 그 필드에만 있는 정보가 얼마나 되는지 적는다. 이것은 데이터 오류가 아니라 설계 문제로 따로 보고한다.

**Q7. 그 밖에 후보 누락을 일으킬 수 있는 것**

Q1~Q6에 들지 않지만 진단하다가 발견한 것을 적는다. 없으면 "없음"이라고 적는다.

## 5. 결과 형식

각자 아래 폴더에 쓴다. 상대 폴더는 6절 조건을 채우기 전에는 읽지 않는다.

- Claude: `data/graph/reports/diag/claude/`
- GPT: `data/graph/reports/diag/gpt/`

폴더에는 세 가지를 둔다.

**(1) `findings.jsonl`** — 한 줄에 판정 하나

```json
{
  "question": "Q1",
  "target_key": "string (아래 규칙)",
  "scene_id": "string | null",
  "batch_id": "string | null",
  "field_path": "string | null",
  "item_id": "string | null",
  "observed": { "speaker_label": "지휘관", "entity_id": "char_지휘관" },
  "verdict": "오류 의심 | 연결 누락 의심 | 정상 | 판단 보류",
  "reason": "string",
  "source_checked": [ { "scene_id": "string", "line_start": 1, "line_end": 1 } ]
}
```

위 값은 형식 예시다. 실제 데이터에서 가져온 것이 아니다.

`target_key`는 두 진단의 결과를 맞춰 볼 때 쓰는 대상 식별자다. 판정 기준과 상관없이 같은 대상이면 같은 키가 나오도록 아래 규칙으로 만든다.

| 대상 | `target_key` | 예 |
|---|---|---|
| 샤드에 있는 항목 | `shard:<scene_id>#<field_path>` | `shard:<scene_id>#participants.present_in_scene[2]` |
| 장면에 있어야 하는데 없는 대상 | `missing:<scene_id>#<원문 표기>` | `missing:<scene_id>#???@L0012`, `missing:<scene_id>#<인물 이름>` |
| 레지스트리·후보 파일의 항목 | `file:<파일 경로>#<키>` | `file:data/graph/entity_registry.json#char_지휘관` |
| 여러 표기를 한 대상으로 묶은 판정 | `group:<표기1>\|<표기2>\|...` | 표기를 유니코드 순으로 정렬해 `\|`로 잇는다 |
| 인덱스 항목 | `index:<인덱스 안 경로>` | `index:entities["char_지휘관"]` |
| 집계 불일치·설계 문제 | `global:<짧은 이름>` | `global:batch_count`, `global:unindexed_field:events_and_claims` |

- `field_path`는 장면 객체 안에서의 경로다. 샤드 안 장면 순서는 넣지 않는다. 샤드 항목이 아니면 null이다.
  - **항목 객체까지만 적는다.** `.entity_id` 같은 말단 속성 이름은 붙이지 않는다. 어느 속성이 문제인지는 `observed`에 적는다.
  - 배열 번호는 0부터 센다. 장면에 있는 그대로의 순서다.
  - 예: `participants.present_in_scene[2]`, `participants.document_author`, `unknown_speakers[0].resolved_in_same_scene_to`, `descriptor_speakers[1].resolved_in_same_scene_to`, `events_and_claims[5]`
  - 장면 전체에 대한 판정이면 빈 문자열 `""`로 둔다. `target_key`는 `shard:<scene_id>#`가 된다.
- `file:` 키는 파일 종류마다 다음과 같이 쓴다.
  - `entity_registry.json`: `entity_id`
  - `unregistered_entity_candidates.json`: `<suggested_type>::<surface_text>`. 병합기가 이 단위로 집계하므로, 같은 표기라도 종류가 다르면 다른 항목이다. `surface_text`는 파일에 적힌 그대로 쓴다.
  - `generic_roles.json`, `descriptor_review.json`: 라벨 그대로
- `missing:`의 원문 표기는 원문에 나온 그대로 쓴다. `???` 줄은 줄 번호를 붙여 `???@L0012`로 쓴다. 그 대상이 어느 필드에 들어갔어야 한다고 보는지는 `observed`와 `reason`에 적는다.
- 줄 범위만 다른 같은 대상(예: 같은 인물이 한 장면에서 두 번 빠짐)은 한 줄로 적고, 줄은 `observed`에 모은다.
- `item_id`는 병합기가 붙인 값이 있으면 적는다.
- `verdict`에 "확정 오류"는 없다. 두 진단이 같은 판정을 내려도 확정이 아니다. 실제로 보수할 때 근거를 다시 확인한다.
- `source_checked`는 원문을 직접 확인한 위치다. 다른 장면을 근거로 판정했으면 그 장면을 적는다(예: ARK GUARDIAN 다른 장면의 판정 근거로 `ark_guardian_26` L26~28). 확인하지 않았으면 빈 배열이다.
- "정상"으로 판정한 것은 적지 않아도 된다. 다만 Q3처럼 정상과 이상을 나누는 질문은 정상 쪽 건수를 보고서에 적는다.

**(2) `report.md`** — 다음을 순서대로 적는다.

1. 입력 폴더를 만든 명령과 시각
2. 질문별로
   - 판정 기준
   - 분모
   - 건수(판정별)
   - 대표 사례 몇 건
   - 한계: 이 방법으로 못 찾는 것
3. 원문을 확인한 장면 수
4. 측정 게이트와 보수에 대한 제안이 있으면 적는다.

**(3) 진단 스크립트** — 폴더 안에 둔다. 다른 쪽이 그대로 다시 돌려 볼 수 있어야 한다. 실행 방법은 `report.md`에 적는다.

## 6. 독립성과 대조

- 두 보고서가 모두 끝나기 전에는 상대의 폴더, 스크립트, 결과를 읽지 않는다.
  - 끝났다는 표시는 `report.md` 맨 끝의 `진단 완료: <날짜 시각>` 줄이다.
  - 진행 중에 서로 질문하지 않는다. 이 문서가 애매하면 사용자에게 묻고, 사용자는 받은 답을 양쪽에 똑같이 알린다.
- 대조는 `findings.jsonl`을 (`question`, `target_key`) 단위로 맞춰 본다. 표기 차이로 키가 어긋난 것(예: 한쪽은 `group:`, 다른 쪽은 같은 표기들을 `file:`로 각각 적음)은 사람이 보고 맞춘다.
  - 한쪽에만 있는 판정과 판정이 갈린 항목을 먼저 본다. 기준이 달라서인지, 한쪽이 놓쳤는지, 버그인지를 가린다.
  - 양쪽이 같은 판정을 내린 항목도 확정하지 않는다. 같은 규칙 문서를 읽었으니 같은 맹점이 있을 수 있다.
- 대조가 끝나면 그 결과를 이 폴더(`data/graph/reports/diag/`)에 따로 남긴다.

## 7. 그 뒤

이 문서의 범위가 아니다. 순서만 적어 둔다.

1. **정답 목록 고정:** 측정 게이트(명세 5절)용 질문과 정답 근거 장면을 Pass 1 데이터가 아니라 원문에서 만든다. Pass 1을 보고 만들면 Pass 1이 찾기 쉬운 질문만 나오기 때문이다. 두 모델이 질문을 따로 만들어 합치고, 사용자가 검토해 고정한다.
2. **보수 전 측정:** 지금 Pass 1 결과로 정답 근거 장면을 얼마나 찾는지 잰다.
3. **보수:** 진단 대조와 측정에서 놓친 원인을 보고 보수할 유형을 고른다. 원문을 읽고 판단해야 하는 보수는 Gemini가 하고, 기계적인 수정은 Claude가 한다(기존 분담 그대로).
4. **재측정:** 같은 정답 목록으로 다시 잰다. 보수 전과 비교해 실제로 나아졌는지 확인한다.
5. **Pass 2 진행 여부:** 사용자가 2~4의 결과를 보고 정한다.
