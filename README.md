
# Nikke-Forbidden-Library
니케 스토리들을 모아놓은 프로젝트입니다.

## 구조
- 앱 시작 시 `public/script-manifest.json`만 로드합니다.
- 검색은 `/api/search`를 우선 호출합니다.
- 검색 API가 없으면 `public/search-index.json`으로 자동 폴백합니다.
- 본문은 사용자가 실제로 스크립트를 열 때만 `public/scripts/*`에서 로드합니다.
- 정적 JSON은 재검증하고, 스크립트 본문 파일은 파일별 버전 쿼리로 바뀐 챕터만 다시 받도록 처리합니다.
- `public/app-version.json`으로 새 배포를 감지해, 이미 열려 있던 탭도 다시 포커스를 받거나 일정 시간이 지나면 최신 버전으로 새로고침됩니다.

## 로컬 실행
```bash
npm install
npm run dev
```

`npm run dev`는 실행 전에 아래 생성 자산을 자동으로 만듭니다.
- `public/script-manifest.json`
- `public/search-index.json`

## 깃허브에 푸시할때
```bash
git add .
git commit -m "Update scripts"
git push
```

## 검색 API 실행
```bash
npm run search-api
```

기본 포트는 `8080`이며 `GET /api/search?q=...` 형식으로 내용 검색을 합니다.
화자까지 함께 좁히려면 `GET /api/search?q=...&speaker=...`를 사용합니다. 이 경우 해당 화자가 직접 말한 텍스트 안에서만 내용이 검색됩니다.
기존 화자 전용 검색용 `GET /api/search?q=...&mode=speaker` 형식도 계속 지원합니다.

보안 관련 환경 변수:
- `ACCESS_CONTROL_ALLOW_ORIGIN`: 허용할 Origin 목록. 쉼표로 여러 개 지정 가능
- `RATE_LIMIT_WINDOW_MS`: 검색 API rate limit 윈도우 시간
- `RATE_LIMIT_MAX_REQUESTS`: 윈도우당 최대 검색 요청 수

AI 질문 관련 환경 변수:
- `ASK_RATE_LIMIT_WINDOW_MS`: IP별 AI 질문 rate limit 윈도우 시간. 기본값은 `600000`
- `ASK_RATE_LIMIT_MAX_REQUESTS`: IP별 윈도우당 최대 AI 질문 수. 기본값은 `10`
- `ASK_GLOBAL_RATE_LIMIT_WINDOW_MS`: 서버 인스턴스별 전체 AI 질문 rate limit 윈도우 시간. 기본값은 `60000`
- `ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS`: 서버 인스턴스별 윈도우당 전체 AI 질문 수. 기본값은 `6`
- `ASK_DAILY_LIMIT_WINDOW_MS`: 서버 인스턴스별 AI 질문 일일 상한 윈도우 시간. 기본값은 `86400000`
- `ASK_DAILY_LIMIT_MAX_REQUESTS`: 서버 인스턴스별 일일 최대 AI 질문 수. 기본값은 `100`
- `GEMINI_RETRY_COUNT`: Gemini 429/503 재시도 횟수
- `GEMINI_RETRY_INITIAL_DELAY_MS`: Gemini 재시도 시작 대기 시간
- `GEMINI_RETRY_MAX_DELAY_MS`: Gemini 재시도 최대 대기 시간
- `GEMINI_PROVIDER_COOLDOWN_MS`: Gemini 429 후 서버가 새 AI 질문을 잠시 막는 시간
- `GEMINI_COUNT_TOKENS_BEFORE_REQUEST`: `1`이면 Gemini 호출 전에 `countTokens`로 입력 토큰을 선계산

