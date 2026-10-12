import { splitScriptBlocks } from '../lib/scriptBlocks.mjs';

export const buildSourceLookup = (manifest) => {
  const files = new Map();
  for (const script of manifest) {
    if (!script.categoryKey || !script.mainChapterFile) continue;
    const relativePath = `public/scripts/${script.categoryKey}/${script.mainChapterFile}`;
    const displayName = relativePath.replaceAll('/', '__');
    if (!files.has(displayName)) files.set(displayName, []);
    files.get(displayName).push(script);
  }
  const lookup = new Map();
  for (const [displayName, scripts] of files) {
    const categories = new Set(scripts.map(script => script.categoryKey));
    if (categories.size !== 1) continue;
    const titles = new Set(scripts.map(script => script.title));
    lookup.set(displayName, titles.size === 1
      ? { kind: 'chapter', categoryKey: scripts[0].categoryKey, title: scripts[0].title }
      : { kind: 'category', categoryKey: scripts[0].categoryKey });
  }
  return lookup;
};
const normalizeEvidence = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();

export const resolveSceneTarget = (context, scenes) => {
  if (typeof context?.text !== 'string' || !Array.isArray(scenes)) return null;
  const markers = [...context.text.matchAll(/^@@@SCRIPT_ID:\s*([^\r\n]+)/gm)].map(match => match[1].trim());
  if (markers.length > 1) return null;
  const evidence = normalizeEvidence(context.text.replace(/^@@@(?:SCRIPT_ID|SUB_TITLE):[^\r\n]*\r?$/gm, ''));
  // Short stock phrases and IDs alone are not enough to identify an actual quotation.
  if (evidence.replace(/\s/g, '').length < 24) return null;
  const matches = scenes.filter(scene => scene.text.includes(evidence));
  if (matches.length !== 1 || (markers.length && markers[0] !== matches[0].id)) return null;
  const { id, categoryKey, title, subTitle } = matches[0];
  return { kind: 'scene', categoryKey, scriptId: id, title, ...(subTitle ? { subTitle } : {}) };
};

// Read only files selected through the local manifest. Never use a model-supplied path.
export const createGroundingResolver = (manifest, readChapter, onError = () => {}) => {
  const fallback = buildSourceLookup(manifest);
  const files = new Map();
  for (const script of manifest) {
    const name = `public/scripts/${script.categoryKey}/${script.mainChapterFile}`.replaceAll('/', '__');
    if (!files.has(name)) files.set(name, []);
    files.get(name).push(script);
  }
  const cache = new Map();
  const readScenes = async title => {
    if (!fallback.has(title)) return undefined;
    if (!cache.has(title)) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      const scripts = files.get(title);
      const pending = Promise.resolve().then(() => readChapter(scripts[0])).then(text => {
        const blocks = splitScriptBlocks(text);
        return scripts.filter(script => blocks.has(script.id)).map(script => ({ ...script, text: normalizeEvidence(blocks.get(script.id)) }));
      }).catch(error => { cache.delete(title); onError(error); return undefined; });
      cache.set(title, pending);
    }
    return cache.get(title);
  };
  return async metadata => {
    const scenesBySource = new Map();
    for (const chunk of metadata?.groundingChunks ?? []) {
      const context = chunk.retrievedContext;
      if (typeof context?.text === 'string' && context.text && !scenesBySource.has(context.title)) {
        scenesBySource.set(context.title, await readScenes(context.title));
      }
    }
    return summarizeGrounding(metadata, fallback, scenesBySource);
  };
};

export const summarizeGrounding = (metadata, lookup = new Map(), scenesBySource = new Map()) => {
  const sources = [];
  const seenTitles = new Set();
  for (const chunk of metadata?.groundingChunks ?? []) {
    const context = chunk.retrievedContext;
    const title = context?.title;
    if (typeof title !== 'string' || !title) continue;
    const target = resolveSceneTarget(context, scenesBySource.get(title)) ?? lookup.get(title);
    const sourceKey = JSON.stringify([title, target?.kind === 'scene' ? target.scriptId : null]);
    if (seenTitles.has(sourceKey)) continue;
    seenTitles.add(sourceKey);
    sources.push({
      title,
      ...(typeof context.fileSearchStore === 'string' ? { fileSearchStore: context.fileSearchStore } : {}),
      ...(target ? { target } : {}),
    });
  }
  return {
    grounded: Boolean(metadata?.groundingChunks?.length || metadata?.groundingSupports?.length || metadata?.retrievalMetadata),
    sources,
    groundingChunkCount: metadata?.groundingChunks?.length ?? 0,
    groundingSupportCount: metadata?.groundingSupports?.length ?? 0,
  };
};
