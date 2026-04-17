import React from 'react';
import type { Script, ScriptElement } from '../types';
import {
  parseScriptContent,
  DialogueRenderer,
  NarrationRenderer,
  ChoiceBlockRenderer,
  MessengerAppRenderer,
  NextSubChapterButton,
} from './script';

type SearchFocus = {
  term: string;
  mode: 'content' | 'speaker';
};

interface ScriptViewerProps {
  script: Script | null;
  searchFocus?: SearchFocus | null;
  canNavigateToPreviousScript?: boolean;
  canNavigateToNextScript?: boolean;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  onNavigateToPreviousScript?: (currentScriptId: string) => void;
  onNavigateToNextScript?: (currentScriptId: string) => void;
  onNavigateToScript?: (scriptId: string) => void;
  onNavigateToSearch?: () => void;
}

export const ScriptViewer: React.FC<ScriptViewerProps> = ({
  script,
  searchFocus = null,
  canNavigateToPreviousScript = false,
  canNavigateToNextScript = false,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  onNavigateToPreviousScript,
  onNavigateToNextScript,
  onNavigateToScript,
  onNavigateToSearch,
}) => {
  const [internalScriptContent, setInternalScriptContent] = React.useState<string | null>(null);
  const [isLoadingInternalContent, setIsLoadingInternalContent] = React.useState<boolean>(false);
  const [internalContentError, setInternalContentError] = React.useState<string | null>(null);
  const [branchWarning, setBranchWarning] = React.useState<{ choiceId: string } | null>(null);
  const [highlightedChoiceId, setHighlightedChoiceId] = React.useState<string | null>(null);
  const [highlightedSearchMatchId, setHighlightedSearchMatchId] = React.useState<string | null>(null);

  const normalizeSearchValue = React.useCallback((value: string): string => (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  ), []);

  const buildElementDomId = React.useCallback((parentKeyPrefix: string, index: number, type: ScriptElement['type']) => (
    `script-element-${script?.id || 's'}-${parentKeyPrefix}${index}-${type}`.replace(/[^a-zA-Z0-9:_-]/g, '_')
  ), [script?.id]);

  React.useEffect(() => {
    if (script && script.id) {
      setIsLoadingInternalContent(true);
      setInternalScriptContent(null);
      setInternalContentError(null);

      script.loadContent()
        .then(content => {
          setInternalScriptContent(content);
        })
        .catch(error => {
          console.error(`Error loading content for script ${script.id} in ScriptViewer:`, error);
          setInternalContentError(error instanceof Error ? error.message : `Failed to load script content. Error: ${String(error)}`);
        })
        .finally(() => {
          setIsLoadingInternalContent(false);
        });
    } else {
      setInternalScriptContent(null);
      setIsLoadingInternalContent(false);
      setInternalContentError(null);
    }
  }, [script?.id]);

  const parsedElements = React.useMemo(() => {
    if (!internalScriptContent) return [];
    return parseScriptContent(internalScriptContent, {
      scriptId: script?.id,
      categoryKey: script?.categoryKey,
    });
  }, [internalScriptContent, script?.categoryKey, script?.id]);

  const elementMatchesSearch = React.useCallback((
    element: ScriptElement,
    normalizedTerm: string,
  ): boolean => {
    if (!normalizedTerm) return false;

    if (element.type === 'dialogue') {
      const searchableField = searchFocus?.mode === 'speaker'
        ? element.speaker ?? ''
        : `${element.speaker ?? ''} ${element.dialogue ?? ''}`;
      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    if (element.type === 'narration') {
      const searchableField = searchFocus?.mode === 'speaker'
        ? element.speaker ?? ''
        : `${element.speaker ?? ''} ${element.text}`;
      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    if (element.type === 'messenger_app') {
      const searchableField = element.messages
        .filter((message) => message.type === 'message_bubble')
        .map((message) => {
          if (searchFocus?.mode === 'speaker') {
            return message.sender;
          }

          return `${message.sender} ${message.text ?? ''}`;
        })
        .join(' ');

      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    if (element.type === 'choice_block') {
      const searchableField = [
        element.prompt ?? '',
        ...element.options.map((option) => option.text),
      ].join(' ');

      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    return false;
  }, [normalizeSearchValue, searchFocus?.mode]);

  const findFirstSearchMatchId = React.useCallback((
    elements: ScriptElement[],
    normalizedTerm: string,
    parentKeyPrefix: string = '',
  ): string | null => {
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      const elementId = buildElementDomId(parentKeyPrefix, index, element.type);

      if (elementMatchesSearch(element, normalizedTerm)) {
        return elementId;
      }

      if (element.type === 'choice_block') {
        const selectedOptionValue = selectedOptions[element.choiceId];
        const selectedOption = element.options.find((option) => option.value === selectedOptionValue);
        if (selectedOption) {
          const nestedMatchId = findFirstSearchMatchId(
            selectedOption.elements,
            normalizedTerm,
            `${element.choiceId}_${selectedOptionValue}_`,
          );

          if (nestedMatchId) {
            return nestedMatchId;
          }
        }
      }
    }

    return null;
  }, [buildElementDomId, elementMatchesSearch, selectedOptions]);

  const firstSearchMatchId = React.useMemo(() => {
    const normalizedSearchTerm = normalizeSearchValue(searchFocus?.term ?? '');
    if (!normalizedSearchTerm || parsedElements.length === 0) {
      return null;
    }

    return findFirstSearchMatchId(parsedElements, normalizedSearchTerm);
  }, [findFirstSearchMatchId, normalizeSearchValue, parsedElements, searchFocus?.term]);

  const focusChoiceBlock = React.useCallback((choiceId: string) => {
    const target = document.getElementById(`choice-block-${choiceId}`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedChoiceId(choiceId);
  }, []);

  React.useEffect(() => {
    if (!highlightedChoiceId) return;

    const timeout = window.setTimeout(() => {
      setHighlightedChoiceId(null);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [highlightedChoiceId]);

  React.useEffect(() => {
    setBranchWarning(null);
    setHighlightedChoiceId(null);
    setHighlightedSearchMatchId(null);
  }, [script?.id]);

  React.useEffect(() => {
    if (!firstSearchMatchId) return;

    const frameId = window.requestAnimationFrame(() => {
      const target = document.getElementById(firstSearchMatchId);
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedSearchMatchId(firstSearchMatchId);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [firstSearchMatchId]);

  React.useEffect(() => {
    if (!highlightedSearchMatchId) return;

    const timeout = window.setTimeout(() => {
      setHighlightedSearchMatchId(null);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [highlightedSearchMatchId]);

  const resolveBranchTarget = React.useCallback((element: Extract<ScriptElement, { type: 'next_subchapter_button' }>) => {
    if (element.routes && element.routes.length > 0) {
      for (const route of element.routes) {
        if (route.isDefault) continue;
        if (route.choiceId && selectedOptions[route.choiceId] === route.optionValue) {
          return route.targetScriptId;
        }
      }

      const defaultRoute = element.routes.find(route => route.isDefault);
      if (defaultRoute?.targetScriptId) {
        return defaultRoute.targetScriptId;
      }
    }

    return element.targetScriptId;
  }, [selectedOptions]);

  const getRequiredChoiceIds = React.useCallback((element: Extract<ScriptElement, { type: 'next_subchapter_button' }>) => (
    Array.from(new Set(
      element.routes
        ? element.routes
        .filter(route => !route.isDefault && route.choiceId)
        .map(route => route.choiceId as string)
        : []
    ))
  ), []);

  const getFirstUnresolvedChoiceId = React.useCallback((element: Extract<ScriptElement, { type: 'next_subchapter_button' }>) => {
    const requiredChoiceIds = getRequiredChoiceIds(element);
    if (requiredChoiceIds.length === 0) {
      return null;
    }

    return requiredChoiceIds.find(choiceId => !selectedOptions[choiceId]) ?? null;
  }, [getRequiredChoiceIds, selectedOptions]);

  const getFirstVisibleUnresolvedChoiceId = React.useCallback((choiceIds: string[]) => {
    if (choiceIds.length === 0) {
      return null;
    }

    const visibleUnresolvedChoices = Array.from(
      document.querySelectorAll<HTMLElement>('[data-choice-block="true"][data-choice-selected="false"]')
    );

    if (visibleUnresolvedChoices.length === 0) {
      return null;
    }

    const matchingVisibleChoice = visibleUnresolvedChoices.find(choiceBlock => {
      const choiceId = choiceBlock.dataset.choiceId;
      return choiceId ? choiceIds.includes(choiceId) : false;
    });

    return matchingVisibleChoice?.dataset.choiceId ?? null;
  }, []);

  const renderElements = (elements: ScriptElement[], parentKeyPrefix: string = ''): React.ReactNode => {
    return elements.map((element, index) => {
      const key = `${parentKeyPrefix}el_${script?.id || 's'}_${index}_${element.type}`;
      const elementId = buildElementDomId(parentKeyPrefix, index, element.type);
      const isSearchMatched = highlightedSearchMatchId === elementId;
      const wrapElement = (node: React.ReactNode) => (
        <div
          key={key}
          id={elementId}
          className={isSearchMatched ? 'rounded-[1.75rem] ring-2 ring-nikke-accent/80 shadow-[0_0_0_1px_rgba(104,206,255,0.16),0_0_36px_rgba(104,206,255,0.16)] transition-all duration-300 ease-editorial' : undefined}
        >
          {node}
        </div>
      );

      if (element.type === 'next_subchapter_button') {
        const targetScriptId = resolveBranchTarget(element);
        return wrapElement(
          <NextSubChapterButton
            key={key}
            buttonText={element.buttonText}
            onNavigate={() => {
              const requiredChoiceIds = getRequiredChoiceIds(element);
              const unresolvedChoiceId = getFirstVisibleUnresolvedChoiceId(requiredChoiceIds) ?? getFirstUnresolvedChoiceId(element);

              if (!targetScriptId && unresolvedChoiceId) {
                setBranchWarning({ choiceId: unresolvedChoiceId });
                focusChoiceBlock(unresolvedChoiceId);
                return;
              }

              if (targetScriptId) {
                onNavigateToScript?.(targetScriptId);
                return;
              }

              if (script) {
                onNavigateToNextScript?.(script.id);
              }
            }}
          />
        );
      }

      if (element.type === 'dialogue') {
        return wrapElement(<DialogueRenderer key={key} element={element} />);
      }

      if (element.type === 'narration') {
        return wrapElement(<NarrationRenderer key={key} element={element} />);
      }

      if (element.type === 'scene_break') {
        return wrapElement(<hr key={key} className="my-10 h-px border-0 bg-gradient-to-r from-transparent via-nikke-border/25 to-transparent" aria-hidden="true" />);
      }

      if (element.type === 'choice_block') {
        return wrapElement(
          <ChoiceBlockRenderer
            key={key}
            element={element}
            selectedOptions={selectedOptions}
            onOptionSelect={onOptionSelect}
            onClearChoice={onClearChoice}
            renderElements={renderElements}
            containerId={`choice-block-${element.choiceId}`}
            isHighlighted={highlightedChoiceId === element.choiceId}
          />
        );
      }

      if (element.type === 'messenger_app') {
        return wrapElement(
          <MessengerAppRenderer
            key={key}
            element={element}
            keyPrefix={key}
            selectedOptions={selectedOptions}
            onOptionSelect={onOptionSelect}
            onClearChoice={onClearChoice}
          />
        );
      }

      return null;
    });
  };

  if (!script) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-[1.5rem] bg-nikke-surface-low/70 p-5 text-center md:rounded-[2rem] md:p-6">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mb-4 h-16 w-16 text-nikke-border">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <p className="font-headline text-xl font-bold tracking-[-0.02em] text-nikke-text-primary md:text-2xl">Select a script from the sidebar.</p>
        <p className="mt-2 max-w-lg text-sm leading-6 text-nikke-text-secondary md:leading-7">
          Selected chapters and subchapters now read in a quieter editorial layout.
        </p>
        {onNavigateToSearch && (
          <button
            onClick={onNavigateToSearch}
            className="mt-6 rounded-full bg-nikke-gradient px-6 py-3 font-semibold text-slate-950 transition-transform duration-300 ease-editorial hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-nikke-accent"
          >
            Back to Stories
          </button>
        )}
      </div>
    );
  }

  if (isLoadingInternalContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center" role="status" aria-live="polite">
        <svg className="mb-3 h-8 w-8 animate-spin text-nikke-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-base text-nikke-accent md:text-xl">Loading "{script.title}{script.subTitle ? ` - ${script.subTitle}` : ''}"...</p>
      </div>
    );
  }

  if (internalContentError) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-[2rem] bg-red-950/20 p-4 text-center text-red-400" role="alert">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mb-3 h-12 w-12">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <p className="text-xl font-semibold">Unable to load this script.</p>
        <p className="mb-3 mt-1 text-nikke-text-secondary">The content for "{script.title}{script.subTitle ? ` - ${script.subTitle}` : ''}" could not be opened.</p>
        <p className="max-w-md rounded-2xl bg-nikke-bg p-3 text-xs">{internalContentError}</p>
      </div>
    );
  }

  return (
    <>
      {branchWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[2rem] bg-nikke-surface p-6 shadow-ambient ring-1 ring-nikke-border/10">
            <p className="font-label text-[11px] uppercase tracking-[0.22em] text-nikke-accent">Choice Required</p>
            <h3 className="mt-3 font-headline text-2xl font-extrabold tracking-[-0.03em] text-nikke-text-primary">
              Make a selection first
            </h3>
            <p className="mt-4 font-body text-base leading-7 text-nikke-text-secondary">
              You need to choose an option before moving to the next part.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  focusChoiceBlock(branchWarning.choiceId);
                  setBranchWarning(null);
                }}
                className="rounded-full bg-nikke-gradient px-5 py-3 font-semibold text-slate-950 transition-transform duration-300 ease-editorial hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-nikke-accent"
              >
                Go to Choice
              </button>
              <button
                onClick={() => setBranchWarning(null)}
                className="rounded-full bg-nikke-surface-high px-5 py-3 font-label text-[11px] uppercase tracking-[0.16em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary focus:outline-none focus:ring-2 focus:ring-nikke-accent/30"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <article className="mx-auto flex h-full max-w-[980px] flex-col" aria-labelledby="script-title">
        <header className="mb-5 rounded-[1.25rem] bg-nikke-surface-low/75 px-4 py-4 shadow-glass md:mb-6 md:rounded-[1.5rem] md:px-6 md:py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-label text-[10px] uppercase tracking-[0.22em] text-nikke-accent">
          {script.categoryKey.replace(/_/g, ' ')}
        </p>
          <div className="flex items-center gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={() => onNavigateToPreviousScript?.(script.id)}
              disabled={!canNavigateToPreviousScript}
              className="rounded-full bg-nikke-surface-high px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.14em] text-nikke-text-primary transition-colors duration-300 ease-editorial hover:bg-nikke-surface-highest disabled:cursor-not-allowed disabled:opacity-35"
            >
              이전
            </button>
            <button
              type="button"
              onClick={() => onNavigateToNextScript?.(script.id)}
              disabled={!canNavigateToNextScript}
              className="rounded-full bg-nikke-surface-high px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.14em] text-nikke-text-primary transition-colors duration-300 ease-editorial hover:bg-nikke-surface-highest disabled:cursor-not-allowed disabled:opacity-35"
            >
              다음
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 id="script-title" className="font-headline text-xl font-extrabold tracking-[-0.03em] text-nikke-text-primary md:text-3xl">
          {script.title}
            </h2>
            {script.subTitle && (
              <p className="mt-1.5 font-body text-sm leading-6 text-nikke-text-secondary md:text-lg md:leading-7">
                {script.subTitle}
              </p>
            )}
          </div>
          {onNavigateToSearch && (
            <button
              onClick={onNavigateToSearch}
              className="rounded-full bg-nikke-surface-high px-4 py-2 font-label text-[10px] uppercase tracking-[0.14em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary md:text-[11px] md:tracking-[0.16em]"
            >
              Back to Stories
            </button>
          )}
        </div>
        <div className="mt-4 h-px bg-gradient-to-r from-nikke-accent/30 via-nikke-border/20 to-transparent" />
        </header>

        <div className="mt-1 flex-grow overflow-y-visible md:overflow-y-auto md:pr-2">
          {parsedElements.length > 0 ? renderElements(parsedElements) :
            <p className="font-body text-base italic text-nikke-text-muted md:text-lg">This script part is empty or cannot be displayed right now.</p>
          }
        </div>
      </article>
    </>
  );
};
