import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Script } from '../types';

export type AppView = 'search' | 'stories' | 'script_viewer' | 'ai_chat' | 'speakers';

interface UseScriptNavigationProps {
  initialState?: { view: AppView; categoryKey: string | null; scriptId: string | null };
  scripts: Script[];
  onSearchClear: () => void;
  isSidebarOpenOnMobile: boolean;
  setIsSidebarOpenOnMobile: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseScriptNavigationReturn {
  currentView: AppView;
  activeCategoryKey: string | null;
  selectedScriptId: string | null;
  selectedScript: Script | null;
  scriptsForActiveCategoryWhenBrowsing: Script[];
  handleNavigateToPreviousScript: (currentScriptId: string) => void;
  handleSelectScript: (scriptId: string) => void;
  handleCategorySelect: (categoryKey: string) => void;
  handleNavigateToNextScript: (currentScriptId: string) => void;
  handleNavigateToSearch: () => void;
  handleNavigateToStories: (categoryKey?: string | null) => void;
  handleNavigateToAiChat: () => void;
  setCurrentView: React.Dispatch<React.SetStateAction<AppView>>;
  setActiveCategoryKey: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedScriptId: React.Dispatch<React.SetStateAction<string | null>>;
}

/** 챕터 경계를 넘어 이어서 이동할 수 있는 분류 */
const CROSS_CHAPTER_CATEGORIES = new Set(['main_story']);

/**
 * 이전/다음 이동 범위에 들어가는 장면 목록.
 * 메인 스토리는 분류 전체(챕터 순서대로)를, 그 외 분류는 같은 타이틀 안의 장면만 돌려준다.
 */
export const getSequentialScripts = (scripts: Script[], currentScript: Script): Script[] => (
  CROSS_CHAPTER_CATEGORIES.has(currentScript.categoryKey)
    ? scripts.filter(s => s.categoryKey === currentScript.categoryKey)
    : scripts.filter(s => s.categoryKey === currentScript.categoryKey && s.title === currentScript.title)
);

export function useScriptNavigation({
  initialState,
  scripts,
  onSearchClear,
  isSidebarOpenOnMobile,
  setIsSidebarOpenOnMobile,
}: UseScriptNavigationProps): UseScriptNavigationReturn {
  const [currentView, setCurrentView] = useState<AppView>(initialState?.view ?? 'stories');
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(initialState?.categoryKey ?? null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(initialState?.scriptId ?? null);

  const scriptsForActiveCategoryWhenBrowsing = useMemo(() => {
    if (!activeCategoryKey || scripts.length === 0) return [];
    return scripts.filter(script => script.categoryKey === activeCategoryKey);
  }, [scripts, activeCategoryKey]);

  const selectedScript = useMemo(() => {
    if (scripts.length === 0 || !selectedScriptId) return null;
    if (currentView !== 'script_viewer') return null;

    const scriptById = scripts.find(s => s.id === selectedScriptId);
    if (!scriptById) return null;

    if (activeCategoryKey && scriptById.categoryKey !== activeCategoryKey) return null;

    return scriptById;
  }, [scripts, selectedScriptId, currentView, activeCategoryKey]);

  const closeMobileSidebarIfNeeded = useCallback(() => {
    if (isSidebarOpenOnMobile) {
      setIsSidebarOpenOnMobile(false);
    }
  }, [isSidebarOpenOnMobile, setIsSidebarOpenOnMobile]);

  const handleSelectScript = useCallback((scriptId: string) => {
    const scriptToSelect = scripts.find(s => s.id === scriptId);
    if (scriptToSelect) {
      setCurrentView('script_viewer');
      setActiveCategoryKey(scriptToSelect.categoryKey);
      setSelectedScriptId(scriptId);
      onSearchClear();
      closeMobileSidebarIfNeeded();
    }
  }, [scripts, onSearchClear, closeMobileSidebarIfNeeded]);

  const handleCategorySelect = useCallback((categoryKey: string) => {
    setCurrentView('stories');
    setActiveCategoryKey(categoryKey);
    setSelectedScriptId(null);
    onSearchClear();
    closeMobileSidebarIfNeeded();
  }, [onSearchClear, closeMobileSidebarIfNeeded]);

  const handleNavigateToStories = useCallback((categoryKey?: string | null) => {
    setCurrentView('stories');
    setActiveCategoryKey(categoryKey ?? null);
    setSelectedScriptId(null);
    onSearchClear();
    closeMobileSidebarIfNeeded();
  }, [onSearchClear, closeMobileSidebarIfNeeded]);

  const handleNavigateToNextScript = useCallback((currentScriptId: string) => {
    const currentScriptInstance = scripts.find(s => s.id === currentScriptId);
    if (!currentScriptInstance) return;

    const sequentialScripts = getSequentialScripts(scripts, currentScriptInstance);

    const currentIndex = sequentialScripts.findIndex(s => s.id === currentScriptId);

    if (currentIndex !== -1 && currentIndex < sequentialScripts.length - 1) {
      handleSelectScript(sequentialScripts[currentIndex + 1].id);
    }
  }, [scripts, handleSelectScript]);

  const handleNavigateToPreviousScript = useCallback((currentScriptId: string) => {
    const currentScriptInstance = scripts.find(s => s.id === currentScriptId);
    if (!currentScriptInstance) return;

    const sequentialScripts = getSequentialScripts(scripts, currentScriptInstance);

    const currentIndex = sequentialScripts.findIndex(s => s.id === currentScriptId);

    if (currentIndex > 0) {
      handleSelectScript(sequentialScripts[currentIndex - 1].id);
    }
  }, [scripts, handleSelectScript]);

  const handleNavigateToSearch = useCallback(() => {
    setCurrentView('search');
    setActiveCategoryKey(null);
    setSelectedScriptId(null);
    onSearchClear();
    closeMobileSidebarIfNeeded();
  }, [onSearchClear, closeMobileSidebarIfNeeded]);

  const handleNavigateToAiChat = useCallback(() => {
    setCurrentView('ai_chat');
    setActiveCategoryKey(null);
    setSelectedScriptId(null);
    onSearchClear();
    closeMobileSidebarIfNeeded();
  }, [onSearchClear, closeMobileSidebarIfNeeded]);

  useEffect(() => {
    if (currentView === 'script_viewer' && !activeCategoryKey && scripts.length > 0) {
      setCurrentView('stories');
      setSelectedScriptId(null);
    }
  }, [currentView, activeCategoryKey, scripts]);

  return {
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
  };
}
