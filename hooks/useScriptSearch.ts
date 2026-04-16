import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Script } from '../types';

const SEARCH_DEBOUNCE_DELAY = 350;

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
}

export function useScriptSearch({ scripts }: UseScriptSearchProps): UseScriptSearchReturn {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
    const [isUserSearching, setIsUserSearching] = useState<boolean>(false);
    const [searchMode, setSearchMode] = useState<SearchMode>('content');

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

    // Global search results (used in SearchPage)
    const globallySearchedScripts = useMemo(() => {
        if (!debouncedSearchTerm || scripts.length === 0) return [];

        if (searchMode === 'speaker') {
            return scripts.filter(script =>
                script.searchableSpeakers.includes(debouncedSearchTerm)
            );
        }

        // Default to 'content' search
        return scripts.filter(script =>
            script.title.toLowerCase().includes(debouncedSearchTerm) ||
            (script.subTitle && script.subTitle.toLowerCase().includes(debouncedSearchTerm)) ||
            script.searchableContent.includes(debouncedSearchTerm)
        );
    }, [scripts, debouncedSearchTerm, searchMode]);

    // Sidebar search results (searches all text fields)
    const sidebarSearchedScripts = useMemo(() => {
        if (!debouncedSearchTerm || scripts.length === 0) return [];
        return scripts.filter(script =>
            script.title.toLowerCase().includes(debouncedSearchTerm) ||
            (script.subTitle && script.subTitle.toLowerCase().includes(debouncedSearchTerm)) ||
            script.searchableContent.includes(debouncedSearchTerm) ||
            script.searchableSpeakers.includes(debouncedSearchTerm)
        );
    }, [scripts, debouncedSearchTerm]);

    const handleSearchInputChange = useCallback((term: string) => {
        setSearchTerm(term);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setIsUserSearching(false);
    }, []);

    const handleSearchModeChange = useCallback((mode: SearchMode) => {
        setSearchMode(mode);
        setSearchTerm('');
        setDebouncedSearchTerm('');
        setIsUserSearching(false);
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
    };
}
