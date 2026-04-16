import { useState, useEffect, useRef } from 'react';
import type { Script, ScriptManifestEntry } from '../types';
import { buildScripts } from '../data/scriptLoader';

interface UseScriptIndexingReturn {
    scripts: Script[];
    isLoadingInitialData: boolean;
    isIndexing: boolean;
    indexingError: string | null;
    initialLoadAndIndexComplete: React.MutableRefObject<boolean>;
}

export function useScriptIndexing(): UseScriptIndexingReturn {
    const [scripts, setScripts] = useState<Script[]>([]);
    const [isLoadingInitialData, setIsLoadingInitialData] = useState<boolean>(true);
    const [isIndexing] = useState<boolean>(false);
    const [indexingError, setIndexingError] = useState<string | null>(null);
    const initialLoadAndIndexComplete = useRef(false);

    useEffect(() => {
        let isMounted = true;
        initialLoadAndIndexComplete.current = false;

        const loadManifest = async () => {
            try {
                setIsLoadingInitialData(true);
                setIndexingError(null);
                const response = await fetch('/script-manifest.json');

                if (!response.ok) {
                    throw new Error(`Failed to load script manifest. HTTP ${response.status}`);
                }

                const manifest = await response.json() as ScriptManifestEntry[];
                const processedScripts = buildScripts(manifest);

                if (isMounted) {
                    setScripts(processedScripts);
                    initialLoadAndIndexComplete.current = true;
                }
            } catch (e) {
                if (isMounted) {
                    setIndexingError("A critical error occurred while loading the script manifest.");
                    console.error("Manifest loading error:", e);
                }
            } finally {
                if (isMounted) {
                    setIsLoadingInitialData(false);
                }
            }
        };

        loadManifest();
        return () => { isMounted = false; };
    }, []);

    return {
        scripts,
        isLoadingInitialData,
        isIndexing,
        indexingError,
        initialLoadAndIndexComplete,
    };
}