유료 API 보호용 기본값은 IP별 `10회/10분`, 서비스 전체 `6회/분`, 서버 인스턴스별 `100회/일`입니다. `npm run deploy`는 기본적으로 Cloud Run `RUN_MAX_INSTANCES=1`로 배포해 in-memory 제한이 예측 가능하게 동작하도록 합니다.
Gemini 429가 자주 나면 `ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS`를 낮추거나, `GEMINI_MODEL`을 preview 모델보다 quota가 여유로운 모델로 바꾸는 것이 우선입니다. API 키를 여러 개 넣어도 Gemini rate limit은 프로젝트 단위로 적용되므로 같은 프로젝트 키를 돌려 쓰는 방식은 효과가 없습니다.
AI 답변이 성공하면 응답 하단과 서버 로그에서 입력/검색 도구/출력/총 토큰 수를 확인할 수 있습니다. 단, `GEMINI_COUNT_TOKENS_BEFORE_REQUEST=1`은 Gemini 요청을 하나 더 보내므로 429가 심할 때는 기본값 `0`을 유지하세요.

AI 질문 기록 관련 환경 변수:
- `ASK_LOG_STORAGE`: AI 질문/답변 저장소. `firestore`이면 Firestore에 저장하고, `off`이면 저장하지 않습니다.
- `ASK_LOG_PROJECT_ID`: Firestore 프로젝트 ID. 배포 시 비어 있으면 `PROJECT_ID`를 사용합니다.
- `ASK_LOG_DATABASE_ID`: Firestore database ID. 기본값은 `(default)`
- `ASK_LOG_COLLECTION`: 저장 컬렉션명. 기본값은 `aiAskLogs`
- `ASK_LOG_DEFAULT_STATUS`: 저장 문서의 초기 검수 상태. 기본값은 `pending_review`
- `ASK_LOG_INCLUDE_PROMPT`: `1`이면 사용자 질문을 저장합니다.
- `ASK_LOG_INCLUDE_ANSWER`: `1`이면 AI 답변을 저장합니다.
- `ASK_LOG_WRITE_TIMEOUT_MS`: Firestore 저장 타임아웃
- `SYNC_FIRESTORE_IAM`: `1`이면 배포 중 Cloud Run 서비스 계정에 `roles/datastore.user` 권한을 부여하려고 시도합니다.

AI 질문 기록은 LLM 위키 초안 검수용입니다. 공개 서비스에서는 사용자가 입력한 질문과 AI 답변이 저장될 수 있음을 안내하고, Firestore의 `aiAskLogs` 컬렉션에서 `status=pending_review` 문서만 골라 검수하는 흐름을 권장합니다.

Firebase Hosting의 Cloud Run rewrite는 장시간 요청을 60초 뒤 종료할 수 있습니다. AI 질문은 Firestore에 `generationStatus=processing`으로 먼저 등록되고, 생성 결과에 따라 `completed` 또는 `failed`로 갱신됩니다. 프런트는 최초 요청과 병행해 임의 요청 ID로 `GET /api/ask/result`를 조회하므로, Hosting 연결이 끝나기 전에도 저장된 답변을 즉시 표시하고 생성 실패와 미접수 요청도 구분합니다. 이 복구 기능을 사용하려면 `ASK_LOG_STORAGE=firestore`와 `ASK_LOG_INCLUDE_ANSWER=1`을 유지해야 합니다.

## Gemini File Search 갱신

AI Chat은 Firebase Hosting의 스크립트 파일이나 검색 API의 `search-index.json`을 직접 읽지 않고, `GEMINI_FILE_SEARCH_STORE`로 지정한 원격 자료만 사용합니다. 따라서 이 store 동기화가 성공해야 새 스크립트가 AI 답변에 반영됩니다.

처음 File Search store를 만들 때는 전체 업로드를 한 번 실행합니다. 이 uploader는 각 문서에 원본 경로와 SHA-256 metadata를 함께 기록합니다.

```bash
npm run gemini:file-search:test -- --all --keep-store --concurrency 2
```

출력의 `Store name: fileSearchStores/...` 값을 `.env.local`의 `GEMINI_FILE_SEARCH_STORE`에 저장한 뒤, sync를 한 번 실행해 `.gemini-file-search-manifest.json`을 생성합니다.

```bash
npm run gemini:file-search:sync -- --dry-run
npm run gemini:file-search:sync
```

