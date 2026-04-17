import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Script, SearchApiResponse, SearchIndexDocument } from '../types';

const SEARCH_DEBOUNCE_DELAY = 350;
const DEFAULT_RESULT_LIMIT = 80;

export type SearchMode = 'content' | 'speaker';

interface UseScriptSearchProps {
    scripts: Script[];
}

interface UseScriptSearchReturn {
    searchTerm: string;
    debouncedSearchTerm: string;
    isUserSearching: boolean;
    searchMode: SearchMode;
    globallySearchedScripts: Script[];
    sidebarSearchedScripts: Script[];
    handleSearchInputChange: (term: string) => void;
    handleClearSearch: () => void;
    handleSearchModeChange: (mode: SearchMode) => void;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    setDebouncedSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    setIsUserSearching: React.Dispatch<React.SetStateAction<boolean>>;
    setSearchMode: React.Dispatch<React.SetStateAction<SearchMode>>;
}

export function useScriptSearch({ scripts }: UseScriptSearchProps): UseScriptSearchReturn {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
    const [isUserSearching, setIsUserSearching] = useState<boolean>(false);
    const [searchMode, setSearchMode] = useState<SearchMode>('content');
    const [searchedScripts, setSearchedScripts] = useState<Script[]>([]);
    const localIndexRef = useRef<SearchIndexDocument[] | null>(null);
    const searchApiBaseUrl = (import.meta.env.VITE_SEARCH_API_BASE_URL ?? '').trim();

    const scriptMap = useMemo(() => {
        return new Map(scripts.map((script) => [script.id, script]));
    }, [scripts]);

    const normalizeSearchValue = (value: string): string => (
        value
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
    );

    const calculateLocalScore = (document: SearchIndexDocument, normalizedQuery: string, tokens: string[], mode: SearchMode): number => {
        const normalizedTitle = normalizeSearchValue(document.title);
        const normalizedSubTitle = normalizeSearchValue(document.subTitle ?? '');
        const normalizedSpeakers = normalizeSearchValue(document.searchableSpeakers);
        const normalizedContent = normalizeSearchValue(document.searchableContent);

        const countTokenHits = (field: string, weight: number) => (
            tokens.reduce((score, token) => score + (field.includes(token) ? weight : 0), 0)
        );

        if (mode === 'speaker') {
            if (!normalizedSpeakers.includes(normalizedQuery)) {
                return 0;
            }

            return 60
                + countTokenHits(normalizedSpeakers, 24)
                + (normalizedTitle.includes(normalizedQuery) ? 4 : 0);
        }

        const matchesQuery = (
            normalizedTitle.includes(normalizedQuery)
            || normalizedSubTitle.includes(normalizedQuery)
            || normalizedContent.includes(normalizedQuery)
        );

        if (!matchesQuery) {
            return 0;
        }

        return (
            (normalizedTitle.includes(normalizedQuery) ? 80 : 0)
            + (normalizedSubTitle.includes(normalizedQuery) ? 60 : 0)
            + (normalizedContent.includes(normalizedQuery) ? 32 : 0)
            + countTokenHits(normalizedTitle, 18)
            + countTokenHits(normalizedSubTitle, 12)
            + countTokenHits(normalizedContent, 5)
        );
    };

    const fetchLocalIndex = useCallback(async (): Promise<SearchIndexDocument[]> => {
        if (localIndexRef.current) {
            return localIndexRef.current;
        }

        const response = await fetch('/search-index.json');
        if (!response.ok) {
            throw new Error(`Failed to load fallback search index. HTTP ${response.status}`);
        }

        const documents = await response.json() as SearchIndexDocument[];
        localIndexRef.current = documents;
        return documents;
    }, []);

    const searchLocally = useCallback(async (normalizedQuery: string, mode: SearchMode): Promise<SearchApiResponse> => {
        const documents = await fetchLocalIndex();
        const tokens = normalizedQuery.split(' ').filter(Boolean);

        const results = documents
            .map((document) => ({
                document,
                score: calculateLocalScore(document, normalizedQuery, tokens, mode),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, DEFAULT_RESULT_LIMIT)
            .map(({ document, score }) => ({
                id: document.id,
                title: document.title,
                categoryKey: document.categoryKey,
                subTitle: document.subTitle,
                mainChapterFile: document.mainChapterFile,
                snippet: document.snippet,
                score,
            }));

        return {
            mode,
            query: normalizedQuery,
            results,
            source: 'static',
        };
    }, [fetchLocalIndex]);

    const searchRemotely = useCallback(async (normalizedQuery: string, mode: SearchMode, signal: AbortSignal): Promise<SearchApiResponse> => {
        const endpointBase = searchApiBaseUrl || '';
        const endpoint = `${endpointBase}/api/search?q=${encodeURIComponent(normalizedQuery)}&mode=${mode}&limit=${DEFAULT_RESULT_LIMIT}`;
        const response = await fetch(endpoint, { signal });

        if (!response.ok) {
            throw new Error(`Search API request failed. HTTP ${response.status}`);
        }

        return response.json() as Promise<SearchApiResponse>;
    }, [searchApiBaseUrl]);

    // Debounce search term
    useEffect(() => {
        if (searchTerm) {
            setIsUserSearching(true);
            const timerId = setTimeout(() => {
                setDebouncedSearchTerm(searchTerm.toLowerCase());
                setIsUserSearching(false);
            }, SEARCH_DEBOUNCE_DELAY);
            return () => clearTimeout(timerId);
        } else {
            setDebouncedSearchTerm('');
            setIsUserSearching(false);
        }
    }, [searchTerm]);

    useEffect(() => {
        if (!debouncedSearchTerm || scripts.length === 0) {
            setSearchedScripts([]);
            return;
        }

        let isMounted = true;
        const abortController = new AbortController();

        const runSearch = async () => {
            setIsUserSearching(true);

            try {
                let response: SearchApiResponse;

                try {
                    response = await searchRemotely(debouncedSearchTerm, searchMode, abortController.signal);
                } catch (error) {
                    if (abortController.signal.aborted) {
                        return;
                    }

                    console.warn('Search API unavailable, falling back to static search index.', error);
                    response = await searchLocally(debouncedSearchTerm, searchMode);
                }

                if (!isMounted) {
                    return;
                }

                const resolvedScripts = response.results
                    .map((result) => {
                        const script = scriptMap.get(result.id);
                        if (!script) {
                            return null;
                        }

                        return {
                            ...script,
                            searchSnippet: result.snippet,
                        };
                    })
                    .filter((script): script is Script => script !== null);

                setSearchedScripts(resolvedScripts);
            } finally {
                if (isMounted) {
                    setIsUserSearching(false);
                }
            }
        };

        runSearch();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [debouncedSearchTerm, scripts.length, scriptMap, searchLocally, searchMode, searchRemotely]);

    const globallySearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);
    const sidebarSearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);

    const handleSearchInputChange = useCallback((term: string) => {
        setSearchTerm(term);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setIsUserSearching(false);
        setSearchedScripts([]);
    }, []);

    const handleSearchModeChange = useCallback((mode: SearchMode) => {
        setSearchMode(mode);
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setIsUserSearching(false);
        setSearchedScripts([]);
    }, []);

    return {
        searchTerm,
        debouncedSearchTerm,
        isUserSearching,
        searchMode,
        globallySearchedScripts,
        sidebarSearchedScripts,
        handleSearchInputChange,
        handleClearSearch,
        handleSearchModeChange,
        setSearchTerm,
        setDebouncedSearchTerm,
        setIsUserSearching,
        setSearchMode,
    };
}
