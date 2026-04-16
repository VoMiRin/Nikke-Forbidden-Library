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

interface ScriptViewerProps {
  script: Script | null;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  onNavigateToNextScript?: (currentScriptId: string) => void;
  onNavigateToScript?: (scriptId: string) => void;
  onNavigateToSearch?: () => void;
}

export const ScriptViewer: React.FC<ScriptViewerProps> = ({
  script,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  onNavigateToNextScript,
  onNavigateToScript,
  onNavigateToSearch,
}) => {
  const [internalScriptContent, setInternalScriptContent] = React.useState<string | null>(null);
  const [isLoadingInternalContent, setIsLoadingInternalContent] = React.useState<boolean>(false);
  const [internalContentError, setInternalContentError] = React.useState<string | null>(null);
  const [branchWarning, setBranchWarning] = React.useState<{ choiceId: string } | null>(null);
  const [highlightedChoiceId, setHighlightedChoiceId] = React.useState<string | null>(null);

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
    return parseScriptContent(internalScriptContent, { scriptId: script?.id });
  }, [internalScriptContent, script?.id]);

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
  }, [script?.id]);

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

  const getFirstUnresolvedChoiceId = React.useCallback((element: Extract<ScriptElement, { type: 'next_subchapter_button' }>) => {
    if (!element.routes || element.routes.length === 0) {
      return null;
    }

    const requiredChoiceIds = Array.from(new Set(
      element.routes
        .filter(route => !route.isDefault && route.choiceId)
        .map(route => route.choiceId as string)
    ));

    return requiredChoiceIds.find(choiceId => !selectedOptions[choiceId]) ?? null;
  }, [selectedOptions]);

  const getFirstVisibleUnresolvedChoiceId = React.useCallback(() => {
    const visibleUnresolvedChoices = Array.from(
      document.querySelectorAll<HTMLElement>('[data-choice-block="true"][data-choice-selected="false"]')
    );

    if (visibleUnresolvedChoices.length === 0) {
      return null;
    }

    return visibleUnresolvedChoices[visibleUnresolvedChoices.length - 1]?.dataset.choiceId ?? null;
  }, []);

  const renderElements = (elements: ScriptElement[], parentKeyPrefix: string = ''): React.ReactNode => {
    return elements.map((element, index) => {
      const key = `${parentKeyPrefix}el_${script?.id || 's'}_${index}_${element.type}`;

      if (element.type === 'next_subchapter_button') {
        const targetScriptId = resolveBranchTarget(element);
        return (
          <NextSubChapterButton
            key={key}
            buttonText={element.buttonText}
            onNavigate={() => {
              const unresolvedChoiceId = getFirstVisibleUnresolvedChoiceId() ?? getFirstUnresolvedChoiceId(element);

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
        return <DialogueRenderer key={key} element={element} />;
      }

      if (element.type === 'narration') {
        return <NarrationRenderer key={key} element={element} />;
      }

      if (element.type === 'scene_break') {
        return <hr key={key} className="my-10 h-px border-0 bg-gradient-to-r from-transparent via-nikke-border/25 to-transparent" aria-hidden="true" />;
      }

      if (element.type === 'choice_block') {
        return (
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
        return (
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
      <div className="flex h-full flex-col items-center justify-center rounded-[2rem] bg-nikke-surface-low/70 p-6 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mb-4 h-16 w-16 text-nikke-border">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <p className="font-headline text-2xl font-bold tracking-[-0.02em] text-nikke-text-primary">Select a script from the sidebar.</p>
        <p className="mt-2 max-w-lg text-sm leading-7 text-nikke-text-secondary">
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
        <p className="text-xl text-nikke-accent">Loading "{script.title}{script.subTitle ? ` - ${script.subTitle}` : ''}"...</p>
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
        <header className="mb-6 rounded-[1.5rem] bg-nikke-surface-low/75 px-5 py-5 shadow-glass md:px-6">
        <p className="font-label text-[10px] uppercase tracking-[0.22em] text-nikke-accent">
          {script.categoryKey.replace(/_/g, ' ')}
        </p>
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 id="script-title" className="font-headline text-2xl font-extrabold tracking-[-0.03em] text-nikke-text-primary md:text-3xl">
          {script.title}
            </h2>
            {script.subTitle && (
              <p className="mt-1.5 font-body text-base leading-7 text-nikke-text-secondary md:text-lg">
                {script.subTitle}
              </p>
            )}
          </div>
          {onNavigateToSearch && (
            <button
              onClick={onNavigateToSearch}
              className="rounded-full bg-nikke-surface-high px-4 py-2 font-label text-[11px] uppercase tracking-[0.16em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary"
            >
              Back to Stories
            </button>
          )}
        </div>
        <div className="mt-4 h-px bg-gradient-to-r from-nikke-accent/30 via-nikke-border/20 to-transparent" />
        </header>

        <div className="mt-1 flex-grow overflow-y-auto pr-2">
          {parsedElements.length > 0 ? renderElements(parsedElements) :
            <p className="font-body text-lg italic text-nikke-text-muted">This script part is empty or cannot be displayed right now.</p>
          }
        </div>
      </article>
    </>
  );
};
