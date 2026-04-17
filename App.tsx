import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ScriptViewer } from './components/ScriptViewer';
import { Footer } from './components/Footer';
import { SearchPage } from './components/SearchPage';
import { StoriesPage } from './components/StoriesPage';
import { SCRIPT_CATEGORIES } from './constants';
import { useScriptIndexing, useScriptSearch, useScriptNavigation, type AppView, type SearchMode } from './hooks';

type ViewerSearchFocus = {
  term: string;
  mode: SearchMode;
};

type BrowserHistoryState = {
  view: AppView;
  categoryKey: string | null;
  scriptId: string | null;
  searchTerm: string;
  searchMode: SearchMode;
  viewerSearchFocus: ViewerSearchFocus | null;
};

const parseHistoryStateFromLocation = (locationSearch: string): BrowserHistoryState => {
  const params = new URLSearchParams(locationSearch);
  const searchTerm = params.get('q')?.trim() ?? '';
  const searchMode: SearchMode = params.get('mode') === 'speaker' ? 'speaker' : 'content';
  const focusTerm = params.get('focus')?.trim() ?? '';
  const focusMode: SearchMode = params.get('focusMode') === 'speaker' ? 'speaker' : searchMode;
  const categoryKey = params.get('category')?.trim() || null;
  const scriptId = params.get('script')?.trim() || null;
  const rawView = params.get('view');

  let view: AppView = 'search';
  if (rawView === 'stories') {
    view = 'stories';
  } else if (rawView === 'script' || rawView === 'script_viewer') {
    view = 'script_viewer';
  } else if (scriptId) {
    view = 'script_viewer';
  } else if (categoryKey && !searchTerm) {
    view = 'stories';
  }

  return {
    view,
    categoryKey: view === 'search' ? null : categoryKey,
    scriptId: view === 'script_viewer' ? scriptId : null,
    searchTerm: view === 'search' ? searchTerm : '',
    searchMode,
    viewerSearchFocus: view === 'script_viewer' && focusTerm
      ? { term: focusTerm, mode: focusMode }
      : null,
  };
};

const buildHistoryUrl = (state: BrowserHistoryState): string => {
  const params = new URLSearchParams();

  if (state.view === 'stories') {
    params.set('view', 'stories');
    if (state.categoryKey) {
      params.set('category', state.categoryKey);
    }
  }

  if (state.view === 'script_viewer') {
    params.set('view', 'script');
    if (state.categoryKey) {
      params.set('category', state.categoryKey);
    }
    if (state.scriptId) {
      params.set('script', state.scriptId);
    }
    if (state.viewerSearchFocus?.term) {
      params.set('focus', state.viewerSearchFocus.term);
      if (state.viewerSearchFocus.mode === 'speaker') {
        params.set('focusMode', state.viewerSearchFocus.mode);
      }
    }
  }

  if (state.view === 'search') {
    if (state.searchTerm) {
      params.set('view', 'search');
      params.set('q', state.searchTerm);
    }
    if (state.searchMode === 'speaker') {
      params.set('view', 'search');
      params.set('mode', state.searchMode);
    }
  }

  const queryString = params.toString();
  return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
};

