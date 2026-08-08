# AI Chat File Search 배포 동기화 작업 지시서

> 작성일: 2026-08-06  
> 이 문서는 작업 지시서일 뿐이다. 문서를 읽는 것만으로 실제 업로드나 배포를 실행하지 말고, 사용자가 구현 또는 실행을 요청한 범위만 수행한다.
> 2026-08-07 상태: 아래 안전장치와 `npm run deploy` 자동 sync 연결은 구현되었다. 현재 상태는 README와 코드 및 이 문서의 "구현 결과" 절을 우선 확인한다.

## 2026-08-07 구현 결과

- `npm run deploy`는 build 직후, Cloud Build 전에 Gemini File Search 증분 sync를 기본 실행한다.
- `SYNC_GEMINI_FILE_SEARCH=0`으로만 명시적으로 건너뛸 수 있고, sync 실패 시 이후 배포는 중단된다.
- 원격 `sha256`과 로컬 해시가 같은 `STATE_ACTIVE` 문서만 adopt한다. 해시가 없거나 다르거나 pending/failed 상태면 재업로드한다.
- 변경 문서는 새 문서의 인덱싱 성공 후 기존 문서를 삭제한다.
- manifest store 불일치 및 manifest document 경로 불일치를 안전하게 차단한다.
- manifest는 원자적으로 저장되며, 변경 없는 sync는 파일과 `updatedAt`을 다시 쓰지 않는다.
- 배포 흐름 오프라인 테스트와 sync planner/복구 테스트가 추가되었다.
- 실제 store 상태와 남은 업로드 수는 작업 시작 시 dry-run으로 다시 확인한다.

## 목표

`npm run deploy`를 실행하면 프런트엔드, 검색 API, Firebase Hosting뿐 아니라 AI Chat이 사용하는 Gemini File Search 자료도 증분 동기화되게 만든다.

동기화가 실패하면 이후 Cloud Build, Cloud Run, Firebase Hosting 배포를 계속하지 않아야 한다. 긴급 배포를 위한 명시적인 opt-out은 제공하되 기본 동작은 동기화 활성화로 한다.

## 2026-08-06 확인 당시 상태

- `package.json`의 `deploy`와 `gemini:file-search:sync`는 서로 분리되어 있다.
- `scripts/deploy.sh`는 `npm run build` → Cloud Build → Cloud Run → Firebase Hosting만 실행하며 File Search sync를 호출하지 않는다.
- `/api/ask`는 `public/search-index.json`이나 Hosting의 `public/scripts/**`가 아니라 `GEMINI_FILE_SEARCH_STORE` 원격 저장소만 조회한다.
- 로컬 `.env.local`과 운영 Cloud Run revision `nikke-search-api-00038-j9f`는 같은 store를 가리키고 있었다. 당시 store 이름은 `fileSearchStores/nikketest1778575668078-jrfhblig2x57`이었다. 이름과 문서 분포상 초기 테스트 store로 보이지만, 작업 시작 시 현재 설정을 다시 확인한다.
- 읽기 전용 sync dry-run 결과:
  - 비어 있지 않은 로컬 소스: 432개
  - 기존 원격 문서와 경로가 매칭된 파일: 10개
  - 신규 업로드 필요: 422개
  - 빈 파일로 제외: 3개
- `.gemini-file-search-manifest.json`은 없었으며 `.gitignore` 대상도 아니었다.
- 확인은 `--dry-run`으로만 수행했으므로 원격 store와 manifest는 변경하지 않았다.
- 작업 시작 전부터 `public/app-version.json`에 빌드로 생성된 변경이 있었다. 기존 변경을 임의로 되돌리지 않는다. 다만 검증용 `npm run build`가 이 타임스탬프를 다시 갱신하는 것은 정상 동작이므로, 실행 전후 상태를 구분해 보고한다.

## 먼저 읽을 파일

