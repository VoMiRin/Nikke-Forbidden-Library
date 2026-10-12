import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ScriptViewer } from './components/ScriptViewer';
import { Footer } from './components/Footer';
import { SearchPage } from './components/SearchPage';
import { SpeakerIndexPage } from './components/SpeakerIndexPage';
import { parseHistoryStateFromLocation, buildHistoryUrl, type BrowserHistoryState, type ViewerSearchFocus } from './lib/navigation';
import { normalizeSearchValue } from './lib/search.mjs';
import { StoriesPage } from './components/StoriesPage';
import { AiChatPage } from './components/AiChatPage';
import { UpdateNotice } from './components/UpdateNotice';
import { SCRIPT_CATEGORIES } from './constants';
import type { Script } from './types';
import { updatePageMetadata } from './lib/pageMetadata';
import { SITE_NAME, HOME_TITLE } from './lib/seo.mjs';
import { getSequentialScripts, useDeploymentRefresh, useScriptIndexing, useScriptSearch, useScriptNavigation } from './hooks';

const LoadingMessage: React.FC<{ message: string; isSpinning?: boolean; isError?: boolean }> = ({ message, isSpinning, isError }) => (
  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-[18px] px-4 text-center" role={isError ? 'alert' : 'status'}>
    {isSpinning && (
      <div aria-hidden="true" className="relative h-0.5 w-44 overflow-hidden rounded-sm bg-nikke-border">
        <span className="absolute inset-y-0 left-0 w-16 animate-pulse bg-nikke-accent" />
      </div>
    )}
    <p className={`text-[15px] ${isError ? 'text-red-500 dark:text-[#FFB4B6]' : 'text-nikke-text-secondary'}`}>{message}</p>
  </div>
);

type ThemeMode = 'dark' | 'light';
type ThemePreference = ThemeMode | 'system';

const THEME_STORAGE_KEY = 'nikke-theme';
const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

const readStoredThemePreference = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  } catch {
    return 'system';
  }
};

const readSystemTheme = (): ThemeMode => (
  typeof window !== 'undefined' && window.matchMedia?.(LIGHT_SCHEME_QUERY).matches ? 'light' : 'dark'
);

export interface AppInitialData { scripts: Script[]; history: BrowserHistoryState }