const LoadingMessage: React.FC<{ message: string; isSpinning?: boolean; isError?: boolean }> = ({ message, isSpinning, isError }) => (
  <div className={`flex h-full flex-col items-center justify-center px-4 text-center ${isError ? 'text-red-400' : 'text-nikke-accent'}`} role="alert">
    {isSpinning && (
      <svg className="mb-3 h-8 w-8 animate-spin text-nikke-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    )}
    <p className="text-xl">{message}</p>
  </div>
);

type ThemeMode = 'dark' | 'light';

const App: React.FC = () => {
  const [isSidebarOpenOnMobile, setIsSidebarOpenOnMobile] = useState<boolean>(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [viewerSearchFocus, setViewerSearchFocus] = useState<ViewerSearchFocus | null>(null);
  const [isHistoryReady, setIsHistoryReady] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  ));
  const skipNextHistorySyncRef = useRef<boolean>(false);
  const hasWrittenHistoryStateRef = useRef<boolean>(false);

  const {
    scripts,
    isLoadingInitialData,
    isIndexing,
    indexingError,
  } = useScriptIndexing();

  const {
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
  } = useScriptSearch({ scripts });

  const {
    currentView,
    activeCategoryKey,
    selectedScriptId,
    selectedScript,
    scriptsForActiveCategoryWhenBrowsing,
    handleSelectScript,
    handleCategorySelect,
    handleNavigateToNextScript,
    handleNavigateToSearch,
    handleNavigateToStories,
    setCurrentView,
    setActiveCategoryKey,
    setSelectedScriptId,
  } = useScriptNavigation({
    scripts,
    onSearchClear: handleClearSearch,
    isSidebarOpenOnMobile,
    setIsSidebarOpenOnMobile,
  });

  const isSearchView = currentView === 'search';
  const isStoriesView = currentView === 'stories';

  const activeNav = isStoriesView || currentView === 'script_viewer'
    ? 'stories'
    : 'search';

  const applyHistoryState = React.useCallback((historyState: BrowserHistoryState) => {
    skipNextHistorySyncRef.current = true;

    setCurrentView(historyState.view);
    setActiveCategoryKey(historyState.categoryKey);
    setSelectedScriptId(historyState.scriptId);
    setViewerSearchFocus(historyState.viewerSearchFocus);
    setSearchMode(historyState.searchMode);
    setSearchTerm(historyState.searchTerm);
    setDebouncedSearchTerm(historyState.searchTerm.toLowerCase());
    setIsUserSearching(false);
    setIsSidebarOpenOnMobile(false);
  }, [
    setActiveCategoryKey,
    setCurrentView,
    setDebouncedSearchTerm,
    setIsUserSearching,
    setSearchMode,
    setSearchTerm,
    setSelectedScriptId,
  ]);

  const scriptsToDisplayInSidebar = useMemo(() => {
    if (currentView === 'search') return [];
    return debouncedSearchTerm ? sidebarSearchedScripts : scriptsForActiveCategoryWhenBrowsing;
  }, [currentView, debouncedSearchTerm, sidebarSearchedScripts, scriptsForActiveCategoryWhenBrowsing]);

  const historyState = useMemo<BrowserHistoryState>(() => ({
    view: currentView,
    categoryKey: currentView === 'search' ? null : activeCategoryKey,
    scriptId: currentView === 'script_viewer' ? selectedScriptId : null,
    searchTerm: currentView === 'search' ? debouncedSearchTerm : '',
    searchMode,
    viewerSearchFocus: currentView === 'script_viewer' ? viewerSearchFocus : null,
  }), [activeCategoryKey, currentView, debouncedSearchTerm, searchMode, selectedScriptId, viewerSearchFocus]);

  useEffect(() => {
    document.body.style.overflow = isSidebarOpenOnMobile ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpenOnMobile]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem('nikke-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const initialHistoryState = parseHistoryStateFromLocation(window.location.search);
    applyHistoryState(initialHistoryState);
    setIsHistoryReady(true);

    const handlePopState = () => {
      applyHistoryState(parseHistoryStateFromLocation(window.location.search));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyHistoryState]);

  useEffect(() => {
    if (!isHistoryReady) return;

    const nextUrl = buildHistoryUrl(historyState);

    if (skipNextHistorySyncRef.current) {
      skipNextHistorySyncRef.current = false;

      if (!hasWrittenHistoryStateRef.current) {
        window.history.replaceState(historyState, '', nextUrl);
        hasWrittenHistoryStateRef.current = true;
      }
      return;
    }

    if (!hasWrittenHistoryStateRef.current) {
      window.history.replaceState(historyState, '', nextUrl);
      hasWrittenHistoryStateRef.current = true;
      return;
    }

    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl === nextUrl) {
      window.history.replaceState(historyState, '', nextUrl);
      return;
    }

    window.history.pushState(historyState, '', nextUrl);
  }, [historyState, isHistoryReady]);

  const toggleTheme = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const viewerLoading = (isLoadingInitialData || (isIndexing && scripts.length === 0 && !indexingError)) && !selectedScriptId;

  const handleSelectScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleSelectScript(scriptId);
  };

  const handleSelectScriptFromSearch = (scriptId: string) => {
    const focusTerm = debouncedSearchTerm.trim() || searchTerm.trim();
    setViewerSearchFocus(focusTerm ? { term: focusTerm, mode: searchMode } : null);
    handleSelectScript(scriptId);
  };

  const handleNavigateToNextScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleNavigateToNextScript(scriptId);
  };

  const handleNavigateToScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleSelectScript(scriptId);
  };

  const handleCategorySelectWithoutSearchFocus = (categoryKey: string) => {
    setViewerSearchFocus(null);
    handleCategorySelect(categoryKey);
  };

  const handleNavigateToSearchWithoutSearchFocus = () => {
    setViewerSearchFocus(null);
    handleNavigateToSearch();
  };

  const handleNavigateToStoriesWithoutSearchFocus = (categoryKey?: string | null) => {
    setViewerSearchFocus(null);
    handleNavigateToStories(categoryKey);
  };

  const renderStoriesLayout = () => (
    <div className="flex flex-1 overflow-visible md:overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-3 overflow-visible px-0 py-3 sm:px-4 sm:py-6 md:flex-row md:gap-6 md:overflow-y-hidden">
        <Sidebar
          key={`stories-sidebar-${activeCategoryKey ?? 'root'}`}
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={[]}
          selectedScriptId={null}
          onSelectScript={handleSelectScriptWithoutSearchFocus}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={false}
          searchTerm=""
          onSearchTermChange={() => {}}
          onClearSearch={() => {}}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelectWithoutSearchFocus}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-visible rounded-[1.5rem] bg-transparent p-3 md:max-h-[calc(100vh-176px)] md:overflow-y-auto md:rounded-[2rem] md:p-4">
          <StoriesPage
            categories={SCRIPT_CATEGORIES}
            scripts={scripts}
            activeCategoryKey={activeCategoryKey}
            selectedScriptId={selectedScriptId}
            onCategorySelect={handleCategorySelectWithoutSearchFocus}
            onSelectScript={handleSelectScriptWithoutSearchFocus}
          />
        </main>
      </div>
    </div>
  );

  const renderScriptViewerLayout = () => (
    <div className="flex flex-1 overflow-visible md:overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-3 overflow-visible px-0 py-3 sm:px-4 sm:py-6 md:flex-row md:gap-6 md:overflow-y-hidden">
        <Sidebar
          key={activeCategoryKey || 'sidebar-script-viewer-key'}
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={scriptsToDisplayInSidebar}
          selectedScriptId={selectedScript?.id || null}
          onSelectScript={handleSelectScriptWithoutSearchFocus}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={isUserSearching || (searchTerm !== debouncedSearchTerm && !!searchTerm)}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchInputChange}
          onClearSearch={handleClearSearch}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelectWithoutSearchFocus}
          onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
          listOnlyMode={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-visible rounded-[1.5rem] bg-transparent p-3 md:max-h-[calc(100vh-176px)] md:overflow-y-auto md:rounded-[2rem] md:p-4">
          {viewerLoading ? (
            <LoadingMessage
              message={isLoadingInitialData ? 'Loading script metadata...' : 'Preparing the archive...'}
              isSpinning={true}
            />
          ) : indexingError && scripts.length === 0 ? (
            <LoadingMessage message={`Error: ${indexingError}`} isError={true} />
          ) : (
            <ScriptViewer
              script={selectedScript}
              searchFocus={viewerSearchFocus}
              selectedOptions={selectedOptions}
              onOptionSelect={(choiceId, optionValue) => {
                setSelectedOptions(prev => ({
                  ...prev,
                  [choiceId]: optionValue,
                }));
              }}
              onClearChoice={(choiceId) => {
                setSelectedOptions(prev => {
                  const nextSelections = { ...prev };
                  delete nextSelections[choiceId];
                  return nextSelections;
                });
              }}
              onNavigateToNextScript={handleNavigateToNextScriptWithoutSearchFocus}
              onNavigateToScript={handleNavigateToScriptWithoutSearchFocus}
              onNavigateToSearch={() => handleNavigateToStoriesWithoutSearchFocus(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null)}
            />
          )}
        </main>
      </div>
    </div>
  );

  const renderSearchPageLayout = () => (
    <div className="flex flex-1 overflow-visible md:overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-3 overflow-visible px-0 py-3 sm:px-4 sm:py-6 md:flex-row md:gap-6 md:overflow-y-hidden">
        <Sidebar
          key="search-page-sidebar"
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={[]}
          selectedScriptId={null}
          onSelectScript={handleSelectScriptWithoutSearchFocus}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={false}
          searchTerm=""
          onSearchTermChange={() => {}}
          onClearSearch={() => {}}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelectWithoutSearchFocus}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-visible rounded-[1.5rem] bg-transparent p-3 md:max-h-[calc(100vh-176px)] md:overflow-y-auto md:rounded-[2rem] md:p-4">
          <SearchPage
            categories={SCRIPT_CATEGORIES}
            globallySearchedScripts={globallySearchedScripts}
            selectedScriptId={selectedScriptId}
            onSelectScript={handleSelectScriptFromSearch}
            isLoadingInitialMetadata={isLoadingInitialData}
            isIndexingScripts={isIndexing && scripts.length === 0}
            isSearching={isUserSearching || (searchTerm !== debouncedSearchTerm && !!searchTerm)}
            searchTerm={searchTerm}
            onSearchTermChange={handleSearchInputChange}
            onClearSearch={handleClearSearch}
            onCategorySelect={handleCategorySelectWithoutSearchFocus}
            searchMode={searchMode}
            onSearchModeChange={handleSearchModeChange}
          />
        </main>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-nikke-bg text-nikke-text-primary antialiased transition-colors duration-500 md:h-screen">
      <Header
        onToggleSidebar={(currentView === 'search' || currentView === 'stories' || currentView === 'script_viewer') ? () => setIsSidebarOpenOnMobile(prev => !prev) : undefined}
        isSidebarOpen={isSidebarOpenOnMobile}
        className="sticky top-0 z-50 shrink-0"
        onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
        onNavigateToStories={() => handleNavigateToStoriesWithoutSearchFocus(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null)}
        activeNav={activeNav}
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
      />
      {isSearchView ? renderSearchPageLayout() : isStoriesView ? renderStoriesLayout() : renderScriptViewerLayout()}
      <Footer className="shrink-0" />
    </div>
  );
};

export default App;
