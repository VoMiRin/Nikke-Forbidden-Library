import { categoryPath, scenePath, sectionPath } from '../lib/pageRoutes.mjs';
import { listSections } from '../lib/sections';
import { followInApp } from '../lib/linkNavigation';
import React, { useEffect, useMemo, useState } from 'react';
import type { Script, ScriptCategory } from '../types';
import { SectionTabs } from './SectionTabs';
import { ArrowRightIcon, ChevronRightIcon, SearchIcon, XIcon, type IconProps } from './Icons';

interface StoriesPageProps {
  categories: ScriptCategory[];
  scripts: Script[];
  activeCategoryKey: string | null;
  selectedScriptId: string | null;
  onCategorySelect: (categoryKey: string) => void;
  onSelectScript: (scriptId: string) => void;
  onNavigateToHome?: () => void;
  onNavigateToSearch?: () => void;
  onNavigateToAiChat?: () => void;
  /** 홈 히어로 검색창에서 바로 검색 */
  onSearch?: (term: string) => void;
  chapterTitleFilter?: string | null;
  /** URL로 고른 소분류. 없으면 열람 중인 장면의 소분류나 첫 소분류를 보여준다. */
  activeSection?: string | null;
  onSectionSelect?: (section: string) => void;
}

interface ChapterGroup {
  title: string;
  scripts: Script[];
}

const formatCount = (value: number) => value.toLocaleString('ko-KR');

/** 'Chapter.01: 침식' → { number: '01', name: '침식' } */
const parseChapterTitle = (title: string, index: number) => {
  const match = title.match(/^Chapter\.?\s*(\d+)\s*:\s*(.+)$/i);
  if (match) {
    return { number: match[1].padStart(2, '0'), name: match[2] };
  }
  return { number: String(index + 1).padStart(2, '0'), name: title };
};

const normalizeFilterValue = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

const unitLabelFor = (categoryKey: string) => (
  categoryKey === 'main_story' ? '챕터' : categoryKey === 'blabla' ? '대화방' : '타이틀'
);

