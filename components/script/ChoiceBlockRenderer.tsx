import React from 'react';
import type { ChoiceBlockElement, ScriptElement } from '../../types';
import { optionKey } from './branchView';

interface ChoiceBlockRendererProps {
  element: ChoiceBlockElement;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  renderElements: (elements: ScriptElement[], parentKeyPrefix: string) => React.ReactNode;
  containerId?: string;
  isHighlighted?: boolean;
  /** 모든 분기 보기: 선택 없이 모든 갈래의 내용을 차례로 보여 준다 (선택값은 바꾸지 않음) */
  showAllBranches?: boolean;
  /** 이 선택지의 갈래가 장면 끝에서 다른 장면으로 이어질 때 그 장면 이름 (모든 분기 보기에서 표시) */
  getOptionDestination?: (choiceId: string, optionValue: string) => string | undefined;
}

export const ChoiceBlockRenderer: React.FC<ChoiceBlockRendererProps> = ({
  element,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  renderElements,
  containerId,
  isHighlighted = false,
  showAllBranches = false,
  getOptionDestination,
}) => {
  const selectedOptionValue = selectedOptions[element.choiceId];
  const selectedOptionData = element.options.find(option => option.value === selectedOptionValue);

  const selectedOptionIndex = selectedOptionData ? element.options.indexOf(selectedOptionData) : -1;

  return (
    <section
      id={containerId}
      aria-label="선택지"
      data-choice-block="true"
      data-choice-id={element.choiceId}
      data-choice-selected={selectedOptionValue || showAllBranches ? 'true' : 'false'}
      className={`my-8 rounded-[10px] border bg-nikke-surface p-5 font-sans transition-colors duration-300 ease-editorial max-sm:my-4 max-sm:p-3.5 ${
        isHighlighted ? 'border-nikke-accent ring-1 ring-nikke-accent' : 'border-nikke-border'
      }`}
    >
      <p className="mb-3.5 flex items-center justify-between gap-3 text-xs text-nikke-text-muted max-sm:mb-2.5 max-sm:text-[11px]">
        <span>선택지</span>
        {showAllBranches && element.options.length > 1 && <span>{element.options.length}개 분기 모두 표시</span>}
      </p>
      {element.prompt && <p className="mb-4 font-body text-base italic leading-7 text-nikke-text-secondary">{element.prompt}</p>}
      {showAllBranches ? (
        <ol className="flex flex-col">
          {element.options.map((option, index) => {
            const destination = getOptionDestination?.(element.choiceId, option.value);
            return (
            <li key={option.optionId} className={index > 0 ? 'mt-4 border-t border-nikke-border pt-4' : ''}>
              <p className="flex items-center gap-3 text-[1em] text-nikke-text-primary">
                <span
                  aria-hidden="true"
                  className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full font-headline text-xs font-bold ${
                    option.value === selectedOptionValue
                      ? 'bg-nikke-accent text-nikke-accent-ink'
                      : 'border border-nikke-accent text-nikke-accent'
                  }`}
                >
                  {optionKey(index)}
                </span>
                <span className="sr-only">분기 {optionKey(index)}:</span>
                {option.text}
              </p>
              {destination && (
                <p className="ml-[39px] mt-1.5 flex items-center gap-1.5 text-xs text-nikke-highlight">
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">이 선택 시</span>
                  다음 장면: {destination}
                </p>
              )}
              {option.elements.length > 0 ? (
                <div className="ml-[13px] mt-3 flex flex-col gap-1 border-l-2 border-nikke-accent/30 pl-4 font-body max-sm:ml-3 max-sm:pl-3">
                  {renderElements(option.elements, `${element.choiceId}_${option.value}_`)}
                </div>
              ) : (
                !destination && <p className="ml-[39px] mt-1.5 text-xs text-nikke-text-muted">이어지는 내용 없음</p>
              )}
            </li>
            );
          })}
        </ol>
      ) : !selectedOptionValue ? (
        <ul className="flex flex-col gap-2">
          {element.options.map((option, index) => (
            <li key={option.optionId}>
              <button
                onClick={() => onOptionSelect(element.choiceId, option.value)}
                className="group flex min-h-[52px] w-full items-center gap-3.5 rounded-lg border border-nikke-border-strong px-3.5 py-2 text-left text-[1em] text-nikke-text-primary transition-colors duration-150 hover:border-nikke-accent hover:bg-nikke-accent/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent max-sm:min-h-[50px] max-sm:gap-3 max-sm:px-3 max-sm:text-[0.9375em]"
                aria-label={`선택: ${option.text}`}
              >
                <span aria-hidden="true" className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-nikke-border-strong font-headline text-xs text-nikke-text-secondary group-hover:border-nikke-accent group-hover:text-nikke-text-primary">
                  {optionKey(index)}
                </span>
                <span>{option.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <p className="flex items-center gap-3 text-[1em] text-nikke-text-primary">
              <span aria-hidden="true" className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-nikke-accent font-headline text-xs font-bold text-nikke-accent-ink">
                {selectedOptionIndex >= 0 ? optionKey(selectedOptionIndex) : ''}
              </span>
              <span className="sr-only">선택함:</span>
              {selectedOptionData?.text}
            </p>
            <button
              onClick={() => onClearChoice(element.choiceId)}
              className="min-h-10 rounded-lg border border-nikke-border-strong px-3.5 text-[13px] text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent"
              aria-label={`선택 변경: ${selectedOptionData?.text ?? ''}`}
            >
              선택 변경
            </button>
          </div>
          {selectedOptionData && selectedOptionData.elements.length > 0 && (
            <div className="mt-4 flex flex-col gap-1 border-t border-nikke-border pt-4 font-body">
              {renderElements(selectedOptionData.elements, `${element.choiceId}_${selectedOptionValue}_`)}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
