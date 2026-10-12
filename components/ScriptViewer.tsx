import React from 'react';
import type { MessengerAppElement, MessengerContentElement, Script, ScriptElement } from '../types';
import {
  parseScriptContent,
  DialogueRenderer,
  NarrationRenderer,
  ChoiceBlockRenderer,
  MessengerAppRenderer,
  NextSubChapterButton,
  BranchNextButtons,
  collectChoiceOptionKeys,
  collectRouteTargets,
  getMessengerBranchSearchList,
  hasBranchingContent,
  type BranchRouteButton,
  type ExtendedMessengerChoiceOption,
} from './script';
import { BranchIcon, ChevronLeftIcon, ChevronRightIcon, FourPointStarIcon, LinkIcon } from './Icons';
import { NikkeLogo } from './NikkeLogo';
import { scenePath } from '../lib/pageRoutes.mjs';

type SearchFocus = {
  term: string;
  mode: 'content' | 'speaker';
  speakerTerm?: string;
};

type ReaderTextSize = 'sm' | 'md' | 'lg' | 'xl';
type ReaderLineHeight = 'tight' | 'normal' | 'loose';
type ReaderWidth = 'narrow' | 'normal' | 'wide';

const READER_TEXT_SIZES: readonly ReaderTextSize[] = ['sm', 'md', 'lg', 'xl'];
/** 본문 기준 글자 크기(px). 대사·지문은 이 값에 대한 em 단위로 그린다. */
const READER_TEXT_SIZE_PX: Record<ReaderTextSize, number> = { sm: 14, md: 16, lg: 18, xl: 20 };
const READER_LINE_HEIGHTS: readonly ReaderLineHeight[] = ['tight', 'normal', 'loose'];
const READER_LINE_HEIGHT_VALUE: Record<ReaderLineHeight, number> = { tight: 1.7, normal: 1.9, loose: 2.15 };
const READER_WIDTHS: readonly ReaderWidth[] = ['narrow', 'normal', 'wide'];
const READER_WIDTH_PX: Record<ReaderWidth, number> = { narrow: 640, normal: 760, wide: 920 };

/** 읽기 설정처럼 이 브라우저에만 기억하면 되는 값. 저장소를 못 써도 화면에는 적용된다. */
const useStoredOption = <T extends string>(storageKey: string, options: readonly T[], fallback: T) => {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return options.includes(stored as T) ? stored as T : fallback;
    } catch {
      return fallback;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // 저장하지 못해도 현재 화면에는 적용된다
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
};

interface ScriptViewerProps {
  script: Script | null;
  searchFocus?: SearchFocus | null;
  canNavigateToPreviousScript?: boolean;
  canNavigateToNextScript?: boolean;
  /** 툴바 기록 번호 표시용: 분류 로마 숫자, 챕터 안 장면 순번(0부터)과 총수 */
  categoryRoman?: string;
  sceneIndex?: number;
  sceneCount?: number;
  /** 이전/다음이 챕터를 넘어갈 때 그 챕터 제목 (메인 스토리) */
  previousChapterTitle?: string;
  nextChapterTitle?: string;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  onNavigateToPreviousScript?: (currentScriptId: string) => void;
  onNavigateToNextScript?: (currentScriptId: string) => void;
  onNavigateToScript?: (scriptId: string) => void;
  onNavigateToSearch?: () => void;
  /** 장면 ID → 화면에 보일 장면 이름 (분기 목적지 표시용) */
  describeScene?: (scriptId: string) => string | undefined;
}

