import React from 'react';
import type { DialogueElement } from '../../types';

interface DialogueRendererProps {
  element: DialogueElement;
}

const COMMANDER_SPEAKERS = new Set(['COMMANDER', '지휘관']);

export const DialogueRenderer: React.FC<DialogueRendererProps> = ({ element }) => {
  const speaker = element.speaker;
  const isCommander = !!speaker && COMMANDER_SPEAKERS.has(speaker.trim().toUpperCase());

  return (
    <div
      className={`grid grid-cols-[112px_minmax(0,1fr)] gap-6 rounded-lg px-4 py-3.5 max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-2 ${
        isCommander ? 'bg-nikke-accent/[0.07] max-sm:-mx-3 max-sm:px-3 max-sm:py-2.5' : 'max-sm:px-0'
      }`}
    >
      <span
        className={`pt-[0.375em] text-right font-sans text-[0.8125em] max-sm:pt-0 max-sm:text-left max-sm:text-[0.75em] ${
          isCommander ? 'font-semibold text-nikke-highlight' : 'font-medium text-nikke-text-secondary'
        }`}
      >
        {speaker}
      </span>
      <p className="whitespace-pre-wrap font-body text-[1.125em] leading-[var(--reader-leading,1.9)] text-nikke-text-primary max-sm:text-[1em]">
        {element.dialogue}
      </p>
    </div>
  );
};
