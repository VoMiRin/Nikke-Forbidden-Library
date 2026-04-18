export const buildVersionedAssetUrl = (path: string, version?: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!version) {
    return normalizedPath;
  }

  const url = new URL(normalizedPath, window.location.origin);
  url.searchParams.set('v', version);
  return `${url.pathname}${url.search}`;
};