export const StoriesPage: React.FC<StoriesPageProps> = ({
  categories,
  scripts,
  activeCategoryKey,
  selectedScriptId,
  onCategorySelect,
  onSelectScript,
  onNavigateToHome,
  onNavigateToSearch,
  onNavigateToAiChat,
  onSearch,
  chapterTitleFilter,
  activeSection,
  onSectionSelect,
}) => {
  const [heroSearchTerm, setHeroSearchTerm] = useState('');
  const [chapterFilter, setChapterFilter] = useState(chapterTitleFilter ?? '');

  useEffect(() => {
    setChapterFilter(chapterTitleFilter ?? '');
  }, [activeCategoryKey, chapterTitleFilter]);
  const effectiveCategoryKey = activeCategoryKey ?? null;
  const activeCategory = categories.find(category => category.key === effectiveCategoryKey) ?? null;

  const categoryScripts = useMemo(
    () => (effectiveCategoryKey ? scripts.filter(script => script.categoryKey === effectiveCategoryKey) : []),
    [scripts, effectiveCategoryKey]
  );
  const sections = useMemo(() => listSections(categoryScripts), [categoryScripts]);
  const hasSections = sections.length > 1;
  const currentSection = hasSections
    ? (sections.find(section => section.name === activeSection)?.name
      ?? categoryScripts.find(script => script.id === selectedScriptId)?.section
      ?? sections[0].name)
    : null;

  const chapterGroups = useMemo<ChapterGroup[]>(() => {
    const grouped = categoryScripts
      .filter(script => !currentSection || script.section === currentSection)
      .reduce<Record<string, Script[]>>((acc, script) => {
        if (!acc[script.title]) {
          acc[script.title] = [];
        }
        acc[script.title].push(script);
        return acc;
      }, {});

    return Object.entries(grouped).map(([title, chapterScripts]) => ({
      title,
      scripts: chapterScripts,
    }));
  }, [categoryScripts, currentSection]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { titles: Set<string>; scenes: number }> = {};
    scripts.forEach(script => {
      if (!stats[script.categoryKey]) {
        stats[script.categoryKey] = { titles: new Set(), scenes: 0 };
      }
      stats[script.categoryKey].titles.add(script.title);
      stats[script.categoryKey].scenes += 1;
    });
    return stats;
  }, [scripts]);

  const sectionsByCategory = useMemo(() => {
    const byCategory: Record<string, Script[]> = {};
    scripts.forEach(script => {
      if (script.section) (byCategory[script.categoryKey] ??= []).push(script);
    });
    return Object.fromEntries(Object.entries(byCategory).map(([key, list]) => [key, listSections(list)]));
  }, [scripts]);

  const totalTitles = useMemo(
    () => Object.values(categoryStats).reduce((sum, stat) => sum + stat.titles.size, 0),
    [categoryStats]
  );
  const hasScripts = scripts.length > 0;

  if (!effectiveCategoryKey) {
    return (
      <div>
        <section aria-labelledby="hero-title" className="flex flex-wrap items-center gap-x-[72px] gap-y-12 pb-[72px] pt-6 md:pt-10">
          <div className="min-w-0 flex-[999_1_520px]">
            <p className="text-[13px] font-medium tracking-[0.04em] text-nikke-highlight">방주 도서관 · 특급 기밀 보관소</p>
            <h1 id="hero-title" className="mt-[18px] font-headline text-[clamp(64px,9vw,120px)] font-extrabold leading-none tracking-[-0.03em] text-nikke-text-primary">
              금서고
            </h1>
            <p className="mt-7 max-w-[540px] text-[17px] leading-[1.8] text-nikke-text-secondary">
              니케 금서고는 승리의 여신: 니케의 스토리 기록을 모은 사이트입니다. 열람할 분류를 선택하거나, 대사와 화자로 기록을 검색하십시오.
            </p>
            {onSearch ? (
              <form
                role="search"
                aria-label="기록 검색"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSearch(heroSearchTerm.trim());
                }}
                className="mt-9 flex max-w-[560px] flex-wrap gap-3"
              >
                <label htmlFor="hero-search" className="sr-only">대사, 제목, 화자 검색</label>
                <div className="relative min-w-[240px] flex-1">
                  <SearchIcon aria-hidden="true" className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-nikke-text-muted" strokeWidth={1.8} />
                  <input
                    id="hero-search"
                    type="search"
                    value={heroSearchTerm}
                    onChange={(event) => setHeroSearchTerm(event.target.value)}
                    placeholder="대사나 제목으로 기록 검색"
                    className="h-12 w-full rounded-lg border border-nikke-border-strong bg-nikke-surface pl-11 pr-4 text-[15px] text-nikke-text-primary outline-none placeholder:text-nikke-text-muted focus:border-nikke-accent"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center rounded-lg bg-nikke-accent px-[22px] text-[15px] font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong"
                >
                  검색
                </button>
              </form>
            ) : onNavigateToSearch && (
              <div className="mt-9">
                <button
                  type="button"
                  onClick={onNavigateToSearch}
                  className="inline-flex min-h-12 items-center gap-2.5 rounded-lg bg-nikke-accent px-[22px] text-[15px] font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong"
                >
                  <SearchIcon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  기록 검색
                </button>
              </div>
            )}
            {onNavigateToAiChat && (
              <button
                type="button"
                onClick={onNavigateToAiChat}
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-nikke-text-secondary hover:text-nikke-text-primary"
              >
                또는 AI에게 질의하기
                <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>
          <aside aria-label="관리 정보" className="max-w-[440px] flex-[1_1_340px] rounded-[10px] border border-nikke-border bg-nikke-surface p-7">
            <p className="flex justify-between text-xs text-nikke-text-muted">
              <span>관리 정보</span>
              <span className="font-mono tracking-[0.08em]">ARK LIBRARY</span>
            </p>
            <dl className="mt-5 grid grid-cols-[64px_minmax(0,1fr)] gap-x-5 gap-y-3.5 text-[15px]">
              <dt className="text-nikke-text-muted">관리자</dt>
              <dd className="text-nikke-text-primary">아르카나 <span className="text-nikke-text-muted">· 제17대</span></dd>
              <dt className="text-nikke-text-muted">소속</dt>
              <dd className="text-nikke-text-primary">베스트셀러 스쿼드</dd>
              <dt className="text-nikke-text-muted">권한</dt>
              <dd className="text-nikke-highlight">열람 승인</dd>
            </dl>
            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-nikke-border pt-6">
              {[
                { label: '분류', value: formatCount(categories.length) },
                { label: '타이틀', value: hasScripts ? formatCount(totalTitles) : '—' },
                { label: '장면', value: hasScripts ? formatCount(scripts.length) : '—', highlight: true },
              ].map(stat => (
                <div key={stat.label}>
                  <p className={`font-mono text-[26px] font-medium ${stat.highlight ? 'text-nikke-highlight' : 'text-nikke-text-primary'}`}>{stat.value}</p>
                  <p className="mt-1 text-xs text-nikke-text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section aria-labelledby="index-title">
          <div className="mb-8 flex items-baseline justify-between gap-4 border-b border-nikke-border pb-5">
            <h2 id="index-title" className="font-headline text-2xl font-bold text-nikke-text-primary">기록 분류</h2>
            <span className="text-[13px] text-nikke-text-muted">{categories.length}개 분류</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 max-sm:grid-cols-2 max-sm:gap-3">
            {categories.map((category, index) => {
              const stat = categoryStats[category.key];
              const cardSections = sectionsByCategory[category.key] ?? [];

              return (
                <a
                  key={category.key}
                  href={categoryPath(category.key)}
                  onClick={event => followInApp(event, () => onCategorySelect(category.key))}
                  className="group block rounded-[10px] border border-nikke-border bg-nikke-surface p-2 text-nikke-text-primary transition-colors duration-200 hover:border-nikke-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent"
                >
                  <span className="flex h-[272px] flex-col items-center justify-between rounded-md border border-nikke-border px-4 py-[22px] text-center transition-colors duration-200 group-hover:border-nikke-accent/45 max-sm:h-[220px] max-sm:px-2">
                    <span className="font-headline text-xl tracking-[0.1em] text-nikke-text-muted transition-colors duration-200 group-hover:text-nikke-accent">
                      {category.roman ?? index + 1}
                    </span>
                    <span className="flex h-16 w-16 items-center justify-center rounded-full border border-nikke-border-strong text-nikke-accent">
                      {category.icon && React.isValidElement(category.icon)
                        ? React.cloneElement(category.icon as React.ReactElement<IconProps>, { className: 'h-[26px] w-[26px]', strokeWidth: 1.4 })
                        : null}
                    </span>
                    <span className="flex flex-col gap-2">
                      <span className="font-headline text-xl font-bold max-sm:text-lg">{category.name}</span>
                      <span className="text-xs text-nikke-text-muted">
                        {cardSections.length > 1
                          ? cardSections.map(section => `${section.name} ${formatCount(section.titleCount)}`).join(' · ')
                          : stat
                          ? `${formatCount(stat.titles.size)} ${unitLabelFor(category.key)} · ${formatCount(stat.scenes)} 장면`
                          : ' '}
                      </span>
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  const totalScenes = chapterGroups.reduce((sum, chapter) => sum + chapter.scripts.length, 0);
  const normalizedChapterFilter = normalizeFilterValue(chapterFilter);
  const visibleChapters = chapterGroups
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }) => (
      !normalizedChapterFilter
      || (chapterTitleFilter && chapterFilter === chapterTitleFilter
        ? chapter.title === chapterTitleFilter
        : normalizeFilterValue(chapter.title).includes(normalizedChapterFilter)
          || chapter.scripts.some(script => normalizeFilterValue(script.subTitle ?? '').includes(normalizedChapterFilter)))
    ));
  const showChapterFilter = chapterGroups.length > 8 || !!chapterTitleFilter;

  return (
    <div className="max-w-[900px]">
      <nav aria-label="현재 위치" className="flex items-center gap-2 text-[13px] text-nikke-text-muted">
        {onNavigateToHome ? (
          <a href="/" onClick={event => followInApp(event, () => onNavigateToHome?.())} className="hover:text-nikke-text-primary">스토리</a>
        ) : (
          <span>스토리</span>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current={currentSection ? undefined : 'page'} className="text-nikke-text-secondary">{activeCategory?.name ?? '스토리'}</span>
        {currentSection && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-nikke-text-secondary">{currentSection}</span>
          </>
        )}
      </nav>
      <header className="mt-5 flex flex-wrap items-end justify-between gap-4 pb-8">
        <div className="flex items-baseline gap-5">
          {activeCategory?.roman && (
            <span className="font-headline text-[28px] text-nikke-accent">{activeCategory.roman}</span>
          )}
          <h1 className="font-headline text-[clamp(40px,5vw,56px)] font-extrabold leading-none tracking-[-0.03em] text-nikke-text-primary">
            {activeCategory?.name ?? '스토리'}
          </h1>
        </div>
        {chapterGroups.length > 0 && (
          <p className="text-sm text-nikke-text-muted">
            {currentSection && `${currentSection} · `}{formatCount(chapterGroups.length)} {unitLabelFor(effectiveCategoryKey)} · {formatCount(totalScenes)} 장면
          </p>
        )}
      </header>

      {currentSection && effectiveCategoryKey && (
        <div className="mb-6">
          <SectionTabs
            sections={sections}
            activeSection={currentSection}
            hrefFor={section => sectionPath(effectiveCategoryKey, section)}
            onSelect={section => onSectionSelect?.(section)}
            label={`${activeCategory?.name ?? ''} 소분류`}
          />
        </div>
      )}

      {showChapterFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <label htmlFor="chapter-filter" className="sr-only">목록에서 찾기</label>
            <SearchIcon aria-hidden="true" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-nikke-text-muted" strokeWidth={1.8} />
            <input
              id="chapter-filter"
              type="search"
              value={chapterFilter}
              onChange={(event) => setChapterFilter(event.target.value)}
              placeholder={`${unitLabelFor(effectiveCategoryKey)}·장면 이름으로 찾기`}
              className="h-11 w-full rounded-lg border border-nikke-border-strong bg-nikke-surface pl-10 pr-10 text-sm text-nikke-text-primary outline-none placeholder:text-nikke-text-muted focus:border-nikke-accent"
            />
            {chapterFilter && (
              <button
                type="button"
                onClick={() => setChapterFilter('')}
                aria-label="찾기 지우기"
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-nikke-text-muted hover:text-nikke-text-primary"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          {normalizedChapterFilter && (
            <p role="status" className="text-[13px] text-nikke-text-muted">
              {visibleChapters.length}개 일치
            </p>
          )}
        </div>
      )}

      {visibleChapters.length === 0 && normalizedChapterFilter ? (
        <p className="border-t border-nikke-border py-12 text-center text-[15px] text-nikke-text-secondary">
          "{chapterFilter.trim()}"와 일치하는 항목이 없습니다.
        </p>
      ) : (
      <ol className="border-t border-nikke-border">
        {visibleChapters.map(({ chapter, index }) => {
          const firstScript = chapter.scripts[0];
          const isSelected = selectedScriptId ? chapter.scripts.some(script => script.id === selectedScriptId) : false;
          const { number, name } = parseChapterTitle(chapter.title, index);

          return (
            <li key={chapter.title} className="border-b border-nikke-border">
              <a
                href={scenePath(firstScript.categoryKey, firstScript.id)}
                onClick={event => followInApp(event, () => onSelectScript(firstScript.id))}
                aria-current={isSelected ? 'true' : undefined}
                className="group grid w-full grid-cols-[56px_minmax(0,1fr)_auto_20px] items-center gap-x-5 px-3 py-5 text-left text-nikke-text-primary transition-colors duration-150 hover:bg-nikke-surface max-sm:grid-cols-[36px_minmax(0,1fr)_20px] max-sm:gap-x-3 max-sm:px-1"
              >
                <span className={`font-mono text-[15px] ${isSelected ? 'text-nikke-accent' : 'text-nikke-text-muted'}`}>{number}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-headline text-xl font-bold">{name}</span>
                  {firstScript.subTitle && !/^\d+$/.test(firstScript.subTitle) && (
                    <span className="text-sm text-nikke-text-muted">{firstScript.subTitle}</span>
                  )}
                  <span className={`w-full text-[13px] sm:hidden ${isSelected ? 'text-nikke-highlight' : 'text-nikke-text-muted'}`}>
                    {isSelected ? '열람 중 · ' : ''}{chapter.scripts.length} 장면
                  </span>
                </span>
                <span className={`text-[13px] max-sm:hidden ${isSelected ? 'text-nikke-highlight' : 'text-nikke-text-muted'}`}>
                  {isSelected ? '열람 중 · ' : ''}{chapter.scripts.length} 장면
                </span>
                <ChevronRightIcon className="h-[18px] w-[18px] text-nikke-text-muted transition-transform duration-150 group-hover:translate-x-[3px] group-hover:text-nikke-accent" />
              </a>
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
};
