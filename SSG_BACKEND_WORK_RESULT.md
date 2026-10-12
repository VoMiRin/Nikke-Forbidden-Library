# SSG·백엔드 추가 작업 결과

작성일: 2026-10-12 (Asia/Seoul)

## 최신 SEO 방침: 사이트명으로 홈페이지 찾기

사용자가 SEO 목표를 **“니케 금서고”로 사이트 찾기만**으로 확정했다. 아래 최초 SSG 작업 기록 중 사이트맵의 전체 장면 등록과 장면·분류 색인 방침은 다음 설정으로 대체했다.

- 홈페이지 제목·소개·OG 사이트명을 “니케 금서고”로 통일하고, 홈에만 WebSite JSON-LD를 생성한다. 앱 내부 이동 시에도 사이트명 정보와 색인 설정을 갱신한다.
- sitemap.xml은 홈페이지 1개 URL만 포함한다.
- 장면·분류는 정적 HTML에서 `noindex,follow`, Hosting 응답에서도 `X-Robots-Tag: noindex, follow`를 제공한다. 원문 TXT와 검색용 JSON도 HTTP 헤더로 색인을 제외한다.
- noindex를 읽을 수 있도록 장면·원문 경로를 robots.txt로 막지 않는다.
- SSG 전체 페이지 생성, 사이트 안의 검색·탐색·공유, 새 스토리 추가 시 자동 빌드는 유지한다.
- 기존 쿼리 주소는 앞서 설명한 정적 Hosting 제약이 그대로 적용된다. 처음에는 홈 HTML을 받고 JS 실행 후 noindex·해당 화면의 메타데이터로 전환된다.
- 운영 배포와 Search Console 등록은 수행하지 않았다. 특정 검색어에서만 노출되도록 강제하거나 검색 순위를 보장하는 설정은 아니다.
- 검증: 타입 검사·관련 테스트·전체 빌드 통과. 생성된 비홈 HTML 4,062개의 noindex, 홈 1개 사이트맵, 실제 Hosting 헤더, 브라우저의 홈 → 분류 → 장면 → 홈 이동 시 색인 설정·사이트명 복원을 확인했다.

