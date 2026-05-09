import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Script, SearchApiResponse, SearchIndexDocument } from '../types';

const SEARCH_DEBOUNCE_DELAY = 350;
const DEFAULT_RESULT_LIMIT = 80;

export type SearchMode = 'content' | 'speaker';

interface UseScriptSearchProps {
    scripts: Script[];
}

interface UseScriptSearchReturn {
    searchTerm: string;
    speakerSearchTerm: string;
    debouncedSearchTerm: string;
    debouncedSpeakerSearchTerm: string;
    isUserSearching: boolean;
    globallySearchedScripts: Script[];
    sidebarSearchedScripts: Script[];
    handleSearchInputChange: (term: string) => void;
    handleSpeakerSearchInputChange: (term: string) => void;
    handleClearSearch: () => void;
    setSearchTerm: Dispatch<SetStateAction<string>>;
    setSpeakerSearchTerm: Dispatch<SetStateAction<string>>;
    setDebouncedSearchTerm: Dispatch<SetStateAction<string>>;
    setDebouncedSpeakerSearchTerm: Dispatch<SetStateAction<string>>;
    setIsUserSearching: Dispatch<SetStateAction<boolean>>;
}

export function useScriptSearch({ scripts }: UseScriptSearchProps): UseScriptSearchReturn {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [speakerSearchTerm, setSpeakerSearchTerm] = useState<string>('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
    const [debouncedSpeakerSearchTerm, setDebouncedSpeakerSearchTerm] = useState<string>('');
    const [isUserSearching, setIsUserSearching] = useState<boolean>(false);
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

    const calculateLocalScore = (
        document: SearchIndexDocument,
        normalizedContentQuery: string,
        normalizedSpeakerQuery: string,
        contentTokens: string[],
        speakerTokens: string[],
    ): number => {
        const normalizedTitle = normalizeSearchValue(document.title);
        const normalizedSubTitle = normalizeSearchValue(document.subTitle ?? '');
        const normalizedSpeakers = normalizeSearchValue(document.searchableSpeakers);
        const normalizedContent = normalizeSearchValue(document.searchableContent);

        const countTokenHits = (field: string, tokens: string[], weight: number) => (
            tokens.reduce((score, token) => score + (field.includes(token) ? weight : 0), 0)
        );

        let score = 0;

        if (normalizedContentQuery) {
            const matchesContentQuery = (
                normalizedTitle.includes(normalizedContentQuery)
                || normalizedSubTitle.includes(normalizedContentQuery)
                || normalizedContent.includes(normalizedContentQuery)
            );

            if (!matchesContentQuery) {
                return 0;
            }

            score += (
                (normalizedTitle.includes(normalizedContentQuery) ? 80 : 0)
                + (normalizedSubTitle.includes(normalizedContentQuery) ? 60 : 0)
                + (normalizedContent.includes(normalizedContentQuery) ? 32 : 0)
                + countTokenHits(normalizedTitle, contentTokens, 18)
                + countTokenHits(normalizedSubTitle, contentTokens, 12)
                + countTokenHits(normalizedContent, contentTokens, 5)
            );
        }

        if (normalizedSpeakerQuery) {
            if (!normalizedSpeakers.includes(normalizedSpeakerQuery)) {
                return 0;
            }

            score += 60
                + countTokenHits(normalizedSpeakers, speakerTokens, 24)
                + (normalizedTitle.includes(normalizedSpeakerQuery) ? 4 : 0);
        }

        return score;
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

    const getSearchModeForTerms = (normalizedContentQuery: string, normalizedSpeakerQuery: string): SearchApiResponse['mode'] => {
        if (normalizedContentQuery && normalizedSpeakerQuery) {
            return 'combined';
        }

        return normalizedSpeakerQuery ? 'speaker' : 'content';
    };

    const searchLocally = useCallback(async (normalizedContentQuery: string, normalizedSpeakerQuery: string): Promise<SearchApiResponse> => {
        const documents = await fetchLocalIndex();
        const contentTokens = normalizedContentQuery.split(' ').filter(Boolean);
        const speakerTokens = normalizedSpeakerQuery.split(' ').filter(Boolean);
        const mode = getSearchModeForTerms(normalizedContentQuery, normalizedSpeakerQuery);

        const results = documents
            .map((document) => ({
                document,
                score: calculateLocalScore(document, normalizedContentQuery, normalizedSpeakerQuery, contentTokens, speakerTokens),
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
            query: [normalizedContentQuery, normalizedSpeakerQuery].filter(Boolean).join(' '),
            contentQuery: normalizedContentQuery,
            speakerQuery: normalizedSpeakerQuery,
            results,
            source: 'static',
        };
    }, [fetchLocalIndex]);

    const searchRemotely = useCallback(async (normalizedContentQuery: string, normalizedSpeakerQuery: string, signal: AbortSignal): Promise<SearchApiResponse> => {
        const endpointBase = searchApiBaseUrl || '';
        const params = new URLSearchParams({
            limit: String(DEFAULT_RESULT_LIMIT),
        });

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

        if (normalizedSpeakerQuery && typeof searchResponse.speakerQuery === 'undefined') {
            throw new Error('Search API does not support speaker filters yet.');
        }

        return searchResponse;
    }, [searchApiBaseUrl]);

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
        }
    }, [searchTerm, speakerSearchTerm]);

    useEffect(() => {
        if ((!debouncedSearchTerm && !debouncedSpeakerSearchTerm) || scripts.length === 0) {
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
                    response = await searchRemotely(debouncedSearchTerm, debouncedSpeakerSearchTerm, abortController.signal);
                } catch (error) {
                    if (abortController.signal.aborted) {
                        return;
                    }

                    console.warn('Search API unavailable, falling back to static search index.', error);
                    response = await searchLocally(debouncedSearchTerm, debouncedSpeakerSearchTerm);
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
    }, [debouncedSearchTerm, debouncedSpeakerSearchTerm, scripts.length, scriptMap, searchLocally, searchRemotely]);

    const globallySearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);
    const sidebarSearchedScripts = useMemo(() => searchedScripts, [searchedScripts]);

    const handleSearchInputChange = useCallback((term: string) => {
        setSearchTerm(term);
    }, []);

    const handleSpeakerSearchInputChange = useCallback((term: string) => {
        setSpeakerSearchTerm(term);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchTerm('');
        setSpeakerSearchTerm('');
        setDebouncedSearchTerm('');
        setDebouncedSpeakerSearchTerm('');
        setIsUserSearching(false);
        setSearchedScripts([]);
    }, []);

    return {
        searchTerm,
        speakerSearchTerm,
        debouncedSearchTerm,
        debouncedSpeakerSearchTerm,
        isUserSearching,
        globallySearchedScripts,
        sidebarSearchedScripts,
        handleSearchInputChange,
        handleSpeakerSearchInputChange,
        handleClearSearch,
        setSearchTerm,
        setSpeakerSearchTerm,
        setDebouncedSearchTerm,
        setDebouncedSpeakerSearchTerm,
        setIsUserSearching,
    };
}
