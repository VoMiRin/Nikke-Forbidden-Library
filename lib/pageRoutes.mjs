export const categoryPath = (categoryKey) => `/stories/${encodeURIComponent(categoryKey)}/`;
export const scenePath = (categoryKey, scriptId) => `${categoryPath(categoryKey)}${encodeURIComponent(scriptId)}/`;

export const parsePagePath = (pathname) => {
  const match = pathname.match(/^\/stories\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  try {
    const categoryKey = decodeURIComponent(match[1]);
    const scriptId = match[2] ? decodeURIComponent(match[2]) : null;
    if (!/^[a-z0-9_]+$/.test(categoryKey) || (scriptId && (/[/\\\u0000-\u001f?#]/.test(scriptId) || scriptId === '.' || scriptId === '..'))) return null;
    return { categoryKey, scriptId };
  } catch { return null; }
};
