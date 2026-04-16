import React, { useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ScriptViewer } from './components/ScriptViewer';
import { Footer } from './components/Footer';
import { SearchPage } from './components/SearchPage';
import { StoriesPage } from './components/StoriesPage';
import { SCRIPT_CATEGORIES } from './constants';
import { useScriptIndexing, useScriptSearch, useScriptNavigation } from './hooks';

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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  ));

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

  const scriptsToDisplayInSidebar = useMemo(() => {
    if (currentView === 'search') return [];
    return debouncedSearchTerm ? sidebarSearchedScripts : scriptsForActiveCategoryWhenBrowsing;
  }, [currentView, debouncedSearchTerm, sidebarSearchedScripts, scriptsForActiveCategoryWhenBrowsing]);

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

  const toggleTheme = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const viewerLoading = (isLoadingInitialData || (isIndexing && scripts.length === 0 && !indexingError)) && !selectedScriptId;

  const renderStoriesLayout = () => (
    <div className="flex flex-1 overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-hidden px-0 py-4 sm:px-4 sm:py-6 md:flex-row md:gap-6">
        <Sidebar
          key={`stories-sidebar-${activeCategoryKey ?? 'root'}`}
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={[]}
          selectedScriptId={null}
          onSelectScript={handleSelectScript}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={false}
          searchTerm=""
          onSearchTermChange={() => {}}
          onClearSearch={() => {}}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelect}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-auto rounded-[2rem] bg-transparent p-2 md:max-h-[calc(100vh-176px)] md:p-4">
          <StoriesPage
            categories={SCRIPT_CATEGORIES}
            scripts={scripts}
            activeCategoryKey={activeCategoryKey}
            selectedScriptId={selectedScriptId}
            onCategorySelect={handleCategorySelect}
            onSelectScript={handleSelectScript}
          />
        </main>
      </div>
    </div>
  );

  const renderScriptViewerLayout = () => (
    <div className="flex flex-1 overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-hidden px-0 py-4 sm:px-4 sm:py-6 md:flex-row md:gap-6">
        <Sidebar
          key={activeCategoryKey || 'sidebar-script-viewer-key'}
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={scriptsToDisplayInSidebar}
          selectedScriptId={selectedScript?.id || null}
          onSelectScript={handleSelectScript}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={isUserSearching || (searchTerm !== debouncedSearchTerm && !!searchTerm)}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchInputChange}
          onClearSearch={handleClearSearch}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelect}
          onNavigateToSearch={handleNavigateToSearch}
          listOnlyMode={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-auto rounded-[2rem] bg-transparent p-2 md:max-h-[calc(100vh-176px)] md:p-4">
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
              onNavigateToNextScript={handleNavigateToNextScript}
              onNavigateToScript={handleSelectScript}
              onNavigateToSearch={() => handleNavigateToStories(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null)}
            />
          )}
        </main>
      </div>
    </div>
  );

  const renderSearchPageLayout = () => (
    <div className="flex flex-1 overflow-y-hidden">
      <div className="container mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-hidden px-0 py-4 sm:px-4 sm:py-6 md:flex-row md:gap-6">
        <Sidebar
          key="search-page-sidebar"
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={[]}
          selectedScriptId={null}
          onSelectScript={handleSelectScript}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={false}
          searchTerm=""
          onSearchTermChange={() => {}}
          onClearSearch={() => {}}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelect}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="w-full flex-1 overflow-y-auto rounded-[2rem] bg-transparent p-2 md:max-h-[calc(100vh-176px)] md:p-4">
          <SearchPage
            categories={SCRIPT_CATEGORIES}
            globallySearchedScripts={globallySearchedScripts}
            selectedScriptId={selectedScriptId}
            onSelectScript={handleSelectScript}
            isLoadingInitialMetadata={isLoadingInitialData}
            isIndexingScripts={isIndexing && scripts.length === 0}
            isSearching={isUserSearching || (searchTerm !== debouncedSearchTerm && !!searchTerm)}
            searchTerm={searchTerm}
            onSearchTermChange={handleSearchInputChange}
            onClearSearch={handleClearSearch}
            onCategorySelect={handleCategorySelect}
            searchMode={searchMode}
            onSearchModeChange={handleSearchModeChange}
          />
        </main>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-nikke-bg text-nikke-text-primary antialiased transition-colors duration-500">
      <Header
        onToggleSidebar={(currentView === 'search' || currentView === 'stories' || currentView === 'script_viewer') ? () => setIsSidebarOpenOnMobile(prev => !prev) : undefined}
        isSidebarOpen={isSidebarOpenOnMobile}
        className="sticky top-0 z-50 shrink-0"
        onNavigateToSearch={handleNavigateToSearch}
        onNavigateToStories={() => handleNavigateToStories(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null)}
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
