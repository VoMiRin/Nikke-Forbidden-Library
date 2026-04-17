
# Nikke-Forbidden-Library
니케 스토리들을 모아놓은 프로젝트입니다.

## 구조
- 앱 시작 시 `public/script-manifest.json`만 로드합니다.
- 검색은 `/api/search`를 우선 호출합니다.
- 검색 API가 없으면 `public/search-index.json`으로 자동 폴백합니다.
- 본문은 사용자가 실제로 스크립트를 열 때만 `public/scripts/*`에서 로드합니다.

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

기본 포트는 `8080`이며 `GET /api/search?q=...&mode=content` 형식으로 검색합니다.

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
2. `npm run build`
3. Firebase Hosting 재배포
4. 검색 API 이미지를 다시 배포

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
2. Cloud Build로 검색 API 이미지 빌드
3. Cloud Run `nikke-search-api` 배포
4. Firebase Hosting 배포

기본값:
- `PROJECT_ID`: 현재 `gcloud config get-value project`
- `REGION`: `asia-northeast3`
- `ARTIFACT_REPOSITORY`: `nikke-containers`
- `IMAGE_NAME`: `nikke-search-api`
- `SERVICE_NAME`: `nikke-search-api`

예시:
```bash
PROJECT_ID=nikkeforbiddenlibrary npm run deploy
```

Hosting만 나중에 따로 올리고 싶지 않으면:
```bash
DEPLOY_HOSTING=0 npm run deploy
```
