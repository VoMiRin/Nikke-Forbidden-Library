import { categoryPath, scenePath } from '../lib/pageRoutes.mjs';
import { followInApp } from '../lib/linkNavigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Script, ScriptCategory } from '../types';
import { SearchIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from './Icons';
import { NikkeLogo } from './NikkeLogo';
import { ArchiveStatus, NAV_ITEMS } from './Header';

type MainNavKey = 'stories' | 'search' | 'ai_chat';

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
  /** 모바일 드로어에만 표시되는 주 메뉴 */
  activeNav?: MainNavKey;
  onNavigateMain?: (navKey: MainNavKey) => void;
  /** 모바일 드로어 하단 테마 토글 */
  themePreference?: 'system' | 'dark' | 'light';
  onThemePreferenceChange?: (themePreference: 'system' | 'dark' | 'light') => void;
  /** 데스크톱에서는 레일을 숨기고 모바일 드로어로만 쓴다 (스토리 홈) */
  hideOnDesktop?: boolean;
}

const DESKTOP_QUERY = '(min-width: 768px)';

/** 화면 폭이 md 이상인지 추적한다 (창 크기를 바꿔도 드로어 접근성 상태가 맞도록) */
const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const handleChange = () => setIsDesktop(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
};

const SkeletonItem: React.FC = () => (
  <div className="mb-2 ml-4 h-7 animate-pulse rounded-lg bg-nikke-surface-high"></div>
);