- `package.json`
- `scripts/deploy.sh`
- `scripts/syncGeminiFileSearchStore.mjs`
- `scripts/testGeminiFileSearch.mjs`
- `server/index.mjs`
- `server/Dockerfile`
- `firebase.json`
- `README.md`

핵심 코드 위치는 다음과 같다.

- sync 입력 수집: `scripts/syncGeminiFileSearchStore.mjs`의 `collectSourceFiles`
- 증분 계획 수립: 같은 파일의 `main` 내부 `plan` 생성 및 분류 부분
- 실제 삭제/업로드와 manifest 저장: 같은 파일의 `deleteDocument`, `uploadThenDeleteExisting`, `writeManifestIfChanged`
- AI Chat store 사용: `server/index.mjs`의 `/api/ask` 처리와 `fileSearchStoreNames`

## 작업 시작 전 진단

1. `git status --short`로 사용자 변경을 기록하고 보존한다.
2. `.env.local`의 키 값을 출력하지 말고 아래 항목의 존재 여부만 확인한다.
   - `GEMINI_API_KEY` 또는 지원되는 대체 키 변수
   - `GEMINI_FILE_SEARCH_STORE`
3. `.gemini-file-search-manifest.json`의 존재 여부와 현재 store 이름을 다시 확인한다.
   - manifest가 있으면 `manifest.storeName`이 `GEMINI_FILE_SEARCH_STORE`와 정확히 같은지 확인한다.
   - 서로 다르면 기존 manifest의 document ID를 사용하지 말고 실제 sync를 중단한다. store를 바꿀 것인지, manifest를 새로 bootstrap할 것인지 먼저 결정한다.
4. 다음 읽기 전용 명령을 먼저 실행한다.

   ```bash
   npm run gemini:file-search:sync -- --dry-run
   ```

5. 필요하면 운영 Cloud Run이 가리키는 store를 읽기 전용으로 확인한다. `.env.local`과 운영 store가 다르면 어느 쪽을 기준으로 할지 사용자에게 확인하기 전에는 실제 sync를 실행하지 않는다.
6. 실제 업로드·삭제·Cloud Run 배포·Firebase 배포는 외부 상태와 비용에 영향을 주므로, 사용자가 실행까지 요청했는지 확인한다. 구현만 요청받았다면 실제 sync와 전체 deploy는 하지 않는다.

## 최초 복구 시 필수 주의사항

2026-08-06 당시 sync 로직은 manifest가 없고 동일 경로의 원격 문서가 있으면 해시 검증 없이 `adopt`하는 문제가 있었다. 이 문제는 2026-08-07에 수정되어, 현재는 원격 `sha256`이 로컬 해시와 같고 문서 상태가 `STATE_ACTIVE`일 때만 adopt한다.

따라서 manifest가 여전히 없다면 먼저 일반 dry-run을 확인한다.

```bash
npm run gemini:file-search:sync -- --dry-run
```

metadata가 없거나 해시가 다른 legacy 문서는 일반 sync에서도 안전하게 재업로드된다. 모든 로컬 문서를 의도적으로 다시 올려야 하는 복구 상황에서만 사용자 승인 후 `--force`를 사용한다.

```bash
npm run gemini:file-search:sync -- --dry-run --force
npm run gemini:file-search:sync -- --force
```

`--force`는 수백 개 파일을 처리하고 기존 매칭 문서를 교체하므로 반드시 실제 실행 권한과 예상 비용/시간을 사용자에게 알린다.

성공 후 생성된 `.gemini-file-search-manifest.json`에는 비밀값이 없는지 확인하고 Git 추적 대상으로 유지한다. 이 파일이 이후 증분 비교의 기준이다.

manifest가 이미 있더라도 `manifest.storeName`이 현재 설정과 다르면 자동으로 현재 이름으로 덮어쓰면 안 된다. 현재 sync 스크립트는 이 불일치를 명확한 오류로 처리한다.

## 구현 요구사항

### 1. deploy에 기본 sync 단계 추가

`scripts/deploy.sh`에 다음 성격의 플래그를 추가한다.

