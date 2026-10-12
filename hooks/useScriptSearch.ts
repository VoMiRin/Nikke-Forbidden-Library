import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Script, SearchApiResponse, SearchIndexDocument } from '../types';
import { normalizeSearchValue, searchDocuments, SEARCH_VERSION } from '../lib/search.mjs';

const SEARCH_DEBOUNCE_DELAY = 350;
const DEFAULT_RESULT_LIMIT = 80;
const RESULT_LIMIT_INCREMENT = 80;

export type SearchMode = 'content' | 'speaker';

interface UseScriptSearchProps {
    scripts: Script[];
}

interface UseScriptSearchReturn {
    searchTerm: string;
    speakerSearchTerm: string;
    searchCategoryKey: string | null;
    searchError: string | null;
    setSearchCategoryKey: Dispatch<SetStateAction<string | null>>;
    handleSearchCategoryChange: (categoryKey: string | null) => void;
    debouncedSearchTerm: string;
    debouncedSpeakerSearchTerm: string;
    isUserSearching: boolean;
    totalSearchResults: number;
    searchResultLimit: number;
    hasMoreSearchResults: boolean;
    globallySearchedScripts: Script[];
    sidebarSearchedScripts: Script[];
    handleSearchInputChange: (term: string) => void;
    handleSpeakerSearchInputChange: (term: string) => void;
    handleClearSearch: () => void;
    handleLoadMoreSearchResults: () => void;
    setSearchTerm: Dispatch<SetStateAction<string>>;
    setSpeakerSearchTerm: Dispatch<SetStateAction<string>>;
    setDebouncedSearchTerm: Dispatch<SetStateAction<string>>;
    setDebouncedSpeakerSearchTerm: Dispatch<SetStateAction<string>>;
    setIsUserSearching: Dispatch<SetStateAction<boolean>>;
}

