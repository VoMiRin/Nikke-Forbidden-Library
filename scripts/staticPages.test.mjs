import assert from 'node:assert/strict';
import test from 'node:test';
import { pagePaths, renderPageDocument, renderSitemap } from './staticPages.mjs';
import { pageMetadata, siteOrigin } from '../lib/seo.mjs';
import { parsePagePath } from '../lib/pageRoutes.mjs';
import { splitScriptBlocks } from '../lib/scriptBlocks.mjs';

const categories = [{ key: 'main_story', name: '메인 스토리' }];
const script = { id: "queen's_00", categoryKey: 'main_story', title: '제목 <script> & "', subTitle: '단서' };

test('SSG and sitemap cover each registered scene exactly once using stable escaped URLs', () => {
  const paths = pagePaths([script], categories);
  assert.deepEqual(paths, ['/', '/stories/main_story/', "/stories/main_story/queen's_00/"]);
  const xml = renderSitemap(paths, 'https://example.test');
  assert.equal((xml.match(/<loc>/g) ?? []).length, 3);
  assert.match(xml, /queen&#39;s_00/);
  assert.doesNotMatch(xml, /<lastmod>/); // No invented modification dates.
  assert.throws(() => pagePaths([script, script], categories), /duplicate/);
  assert.throws(() => pagePaths([{ ...script, id: '../escape' }], categories), /Invalid/);
  for (const path of ['/stories/main_story/%2e%2e/', '/stories/main_story/%2Fetc/', '/stories/main_story/%zz/', '/stories/main_story/%5Cescape/']) {
    assert.equal(parsePagePath(path), null);
  }
});

test('generated metadata is scene-specific, escaped and independent of focus queries', () => {
  const metadata = pageMetadata({ view: 'script_viewer', categoryKey: 'main_story' }, script, categories, 'https://example.test');
  const html = renderPageDocument('<title>old</title><div id="root"></div>', { html: '<main>본문 $&</main>', metadata });
  assert.match(html, /data-prerendered="true"><main>본문 \$&<\/main>/);
  assert.match(html, /제목 &lt;script&gt; &amp; &quot;/);
  assert.match(html, /rel="canonical" href="https:\/\/example.test\/stories\/main_story\/queen&#39;s_00\//);
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.equal(pageMetadata({ view: 'search' }, null, categories).robots, 'noindex,follow');
  assert.equal(pageMetadata({ view: 'script_viewer' }, null, categories).canonical, null);
  assert.throws(() => renderPageDocument('<div>changed template</div>', { html: '', metadata }), /placeholder/);
});

test('brand discovery indexes only the home page and identifies the site there', () => {
  const home = pageMetadata({ view: 'stories', categoryKey: null }, null, categories, 'https://example.test');
  const category = pageMetadata({ view: 'stories', categoryKey: 'main_story' }, null, categories, 'https://example.test');
  const scene = pageMetadata({ view: 'script_viewer', categoryKey: 'main_story' }, script, categories, 'https://example.test');
  const pages = [{ path: '/', metadata: home }, { path: '/stories/main_story/', metadata: category }, { path: "/stories/main_story/queen's_00/", metadata: scene }];
  const sitemap = renderSitemap(pages.filter(page => page.metadata.robots === 'index,follow').map(page => page.path), 'https://example.test');
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 1);
  assert.doesNotMatch(sitemap, /stories/);
  assert.match(home.title, /^니케 금서고/);
  assert.match(home.description, /^니케 금서고/);
  const template = '<title>old</title><div id="root"></div>';
  const html = renderPageDocument(template, { html: '<main>니케 금서고</main>', metadata: home });
  const identity = JSON.parse(html.match(/<script id="website-identity" type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(identity.name, '니케 금서고');
  assert.equal(identity.url, 'https://example.test/');
  assert.equal(identity['@type'], 'WebSite');
  assert.doesNotMatch(renderPageDocument(template, { html: '본문', metadata: scene }), /website-identity/);
  for (const view of ['search', 'ai_chat', 'speakers']) {
    assert.equal(pageMetadata({ view }, null, categories).robots, 'noindex,follow');
  }
});

test('canonical origin rejects paths, credentials and non-HTTP protocols', () => {
  assert.equal(siteOrigin('https://example.test/'), 'https://example.test');
  for (const url of ['https://example.test/path', 'https://user:pass@example.test', 'javascript:alert(1)', 'https://example.test/?q=x']) {
    assert.throws(() => siteOrigin(url));
  }
});

test('source blocks preserve dialogue and boundaries; duplicate IDs fail the build', () => {
  const text = '@@@SCRIPT_ID: one\r\n@@@SUB_TITLE: 제목\r\n라피: 본문\r\n@@@SCRIPT_ID: two\n아니스: 다음';
  assert.deepEqual([...splitScriptBlocks(text)], [['one', '라피: 본문'], ['two', '아니스: 다음']]);
  assert.throws(() => splitScriptBlocks('@@@SCRIPT_ID: one\na\n@@@SCRIPT_ID: one\nb'), /Duplicate/);
});