const App: React.FC<{ initialData?: AppInitialData }> = ({ initialData }) => {
  const deploymentRefresh = useDeploymentRefresh();

  const [chapterTitle, setChapterTitle] = useState<string | null>(initialData?.history.chapterTitle ?? null);
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [isSidebarOpenOnMobile, setIsSidebarOpenOnMobile] = useState<boolean>(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [viewerSearchFocus, setViewerSearchFocus] = useState<ViewerSearchFocus | null>(initialData?.history.viewerSearchFocus ?? null);
  const [isHistoryReady, setIsHistoryReady] = useState<boolean>(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(readSystemTheme);
  const themeMode: ThemeMode = themePreference === 'system' ? systemTheme : themePreference;
  const skipNextHistorySyncRef = useRef<boolean>(false);
  const isFirstThemeApplyRef = useRef<boolean>(true);
  const isFirstViewScrollRef = useRef<boolean>(true);
  const hasWrittenHistoryStateRef = useRef<boolean>(false);

  const {
    scripts,
    isLoadingInitialData,
    isIndexing,
    indexingError,
  } = useScriptIndexing(initialData?.scripts);

  const {
    searchTerm,
    speakerSearchTerm,
    searchCategoryKey,
    setSearchCategoryKey,
    handleSearchCategoryChange,
    searchError,
    debouncedSearchTerm,
    debouncedSpeakerSearchTerm,
    isUserSearching,
    totalSearchResults,
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
  } = useScriptSearch({ scripts });

  const {
    currentView,
    activeCategoryKey,
    selectedScriptId,
    selectedScript,
    scriptsForActiveCategoryWhenBrowsing,
    handleNavigateToPreviousScript,
    handleSelectScript,
    handleCategorySelect,
    handleNavigateToNextScript,
    handleNavigateToSearch,
    handleNavigateToStories,
    handleNavigateToAiChat,
    setCurrentView,
    setActiveCategoryKey,
    setSelectedScriptId,
  } = useScriptNavigation({
    initialState: initialData?.history,
    scripts,
    onSearchClear: handleClearSearch,
    isSidebarOpenOnMobile,
    setIsSidebarOpenOnMobile,
  });

  const isSearchView = currentView === 'search' || currentView === 'speakers';
  const isStoriesView = currentView === 'stories';
  const isAiChatView = currentView === 'ai_chat';

  const activeNav: 'stories' | 'search' | 'ai_chat' = isAiChatView
    ? 'ai_chat'
    : isStoriesView || currentView === 'script_viewer'
    ? 'stories'
    : 'search';

  const applyHistoryState = React.useCallback((historyState: BrowserHistoryState) => {
    skipNextHistorySyncRef.current = true;

    setCurrentView(historyState.view);
    setSearchCategoryKey(historyState.searchCategoryKey);
    setChapterTitle(historyState.chapterTitle);
    setSpeakerId(historyState.speakerId);
    setActiveCategoryKey(historyState.categoryKey);
    setSelectedScriptId(historyState.scriptId);
    setViewerSearchFocus(historyState.viewerSearchFocus);
    setSearchTerm(historyState.searchTerm);
    setSpeakerSearchTerm(historyState.speakerSearchTerm);
    setDebouncedSearchTerm(normalizeSearchValue(historyState.searchTerm));
    setDebouncedSpeakerSearchTerm(normalizeSearchValue(historyState.speakerSearchTerm));
    setIsUserSearching(false);
    setIsSidebarOpenOnMobile(false);
  }, [
    setActiveCategoryKey,
    setCurrentView,
    setSearchCategoryKey,
    setDebouncedSearchTerm,
    setDebouncedSpeakerSearchTerm,
    setIsUserSearching,
    setSpeakerSearchTerm,
    setSearchTerm,
    setSelectedScriptId,
  ]);

  const scriptsToDisplayInSidebar = useMemo(() => {
    if (currentView === 'search' || currentView === 'ai_chat') return [];
    return (debouncedSearchTerm || debouncedSpeakerSearchTerm) ? sidebarSearchedScripts : scriptsForActiveCategoryWhenBrowsing;
  }, [currentView, debouncedSearchTerm, debouncedSpeakerSearchTerm, sidebarSearchedScripts, scriptsForActiveCategoryWhenBrowsing]);

  const historyState = useMemo<BrowserHistoryState>(() => ({
    view: currentView,
    searchCategoryKey: currentView === 'search' ? searchCategoryKey : null,
    chapterTitle: currentView === 'stories' ? chapterTitle : null,
    speakerId: currentView === 'speakers' ? speakerId : null,
    categoryKey: currentView === 'stories' || currentView === 'script_viewer' ? activeCategoryKey : null,
    scriptId: currentView === 'script_viewer' ? selectedScriptId : null,
    searchTerm: currentView === 'search' ? debouncedSearchTerm : '',
    speakerSearchTerm: currentView === 'search' ? debouncedSpeakerSearchTerm : '',
    viewerSearchFocus: currentView === 'script_viewer' ? viewerSearchFocus : null,
  }), [activeCategoryKey, currentView, debouncedSearchTerm, debouncedSpeakerSearchTerm, selectedScriptId, viewerSearchFocus, searchCategoryKey, chapterTitle, speakerId]);

  useEffect(() => {
    document.body.style.overflow = isSidebarOpenOnMobile ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpenOnMobile]);

  useEffect(() => {
    const root = document.documentElement;
    // 첫 적용은 theme-init.js와 같으므로 전환 효과 없이, 이후 토글할 때만 색을 부드럽게 바꾼다
    const shouldAnimate = !isFirstThemeApplyRef.current;
    isFirstThemeApplyRef.current = false;
    if (shouldAnimate) {
      root.classList.add('theme-transition');
    }
    root.classList.toggle('dark', themeMode === 'dark');
    root.dataset.theme = themeMode;
    if (!shouldAnimate) return;
    const timeout = window.setTimeout(() => root.classList.remove('theme-transition'), 320);
    return () => {
      window.clearTimeout(timeout);
      root.classList.remove('theme-transition');
    };
  }, [themeMode]);

  // 직접 고른 테마만 저장한다. '시스템'이면 저장값을 지워 기기 설정을 계속 따른다.
  useEffect(() => {
    try {
      if (themePreference === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, themePreference);
      }
    } catch {
      // 저장소를 쓸 수 없어도 테마 전환은 계속한다
    }
  }, [themePreference]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(LIGHT_SCHEME_QUERY);
    if (!mediaQuery) return;
    const handleChange = () => setSystemTheme(mediaQuery.matches ? 'light' : 'dark');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const initialHistoryState = parseHistoryStateFromLocation(window.location.search, window.location.pathname);
    applyHistoryState(initialHistoryState);
    setIsHistoryReady(true);

    const handlePopState = () => {
      applyHistoryState(parseHistoryStateFromLocation(window.location.search, window.location.pathname));
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

  // 헤더 토글: 반대 테마로 바꾸되, 그 결과가 기기 설정과 같으면 다시 '시스템 따르기'로 돌아간다
  const toggleTheme = () => {
    const nextTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemePreference(nextTheme === systemTheme ? 'system' : nextTheme);
  };

  const viewerLoading = (isLoadingInitialData || (isIndexing && scripts.length === 0 && !indexingError)) && !selectedScriptId;
  // 장면 ID → 타이틀 안 순번 (분기 목적지를 "03 여학교의 함정"처럼 표시할 때 쓴다)
  const sceneNumberById = useMemo(() => {
    const numbers = new Map<string, number>();
    const countsByTitle = new Map<string, number>();
    for (const entry of scripts) {
      const titleKey = `${entry.categoryKey}@@${entry.title}`;
      const nextNumber = (countsByTitle.get(titleKey) ?? 0) + 1;
      countsByTitle.set(titleKey, nextNumber);
      numbers.set(entry.id, nextNumber);
    }
    return numbers;
  }, [scripts]);

  const describeScene = React.useCallback((scriptId: string) => {
    const target = scripts.find(entry => entry.id === scriptId);
    if (!target) return undefined;
    const number = sceneNumberById.get(scriptId);
    const sceneName = `${number ? `${String(number).padStart(2, '0')} ` : ''}${target.subTitle || target.title}`;
    return target.title === selectedScript?.title ? sceneName : `${target.title} · ${sceneName}`;
  }, [sceneNumberById, scripts, selectedScript?.title]);

  const scriptsInSelectedChapter = useMemo(() => {
    if (!selectedScript) return [];
    return scripts.filter(entry => (
      entry.categoryKey === selectedScript.categoryKey
      && entry.title === selectedScript.title
    ));
  }, [scripts, selectedScript]);

  const selectedScriptChapterIndex = useMemo(() => {
    if (!selectedScript) return -1;
    return scriptsInSelectedChapter.findIndex(entry => entry.id === selectedScript.id);
  }, [scriptsInSelectedChapter, selectedScript]);

  // 이전/다음 범위: 메인 스토리는 챕터를 넘어 이어지고, 그 외 분류는 같은 타이틀 안에서만 움직인다
  const sequentialScripts = useMemo(() => (
    selectedScript ? getSequentialScripts(scripts, selectedScript) : []
  ), [scripts, selectedScript]);
  const selectedSequentialIndex = selectedScript
    ? sequentialScripts.findIndex(entry => entry.id === selectedScript.id)
    : -1;
  const previousSequentialScript = selectedSequentialIndex > 0 ? sequentialScripts[selectedSequentialIndex - 1] : null;
  const nextSequentialScript = selectedSequentialIndex !== -1 ? sequentialScripts[selectedSequentialIndex + 1] ?? null : null;
  const canNavigateToPreviousScript = !!previousSequentialScript;
  const canNavigateToNextScript = !!nextSequentialScript;
  const isSearchPending = (
    normalizeSearchValue(searchTerm) !== debouncedSearchTerm
    || normalizeSearchValue(speakerSearchTerm) !== debouncedSpeakerSearchTerm
  );

  const handleSelectScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleSelectScript(scriptId);
  };

  const handleSelectScriptFromSearch = (scriptId: string) => {
    const focusContentTerm = debouncedSearchTerm.trim() || normalizeSearchValue(searchTerm);
    const focusSpeakerTerm = debouncedSpeakerSearchTerm.trim() || normalizeSearchValue(speakerSearchTerm);
    const nextFocus = focusContentTerm
      ? { term: focusContentTerm, mode: 'content' as const, speakerTerm: focusSpeakerTerm || undefined }
      : focusSpeakerTerm
        ? { term: focusSpeakerTerm, mode: 'speaker' as const }
        : null;
    setViewerSearchFocus(nextFocus);
    handleSelectScript(scriptId);
  };

  const handleNavigateToNextScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleNavigateToNextScript(scriptId);
  };

  const handleNavigateToPreviousScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleNavigateToPreviousScript(scriptId);
  };

  const handleNavigateToScriptWithoutSearchFocus = (scriptId: string) => {
    setViewerSearchFocus(null);
    handleSelectScript(scriptId);
  };

  const handleCategorySelectWithoutSearchFocus = (categoryKey: string) => {
    setChapterTitle(null);
    setViewerSearchFocus(null);
    handleCategorySelect(categoryKey);
  };

  const handleNavigateToSearchWithoutSearchFocus = () => {
    setViewerSearchFocus(null);
    handleNavigateToSearch();
  };

  const handleNavigateToStoriesWithoutSearchFocus = (categoryKey?: string | null) => {
    setChapterTitle(null);
    setViewerSearchFocus(null);
    handleNavigateToStories(categoryKey);
  };

  const handleNavigateToAiChatWithoutSearchFocus = () => {
    setViewerSearchFocus(null);
    handleNavigateToAiChat();
  };

  // 화면마다 탭 제목을 바꿔 탭·북마크·공유에서 구분되게 한다
  useEffect(() => {
    const siteName = SITE_NAME;
    let nextTitle = HOME_TITLE;

    if (currentView === 'script_viewer' && selectedScript) {
      nextTitle = selectedScript.subTitle
        ? `${selectedScript.subTitle} · ${selectedScript.title} | ${siteName}`
        : `${selectedScript.title} | ${siteName}`;
    } else if (currentView === 'stories' && activeCategoryKey) {
      const categoryName = SCRIPT_CATEGORIES.find(category => category.key === activeCategoryKey)?.name;
      if (categoryName) nextTitle = `${categoryName} | ${siteName}`;
    } else if (currentView === 'search') {
      const queryLabel = [debouncedSearchTerm, debouncedSpeakerSearchTerm].filter(Boolean).join(' · ');
      nextTitle = queryLabel ? `"${queryLabel}" 검색 | ${siteName}` : `기록 검색 | ${siteName}`;
    } else if (currentView === 'speakers') {
      nextTitle = `화자별 기록 | ${siteName}`;
    } else if (currentView === 'ai_chat') {
      nextTitle = `기록 질의 | ${siteName}`;
    }

    document.title = nextTitle;
    if (isHistoryReady) updatePageMetadata(historyState, selectedScript, nextTitle);
  }, [activeCategoryKey, currentView, debouncedSearchTerm, debouncedSpeakerSearchTerm, selectedScript, historyState, isHistoryReady]);

  // 화면·분류·장면이 바뀌면 맨 위에서 시작한다. 검색에서 들어온 장면은 ScriptViewer가 일치 위치로 스크롤한다.
  useEffect(() => {
    if (isFirstViewScrollRef.current) {
      isFirstViewScrollRef.current = false;
      return;
    }
    if (currentView === 'script_viewer' && viewerSearchFocus) return;
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, activeCategoryKey, selectedScriptId, speakerId]);

  // 키보드: Esc 메뉴 닫기, / 검색, ← → 장면 이동
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape' && isSidebarOpenOnMobile) {
        setIsSidebarOpenOnMobile(false);
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping = !!target && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      const isModalOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');
      if (isTyping || isModalOpen || isSidebarOpenOnMobile) return;

      if (event.key === '/') {
        event.preventDefault();
        if (currentView === 'search') {
          document.getElementById('search-content')?.focus();
        } else {
          handleNavigateToSearchWithoutSearchFocus();
        }
        return;
      }

      if (currentView !== 'script_viewer' || !selectedScript || event.shiftKey) return;

      if (event.key === 'ArrowLeft' && canNavigateToPreviousScript) {
        event.preventDefault();
        handleNavigateToPreviousScriptWithoutSearchFocus(selectedScript.id);
      } else if (event.key === 'ArrowRight' && canNavigateToNextScript) {
        event.preventDefault();
        handleNavigateToNextScriptWithoutSearchFocus(selectedScript.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const drawerProps = {
    activeNav,
    onNavigateMain: (navKey: 'stories' | 'search' | 'ai_chat') => {
      if (navKey === 'stories') {
        handleNavigateToStoriesWithoutSearchFocus(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null);
      } else if (navKey === 'search') {
        handleNavigateToSearchWithoutSearchFocus();
      } else {
        handleNavigateToAiChatWithoutSearchFocus();
      }
    },
    themePreference,
    onThemePreferenceChange: setThemePreference,
  };

  const renderStoriesLayout = () => (
    <div className="flex flex-1">
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 items-start gap-x-16 px-[clamp(16px,3vw,32px)] pb-24 pt-8 md:pt-12">
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
          {...drawerProps}
          hideScriptListAndSearch={true}
          hideOnDesktop={!activeCategoryKey}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="min-w-0 flex-[999_1_560px]">
          <StoriesPage
            categories={SCRIPT_CATEGORIES}
            scripts={scripts}
            activeCategoryKey={activeCategoryKey}
            selectedScriptId={selectedScriptId}
            onCategorySelect={handleCategorySelectWithoutSearchFocus}
            onSelectScript={handleSelectScriptWithoutSearchFocus}
            onNavigateToHome={() => handleNavigateToStoriesWithoutSearchFocus(null)}
            onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
            onNavigateToAiChat={handleNavigateToAiChatWithoutSearchFocus}
            chapterTitleFilter={chapterTitle}
            onSearch={(term) => {
              handleNavigateToSearchWithoutSearchFocus();
              handleSearchInputChange(term);
            }}
          />
        </main>
      </div>
    </div>
  );

  const renderScriptViewerLayout = () => (
    <div className="flex flex-1">
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 items-start gap-x-16 px-[clamp(16px,3vw,32px)] pb-24 pt-8 md:pt-12">
        <Sidebar
          key={activeCategoryKey || 'sidebar-script-viewer-key'}
          categories={SCRIPT_CATEGORIES}
          activeCategoryKey={activeCategoryKey}
          scripts={scriptsToDisplayInSidebar}
          selectedScriptId={selectedScript?.id || null}
          onSelectScript={handleSelectScriptWithoutSearchFocus}
          isLoadingInitialMetadata={isLoadingInitialData}
          isIndexingScripts={isIndexing && scripts.length === 0}
          isSearching={isUserSearching || isSearchPending}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchInputChange}
          onClearSearch={handleClearSearch}
          isOpenOnMobile={isSidebarOpenOnMobile}
          onClose={() => setIsSidebarOpenOnMobile(false)}
          onCategorySelect={handleCategorySelectWithoutSearchFocus}
          {...drawerProps}
          onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
          listOnlyMode={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="min-w-0 flex-[999_1_560px]">
          {viewerLoading ? (
            <LoadingMessage
              message={isLoadingInitialData ? '기록 목록을 불러오는 중입니다' : '금서고를 준비하는 중입니다'}
              isSpinning={true}
            />
          ) : indexingError && scripts.length === 0 ? (
            <LoadingMessage message={`기록 목록을 불러오지 못했습니다: ${indexingError}`} isError={true} />
          ) : (
            <ScriptViewer
              script={selectedScript}
              describeScene={describeScene}
              searchFocus={viewerSearchFocus}
              canNavigateToPreviousScript={canNavigateToPreviousScript}
              canNavigateToNextScript={canNavigateToNextScript}
              categoryRoman={SCRIPT_CATEGORIES.find(category => category.key === selectedScript?.categoryKey)?.roman}
              sceneIndex={selectedScriptChapterIndex}
              sceneCount={scriptsInSelectedChapter.length}
              previousChapterTitle={previousSequentialScript && previousSequentialScript.title !== selectedScript?.title ? previousSequentialScript.title : undefined}
              nextChapterTitle={nextSequentialScript && nextSequentialScript.title !== selectedScript?.title ? nextSequentialScript.title : undefined}
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
              onNavigateToPreviousScript={handleNavigateToPreviousScriptWithoutSearchFocus}
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
    <div className="flex flex-1">
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 items-start gap-x-16 px-[clamp(16px,3vw,32px)] pb-24 pt-8 md:pt-12">
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
          {...drawerProps}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="min-w-0 flex-[999_1_560px]">
          {currentView === 'speakers' ? (
            <SpeakerIndexPage scripts={scripts} categories={SCRIPT_CATEGORIES} speakerId={speakerId}
              onSelectSpeaker={setSpeakerId}
              onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
              onSelectScript={(id, speaker) => {
                setViewerSearchFocus({ term: speaker, mode: 'speaker' });
                handleSelectScript(id);
              }}
            />
          ) : <SearchPage
            categories={SCRIPT_CATEGORIES}
            globallySearchedScripts={globallySearchedScripts}
            selectedScriptId={selectedScriptId}
            onSelectScript={handleSelectScriptFromSearch}
            isLoadingInitialMetadata={isLoadingInitialData}
            isIndexingScripts={isIndexing && scripts.length === 0}
            isSearching={isUserSearching || isSearchPending}
            totalSearchResults={totalSearchResults}
            hasMoreSearchResults={hasMoreSearchResults}
            searchTerm={searchTerm}
            speakerSearchTerm={speakerSearchTerm}
            onSearchTermChange={handleSearchInputChange}
            onSpeakerSearchTermChange={handleSpeakerSearchInputChange}
            searchCategoryKey={searchCategoryKey}
            onSearchCategoryChange={handleSearchCategoryChange}
            searchError={searchError}
            onBrowseSpeakers={() => { handleClearSearch(); setSpeakerId(null); setActiveCategoryKey(null); setCurrentView('speakers'); }}
            onClearSearch={handleClearSearch}
            onLoadMoreSearchResults={handleLoadMoreSearchResults}
            onCategorySelect={handleCategorySelectWithoutSearchFocus}
          />}
        </main>
      </div>
    </div>
  );

  const renderAiChatPageLayout = () => (
    <div className="flex flex-1">
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 items-start gap-x-16 px-[clamp(16px,3vw,32px)] pb-24 pt-8 md:pt-12">
        <Sidebar
          key="ai-chat-page-sidebar"
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
          {...drawerProps}
          hideScriptListAndSearch={true}
        />
        {isSidebarOpenOnMobile && (
          <div
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
            onClick={() => setIsSidebarOpenOnMobile(false)}
            aria-hidden="true"
          ></div>
        )}
        <main className="min-w-0 flex-[999_1_560px]">
          <AiChatPage />
        </main>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-nikke-bg text-nikke-text-primary antialiased transition-colors duration-500">
      <Header
        onToggleSidebar={(currentView === 'search' || currentView === 'stories' || currentView === 'script_viewer' || currentView === 'ai_chat' || currentView === 'speakers') ? () => setIsSidebarOpenOnMobile(prev => !prev) : undefined}
        isSidebarOpen={isSidebarOpenOnMobile}
        className="sticky top-0 z-50 shrink-0"
        onNavigateToHome={() => handleNavigateToStoriesWithoutSearchFocus(null)}
        onNavigateToSearch={handleNavigateToSearchWithoutSearchFocus}
        onNavigateToStories={() => handleNavigateToStoriesWithoutSearchFocus(activeCategoryKey ?? SCRIPT_CATEGORIES[0]?.key ?? null)}
        onNavigateToAiChat={handleNavigateToAiChatWithoutSearchFocus}
        activeNav={activeNav}
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
      />
      {deploymentRefresh.hasUpdate && (
        <UpdateNotice onReload={deploymentRefresh.reload} onDismiss={deploymentRefresh.dismiss} />
      )}
      {isSearchView ? renderSearchPageLayout() : isStoriesView ? renderStoriesLayout() : isAiChatView ? renderAiChatPageLayout() : renderScriptViewerLayout()}
      <Footer className="shrink-0" />
    </div>
  );
};

export default App;
