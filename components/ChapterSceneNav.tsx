import React, { useMemo } from 'react';
import type { Script } from '../types';

interface ChapterSceneNavProps {
  script: Script;
  scripts: Script[];
  activeCategoryKey: string | null;
  onNavigateToScript: (scriptId: string) => void;
}

export const ChapterSceneNav: React.FC<ChapterSceneNavProps> = ({
  script,
  scripts,
  activeCategoryKey,
  onNavigateToScript,
}) => {
  // Get all scripts in the same category
  const categoryScripts = useMemo(() => {
    if (!activeCategoryKey) return [];
    return scripts.filter(s => s.categoryKey === activeCategoryKey);
  }, [scripts, activeCategoryKey]);

  // Get unique chapter titles (preserving order)
  const chapters = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of categoryScripts) {
      if (!seen.has(s.title)) {
        seen.add(s.title);
        result.push(s.title);
      }
    }
    return result;
  }, [categoryScripts]);

  // Get scenes (subTitles) for the current chapter
  const currentChapterScripts = useMemo(() => {
    return categoryScripts.filter(s => s.title === script.title);
  }, [categoryScripts, script.title]);

  // Current scene index within chapter
  const currentSceneIndex = useMemo(() => {
    return currentChapterScripts.findIndex(s => s.id === script.id);
  }, [currentChapterScripts, script.id]);

  // Current chapter index
  const currentChapterIndex = useMemo(() => {
    return chapters.indexOf(script.title);
  }, [chapters, script.title]);

  // All scripts flat index for prev/next navigation
  const allFlatIndex = useMemo(() => {
    return categoryScripts.findIndex(s => s.id === script.id);
  }, [categoryScripts, script.id]);

  const handleChapterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newChapterTitle = e.target.value;
    const firstScriptInChapter = categoryScripts.find(s => s.title === newChapterTitle);
    if (firstScriptInChapter) {
      onNavigateToScript(firstScriptInChapter.id);
    }
  };

  const handleSceneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newScriptId = e.target.value;
    onNavigateToScript(newScriptId);
  };

  const handlePrev = () => {
    if (allFlatIndex > 0) {
      onNavigateToScript(categoryScripts[allFlatIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (allFlatIndex < categoryScripts.length - 1) {
      onNavigateToScript(categoryScripts[allFlatIndex + 1].id);
    }
  };

  if (chapters.length === 0) return null;

  // Extract short chapter label for display
  const getChapterLabel = (title: string, index: number) => {
    // Try to extract chapter number from title like "Chapter.01: 침식"
    const match = title.match(/Chapter\.?(\d+)/i);
    if (match) return match[1];
    // Fallback: use index + 1 padded
    return String(index + 1).padStart(2, '0');
  };

  return (
    <div className="flex items-center justify-center gap-3 py-3 px-4 border-b border-nikke-border bg-nikke-bg-alt">
      {/* Chapter Dropdown */}
      <div className="flex items-center gap-1.5">
        <label htmlFor="chapter-select" className="text-sm font-medium text-nikke-text-secondary whitespace-nowrap">
          Chapter:
        </label>
        <select
          id="chapter-select"
          value={script.title}
          onChange={handleChapterChange}
          className="text-sm font-semibold text-nikke-text-primary bg-nikke-bg border border-nikke-border rounded-md px-2 py-1.5 focus:ring-2 focus:ring-nikke-accent/30 focus:border-nikke-accent outline-none cursor-pointer"
        >
          {chapters.map((title, idx) => (
            <option key={title} value={title}>
              {getChapterLabel(title, idx)}
            </option>
          ))}
        </select>
      </div>

      {/* Scene Dropdown */}
      <div className="flex items-center gap-1.5">
        <label htmlFor="scene-select" className="text-sm font-medium text-nikke-text-secondary whitespace-nowrap">
          Scene:
        </label>
        <select
          id="scene-select"
          value={script.id}
          onChange={handleSceneChange}
          className="text-sm font-semibold text-nikke-text-primary bg-nikke-bg border border-nikke-border rounded-md px-2 py-1.5 focus:ring-2 focus:ring-nikke-accent/30 focus:border-nikke-accent outline-none cursor-pointer max-w-[160px]"
        >
          {currentChapterScripts.map((s, idx) => (
            <option key={s.id} value={s.id}>
              {idx + 1}
            </option>
          ))}
        </select>
      </div>

      {/* Prev/Next Buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={handlePrev}
          disabled={allFlatIndex <= 0}
          className="p-1.5 rounded-md border border-nikke-border text-nikke-text-secondary hover:bg-nikke-hover hover:text-nikke-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous scene"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <button
          onClick={handleNext}
          disabled={allFlatIndex >= categoryScripts.length - 1}
          className="p-1.5 rounded-md border border-nikke-border text-nikke-text-secondary hover:bg-nikke-hover hover:text-nikke-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next scene"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
};
