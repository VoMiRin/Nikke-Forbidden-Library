import React from 'react';
import type { DialogueElement } from '../../types';

interface DialogueRendererProps {
  element: DialogueElement;
}

export const DialogueRenderer: React.FC<DialogueRendererProps> = ({ element }) => {
  const speaker = element.speaker;
  const isCommander = speaker?.toUpperCase() === 'COMMANDER';

  return (
    <div className={`my-3 md:my-4 flex ${isCommander ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-full rounded-[1rem] px-3.5 py-2.5 md:max-w-[82%] md:rounded-[1.25rem] md:px-5 md:py-4 ${isCommander ? 'bg-nikke-surface-high text-right shadow-glass' : 'bg-transparent text-left'}`}>
        {speaker && (
          <p className={`font-label text-[0.68rem] font-bold uppercase tracking-[0.16em] md:text-[0.75rem] md:tracking-[0.18em] ${isCommander ? 'text-nikke-accent' : 'text-nikke-text-muted'}`}>
            {speaker}
          </p>
        )}
        <p className="mt-1.5 whitespace-pre-wrap font-body text-[0.95rem] leading-[1.75] text-nikke-text-primary md:mt-2 md:text-[1.1rem] md:leading-[1.8]">
          {element.dialogue}
        </p>
      </div>
    </div>
  );
};