const SkeletonChapter: React.FC = () => (
  <div className="mb-4">
    <div className="mb-2 h-8 animate-pulse rounded-lg bg-nikke-surface-highest"></div>
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
  activeNav,
  onNavigateMain,
  themePreference,
  onThemePreferenceChange,
  hideOnDesktop = false,
}) => {
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>(() => {
    const selected = scripts.find(script => script.id === selectedScriptId);
    return selected ? { [searchTerm ? `${selected.categoryKey}@@${selected.title}` : selected.title]: true } : {};
  });
  const scriptListContainerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const isDesktop = useIsDesktop();
  const isDrawerClosed = typeof window !== 'undefined' && !isDesktop && !isOpenOnMobile;

  // 드로어를 열면 닫기 버튼으로, 닫으면 메뉴 버튼으로 포커스를 옮긴다
  useEffect(() => {
    if (isDesktop) return;
    if (isOpenOnMobile) {
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      document.getElementById('sidebar-toggle')?.focus();
    }
    wasOpenRef.current = !!isOpenOnMobile;
  }, [isOpenOnMobile, isDesktop]);
  const scriptItemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

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

  useEffect(() => {
    if (hideScriptListAndSearch || !selectedScriptId) return;

    const container = scriptListContainerRef.current;
    const selectedItem = scriptItemRefs.current[selectedScriptId];
    if (!container || !selectedItem) return;

    const containerRect = container.getBoundingClientRect();
    const selectedItemRect = selectedItem.getBoundingClientRect();
    const nextScrollTop = (
      selectedItemRect.top
      - containerRect.top
      + container.scrollTop
      - (container.clientHeight / 2)
      + (selectedItem.clientHeight / 2)
    );

    container.scrollTo({
      top: Math.max(0, nextScrollTop),
      behavior: 'smooth',
    });
  }, [selectedScriptId, expandedChapters, hideScriptListAndSearch]);

  const toggleChapterExpansion = (groupKey: string) => {
    setExpandedChapters(prev => (
      prev[groupKey]
        ? {}
        : { [groupKey]: true }
    ));
  };

  const showLoadingStateForSearchInput = isLoadingInitialMetadata || isIndexingScripts;
  const searchPlaceholder = showLoadingStateForSearchInput
    ? '기록을 불러오는 중입니다'
    : '목록에서 검색';
  const activeCategory = categories.find(category => category.key === activeCategoryKey) ?? null;

  return (
    <aside
      id="sidebar"
      className={`
        fixed inset-y-0 left-0 z-[60] flex w-[85vw] max-w-[20rem] flex-col overflow-y-auto border-r border-nikke-border bg-nikke-surface px-4 pb-6 pt-1.5 transition-transform duration-300 ease-editorial
        ${isOpenOnMobile ? 'translate-x-0' : '-translate-x-full'}
        ${hideOnDesktop
          ? 'md:hidden'
          : 'md:sticky md:inset-auto md:top-[88px] md:z-auto md:max-h-[calc(100dvh-112px)] md:w-auto md:max-w-[260px] md:flex-[1_1_220px] md:translate-x-0 md:overflow-hidden md:border-0 md:bg-transparent md:p-0'}
      `}
      inert={isDrawerClosed}
      aria-labelledby="sidebar-title"
    >
      {/* 모바일 드로어 머리: 로고, 닫기, 상태, 주 메뉴 */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-nikke-text-primary">
            <NikkeLogo aria-hidden="true" className="h-6 w-4" />
            <span className="font-headline text-lg font-bold">금서고</span>
          </span>
          {onClose && (
            <button
              ref={closeButtonRef}
              onClick={onClose}
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-nikke-text-secondary hover:text-nikke-text-primary"
              aria-label="메뉴 닫기"
            >
              <XIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        <ArchiveStatus className="mt-2" />
        {onNavigateMain && (
          <nav aria-label="주 메뉴" className="mt-5 flex flex-col gap-0.5 border-b border-nikke-border pb-4">
            {NAV_ITEMS.map(item => {
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigateMain(item.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-12 items-center rounded-lg px-3 text-left text-base ${
                    isActive
                      ? 'bg-nikke-surface-high font-semibold text-nikke-text-primary'
                      : 'text-nikke-text-secondary hover:text-nikke-text-primary'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {!listOnlyMode && (
        <>
          <h2 id="sidebar-title" className="mb-1.5 mt-4 text-xs font-medium tracking-[0.02em] text-nikke-highlight md:mb-3 md:mt-0">
            기록 분류
          </h2>
          <nav aria-label="기록 분류" className="mb-4">
            <ul className="flex flex-col gap-0.5">
              {categories.map((category, index) => {
                const isActive = activeCategoryKey === category.key && !searchTerm;
                return (
                  <li key={category.key}>
                    <a
                      href={categoryPath(category.key)}
                      onClick={event => followInApp(event, () => onCategorySelect(category.key))}
                      className={`flex min-h-11 w-full items-center gap-3.5 rounded-lg px-3 text-left text-sm ${
                        isActive
                          ? 'bg-nikke-surface-high font-semibold text-nikke-text-primary md:bg-nikke-surface'
                          : 'text-nikke-text-secondary hover:bg-nikke-surface hover:text-nikke-text-primary'
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className={`w-7 font-headline text-[13px] ${isActive ? 'text-nikke-accent' : 'text-nikke-text-muted'}`}>
                        {category.roman ?? index + 1}
                      </span>
                      <span className="flex-1">{category.name}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}

      {!hideScriptListAndSearch && (
        <>
          {listOnlyMode && (
            <div className="mt-4 md:mt-0">
              {activeCategory && (
                <a
                  href={categoryPath(activeCategory.key)}
                  onClick={event => followInApp(event, () => onCategorySelect(activeCategory.key))}
                  className="inline-flex min-h-9 items-center gap-2 text-[13px] text-nikke-text-secondary hover:text-nikke-text-primary"
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                  {activeCategory.roman && <span className="font-headline">{activeCategory.roman}</span>}
                  {activeCategory.name}
                </a>
              )}
              <h2 id="sidebar-title" className="mb-2.5 mt-5 text-xs font-medium tracking-[0.02em] text-nikke-highlight">
                타이틀과 장면
              </h2>
            </div>
          )}

          {!listOnlyMode && (
            <div className="relative my-5">
              <div className="relative">
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => onSearchTermChange(e.target.value)}
                  aria-label="목록에서 검색"
                  className="h-11 w-full rounded-lg border border-nikke-border-strong bg-nikke-surface px-10 text-sm text-nikke-text-primary outline-none placeholder:text-nikke-text-muted focus:border-nikke-accent"
                  disabled={showLoadingStateForSearchInput}
                />
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nikke-text-muted" />
                {searchTerm && (
                  <button
                    onClick={onClearSearch}
                    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-nikke-text-muted hover:text-nikke-text-primary"
                    aria-label="검색어 지우기"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              {isSearching && searchTerm && (
                <p className="mt-2 text-center text-xs text-nikke-text-muted">검색 중입니다…</p>
              )}
            </div>
          )}

          <div
            ref={scriptListContainerRef}
            className={`min-h-[100px] flex-grow overflow-y-auto md:min-h-0 ${listOnlyMode ? 'border-t border-nikke-border' : ''}`}
          >
            {showLoadingStateForSearchInput && scripts.length === 0 ? (
              <div>
                <SkeletonChapter />
                <SkeletonChapter />
              </div>
            ) : scripts.length > 0 ? (
              <ul className="flex flex-col">
                {Object.entries(groupedScripts).map(([groupKey, subScriptsArray]) => {
                  const isExpanded = !!expandedChapters[groupKey];
                  const containsSelectedScript = subScriptsArray.some(s => s.id === selectedScriptId);
                  const contentsId = `chapter-contents-${groupKey.replace(/\s+/g, '-')}`;

                  let displayGroupTitle = groupKey;
                  let categoryNameForGroup: string | undefined;
                  if (searchTerm && groupKey.includes('@@')) {
                    const [catKey, title] = groupKey.split('@@');
                    displayGroupTitle = title;
                    categoryNameForGroup = categories.find(c => c.key === catKey)?.name;
                  }

                  return (
                    <li key={groupKey} className={`border-b border-nikke-border ${isExpanded ? 'pb-2.5' : ''}`}>
                      {searchTerm && categoryNameForGroup && (
                        <div className="pt-3 text-xs text-nikke-text-muted">{categoryNameForGroup}</div>
                      )}
                      <div className="flex items-center justify-between">
                        <a
                          href={scenePath(subScriptsArray[0].categoryKey, subScriptsArray[0].id)}
                          onClick={event => followInApp(event, () => onSelectScript(subScriptsArray[0].id))}
                          className={`min-w-0 flex-1 py-3 text-left font-headline text-[15px] ${
                            containsSelectedScript
                              ? 'font-bold text-nikke-text-primary'
                              : 'text-nikke-text-secondary hover:text-nikke-text-primary'
                          }`}
                          aria-current={containsSelectedScript ? 'true' : undefined}
                        >
                          <span className="block truncate">{displayGroupTitle}</span>
                        </a>
                        <button
                          onClick={() => toggleChapterExpansion(groupKey)}
                          className={`flex h-11 w-11 shrink-0 items-center justify-end ${isExpanded ? 'text-nikke-accent' : 'text-nikke-text-muted hover:text-nikke-text-primary'}`}
                          aria-label={isExpanded ? '접기' : '펼치기'}
                          aria-expanded={isExpanded}
                          aria-controls={contentsId}
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDownIcon className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRightIcon className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {isExpanded && (
                        <ol id={contentsId} className="ml-px border-l border-nikke-border pl-0.5">
                          {subScriptsArray.map((script, sceneIndex) => {
                            const isSelected = selectedScriptId === script.id;
                            return (
                              <li key={script.id}>
                                <a
                                  href={scenePath(script.categoryKey, script.id)}
                                  ref={(element) => {
                                    scriptItemRefs.current[script.id] = element;
                                  }}
                                  onClick={event => followInApp(event, () => onSelectScript(script.id))}
                                  className={`-ml-[3px] flex min-h-10 w-full items-center gap-3 border-l-2 py-2 pl-3.5 text-left text-sm ${
                                    isSelected
                                      ? 'border-nikke-accent font-semibold text-nikke-text-primary'
                                      : 'border-transparent text-nikke-text-secondary hover:text-nikke-text-primary'
                                  }`}
                                  aria-current={isSelected ? 'page' : undefined}
                                >
                                  <span className={`font-mono text-[11px] ${isSelected ? 'text-nikke-accent' : 'text-nikke-text-muted'}`}>
                                    {String(sceneIndex + 1).padStart(2, '0')}
                                  </span>
                                  <span className="min-w-0 flex-1">{script.subTitle || script.title}</span>
                                </a>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : searchTerm && !isSearching ? (
              <p className="py-4 text-sm text-nikke-text-muted">"{searchTerm}"에 해당하는 기록이 없습니다.</p>
            ) : !searchTerm && activeCategoryKey ? (
              <p className="py-4 text-sm text-nikke-text-muted">{`${activeCategory?.name || '이 분류'}에 보관된 기록이 없습니다.`}</p>
            ) : (
              <p className="py-4 text-sm text-nikke-text-muted">분류를 선택하거나 검색으로 이동하십시오.</p>
            )}
          </div>

          {!listOnlyMode && onNavigateToSearch && (
            <button
              onClick={onNavigateToSearch}
              className="mt-4 min-h-11 w-full rounded-lg bg-nikke-accent px-4 text-center text-sm font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong"
            >
              전체 검색으로
            </button>
          )}
        </>
      )}

      {onThemePreferenceChange && themePreference && (
        <div className="mt-auto shrink-0 pt-4 md:hidden">
          <div role="group" aria-label="화면 테마" className="grid grid-cols-3 gap-1 rounded-[10px] border border-nikke-border p-1">
            {([
              { value: 'system', label: '시스템' },
              { value: 'dark', label: '다크' },
              { value: 'light', label: '라이트' },
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={themePreference === option.value}
                onClick={() => onThemePreferenceChange(option.value)}
                className={`min-h-11 rounded-lg text-sm ${
                  themePreference === option.value
                    ? 'bg-nikke-surface-high font-semibold text-nikke-text-primary'
                    : 'text-nikke-text-secondary hover:text-nikke-text-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};