```bash
SYNC_GEMINI_FILE_SEARCH="${SYNC_GEMINI_FILE_SEARCH:-1}"
```

배포 설정 출력에도 이 값을 표시한다. `npm run build`가 성공하고 필수 생성 파일을 확인한 직후, 비용이 큰 Cloud Build보다 앞에서 다음 동작을 수행한다.

```bash
if [[ "$SYNC_GEMINI_FILE_SEARCH" == "1" ]]; then
  echo "==> Syncing Gemini File Search documents"
  npm run gemini:file-search:sync
else
  echo "==> Skipping Gemini File Search sync because SYNC_GEMINI_FILE_SEARCH=$SYNC_GEMINI_FILE_SEARCH"
fi
```

`deploy.sh`는 이미 `set -euo pipefail`을 사용하므로 sync 실패 시 배포가 중단되는 동작을 유지한다. 실패를 삼키거나 경고만 출력하고 계속 배포하지 않는다.

긴급 opt-out 사용법은 다음처럼 문서화한다.

```bash
SYNC_GEMINI_FILE_SEARCH=0 npm run deploy
```

### 2. 최초 bootstrap과 평상시 deploy를 구분

- 최초 복구는 앞 절의 `--force` 또는 안전하게 수정한 adoption 로직으로 한 번 완료한다.
- manifest가 정상 생성된 이후의 `npm run deploy`에서는 일반 증분 sync를 사용한다.
- 자동 deploy에 `--force`를 상시 붙이지 않는다.
- `--prune`은 원격 삭제를 수행한다. 자동 적용 여부를 임의로 정하지 말고 사용자에게 정책을 확인한다.
  - 안전 우선 기본안: 자동 deploy에서는 prune하지 않고 별도 명령/플래그로만 수행한다.
  - 완전 미러링이 명시적으로 필요하면 manifest가 정상인지 검증한 뒤 opt-in 플래그를 추가한다.

### 3. manifest의 no-op 동작 개선

현재 sync 스크립트는 변경이 없어도 마지막에 manifest의 `updatedAt`을 갱신할 수 있다. manifest를 Git에 추적하면 매 deploy마다 불필요하게 작업 트리가 dirty해질 수 있으므로 다음을 보장한다.

- adopt/upload/delete 등 실제 manifest 내용 변경이 없으면 파일을 다시 쓰지 않는다.
- 실제 변경이 있을 때만 `updatedAt`을 바꾼다.
- 동일한 원본과 동일한 원격 상태에서 sync를 두 번 실행했을 때 두 번째 실행은 파일 diff를 만들지 않아야 한다.

### 4. sync 정합성 안전장치

deploy에 연결하기 전에 다음 두 조건을 sync 스크립트에서 보장한다.

- manifest의 `storeName`이 현재 `GEMINI_FILE_SEARCH_STORE`와 다르면 명확한 복구 안내와 함께 실패한다.
- manifest가 없는 상태의 원격 문서는 `sha256` metadata가 현재 로컬 해시와 정확히 일치할 때만 adopt한다. 해시가 없거나 다르면 재업로드 대상으로 분류한다.

가능하면 manifest는 임시 파일에 완전히 쓴 뒤 rename하는 방식으로 원자적으로 저장한다. 변경 문서를 교체할 때는 새 문서의 업로드와 인덱싱 성공을 확인한 뒤 기존 문서를 삭제해, 업로드 실패로 검색 가능한 기존 문서까지 먼저 사라지는 일을 피한다.

### 5. 비밀정보 보호

- API key 값을 로그, diff, README, manifest에 기록하지 않는다.
- `.env.local`을 커밋하지 않는다.
- store 리소스 이름은 비밀키는 아니지만, 문서 예시에는 가능하면 placeholder를 사용한다.
- 기존 `SYNC_GEMINI_SECRET`은 API key를 Secret Manager에 넣는 기능일 뿐 corpus sync가 아니다. 두 플래그와 설명을 혼동하지 않는다.

