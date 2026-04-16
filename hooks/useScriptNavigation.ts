import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Script } from '../types';

export type AppView = 'search' | 'stories' | 'script_viewer';

interface UseScriptNavigationProps {
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
  handleSelectScript: (scriptId: string) => void;
  handleCategorySelect: (categoryKey: string) => void;
  handleNavigateToNextScript: (currentScriptId: string) => void;
  handleNavigateToSearch: () => void;
  handleNavigateToStories: (categoryKey?: string | null) => void;
  setCurrentView: React.Dispatch<React.SetStateAction<AppView>>;
  setActiveCategoryKey: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedScriptId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useScriptNavigation({
  scripts,
  onSearchClear,
  isSidebarOpenOnMobile,
  setIsSidebarOpenOnMobile,
}: UseScriptNavigationProps): UseScriptNavigationReturn {
  const [currentView, setCurrentView] = useState<AppView>('search');
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

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

    const scriptsInSameChapter = scripts.filter(
      s => s.categoryKey === currentScriptInstance.categoryKey && s.title === currentScriptInstance.title
    );

    const currentIndex = scriptsInSameChapter.findIndex(s => s.id === currentScriptId);

    if (currentIndex !== -1 && currentIndex < scriptsInSameChapter.length - 1) {
      handleSelectScript(scriptsInSameChapter[currentIndex + 1].id);
    }
  }, [scripts, handleSelectScript]);

  const handleNavigateToSearch = useCallback(() => {
    setCurrentView('search');
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
    handleSelectScript,
    handleCategorySelect,
    handleNavigateToNextScript,
    handleNavigateToSearch,
    handleNavigateToStories,
    setCurrentView,
    setActiveCategoryKey,
    setSelectedScriptId,
  };
}
