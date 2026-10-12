import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../App';
import { buildScripts } from '../data/scriptLoader';
import { parseHistoryStateFromLocation } from '../lib/navigation';
import { SCRIPT_CATEGORIES } from '../constants';
import { pageMetadata } from '../lib/seo.mjs';
import type { ScriptManifestEntry } from '../types';

export const categories = SCRIPT_CATEGORIES.map(({ key, name }) => ({ key, name }));

export const renderPage = (manifest: ScriptManifestEntry[], pathname: string, content: string | undefined, origin: string) => {
  const history = parseHistoryStateFromLocation('', pathname);
  const scripts = buildScripts(manifest);
  const selected = scripts.find(script => script.id === history.scriptId && script.categoryKey === history.categoryKey);
  if (selected) selected.content = content;
  return {
    html: renderToString(<App initialData={{ scripts, history }} />),
    metadata: pageMetadata(history, selected, categories, origin),
  };
};
