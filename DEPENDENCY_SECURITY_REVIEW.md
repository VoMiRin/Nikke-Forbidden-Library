# 의존성 보안 점검 — 2026-10-21

`package-lock.json`과 설치된 npm 의존성을 npm audit 및 공식 보안 공지와 대조했습니다.
호환 범위 내 보안 업데이트를 잠금 파일과 로컬 `node_modules`에 적용했습니다.
이후 사용자 요청에 따라 Node 22.23.4 이미지와 Firebase Hosting 운영 배포까지 완료했습니다.

## 결과

| 검사 | 업데이트 전 | 업데이트 후 |
| --- | --- | --- |
| 전체 npm audit | 17개: 높음 14, 보통 2, 낮음 1 | 7개: 높음 5, 보통 2 |
| 운영 의존성 | `protobufjs`, `ws` 경고 확인 | `npm audit --omit=dev`: 0개 |

숫자는 영향을 받는 상위 패키지까지 포함한 npm audit 집계이며, 서로 독립적인 취약점 개수가 아닙니다.
남은 7개 경고는 개발 의존성이며 아래 두 원인에서 파생됩니다.

## 적용한 업데이트

| 패키지 | 이전 | 적용 버전 |
| --- | --- | --- |
| Vite | 6.4.1 | 6.4.5 |
| PostCSS | 8.5.10 | 8.5.31 |
| Rollup | 4.57.1 | 4.64.12 |
| protobufjs | 7.5.7 | 7.6.6 |
| ws | 8.20.0 | 8.22.0 |
| @babel/core | 7.29.0 | 7.29.7 |
| postcss-selector-parser | 6.1.2 | 6.1.5 |

Browserslist, nanoid, picomatch, source-map-js 및 관련 하위 의존성도 호환 버전으로 갱신했습니다.
`package.json`의 Vite·PostCSS 최소 버전도 적용 버전으로 올렸습니다.

Vite 6.4.1에는 [개발 서버 WebSocket을 통한 파일 읽기 취약점](https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583)이 있습니다.
6.4.4에는 파일 접근 제한 우회 회귀가 있어, [이를 수정한 6.4.5](https://github.com/vitejs/vite/security/advisories/GHSA-8g5g-mxqh-grgj)를 적용했습니다.
`npm run dev`는 이미 루프백에 바인딩하지만, 직접 Vite나 preview를 실행할 때도 로컬에서만 접근하도록
`vite.config.ts`의 `server.host`를 `127.0.0.1`로 맞췄습니다.

PostCSS는 [sourceMappingURL 경로 검사 문제](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp),
protobufjs는 [재귀적 메시지 변환에 의한 서비스 거부](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-wcpc-wj8m-hjx6),
ws는 [작은 조각의 반복 전송에 의한 메모리 고갈](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) 등을 포함한 경고가 있었습니다.
설치 여부만으로 운영 API를 통한 악용 가능성이 입증되는 것은 아니지만, 운영 이미지에 들어가는 두 패키지도 수정 버전으로 갱신했습니다.

## 남은 경고

- **braces 3.0.3:** [중첩 패턴 처리 시 스택 고갈](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)에 대한 수정 버전이 확인되지 않았습니다.
  `braces → chokidar/micromatch → fast-glob/tailwindcss` 경로가 높음 5개로 집계됩니다.
  이 프로젝트는 저장소의 고정된 Tailwind glob을 개발·빌드 과정에서 사용합니다. 운영 API에서 사용자가 보낸 패턴을 이 도구로 처리하는 경로는 확인되지 않았으며,
  Docker의 `npm ci --omit=dev`는 이 의존성을 제외합니다. 호환 패치가 나오면 재점검해야 합니다.
  npm이 제안하는 Tailwind 4 전환은 CSS·빌드 설정 변경이 필요한 별도 마이그레이션이므로 적용하지 않았습니다.
- **postcss-selector-parser 6.1.5:** [공식 보안 공지](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf)와
  [6.1.5 릴리스](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.5)는 6.x 백포트 수정을 명시합니다.
  확인 시점의 npm audit는 여전히 `<7.1.6`을 취약 범위로 취급해 parser와 postcss-nested를 보통 2개로 집계합니다.
  공식 수정 범위와 설치 버전을 대조하면 이 경고는 데이터베이스 반영 지연으로 판단됩니다. 경고를 숨기거나 강제 override하지 않았습니다.

## TypeScript·React

- TypeScript 5.8.3 자체는 이번 npm audit에 잡히지 않았고, [공식 저장소에도 공개 보안 공지가 없었습니다](https://github.com/microsoft/TypeScript/security/advisories). 유지했습니다.
- 최신 React Server Components 공지의 대상인 `react-server-dom-*`와 `@vitejs/plugin-rsc`는 이 프로젝트에 없습니다.
  `@vitejs/plugin-react`와 빌드 시 사용하는 `react-dom/server`를 해당 패키지로 취급하지 않았습니다.
  [React 공지](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3), [Vite RSC 공지](https://github.com/vitejs/vite-plugin-react/security/advisories/GHSA-59pf-q495-3c99).

## 검증과 반영 상태

- 공식 바이너리 Node 22.23.4에서 테스트 145개, 타입 검사, 프로덕션 빌드 통과.
- SSG 5,056페이지 생성 확인. 검증으로 변경된 `public/app-version.json`은 이전 내용으로 복원.
- 운영 이미지 빌드에서도 Node 22.23.4 실행과 `npm ci --omit=dev --engine-strict`의 취약점 0개를 확인했습니다.
- 로컬에도 Node 22.23.4를 설치하고 nvm 기본 버전을 22.23.4로 변경했습니다. 기존 Node 경로를 상속하지 않는 새 로그인 zsh에서 적용을 확인했습니다.
- 로컬 npm은 10.9.9이며 Firebase CLI 15.15.0도 새 Node 환경에 설치해 유지했습니다. 이미 열린 터미널은 `nvm use default`로 전환할 수 있습니다.
- 운영 런타임도 22.23.4입니다. Node 런타임 취약점은 npm audit 집계와 별도입니다.

## 운영 배포 완료

- Cloud Build: `30b40986-3484-48ce-b64b-4151f28afed2` — 성공.
- Cloud Run revision: `nikke-search-api-00057-xbc`.
- 배포 이미지 digest: `sha256:dba6a4c48756d4ffd40699c2e17edb6f1ad75f205202e1af07b47497cf935f94`.
- Firebase Hosting version: `882c64b400bbc9a2`.
- Hosting의 `/api/**` 태그 `fh-882c64b400bbc9a2`가 위 Cloud Run revision을 가리키는 것을 확인했습니다.
- 배포 자산 버전: `2026-10-21T13:53:52.858Z`. `public/app-version.json`도 실제 배포 버전으로 갱신했습니다.
- `https://nikkeforbiddenlibrary.com`과 `https://nikkeforbiddenlibrary.web.app` 모두 홈페이지·JS/CSS·버전 JSON·검색 API 정상 응답.
- AI 경로는 잘못된 메서드 405와 잘못된 요청 ID 400을 확인했습니다. 유료 답변 생성 요청은 수행하지 않았습니다.
- 기존 운영 환경변수·비밀키·리소스 설정을 유지하고 이미지만 교체했습니다.
