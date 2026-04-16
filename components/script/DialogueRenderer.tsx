import React from 'react';
import type { DialogueElement } from '../../types';

interface DialogueRendererProps {
  element: DialogueElement;
}

export const DialogueRenderer: React.FC<DialogueRendererProps> = ({ element }) => {
  const speaker = element.speaker;
  const isCommander = speaker?.toUpperCase() === 'COMMANDER';

  return (
    <div className={`my-4 flex ${isCommander ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-full rounded-[1.25rem] px-4 py-3 md:max-w-[82%] md:px-5 md:py-4 ${isCommander ? 'bg-nikke-surface-high text-right shadow-glass' : 'bg-transparent text-left'}`}>
        {speaker && (
          <p className={`font-label text-[0.75rem] font-bold uppercase tracking-[0.18em] ${isCommander ? 'text-nikke-accent' : 'text-nikke-text-muted'}`}>
            {speaker}
          </p>
        )}
        <p className="mt-2 whitespace-pre-wrap font-body text-[1rem] leading-[1.8] text-nikke-text-primary md:text-[1.1rem]">
          {element.dialogue}
        </p>
      </div>
    </div>
  );
};