근거: [Google 사이트명 안내](https://developers.google.com/search/docs/appearance/site-names), [noindex 안내](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

아래는 이전 작업 기록이다.

요청 범위: SSG와 백엔드. 기존 디자인과 읽기 옵션은 유지하며, 사전 렌더링과 주소 연결에 필요한 프런트 연동만 수정했다. 로컬 구현·검증 완료이며 운영 배포 전이다.

## 1. SSG

`npm run build`가 검색 자산 생성 → Vite 클라이언트 빌드 → SSG 순서로 실행된다.

| 항목 | 결과 |
| --- | --- |
| 홈 | `/` |
| 8개 분류 | `/stories/<categoryKey>/` |
| 4,054개 장면 | `/stories/<categoryKey>/<scriptId>/` |
| 총 페이지 | 4,063개, HTML 약 523.3 MiB (압축 전) |
| 검색엔진용 자료 | 장면별 title·description·canonical·Open Graph, sitemap.xml, robots.txt |
| 오류 주소 | Firebase의 실제 HTTP 404와 별도 noindex 404.html |

기존 `App`과 `ScriptViewer`를 React 서버 렌더러로 빌드 때 실행한다. 검색엔진에만 별도 본문을 제공하지 않는다. 본문·화자·현재 기본 선택지 화면은 첫 HTML에 들어 있고, 브라우저에서도 같은 컴포넌트를 사용한다. 클라이언트는 매니페스트와 해당 장면 원문이 준비될 때까지 생성된 HTML을 유지한 뒤 `createRoot`로 조작 가능한 화면을 마운트한다. React hydration 방식은 아니다.

일반 검색의 전체 인덱스나 전체 원문을 각 HTML의 초기 데이터로 복제하지 않는다. 현재 HTML 용량에는 기존 화면의 사이드바·타이틀 목록과 장면 마크업이 포함된다. 배포 산출물 증가량은 위 표와 같다.

빌드 중 등록된 원문 파일이 없거나 장면이 비어 있거나 ID가 중복되거나 본문이 렌더링되지 않으면 실패한다. 기존 배포 스크립트는 빌드 실패 시 다음 단계로 진행하지 않는다. SSG 재실행 때 삭제된 장면의 생성 디렉터리도 정리한다. sitemap에는 생성한 정규 주소만 넣고 확인하지 않은 수정 날짜는 기재하지 않는다.

대표 도메인은 `VITE_SITE_URL`이며 기본값은 `https://nikkeforbiddenlibrary.com`이다. `.env.example`에 설정을 추가했다. 경로·쿼리·인증정보가 포함된 주소는 받지 않는다. 대표 도메인을 바꾸면 전체 빌드를 다시 해야 한다.

주요 파일:

- `scripts/buildStaticPages.mjs`: 빌드·원문 검증·정적 페이지 출력
- `scripts/ssgEntry.tsx`: 기존 React 화면 사전 렌더링
- `scripts/staticPages.mjs`: 경로 목록·HTML 조립·사이트맵
- `lib/pageRoutes.mjs`, `lib/seo.mjs`: 서버·클라이언트 공통 주소와 메타데이터
- `firebase.json`: 생성 HTML 재검증 캐시, trailing slash, API rewrite 유지, 전체 SPA fallback 제거

## 2. SSG에 필요한 프런트 연동

프런트 담당자가 확인할 변경점이다. 화면 디자인, 모든 분기 보기, 줄 간격·본문 폭 설정은 이번 작업에 포함하지 않았다.

- `App.tsx`, `hooks/useScriptIndexing.ts`, `hooks/useScriptNavigation.ts`: 초기 매니페스트·장면·주소 상태를 주입할 수 있게 변경했다.
- `components/ScriptViewer.tsx`: 빌드 때 전달받은 원문을 첫 렌더에 사용한다. 기존 비동기 로딩과 요청 경합 방지는 유지한다. 링크 복사는 장면 정규 주소를 사용한다.
- `index.tsx`: 정적 HTML을 표시한 채 초기 데이터를 준비한다. 데이터 준비 실패 시 기존 앱의 재시도·오류 처리 경로로 돌아간다.
- `lib/navigation.ts`: 새 경로와 기존 `?view=script&category=...&script=...` 주소를 모두 읽는다. 이후 주소 기록은 새 경로를 사용하며 검색 강조·검색 화면 상태를 보존한다.
- `StoriesPage.tsx`, `Sidebar.tsx`: 분류·타이틀·장면 이동을 실제 `a href`로 연결했다. 보통 클릭은 앱 안에서 이동하며 Ctrl/Cmd·가운데 클릭은 브라우저의 새 탭 동작을 유지한다. 선택된 타이틀은 초기 렌더부터 펼친다.
- `Header.tsx`: 홈 링크를 절대 경로 `/`로 고쳐 중첩 주소에서도 홈으로 이동한다.
- `lib/pageMetadata.ts`: 앱 안에서 이동해도 canonical·description·OG 정보를 갱신한다. 검색·AI·화자 목록은 클라이언트에서 noindex를 지정한다.

**범위와 제한:** 예전 쿼리 주소는 정적 Hosting의 `/index.html`을 먼저 받으며, 브라우저 실행 후 해당 장면 주소와 메타데이터로 전환된다. 쿼리별 HTTP 리다이렉트나 서버별 메타데이터 응답을 구현한 것은 아니다. 새 경로는 처음부터 장면별 HTML을 반환하므로 sitemap과 크롤링 링크에는 새 경로를 사용한다. 선택지의 미선택 분기 전체를 HTML에 펼치는 기능은 포함하지 않았으며 기존 화면의 기본 상태와 일치한다.

## 3. AI 출처의 장면 연결

`retrievedContext.title`을 기존처럼 로컬 매니페스트의 정확한 파일명에 대조하고, 추가로 `retrievedContext.text`를 해당 원문 파일의 장면별 본문과 비교한다.

장면 링크를 만드는 조건:

1. 현재 매니페스트에 등록된 출처 파일이다.
2. 인용 문맥에서 SCRIPT_ID/SUB_TITLE 줄을 제거하고 NFKC·공백을 정규화했을 때 공백 제외 24자 이상이다.
3. 인용 문맥 전체가 그 파일의 정확히 한 장면에만 연속해서 존재한다.
4. 문맥에 SCRIPT_ID가 있으면 그 장면 ID와 같아야 한다. 여러 SCRIPT_ID가 포함된 문맥은 한 장면으로 연결하지 않는다.

조건을 충족하면 다음 구조를 반환한다.

```json
{
  "kind": "scene",
  "categoryKey": "main_story",
  "scriptId": "main_00_00",
  "title": "Chapter.00: 추락",
  "subTitle": "첫 번째 접촉: A"
}
```

인용 문맥이 없거나 짧거나 중복되거나 여러 장면에 걸치거나 원문과 맞지 않으면 기존 타이틀/분류 링크를 유지한다. 원문 파일 읽기가 실패해도 AI 답변 자체는 실패시키지 않는다. 알 수 없는 파일·메타데이터 출처는 계속 링크 없이 표시한다.

같은 파일에서 서로 다른 장면을 인용하면 장면별 링크를 각각 유지한다. 같은 장면의 반복 출처만 합친다. 이 필드는 기존 저장 경로로 저장되고 Firestore 복구 때도 유지된다. 기존 저장 답변에 문맥을 소급 수집하거나 링크를 마이그레이션하지 않았다.

원문은 AI가 제시한 임의 경로에서 읽지 않고 로컬 매니페스트로만 결정한다. 필요할 때 파일을 읽고 최대 32개 파일을 캐시한다. Cloud Run Docker 이미지에 원문과 필요한 공통 모듈을 추가했다. 필요하면 `SCRIPT_SOURCE_ROOT`로 원문 루트를 지정할 수 있다.

주요 파일: `server/groundingSources.mjs`, `server/index.mjs`, `lib/scriptBlocks.mjs`, `lib/sourceLinks.mjs`, `server/Dockerfile`. `AiAskPanel.tsx`에는 장면 링크 이름 표시와 같은 파일의 여러 장면에 대한 React key 처리만 추가했다.

**확인 범위:** 제공자의 문맥 필드 정의, 로컬 실제 원문과 모의 제공자 응답으로 검증했다. 새 유료 AI 요청은 하지 않았다. 실제 응답에서 문맥이 생략되는 비율이나 운영 연결률은 이번 검증으로 알 수 없다.

## 4. 검색 서버 보강

- 동시 첫 검색 요청들이 검색 인덱스 파일 읽기·파싱 한 번을 공유한다. 로딩 실패 후에는 다시 시도할 수 있다.
- `/api/search`는 GET만 허용하며 다른 메서드는 Allow 헤더와 405를 반환한다.
- 요청 URL 해석에 클라이언트의 Host 헤더를 사용하지 않는다. 잘못된 URL은 400으로 처리한다.

## 5. 검증

- `npm run typecheck`: 통과
- `npm test`: 79개 통과
- `npm run build`: 4,063개 페이지 생성 완료
- `npm run build:ssg`: 기존 생성물 위 재실행 확인
- `git diff --check`: 통과

Firebase Hosting 에뮬레이터와 Chromium으로 다음을 확인했다. 테스트 설정은 로컬 `dist`를 제공하고 Cloud Run rewrite는 제거했다. 실제 API 동작은 별도 HTTP 통합 테스트가 확인한다.

- 장면별 원본 HTML의 본문·메타데이터, sitemap 전체 URL 수, robots, CSP·캐시 헤더
- 슬래시 없는 주소의 301, 특수문자가 있는 장면 주소, 없는 장면의 실제 404
- JavaScript를 꺼도 홈 → 분류 → 장면 → 같은 타이틀의 다음 장면을 링크로 열 수 있음
- 기존 공유 URL → 새 장면 주소, 새로고침, 뒤로가기, 키보드 다음 장면, 홈 복귀
- Ctrl-click 새 탭과 AI 장면 출처 새 탭 연결
- AI 화면의 noindex, 모바일 390px 가로 넘침 없음, 브라우저 실행 오류 없음

## 6. 후속 작업

- 운영 배포와 배포 후 실제 경로·캐시 확인
- Search Console에서 사이트맵 제출 및 실제 색인 결과 확인 (이번에는 접근하거나 변경하지 않음)
- 검수된 캐릭터 별칭 데이터가 정해지면 별칭 통합 반영

전체 분기 보기와 읽기 설정은 프런트 담당 범위로 남긴다. 이어 읽기와 선택지 영속 저장은 기존 제외 방침을 유지한다.

## 참고한 공식 문서

- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics): 크롤링 가능한 링크와 사전 렌더링
- [Firebase Hosting 설정](https://firebase.google.com/docs/hosting/full-config): 정적 파일 우선순위·trailingSlash·rewrite
- [Gemini RetrievedContext](https://ai.google.dev/api/generate-content#RetrievedContext): 선택적으로 제공되는 출처 문맥 `text`
