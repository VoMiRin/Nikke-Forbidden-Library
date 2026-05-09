import React, { useMemo } from 'react';
import type { Script, ScriptCategory } from '../types';
import { SearchIcon, UserCircleIcon, XIcon } from './Icons';

interface SearchPageProps {
  categories: ScriptCategory[];
  globallySearchedScripts: Script[];
  selectedScriptId: string | null;
  onSelectScript: (id: string) => void;
  isLoadingInitialMetadata: boolean;
  isIndexingScripts: boolean;
  isSearching: boolean;
  searchTerm: string;
  speakerSearchTerm: string;
  onSearchTermChange: (term: string) => void;
  onSpeakerSearchTermChange: (term: string) => void;
  onClearSearch: () => void;
  onCategorySelect?: (categoryKey: string) => void;
}

export const SearchPage: React.FC<SearchPageProps> = ({
  categories,
  globallySearchedScripts,
  selectedScriptId,
  onSelectScript,
  isLoadingInitialMetadata,
  isIndexingScripts,
  isSearching,
  searchTerm,
  speakerSearchTerm,
  onSearchTermChange,
  onSpeakerSearchTermChange,
  onClearSearch,
}) => {
  const groupedScripts = useMemo(() => {
    return globallySearchedScripts.reduce<Record<string, Script[]>>((acc, script) => {
      const groupKey = `${script.categoryKey}@@${script.title}`;
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(script);
      return acc;
    }, {});
  }, [globallySearchedScripts]);

  const showInitialLoading = isLoadingInitialMetadata || isIndexingScripts;
  const hasSearchTerm = !!(searchTerm.trim() || speakerSearchTerm.trim());
  const resultQueryLabel = [
    searchTerm.trim() ? `"${searchTerm.trim()}"` : null,
    speakerSearchTerm.trim() ? `화자 "${speakerSearchTerm.trim()}"` : null,
  ].filter(Boolean).join(' + ');
  const contentPlaceholder = showInitialLoading ? '전체 아카이브 로딩 중...' : '제목, 소제목, 또는 대사';
  const speakerPlaceholder = showInitialLoading ? '전체 아카이브 로딩 중...' : '화자 이름';

  return (
    <div className="mx-auto flex h-full w-full max-w-[1024px] flex-col pb-8 md:pb-10">
      <header className="mb-6 xl:mb-10">
        <div>
          <p className="font-label text-[11px] uppercase tracking-[0.24em] text-nikke-accent">전체 검색</p>
          <h2 className="mt-2 font-headline text-3xl font-extrabold tracking-[-0.04em] text-nikke-text-primary sm:text-4xl lg:text-5xl xl:mt-3 xl:text-6xl">
            Nikke Forbidden Library
          </h2>
        </div>
        <div className="sticky top-[68px] z-20 -mx-3 mt-4 border-y border-nikke-border/10 bg-nikke-bg/96 px-3 py-3 shadow-[0_14px_32px_rgba(0,0,0,0.16)] backdrop-blur-md md:static md:mx-0 md:mt-5 md:border-y-0 md:bg-transparent md:px-0 md:py-0 md:shadow-none md:backdrop-blur-none xl:mt-8">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(14rem,0.65fr)]">
            <div className="relative">
              <input
                type="search"
                placeholder={contentPlaceholder}
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                aria-label="Search script content"
                className="w-full rounded-[1rem] bg-nikke-surface-low/85 py-3.5 pl-12 pr-11 text-base text-nikke-text-primary outline-none transition-all duration-300 ease-editorial placeholder:text-sm placeholder:text-nikke-text-muted focus:bg-nikke-surface-low focus:ring-2 focus:ring-nikke-accent/20 xl:rounded-[1.15rem] xl:py-5 xl:pl-14 xl:pr-12 xl:text-lg xl:placeholder:text-base"
                disabled={showInitialLoading}
                autoFocus
              />
              <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-nikke-text-muted xl:left-5" />
              {searchTerm && (
                <button
                  onClick={() => onSearchTermChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-nikke-text-muted transition-colors duration-300 ease-editorial hover:text-nikke-text-primary xl:right-4"
                  aria-label="Clear content search"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="search"
                placeholder={speakerPlaceholder}
                value={speakerSearchTerm}
                onChange={(e) => onSpeakerSearchTermChange(e.target.value)}
                aria-label="Search script speakers"
                className="w-full rounded-[1rem] bg-nikke-surface-low/85 py-3.5 pl-12 pr-11 text-base text-nikke-text-primary outline-none transition-all duration-300 ease-editorial placeholder:text-sm placeholder:text-nikke-text-muted focus:bg-nikke-surface-low focus:ring-2 focus:ring-nikke-accent/20 xl:rounded-[1.15rem] xl:py-5 xl:pl-14 xl:pr-12 xl:text-lg xl:placeholder:text-base"
                disabled={showInitialLoading}
              />
              <UserCircleIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-nikke-text-muted xl:left-5" />
              {speakerSearchTerm && (
                <button
                  onClick={() => onSpeakerSearchTermChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-nikke-text-muted transition-colors duration-300 ease-editorial hover:text-nikke-text-primary xl:right-4"
                  aria-label="Clear speaker search"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
          {hasSearchTerm && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onClearSearch}
                className="rounded-full px-3 py-1.5 font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted transition-colors duration-300 ease-editorial hover:bg-nikke-surface-low/70 hover:text-nikke-text-primary"
              >
                전체 지우기
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-grow overflow-y-visible pb-6 md:overflow-y-auto">
        {showInitialLoading && !hasSearchTerm ? (
          <div className="py-10 text-center">
            <div role="status" className="flex flex-col items-center">
              <svg aria-hidden="true" className="mb-3 h-10 w-10 animate-spin text-nikke-accent" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0492C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5424 39.6781 93.9676 39.0409Z" fill="currentFill" />
              </svg>
              <span className="text-xl text-nikke-text-primary">전체 스크립트 메타데이터를 불러오는 중입니다...</span>
              <span className="mt-1 text-sm text-nikke-text-muted">검색 인덱스는 서버 또는 정적 인덱스에서 요청 시 로드됩니다.</span>
            </div>
          </div>
        ) : hasSearchTerm && globallySearchedScripts.length > 0 ? (
          <div className="space-y-10 md:space-y-14">
            {Object.entries(groupedScripts).map(([groupKey, subScriptsArray]) => {
              const [catKey, title] = groupKey.split('@@');
              const categoryNameForGroup = categories.find(c => c.key === catKey)?.name ?? catKey;

              return (
                <section key={groupKey}>
                  <div className="mb-4 flex items-center gap-3 md:mb-5 md:gap-4">
                    <h3 className="font-label text-[11px] uppercase tracking-[0.24em] text-nikke-text-muted">
                      {categoryNameForGroup}
                    </h3>
                    <div className="h-px flex-1 bg-nikke-border/15" />
                  </div>
                  <div className="space-y-3 md:space-y-4">
                    {subScriptsArray.map(script => (
                      <button
                        key={script.id}
                        onClick={() => onSelectScript(script.id)}
                        className={`w-full rounded-[1.1rem] p-4 text-left transition-all duration-300 ease-editorial md:rounded-[1.4rem] md:p-6 ${selectedScriptId === script.id
                            ? 'bg-nikke-surface-high text-nikke-text-primary shadow-glass'
                            : 'bg-nikke-surface-low/70 text-nikke-text-secondary hover:bg-nikke-surface-low hover:translate-x-1 hover:text-nikke-text-primary'
                          }`}
                        aria-current={selectedScriptId === script.id ? 'page' : undefined}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="max-w-3xl">
                            <p className="font-label text-[11px] uppercase tracking-[0.18em] text-nikke-accent">
                              {categoryNameForGroup} / {script.title}
                            </p>
                            <h4 className="mt-2 font-headline text-xl font-bold tracking-[-0.02em] text-nikke-text-primary md:text-2xl">
                              {script.subTitle || 'Open Content'}
                            </h4>
                            <p className="mt-2 font-body text-sm leading-6 text-nikke-text-secondary md:mt-3 md:text-lg md:leading-8">
                              {script.title}
                            </p>
                            {script.searchSnippet && (
                              <p className="mt-2 line-clamp-4 font-body text-sm leading-6 text-nikke-text-muted md:mt-3 md:line-clamp-3 md:leading-7">
                                {script.searchSnippet}
                              </p>
                            )}
                          </div>
                          <span className="font-label text-[10px] uppercase tracking-[0.16em] text-nikke-text-muted md:text-[11px] md:tracking-[0.18em]">
                            아카이브 문서
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : hasSearchTerm && isSearching ? (
          <p className="p-6 text-center text-lg text-nikke-text-muted">검색 중입니다...</p>
        ) : hasSearchTerm && !isSearching ? (
          <p className="p-6 text-center text-lg text-nikke-text-muted">{resultQueryLabel}에 대한 검색 결과가 없습니다.</p>
        ) : !hasSearchTerm && !showInitialLoading ? (
          <div className="py-6 text-center xl:py-10">
            <p className="font-headline text-2xl font-bold tracking-[-0.02em] text-nikke-text-primary">전체 아카이브를 탐색하려면 검색어를 입력하세요.</p>
            <p className="mt-3 text-base leading-7 text-nikke-text-secondary">
              제목, 소제목, 대사, 화자 등을 통해 원하는 스토리를 빠르게 찾아보세요.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
