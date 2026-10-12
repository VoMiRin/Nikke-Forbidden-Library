import React from 'react';
import type { NarrationElement } from '../../types';

interface NarrationRendererProps {
  element: NarrationElement;
}

const narrationClass = 'whitespace-pre-wrap pl-[136px] font-body text-[1em] italic leading-[var(--reader-leading,1.9)] text-nikke-text-secondary max-sm:pl-0 max-sm:text-[0.9375em]';

export const NarrationRenderer: React.FC<NarrationRendererProps> = ({ element }) => {
  if (element.isSceneMarker) {
    return (
      <p className="my-4 flex items-center gap-4 font-sans text-xs text-nikke-text-muted before:h-px before:flex-1 before:bg-nikke-border after:h-px after:flex-1 after:bg-nikke-border">
        {element.text}
      </p>
    );
  }

  const upperSpeakerForCheck = element.speaker?.toUpperCase() || '';

  if (upperSpeakerForCheck.includes('[ACTION]')) {
    const speakerName = element.speaker!.replace(/\[ACTION\]/i, '').trim();
    return (
      <p className={`my-2 ${narrationClass}`}>{speakerName} : {element.text}</p>
    );
  }

  const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];

  if (element.speaker && narrationKeywords.includes(upperSpeakerForCheck.replace(/\.$/, ''))) {
    if (upperSpeakerForCheck === 'SYSTEM' && element.text.startsWith('Error:')) {
      return (
        <p className="my-4 whitespace-pre-wrap rounded-lg bg-red-500/10 px-4 py-3 font-mono text-xs leading-[1.7] text-red-600 dark:text-[#FFB4B6]">
          <span className="font-medium">{element.speaker}</span> — {element.text}
        </p>
      );
    }
    return (
      <p className="mb-4 mt-1 whitespace-pre-wrap font-mono text-xs leading-[1.7] tracking-[0.06em] text-nikke-text-muted max-sm:mb-1.5 max-sm:text-[11px]">
        <span className="text-nikke-accent">{element.speaker}</span> — {element.text}
      </p>
    );
  }

  return (
    <p className={`mb-3 ${narrationClass}`}>{element.text}</p>
  );
};
