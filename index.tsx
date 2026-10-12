import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { buildScripts } from './data/scriptLoader';
import { parseHistoryStateFromLocation } from './lib/navigation';
import type { AppInitialData } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const start = async () => {
  let initialData: AppInitialData | undefined;
  // Leave the generated HTML visible until its data is ready. The interactive
  // application uses the same components; no bot-specific rendering is involved.
  if (rootElement.hasAttribute('data-prerendered')) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      initialData = await Promise.race([
        (async () => {
          const response = await fetch('/script-manifest.json', { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error('Manifest unavailable');
          const scripts = buildScripts(await response.json());
          const history = parseHistoryStateFromLocation(window.location.search, window.location.pathname);
          const script = scripts.find(item => item.id === history.scriptId && item.categoryKey === history.categoryKey);
          if (script) script.content = await script.loadContent();
          return { scripts, history };
        })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Initial data timed out')), 15000); }),
      ]);
    } catch (error) {
      console.warn('Prerender data could not be loaded; retrying in the application.', error);
    } finally {
      clearTimeout(timeout);
    }
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App initialData={initialData} />
    </ErrorBoundary>
  </React.StrictMode>
);
};
void start();
