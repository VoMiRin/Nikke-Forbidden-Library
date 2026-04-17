import React from 'react';
import type { ChoiceBlockElement, ScriptElement } from '../../types';

interface ChoiceBlockRendererProps {
  element: ChoiceBlockElement;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  renderElements: (elements: ScriptElement[], parentKeyPrefix: string) => React.ReactNode;
  containerId?: string;
  isHighlighted?: boolean;
}

export const ChoiceBlockRenderer: React.FC<ChoiceBlockRendererProps> = ({
  element,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  renderElements,
  containerId,
  isHighlighted = false,
}) => {
  const selectedOptionValue = selectedOptions[element.choiceId];
  const selectedOptionData = element.options.find(option => option.value === selectedOptionValue);

  return (
    <div
      id={containerId}
      data-choice-block="true"
      data-choice-id={element.choiceId}
      data-choice-selected={selectedOptionValue ? 'true' : 'false'}
      className={`my-8 rounded-[1.4rem] bg-nikke-surface-low/85 p-4 shadow-ambient ring-1 transition-all duration-300 ease-editorial md:my-10 md:rounded-[2rem] md:p-8 ${
        isHighlighted
          ? 'ring-2 ring-nikke-accent shadow-[0_0_0_1px_rgba(104,206,255,0.16),0_0_48px_rgba(104,206,255,0.18)]'
          : 'ring-nikke-border/10'
      }`}
    >
      {element.prompt && <p className="mb-4 font-body text-base italic leading-7 text-nikke-text-secondary md:mb-5 md:text-lg md:leading-8">{element.prompt}</p>}
      {!selectedOptionValue ? (
        <ul className="space-y-3">
          {element.options.map(option => (
            <li key={option.optionId}>
              <button
                onClick={() => onOptionSelect(element.choiceId, option.value)}
                className="w-full rounded-[1rem] bg-nikke-surface-high px-4 py-3 text-left font-body text-base text-nikke-text-primary transition-all duration-300 ease-editorial hover:bg-nikke-accent hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-nikke-accent md:rounded-full md:px-5 md:py-4 md:text-lg"
                aria-label={`Select option: ${option.text}`}
              >
                {option.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-nikke-text-primary">
              <span className="font-label text-[0.68rem] font-bold uppercase tracking-[0.16em] text-nikke-accent md:text-[0.72rem] md:tracking-[0.18em]">Selected</span>
              <span className="ml-2 font-body text-base md:ml-3 md:text-lg">{selectedOptionData?.text}</span>
            </p>
            <button
              onClick={() => onClearChoice(element.choiceId)}
              className="rounded-full bg-nikke-surface-high px-4 py-2 font-label text-[0.68rem] uppercase tracking-[0.14em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary focus:outline-none focus:ring-1 focus:ring-nikke-accent md:text-[0.7rem] md:tracking-[0.16em]"
              aria-label={`Change selected option ${selectedOptionData?.text ?? ''}`}
            >
              Change Choice
            </button>
          </div>
          <div className="mt-4 rounded-[1.1rem] bg-nikke-bg-alt/70 px-4 py-3 md:rounded-[1.5rem] md:px-5 md:py-4">
            {selectedOptionData && renderElements(selectedOptionData.elements, `${element.choiceId}_${selectedOptionValue}_`)}
          </div>
        </div>
      )}
    </div>
  );
};
