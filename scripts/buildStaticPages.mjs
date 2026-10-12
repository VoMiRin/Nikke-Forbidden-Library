import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, loadEnv } from 'vite';
import { splitScriptBlocks } from '../lib/scriptBlocks.mjs';
import { scenePath } from '../lib/pageRoutes.mjs';
import { siteOrigin, escapeHtml } from '../lib/seo.mjs';
import { pagePaths, renderPageDocument, renderSitemap } from './staticPages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const env = loadEnv('production', root, 'VITE_');
const origin = siteOrigin(process.env.VITE_SITE_URL ?? env.VITE_SITE_URL);
const templateCache = path.join(root, '.generated-ssg/client-template.html');
let template = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
if (template.includes('data-prerendered="true"')) template = await fs.readFile(templateCache, 'utf8');
await build({ root, logLevel: 'warn', build: { ssr: 'scripts/ssgEntry.tsx', outDir: '.generated-ssg', copyPublicDir: false, emptyOutDir: true } });
await fs.writeFile(templateCache, template);
const { renderPage, categories } = await import(pathToFileURL(path.join(root, '.generated-ssg/ssgEntry.js')));
const manifest = JSON.parse(await fs.readFile(path.join(dist, 'script-manifest.json'), 'utf8'));
const paths = pagePaths(manifest, categories);
const scenes = new Map(manifest.map(script => [scenePath(script.categoryKey, script.id), script]));
const files = new Map();
let totalBytes = 0;
const indexablePaths = [];

// This directory contains only generated routes; remove pages deleted from the manifest.
await fs.rm(path.join(dist, 'stories'), { recursive: true, force: true });

for (const pathname of paths) {
  const script = scenes.get(pathname);
  let content;
  if (script) {
    const file = path.resolve(root, 'public/scripts', script.categoryKey, script.mainChapterFile);
    if (!file.startsWith(path.join(root, 'public/scripts') + path.sep)) throw new Error(`Invalid source path: ${file}`);
    if (!files.has(file)) files.set(file, splitScriptBlocks(await fs.readFile(file, 'utf8')));
    content = files.get(file).get(script.id);
    if (!content) throw new Error(`SSG source missing or empty: ${script.id} in ${file}`);
  }
  const rendered = renderPage(manifest, pathname, content, origin);
  if (rendered.metadata.robots === 'index,follow') indexablePaths.push(pathname);
  if (script && (!rendered.html.includes('id="script-title"') || !rendered.html.includes('id="script-element-'))) {
    throw new Error(`SSG rendered no scene body: ${script.id}`);
  }
  const html = renderPageDocument(template, rendered);
  // URL encoding belongs in links, not directory names. Hosting decodes the URL.
  const directory = path.join(dist, decodeURIComponent(pathname));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'index.html'), html);
  totalBytes += Buffer.byteLength(html);
}

await fs.writeFile(path.join(dist, 'sitemap.xml'), renderSitemap(indexablePaths, origin));
await fs.writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
await fs.writeFile(path.join(dist, '404.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>기록을 찾을 수 없습니다 | 금서고</title></head><body><h1>기록을 찾을 수 없습니다</h1><p>주소를 확인하거나 <a href="${escapeHtml(origin)}/">금서고에서 기록을 찾아보세요.</a></p></body></html>`);
console.log(`SSG: ${paths.length} pages, ${(totalBytes / 1024 / 1024).toFixed(1)} MB HTML; sitemap.xml and robots.txt generated.`);
