import { useCallback, useEffect, useRef, useState } from 'react';

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

export type DeploymentRefreshState = {
  /** 새 배포가 감지돼 새로고침을 권할 수 있는 상태 */
  hasUpdate: boolean;
  reload: () => void;
  dismiss: () => void;
};

/**
 * 새 배포를 감지하면 바로 새로고침하지 않고 hasUpdate만 켠다.
 * 읽던 화면과 선택지를 잃지 않도록 새로고침 시점은 사용자가 고른다.
 */
export function useDeploymentRefresh(): DeploymentRefreshState {
  const currentVersionRef = useRef<string | null>(null);
  const hasDetectedUpdateRef = useRef(false);
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) {
      return;
    }

    let isMounted = true;

    const syncVersion = async (shouldReloadOnChange: boolean) => {
      if (hasDetectedUpdateRef.current) {
        return;
      }

      try {
        const nextVersion = await fetchDeploymentVersion();

        if (!isMounted || !nextVersion) {
          return;
        }

        if (currentVersionRef.current === null) {
          currentVersionRef.current = nextVersion;
          return;
        }

        if (shouldReloadOnChange && currentVersionRef.current !== nextVersion) {
          hasDetectedUpdateRef.current = true;
          setHasUpdate(true);
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

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    setHasUpdate(false);
  }, []);

  return { hasUpdate, reload, dismiss };
}
