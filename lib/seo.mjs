import { categoryPath, scenePath } from './pageRoutes.mjs';

export const SITE_NAME = '니케 금서고';
export const HOME_TITLE = `${SITE_NAME} | Nikke Forbidden Library`;
export const DEFAULT_SITE_ORIGIN = 'https://nikkeforbiddenlibrary.com';
export const HOME_DESCRIPTION = '니케 금서고는 승리의 여신: 니케의 스토리 기록을 모은 사이트입니다. 메인 스토리, 이벤트, 니케 에피소드의 대사와 화자를 검색하고 원문을 확인하세요.';

export const websiteIdentity = origin => ({
  '@context': 'https://schema.org', '@type': 'WebSite',
  name: SITE_NAME, alternateName: ['금서고', 'Nikke Forbidden Library'], url: origin + '/',
});

export const siteOrigin = (value = DEFAULT_SITE_ORIGIN) => {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SITE_URL must be an HTTP(S) origin without a path, query or credentials.');
  }
  return url.origin;
};

export const pageMetadata = (state, script, categories, origin = DEFAULT_SITE_ORIGIN) => {
  const category = categories.find(item => item.key === state.categoryKey);
  if (state.view === 'script_viewer' && script) {
    const label = [script.subTitle, script.title].filter(Boolean).join(' · ');
    return { title: `${label} | ${SITE_NAME}`, description: `승리의 여신: 니케 ${category?.name ?? ''} — ${label}. 장면의 대사와 원문 기록을 확인하세요.`, canonical: origin + scenePath(script.categoryKey, script.id), robots: 'noindex,follow' };
  }
  if (state.view === 'stories' && category) {
    return { title: `${category.name} | ${SITE_NAME}`, description: `승리의 여신: 니케 ${category.name}의 타이틀과 장면별 원문 기록.`, canonical: origin + categoryPath(category.key), robots: 'noindex,follow' };
  }
  const home = state.view === 'stories' && !state.categoryKey;
  return { title: HOME_TITLE, description: HOME_DESCRIPTION, canonical: home ? origin + '/' : null, robots: home ? 'index,follow' : 'noindex,follow' };
};

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);

export const renderMetadata = (metadata) => [
  `<title>${escapeHtml(metadata.title)}</title>`,
  `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
  `<meta name="robots" content="${escapeHtml(metadata.robots)}" />`,
  `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
  `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
  '<meta property="og:type" content="website" />',
  '<meta property="og:locale" content="ko_KR" />',
  `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
  ...(metadata.robots === 'index,follow' && metadata.canonical ? [
    `<script id="website-identity" type="application/ld+json">${JSON.stringify(websiteIdentity(new URL(metadata.canonical).origin)).replace(/</g, '\\u003c')}</script>`,
  ] : []),
  ...(metadata.canonical ? [
    `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" />`,
    `<meta property="og:url" content="${escapeHtml(metadata.canonical)}" />`,
  ] : []),
].join('\n');