### 6. 문서와 환경 변수 예시 갱신

`README.md`와 `.env.example`을 일관되게 수정한다.

- Gemini File Search 갱신 절차
- 운영 플로우
- 원클릭 배포 단계 목록
- 새 `SYNC_GEMINI_FILE_SEARCH=0` opt-out
- 최초 bootstrap은 일반 배포와 다르며 `--force` 또는 안전한 adoption 로직이 필요하다는 설명
- prune 정책을 구현한 경우 그 사용법과 삭제 위험
- `.env.example`의 `SYNC_GEMINI_FILE_SEARCH` 기본값과 설명

File Search는 mutable한 외부 저장소이므로 완전한 원자적 배포는 아니다. sync가 성공한 뒤 Cloud Build가 실패하면 새 자료는 기존 AI 서버에서도 즉시 검색될 수 있다. 이 순서와 복구 방법을 README에 짧게 명시한다.

## 검증 절차

코드 수정 후 외부 상태를 바꾸지 않는 검증부터 수행한다.

```bash
bash -n scripts/deploy.sh
npm run build
npm run gemini:file-search:sync -- --dry-run
git diff --check
git status --short
```

가능하면 deploy 명령을 stub 처리한 테스트 또는 동등한 방법으로 아래 순서를 확인한다.

1. build
2. File Search sync
3. Cloud Build
4. Cloud Run deploy
5. Firebase Hosting deploy

또한 다음을 확인한다.

- `SYNC_GEMINI_FILE_SEARCH=0`일 때 sync만 건너뛰고 기존 deploy 흐름은 유지된다.
- sync가 실패하면 Cloud Build 이후 단계가 실행되지 않는다.
- dry-run은 원격 문서와 manifest를 변경하지 않는다.
- 다른 store 이름이 든 manifest를 사용하면 업로드를 건너뛰지 않고 안전하게 실패한다.
- manifest가 없을 때 원격 `sha256`이 없거나 불일치하는 문서를 무검증 adopt하지 않는다.
- 실제 bootstrap 후 dry-run에서 신규/변경/강제 업로드 대상이 0개다.
- 실제 변경 파일 하나를 추가 또는 수정했을 때 그 파일만 증분 대상으로 잡힌다.
- no-op sync를 연속 두 번 수행해도 두 번째 실행 후 manifest diff가 없다.
- `public/app-version.json`을 포함한 기존 사용자 변경을 임의로 되돌리지 않았다.

전체 `npm run deploy`는 Cloud Build, Secret Manager, Cloud Run, Firebase Hosting을 실제로 변경한다. 사용자가 전체 배포 실행까지 명시적으로 요청하지 않았다면 검증 목적으로 실행하지 않는다.

## 완료 조건

- 기본 `npm run deploy`가 File Search 증분 sync를 정확히 한 번 호출한다.
- sync 실패 시 외부 배포 단계로 진행하지 않는다.
- 명시적 opt-out이 작동하고 README에 기록되어 있다.
- 최초 store 복구가 무검증 adoption 없이 완료되어 manifest가 생성되어 있다.
- 이후 dry-run 결과가 신규 0, 변경 0이고 no-op sync가 manifest diff를 만들지 않는다.
- AI Chat과 운영 Cloud Run이 의도한 동일 store를 사용한다.
- API key 등 비밀정보가 코드, 로그, 문서, manifest에 유출되지 않는다.
- manifest store 불일치와 무검증 remote adoption이 차단되어 있다.

## 나중에 Codex에게 줄 짧은 요청 예시

```text
AI_CHAT_DEPLOY_SYNC_HANDOFF.md를 처음부터 끝까지 읽고 그 지시대로 작업해줘.
먼저 현재 상태와 dry-run 결과를 다시 확인하고, 사용자 변경은 보존해.
실제 Gemini 업로드와 npm run deploy까지 실행하기 전에는 작업 범위와 외부 변경 내용을 나에게 알려줘.
```
