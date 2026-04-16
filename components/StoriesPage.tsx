import React, { useMemo } from 'react';
import type { Script, ScriptCategory } from '../types';
import { CATEGORY_DESCRIPTIONS } from '../constants';
import { ChevronRightIcon, type IconProps } from './Icons';

interface StoriesPageProps {
  categories: ScriptCategory[];
  scripts: Script[];
  activeCategoryKey: string | null;
  selectedScriptId: string | null;
  onCategorySelect: (categoryKey: string) => void;
  onSelectScript: (scriptId: string) => void;
}

interface ChapterGroup {
  title: string;
  scripts: Script[];
}

export const StoriesPage: React.FC<StoriesPageProps> = ({
  categories,
  scripts,
  activeCategoryKey,
  selectedScriptId,
  onCategorySelect,
  onSelectScript,
}) => {
  const effectiveCategoryKey = activeCategoryKey ?? null;
  const activeCategory = categories.find(category => category.key === effectiveCategoryKey) ?? null;

  const chapterGroups = useMemo<ChapterGroup[]>(() => {
    if (!effectiveCategoryKey) return [];

    const grouped = scripts
      .filter(script => script.categoryKey === effectiveCategoryKey)
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
  }, [scripts, effectiveCategoryKey]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col pb-10">
      {!effectiveCategoryKey ? (
        <>
          <header className="mb-12">
            <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.2em] text-nikke-text-muted">
              <span>Home</span>
              <span className="text-nikke-accent">/</span>
              <span className="text-nikke-accent">Stories</span>
            </div>
            <h2 className="mt-4 font-headline text-5xl font-extrabold tracking-[-0.05em] text-nikke-text-primary sm:text-6xl">
              Stories
            </h2>
            <p className="mt-4 max-w-3xl font-body text-xl leading-9 text-nikke-text-secondary">
              Choose an archive section first, then browse its chapters in the editorial list view.
            </p>
          </header>

          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category, index) => {
              const tonalStyles = [
                'from-sky-500/20 via-slate-900 to-slate-950',
                'from-slate-500/15 via-neutral-900 to-slate-950',
                'from-cyan-500/15 via-slate-950 to-neutral-950',
                'from-teal-500/15 via-slate-950 to-neutral-950',
                'from-stone-400/10 via-slate-900 to-neutral-950',
              ];

              const count = scripts.filter(script => script.categoryKey === category.key).length;

              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => onCategorySelect(category.key)}
                  className="group relative min-h-[220px] overflow-hidden rounded-[1.5rem] bg-nikke-surface-low text-left transition-all duration-500 ease-editorial hover:scale-[1.02] hover:bg-nikke-surface-high/70"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${tonalStyles[index % tonalStyles.length]}`} />
                  <div className="absolute inset-0 bg-gradient-to-t from-nikke-bg via-transparent to-transparent opacity-90" />
                  <div className="relative flex h-full flex-col justify-between p-6">
                    <div className="flex items-start justify-between">
                      <span className="rounded-full bg-nikke-surface-high/70 px-3 py-1 font-label text-[10px] uppercase tracking-[0.2em] text-nikke-accent">
                        Archive Section
                      </span>
                      <span className="font-label text-[10px] uppercase tracking-[0.18em] text-nikke-text-muted">
                        {count} scripts
                      </span>
                    </div>
                    <div>
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-nikke-surface-high/60 text-nikke-accent">
                        {category.icon && React.isValidElement(category.icon)
                          ? React.cloneElement(category.icon as React.ReactElement<IconProps>, { className: 'h-5 w-5' })
                          : null}
                      </div>
                      <h3 className="font-headline text-3xl font-bold tracking-[-0.03em] text-white">
                        {category.name}
                      </h3>
                      <p className="mt-3 font-body text-base leading-7 text-nikke-text-secondary">
                        {CATEGORY_DESCRIPTIONS[category.key]}
                      </p>
                    </div>
                    <div className="flex items-end justify-between">
                      <span className="font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted">
                        Explore
                      </span>
                      <ChevronRightIcon className="h-5 w-5 text-nikke-accent transition-transform duration-300 ease-editorial group-hover:translate-x-1" />
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        </>
      ) : (
        <>
          <header className="mb-12">
            <div className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.2em] text-nikke-text-muted">
              <span>Home</span>
              <span className="text-nikke-accent">/</span>
              <button
                type="button"
                onClick={() => onCategorySelect(effectiveCategoryKey)}
                className="text-nikke-accent"
              >
                {activeCategory?.name ?? 'Stories'}
              </button>
            </div>
            <h2 className="mt-4 font-headline text-5xl font-extrabold tracking-[-0.05em] text-nikke-text-primary sm:text-6xl">
              {activeCategory?.name ?? 'Stories'}
            </h2>
          </header>

          <section className="min-w-0">
            <div className="space-y-4">
              {chapterGroups.map((chapter, index) => {
                const firstScript = chapter.scripts[0];
                const isSelected = selectedScriptId ? chapter.scripts.some(script => script.id === selectedScriptId) : false;

                return (
                  <button
                    key={chapter.title}
                    type="button"
                    onClick={() => onSelectScript(firstScript.id)}
                    className={`group w-full rounded-[1.35rem] px-6 py-5 text-left transition-all duration-300 ease-editorial ${
                      isSelected
                        ? 'bg-nikke-surface-high text-nikke-text-primary shadow-glass'
                        : 'bg-nikke-surface-low/65 text-nikke-text-secondary hover:bg-nikke-surface-low hover:translate-x-1 hover:text-nikke-text-primary'
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="max-w-3xl">
                        <h3 className="font-headline text-3xl font-bold tracking-[-0.03em] text-nikke-text-primary">
                          {chapter.title}
                        </h3>
                        {firstScript.subTitle && (
                          <p className="mt-3 font-body text-lg leading-8 text-nikke-text-secondary">
                            {firstScript.subTitle}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-5 md:pt-1">
                        <span className="font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted">
                          {chapter.scripts.length} scenes
                        </span>
                        <ChevronRightIcon className="h-5 w-5 text-nikke-accent transition-transform duration-300 ease-editorial group-hover:translate-x-1" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
