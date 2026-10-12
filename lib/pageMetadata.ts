import { SCRIPT_CATEGORIES } from '../constants';
import type { Script } from '../types';
import type { BrowserHistoryState } from './navigation';
import { pageMetadata, siteOrigin, websiteIdentity, SITE_NAME } from './seo.mjs';

export const updatePageMetadata = (state: BrowserHistoryState, script: Script | null, title: string) => {
  const metadata = pageMetadata(state, script, SCRIPT_CATEGORIES, siteOrigin(import.meta.env.VITE_SITE_URL));
  for (const [attribute, key, value] of [
    ['name', 'description', metadata.description], ['name', 'robots', metadata.robots],
    ['property', 'og:title', title], ['property', 'og:description', metadata.description],
    ['property', 'og:url', metadata.canonical],
    ['property', 'og:site_name', SITE_NAME],
  ]) {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!value) { element?.remove(); continue; }
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = value;
  }
  let identity = document.head.querySelector<HTMLScriptElement>('#website-identity');
  if (metadata.robots === 'index,follow' && metadata.canonical) {
    if (!identity) {
      identity = document.createElement('script');
      identity.id = 'website-identity';
      identity.type = 'application/ld+json';
      document.head.append(identity);
    }
    identity.textContent = JSON.stringify(websiteIdentity(new URL(metadata.canonical).origin));
  } else identity?.remove();
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!metadata.canonical) { canonical?.remove(); return; }
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  canonical.href = metadata.canonical;
};