export function useScriptSearch({ scripts }: UseScriptSearchProps): UseScriptSearchReturn {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [speakerSearchTerm, setSpeakerSearchTerm] = useState<string>('');
    const [searchCategoryKey, setSearchCategoryKey] = useState<string | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
    const [debouncedSpeakerSearchTerm, setDebouncedSpeakerSearchTerm] = useState<string>('');
    const [isUserSearching, setIsUserSearching] = useState<boolean>(false);
    const [searchedScripts, setSearchedScripts] = useState<Script[]>([]);
    const [totalSearchResults, setTotalSearchResults] = useState<number>(0);
    const [searchResultLimit, setSearchResultLimit] = useState<number>(DEFAULT_RESULT_LIMIT);
    const localIndexRef = useRef<SearchIndexDocument[] | null>(null);
    const searchApiBaseUrl = (import.meta.env.VITE_SEARCH_API_BASE_URL ?? '').trim();

    const scriptMap = useMemo(() => {
        return new Map(scripts.map((script) => [script.id, script]));
    }, [scripts]);

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

    const searchLocally = useCallback(async (contentQuery: string, speakerQuery: string, limit: number): Promise<SearchApiResponse> => ({
        ...searchDocuments(await fetchLocalIndex(), { contentQuery, speakerQuery, categoryKey: searchCategoryKey, limit }),
        source: 'static',
    }), [fetchLocalIndex, searchCategoryKey]);

    const searchRemotely = useCallback(async (normalizedContentQuery: string, normalizedSpeakerQuery: string, resultLimit: number, signal: AbortSignal): Promise<SearchApiResponse> => {
        const endpointBase = searchApiBaseUrl || '';
        const params = new URLSearchParams({
            limit: String(resultLimit),
        });

        if (searchCategoryKey) params.set('category', searchCategoryKey);

        if (normalizedContentQuery) {
            params.set('q', normalizedContentQuery);
        }

        if (normalizedSpeakerQuery) {
            params.set('speaker', normalizedSpeakerQuery);

            if (!normalizedContentQuery) {
                params.set('q', normalizedSpeakerQuery);
                params.set('mode', 'speaker');
            }
        }

        const endpoint = `${endpointBase}/api/search?${params.toString()}`;
        const response = await fetch(endpoint, { signal });

        if (!response.ok) {
            throw new Error(`Search API request failed. HTTP ${response.status}`);
        }

        const searchResponse = await response.json() as SearchApiResponse;

        if (searchResponse.searchVersion !== SEARCH_VERSION || (searchResponse.categoryKey ?? null) !== searchCategoryKey) {
            throw new Error('Search API needs the current search contract.');
        }

        if (normalizedSpeakerQuery && typeof searchResponse.speakerQuery === 'undefined') {
            throw new Error('Search API does not support speaker filters yet.');
        }

        if (normalizedContentQuery && normalizedSpeakerQuery && searchResponse.speakerContentSearch !== true) {
            throw new Error('Search API does not support strict speaker content filters yet.');
        }

        return searchResponse;
    }, [searchApiBaseUrl, searchCategoryKey]);

    // Debounce search terms
    useEffect(() => {
        const normalizedContentTerm = normalizeSearchValue(searchTerm);
        const normalizedSpeakerTerm = normalizeSearchValue(speakerSearchTerm);

        if (normalizedContentTerm || normalizedSpeakerTerm) {
            setIsUserSearching(true);
            const timerId = setTimeout(() => {
                setDebouncedSearchTerm(normalizedContentTerm);
                setDebouncedSpeakerSearchTerm(normalizedSpeakerTerm);
                setIsUserSearching(false);
            }, SEARCH_DEBOUNCE_DELAY);
            return () => clearTimeout(timerId);
        } else {
            setDebouncedSearchTerm('');
            setDebouncedSpeakerSearchTerm('');
            setIsUserSearching(false);
            setSearchResultLimit(DEFAULT_RESULT_LIMIT);
            setTotalSearchResults(0);
        }
    }, [searchTerm, speakerSearchTerm]);

    useEffect(() => {
        if ((!debouncedSearchTerm && !debouncedSpeakerSearchTerm) || scripts.length === 0) {
            setSearchedScripts([]);
            setTotalSearchResults(0);
            setSearchError(null);
            return;
        }

        let isMounted = true;
        const abortController = new AbortController();

        const runSearch = async () => {
            setIsUserSearching(true);
            setSearchError(null);

            try {
                let response: SearchApiResponse;

                try {
                    response = await searchRemotely(debouncedSearchTerm, debouncedSpeakerSearchTerm, searchResultLimit, abortController.signal);
                } catch (error) {
                    if (abortController.signal.aborted) {
                        return;
                    }

                    console.warn('Search API unavailable, falling back to static search index.', error);
                    response = await searchLocally(debouncedSearchTerm, debouncedSpeakerSearchTerm, searchResultLimit);
                }

                if (!isMounted) {
                    return;
                }

                const resolvedScripts = response.results
                    .map((result): Script | null => {
                        const script = scriptMap.get(result.id);
                        if (!script) {
                            return null;
                        }

                        return {
                            ...script,
                            searchSnippet: result.snippet,
                            searchMatchType: result.matchType,
                            matchedSpeaker: result.matchedSpeaker,
                        };
                    })
                    .filter((script): script is Script => script !== null);

                setSearchedScripts(resolvedScripts);
                setTotalSearchResults(response.totalResults ?? resolvedScripts.length);
            } catch (error) {
                if (isMounted) {
                    setSearchedScripts([]);
                    setTotalSearchResults(0);
                    setSearchError('검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
                }
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
    }, [debouncedSearchTerm, debouncedSpeakerSearchTerm, scripts.length, scriptMap, searchLocally, searchRemotely, searchResultLimit]);

    const globallySearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);
    const sidebarSearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);
    const hasMoreSearchResults = searchedScripts.length < totalSearchResults;

    const handleSearchInputChange = useCallback((term: string) => {
        setSearchResultLimit(DEFAULT_RESULT_LIMIT);
        setSearchTerm(term);
    }, []);

    const handleSpeakerSearchInputChange = useCallback((term: string) => {
        setSearchResultLimit(DEFAULT_RESULT_LIMIT);
        setSpeakerSearchTerm(term);
    }, []);

    const handleSearchCategoryChange = useCallback((categoryKey: string | null) => {
        setSearchCategoryKey(categoryKey);
        setSearchResultLimit(DEFAULT_RESULT_LIMIT);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchCategoryKey(null);
        setSearchError(null);
        setSearchTerm('');
        setSpeakerSearchTerm('');
        setDebouncedSearchTerm('');
        setDebouncedSpeakerSearchTerm('');
        setIsUserSearching(false);
        setSearchedScripts([]);
        setTotalSearchResults(0);
        setSearchResultLimit(DEFAULT_RESULT_LIMIT);
    }, []);

    const handleLoadMoreSearchResults = useCallback(() => {
        setSearchResultLimit((currentLimit) => currentLimit + RESULT_LIMIT_INCREMENT);
    }, []);

    return {
        searchCategoryKey,
        setSearchCategoryKey,
        handleSearchCategoryChange,
        searchError,
        searchTerm,
        speakerSearchTerm,
        debouncedSearchTerm,
        debouncedSpeakerSearchTerm,
        isUserSearching,
        totalSearchResults,
        searchResultLimit,
        hasMoreSearchResults,
        globallySearchedScripts,
        sidebarSearchedScripts,
        handleSearchInputChange,
        handleSpeakerSearchInputChange,
        handleClearSearch,
        handleLoadMoreSearchResults,
        setSearchTerm,
        setSpeakerSearchTerm,
        setDebouncedSearchTerm,
        setDebouncedSpeakerSearchTerm,
        setIsUserSearching,
    };
}
