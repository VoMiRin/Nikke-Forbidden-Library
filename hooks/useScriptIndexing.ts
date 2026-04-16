import { useState, useEffect, useRef } from 'react';
import type { Script } from '../types';
import { ALL_SCRIPTS } from '../constants';
import { extractTextFromScriptContent } from '../utils';

const APP_INIT_DELAY = 100;

interface UseScriptIndexingReturn {
    scripts: Script[];
    isLoadingInitialData: boolean;
    isIndexing: boolean;
    indexingError: string | null;
    initialLoadAndIndexComplete: React.MutableRefObject<boolean>;
}

export function useScriptIndexing(): UseScriptIndexingReturn {
    const [initialScriptsMetadata, setInitialScriptsMetadata] = useState<Script[]>([]);
    const [scripts, setScripts] = useState<Script[]>([]);

    const [isLoadingInitialData, setIsLoadingInitialData] = useState<boolean>(true);
    const [isIndexing, setIsIndexing] = useState<boolean>(false);
    const [indexingError, setIndexingError] = useState<string | null>(null);

    const initialLoadAndIndexComplete = useRef(false);

    // Effect 1: Load initial script metadata
    useEffect(() => {
        setIsLoadingInitialData(true);
        initialLoadAndIndexComplete.current = false;

        setTimeout(() => {
            const scriptsWithPlaceholders = ALL_SCRIPTS.map(s => ({
                ...s,
                content: undefined,
                searchableContent: '',
                searchableSpeakers: '',
            }));
            setInitialScriptsMetadata(scriptsWithPlaceholders);
            setIsLoadingInitialData(false);
        }, APP_INIT_DELAY);
    }, []);

    // Effect 2: Background indexing of script content
    useEffect(() => {
        if (isLoadingInitialData || initialScriptsMetadata.length === 0) return;

        let isMounted = true;
        setIsIndexing(true);
        setIndexingError(null);
        initialLoadAndIndexComplete.current = false;

        const indexAllScripts = async () => {
            try {
                const processedScripts = await Promise.all(
                    initialScriptsMetadata.map(async (script) => {
                        try {
                            const tempContent = await script.loadContent();
                            const { content: searchableContent, speakers: searchableSpeakers } = extractTextFromScriptContent(tempContent);
                            return { ...script, content: undefined, searchableContent, searchableSpeakers };
                        } catch (error) {
                            console.error(`Error indexing script ${script.id}:`, error);
                            return { ...script, content: undefined, searchableContent: '', searchableSpeakers: '' };
                        }
                    })
                );
                if (isMounted) {
                    setScripts(processedScripts);
                }
            } catch (e) {
                if (isMounted) {
                    setIndexingError("A critical error occurred during script content processing.");
                    console.error("Critical indexing error:", e);
                }
            } finally {
                if (isMounted) {
                    setIsIndexing(false);
                    if (!indexingError) {
                        initialLoadAndIndexComplete.current = true;
                    }
                }
            }
        };

        indexAllScripts();
        return () => { isMounted = false; };
    }, [initialScriptsMetadata, isLoadingInitialData, indexingError]);

    return {
        scripts,
        isLoadingInitialData,
        isIndexing,
        indexingError,
        initialLoadAndIndexComplete,
    };
}
