import { useEffect, useRef } from 'react';

const APP_VERSION_PATH = '/app-version.json';
const VERSION_CHECK_INTERVAL_MS = 60_000;

type AppVersionPayload = {
  version?: string;
};

const fetchDeploymentVersion = async (): Promise<string | null> => {
  const url = new URL(APP_VERSION_PATH, window.location.origin);
  url.searchParams.set('t', Date.now().toString());

  const response = await fetch(`${url.pathname}${url.search}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load app version. HTTP ${response.status}`);
  }

  const payload = await response.json() as AppVersionPayload;
  return typeof payload.version === 'string' && payload.version.trim()
    ? payload.version
    : null;
};

export function useDeploymentRefresh(): void {
  const currentVersionRef = useRef<string | null>(null);
  const isReloadingRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) {
      return;
    }

    let isMounted = true;

    const syncVersion = async (shouldReloadOnChange: boolean) => {
      try {
        const nextVersion = await fetchDeploymentVersion();

        if (!isMounted || !nextVersion) {
          return;
        }

        if (currentVersionRef.current === null) {
          currentVersionRef.current = nextVersion;
          return;
        }

        if (shouldReloadOnChange && currentVersionRef.current !== nextVersion && !isReloadingRef.current) {
          isReloadingRef.current = true;
          window.location.reload();
          return;
        }

        currentVersionRef.current = nextVersion;
      } catch (error) {
        console.warn('Failed to check for a newer deployment.', error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncVersion(true);
      }
    };

    const handleFocus = () => {
      void syncVersion(true);
    };

    void syncVersion(false);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void syncVersion(true);
      }
    }, VERSION_CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
}