기존 store에 manifest가 아직 없다면 dry-run 결과를 먼저 확인하세요. 원격 `sha256`이 로컬 파일과 같은 문서만 안전하게 채택하고, metadata가 없거나 해시가 다른 기존 문서는 재업로드합니다. 모든 로컬 소스를 강제로 재업로드해야 하는 복구 상황에서만 `--force`를 사용합니다. 이 옵션은 store 자체를 새로 만들거나 경로가 매칭되지 않는 원격 문서를 정리하지는 않습니다.

긴 강제 재업로드가 중단됐다면 체크포인트를 확인한 뒤 `--force --start-at <상대경로>`로 해당 경로부터 재개하거나, `--force --only <상대경로>`로 한 파일만 다시 처리할 수 있습니다.

선택적 강제 복구 예시:

```bash
npm run gemini:file-search:sync -- --dry-run --force
npm run gemini:file-search:sync -- --force
```

`gemini:file-search:sync`는 `public/scripts/**/*.txt`와 `data/new_scripts/**/*.ts`의 해시를 manifest에 기록합니다. 수정 파일은 새 문서가 실제 `STATE_ACTIVE`가 된 것을 확인하고 manifest를 원자적으로 체크포인트한 뒤 기존 문서를 삭제합니다. 중간에 실패해도 성공한 문서는 다음 실행에서 이어서 사용합니다. manifest의 store 이름과 현재 설정이 다르면 다른 store의 document ID를 잘못 사용하는 일을 막기 위해 중단합니다.

이 manifest는 이후 증분 비교의 기준이므로 첫 동기화 성공 후 Git에 함께 커밋하세요. 변경이 없는 sync는 manifest의 `updatedAt`도 바꾸지 않습니다.

평상시에는 `npm run deploy`가 빌드 직후 증분 sync를 자동 실행합니다. sync가 실패하면 Cloud Build, Cloud Run, Firebase Hosting 배포를 진행하지 않습니다. 긴급하게 AI 자료 동기화만 건너뛰어야 할 때는 명시적으로 opt-out할 수 있습니다.

```bash
SYNC_GEMINI_FILE_SEARCH=0 npm run deploy
```

자동 배포는 삭제된 로컬 파일을 원격에서 지우지 않습니다. 삭제까지 반영하려면 manifest를 확인한 뒤 별도로 `--prune`을 실행합니다.

```bash
npm run gemini:file-search:sync -- --dry-run --prune
npm run gemini:file-search:sync -- --prune
```

File Search sync는 Cloud Run 배포와 원자적인 한 작업이 아닙니다. sync 성공 후 Cloud Build가 실패하면 새 자료는 기존 AI 서버에 먼저 보일 수 있습니다. 이 경우 원인을 해결한 뒤 같은 `npm run deploy`를 다시 실행하면 증분 상태에서 이어집니다.

## 비공개 Custom GPT 지식 파일

개인용 Custom GPT에 올릴 Markdown 본문 번들은 다음 명령으로 생성합니다.

```bash
npm run gpt:knowledge:build
```

결과는 Git에서 제외되는 `custom_gpt_knowledge/`에 생성됩니다. `manifest.json`의 `uploadFiles`에 나열된 파일만 GPT Knowledge에 업로드하세요. 생성기는 메타데이터에 등록되지 않은 비어 있지 않은 원문도 직접 탐지해 포함하고, 누락된 본문이나 설정된 최대 업로드 파일 수 초과가 있으면 실패합니다.

GPT 이름, 설명, Instructions, 기능 설정, 비공개 저장 및 Preview 점검 순서는 [`CUSTOM_GPT_SETUP.md`](./CUSTOM_GPT_SETUP.md)를 따릅니다. 실제 붙여 넣을 지시문은 [`CUSTOM_GPT_INSTRUCTIONS.md`](./CUSTOM_GPT_INSTRUCTIONS.md)에 있습니다. 답변 형식을 고정하지 않으며, 필요한 경우에만 확인된 사실과 해석·추측을 자연스럽게 구분하도록 작성되어 있습니다.

## 빌드
```bash
npm run build
```