export const ScriptViewer: React.FC<ScriptViewerProps> = ({
  script,
  searchFocus = null,
  canNavigateToPreviousScript = false,
  canNavigateToNextScript = false,
  categoryRoman,
  sceneIndex = -1,
  sceneCount = 0,
  previousChapterTitle,
  nextChapterTitle,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  onNavigateToPreviousScript,
  onNavigateToNextScript,
  onNavigateToScript,
  onNavigateToSearch,
  describeScene,
}) => {
  const [internalScriptContent, setInternalScriptContent] = React.useState<string | null>(script?.content ?? null);
  const [isLoadingInternalContent, setIsLoadingInternalContent] = React.useState<boolean>(false);
  const [internalContentError, setInternalContentError] = React.useState<string | null>(null);
  const [branchWarning, setBranchWarning] = React.useState<{ choiceId: string } | null>(null);
  const [highlightedChoiceId, setHighlightedChoiceId] = React.useState<string | null>(null);
  const [highlightedSearchMatchId, setHighlightedSearchMatchId] = React.useState<string | null>(null);
  const [readerTextSize, setReaderTextSize] = useStoredOption<ReaderTextSize>('nikke-reader-text-size', READER_TEXT_SIZES, 'md');
  const [readerLineHeight, setReaderLineHeight] = useStoredOption<ReaderLineHeight>('nikke-reader-line-height', READER_LINE_HEIGHTS, 'normal');
  const [readerWidth, setReaderWidth] = useStoredOption<ReaderWidth>('nikke-reader-width', READER_WIDTHS, 'normal');
  const [showAllBranchesSetting, setShowAllBranchesSetting] = useStoredOption<'on' | 'off'>('nikke-reader-all-branches', ['on', 'off'], 'off');
  // 검색으로 들어왔는데 일치 위치가 고르지 않은 분기 안에만 있으면, 이 장면에서만 임시로 모든 분기를 펼친다
  const [searchAutoExpand, setSearchAutoExpand] = React.useState<'idle' | 'trying' | 'on' | 'done'>('idle');
  const showAllBranches = showAllBranchesSetting === 'on' || searchAutoExpand === 'trying' || searchAutoExpand === 'on';
  const [isReaderSettingsOpen, setIsReaderSettingsOpen] = React.useState(false);
  const [isLinkCopied, setIsLinkCopied] = React.useState(false);
  const branchWarningDialogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isLinkCopied) return;
    const timeout = window.setTimeout(() => setIsLinkCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [isLinkCopied]);

  // 선택 필요 모달: Esc로 닫기, Tab을 모달 안에 가두기, 닫으면 이전 포커스로 돌아가기
  React.useEffect(() => {
    if (!branchWarning) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setBranchWarning(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = branchWarningDialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // 선택지로 이동한 경우에는 선택지 버튼에 포커스가 이미 있으므로 덮어쓰지 않는다
      if (previouslyFocused && document.activeElement === document.body) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [branchWarning]);

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

  const buildMessengerMessageDomId = React.useCallback((messengerElementId: string, messageIndex: number) => (
    `${messengerElementId}-message-${messageIndex}`.replace(/[^a-zA-Z0-9:_-]/g, '_')
  ), []);

  React.useEffect(() => {
    if (typeof script?.content === 'string') {
      setInternalScriptContent(script.content);
      setIsLoadingInternalContent(false);
      setInternalContentError(null);
      return;
    }
    if (script && script.id) {
      setIsLoadingInternalContent(true);
      setInternalScriptContent(null);
      setInternalContentError(null);

      // 빠르게 장면을 바꿀 때 늦게 끝난 이전 요청이 현재 화면을 덮지 않도록 한다
      let isCurrentRequest = true;

      script.loadContent()
        .then(content => {
          if (!isCurrentRequest) return;
          setInternalScriptContent(content);
        })
        .catch(error => {
          if (!isCurrentRequest) return;
          console.error(`Error loading content for script ${script.id} in ScriptViewer:`, error);
          setInternalContentError(error instanceof Error ? error.message : `Failed to load script content. Error: ${String(error)}`);
        })
        .finally(() => {
          if (!isCurrentRequest) return;
          setIsLoadingInternalContent(false);
        });

      return () => {
        isCurrentRequest = false;
      };
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

  const getVisibleMessengerMessages = React.useCallback((element: MessengerAppElement): (MessengerContentElement | null)[] => {
    // 모든 분기 보기에서는 화면에 펼친 순서 그대로 (인덱스가 메시지 DOM id와 맞아야 한다)
    if (showAllBranches) {
      return getMessengerBranchSearchList(element);
    }

    const allMessages: MessengerContentElement[] = [];

    for (const msg of element.messages) {
      allMessages.push(msg);

      if (msg.type === 'message_bubble' && msg.choice) {
        const selectedOptionValue = selectedOptions[msg.choice.choiceId];
        if (selectedOptionValue) {
          const selectedOption = msg.choice.options.find(option => option.value === selectedOptionValue) as ExtendedMessengerChoiceOption;
          if (selectedOption?.messages) {
            allMessages.push(...selectedOption.messages);
          }
        }
      }
    }

    const firstUnansweredChoiceIndex = element.messages.findIndex(
      msg => msg.type === 'message_bubble' && msg.choice && !selectedOptions[msg.choice.choiceId]
    );

    if (firstUnansweredChoiceIndex === -1) {
      return allMessages;
    }

    let messageCount = 0;
    for (let index = 0; index <= firstUnansweredChoiceIndex; index++) {
      messageCount++;
      const msg = element.messages[index];
      if (msg.type === 'message_bubble' && msg.choice && selectedOptions[msg.choice.choiceId]) {
        const selectedOption = msg.choice.options.find(option => option.value === selectedOptions[msg.choice.choiceId]) as ExtendedMessengerChoiceOption;
        if (selectedOption?.messages) {
          messageCount += selectedOption.messages.length;
        }
      }
    }

    return allMessages.slice(0, messageCount);
  }, [selectedOptions, showAllBranches]);

  const messageMatchesSearch = React.useCallback((
    message: MessengerContentElement | null,
    normalizedTerm: string,
    normalizedSpeakerTerm: string,
  ): boolean => {
    if (!normalizedTerm || !message || message.type !== 'message_bubble') {
      return false;
    }

    const normalizedSender = normalizeSearchValue(message.sender);
    const normalizedText = normalizeSearchValue(message.text ?? '');

    if (searchFocus?.mode === 'speaker') {
      return normalizedSender.includes(normalizedTerm);
    }

    if (normalizedSpeakerTerm && !normalizedSender.includes(normalizedSpeakerTerm)) {
      return false;
    }

    return normalizedSpeakerTerm
      ? normalizedText.includes(normalizedTerm)
      : normalizeSearchValue(`${message.sender} ${message.text ?? ''}`).includes(normalizedTerm);
  }, [normalizeSearchValue, searchFocus?.mode]);

  const elementMatchesSearch = React.useCallback((
    element: ScriptElement,
    normalizedTerm: string,
  ): boolean => {
    if (!normalizedTerm) return false;
    const normalizedSpeakerTerm = normalizeSearchValue(searchFocus?.speakerTerm ?? '');

    if (element.type === 'dialogue') {
      if (searchFocus?.mode === 'content' && normalizedSpeakerTerm) {
        return (
          normalizeSearchValue(element.speaker ?? '').includes(normalizedSpeakerTerm)
          && normalizeSearchValue(element.dialogue ?? '').includes(normalizedTerm)
        );
      }

      const searchableField = searchFocus?.mode === 'speaker'
        ? element.speaker ?? ''
        : `${element.speaker ?? ''} ${element.dialogue ?? ''}`;
      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    if (element.type === 'narration') {
      if (searchFocus?.mode === 'content' && normalizedSpeakerTerm) {
        return (
          normalizeSearchValue(element.speaker ?? '').includes(normalizedSpeakerTerm)
          && normalizeSearchValue(element.text).includes(normalizedTerm)
        );
      }

      const searchableField = searchFocus?.mode === 'speaker'
        ? element.speaker ?? ''
        : `${element.speaker ?? ''} ${element.text}`;
      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    if (element.type === 'messenger_app') {
      return getVisibleMessengerMessages(element).some((message) => (
        messageMatchesSearch(message, normalizedTerm, normalizedSpeakerTerm)
      ));
    }

    if (element.type === 'choice_block') {
      if (searchFocus?.mode === 'content' && normalizedSpeakerTerm) {
        return false;
      }

      const searchableField = [
        element.prompt ?? '',
        ...element.options.map((option) => option.text),
      ].join(' ');

      return normalizeSearchValue(searchableField).includes(normalizedTerm);
    }

    return false;
  }, [getVisibleMessengerMessages, messageMatchesSearch, normalizeSearchValue, searchFocus?.mode, searchFocus?.speakerTerm]);

  const findFirstSearchMatchId = React.useCallback((
    elements: ScriptElement[],
    normalizedTerm: string,
    parentKeyPrefix: string = '',
  ): string | null => {
    const normalizedSpeakerTerm = normalizeSearchValue(searchFocus?.speakerTerm ?? '');

    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      const elementId = buildElementDomId(parentKeyPrefix, index, element.type);

      if (element.type === 'messenger_app') {
        const matchingMessageIndex = getVisibleMessengerMessages(element).findIndex((message) => (
          messageMatchesSearch(message, normalizedTerm, normalizedSpeakerTerm)
        ));

        if (matchingMessageIndex !== -1) {
          return buildMessengerMessageDomId(elementId, matchingMessageIndex);
        }
      }

      if (elementMatchesSearch(element, normalizedTerm)) {
        return elementId;
      }

      if (element.type === 'choice_block') {
        // 모든 분기 보기에서는 펼쳐진 모든 갈래를, 아니면 고른 갈래만 찾는다
        const searchableOptions = showAllBranches
          ? element.options
          : element.options.filter((option) => option.value === selectedOptions[element.choiceId]);
        for (const option of searchableOptions) {
          const nestedMatchId = findFirstSearchMatchId(
            option.elements,
            normalizedTerm,
            `${element.choiceId}_${option.value}_`,
          );

          if (nestedMatchId) {
            return nestedMatchId;
          }
        }
      }
    }

    return null;
  }, [
    buildElementDomId,
    buildMessengerMessageDomId,
    elementMatchesSearch,
    getVisibleMessengerMessages,
    messageMatchesSearch,
    normalizeSearchValue,
    searchFocus?.speakerTerm,
    selectedOptions,
    showAllBranches,
  ]);

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
    target.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
    setSearchAutoExpand('idle');
  }, [script?.id, searchFocus?.term]);

  React.useEffect(() => {
    if (!searchFocus?.term || parsedElements.length === 0) return;
    if (searchAutoExpand === 'idle') {
      if (!firstSearchMatchId && showAllBranchesSetting === 'off' && hasBranchingContent(parsedElements)) {
        setSearchAutoExpand('trying');
      }
    } else if (searchAutoExpand === 'trying') {
      // 펼쳐도 못 찾으면 원래대로 접는다
      setSearchAutoExpand(firstSearchMatchId ? 'on' : 'done');
    }
  }, [firstSearchMatchId, parsedElements, searchAutoExpand, searchFocus?.term, showAllBranchesSetting]);

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

  const sceneHasBranches = React.useMemo(() => hasBranchingContent(parsedElements), [parsedElements]);
  const choiceOptionKeys = React.useMemo(() => collectChoiceOptionKeys(parsedElements), [parsedElements]);
  const routeTargets = React.useMemo(() => collectRouteTargets(parsedElements), [parsedElements]);
  const getOptionDestination = (choiceId: string, optionValue: string) => {
    const targetScriptId = routeTargets.get(choiceId)?.get(optionValue);
    return targetScriptId ? (describeScene?.(targetScriptId) ?? targetScriptId) : undefined;
  };

  /** 모든 분기 보기에서 선택에 따라 목적지가 갈리는 경우, 경우별 버튼 목록을 만든다 */
  const buildBranchRouteButtons = (element: Extract<ScriptElement, { type: 'next_subchapter_button' }>): BranchRouteButton[] => {
    const conditionalRoutes = (element.routes ?? []).filter(route => !route.isDefault && route.choiceId && route.targetScriptId);
    if (conditionalRoutes.length === 0) return [];

    // 선택지 문구를 함께 적어, 서로 다른 선택지의 A/B가 섞여도 구분되게 한다
    const shorten = (text: string) => (text.length > 22 ? `${text.slice(0, 22)}…` : text);
    const labelsByTarget = new Map<string, string[]>();
    for (const route of conditionalRoutes) {
      const option = choiceOptionKeys.get(route.choiceId!)?.get(route.optionValue ?? '');
      const label = option ? `${option.key} 「${shorten(option.text)}」` : (route.optionValue ?? '?');
      labelsByTarget.set(route.targetScriptId, [...(labelsByTarget.get(route.targetScriptId) ?? []), label]);
    }

    const buttons: BranchRouteButton[] = [...labelsByTarget.entries()].map(([targetScriptId, labels]) => ({
      label: `${labels.join(' 또는 ')} 선택 시`,
      targetScriptId,
      destination: describeScene?.(targetScriptId),
    }));
    const defaultTarget = element.routes?.find(route => route.isDefault)?.targetScriptId ?? element.targetScriptId;
    if (defaultTarget && !labelsByTarget.has(defaultTarget)) {
      buttons.push({ label: '그 외', targetScriptId: defaultTarget, destination: describeScene?.(defaultTarget) });
    }
    return buttons;
  };

  const renderElements = (elements: ScriptElement[], parentKeyPrefix: string = ''): React.ReactNode => {
    return elements.map((element, index) => {
      const key = `${parentKeyPrefix}el_${script?.id || 's'}_${index}_${element.type}`;
      const elementId = buildElementDomId(parentKeyPrefix, index, element.type);
      const isSearchMatched = highlightedSearchMatchId === elementId;
      const wrapElement = (node: React.ReactNode) => (
        <div
          key={key}
          id={elementId}
          className={isSearchMatched ? 'relative rounded-lg ring-1 ring-inset ring-nikke-accent/70 transition-shadow duration-300 ease-editorial max-sm:-mx-3 max-sm:px-3' : undefined}
        >
          {node}
          {isSearchMatched && (
            <span className="absolute -top-[9px] right-3.5 rounded bg-nikke-accent px-2 py-px font-sans text-[11px] font-semibold not-italic text-nikke-accent-ink">
              검색 일치
            </span>
          )}
        </div>
      );

      if (element.type === 'next_subchapter_button') {
        const branchRouteButtons = showAllBranches ? buildBranchRouteButtons(element) : [];
        if (branchRouteButtons.length > 1) {
          return wrapElement(
            <BranchNextButtons
              key={key}
              buttonText={element.buttonText}
              routes={branchRouteButtons}
              onNavigate={(targetScriptId) => onNavigateToScript?.(targetScriptId)}
            />
          );
        }

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
        return wrapElement(
          <div key={key} role="separator" className="my-10 flex justify-center text-nikke-border-strong">
            <FourPointStarIcon aria-hidden="true" className="h-3.5 w-3.5" />
          </div>
        );
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
            showAllBranches={showAllBranches}
            getOptionDestination={getOptionDestination}
          />
        );
      }

      if (element.type === 'messenger_app') {
        return wrapElement(
          <MessengerAppRenderer
            key={key}
            element={element}
            keyPrefix={key}
            messageIdPrefix={elementId}
            highlightedSearchMatchId={highlightedSearchMatchId}
            selectedOptions={selectedOptions}
            onOptionSelect={onOptionSelect}
            onClearChoice={onClearChoice}
            showAllBranches={showAllBranches}
            getOptionDestination={getOptionDestination}
          />
        );
      }

      return null;
    });
  };

  const sceneLabel = script ? (script.subTitle || script.title) : '';
  const scriptLabel = script ? `${script.title}${script.subTitle ? ` — ${script.subTitle}` : ''}` : '';

  if (!script) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
        <NikkeLogo aria-hidden="true" className="h-10 w-7 opacity-60 grayscale" />
        <h2 className="mt-[18px] font-headline text-[21px] font-bold text-nikke-text-primary">열람할 장면을 선택하십시오</h2>
        <p className="mt-2 text-sm text-nikke-text-secondary">
          왼쪽 목록에서 타이틀을 펼치면 장면별로 열 수 있습니다.
        </p>
        {onNavigateToSearch && (
          <button
            onClick={onNavigateToSearch}
            className="mt-[22px] min-h-11 rounded-lg bg-nikke-accent px-5 text-sm font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent focus-visible:ring-offset-2 focus-visible:ring-offset-nikke-bg"
          >
            스토리 목록으로
          </button>
        )}
      </div>
    );
  }

  if (isLoadingInternalContent) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-[18px] p-4 text-center" role="status" aria-live="polite">
        <div aria-hidden="true" className="relative h-0.5 w-44 overflow-hidden rounded-sm bg-nikke-border">
          <span className="absolute inset-y-0 left-0 w-16 animate-pulse bg-nikke-accent" />
        </div>
        <p className="text-[15px] text-nikke-text-secondary">기록을 불러오는 중입니다</p>
        <p className="text-[13px] text-nikke-text-muted">{scriptLabel}</p>
      </div>
    );
  }

  if (internalContentError) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-4 text-center" role="alert">
        <div className="flex max-w-[340px] flex-col items-center gap-2.5">
          <h2 className="font-headline text-[21px] font-bold text-nikke-text-primary">기록을 열 수 없습니다</h2>
          <p className="text-sm leading-[1.6] text-nikke-text-secondary">"{scriptLabel}" 본문을 불러오지 못했습니다.</p>
          <p className="mt-2 w-full rounded-lg bg-red-500/10 px-3.5 py-3 text-left text-[13px] text-red-600 dark:text-[#FFB4B6]">{internalContentError}</p>
        </div>
      </div>
    );
  }

  const hasSceneCounter = sceneIndex >= 0 && sceneCount > 0;
  const sceneCounter = hasSceneCounter
    ? `${String(sceneIndex + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}`
    : null;
  /** 읽기 설정 한 줄: 라벨 + 단일 선택 버튼 묶음 */
  const renderReaderSettingRow = <T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    onChange: (next: T) => void,
    formatOption: (option: T) => string,
    className = '',
  ) => (
    <React.Fragment key={label}>
      <span className={`text-nikke-text-muted ${className}`}>{label}</span>
      <div role="radiogroup" aria-label={label} className={`flex flex-wrap gap-1 ${className}`}>
        {options.map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`min-h-9 min-w-14 rounded-lg px-3 max-sm:min-h-11 ${
              value === option
                ? 'bg-nikke-surface-high font-semibold text-nikke-text-primary'
                : 'text-nikke-text-secondary hover:text-nikke-text-primary'
            }`}
          >
            {formatOption(option)}
          </button>
        ))}
      </div>
    </React.Fragment>
  );
  const readerToolButtonClass = 'flex min-h-9 items-center justify-center gap-1 px-2.5 text-nikke-text-secondary hover:text-nikke-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-nikke-text-secondary max-sm:min-h-11';
  const toolbarButtonClass = 'flex min-h-10 items-center gap-1.5 rounded-lg border border-nikke-border-strong px-3.5 text-[13px] text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-nikke-border-strong disabled:hover:text-nikke-text-secondary max-sm:h-11 max-sm:w-11 max-sm:justify-center max-sm:border-0 max-sm:px-0';

  return (
    <>
      {branchWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
          <div
            ref={branchWarningDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-warning-title"
            className="w-full max-w-[360px] rounded-xl border border-nikke-border-strong bg-nikke-surface p-7"
          >
            <h3 id="branch-warning-title" className="font-headline text-[22px] font-bold text-nikke-text-primary">
              선택이 필요합니다
            </h3>
            <p className="mt-2.5 text-[15px] leading-[1.7] text-nikke-text-secondary">
              다음 장면으로 이동하려면 먼저 선택지를 고르십시오.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setBranchWarning(null)}
                className="min-h-11 rounded-lg border border-nikke-border-strong px-4 text-sm text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  focusChoiceBlock(branchWarning.choiceId);
                  setBranchWarning(null);
                }}
                className="min-h-11 rounded-lg bg-nikke-accent px-[18px] text-sm font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong"
                autoFocus
              >
                선택지로 이동
              </button>
            </div>
          </div>
        </div>
      )}

      <article className="max-w-[760px]" style={{ maxWidth: `${READER_WIDTH_PX[readerWidth]}px` }} aria-labelledby="script-title">
        <div className="flex flex-wrap items-center justify-between gap-3 max-sm:-mx-1 max-sm:flex-nowrap max-sm:border-b max-sm:border-nikke-border max-sm:pb-1">
          {/* 기록 번호: 로마 숫자(제목 서체) · 타이틀(본문 UI 서체) · 장면 순번(모노) */}
          <p className="flex min-w-0 items-baseline gap-2 text-[13px] text-nikke-text-muted max-sm:text-xs">
            {categoryRoman && <span className="shrink-0 font-headline font-semibold text-nikke-accent">{categoryRoman}</span>}
            <span className="min-w-0 truncate">{script.title}</span>
            {sceneCounter && <span aria-hidden="true">·</span>}
            {sceneCounter && (
              <span className="shrink-0 font-mono text-xs tracking-[0.04em] max-sm:text-[11px]">{sceneCounter}</span>
            )}
          </p>
          <div className="flex shrink-0 gap-2 max-sm:gap-1">
            <button
              type="button"
              onClick={() => onNavigateToPreviousScript?.(script.id)}
              disabled={!canNavigateToPreviousScript}
              aria-label={previousChapterTitle ? `이전 챕터: ${previousChapterTitle}` : '이전 장면'}
              title={previousChapterTitle ? `이전 챕터: ${previousChapterTitle}` : undefined}
              className={toolbarButtonClass}
            >
              <ChevronLeftIcon className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
              <span className="max-sm:hidden">{previousChapterTitle ? '이전 챕터' : '이전'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToNextScript?.(script.id)}
              disabled={!canNavigateToNextScript}
              aria-label={nextChapterTitle ? `다음 챕터: ${nextChapterTitle}` : '다음 장면'}
              title={nextChapterTitle ? `다음 챕터: ${nextChapterTitle}` : undefined}
              className={toolbarButtonClass}
            >
              <span className="max-sm:hidden">{nextChapterTitle ? '다음 챕터' : '다음'}</span>
              <ChevronRightIcon className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" strokeWidth={1.8} />
            </button>
            {onNavigateToSearch && (
              <button
                type="button"
                onClick={onNavigateToSearch}
                className={`${toolbarButtonClass} max-sm:hidden`}
              >
                목록
              </button>
            )}
          </div>
        </div>

        <header className="border-b border-nikke-border pb-10 pt-12 max-sm:pb-6 max-sm:pt-7">
          {script.subTitle && (
            <p className="text-[15px] text-nikke-text-secondary max-sm:text-[13px]">{script.title}</p>
          )}
          <h1
            id="script-title"
            className={`${script.subTitle ? 'mt-3 max-sm:mt-1.5' : ''} font-headline text-[clamp(34px,4.6vw,60px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-nikke-text-primary`}
          >
            {sceneLabel}
          </h1>
          <div className="mt-7 flex flex-wrap items-center gap-2 max-sm:mt-5">
            <button
              type="button"
              onClick={() => setIsReaderSettingsOpen(open => !open)}
              aria-expanded={isReaderSettingsOpen}
              aria-controls="reader-settings"
              className={`${readerToolButtonClass} rounded-lg border px-3 text-[13px] ${isReaderSettingsOpen ? 'border-nikke-accent text-nikke-text-primary' : 'border-nikke-border-strong'}`}
            >
              <span aria-hidden="true" className="font-headline text-[15px] font-semibold">가</span>
              읽기 설정
            </button>
            {sceneHasBranches && (
              <button
                type="button"
                onClick={() => {
                  if (showAllBranches) {
                    setShowAllBranchesSetting('off');
                    setSearchAutoExpand('done');
                  } else {
                    setShowAllBranchesSetting('on');
                  }
                }}
                aria-pressed={showAllBranches}
                className={`${readerToolButtonClass} rounded-lg border px-3 text-[13px] ${
                  showAllBranches
                    ? 'border-nikke-accent bg-nikke-accent/10 text-nikke-text-primary'
                    : 'border-nikke-border-strong'
                }`}
              >
                <BranchIcon aria-hidden="true" className="h-4 w-4" />
                모든 분기 보기
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                const sceneUrl = `${window.location.origin}${scenePath(script.categoryKey, script.id)}`;
                if (await copyTextToClipboard(sceneUrl)) {
                  setIsLinkCopied(true);
                }
              }}
              className={`${readerToolButtonClass} rounded-lg border border-nikke-border-strong px-3 text-[13px]`}
            >
              <LinkIcon aria-hidden="true" className="h-4 w-4" />
              <span aria-live="polite">{isLinkCopied ? '복사했습니다' : '장면 링크 복사'}</span>
            </button>
          </div>
          {isReaderSettingsOpen && (
            <div
              id="reader-settings"
              className="mt-3 grid gap-3 rounded-[10px] border border-nikke-border bg-nikke-surface p-4 text-[13px] sm:w-fit sm:grid-cols-[72px_auto] sm:items-center sm:gap-x-4"
            >
              {renderReaderSettingRow<ReaderTextSize>('글자 크기', READER_TEXT_SIZES, readerTextSize, setReaderTextSize, value => `${READER_TEXT_SIZE_PX[value]}`)}
              {renderReaderSettingRow<ReaderLineHeight>('줄 간격', READER_LINE_HEIGHTS, readerLineHeight, setReaderLineHeight, value => ({ tight: '좁게', normal: '보통', loose: '넓게' })[value])}
              {renderReaderSettingRow<ReaderWidth>('본문 폭', READER_WIDTHS, readerWidth, setReaderWidth, value => ({ narrow: '좁게', normal: '보통', wide: '넓게' })[value], 'max-sm:hidden')}
            </div>
          )}
          {showAllBranches && (
            <p role="status" className="mt-3 text-[13px] text-nikke-text-muted">
              {searchAutoExpand === 'on' && showAllBranchesSetting === 'off'
                ? '검색어가 고르지 않은 분기 안에 있어 모든 분기를 펼쳤습니다.'
                : '모든 선택지의 갈래를 펼쳐 보여 줍니다. 고른 선택은 바뀌지 않습니다.'}
            </p>
          )}
        </header>

        <div
          className="flex flex-col gap-1 pt-10 font-body max-sm:pt-6"
          style={{
            fontSize: `${READER_TEXT_SIZE_PX[readerTextSize]}px`,
            ['--reader-leading' as string]: READER_LINE_HEIGHT_VALUE[readerLineHeight],
          }}
        >
          {parsedElements.length > 0 ? renderElements(parsedElements) :
            <p className="font-body text-base italic text-nikke-text-muted md:text-lg">이 장면은 비어 있거나 지금 표시할 수 없습니다.</p>
          }
        </div>
      </article>
    </>
  );
};
