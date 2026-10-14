import React, { useMemo } from 'react';
import type { Script, ScriptCategory } from '../types';
import { ChevronRightIcon, SearchIcon, XIcon } from './Icons';
import { SpeakerInput } from './SpeakerInput';
import { displaySearchText, findMatchRange } from '../lib/search.mjs';

const highlightSnippet = (snippet: string, term: string): React.ReactNode => {
  const text = displaySearchText(snippet);
  const parts: React.ReactNode[] = [];
  let offset = 0;
  while (offset < text.length) {
    const match = findMatchRange(text.slice(offset), term);
    if (!match) { parts.push(text.slice(offset)); break; }
    parts.push(text.slice(offset, offset + match.start));
    parts.push(<mark key={offset + match.start}>{text.slice(offset + match.start, offset + match.end)}</mark>);
    offset += match.end;
  }
  return parts;
};

const PersonIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
  </svg>
);

interface SearchPageProps {
  categories: ScriptCategory[];
  globallySearchedScripts: Script[];
  selectedScriptId: string | null;
  onSelectScript: (id: string) => void;
  isLoadingInitialMetadata: boolean;
  isIndexingScripts: boolean;
  isSearching: boolean;
  totalSearchResults: number;
  hasMoreSearchResults: boolean;
  searchTerm: string;
  speakerSearchTerm: string;
  searchCategoryKey: string | null;
  onSearchCategoryChange: (key: string | null) => void;
  searchError: string | null;
  onBrowseSpeakers: () => void;
  onSearchTermChange: (term: string) => void;
  onSpeakerSearchTermChange: (term: string) => void;
  onClearSearch: () => void;
  onLoadMoreSearchResults: () => void;
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
  totalSearchResults,
  hasMoreSearchResults,
  searchTerm,
  speakerSearchTerm,
  searchCategoryKey,
  onSearchCategoryChange,
  searchError,
  onBrowseSpeakers,
  onSearchTermChange,
  onSpeakerSearchTermChange,
  onClearSearch,
  onLoadMoreSearchResults,
}) => {
  const groupedScripts = useMemo(() => {
    return globallySearchedScripts.reduce<Record<string, Script[]>>((acc, script) => {
      const groupKey = script.categoryKey;
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
  ].filter(Boolean).join(' · ');
  const contentPlaceholder = showInitialLoading ? '기록을 불러오는 중입니다' : '제목, 소제목, 또는 대사';
  const speakerPlaceholder = showInitialLoading ? '기록을 불러오는 중입니다' : '화자 이름';
  const inputClass = 'h-14 w-full rounded-[10px] border bg-nikke-surface px-12 text-[17px] text-nikke-text-primary outline-none placeholder:text-base placeholder:text-nikke-text-muted focus:border-nikke-accent disabled:cursor-wait disabled:opacity-70';

  return (
    <div className="max-w-[900px]">
      <h1 className="font-headline text-[clamp(36px,4.4vw,52px)] font-bold leading-[1.1] tracking-[-0.01em] text-nikke-text-primary">
        기록 검색
      </h1>
      <p className="mt-3 text-[15px] text-nikke-text-secondary">제목, 소제목, 대사로 찾고 화자로 범위를 좁히십시오.</p>

      <form
        role="search"
        aria-label="스크립트 검색"
        onSubmit={(event) => event.preventDefault()}
        className="sticky top-16 z-20 -mx-[clamp(16px,3vw,32px)] mt-8 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 bg-nikke-bg/95 px-[clamp(16px,3vw,32px)] py-3 backdrop-blur-md max-sm:grid-cols-1 md:static md:mx-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="search-content" className="text-xs text-nikke-text-muted">내용</label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-nikke-text-muted" strokeWidth={1.8} />
            <input
              id="search-content"
              type="search"
              placeholder={contentPlaceholder}
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className={`${inputClass} ${searchTerm ? 'border-nikke-accent' : 'border-nikke-border-strong'}`}
              disabled={showInitialLoading}
              autoFocus
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => onSearchTermChange('')}
                className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-nikke-text-muted hover:text-nikke-text-primary"
                aria-label="내용 검색어 지우기"
              >
                <XIcon className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="search-speaker" className="text-xs text-nikke-text-muted">화자</label>
          <div className="relative">
            <PersonIcon aria-hidden="true" className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-nikke-text-muted" />
            <SpeakerInput
              id="search-speaker"
              placeholder={speakerPlaceholder}
              value={speakerSearchTerm}
              onChange={onSpeakerSearchTermChange}
              className={`${inputClass} border-nikke-border-strong`}
              disabled={showInitialLoading}
            />
            {speakerSearchTerm && (
              <button
                type="button"
                onClick={() => onSpeakerSearchTermChange('')}
                className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-nikke-text-muted hover:text-nikke-text-primary"
                aria-label="화자 검색어 지우기"
              >
                <XIcon className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      </form>

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs text-nikke-text-muted">검색 범위</legend>
        <div className="flex flex-wrap gap-2">
          {[{ key: '', name: '전체', roman: '' }, ...categories].map(category => (
            <button key={category.key} type="button" aria-pressed={(searchCategoryKey ?? '') === category.key}
              onClick={() => onSearchCategoryChange(category.key || null)}
              className={`min-h-11 rounded-lg border px-3 text-sm ${(searchCategoryKey ?? '') === category.key ? 'border-nikke-accent bg-nikke-accent/10 text-nikke-highlight' : 'border-nikke-border-strong text-nikke-text-secondary hover:border-nikke-accent'}`}>
              {category.roman && <span className="mr-1.5 font-headline">{category.roman}</span>}{category.name}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="button" onClick={onBrowseSpeakers} className="mt-3 min-h-11 text-sm text-nikke-highlight hover:underline">화자별 기록 보기 →</button>

      {hasSearchTerm && (
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 max-sm:mt-6">
          <p className="text-sm text-nikke-text-secondary">{resultQueryLabel}</p>
          <button
            type="button"
            onClick={onClearSearch}
            className="min-h-9 rounded-lg border border-nikke-border-strong px-3 text-[13px] text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary"
          >
            전체 지우기
          </button>
        </div>
      )}

      <div>
        {searchError ? <p role="alert" className="py-10 text-nikke-text-secondary">{searchError}</p> : showInitialLoading && !hasSearchTerm ? (
          <div role="status" className="flex flex-col items-center gap-[18px] py-16 text-center">
            <div aria-hidden="true" className="relative h-0.5 w-44 overflow-hidden rounded-sm bg-nikke-border">
              <span className="absolute inset-y-0 left-0 w-16 animate-pulse bg-nikke-accent" />
            </div>
            <p className="text-[15px] text-nikke-text-secondary">기록 목록을 불러오는 중입니다</p>
            <p className="text-[13px] text-nikke-text-muted">검색 인덱스는 서버 또는 정적 인덱스에서 요청 시 불러옵니다.</p>
          </div>
        ) : hasSearchTerm && globallySearchedScripts.length > 0 ? (
          <>
            {Object.entries(groupedScripts).map(([catKey, subScriptsArray], groupIndex) => {
              const category = categories.find(c => c.key === catKey);
              const headingId = `search-group-${catKey}`;

              return (
                <section key={catKey} aria-labelledby={headingId} className={groupIndex === 0 ? 'mt-7' : 'mt-9'}>
                  <h2 id={headingId} className="mb-1 flex items-baseline gap-2.5 text-[13px] font-medium text-nikke-text-muted">
                    {category?.roman && <span className="font-headline text-nikke-accent">{category.roman}</span>}
                    {category?.name ?? catKey}
                  </h2>
                  <ul className="border-t border-nikke-border">
                    {subScriptsArray.map(script => (
                      <li key={script.id} className="border-b border-nikke-border">
                        <button
                          onClick={() => onSelectScript(script.id)}
                          className={`group grid w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-5 px-3 py-5 text-left text-nikke-text-primary transition-colors duration-150 hover:bg-nikke-surface max-sm:px-1 ${
                            selectedScriptId === script.id ? 'bg-nikke-surface' : ''
                          }`}
                          aria-current={selectedScriptId === script.id ? 'page' : undefined}
                        >
                          <span className="flex min-w-0 flex-col gap-1.5">
                            {script.subTitle && (
                              <span className="text-xs text-nikke-text-muted">{script.title}</span>
                            )}
                            <span className="font-headline text-xl font-bold">{script.subTitle || script.title}</span>
                            {(script.searchMatchType === 'title' || script.searchMatchType === 'subtitle') && <span className="text-xs text-nikke-highlight">{script.searchMatchType === 'title' ? '타이틀 일치' : '장면 제목 일치'} · 본문 미리보기</span>}
                            {script.matchedSpeaker && <span className="text-xs text-nikke-highlight">화자: {script.matchedSpeaker}</span>}
                            {script.searchSnippet && (
                              <span className="line-clamp-3 font-body text-[15px] leading-[1.8] text-nikke-text-secondary">
                                {highlightSnippet(script.searchSnippet, searchTerm)}
                              </span>
                            )}
                          </span>
                          <ChevronRightIcon aria-hidden="true" className="h-[18px] w-[18px] text-nikke-text-muted transition-transform duration-150 group-hover:translate-x-[3px] group-hover:text-nikke-accent" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              <p className="text-[13px] text-nikke-text-muted">
                {totalSearchResults.toLocaleString('ko-KR')}개 중 {globallySearchedScripts.length.toLocaleString('ko-KR')}개 표시
              </p>
              {hasMoreSearchResults && (
                <button
                  type="button"
                  onClick={onLoadMoreSearchResults}
                  disabled={isSearching}
                  className="min-h-11 rounded-lg border border-nikke-border-strong px-5 text-sm text-nikke-text-primary hover:border-nikke-accent disabled:cursor-wait disabled:opacity-60"
                >
                  {isSearching ? '불러오는 중…' : '더 보기'}
                </button>
              )}
            </div>
          </>
        ) : hasSearchTerm && isSearching ? (
          <p role="status" className="py-12 text-center text-[15px] text-nikke-text-secondary">검색 중입니다…</p>
        ) : hasSearchTerm && !isSearching ? (
          <p className="py-12 text-center text-[15px] text-nikke-text-secondary">{resultQueryLabel}에 대한 검색 결과가 없습니다.</p>
        ) : !hasSearchTerm && !showInitialLoading ? (
          <div className="py-14 text-center">
            <h2 className="font-headline text-[19px] font-bold text-nikke-text-primary">전체 아카이브를 탐색하려면 검색어를 입력하세요.</h2>
            <p className="mt-2 text-sm leading-[1.6] text-nikke-text-secondary">
              제목, 소제목, 대사, 화자 등을 통해 원하는 스토리를 빠르게 찾아보세요.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