빌드 시 아래 순서로 동작합니다.
1. 스크립트 메타데이터와 검색 인덱스를 생성
2. Vite 프로덕션 빌드 생성

## Cloud Run 검색 API 배포
검색 API 이미지는 [`server/Dockerfile`](/home/vomirin/nikke-script-archive/server/Dockerfile:1)를 사용합니다.

예시:
```bash
npm run build:search-assets
gcloud builds submit \
  --region=asia-northeast3 \
  --config cloudbuild.search-api.yaml \
  --substitutions=_IMAGE=asia-northeast3-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPOSITORY/nikke-search-api \
  .

gcloud run deploy nikke-search-api \
  --image asia-northeast3-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPOSITORY/nikke-search-api \
  --region asia-northeast3 \
  --allow-unauthenticated
```

이 방식은 Docker build context를 저장소 루트로 잡기 때문에 `public/search-index.json`도 같이 이미지에 포함됩니다.

## Firebase Hosting
정적 프런트는 Firebase Hosting에 배포하고, 검색은 Cloud Run으로 보내는 구성이 권장됩니다.

추가 설정 예시:
```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      {
        "source": "/api/**",
        "run": {
          "serviceId": "nikke-search-api",
          "region": "asia-northeast3"
        }
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

## 운영 플로우

스크립트를 2주마다 추가하는 흐름은 아래처럼 가져가면 됩니다.

1. `data/new_scripts/*`와 `public/scripts/*`에 새 스크립트 추가
2. 변경사항을 Git에 백업
3. `npm run deploy`
4. 배포 중 build → Gemini File Search 증분 sync → Cloud Build → Cloud Run → Firebase Hosting 순서로 처리되는지 확인

## 배포 직전 체크
1. `npm audit --omit=dev` 결과가 `0 vulnerabilities`인지 확인
2. Cloud Run 환경변수 `ACCESS_CONTROL_ALLOW_ORIGIN` 이 실제 배포 도메인으로 설정되어 있는지 확인
3. 배포 후 `curl -I https://YOUR_DOMAIN` 와 `curl -I https://YOUR_DOMAIN/api/search?q=test` 로 보안 헤더가 붙는지 확인

## 운영 매뉴얼
평소 운영은 아래 순서로 진행하면 됩니다.

1. WSL에서 프로젝트 루트로 이동
```bash
cd /home/vomirin/nikke-script-archive
```

2. 스크립트나 프런트 코드를 수정
- `data/new_scripts/*`
- `public/scripts/*`
- 필요한 경우 `components/*`, `hooks/*`

3. GitHub에 백업
```bash
git add .
git commit -m "Update scripts"
git push
```

4. 전체 배포
```bash
npm run deploy
```

5. Hosting 설정만 바뀐 경우에만 예외적으로 아래 명령 사용
```bash
firebase deploy --only hosting
```

한 줄 요약:
```bash
수정 -> git push -> npm run deploy
```

## 원클릭 배포
WSL에서 아래 한 줄로 전체 배포를 실행할 수 있습니다.

```bash
npm run deploy
```

이 스크립트는 아래 순서를 자동으로 수행합니다.

1. `npm run build`
2. Gemini File Search 증분 동기화
3. Cloud Build로 검색 API 이미지 빌드
4. Cloud Run `nikke-search-api` 배포
5. Firebase Hosting 배포

기본값:
- `PROJECT_ID`: 현재 `gcloud config get-value project`
- `REGION`: `asia-northeast3`
- `ARTIFACT_REPOSITORY`: `nikke-containers`
- `IMAGE_NAME`: `nikke-search-api`
- `SERVICE_NAME`: `nikke-search-api`
- `RUN_MAX_INSTANCES`: `1`
- `SYNC_GEMINI_FILE_SEARCH`: `1`

예시:
```bash
PROJECT_ID=nikkeforbiddenlibrary npm run deploy
```

Hosting 배포를 건너뛰려면:
```bash
DEPLOY_HOSTING=0 npm run deploy
```

AI 자료 sync를 긴급히 건너뛰어야 하면:

```bash
SYNC_GEMINI_FILE_SEARCH=0 npm run deploy
```
