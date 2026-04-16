import React, { useEffect, useMemo, useState } from 'react';
import type { Script, ScriptCategory } from '../types';
import { SearchIcon, ChevronDownIcon, ChevronRightIcon, type IconProps, XIcon } from './Icons';

interface SidebarProps {
  categories: ScriptCategory[];
  activeCategoryKey: string | null;
  scripts: Script[];
  selectedScriptId: string | null;
  onSelectScript: (id: string) => void;
  isLoadingInitialMetadata: boolean;
  isIndexingScripts: boolean;
  isSearching: boolean;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  onClearSearch: () => void;
  isOpenOnMobile?: boolean;
  onClose?: () => void;
  onCategorySelect: (categoryKey: string) => void;
  onNavigateToSearch?: () => void;
  hideScriptListAndSearch?: boolean;
  listOnlyMode?: boolean;
}

const SkeletonItem: React.FC = () => (
  <div className="mb-2 ml-4 h-8 animate-pulse rounded-full bg-nikke-surface-high"></div>
);

const SkeletonChapter: React.FC = () => (
  <div className="mb-4">
    <div className="mb-2 h-7 animate-pulse rounded-full bg-nikke-surface-highest"></div>
    <SkeletonItem />
    <SkeletonItem />
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  categories,
  activeCategoryKey,
  scripts,
  selectedScriptId,
  onSelectScript,
  isLoadingInitialMetadata,
  isIndexingScripts,
  isSearching,
  searchTerm,
  onSearchTermChange,
  onClearSearch,
  isOpenOnMobile,
  onClose,
  onCategorySelect,
  onNavigateToSearch,
  hideScriptListAndSearch = false,
  listOnlyMode = false,
}) => {
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});

  const groupedScripts = useMemo(() => {
    if (hideScriptListAndSearch || !scripts || scripts.length === 0) return {};

    return scripts.reduce<Record<string, Script[]>>((acc, script) => {
      const groupKey = searchTerm ? `${script.categoryKey}@@${script.title}` : script.title;
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(script);
      return acc;
    }, {});
  }, [scripts, searchTerm, hideScriptListAndSearch]);

  useEffect(() => {
    if (hideScriptListAndSearch) {
      setExpandedChapters({});
      return;
    }

    if (selectedScriptId && scripts.length > 0) {
      const selectedScriptInstance = scripts.find(s => s.id === selectedScriptId);
      if (selectedScriptInstance) {
        const groupKey = searchTerm ? `${selectedScriptInstance.categoryKey}@@${selectedScriptInstance.title}` : selectedScriptInstance.title;
        setExpandedChapters({ [groupKey]: true });
      }
    } else if (searchTerm && Object.keys(groupedScripts).length > 0 && !isIndexingScripts && !isSearching) {
      const nextExpanded: Record<string, boolean> = {};
      Object.keys(groupedScripts).forEach(key => {
        nextExpanded[key] = true;
      });
      setExpandedChapters(nextExpanded);
    }
  }, [selectedScriptId, scripts, searchTerm, groupedScripts, isIndexingScripts, isSearching, hideScriptListAndSearch]);

  const toggleChapterExpansion = (groupKey: string) => {
    setExpandedChapters(prev => (
      prev[groupKey]
        ? {}
        : { [groupKey]: true }
    ));
  };

  const showLoadingStateForSearchInput = isLoadingInitialMetadata || isIndexingScripts;
  const searchPlaceholder = showLoadingStateForSearchInput
    ? 'Loading scripts...'
    : 'Search from the sidebar';

  return (
    <aside
      id="sidebar"
      className={`
        fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto bg-nikke-surface/96 p-4 shadow-ambient ring-1 ring-nikke-border/10 backdrop-blur-xl transition-transform duration-300 ease-editorial
        ${isOpenOnMobile ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:max-h-[calc(100vh-176px)] md:w-80 md:translate-x-0 md:rounded-[2rem] md:p-5
      `}
      aria-hidden={!isOpenOnMobile && typeof window !== 'undefined' && window.innerWidth < 768}
      aria-labelledby="sidebar-title"
    >
      {isOpenOnMobile && onClose && (
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-nikke-surface-high p-1.5 text-nikke-text-muted transition-colors duration-300 ease-editorial hover:text-nikke-text-primary md:hidden"
          aria-label="Close menu"
        >
          <XIcon className="h-6 w-6" />
        </button>
      )}

      {!listOnlyMode && (
        <div className="mb-5 mt-8 md:mt-0">
          <p className="font-label text-[11px] uppercase tracking-[0.22em] text-nikke-accent">Archive Sections</p>
          <h2 id="sidebar-title" className="mt-3 font-headline text-xl font-extrabold tracking-[-0.02em] text-nikke-text-primary">
            Curated Navigation
          </h2>
          <p className="mt-2 text-sm leading-6 text-nikke-text-secondary">
            Explore archive sections and jump into global search whenever you need a wider result set.
          </p>
        </div>
      )}

      {!listOnlyMode && (
        <nav className="mb-4">
          <ul className="space-y-2">
            {categories.map(category => (
              <li key={category.key}>
                <a
                  href={`#${category.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCategorySelect(category.key);
                  }}
                  className={`group flex w-full items-center rounded-[1rem] px-3 py-2.5 text-left text-sm transition-all duration-300 ease-editorial
                    ${activeCategoryKey === category.key && !searchTerm
                      ? 'bg-nikke-surface-high text-nikke-text-primary'
                      : 'text-nikke-text-secondary hover:bg-nikke-surface-low/70 hover:text-nikke-text-primary'
                    }`}
                  aria-current={activeCategoryKey === category.key && !searchTerm ? 'page' : undefined}
                >
                  {category.icon && React.isValidElement(category.icon) && React.cloneElement(category.icon as React.ReactElement<IconProps>, {
                    className: `mr-3 h-5 w-5 ${(activeCategoryKey === category.key && !searchTerm) ? 'text-nikke-accent' : 'text-nikke-accent/80 group-hover:text-nikke-accent'}`,
                  })}
                  <span className="flex-1">
                    <span className="block font-semibold">{category.name}</span>
                  </span>
                  <span className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ease-editorial ${(activeCategoryKey === category.key && !searchTerm) ? 'bg-nikke-accent' : 'bg-nikke-border/40 group-hover:bg-nikke-accent/60'}`} />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {!hideScriptListAndSearch && (
        <>
          {!listOnlyMode && (
            <div className="relative my-5">
              <div className="relative">
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => onSearchTermChange(e.target.value)}
                  aria-label="Search all scripts"
                  className="w-full rounded-full bg-nikke-bg-alt/90 px-12 py-3 text-sm text-nikke-text-primary outline-none ring-1 ring-transparent transition-all duration-300 ease-editorial placeholder:text-nikke-text-muted focus:bg-nikke-bg-alt focus:ring-2 focus:ring-nikke-accent/30"
                  disabled={showLoadingStateForSearchInput}
                />
                <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-nikke-text-muted" />
                {searchTerm && (
                  <button
                    onClick={onClearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-nikke-text-muted transition-colors duration-300 ease-editorial hover:text-nikke-text-primary"
                    aria-label="Clear search"
                  >
                    <XIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
              {showLoadingStateForSearchInput && (
                <p className="mt-2 text-center font-label text-[11px] uppercase tracking-[0.18em] text-nikke-accent">
                  {isLoadingInitialMetadata ? 'Metadata Loading' : 'Archive Indexing'}
                </p>
              )}
              {isSearching && searchTerm && (
                <p className="mt-2 text-center font-label text-[11px] uppercase tracking-[0.18em] text-nikke-accent">Searching...</p>
              )}
            </div>
          )}

          <div className={`min-h-[100px] flex-grow overflow-y-auto ${listOnlyMode ? '' : 'rounded-[1.5rem] bg-nikke-surface-low/55 p-4'}`}>
            {showLoadingStateForSearchInput && scripts.length === 0 ? (
              <div>
                <SkeletonChapter />
                <SkeletonChapter />
              </div>
            ) : scripts.length > 0 ? (
              <ul className="space-y-2">
                {Object.entries(groupedScripts).map(([groupKey, subScriptsArray]) => {
                  const isExpanded = !!expandedChapters[groupKey];
                  const containsSelectedScript = subScriptsArray.some(s => s.id === selectedScriptId);

                  let displayGroupTitle = groupKey;
                  let categoryNameForGroup: string | undefined;
                  if (searchTerm && groupKey.includes('@@')) {
                    const [catKey, title] = groupKey.split('@@');
                    displayGroupTitle = title;
                    categoryNameForGroup = categories.find(c => c.key === catKey)?.name;
                  }

                  return (
                    <li key={groupKey}>
                      {searchTerm && categoryNameForGroup && (
                        <div className="px-3 pb-2 pt-2 font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted">{categoryNameForGroup}</div>
                      )}
                      <div className={`rounded-[1rem] ${listOnlyMode ? 'bg-nikke-surface-low/65' : ''}`}>
                        <div className={`flex items-center justify-between rounded-[1rem] px-4 py-4 text-left text-sm transition-all duration-300 ease-editorial ${
                          containsSelectedScript || isExpanded
                            ? 'bg-nikke-surface-high text-nikke-text-primary shadow-glass'
                            : 'text-nikke-text-primary hover:bg-nikke-surface-high/80'
                        }`}>
                          <button
                            onClick={() => onSelectScript(subScriptsArray[0].id)}
                            className="min-w-0 flex-1 text-left"
                            aria-current={containsSelectedScript ? 'page' : undefined}
                          >
                            <span className="truncate">
                              <span className="block font-semibold tracking-[-0.01em]">{displayGroupTitle}</span>
                              <span className="mt-1 block font-label text-[11px] uppercase tracking-[0.24em] text-nikke-text-muted">
                                {subScriptsArray.length} entries
                              </span>
                            </span>
                          </button>
                          <button
                            onClick={() => toggleChapterExpansion(groupKey)}
                            className="ml-3 rounded-full p-1 text-nikke-accent transition-transform duration-300 ease-editorial hover:scale-110"
                            aria-label={isExpanded ? 'Collapse chapter' : 'Expand chapter'}
                            aria-expanded={isExpanded}
                            aria-controls={`chapter-contents-${groupKey.replace(/\s+/g, '-')}`}
                          >
                            {isExpanded ? (
                              <ChevronDownIcon className="h-4 w-4" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {isExpanded && (
                          <ul id={`chapter-contents-${groupKey.replace(/\s+/g, '-')}`} className="mt-2 space-y-2 px-2 pb-2">
                            {subScriptsArray.map(script => (
                              <li key={script.id}>
                                <button
                                  onClick={() => onSelectScript(script.id)}
                                  className={`w-full rounded-[0.9rem] px-4 py-3 text-left text-xs transition-all duration-300 ease-editorial ${
                                    selectedScriptId === script.id
                                      ? 'bg-nikke-gradient text-slate-950 shadow-glass'
                                      : 'bg-transparent text-nikke-text-secondary hover:bg-nikke-surface-high/60 hover:text-nikke-text-primary'
                                  }`}
                                  aria-current={selectedScriptId === script.id ? 'page' : undefined}
                                >
                                  <span className="block font-semibold">{script.subTitle || 'Open Content'}</span>
                                  <span className={`mt-1 block font-label tracking-[0.16em] ${selectedScriptId === script.id ? 'text-slate-900/75' : 'text-nikke-text-muted'}`}>
                                    {script.title}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : searchTerm && !isSearching ? (
              <p className="p-4 text-center text-sm text-nikke-text-muted">No scripts matched "{searchTerm}".</p>
            ) : !searchTerm && activeCategoryKey ? (
              <p className="p-4 text-center text-sm text-nikke-text-muted">{`No scripts are available in ${categories.find(c => c.key === activeCategoryKey)?.name || 'this category'}.`}</p>
            ) : (
              <p className="p-4 text-center text-sm text-nikke-text-muted">Select a category or switch to search.</p>
            )}
          </div>

          {!listOnlyMode && onNavigateToSearch && (
            <button
              onClick={onNavigateToSearch}
              className="mt-4 w-full rounded-full bg-nikke-gradient px-4 py-3 text-center text-sm font-semibold text-slate-950 transition-transform duration-300 ease-editorial hover:scale-[1.01]"
            >
              Go to Global Search
            </button>
          )}
        </>
      )}

    </aside>
  );
};
