import { escapeHtml, renderMetadata } from '../lib/seo.mjs';
import { categoryPath, scenePath, parsePagePath } from '../lib/pageRoutes.mjs';

export const pagePaths = (manifest, categories) => {
  const paths = ['/', ...categories.map(item => categoryPath(item.key))];
  const ids = new Set();
  for (const script of manifest) {
    const pathname = scenePath(script.categoryKey, script.id);
    if (!parsePagePath(pathname) || ids.has(script.id) || !categories.some(category => category.key === script.categoryKey)) {
      throw new Error(`Invalid or duplicate scene route: ${script.id}`);
    }
    ids.add(script.id);
    paths.push(pathname);
  }
  return paths;
};

export const renderPageDocument = (template, { html, metadata }) => {
  if (!template.includes('<div id="root"></div>')) throw new Error('Missing SSG root placeholder');
  return template.replace(/<title>[\s\S]*?<\/title>/, () => renderMetadata(metadata))
    .replace('<div id="root"></div>', () => `<div id="root" data-prerendered="true">${html}</div>`);
};

export const renderSitemap = (paths, origin) => {
  if (paths.length > 50000) throw new Error('Sitemap exceeds 50,000 URLs; split it before deploying.');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(pathname => `<url><loc>${escapeHtml(origin + pathname)}</loc></url>`).join('\n')}\n</urlset>\n`;
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw new Error('Sitemap exceeds 50 MB.');
  return xml;
};
