// Only generate internal URLs from structured fields, never trust a model URL.
import { scenePath, parsePagePath } from './pageRoutes.mjs';
/** @returns {{kind: 'category', categoryKey: string} | {kind: 'chapter', categoryKey: string, title: string} | {kind: 'scene', categoryKey: string, title: string, scriptId: string, subTitle?: string} | null} */
export const normalizeSourceTarget = (target) => {
  if (!target || typeof target !== 'object'
    || typeof target.categoryKey !== 'string' || !/^[a-z0-9_]+$/.test(target.categoryKey)) return null;
  if (target.kind === 'category') return { kind: 'category', categoryKey: target.categoryKey };
  if (target.kind === 'chapter' && typeof target.title === 'string' && target.title.trim()) {
    return { kind: 'chapter', categoryKey: target.categoryKey, title: target.title };
  }
  if (target.kind === 'scene' && typeof target.scriptId === 'string' && target.scriptId
    && parsePagePath(scenePath(target.categoryKey, target.scriptId))
    && typeof target.title === 'string' && target.title.trim()) {
    return { kind: 'scene', categoryKey: target.categoryKey, scriptId: target.scriptId, title: target.title,
      ...(typeof target.subTitle === 'string' && target.subTitle ? { subTitle: target.subTitle } : {}) };
  }
  return null;
};

export const sourceTargetUrl = (value) => {
  const target = normalizeSourceTarget(value);
  if (!target) return null;
  if (target.kind === 'scene') return scenePath(target.categoryKey, target.scriptId);
  const params = new URLSearchParams({ view: 'stories', category: target.categoryKey });
  if (target.kind === 'chapter') params.set('title', target.title);
  return `/?${params}`;
};
